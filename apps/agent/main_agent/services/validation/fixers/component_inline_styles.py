"""Deterministic auto-fixer for inline JSX ``style={{...}}`` object keys.

Design-import translation (MODE A) frequently surfaces source HTML with
``style="font-family:var(--mono); letter-spacing:0.1em; ..."`` attributes.
The LLM faithfully converts the wrapping syntax to JSX (``style={{...}}``)
but copies the property names verbatim — ``letter-spacing: "0.1em"`` is a
JS syntax error (esbuild rejects with ``Expected "}" but found "-"``).

This fixer runs the deterministic kebab→camel rewrite so the syntax check
passes without burning an LLM regeneration round. Two patterns handled:

1. **Kebab key in JSX object literal** — bare or quoted::

       style={{ letter-spacing: "0.1em" }}        → style={{ letterSpacing: "0.1em" }}
       style={{ "letter-spacing": "0.1em" }}      → style={{ letterSpacing: "0.1em" }}

2. **HTML-attribute-form style strings** — leftover from verbatim copy::

       style="font-size:11px; letter-spacing:0.1em"
       → style={{ fontSize: '11px', letterSpacing: '0.1em' }}

Scope is intentionally narrow — only ``style=`` attributes are touched.
Other object literals (handler args, theme constants) are left alone.
"""

from __future__ import annotations

import re

from main_agent.services.validation.fixers._context import FixContext

_STYLE_OBJECT_RE = re.compile(r"style=\{\{")
_STYLE_STRING_RE = re.compile(r"""style=("[^"]*"|'[^']*')""")

# A kebab-case identifier (e.g. ``letter-spacing``, ``-webkit-transform``).
# Includes optional leading ``-`` for vendor prefixes. Must contain at least
# one internal hyphen.
_KEBAB_KEY_RE = re.compile(r"(-?[a-zA-Z]+(?:-[a-zA-Z]+)+)")


def _kebab_to_camel(kebab: str) -> str:
    """Convert ``letter-spacing`` → ``letterSpacing``.

    Vendor-prefix forms (``-webkit-transform``) become ``WebkitTransform``
    per React's documented convention (capitalize the vendor segment).
    """
    if kebab.startswith("-"):
        # Vendor prefix: -webkit-transform → WebkitTransform
        parts = kebab[1:].split("-")
        return "".join(p.capitalize() for p in parts if p)
    parts = kebab.split("-")
    return parts[0] + "".join(p.capitalize() for p in parts[1:] if p)


def _find_style_object_end(tsx: str, start: int) -> int:
    """Return the index just past the matching ``}}`` for ``style={{`` at ``start``.

    ``start`` points to the character after the second ``{``. Scans
    forward tracking brace depth and skipping string literals and template
    literals so a brace inside a string doesn't fool us. Returns ``-1`` if
    no balanced close is found within ``len(tsx)``.
    """
    i = start
    depth = 1  # we're already inside the inner object
    n = len(tsx)
    while i < n:
        c = tsx[i]
        if c == "{":
            depth += 1
            i += 1
        elif c == "}":
            depth -= 1
            i += 1
            if depth == 0:
                # Need the OUTER `}` too (the JSX expression wrapper).
                if i < n and tsx[i] == "}":
                    return i + 1
                # Mis-balanced — bail.
                return -1
        elif c in ('"', "'", "`"):
            quote = c
            i += 1
            while i < n:
                if tsx[i] == "\\":
                    i += 2
                    continue
                if tsx[i] == quote:
                    i += 1
                    break
                i += 1
        else:
            i += 1
    return -1


def _rewrite_kebab_keys_in_object(body: str) -> tuple[str, int]:
    """Inside the body of a ``style={{...}}`` object literal, rewrite kebab
    property names to camelCase.

    Handles both bare-identifier kebab keys (``letter-spacing: ...``) and
    quoted kebab keys (``"letter-spacing": ...``). Returns ``(new_body,
    n_fixes)``.
    """
    fixes = 0

    # 1) Quoted-key form: "letter-spacing": ...  →  letterSpacing: ...
    def _quoted(m: re.Match) -> str:
        nonlocal fixes
        quoted_key = m.group(1)
        camel = _kebab_to_camel(quoted_key)
        # Only count as a fix if conversion changed it.
        if camel != quoted_key:
            fixes += 1
        return f"{camel}{m.group(2)}"

    body = re.sub(
        r'"(-?[a-zA-Z]+(?:-[a-zA-Z]+)+)"(\s*:)',
        _quoted,
        body,
    )
    body = re.sub(
        r"'(-?[a-zA-Z]+(?:-[a-zA-Z]+)+)'(\s*:)",
        _quoted,
        body,
    )

    # 2) Bare-identifier form: letter-spacing: ...  →  letterSpacing: ...
    # Must be at a key position: at start-of-body OR preceded by ``,`` /
    # ``{`` (the inner object brace gets eaten by the outer scanner so
    # the first key sits at the body's start). Lookbehind keeps the
    # match anchored without consuming the comma/brace.
    def _bare(m: re.Match) -> str:
        nonlocal fixes
        leading_ws = m.group(1)
        kebab = m.group(2)
        suffix = m.group(3)
        camel = _kebab_to_camel(kebab)
        if camel != kebab:
            fixes += 1
        return f"{leading_ws}{camel}{suffix}"

    body = re.sub(
        r"(?:^|(?<=[\{,]))(\s*)(-?[a-zA-Z]+(?:-[a-zA-Z]+)+)(\s*:)",
        _bare,
        body,
    )

    return body, fixes


def _convert_style_string_to_object(value: str) -> str | None:
    """Convert a ``style="..."`` HTML-attribute string into ``style={{...}}``.

    Returns the new ``style={{ ... }}`` text, or ``None`` if the input
    can't be safely parsed (e.g. contains ``${`` template syntax or
    embedded JSX expressions).
    """
    inner = value[1:-1]  # strip surrounding quotes
    if not inner.strip():
        return "style={{}}"
    # Refuse to convert if it looks like it contains template literals or
    # JSX-expression sigils — we'd need a real parser for those.
    if "${" in inner or "<" in inner:
        return None

    pairs: list[str] = []
    for raw in inner.split(";"):
        decl = raw.strip()
        if not decl:
            continue
        if ":" not in decl:
            return None  # malformed; let the LLM handle it
        key, _, val = decl.partition(":")
        key = key.strip()
        val = val.strip()
        if not key or not val:
            return None
        camel = _kebab_to_camel(key)
        # Try a numeric pixel value (`14px` → 14, but only when no unit besides
        # px and the value is purely numeric). Otherwise quote as a string.
        m = re.fullmatch(r"(-?\d+(?:\.\d+)?)(px)?", val)
        if m and m.group(2) == "px":
            pairs.append(f"{camel}: '{val}'")
        elif re.fullmatch(r"-?\d+(?:\.\d+)?", val):
            # Bare number (opacity: 0.6) — keep numeric.
            pairs.append(f"{camel}: {val}")
        else:
            # Escape any single-quotes already in the value.
            escaped = val.replace("'", "\\'")
            pairs.append(f"{camel}: '{escaped}'")
    return "style={{ " + ", ".join(pairs) + " }}"


def apply_component_inline_styles_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    """Rewrite kebab-case keys in ``style={{...}}`` and convert any
    ``style="..."`` strings to JSX objects.

    Idempotent — running twice produces the same output. Safe to call as
    a syntax-fail recovery hook (no dependence on a parsed AST).
    """
    # ── Pass 1: convert ``style="..."`` HTML-attribute strings to
    # ``style={{...}}`` JSX objects. We do this first so pass 2 can also
    # normalize any kebab keys inside the just-emitted object.
    string_fixes = 0

    def _replace_style_string(m: re.Match) -> str:
        nonlocal string_fixes
        converted = _convert_style_string_to_object(m.group(1))
        if converted is None:
            return m.group(0)
        string_fixes += 1
        return converted

    tsx = _STYLE_STRING_RE.sub(_replace_style_string, tsx)
    if string_fixes:
        fixes_applied.append(
            f'Inline styles: converted {string_fixes} HTML-form `style="..."` '
            f"attribute(s) to JSX `style={{{{...}}}}` objects"
        )

    # ── Pass 2: scan ``style={{...}}`` blocks and rewrite kebab-case
    # property names (bare or quoted) to camelCase. Paren-balanced scan
    # avoids matching across element boundaries.
    out: list[str] = []
    cursor = 0
    total_kebab_fixes = 0

    for match in _STYLE_OBJECT_RE.finditer(tsx):
        body_start = match.end()  # position right after the inner ``{``
        # Locate the matching ``}}`` — strict end-of-object marker.
        full_end = _find_style_object_end(tsx, body_start)
        if full_end < 0:
            # Unbalanced — leave the rest untouched and stop scanning.
            break
        body_end = full_end - 2  # exclude the closing ``}}``
        body = tsx[body_start:body_end]
        new_body, fixes_here = _rewrite_kebab_keys_in_object(body)
        out.append(tsx[cursor:body_start])
        out.append(new_body)
        out.append(tsx[body_end:full_end])
        cursor = full_end
        total_kebab_fixes += fixes_here

    if cursor:
        out.append(tsx[cursor:])
        tsx = "".join(out)

    if total_kebab_fixes:
        fixes_applied.append(
            f"Inline styles: rewrote {total_kebab_fixes} kebab-case "
            f"property name(s) in `style={{{{...}}}}` objects to camelCase"
        )

    return tsx
