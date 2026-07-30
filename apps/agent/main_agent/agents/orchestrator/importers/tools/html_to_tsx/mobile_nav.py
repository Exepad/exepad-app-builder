"""Inject the mobile-nav scaffold into header components.

Marketing-page imports usually ship desktop-only navigation; the
runtime serves the result on mobile too, so the mechanical pipeline
adds a hamburger toggle + full-screen overlay scaffold to make the
nav usable. The pattern matches the LLM-generated reference at
``MainHeader_*.tsx`` (see Onix Studio's MainHeader for the canonical
shape):

* `useState(false)` for ``isMobileMenuOpen`` plus a ``useEffect`` that
  locks ``document.body.style.overflow`` while the menu is open.
* The original ``<nav>``'s class list gets ``hidden lg:flex``
  prepended so it disappears below the ``lg`` breakpoint.
* A hamburger ``<button>`` appears immediately after the nav with
  ``Icons.Menu`` (or ``Icons.X`` when open).
* When ``isMobileMenuOpen`` is true, a full-screen overlay (`fixed
  inset-0 z-[60]`) renders with a close button and a clone of the
  nav children for navigation.

Triggered when:
* ``ctx.component_role == "header"`` AND
* The walker's emitted JSX contains at least one ``<nav>`` tag.

Idempotent:
* If the emitted JSX already contains the scaffold's signature (
  ``setIsMobileMenuOpen``), the rule is a no-op.

Public entry: :func:`maybe_inject_mobile_nav_scaffold`.
"""

from __future__ import annotations

import re

from .wiring.context import WiringContext

_NAV_OPEN_RE = re.compile(r"<nav\b([^>]*)>")
_CLASSNAME_RE = re.compile(r'className="([^"]*)"')

# Visibility utilities that gate an element's display on viewport width.
# The mobile-nav scaffold owns visibility for the nav family (desktop nav
# hidden below `lg`, drawer always visible inside its overlay), so any
# breakpoint-gated visibility class the source ships with would conflict.
#
# Matches THREE patterns, all preceded by start-of-string/whitespace
# (negative lookbehind for `:` so we don't break inside a Tailwind variant
# like `sm:hidden`):
#   (a) `hidden {bp}:{flex|block|grid|inline-*}` — the canonical
#       "hide-then-show" Tailwind v3 pattern this rule was written for.
#   (b) `{bp}:hidden` — the responsive "hide ONLY at this breakpoint"
#       form. We also strip these because the scaffold takes full
#       ownership of nav visibility; leaving any responsive `hidden`
#       would compose with `hidden lg:flex` in surprising ways.
#   (c) bare `hidden` token (no breakpoint after) — same reason.
#
# Past bug: an earlier version of pattern (a) used `\bhidden\s+...` which
# also greedily matched the trailing `hidden` of `sm:hidden md:flex`,
# leaving a dangling `sm:` prefix. The leading `(?<!:)(?<!\S)` lookbehind
# enforces that the `hidden` we're stripping is its OWN token, not the
# tail of a variant chain.
_VISIBILITY_BREAKPOINT_RE = re.compile(
    r"(?<!:)(?<!\S)hidden\s+(?:sm|md|lg|xl|2xl):"
    r"(?:flex|block|grid|inline|inline-flex|inline-block|inline-grid)\b"
)
_VARIANT_HIDDEN_RE = re.compile(
    r"(?<!\S)(?:sm|md|lg|xl|2xl):hidden\b"
)
_BARE_HIDDEN_RE = re.compile(r"(?<!\S)hidden(?!\S|-|:)")

# Bare display utilities (no breakpoint or variant prefix) that conflict
# with the scaffold's injected ``hidden lg:flex``. Used ONLY in the
# desktop-nav injection path (not in drawer-child cloning, which
# legitimately keeps bare ``flex``/``grid``). Longest-first alternation
# is defensive — ``(?!\S)`` already prevents matching ``inline`` inside
# ``inline-block`` (next char is `-`, which is `\S`), but explicit
# ordering keeps the regex readable. Past regression: chick_farm /
# rdzn62gx (2026-05-16) — the scaffold prepended ``hidden lg:flex`` to a
# source ``<nav class="flex justify-between...">`` without scrubbing the
# existing ``flex``, producing ``hidden lg:flex flex justify-between``
# where bare ``flex`` wins over ``hidden`` in CSS cascade → nav always
# visible at every viewport, mobile button rendered alongside → chaos.
_BARE_DISPLAY_RE = re.compile(
    r"(?<!\S)(?:inline-flex|inline-block|inline-grid|inline|flex|grid|block)(?!\S)"
)

_PREAMBLE = """\
const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
React.useEffect(() => {
  if (isMobileMenuOpen) {
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }
  return () => {
    document.body.style.overflow = "";
  };
}, [isMobileMenuOpen]);"""


def maybe_inject_mobile_nav_scaffold(jsx_body: str, ctx: WiringContext) -> str:
    """Inject the mobile-nav scaffold into ``jsx_body`` if applicable.

    Args:
        jsx_body: The JSX body emitted by the walker.
        ctx: The wiring context. Mutated in-place — the function adds
            entries to ``ctx.function_preamble`` and
            ``ctx.sdk_imports`` when the scaffold fires.

    Returns:
        The modified JSX body. Unchanged when the rule doesn't apply.
    """
    if ctx.component_role != "header":
        return jsx_body

    if "setIsMobileMenuOpen" in jsx_body:
        # Already present — likely from a previous run or
        # source-authored mobile nav. Idempotent skip.
        return jsx_body

    open_match = _NAV_OPEN_RE.search(jsx_body)
    if open_match is None:
        return jsx_body

    nav_open_start, nav_open_end = open_match.span()
    nav_attrs_text = open_match.group(1)

    close_span = _find_matching_close(jsx_body, nav_open_end, "nav")
    if close_span is None:
        return jsx_body
    close_start, close_end = close_span

    nav_children = jsx_body[nav_open_end:close_start]

    # Prepend ``hidden lg:flex`` to the nav's className.
    # FIRST strip any source-supplied breakpoint visibility class
    # (`hidden md:flex`, `hidden lg:block`, …) AND any bare display
    # utility (`flex`, `inline-flex`, `block`, `grid`, …). Otherwise the
    # result is two competing display rules (e.g. `hidden lg:flex flex
    # justify-between`) — bare `flex` wins in cascade and the nav stays
    # visible at every viewport. Past regressions:
    #   * chick_farm MainHeader (RC#8a, app w4hov6ht 2026-05-16) ran
    #     visibility-only scrub: lg:-vs-md: collision hid the nav at
    #     768-1023px.
    #   * rdzn62gx HeroSection (2026-05-16) ran the visibility-only
    #     scrub: shipped `hidden lg:flex flex …` → nav visible at every
    #     viewport, drawer button rendered alongside.
    sanitized_nav_attrs = _strip_display_and_visibility_classes(nav_attrs_text)
    new_open = "<nav " + _prepend_classname(sanitized_nav_attrs, "hidden lg:flex").strip() + ">"
    new_open = new_open.replace("<nav  ", "<nav ")  # collapse double spaces

    # Build the scaffold (button + overlay) that follows the nav. The
    # children cloned into the drawer must ALSO have breakpoint visibility
    # classes stripped — the drawer always shows its contents when open,
    # regardless of viewport width. Past regression: chick_farm
    # MainHeader's mobile drawer (RC#8b) cloned a source `<div
    # className="hidden md:flex ...">` wrapper around the nav links; once
    # cloned into the drawer that wrapper hid the items at <md (which is
    # the only width the drawer can possibly be open at, since `lg:hidden`
    # closes it at ≥lg). Net effect: the drawer rendered blank.
    drawer_nav_children = _strip_visibility_classes_in_classnames(nav_children)
    scaffold = _build_scaffold(drawer_nav_children)

    new_jsx = (
        jsx_body[:nav_open_start]
        + new_open
        + nav_children
        + "</nav>"
        + scaffold
        + jsx_body[close_end:]
    )

    # Side effects: state + useEffect at the top of the function body,
    # Icons in the SDK import set.
    ctx.function_preamble.insert(0, _PREAMBLE)
    ctx.sdk_imports.add("Icons")

    return new_jsx


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _prepend_classname(attrs_text: str, prefix: str) -> str:
    """Prepend ``prefix`` to the ``className`` attribute, adding the
    attribute when absent.
    """
    match = _CLASSNAME_RE.search(attrs_text)
    if match:
        existing = match.group(1)
        new_value = f"{prefix} {existing}".strip() if existing else prefix
        replacement = f'className="{new_value}"'
        return attrs_text.replace(match.group(0), replacement, 1)
    return f'className="{prefix}" {attrs_text.strip()}'.strip()


def _strip_visibility_classes(attrs_text: str) -> str:
    """Strip breakpoint-gated visibility utilities from a className attribute.

    Removes patterns like ``hidden md:flex``, ``hidden lg:block``,
    ``hidden 2xl:grid``. Leaves the rest of the className intact (including
    other ``hidden`` usages that are scoped to non-visibility contexts
    such as ``placeholder:hidden`` — the bare-hidden regex uses a
    negative-lookbehind to avoid matching tokens preceded by `:`).
    """
    match = _CLASSNAME_RE.search(attrs_text)
    if not match:
        return attrs_text
    cleaned = _CLASSNAME_RE.sub(
        lambda m: f'className="{_scrub_visibility_value(m.group(1))}"',
        attrs_text,
        count=1,
    )
    return cleaned


def _scrub_visibility_value(class_str: str) -> str:
    """Remove all responsive-visibility patterns from a class string and
    collapse the resulting double-spaces. Idempotent.

    Strips, in order:
      * ``hidden {bp}:{flex|block|grid|inline-*}`` pairs (canonical Tailwind v3)
      * ``{bp}:hidden`` variants (responsive single-breakpoint hide)
      * Bare ``hidden`` tokens with no breakpoint qualifier

    Each regex uses lookbehind to require that ``hidden`` is its own
    token, never the tail of a longer variant chain — without this,
    `sm:hidden md:flex` would lose its ``md:flex`` portion to the
    canonical-pair regex's `\\b` boundary, leaving a malformed ``sm:``.
    """
    out = _VISIBILITY_BREAKPOINT_RE.sub("", class_str)
    out = _VARIANT_HIDDEN_RE.sub("", out)
    out = _BARE_HIDDEN_RE.sub("", out)
    # Collapse double-spaces and trim.
    out = re.sub(r"\s{2,}", " ", out).strip()
    return out


def _strip_display_and_visibility_classes(attrs_text: str) -> str:
    """Like ``_strip_visibility_classes`` but ALSO removes bare display
    utilities (``flex``, ``inline-flex``, ``block``, ``grid``, …).

    Scoped to the desktop-nav injection path where the scaffold prepends
    ``hidden lg:flex`` — any pre-existing bare display in the source's
    className conflicts with the injected display and the cascade
    arbitrarily picks one (usually bare-`flex` wins, leaving the nav
    visible at every viewport). NOT used for drawer-child cloning, which
    legitimately keeps source ``flex``/``grid``.
    """
    match = _CLASSNAME_RE.search(attrs_text)
    if not match:
        return attrs_text
    cleaned = _CLASSNAME_RE.sub(
        lambda m: f'className="{_scrub_display_and_visibility_value(m.group(1))}"',
        attrs_text,
        count=1,
    )
    return cleaned


def _scrub_display_and_visibility_value(class_str: str) -> str:
    """Strip both responsive-visibility and bare-display utilities."""
    out = _scrub_visibility_value(class_str)
    out = _BARE_DISPLAY_RE.sub("", out)
    out = re.sub(r"\s{2,}", " ", out).strip()
    return out


def _strip_visibility_classes_in_classnames(jsx: str) -> str:
    """Scrub visibility classes from EVERY ``className="..."`` in a JSX
    blob. Used when cloning source nav children into the mobile drawer —
    the drawer takes over visibility for its contents.
    """
    return _CLASSNAME_RE.sub(
        lambda m: f'className="{_scrub_visibility_value(m.group(1))}"',
        jsx,
    )


def _find_matching_close(jsx: str, search_from: int, tag_name: str) -> tuple[int, int] | None:
    """Find the matching ``</tag>`` for the open at ``search_from``,
    counting nested opens of the same tag.

    Returns ``(close_start, close_end)`` (positions of ``</tag>``) or
    ``None`` if no matching close is found.
    """
    open_re = re.compile(rf"<{tag_name}\b[^>]*>")
    close_re = re.compile(rf"</{tag_name}>")
    depth = 1
    cursor = search_from
    while cursor < len(jsx):
        next_open = open_re.search(jsx, cursor)
        next_close = close_re.search(jsx, cursor)
        if next_close is None:
            return None
        if next_open is not None and next_open.start() < next_close.start():
            depth += 1
            cursor = next_open.end()
        else:
            depth -= 1
            if depth == 0:
                return next_close.span()
            cursor = next_close.end()
    return None


def _build_scaffold(nav_children: str) -> str:
    """Return the JSX for the hamburger button + mobile overlay.

    The overlay clones ``nav_children`` verbatim so links and labels
    survive without re-templating. Phase 6's parity validator
    allow-lists this exact pattern.
    """
    return _SCAFFOLD_TEMPLATE.replace("__NAV_CHILDREN__", nav_children)


_SCAFFOLD_TEMPLATE = """<button \
className="p-2 lg:hidden" \
onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} \
aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}>\
{isMobileMenuOpen ? <Icons.X className="w-6 h-6" /> : <Icons.Menu className="w-6 h-6" />}\
</button>\
{isMobileMenuOpen && (<div \
className="fixed inset-0 z-[60] bg-surface flex flex-col lg:hidden">\
<button \
className="self-end p-4" \
onClick={() => setIsMobileMenuOpen(false)} \
aria-label="Close menu">\
<Icons.X className="w-8 h-8" />\
</button>\
<nav className="flex flex-col items-center justify-center flex-1 gap-8" aria-label="Mobile">\
__NAV_CHILDREN__\
</nav>\
</div>)}"""
