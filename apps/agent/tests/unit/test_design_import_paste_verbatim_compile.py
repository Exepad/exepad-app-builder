"""End-to-end Tailwind v4 compile of the paste-verbatim recipe for multi-page Claude Design.

The multi-page section of the Claude Design importer skill instructs the LLM
to (a) extract ``:root`` from ``styles.css`` into ``@theme`` (with M3 mapping
+ original tokens mirrored), (b) strip the global resets that Tailwind's
preflight already provides, and (c) paste the remaining shared classnames
verbatim inside ``@layer exepad-app { … }`` in ``codefocus_style:theme.css``.

This test takes the actual HappyDoods ``styles.css`` fixture, applies that
recipe deterministically in Python, then runs the real Tailwind v4 CLI
against the result. It catches:

- Tailwind rejecting any pasted construct (``:hover``, ``::after``,
  ``@media``, ``transform: translateY(...)``, ``font-variation-settings``,
  ``clamp(...)``, ``background-image: url("data:image/svg+xml;…")``, etc.)
  inside ``@layer exepad-app``.
- Missing tokens — every ``var(--*)`` reference in the verbatim block must
  resolve from the mirrored ``@theme`` declarations.
- Bootstrap-preamble misuse (the validator's nested-bootstrap-lifter is the
  safety net; this test asserts the canonical preamble shape is correct).

Skipped if the Tailwind CLI / required ``node_modules`` aren't present.
"""

from __future__ import annotations

import os
import re
import subprocess
import tempfile
from pathlib import Path

import pytest

from tests._tailwind import find_tailwind_node_modules, find_tailwindcss_binary

pytestmark = [pytest.mark.unit]


HAPPYDOODS_CSS = (
    Path(__file__).resolve().parents[4]
    / "packages"
    / "design-tools-fixtures"
    / "claude_design"
    / "chick_farm"
    / "styles.css"
)


# ── Recipe: turn vanilla styles.css into paste-verbatim theme.css ─────────


_ROOT_RE = re.compile(r":root\s*\{([^}]*)\}", re.DOTALL)
_VAR_DECL_RE = re.compile(r"--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);")
# Top-level rules that the skill says we must STRIP (Tailwind preflight covers
# them, or _shared.md:347 explicitly forbids them). Order matters — match the
# whole rule including its body and trailing whitespace.
_GLOBAL_RESET_PATTERNS = [
    # `* { ... }` — universal reset
    re.compile(r"\*\s*\{[^}]*\}", re.DOTALL),
    # `html { ... }` / `body { ... }` / `img { ... }` / `a { ... }` at top level
    re.compile(r"^\s*html\s*\{[^}]*\}", re.MULTILINE | re.DOTALL),
    re.compile(r"^\s*body\s*\{[^}]*\}", re.MULTILINE | re.DOTALL),
    re.compile(r"^\s*img\s*\{[^}]*\}", re.MULTILINE | re.DOTALL),
    re.compile(r"^\s*a\s*\{[^}]*\}", re.MULTILINE | re.DOTALL),
    # Unscoped h1-h4 typography blocks (with or without the comma list).
    re.compile(r"^\s*h1\s*,\s*h2\s*,\s*h3\s*,\s*h4\s*\{[^}]*\}", re.MULTILINE | re.DOTALL),
    re.compile(r"^\s*h[1-4]\s*\{[^}]*\}", re.MULTILINE | re.DOTALL),
    re.compile(r"^\s*p\s*\{[^}]*\}", re.MULTILINE | re.DOTALL),
]


def _extract_root_vars(css: str) -> dict[str, str]:
    """Pull every ``--name: value;`` declaration from the first ``:root`` block."""
    m = _ROOT_RE.search(css)
    if not m:
        return {}
    body = m.group(1)
    return {name: value.strip() for name, value in _VAR_DECL_RE.findall(body)}


def _strip_root_and_globals(css: str) -> str:
    """Remove the ``:root`` block and the forbidden global rules."""
    # Drop :root first.
    out = _ROOT_RE.sub("", css, count=1)
    # Then drop each global pattern. Iterate to handle multiple instances.
    for pat in _GLOBAL_RESET_PATTERNS:
        out = pat.sub("", out)
    return out


# Subset of the M3 mapping table from the skill's HappyDoods example.
# Keys are bare token names (no leading `--`) to match _extract_root_vars output.
_M3_MAPPING = {
    "cream": ["--color-background", "--color-surface", "--color-surface-bright"],
    "paper": ["--color-surface-container-lowest"],
    "cream-deep": ["--color-surface-container", "--color-surface-dim"],
    "barn": ["--color-primary"],
    "barn-dark": ["--color-on-primary-container"],
    "moss": ["--color-secondary"],
    "moss-dark": ["--color-on-secondary-container"],
    "ink": ["--color-on-background", "--color-on-surface"],
    "ink-soft": ["--color-on-surface-variant"],
    "butter": ["--color-tertiary", "--color-primary-container"],
    "line": ["--color-outline-variant"],
    "line-soft": ["--color-outline"],
}

# M3 tokens with no design counterpart — derived sane defaults.
_M3_DEFAULTS: dict[str, str] = {
    "--color-on-primary": "#FFFFFF",
    "--color-on-secondary": "#FFFFFF",
    "--color-on-tertiary": "#FFFFFF",
    "--color-on-error": "#FFFFFF",
    "--color-on-error-container": "#93000A",
    "--color-error": "#BA1A1A",
    "--color-error-container": "#FFDAD6",
    "--color-surface-container-low": "#F6F3ED",
    "--color-surface-container-high": "#EBE8E2",
    "--color-surface-container-highest": "#E5E2DC",
    "--color-surface-variant": "#E5E2DC",
    "--color-on-secondary-container": "#5C6B40",
    "--color-inverse-surface": "#31312D",
    "--color-inverse-on-surface": "#F3F0EA",
    "--color-inverse-primary": "#FDBC13",
    "--color-secondary-container": "#E8DEC6",
}


def _build_theme_css(styles_css: str, fonts_url: str) -> str:
    """Apply the skill's recipe to produce a paste-verbatim theme.css.

    1. Bootstrap preamble at the top.
    2. Google Fonts ``@import``.
    3. ``@theme`` with M3 palette + original ``--*`` tokens mirrored.
    4. ``@layer exepad-app { … }`` containing the cleaned styles.css.
    """
    original_vars = _extract_root_vars(styles_css)
    cleaned = _strip_root_and_globals(styles_css)

    theme_decls: list[str] = []
    # M3 mapped tokens first.
    for source_var, m3_targets in _M3_MAPPING.items():
        if source_var in original_vars:
            value = original_vars[source_var]
            for tgt in m3_targets:
                theme_decls.append(f"  {tgt}: {value};")
    # Defaults for M3 tokens with no design counterpart.
    for tgt, default in _M3_DEFAULTS.items():
        theme_decls.append(f"  {tgt}: {default};")
    # Original design tokens mirrored so verbatim rules can resolve var(--*).
    for name, value in original_vars.items():
        theme_decls.append(f"  --{name}: {value};")

    return f"""\
@import "tailwindcss";
@import "tw-animate-css";
@source "./components";

@import url("{fonts_url}");

@theme {{
{chr(10).join(theme_decls)}
}}

@layer exepad-app {{
{cleaned}
}}
"""


# ── Pure-Python recipe sanity ─────────────────────────────────────────────


class TestRecipePure:
    def test_extract_root_vars_finds_every_token(self):
        if not HAPPYDOODS_CSS.exists():
            pytest.skip(f"Fixture missing: {HAPPYDOODS_CSS}")
        original = _extract_root_vars(HAPPYDOODS_CSS.read_text())
        # Sanity checks against the actual fixture.
        assert original.get("cream") == "#F5EFE2"
        assert original.get("barn") == "#A8472A"
        assert original.get("moss") == "#7B8B5C"
        assert original.get("serif", "").startswith('"Fraunces"')

    def test_strip_globals_removes_forbidden_rules(self):
        css = """\
:root { --x: 1; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body { font-family: var(--sans); background: var(--cream); }
img { max-width: 100%; display: block; }
a { color: inherit; text-decoration: none; }
h1, h2, h3, h4 { font-family: var(--serif); }
p { text-wrap: pretty; }
.nav { display: flex; }
.nav-links a:hover { color: red; }
"""
        out = _strip_root_and_globals(css)
        assert ":root" not in out
        assert "* {" not in out and "*{" not in out
        assert "\nhtml {" not in out and "\nhtml{" not in out
        assert "\nbody {" not in out
        assert "\nimg {" not in out
        assert "\na {" not in out
        # Keeps non-global rules and pseudo-classes.
        assert ".nav {" in out
        assert ".nav-links a:hover" in out

    def test_build_theme_css_has_required_structure(self):
        if not HAPPYDOODS_CSS.exists():
            pytest.skip(f"Fixture missing: {HAPPYDOODS_CSS}")
        css = _build_theme_css(HAPPYDOODS_CSS.read_text(), "https://fonts.googleapis.com/css2?x")
        # Bootstrap preamble at the very top.
        assert css.startswith('@import "tailwindcss";')
        # Mode: bootstrap + @import + @theme + @layer order.
        assert css.index('@import "tw-animate-css";') < css.index("@theme")
        assert css.index("@theme") < css.index("@layer exepad-app")
        # M3 tokens populated from the original :root.
        assert "--color-primary: #A8472A;" in css  # from --barn
        assert "--color-background: #F5EFE2;" in css  # from --cream
        # Original tokens mirrored so var(--barn) etc. still resolve.
        assert "--barn: #A8472A;" in css
        assert "--cream: #F5EFE2;" in css
        # Verbatim shared classes pasted into @layer.
        assert ".nav-cta:hover" in css
        assert ".btn-primary:hover" in css
        assert ".nav-links a.active::after" in css
        assert "@media (max-width: 720px)" in css


# ── Real Tailwind v4 compile — the actual round-trip ─────────────────────


def _write_dummy_component(components_dir: Path) -> None:
    """Drop a TSX file using a few Tailwind utility classes the bootstrap will scan."""
    components_dir.mkdir(parents=True, exist_ok=True)
    (components_dir / "Sample.tsx").write_text(
        "export default function S(){"
        'return <div className="bg-primary text-on-primary p-4 rounded-xl">x</div>}'
    )


def _compile(theme_css: str, binary: str, node_modules: Path) -> tuple[int, str, str]:
    """Compile ``theme_css`` via tailwindcss CLI; return (returncode, stdout, stderr)."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        _write_dummy_component(tmp_path / "components")
        os.symlink(node_modules, tmp_path / "node_modules")
        in_css = tmp_path / "in.css"
        out_css = tmp_path / "out.css"
        in_css.write_text(theme_css)
        result = subprocess.run(
            [binary, "--input", str(in_css), "--output", str(out_css), "--cwd", str(tmp_path)],
            capture_output=True,
            text=True,
            timeout=30,
        )
        compiled = out_css.read_text() if out_css.exists() else ""
        return result.returncode, compiled, result.stderr


def test_paste_verbatim_theme_css_compiles_against_real_tailwind():
    """End-to-end: build theme.css from HappyDoods styles.css using the
    skill's paste-verbatim recipe, then compile it through the real
    Tailwind v4 CLI. The compile must succeed AND the output must contain
    representative custom classes from styles.css plus the M3 utilities
    used by the dummy component."""
    if not HAPPYDOODS_CSS.exists():
        pytest.skip(f"Fixture missing: {HAPPYDOODS_CSS}")

    binary = find_tailwindcss_binary()
    if not binary:
        pytest.skip("tailwindcss CLI not available on this host")

    node_modules = find_tailwind_node_modules()
    if not node_modules:
        pytest.skip("tailwindcss + tw-animate-css node_modules not available")

    fonts_url = (
        "https://fonts.googleapis.com/css2?"
        "family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&"
        "family=Inter:wght@400;500;600;700&"
        "family=Caveat:wght@500;700&"
        "family=JetBrains+Mono:wght@400;500&display=swap"
    )
    theme_css = _build_theme_css(HAPPYDOODS_CSS.read_text(), fonts_url)

    rc, compiled, stderr = _compile(theme_css, binary, node_modules)
    assert rc == 0, f"Tailwind compile failed:\n{stderr}\n\n--- input ---\n{theme_css}"

    # Custom classes from styles.css survive compilation (they're not utilities,
    # they're inside @layer exepad-app and ship as-is).
    for needle in (".nav-cta", ".btn-primary", ".eyebrow", ".footer-grid"):
        assert needle in compiled, f"Expected `{needle}` in compiled CSS"

    # The :hover and ::after rules also survive (Tailwind v4 doesn't strip them
    # from layer blocks).
    assert ".nav-cta:hover" in compiled
    assert ".btn-primary:hover" in compiled
    assert ".nav-links a.active::after" in compiled

    # The @media query inside @layer is preserved.
    assert "@media (max-width: 720px)" in compiled

    # M3 utility classes from the dummy component compile to real CSS rules
    # that reference the @theme tokens.
    assert ".bg-primary" in compiled
    # The barn color value (#A8472A → primary) appears in the compiled output.
    # Tailwind may downcase hex; check both forms.
    assert ("#A8472A" in compiled) or ("#a8472a" in compiled)


def test_paste_verbatim_theme_css_resolves_every_var_reference():
    """Compile and grep the result for ``var(--*)`` references that did NOT
    come from the original ``@theme`` — those would indicate an unresolved
    token (e.g., the recipe forgot to mirror an original ``--*`` declaration).
    Tailwind itself wouldn't error on unresolved vars (CSS is permissive),
    so this test specifically guards against silently-broken styling."""
    if not HAPPYDOODS_CSS.exists():
        pytest.skip(f"Fixture missing: {HAPPYDOODS_CSS}")
    binary = find_tailwindcss_binary()
    if not binary:
        pytest.skip("tailwindcss CLI not available on this host")
    node_modules = find_tailwind_node_modules()
    if not node_modules:
        pytest.skip("tailwindcss + tw-animate-css node_modules not available")

    css_in = HAPPYDOODS_CSS.read_text()
    theme_css = _build_theme_css(css_in, "https://fonts.googleapis.com/css2?x")
    rc, compiled, stderr = _compile(theme_css, binary, node_modules)
    assert rc == 0, stderr

    # Every var(--*) that the verbatim block references must be present in
    # the compiled output's @theme / :root section. Find them.
    referenced = set(re.findall(r"var\(--([a-zA-Z0-9_-]+)\)", css_in))
    declared = set(_extract_root_vars(css_in).keys())
    # Anything referenced that wasn't declared in the original :root is a
    # design bug in styles.css itself — we only assert the recipe doesn't
    # introduce NEW unresolved references. So intersect against declared.
    must_resolve = referenced & declared
    # The compiled output should contain a declaration for every must-resolve
    # token (Tailwind v4 emits @theme tokens as :root declarations).
    for name in must_resolve:
        assert f"--{name}:" in compiled, (
            f"Token --{name} referenced in styles.css but not present in "
            f"compiled @theme — recipe must mirror it."
        )
