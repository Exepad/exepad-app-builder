"""HTML inline ``style="..."`` → JSX ``style={{...}}`` converter.

Built on ``tinycss2.parse_declaration_list`` so that ``url("data:...;...")``
values with embedded semicolons survive the split — naive
``value.split(';')`` would shred them.

Rules (kept aligned with the existing post-hoc fixer at
``services/validation/fixers/component_inline_styles.py:42-149`` so the
JSX style objects look identical regardless of which path emits them):

1. Property names: kebab-case → camelCase
   - ``letter-spacing`` → ``letterSpacing``
   - ``font-size`` → ``fontSize``
2. Vendor prefixes: leading ``-`` capitalizes the first segment too
   - ``-webkit-transform`` → ``WebkitTransform``
   - ``-moz-user-select`` → ``MozUserSelect``
3. Custom properties (``--my-token``) pass through verbatim as a
   quoted string key inside the JSX object
4. Values: NEVER coerce. Every value emits as a quoted JS string.
   This keeps ``var(--accent)``, ``clamp(44px, 7.2vw, 112px)``,
   ``cubic-bezier(.2,.7,.1,1)``, animation shorthand, and gradient
   functions byte-stable.
5. Empty / unparseable input → ``style={{}}`` (empty object)
6. Idempotent — running on already-camel JSX produces equivalent
   output. The transformer pipeline only runs this on raw HTML
   ``style="..."`` strings; the post-hoc fixer handles already-
   emitted JSX cases.

Public entry: :func:`convert_inline_style`.
"""

from __future__ import annotations

import tinycss2


def convert_inline_style(value: str) -> str:
    """Convert an HTML ``style="..."`` attribute value to a JSX
    ``style={{ ... }}`` literal.

    Args:
        value: The contents of the HTML ``style`` attribute (without
            the surrounding quotes), e.g. ``"font-size:11px; opacity:0.6"``.

    Returns:
        A complete JSX attribute fragment, e.g.
        ``style={{ fontSize: '11px', opacity: '0.6' }}``. Returns
        ``style={{}}`` for empty input or when every declaration was
        unparseable.
    """
    inner = value.strip()
    if not inner:
        return "style={{}}"

    # tinycss2 handles ``url("data:...;...")`` semicolons natively.
    # ``parse_declaration_list`` is the right entry point for the
    # contents of a ``style`` attribute.
    nodes = tinycss2.parse_declaration_list(inner)

    pairs: list[str] = []
    for node in nodes:
        if node.type != "declaration":
            # Whitespace, comments, parse errors all skip silently.
            continue
        prop = node.lower_name
        # Reconstruct the value verbatim — preserves data-URIs,
        # gradients, `var()` calls, calc() expressions, etc.
        value_text = tinycss2.serialize(node.value).strip()
        if not value_text:
            continue
        if node.important:
            value_text = f"{value_text} !important"

        jsx_key = _kebab_to_jsx_key(prop)
        jsx_value = _quote_css_value(value_text)
        pairs.append(f"{jsx_key}: {jsx_value}")

    if not pairs:
        return "style={{}}"
    return "style={{ " + ", ".join(pairs) + " }}"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _kebab_to_jsx_key(prop: str) -> str:
    """Convert a CSS property name to its JSX object key form.

    - Standard kebab → camel: ``font-size`` → ``fontSize``
    - Vendor prefix (leading ``-``): ``-webkit-transform`` →
      ``WebkitTransform`` (capitalize the vendor segment too — React
      convention).
    - Custom property (leading ``--``): emit as quoted string key
      ``"--my-token"`` (must be quoted because JSX/JS identifiers
      can't start with ``--``).
    """
    if prop.startswith("--"):
        return f'"{prop}"'

    if prop.startswith("-"):
        # Vendor prefix: -webkit-transform → WebkitTransform
        parts = prop[1:].split("-")
        return "".join(p.capitalize() for p in parts if p)

    parts = prop.split("-")
    return parts[0] + "".join(p.capitalize() for p in parts[1:] if p)


def _quote_css_value(value: str) -> str:
    """Wrap a CSS value in JSX-safe single quotes.

    Values are NEVER coerced to numbers — keeps ``opacity: '0.6'`` as
    a string for byte-stability across the transformer and the
    post-hoc fixer. Embedded ``'`` characters are escaped.

    The CSS value may legitimately contain double quotes (data-URIs,
    font-family names like ``"Inter"``). Use single-quote wrapping by
    default, switch to escaped double-quote wrapping when the value
    contains a literal single quote.
    """
    has_dq = '"' in value
    has_sq = "'" in value

    if has_sq and not has_dq:
        return f'"{value}"'

    if has_sq and has_dq:
        # Mixed quotes — single-quote wrap and escape the embedded
        # single quotes. Escape any backslashes first to avoid
        # double-escaping.
        escaped = value.replace("\\", "\\\\").replace("'", "\\'")
        return f"'{escaped}'"

    # Default: single-quote wrap. Embedded double quotes are fine.
    return f"'{value}'"
