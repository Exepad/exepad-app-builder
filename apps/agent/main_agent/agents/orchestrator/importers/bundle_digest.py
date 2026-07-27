"""Summarize the design-import artifact set into a short domain hint.

Runs AFTER the DesignImporter agent has saved its canonical artifacts
(``content:<slug>:page.html`` + ``content:main:header.html`` + optionally
``design_import/notes.md``). Extracts cheap signals (title, H1/H2, nav
anchor text, hero ``<img alt>``, body-copy sample) and returns a compact
digest the PreCreator + Creator read to anchor their domain classification
in the bundle — not in a name-based guess.

Why this exists: the failure mode that prompted this whole refactor was
PreCreator classifying "HappyDoods" as a pet-accessories brand because it
saw only the app name, never the HTML. This digest is the bridge — it
surfaces enough bundle context in a PreCreatorInput field so the LLM
weights bundle signal above name-based heuristics.

Pure helpers are regex-based (no BeautifulSoup — it's not a runtime dep).
"""

from __future__ import annotations

import re
from typing import Optional

import structlog

from main_agent.agents.utils.artifact_manager import ArtifactManager

logger = structlog.get_logger(__name__)


# ----------------------------------------------------------------------------
# Output shape
# ----------------------------------------------------------------------------

# Everything is defensively bounded so a huge bundle can't balloon the
# PreCreatorInput / CreatorInput beyond reason.
_MAX_HEADLINES_PER_PAGE = 5
_MAX_IMG_ALTS_PER_PAGE = 6
_MAX_NAV_LABELS = 12
_MAX_SAMPLE_COPY_CHARS = 2000
_MAX_HEADLINE_CHARS = 200
_MAX_NAV_LABEL_CHARS = 60


# ----------------------------------------------------------------------------
# HTML regex helpers (no bs4 — not a runtime dep)
# ----------------------------------------------------------------------------

_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.I | re.S)
_H2_RE = re.compile(r"<h2[^>]*>(.*?)</h2>", re.I | re.S)
_ANCHOR_RE = re.compile(r"<a[^>]*>(.*?)</a>", re.I | re.S)
_IMG_ALT_RE = re.compile(r'<img[^>]+alt=["\']([^"\']+)["\']', re.I)
_HEADER_RE = re.compile(r"<header[^>]*>(.*?)</header>", re.I | re.S)
_NAV_RE = re.compile(r"<nav[^>]*>(.*?)</nav>", re.I | re.S)
_TAGS_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _strip_tags(html_fragment: str) -> str:
    """Remove every HTML tag, collapse whitespace."""
    return _WS_RE.sub(" ", _TAGS_RE.sub(" ", html_fragment)).strip()


def _extract_headlines(html: str) -> list[str]:
    """Return up to N H1/H2 headline texts (stripped, deduped, truncated)."""
    out: list[str] = []
    seen: set[str] = set()
    for pat in (_H1_RE, _H2_RE):
        for m in pat.finditer(html):
            txt = _strip_tags(m.group(1))[:_MAX_HEADLINE_CHARS]
            if txt and txt.lower() not in seen:
                out.append(txt)
                seen.add(txt.lower())
                if len(out) >= _MAX_HEADLINES_PER_PAGE:
                    return out
    return out


def _extract_image_alts(html: str) -> list[str]:
    """Return up to N distinct <img alt=...> strings."""
    out: list[str] = []
    seen: set[str] = set()
    for m in _IMG_ALT_RE.finditer(html):
        alt = _WS_RE.sub(" ", m.group(1)).strip()[:_MAX_HEADLINE_CHARS]
        if alt and alt.lower() not in seen:
            out.append(alt)
            seen.add(alt.lower())
            if len(out) >= _MAX_IMG_ALTS_PER_PAGE:
                return out
    return out


def _extract_nav_labels(header_html: str) -> list[str]:
    """Return anchor-text labels from <header> / <nav> regions."""
    if not header_html:
        return []
    region = header_html
    # Prefer <nav> if present — tighter signal than the whole header.
    nav_m = _NAV_RE.search(header_html)
    if nav_m:
        region = nav_m.group(1)
    out: list[str] = []
    seen: set[str] = set()
    for m in _ANCHOR_RE.finditer(region):
        txt = _strip_tags(m.group(1))
        if not txt or len(txt) > _MAX_NAV_LABEL_CHARS:
            continue
        key = txt.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(txt)
        if len(out) >= _MAX_NAV_LABELS:
            return out
    return out


def _extract_brand_name(header_html: str, title: str) -> str:
    """Guess the brand name from the header's first prominent text or <title>.

    Heuristic:
      1. Header's first <h1> text.
      2. Header's first anchor text inside <nav> / <header> that looks like
         a brand token (short, no trailing slashes).
      3. First segment of <title> before a separator ``-|—–``.
    """
    if header_html:
        h1_m = _H1_RE.search(header_html)
        if h1_m:
            txt = _strip_tags(h1_m.group(1))
            if txt and len(txt) < 60:
                return txt
        # First anchor whose text isn't a generic nav label.
        for m in _ANCHOR_RE.finditer(header_html):
            txt = _strip_tags(m.group(1))
            if not txt or len(txt) > 60:
                continue
            if txt.lower() in {
                "home",
                "about",
                "about us",
                "products",
                "contact",
                "contact us",
                "shop",
                "blog",
                "menu",
                "order now",
            }:
                continue
            return txt
    if title:
        title_clean = re.split(r"[|—–-]", title, maxsplit=1)[0].strip()
        if title_clean:
            return title_clean
    return ""


def _strip_body_to_sample(html: str, budget: int) -> str:
    """Return up to ``budget`` chars of plain text from an HTML fragment."""
    text = _strip_tags(html)
    if len(text) <= budget:
        return text
    return text[:budget].rsplit(" ", 1)[0] + "…"


def _canonical_slug_from_artifact_key(key: str) -> str:
    """Extract the middle segment of ``content:<slug>:page.html``."""
    if not (key.startswith("content:") and key.endswith(":page.html")):
        return ""
    mid = key[len("content:") : -len(":page.html")]
    # Main-role singletons (``content:main:header.html``) never match this
    # predicate because their suffix is role-specific.
    return mid


def _render_digest_text(
    *,
    brand_name: str,
    page_slugs: list[str],
    nav_labels: list[str],
    headlines: list[str],
    image_alts: list[str],
    sample_copy: str,
) -> str:
    """Human- and LLM-readable one-blob summary of the bundle's domain.

    PreCreator + Creator consume this as a single ``bundle_domain_hints``
    field. Concise and signal-dense.
    """
    parts: list[str] = []
    if brand_name:
        parts.append(f"Brand: {brand_name}.")
    if page_slugs:
        pretty_slugs = ", ".join(s if s else "(home)" for s in page_slugs)
        parts.append(f"Pages: {pretty_slugs}.")
    if nav_labels:
        parts.append("Nav: " + " | ".join(nav_labels) + ".")
    if headlines:
        parts.append("Headlines: " + " / ".join(headlines[:10]) + ".")
    if image_alts:
        parts.append("Hero image alts: " + " / ".join(image_alts[:8]) + ".")
    if sample_copy:
        parts.append("Body sample: " + sample_copy)
    return " ".join(parts)


# ----------------------------------------------------------------------------
# Main entrypoint
# ----------------------------------------------------------------------------


_FOOTER_RE = re.compile(r"<footer[^>]*>.*?</footer>", re.I | re.S)


def _body_sample_from_page_html(html: str, budget: int) -> str:
    """Strip header/footer regions before sampling so nav text doesn't repeat."""
    body_only = _HEADER_RE.sub(" ", html)
    body_only = _FOOTER_RE.sub(" ", body_only)
    return _strip_body_to_sample(body_only, budget)


class _PerPageAccumulator:
    """Accumulates headlines, image alts, and body samples across pages."""

    def __init__(self, sample_budget: int):
        self.page_title = ""
        self.headlines: list[str] = []
        self.image_alts: list[str] = []
        self.body_samples: list[str] = []
        self.remaining = sample_budget

    def absorb(self, html: str) -> None:
        if not html:
            return
        if not self.page_title:
            t_m = _TITLE_RE.search(html)
            if t_m:
                self.page_title = _strip_tags(t_m.group(1))
        for h in _extract_headlines(html):
            if h not in self.headlines:
                self.headlines.append(h)
        for alt in _extract_image_alts(html):
            if alt not in self.image_alts:
                self.image_alts.append(alt)
        if self.remaining > 0:
            sample = _body_sample_from_page_html(html, min(self.remaining, 600))
            if sample:
                self.body_samples.append(sample)
                self.remaining -= len(sample)


async def _list_design_import_artifact_keys(ctx) -> list[str]:
    """Return the design-import artifact keys the importer agent saved this turn."""
    try:
        keys = await ctx.artifact_service.list_artifact_keys(
            session_id=ctx.session.id,
            user_id=ctx.session.user_id,
            app_name=ctx.session.app_name,
        )
    except Exception:  # noqa: BLE001
        logger.exception("bundle_digest_list_artifact_keys_failed")
        return []
    if not isinstance(keys, list):
        return []
    return [
        k
        for k in keys
        if isinstance(k, str)
        and (
            k.startswith("content:")
            or k.startswith("design_import/")
            or k == "codefocus_style:theme.css"
        )
    ]


async def digest_bundle_artifacts(ctx) -> Optional[dict]:
    """Build a domain-hints digest from the importer-produced artifacts.

    Returns ``None`` when no ``content:<slug>:page.html`` artifacts exist
    (non-bundle path). Otherwise returns::

        {
            "brand_name": "HappyDoods",
            "page_slugs": ["", "about-us", "contact-us", "our-products"],
            "nav_labels": ["Home", "About Us", "Products", "Contact"],
            "headlines": [...],
            "image_alts": [...],
            "sample_copy": "<first ~2000 chars>",
            "domain_hints": "<single concatenated string for PreCreator>",
        }
    """
    keys = await _list_design_import_artifact_keys(ctx)
    page_keys = sorted(
        k
        for k in keys
        if k.startswith("content:")
        and k.endswith(":page.html")
        and not k.startswith("content:main:")
    )
    if not page_keys:
        return None

    # Load the header singleton (if any) — its anchors give nav labels +
    # its <h1>/brand text anchors brand_name.
    header_html = ""
    if "content:main:header.html" in keys:
        header_html = (
            await ArtifactManager.load_artifact_as_string(ctx, "content:main:header.html") or ""
        )

    acc = _PerPageAccumulator(_MAX_SAMPLE_COPY_CHARS)
    page_slugs: list[str] = []
    for key in page_keys:
        page_slugs.append(_canonical_slug_from_artifact_key(key))
        acc.absorb(await ArtifactManager.load_artifact_as_string(ctx, key) or "")

    nav_labels = _extract_nav_labels(header_html)
    brand_name = _extract_brand_name(header_html, acc.page_title)
    sample_copy = " ".join(acc.body_samples)[:_MAX_SAMPLE_COPY_CHARS]
    headlines = acc.headlines
    image_alts = acc.image_alts

    domain_hints = _render_digest_text(
        brand_name=brand_name,
        page_slugs=page_slugs,
        nav_labels=nav_labels,
        headlines=headlines,
        image_alts=image_alts,
        sample_copy=sample_copy,
    )

    digest = {
        "brand_name": brand_name,
        "page_slugs": page_slugs,
        "nav_labels": nav_labels,
        "headlines": headlines,
        "image_alts": image_alts,
        "sample_copy": sample_copy,
        "domain_hints": domain_hints,
    }
    logger.info(
        "bundle_digest_built",
        brand_name=brand_name,
        page_count=len(page_slugs),
        headline_count=len(headlines),
        image_alt_count=len(image_alts),
        nav_label_count=len(nav_labels),
        domain_hints_chars=len(domain_hints),
    )
    return digest
