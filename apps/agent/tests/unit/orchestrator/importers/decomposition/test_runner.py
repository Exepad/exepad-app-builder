"""End-to-end runner tests using a fake in-memory artifact service.

The runner orchestrates: plan validation → handler dispatch → theme
collection → page processing → chrome extraction → metadata save →
creator_plan synthesis. These tests exercise it against the real
claude_design_2 fixture, so any cleaner / lifter / transformer
regression that affects orchestration shows up here too.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pytest

from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
    HandlerError,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.plan import (
    BackendIntent,
    ChromeRegion,
    DecompositionPlan,
    M3Pillars,
    PageMapping,
    ThemePlan,
)


def _default_pillars(**overrides) -> M3Pillars:
    """Convenience: build M3Pillars with the HappyDoods palette as defaults.

    Every plan must provide all four pillars; this helper keeps per-test
    noise low while letting any single test override one or more pillars
    to exercise resolver behavior.
    """
    base: dict[str, str] = {
        "primary": "--barn",
        "secondary": "--moss",
        "surface": "--cream",
        "error": "#DC2626",
    }
    base.update(overrides)
    return M3Pillars(**base)


from main_agent.agents.orchestrator.importers.tools.decomposition.runner import (
    run_design_decomposition,
)

# ── Fake artifact service + ctx ───────────────────────────────────────────


@dataclass
class _FakeSession:
    id: str = "sess-1"
    user_id: str = "user-1"
    app_name: str = "exepad"


@dataclass
class _FakeArtifactService:
    """In-memory store keyed by filename. Mirrors the bits of the real
    ADK artifact service the runner actually calls."""

    blobs: dict[str, bytes] = field(default_factory=dict)
    mimes: dict[str, str] = field(default_factory=dict)

    async def list_artifact_keys(self, *, session_id, user_id, app_name) -> list[str]:
        return list(self.blobs.keys())

    async def load_artifact(self, *, session_id, user_id, app_name, filename, version=None):
        if filename not in self.blobs:
            return None

        # Build a Part-like object with .inline_data.data + .mime_type.
        class _Inline:
            def __init__(self, data: bytes, mime: str):
                self.data = data
                self.mime_type = mime

        class _Part:
            def __init__(self, data: bytes, mime: str):
                self.inline_data = _Inline(data, mime)

        return _Part(self.blobs[filename], self.mimes.get(filename, "text/plain"))

    async def save_artifact(self, *, session_id, user_id, app_name, filename, artifact):
        # The runner uses genai.types.Part.from_bytes — pull the bytes back out.
        if hasattr(artifact, "inline_data") and artifact.inline_data is not None:
            data = artifact.inline_data.data
            mime = getattr(artifact.inline_data, "mime_type", "application/octet-stream")
        else:
            data = b""
            mime = "application/octet-stream"
        if isinstance(data, str):
            data = data.encode("utf-8")
        self.blobs[filename] = data
        self.mimes[filename] = mime
        return 1


@dataclass
class _FakeCtx:
    session: _FakeSession = field(default_factory=_FakeSession)
    artifact_service: _FakeArtifactService = field(default_factory=_FakeArtifactService)


def _stage(ctx: _FakeCtx, key: str, text: str, mime: str = "text/html") -> None:
    ctx.artifact_service.blobs[key] = text.encode("utf-8")
    ctx.artifact_service.mimes[key] = mime


REPO_ROOT = Path(__file__).resolve().parents[7]
CLAUDE_DESIGN_2 = REPO_ROOT / "packages" / "design-tools-fixtures" / "claude_design" / "chick_farm"


def _build_minimal_creator_plan(pages: list[PageMapping]) -> dict:
    """Smallest valid CreatorOutput dict for the runner to override."""
    return {
        "app_name": "HappyDoods",
        "app_building_plan_artifact": "",
        "navigation_type": "HeaderMenuTop",
        "design_system": {
            "primary_color": "#000000",
            "secondary_color": "#000000",
            "surface_color": "#000000",
            "error_color": "#000000",
            "headline_font": "Inter",
            "body_font": "Inter",
            "design_style": ["placeholder bullet"],
        },
        "component_plans": [
            {
                "name": "PlaceholderContent",
                "role": "content",
                "page_slug": "/",
                "page_title": "Home",
                "building_plan_artifact": "",
                "image_references": [],
                "source_html_artifact": "",
            }
        ],
        "app_logic_plan": {},
        "app_backend_plan": {},
        "app_security_plan": {},
        "app_favicon_svg": "",
        "reasoning": "test fixture",
    }


# ── Plan validation ───────────────────────────────────────────────────────


@pytest.mark.skipif(
    not CLAUDE_DESIGN_2.exists(),
    reason=f"fixture missing: {CLAUDE_DESIGN_2}",
)
async def test_runner_rejects_missing_bundle_artifact():
    ctx = _FakeCtx()
    _stage(ctx, "bundle:asset:styles.css", (CLAUDE_DESIGN_2 / "styles.css").read_text(), "text/css")

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:nope.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        theme=ThemePlan(pillars=_default_pillars()),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    with pytest.raises(HandlerError, match="missing bundle artifact"):
        await run_design_decomposition(
            ctx,
            plan=plan,
            skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
        )


async def test_runner_rejects_disallowed_output_artifact():
    ctx = _FakeCtx()
    _stage(ctx, "bundle:html:home/code.html", "<body><p>hi</p></body>")

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:home/code.html",
                output_artifact="content:home:invalid.html",  # bad shape
                page_slug="home",
                page_route="/home",
                page_title="Home",
            )
        ],
        theme=ThemePlan(pillars=_default_pillars()),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    with pytest.raises(HandlerError, match="allow-list"):
        await run_design_decomposition(
            ctx,
            plan=plan,
            skill_context={"skill_name": "claude-design-importer"},
        )


# ── script_artifact validation (Babel-shell pages) ────────────────────────


async def test_runner_rejects_script_artifact_in_wrong_namespace():
    """script_artifact must point at bundle:script:* — not html, asset, etc."""
    ctx = _FakeCtx()
    _stage(ctx, "bundle:html:home.html", "<body><div id='root'/></body>")
    _stage(ctx, "bundle:html:game.jsx", "function Game(){}")  # wrong namespace

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:home.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
                script_artifact="bundle:html:game.jsx",  # wrong namespace
                script_mode="babel-shell",  # mode is correct; artifact key isn't
            )
        ],
        theme=ThemePlan(pillars=_default_pillars()),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    with pytest.raises(HandlerError, match="must reference a bundle:script:\\* key"):
        await run_design_decomposition(
            ctx,
            plan=plan,
            skill_context={"skill_name": "claude-design-importer"},
        )


async def test_runner_rejects_script_artifact_pointing_at_missing_key():
    """script_artifact must exist in the staged keyset; useful diagnostic on miss."""
    ctx = _FakeCtx()
    _stage(ctx, "bundle:html:home.html", "<body><div id='root'/></body>")
    _stage(ctx, "bundle:script:tweaks.jsx", "function Tweaks(){}")

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:home.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
                script_artifact="bundle:script:not-uploaded.jsx",  # not staged
                script_mode="babel-shell",
            )
        ],
        theme=ThemePlan(pillars=_default_pillars()),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    with pytest.raises(HandlerError) as excinfo:
        await run_design_decomposition(
            ctx,
            plan=plan,
            skill_context={"skill_name": "claude-design-importer"},
        )
    msg = str(excinfo.value)
    assert "missing script artifact" in msg
    # Diagnostic should list what scripts ARE staged so the LLM (or human)
    # can fix the reference without guessing.
    assert "bundle:script:tweaks.jsx" in msg


async def test_runner_rejects_script_artifact_without_script_mode():
    """script_artifact set without script_mode is half-formed: the plan
    named a script but didn't say what to do with it. Reject."""
    ctx = _FakeCtx()
    _stage(ctx, "bundle:html:home.html", "<body><div id='root'/></body>")
    _stage(ctx, "bundle:script:game.jsx", "function Game(){}")

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:home.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
                script_artifact="bundle:script:game.jsx",
                script_mode=None,  # half-formed: artifact set, mode missing
            )
        ],
        theme=ThemePlan(pillars=_default_pillars()),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    with pytest.raises(HandlerError, match="without script_mode"):
        await run_design_decomposition(
            ctx,
            plan=plan,
            skill_context={"skill_name": "claude-design-importer"},
        )


async def test_runner_accepts_script_mode_without_script_artifact():
    """script_mode='babel-shell' standalone is a valid telemetry signal:
    on a multi-page Babel-shell where many sibling JSX files share one
    HTML via internal routing, there is no 1:1 slug→script mapping. The
    runner self-detects sibling scripts via pair_script_artifact, so
    leaving script_artifact=None is the honest answer.

    Regression for app rw0rzf6z (Ashford School Dashboard): the LLM
    correctly tagged the page as Babel-shell but had no single script
    to point at; the strict XOR validator was rejecting this."""
    ctx = _FakeCtx()
    _stage(ctx, "bundle:html:home.html", "<body><div id='root'/></body>")
    _stage(ctx, "bundle:script:shell.jsx", "function Shell(){}")

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:home.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
                script_artifact=None,  # honest: many siblings, no single one
                script_mode="babel-shell",
            )
        ],
        # Literal hex pillars bypass the --var resolver so this test
        # stays scoped to the script_* validator and doesn't depend on
        # a staged styles.css fixture.
        theme=ThemePlan(
            pillars=_default_pillars(
                primary="#b94545",
                secondary="#2f5d3d",
                surface="#fff8ee",
            )
        ),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    # Should NOT raise on script validation. The runner may still raise
    # later for unrelated reasons (missing assets, etc.) — assert any
    # such error is NOT about script_artifact / script_mode.
    try:
        await run_design_decomposition(
            ctx,
            plan=plan,
            skill_context={"skill_name": "claude-design-importer"},
        )
    except HandlerError as exc:
        msg = str(exc)
        assert "script_artifact" not in msg and "script_mode" not in msg, (
            f"script validator must accept mode-only, got: {msg}"
        )


def test_is_allowed_output_accepts_content_script_jsx():
    """content:<slug>:script.jsx is a valid runner output for Babel-shell pages."""
    from main_agent.agents.orchestrator.importers.tools.decomposition.runner import (
        _is_allowed_output,
    )

    assert _is_allowed_output("content::script.jsx") is True
    assert _is_allowed_output("content:bloop-world:script.jsx") is True
    # Slug rules still apply: invalid kebab → reject.
    assert _is_allowed_output("content:Bloop World:script.jsx") is False
    # Wrong suffix → reject.
    assert _is_allowed_output("content:home:script.tsx") is False
    assert _is_allowed_output("content:home:something.jsx") is False


# ── End-to-end against claude_design_2 fixture ────────────────────────────


@pytest.mark.skipif(
    not CLAUDE_DESIGN_2.exists(),
    reason=f"fixture missing: {CLAUDE_DESIGN_2}",
)
async def test_runner_end_to_end_claude_design_2_partial():
    """Stage a 3-page subset of claude_design_2 and run the runner.

    Verifies:
      * ``content:<slug>:page.html`` artifacts are saved for every page.
      * ``codefocus_style:theme.css`` is saved with the bootstrap preamble,
        @theme block, and @layer exepad-app.
      * ``design_import/notes.md`` and ``navigation.json`` are saved.
      * The synthesized creator_plan has one ComponentPlan per page +
        chrome region, each pointing at the deterministically-emitted artifact.
    """
    ctx = _FakeCtx()
    _stage(
        ctx,
        "bundle:asset:styles.css",
        (CLAUDE_DESIGN_2 / "styles.css").read_text(),
        "text/css",
    )
    _stage(
        ctx,
        "bundle:html:index.html",
        (CLAUDE_DESIGN_2 / "index.html").read_text(),
    )
    _stage(
        ctx,
        "bundle:html:contact.html",
        (CLAUDE_DESIGN_2 / "contact.html").read_text(),
    )
    _stage(
        ctx,
        "bundle:doc:partials.html",
        (CLAUDE_DESIGN_2 / "partials.html").read_text(),
    )

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:index.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
                page_summary="HappyDoods landing page.",
                page_short_summary="Home",
            ),
            PageMapping(
                bundle_artifact="bundle:html:contact.html",
                output_artifact="content:contact:page.html",
                page_slug="contact",
                page_route="/contact",
                page_title="Contact",
                page_summary="Contact form.",
                page_short_summary="Contact",
            ),
        ],
        chrome=[
            ChromeRegion(
                role="header",
                output_artifact="content:main:header.html",
                source_artifact="bundle:doc:partials.html",
                # The fixture's partials.html uses <nav class="nav"> for the
                # header chrome (no literal <header>); the LLM picks the
                # selector based on what's actually in the markup.
                selector="nav.nav",
                delete_from_pages=False,
            ),
        ],
        theme=ThemePlan(pillars=_default_pillars()),
        navigation={
            "routes": [
                {"path": "/", "page_slug": "", "title": "Home"},
                {"path": "/contact", "page_slug": "contact", "title": "Contact"},
            ],
            "default": "",
        },
        backend_intent=BackendIntent(),
        notes="Imported from fixture.\n",
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    result = await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    # ── Artifact emission ─────────────────────────────────────────────
    assert "content::page.html" in ctx.artifact_service.blobs
    assert "content:contact:page.html" in ctx.artifact_service.blobs
    assert "content:main:header.html" in ctx.artifact_service.blobs
    assert "codefocus_style:theme.css" in ctx.artifact_service.blobs
    assert "design_import/notes.md" in ctx.artifact_service.blobs
    assert "design_import/navigation.json" in ctx.artifact_service.blobs

    # backend-intent.json should NOT be saved when plan.backend_intent is empty.
    assert "design_import/backend-intent.json" not in ctx.artifact_service.blobs

    # ── theme.css structure ───────────────────────────────────────────
    theme = ctx.artifact_service.blobs["codefocus_style:theme.css"].decode("utf-8")
    assert theme.startswith('@import "tailwindcss";')
    assert "@theme {" in theme
    assert "@layer exepad-app {" in theme
    # M3 tokens resolved from token mappings:
    assert "--color-primary: #A8472A" in theme
    # Original tokens preserved:
    assert "--barn:" in theme
    # Layer preserved real CSS rules from styles.css:
    assert ".wrap" in theme
    assert ".nav" in theme

    # ── content::page.html: hero ticker + promise grid present ───────
    home = ctx.artifact_service.blobs["content::page.html"].decode("utf-8")
    assert "ticker" in home
    assert "promise" in home
    # .ph loader script gone, but img URLs present.
    assert "const PH" not in home
    assert 'src="https://images.unsplash.com/' in home

    # ── notes.md absorbs unmatched .ph labels ────────────────────────
    notes = ctx.artifact_service.blobs["design_import/notes.md"].decode("utf-8")
    assert "Imported from fixture" in notes

    # ── creator_plan synthesis ───────────────────────────────────────
    cp = result.synthesized_creator_plan
    assert cp["component_plans"][0]["role"] == "header"
    assert cp["component_plans"][0]["source_html_artifact"] == "content:main:header.html"
    # Both pages emitted; sources point at the runner's outputs.
    contents = [c for c in cp["component_plans"] if c["role"] == "content"]
    assert len(contents) == 2
    src_artifacts = {c["source_html_artifact"] for c in contents}
    assert src_artifacts == {"content::page.html", "content:contact:page.html"}
    # design_system colors patched from resolved theme tokens.
    assert cp["design_system"]["primary_color"] == "#A8472A"

    # ── DecompositionResult counters ─────────────────────────────────
    assert result.pages_emitted == 2
    assert result.chrome_emitted == 1
    assert result.placeholders_transformed >= 3  # baseline preserved from ph_transformer test


# ── M3 palette completeness (production regression) ──────────────────────


async def test_runner_emits_full_m3_palette_from_pillars():
    """Production regression: with the four pillars set, the runner
    derives all 30 M3 tokens and the downstream resolver accepts the
    emitted theme.css without raising ``ThemePaletteResolutionError``.

    This is the exact path that previously terminal-failed the workflow
    between BackendBuilder and ComponentBuilder.
    """
    from main_agent.agents.orchestrator.app_types.webapp.services.theme_palette_service import (  # noqa: E501
        REQUIRED_THEME_PALETTE_TOKENS,
        resolve_theme_palette_snapshot,
    )

    ctx = _FakeCtx()
    _stage(
        ctx,
        "bundle:html:index.html",
        (
            "<!DOCTYPE html><html><head>"
            "<style>"
            ":root{--barn:#A8472A;--moss:#7B8B5C;--cream:#F5EFE2;--ink:#2A1F17}"
            ".hero{color:var(--ink);background:var(--cream)}"
            "</style>"
            "</head><body><div class='hero'>Welcome</div></body></html>"
        ),
    )

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:index.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        theme=ThemePlan(pillars=_default_pillars()),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    theme_css = ctx.artifact_service.blobs["codefocus_style:theme.css"].decode("utf-8")

    # All 30 REQUIRED tokens present.
    for bare_token in REQUIRED_THEME_PALETTE_TOKENS:
        assert (
            f"--color-{bare_token}:" in theme_css
        ), f"required token --color-{bare_token} missing from emitted theme.css"

    # Pillars resolved to the bundle's actual colors (NOT fabricated defaults).
    assert "--color-primary: #A8472A" in theme_css
    assert "--color-secondary: #7B8B5C" in theme_css
    assert "--color-surface: #F5EFE2" in theme_css

    snapshot = resolve_theme_palette_snapshot(
        theme_css,
        fallback_to_seed=False,
    )
    assert snapshot.source == "theme_css"
    assert snapshot.palette["primary"] == "#A8472A"
    assert snapshot.palette["secondary"] == "#7B8B5C"
    assert snapshot.palette["surface-dim"]
    assert snapshot.palette["inverse-surface"]
    assert snapshot.palette["outline"]


async def test_runner_accepts_literal_hex_pillars():
    """All four pillars may be literal ``#rrggbb`` values; no source --var
    lookups required. Useful when the bundle has no usable color tokens
    (e.g. a bundle whose stylesheet went missing) but the LLM still wants
    a coherent palette."""
    ctx = _FakeCtx()
    _stage(ctx, "bundle:html:index.html", "<html><body><div>x</div></body></html>")

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:index.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        theme=ThemePlan(
            pillars=M3Pillars(
                primary="#A8472A",
                secondary="#7B8B5C",
                surface="#F5EFE2",
                error="#DC2626",
            )
        ),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    theme = ctx.artifact_service.blobs["codefocus_style:theme.css"].decode("utf-8")
    assert "--color-primary: #A8472A" in theme
    assert "--color-secondary: #7B8B5C" in theme
    assert "--color-surface: #F5EFE2" in theme
    assert "--color-error: #DC2626" in theme


async def test_runner_rejects_pillar_pointing_at_missing_source_var():
    """Pillar references a ``--var`` name that isn't in the bundle's
    lifted tokens. Runner must raise HandlerError listing what hex-bearing
    source vars ARE available so the failure is actionable in one read."""
    ctx = _FakeCtx()
    _stage(
        ctx,
        "bundle:html:index.html",
        (
            "<!DOCTYPE html><html><head>"
            "<style>:root{--cream:#F5EFE2;--moss:#7B8B5C}"
            ".hero{background:var(--cream)}</style>"
            "</head><body><div class='hero'>x</div></body></html>"
        ),
    )

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:index.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        theme=ThemePlan(
            pillars=M3Pillars(
                primary="--barn",  # NOT in the bundle
                secondary="--moss",
                surface="--cream",
                error="#DC2626",
            )
        ),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    with pytest.raises(HandlerError) as excinfo:
        await run_design_decomposition(
            ctx,
            plan=plan,
            skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
        )
    msg = str(excinfo.value)
    # Names the offending pillar AND the value that didn't resolve.
    assert "primary" in msg
    assert "--barn" in msg
    # Lists the source vars that DID carry hex values, so it's actionable.
    assert "--cream" in msg
    assert "--moss" in msg


async def test_runner_rejects_pillar_pointing_at_non_hex_value():
    """Pillar resolves to a token whose value isn't a hex literal — e.g. a
    nested ``var(...)`` reference. compute_m3_palette only handles hex,
    so the runner refuses with a clear error."""
    ctx = _FakeCtx()
    _stage(
        ctx,
        "bundle:html:index.html",
        (
            "<!DOCTYPE html><html><head>"
            "<style>:root{--barn:var(--brand);--moss:#7B8B5C;--cream:#F5EFE2}"
            ".hero{background:var(--cream)}</style>"
            "</head><body><div class='hero'>x</div></body></html>"
        ),
    )

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:index.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        theme=ThemePlan(
            pillars=M3Pillars(
                primary="--barn",  # resolves to var(--brand), not a hex
                secondary="--moss",
                surface="--cream",
                error="#DC2626",
            )
        ),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    with pytest.raises(HandlerError, match="not a hex literal"):
        await run_design_decomposition(
            ctx,
            plan=plan,
            skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
        )


async def test_runner_preserves_authored_m3_tokens_over_derived():
    """Stitch fast path: when ``original_tokens`` already carries an M3
    token name verbatim (e.g. ``--color-surface-container-low: #F6F3ED``
    from the bundle's tailwind-config), the runner uses the authored hex
    instead of compute_m3_palette's derivation, preserving the design's
    hand-tuned palette."""
    ctx = _FakeCtx()
    # A page whose <style> fakes a Stitch-style palette in :root using
    # --color-* names directly. The lifter harvests these into root_vars.
    _stage(
        ctx,
        "bundle:html:index.html",
        (
            "<!DOCTYPE html><html><head><style>"
            ":root{"
            "--color-primary:#7a5900;"
            "--color-secondary:#5b6f4a;"
            "--color-surface:#f6f3ed;"
            "--color-error:#ba1a1a;"
            "--color-surface-container-low:#F6F3ED;"  # hand-tuned
            "--color-inverse-surface:#1F1A0E;"  # hand-tuned
            "}"
            ".hero{color:var(--color-primary)}"
            "</style></head><body><div class='hero'>x</div></body></html>"
        ),
    )

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:index.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        theme=ThemePlan(
            pillars=M3Pillars(
                primary="--color-primary",
                secondary="--color-secondary",
                surface="--color-surface",
                error="--color-error",
            )
        ),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    theme = ctx.artifact_service.blobs["codefocus_style:theme.css"].decode("utf-8")
    # Hand-tuned values win over compute_m3_palette derivation.
    assert "--color-surface-container-low: #F6F3ED" in theme
    assert "--color-inverse-surface: #1F1A0E" in theme
    # Pillars echo the bundle's authored values too.
    assert "--color-primary: #7a5900" in theme


# ── Stylesheet discovery (nested / missing / multi-candidate) ────────────


@pytest.mark.skipif(
    not CLAUDE_DESIGN_2.exists(),
    reason=f"fixture missing: {CLAUDE_DESIGN_2}",
)
async def test_runner_finds_stylesheet_under_nested_relpath():
    """Production regression: Claude Design exports often nest the
    stylesheet under a project folder, so the staged key is
    ``bundle:asset:<project>/styles.css`` rather than the top-level
    ``bundle:asset:styles.css`` the old hardcoded lookup expected.

    The handler now discovers the stylesheet by listing staged
    ``bundle:asset:*.css`` keys, so any path shape works.
    """
    ctx = _FakeCtx()
    nested_key = "bundle:asset:happydoods_farm/styles.css"
    _stage(ctx, nested_key, (CLAUDE_DESIGN_2 / "styles.css").read_text(), "text/css")
    _stage(
        ctx,
        "bundle:html:index.html",
        (CLAUDE_DESIGN_2 / "index.html").read_text(),
    )

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:index.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        theme=ThemePlan(pillars=_default_pillars()),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    theme = ctx.artifact_service.blobs["codefocus_style:theme.css"].decode("utf-8")
    # Both M3 and original tokens harvested from the nested stylesheet.
    assert "--color-primary: #A8472A" in theme
    assert "--barn:" in theme
    # styles.css class rules survive into the layer block.
    assert ".wrap" in theme
    assert ".nav" in theme


async def test_runner_handles_bundle_with_no_shared_stylesheet():
    """Production regression — modern Claude Design exports often ship NO
    shared stylesheet. Every design token + every class rule lives inside
    per-page ``<head><style>`` blocks (each page redundantly carrying the
    same ``:root`` declarations).

    The handler discovers no ``.css`` asset, proceeds with empty
    ``root_vars`` from the handler, and the lifter harvests ``:root``
    declarations from each page's inline ``<style>`` instead. The plan's
    pillars resolve those harvested vars onto M3 tokens.
    """
    ctx = _FakeCtx()
    # Two pages, each with its own <head><style> carrying the same :root
    # plus page-specific class rules. NO bundle:asset:*.css staged.
    page_one = (
        "<!DOCTYPE html><html><head>"
        "<style>"
        ":root{--brand:#aabbcc;--ink:#222}"
        ".hero{color:var(--brand);padding:48px}"
        "</style>"
        "</head><body><div class='hero'>Welcome</div></body></html>"
    )
    page_two = (
        "<!DOCTYPE html><html><head>"
        "<style>"
        ":root{--brand:#aabbcc;--ink:#222}"
        ".contact-grid{display:grid;gap:24px;color:var(--ink)}"
        "</style>"
        "</head><body><div class='contact-grid'>Form</div></body></html>"
    )
    _stage(ctx, "bundle:html:index.html", page_one)
    _stage(ctx, "bundle:html:contact.html", page_two)

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:index.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            ),
            PageMapping(
                bundle_artifact="bundle:html:contact.html",
                output_artifact="content:contact:page.html",
                page_slug="contact",
                page_route="/contact",
                page_title="Contact",
            ),
        ],
        theme=ThemePlan(
            # The plan's pillars reference page-level :root vars. The
            # runner resolves these against the lifter's harvested
            # root_vars (no shared stylesheet, but per-page :root blocks
            # populate the same dict).
            pillars=M3Pillars(
                primary="--brand",
                secondary="--brand",
                surface="#FFFFFF",
                error="#DC2626",
            )
        ),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    theme = ctx.artifact_service.blobs["codefocus_style:theme.css"].decode("utf-8")
    # Per-page :root tokens harvested by the lifter and mirrored into @theme.
    assert "--brand: #aabbcc" in theme
    assert "--ink: #222" in theme
    # Pillars resolved against per-page :root.
    assert "--color-primary: #aabbcc" in theme
    # Per-page class rules lifted into @layer exepad-app.
    assert ".hero" in theme
    assert ".contact-grid" in theme
    # The :root selector itself is removed from the layer block (extracted
    # to @theme). Split on the literal block opener so the comment that
    # mentions ``@layer exepad-app`` doesn't false-match.
    if "@layer exepad-app {" in theme:
        layer_body = theme.split("@layer exepad-app {", 1)[1]
        assert ":root" not in layer_body


async def test_runner_prefers_styles_css_when_multiple_css_assets_staged():
    """If a bundle stages multiple .css assets (e.g. ``styles.css`` plus a
    vendor ``reset.css``), the handler picks ``styles.css`` first — the
    canonical Claude Design export name."""
    ctx = _FakeCtx()
    _stage(
        ctx,
        "bundle:asset:project/reset.css",
        "*{box-sizing:border-box}",
        "text/css",
    )
    _stage(
        ctx,
        "bundle:asset:project/styles.css",
        ":root{--brand:#112233}.btn{padding:8px}",
        "text/css",
    )
    _stage(
        ctx,
        "bundle:html:index.html",
        "<html><body><button class='btn'>X</button></body></html>",
    )

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:index.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        theme=ThemePlan(
            pillars=M3Pillars(
                primary="--brand",
                secondary="--brand",
                surface="#FFFFFF",
                error="#DC2626",
            )
        ),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    theme = ctx.artifact_service.blobs["codefocus_style:theme.css"].decode("utf-8")
    # styles.css's --brand resolved into the primary pillar AND mirrored.
    assert "--color-primary: #112233" in theme
    assert "--brand:" in theme
    # styles.css's .btn rule preserved.
    assert ".btn" in theme


# ── Per-page <style> survival ─────────────────────────────────────────────


@pytest.mark.skipif(
    not CLAUDE_DESIGN_2.exists(),
    reason=f"fixture missing: {CLAUDE_DESIGN_2}",
)
async def test_runner_preserves_every_pages_inline_style_block():
    """Per-page ``<style>`` blocks (Claude Design embeds 4-14KB of CSS in
    each page's <head>) must all survive into ``codefocus_style:theme.css``
    inside ``@layer exepad-app``.

    The classes are page-distinctive (`.hero-card` from index, `.contact-grid`
    from contact, `.breed-stats` from flock, `.card-price` from shop). Every
    one must end up in the merged layer block, in cascade order: styles.css
    first, then page A, then page B, etc.

    This is the load-bearing test for "do per-page styles survive". After
    the runner finishes:
      * Each ``content:<slug>:page.html`` no longer contains its <style>
        (drop_styles=True default).
      * theme.css has every authored class rule from every page.
    """
    ctx = _FakeCtx()
    _stage(
        ctx,
        "bundle:asset:styles.css",
        (CLAUDE_DESIGN_2 / "styles.css").read_text(),
        "text/css",
    )
    pages_to_stage = {
        "index.html": "content::page.html",
        "contact.html": "content:contact:page.html",
        "shop.html": "content:shop:page.html",
        "flock.html": "content:flock:page.html",
    }
    for src in pages_to_stage:
        _stage(ctx, f"bundle:html:{src}", (CLAUDE_DESIGN_2 / src).read_text())

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact=f"bundle:html:{src}",
                output_artifact=out,
                page_slug=("" if src == "index.html" else src.replace(".html", "")),
                page_route=("/" if src == "index.html" else f"/{src.replace('.html', '')}"),
                page_title=src.replace(".html", "").title() or "Home",
            )
            for src, out in pages_to_stage.items()
        ],
        theme=ThemePlan(pillars=_default_pillars()),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    theme = ctx.artifact_service.blobs["codefocus_style:theme.css"].decode("utf-8")

    # styles.css contributions survive (the shared chrome rules):
    for cls in (".wrap", ".nav", ".btn", ".footer", ".eyebrow"):
        assert cls in theme, f"{cls} from styles.css missing"

    # Per-page distinctive classes survive — one from each page:
    page_specific = {
        "index.html": [".hero-card", ".hero-copy", ".cta-banner"],
        "contact.html": [".contact-grid", ".contact-card", ".faq-q"],
        "shop.html": [".card-img", ".card-price", ".filter-list"],
        "flock.html": [".breed-grid", ".breed-stats", ".egg-swatch"],
    }
    for page, classes in page_specific.items():
        for cls in classes:
            assert cls in theme, f"{cls} from {page}'s inline <style> missing from theme.css"

    # Cascade order: styles.css first, then pages in plan.pages order. We
    # don't byte-compare; we verify position. styles.css's `.wrap` must
    # come BEFORE each page's distinctive class.
    pos_wrap = theme.index(".wrap")
    pos_hero = theme.index(".hero-card")
    pos_contact = theme.index(".contact-grid")
    assert (
        pos_wrap < pos_hero < pos_contact
    ), "cascade order violated: styles.css must precede page styles"

    # Every page's <style> was stripped from its cleaned HTML output
    # (drop_styles=True default).
    for src, out_key in pages_to_stage.items():
        cleaned = ctx.artifact_service.blobs[out_key].decode("utf-8")
        assert "<style" not in cleaned, f"<style> tag leaked into cleaned {out_key}"


# ── Runtime font-token aliases ──────────────────────────────────────────────


async def test_runner_emits_runtime_font_aliases_when_design_system_fonts_present():
    """The runtime SPA's globals.css uses ``--font-heading`` / ``--font-sans``
    on bare ``<h1>...<h6>`` and the body. Code Focus themes emit
    ``--font-headline`` / ``--font-body`` (the design-system names). The
    runner must bridge the two so the runtime's heading rule resolves to
    the imported design's typography rather than falling through to the
    system stack.

    The bridge runs INSIDE the @theme block (where the source tokens
    live), so it survives Tailwind's compilation and is visible to the
    runtime's unlayered/base-layered selectors.
    """
    ctx = _FakeCtx()
    _stage(
        ctx,
        "bundle:html:index.html",
        (
            "<!DOCTYPE html><html><head>"
            "<style>"
            ":root{"
            "--barn:#A8472A;--moss:#7B8B5C;--cream:#F5EFE2;"
            '--font-headline:"Fraunces",serif;'
            '--font-body:"Inter",sans-serif'
            "}"
            ".hero{color:var(--barn);background:var(--cream);font-family:var(--font-headline)}"
            "</style>"
            "</head><body><div class='hero'>x</div></body></html>"
        ),
    )

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:index.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        theme=ThemePlan(pillars=_default_pillars()),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    theme = ctx.artifact_service.blobs["codefocus_style:theme.css"].decode("utf-8")

    # Source design-system tokens still present (mirrored into @theme).
    assert "--font-headline:" in theme
    assert "--font-body:" in theme
    # Runtime bridge aliases injected so unlayered globals.css rules resolve.
    assert "--font-heading: var(--font-headline);" in theme
    assert "--font-sans: var(--font-body);" in theme


async def test_runner_skips_alias_when_runtime_token_already_present():
    """If the imported bundle already declares ``--font-heading`` /
    ``--font-sans`` directly, the runner must NOT clobber them with
    `var(--font-headline)` aliases — that would create a circular
    reference if the design's intent was to use ``--font-heading``
    natively.
    """
    ctx = _FakeCtx()
    _stage(
        ctx,
        "bundle:html:index.html",
        (
            "<!DOCTYPE html><html><head>"
            "<style>"
            ":root{"
            "--barn:#A8472A;--moss:#7B8B5C;--cream:#F5EFE2;"
            '--font-headline:"Fraunces",serif;'
            '--font-heading:"Playfair Display",serif;'  # already set; do NOT overwrite
            "}"
            "</style>"
            "</head><body><div>x</div></body></html>"
        ),
    )

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:index.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        theme=ThemePlan(pillars=_default_pillars()),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    theme = ctx.artifact_service.blobs["codefocus_style:theme.css"].decode("utf-8")

    # Original `--font-heading` preserved verbatim (no alias overwrite).
    assert "Playfair Display" in theme
    # And no runtime-bridge alias line appears for --font-heading.
    assert "--font-heading: var(--font-headline);" not in theme


async def test_runner_omits_aliases_when_no_design_system_fonts():
    """If the bundle has no ``--font-headline`` / ``--font-body``, no
    alias lines should be emitted — pointing ``--font-heading`` at an
    undefined `var()` would just propagate the same fallback bug.
    """
    ctx = _FakeCtx()
    _stage(
        ctx,
        "bundle:html:index.html",
        (
            "<!DOCTYPE html><html><head>"
            "<style>"
            ":root{--barn:#A8472A;--moss:#7B8B5C;--cream:#F5EFE2}"
            "</style>"
            "</head><body><div>x</div></body></html>"
        ),
    )

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:index.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        theme=ThemePlan(pillars=_default_pillars()),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    theme = ctx.artifact_service.blobs["codefocus_style:theme.css"].decode("utf-8")

    # No design-system font tokens → no aliases.
    assert "--font-heading: var(--font-headline);" not in theme
    assert "--font-sans: var(--font-body);" not in theme


# ── Bare-typography rules survive into @layer base ──────────────────────────


async def test_runner_emits_design_typography_in_base_layer():
    """Source ``h1, h2, h3, h4 { font-family / font-weight / ... }`` rules
    encode the imported design's heading typography defaults. The runner
    must lift them into ``@layer base`` so bare ``<h1>...<h6>`` get the
    design's weight + variation settings — without overriding
    component-level Tailwind utility classes (which sit in
    ``@layer utilities``, declared after ``base``)."""
    ctx = _FakeCtx()
    _stage(
        ctx,
        "bundle:html:index.html",
        (
            "<!DOCTYPE html><html><head>"
            "<style>"
            ":root{--barn:#A8472A;--moss:#7B8B5C;--cream:#F5EFE2;--ink:#2A1F17}"
            "h1, h2, h3, h4 {"
            "  font-family: var(--serif);"
            "  font-weight: 500;"
            "  letter-spacing: -0.01em;"
            "  line-height: 1.05;"
            "  color: var(--ink);"
            "  text-wrap: balance;"
            "}"
            "h1 { font-size: clamp(48px, 7vw, 96px); "
            '     font-variation-settings: "opsz" 144, "SOFT" 80; }'
            "h2 { font-size: clamp(36px, 4.5vw, 64px); "
            '     font-variation-settings: "opsz" 96, "SOFT" 60; }'
            ".pagehead h1 { font-size: clamp(48px, 6vw, 88px); margin-bottom: 16px; }"
            "</style>"
            "</head><body><div class='hero'>x</div></body></html>"
        ),
    )

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:index.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        theme=ThemePlan(pillars=_default_pillars()),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    theme = ctx.artifact_service.blobs["codefocus_style:theme.css"].decode("utf-8")

    # The @layer base block was emitted with the design's typography defaults.
    assert "@layer base {" in theme
    assert "font-weight: 500" in theme
    assert "letter-spacing: -0.01em" in theme
    assert 'font-variation-settings: "opsz" 144' in theme
    assert 'font-variation-settings: "opsz" 96' in theme

    # Cascade order in the output: @theme → @layer base → @layer exepad-app.
    pos_theme = theme.index("@theme {")
    pos_base = theme.index("@layer base {")
    pos_exepad = theme.index("@layer exepad-app {")
    assert pos_theme < pos_base < pos_exepad

    # Compound .pagehead h1 stays in @layer exepad-app where it belongs.
    pos_pagehead = theme.index(".pagehead h1")
    assert pos_pagehead > pos_exepad


# ── Babel-shell pages emit content:<slug>:script.jsx ─────────────────────────


_BABEL_SHELL_HTML_TEMPLATE = """\
<!doctype html><html><body>
  <div id="root"></div>
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
{scripts}
</body></html>
"""


def _babel_shell_html(jsx_srcs: tuple[str, ...]) -> str:
    """Build the minimal HTML that triggers detect_babel_shell (A+B+C)."""
    scripts = "\n".join(
        f'  <script type="text/babel" src="{src}"></script>' for src in jsx_srcs
    )
    return _BABEL_SHELL_HTML_TEMPLATE.format(scripts=scripts)


_HEX_PILLARS = M3Pillars(
    primary="#A8472A",
    secondary="#7B8B5C",
    surface="#F5EFE2",
    error="#DC2626",
)


async def test_runner_emits_script_artifact_for_babel_shell_page():
    """Single Babel-shell page produces content::script.jsx with concat
    + banners + source_jsx_artifact set on the synthesized component_plan."""
    ctx = _FakeCtx()
    _stage(ctx, "bundle:html:index.html", _babel_shell_html(("game.jsx",)))
    _stage(
        ctx,
        "bundle:script:game.jsx",
        "function Game(){return <div>play</div>;}\n"
        "ReactDOM.render(<Game/>, document.getElementById('root'));",
        mime="text/jsx",
    )

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:index.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        theme=ThemePlan(pillars=_HEX_PILLARS),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    result = await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    # The script artifact was saved at the expected key.
    assert "content::script.jsx" in ctx.artifact_service.blobs
    body = ctx.artifact_service.blobs["content::script.jsx"].decode("utf-8")
    assert "// === game.jsx ===" in body
    assert "function Game()" in body
    assert "ReactDOM.render" in body  # bootstrap not stripped here — that's PR 3's job
    assert ctx.artifact_service.mimes["content::script.jsx"] == "text/jsx"

    # source_jsx_artifact is wired into the synthesized component_plan.
    cps = result.synthesized_creator_plan["component_plans"]
    assert len(cps) == 1
    assert cps[0]["source_jsx_artifact"] == "content::script.jsx"
    assert cps[0]["source_html_artifact"] == "content::page.html"

    # Emitted in the result manifest too (post-condition allow-list passed).
    assert "content::script.jsx" in result.emitted_artifact_keys


async def test_runner_skips_script_emission_for_non_babel_html_page():
    """Plain HTML pages don't trigger detection — no script artifact, no
    source_jsx_artifact in the synthesized plan."""
    ctx = _FakeCtx()
    _stage(
        ctx,
        "bundle:html:index.html",
        "<html><body><header>Site</header><main><p>Hi</p></main></body></html>",
    )

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:index.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        theme=ThemePlan(pillars=_HEX_PILLARS),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    result = await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    assert "content::script.jsx" not in ctx.artifact_service.blobs
    assert all("script.jsx" not in k for k in result.emitted_artifact_keys)
    assert "source_jsx_artifact" not in result.synthesized_creator_plan["component_plans"][0]


async def test_runner_dedupes_identical_script_blobs_across_pages():
    """Two pages referencing identical sibling JSX share one script
    artifact (the Platformer fixture pattern: Bloop World + Kub Quest
    both load the same game.jsx)."""
    ctx = _FakeCtx()
    _stage(ctx, "bundle:html:Bloop World.html", _babel_shell_html(("game.jsx",)))
    _stage(ctx, "bundle:html:Kub Quest.html", _babel_shell_html(("game.jsx",)))
    _stage(
        ctx,
        "bundle:script:game.jsx",
        "function Game(){return <div/>;}\n"
        "ReactDOM.render(<Game/>, document.getElementById('root'));",
        mime="text/jsx",
    )

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:Bloop World.html",
                output_artifact="content:bloop-world:page.html",
                page_slug="bloop-world",
                page_route="/bloop-world",
                page_title="Bloop World",
            ),
            PageMapping(
                bundle_artifact="bundle:html:Kub Quest.html",
                output_artifact="content:kub-quest:page.html",
                page_slug="kub-quest",
                page_route="/kub-quest",
                page_title="Kub Quest",
            ),
        ],
        theme=ThemePlan(pillars=_HEX_PILLARS),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    result = await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    # The first page emits the script artifact; the second reuses it.
    # Only one content:*:script.jsx blob exists in the store.
    script_blobs = [k for k in ctx.artifact_service.blobs if k.endswith("script.jsx")]
    assert script_blobs == ["content:bloop-world:script.jsx"]

    # Both component_plans point at the same artifact (dedupe target).
    cps = result.synthesized_creator_plan["component_plans"]
    by_slug = {cp["page_slug"]: cp for cp in cps if cp["role"] == "content"}
    assert by_slug["/bloop-world"]["source_jsx_artifact"] == "content:bloop-world:script.jsx"
    assert by_slug["/kub-quest"]["source_jsx_artifact"] == "content:bloop-world:script.jsx"

    # emitted_artifact_keys lists the dedupe target ONCE — second page's
    # reuse is not a separate emission.
    assert result.emitted_artifact_keys.count("content:bloop-world:script.jsx") == 1
    assert "content:kub-quest:script.jsx" not in result.emitted_artifact_keys


async def test_runner_emits_separate_script_artifacts_for_distinct_blobs():
    """Two pages with different JSX content produce two distinct artifacts."""
    ctx = _FakeCtx()
    _stage(ctx, "bundle:html:home.html", _babel_shell_html(("a.jsx",)))
    _stage(ctx, "bundle:html:about.html", _babel_shell_html(("b.jsx",)))
    _stage(
        ctx,
        "bundle:script:a.jsx",
        "function A(){return <i/>;} ReactDOM.render(<A/>, root);",
        mime="text/jsx",
    )
    _stage(
        ctx,
        "bundle:script:b.jsx",
        "function B(){return <i/>;} ReactDOM.render(<B/>, root);",
        mime="text/jsx",
    )

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:home.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            ),
            PageMapping(
                bundle_artifact="bundle:html:about.html",
                output_artifact="content:about:page.html",
                page_slug="about",
                page_route="/about",
                page_title="About",
            ),
        ],
        theme=ThemePlan(pillars=_HEX_PILLARS),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    result = await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    script_blobs = sorted(k for k in ctx.artifact_service.blobs if k.endswith("script.jsx"))
    assert script_blobs == ["content::script.jsx", "content:about:script.jsx"]

    cps = {cp["page_slug"]: cp for cp in result.synthesized_creator_plan["component_plans"]}
    assert cps["/"]["source_jsx_artifact"] == "content::script.jsx"
    assert cps["/about"]["source_jsx_artifact"] == "content:about:script.jsx"


async def test_runner_concats_external_then_inline_in_dom_order():
    """Anima pattern: many external siblings + final inline App block.
    The concat must put inline AFTER external so React component
    references resolve when Babel-in-browser would have run them."""
    ctx = _FakeCtx()
    inline_app = (
        '<script type="text/babel">'
        "function App(){return <Lib/>;}"
        "ReactDOM.createRoot(document.getElementById('root')).render(<App/>);"
        "</script>"
    )
    html = _BABEL_SHELL_HTML_TEMPLATE.format(
        scripts='  <script type="text/babel" src="lib.jsx"></script>\n  ' + inline_app
    )
    _stage(ctx, "bundle:html:index.html", html)
    _stage(
        ctx,
        "bundle:script:lib.jsx",
        "function Lib(){return <div>library</div>;}",
        mime="text/jsx",
    )

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:index.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        theme=ThemePlan(pillars=_HEX_PILLARS),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    body = ctx.artifact_service.blobs["content::script.jsx"].decode("utf-8")
    # Order: lib.jsx banner first, inline banner second.
    pos_lib_banner = body.index("// === lib.jsx ===")
    pos_inline_banner = body.index("// === [inline #1] from index.html ===")
    assert pos_lib_banner < pos_inline_banner
    # Both bodies are present.
    assert "function Lib()" in body
    assert "function App()" in body
    assert "ReactDOM.createRoot" in body


async def test_runner_appends_missing_jsx_siblings_to_notes():
    """When a Babel-shell page references a JSX file the user didn't
    upload, the runner soft-fails and surfaces the missing file in
    design_import/notes.md so the user can re-upload."""
    ctx = _FakeCtx()
    _stage(
        ctx, "bundle:html:home.html", _babel_shell_html(("present.jsx", "absent.jsx"))
    )
    _stage(
        ctx,
        "bundle:script:present.jsx",
        "function Present(){return <i/>;} ReactDOM.render(<Present/>, root);",
        mime="text/jsx",
    )
    # absent.jsx intentionally not staged.

    plan = DecompositionPlan(
        format="claude_design",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:home.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        theme=ThemePlan(pillars=_HEX_PILLARS),
        navigation={"routes": [], "default": ""},
        creator_plan=_build_minimal_creator_plan([]),  # type: ignore[arg-type]
    )

    result = await run_design_decomposition(
        ctx,
        plan=plan,
        skill_context={"skill_name": "claude-design-importer", "mode": "multi_page"},
    )

    notes = ctx.artifact_service.blobs["design_import/notes.md"].decode("utf-8")
    assert "## Missing JSX siblings" in notes
    assert "absent.jsx" in notes
    # Soft-fail confirmed: present.jsx still made it into the script artifact.
    assert "content::script.jsx" in ctx.artifact_service.blobs
    body = ctx.artifact_service.blobs["content::script.jsx"].decode("utf-8")
    assert "function Present()" in body
    # The result's notes payload also surfaces the warning so callers
    # don't have to re-read the artifact.
    assert "Missing JSX siblings" in result.notes_with_appended_warnings
    assert "absent.jsx" in result.notes_with_appended_warnings
