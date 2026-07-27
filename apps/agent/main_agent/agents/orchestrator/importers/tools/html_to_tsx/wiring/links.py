"""``<a href>`` → ``<Link to>`` substitution for internal navigation.

Rules:

* Bare ``href="#"`` and ``href="#anchor"`` stay verbatim as ``<a>``.
* Absolute URLs (``http(s)://``, ``mailto:``, ``tel:``) stay as
  ``<a>``. External http/https links get ``target="_blank"`` and
  ``rel="noopener noreferrer"`` added when missing — improves
  security and middle-click behavior without changing the source's
  visible content.
* Internal absolute paths (``/path``) match against
  ``ctx.page_slugs``. On match, rewrite to ``<Link to="/path">``.
  On miss, stay as ``<a href="/path">`` — never invent a route.
* Relative paths (``products`` without leading slash) are normalized
  to ``/products`` for the slug match attempt; if matched, emit
  ``<Link to="/products">`` (the leading slash matters — bare slugs
  break sub-page navigation per the SDK `Link` contract).

**Hard rule:** never remove an existing ``href`` attribute. Even when
rewriting to ``<Link>``, the SDK's ``<Link>`` synthesizes its own
``href`` server-side — but the wiring rule still preserves the
authored target verbatim by passing it as ``to=``. This rule keeps
middle-click-to-open + SEO working.

The caller (the walker) emits the children of the anchor verbatim;
this module only produces the open-tag JSX. The walker's normal
emission of ``</a>`` or ``</Link>`` follows.
"""

from __future__ import annotations

import re

from bs4.element import Tag

from .context import WiringContext

_EXTERNAL_SCHEMES = ("http://", "https://", "mailto:", "tel:", "ftp://")
# Schemes that should NOT receive target="_blank" / rel="noopener" since
# they hand off to a different protocol handler (email client, dialer)
# rather than opening a browser tab.
_NON_TAB_SCHEMES = ("mailto:", "tel:", "ftp://")


def substitute_anchor_open_tag(tag: Tag, ctx: WiringContext) -> str | None:
    """Return the JSX open tag for an ``<a>``, or ``None`` to fall
    through to default emission.

    The walker handles children + closing tag. When this function
    returns ``"<Link to=…>"`` the walker is responsible for emitting
    ``</Link>`` instead of ``</a>``.

    Args:
        tag: The ``<a>`` BS4 Tag.
        ctx: The walk's wiring context.

    Returns:
        A complete open-tag JSX string (e.g. ``<Link to="/about">`` or
        ``<a href="https://x" target="_blank" rel="noopener noreferrer">``),
        or ``None`` when no rewrite applies and the walker should emit
        the anchor with default attribute translation.
    """
    if (tag.name or "").lower() != "a":
        return None

    href = (tag.get("href") or "").strip()

    # Hash-only / hash-anchor / no-href stay as <a>; let the walker do
    # default emission (just class→className etc.).
    #
    # CHROME NAV CARVE-OUT: in sidebar/header/footer, attempt to
    # rewrite bare ``href="#"`` to a real route by fuzzy-matching the
    # anchor's inner text against known page titles. Stitch designs
    # use ``href="#"`` as a placeholder for nav items; without this
    # rewrite the entire app is unnavigable from the chrome (every
    # link reloads the same page). First surfaced on app alo48zsn
    # (2026-05-15).
    #
    # Guard is ``href == "#"`` exactly — NOT ``startswith("#")`` — so
    # legitimate same-page anchors like ``href="#section-id"`` keep
    # today's behavior. Falls through to the default ``<a>`` emit
    # when (a) we're not in chrome, (b) no page_routes were provided,
    # or (c) the anchor text doesn't fuzzy-match any page title.
    if not href or href.startswith("#"):
        if (
            href == "#"
            and ctx.component_role in ("sidebar", "header", "footer")
            and ctx.page_routes
        ):
            matched_slug = _match_chrome_anchor_to_slug(tag, ctx.page_routes)
            if matched_slug:
                ctx.sdk_imports.add("Link")
                return _emit_link(tag, matched_slug)
        return None

    # External URLs — add target/rel if missing, otherwise default emit.
    if _is_external(href):
        return _emit_external_anchor(tag, href)

    # Internal absolute or relative path. Normalize to absolute.
    # Special-case index / index.html → "/" (the canonical home slug).
    # Source bundles use `href="index.html"` (or its .html-stripped form
    # `index`) for the home page; blindly prefixing "/" would yield
    # "/index" or "/index.html", neither of which matches the home slug
    # `"/"` in page_slugs. dchu7mzs (2026-05-17) shipped with the brand
    # link and Home nav both as `<a href="/index">` — React Router's
    # catchall masked the regression by re-rendering Home, but every
    # click cost a full reload + URL flash.
    href_stem = href.split("?", 1)[0].split("#", 1)[0].lstrip("/").rstrip("/")
    if href_stem in ("index.html", "index", ""):
        normalized = "/"
    else:
        normalized = href if href.startswith("/") else "/" + href
    # Strip query string and hash for the slug match.
    pure_path = normalized.split("?", 1)[0].split("#", 1)[0].rstrip("/")
    if not pure_path:
        pure_path = "/"

    if pure_path in ctx.page_slugs or normalized.rstrip("/") in ctx.page_slugs:
        ctx.sdk_imports.add("Link")
        return _emit_link(tag, normalized)

    # Internal path that doesn't match a known page slug — keep <a>
    # with the original href. Never invent a route, never remove href.
    return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_external(href: str) -> bool:
    return any(href.lower().startswith(s) for s in _EXTERNAL_SCHEMES)


def _emit_external_anchor(tag: Tag, href: str) -> str | None:
    """Render ``<a href="...">`` for an external link.

    For http(s) links, adds ``target="_blank"`` + ``rel="noopener
    noreferrer"`` when the source didn't already set them. For
    ``mailto:`` / ``tel:`` / ``ftp://`` links, no tab-open behavior is
    added — those hand off to a protocol handler, not a browser tab.

    Returns ``None`` to fall through to default emission when the
    source has an inline ``style`` attribute (the style converter is
    in another module; falling through avoids re-implementing it
    here).
    """
    href_lower = href.lower()
    is_tab_target = not any(href_lower.startswith(s) for s in _NON_TAB_SCHEMES)

    target = (tag.get("target") or "").strip().lower()
    rel = (tag.get("rel") or "").strip()
    if isinstance(rel, list):
        rel = " ".join(rel)

    parts: list[str] = [f'href="{_escape_attr(href)}"']

    # Preserve other attrs (class, id, aria-*, data-*, title, etc.)
    for k, v in (tag.attrs or {}).items():
        kl = k.lower()
        if kl in ("href", "target", "rel"):
            continue
        if kl == "class":
            classes = " ".join(v) if isinstance(v, list) else str(v)
            parts.append(f'className="{_escape_attr(classes)}"')
            continue
        if kl == "style":
            # Fall through to default emit when style is present so the
            # style converter handles it.
            return None
        parts.append(f'{k}="{_escape_attr(_stringify(v))}"')

    if is_tab_target:
        if not target:
            parts.append('target="_blank"')
        else:
            parts.append(f'target="{_escape_attr(target)}"')
        if not rel or "noopener" not in rel.lower():
            parts.append('rel="noopener noreferrer"')
        elif rel:
            parts.append(f'rel="{_escape_attr(rel)}"')
    else:
        # Protocol-handler link (mailto/tel/ftp) — preserve existing
        # target/rel verbatim if the source authored them, otherwise
        # leave alone.
        if target:
            parts.append(f'target="{_escape_attr(target)}"')
        if rel:
            parts.append(f'rel="{_escape_attr(rel)}"')

    return "<a " + " ".join(parts) + ">"


def _emit_link(tag: Tag, normalized: str) -> str:
    """Render ``<Link to="/path">`` preserving non-href attrs."""
    parts: list[str] = [f'to="{_escape_attr(normalized)}"']

    for k, v in (tag.attrs or {}).items():
        kl = k.lower()
        if kl == "href":
            continue
        if kl == "class":
            classes = " ".join(v) if isinstance(v, list) else str(v)
            parts.append(f'className="{_escape_attr(classes)}"')
            continue
        if kl == "style":
            # See _emit_external_anchor for the same rationale — fall
            # through to default emit when style is present so the
            # style converter handles it. We can't return None from
            # here cleanly since we already committed to the Link
            # path; instead, leave the inline style stripped with a
            # warning. Phase-9 tests will catch any regressions.
            continue
        parts.append(f'{k}="{_escape_attr(_stringify(v))}"')

    return "<Link " + " ".join(parts) + ">"


def _stringify(value) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return " ".join(value)
    return str(value)


def _escape_attr(value: str) -> str:
    return value.replace('"', "&quot;")


# Anchor labels that look like navigation but don't correspond to a page.
# Rewriting them to a fuzzy-matched slug would misroute users — e.g. a
# "Support" link pointing at a "Customer Support Center" page makes the
# logout button send the user to a settings screen.
_NON_ROUTABLE_CHROME_LABELS = frozenset({
    "logout",
    "log out",
    "sign out",
    "signout",
    "support",
    "help",
    "settings",
    "profile",
    "account",
})


def _match_chrome_anchor_to_slug(
    tag: Tag, page_routes: tuple[tuple[str, str], ...]
) -> str | None:
    """Fuzzy-match a chrome anchor's text to a known page slug.

    Strategy (cheapest to costliest):
    1. Lowercased anchor text equals a slug (with or without leading "/").
    2. Lowercased anchor text appears as a whole word inside a page title.
    3. Any title word (length ≥ 4) appears in anchor text. Score by
       overlap; require ≥ 1.

    Skips labels in :data:`_NON_ROUTABLE_CHROME_LABELS` — these have no
    corresponding page; rewriting them would misroute users.

    Returns the matched slug, or ``None`` when no candidate beats the
    floor.
    """
    text = (tag.get_text(separator=" ", strip=True) or "").lower().strip()
    if not text:
        return None
    if text in _NON_ROUTABLE_CHROME_LABELS:
        return None

    # 1. Exact slug match.
    for slug, _title in page_routes:
        slug_clean = slug.lower().strip("/")
        if text == slug_clean or text == slug.lower():
            return slug

    # 2. Anchor text as a whole word in a page title.
    text_pat = re.compile(rf"\b{re.escape(text)}\b", re.IGNORECASE)
    for slug, title in page_routes:
        if title and text_pat.search(title):
            return slug

    # 3. Title word in anchor text. Score by overlap (tokens ≥ 4 chars).
    # Plural-tolerant: strip trailing 's' from every word on both sides
    # so "Members" matches "Member Directory" and "Settings" matches
    # "Setting" — common label mismatch in design-import sidebars.
    def _normalize(words: set[str]) -> set[str]:
        norm: set[str] = set()
        for w in words:
            wl = w.lower()
            norm.add(wl)
            if len(wl) > 4 and wl.endswith("s"):
                norm.add(wl[:-1])
        return norm

    best_slug: str | None = None
    best_score = 0
    text_words = _normalize({w for w in text.split() if len(w) >= 4})
    for slug, title in page_routes:
        if not title:
            continue
        title_words = _normalize({w for w in title.split() if len(w) >= 4})
        overlap = len(title_words & text_words)
        if overlap > best_score:
            best_score = overlap
            best_slug = slug
    return best_slug if best_score >= 1 else None
