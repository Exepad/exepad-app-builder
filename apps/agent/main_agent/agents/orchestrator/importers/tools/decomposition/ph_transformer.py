"""Claude Design ``.ph`` placeholder → real ``<img>`` rewrite.

Multi-page Claude Design exports ship pages with **zero** ``<img>`` tags.
Each image region is encoded as::

    <div class="product-img ph">
      <span class="ph-label">Brown eggs · ¾ ratio</span>
    </div>

…and a single end-of-body ``<script>`` carries::

    (function() {
      const PH = { "eggs_brown": "https://images.unsplash.com/...", ... };
      const MAP = [ ["Brown eggs", "eggs_brown"], ... ];
      document.querySelectorAll(".ph").forEach(ph => { ... });
    })();

This module:

1. Locates the loader script by content (``const PH``, ``const MAP``,
   ``.ph`` selector). Position-independent.
2. Parses ``PH`` (JSON) and ``MAP`` (JSON-with-trailing-comma) literals
   into Python dicts/lists.
3. For every ``<div class="ph">``: reads ``.ph-label`` text, fuzzy-matches
   into MAP, looks up PH, drops ``ph`` class, decomposes ``.ph-label``,
   injects an ``<img>`` as the first child so overlay siblings (e.g.
   ``.scribble-note``) survive.
4. Removes the loader script from the soup (no longer needed; rewrites
   are baked into the DOM). Any other body-level ``<script>`` tags survive
   into the cleaned HTML untouched.
5. Returns the count of rewrites + the count of unmatched labels for the
   runner to surface in ``design_import/notes.md``.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Optional

from bs4 import BeautifulSoup, Tag

# Regex extractors. Both literals are matched non-greedily and we use
# brace-balance to find the right closing token in case the LLM-emitted PH
# contains an embedded `{` (it doesn't today, but defense-in-depth).
_PH_DECL_RE = re.compile(
    r"const\s+PH\s*=\s*",
    re.DOTALL,
)
_MAP_DECL_RE = re.compile(
    r"const\s+MAP\s*=\s*",
    re.DOTALL,
)


@dataclass
class PhTransformResult:
    """Outcome of one page's placeholder transformation."""

    transformed: int = 0
    unmatched_labels: list[str] = field(default_factory=list)
    loader_removed: bool = False


def transform_placeholders(
    html: str,
    *,
    soup: Optional[BeautifulSoup] = None,
) -> tuple[str, PhTransformResult]:
    """Find the ``.ph`` loader, parse PH/MAP, rewrite every ``.ph`` div.

    Args:
        html: Source HTML to transform. Ignored if ``soup`` is provided.
        soup: Optional pre-parsed soup. When provided, the function mutates
            it in place and returns ``str(soup)`` plus the result; useful
            when callers want to chain mutations without re-parsing.

    Returns:
        ``(transformed_html, result)``. When no loader is found or PH/MAP
        cannot be parsed, returns the input unchanged and ``transformed=0``.
    """
    if soup is None:
        soup = BeautifulSoup(html or "", "html.parser")

    loader_text = _find_loader_script_text(soup)
    if loader_text is None:
        return str(soup), PhTransformResult()

    ph = _parse_ph_dict(loader_text)
    map_pairs = _parse_map_pairs(loader_text)
    if ph is None or map_pairs is None:
        # Found the loader but couldn't parse it. Leave the page untouched
        # so the runner's image materializer reports unresolved .ph divs
        # via notes.md.
        return str(soup), PhTransformResult()

    result = PhTransformResult()
    for ph_div in soup.find_all(class_="ph"):
        label_el = ph_div.find(class_="ph-label")
        label_text = label_el.get_text(strip=True) if label_el else ""
        url = _lookup_url(label_text, map_pairs, ph)

        if url is None:
            if label_text:
                result.unmatched_labels.append(label_text)
            continue

        _inject_img(ph_div, label_el, url, soup=soup)
        result.transformed += 1

    # Remove the loader script — its work is baked into the DOM now. Other
    # body-level <script> tags survive into the cleaned HTML untouched.
    if _remove_loader_script(soup, loader_text):
        result.loader_removed = True

    return str(soup), result


# ────────────────────────────────────────────────────────────────────────────
# Internals
# ────────────────────────────────────────────────────────────────────────────


def _find_loader_script_text(soup: BeautifulSoup) -> Optional[str]:
    """Return the inline script body that defines PH + MAP, or None."""
    for script in soup.find_all("script"):
        if script.get("src"):
            continue
        body = script.string
        if body is None:
            # bs4 sometimes splits script content across NavigableStrings.
            body = "".join(str(c) for c in script.contents)
        if not isinstance(body, str):
            body = str(body)
        if "const PH" in body and "const MAP" in body and ".ph" in body:
            return body
    return None


def _balanced_extract(text: str, start: int, open_ch: str, close_ch: str) -> Optional[str]:
    """Return the substring from ``start`` (inclusive) through the matching
    ``close_ch`` (inclusive), respecting string literals so braces inside
    quoted URLs don't fool the counter.

    ``text[start]`` must be ``open_ch``.
    """
    if start >= len(text) or text[start] != open_ch:
        return None
    depth = 0
    i = start
    in_string: Optional[str] = None
    while i < len(text):
        ch = text[i]
        if in_string:
            if ch == "\\" and i + 1 < len(text):
                i += 2
                continue
            if ch == in_string:
                in_string = None
        else:
            if ch in {'"', "'"}:
                in_string = ch
            elif ch == open_ch:
                depth += 1
            elif ch == close_ch:
                depth -= 1
                if depth == 0:
                    return text[start : i + 1]
        i += 1
    return None


def _strip_trailing_commas(text: str) -> str:
    """Drop ``,`` immediately before ``}`` or ``]`` (with intermediate whitespace)."""
    return re.sub(r",(\s*[}\]])", r"\1", text)


def _parse_ph_dict(loader_text: str) -> Optional[dict[str, str]]:
    match = _PH_DECL_RE.search(loader_text)
    if match is None:
        return None
    raw = _balanced_extract(loader_text, match.end(), "{", "}")
    if raw is None:
        return None
    cleaned = _strip_trailing_commas(raw)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    # Coerce values to strings; drop non-string entries.
    return {k: v for k, v in parsed.items() if isinstance(k, str) and isinstance(v, str)}


def _parse_map_pairs(loader_text: str) -> Optional[list[tuple[str, str]]]:
    match = _MAP_DECL_RE.search(loader_text)
    if match is None:
        return None
    raw = _balanced_extract(loader_text, match.end(), "[", "]")
    if raw is None:
        return None
    cleaned = _strip_trailing_commas(raw)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, list):
        return None
    pairs: list[tuple[str, str]] = []
    for entry in parsed:
        if (
            isinstance(entry, list)
            and len(entry) == 2
            and isinstance(entry[0], str)
            and isinstance(entry[1], str)
        ):
            pairs.append((entry[0], entry[1]))
    return pairs


def _lookup_url(
    label_text: str,
    pairs: list[tuple[str, str]],
    ph: dict[str, str],
) -> Optional[str]:
    """Mimic the loader's fuzzy match: case-insensitive ``includes`` over MAP."""
    if not label_text:
        return None
    haystack = label_text.lower()
    for needle, key in pairs:
        if needle.lower() in haystack and key in ph:
            return ph[key]
    return None


def _inject_img(
    ph_div: Tag,
    label_el: Optional[Tag],
    url: str,
    *,
    soup: BeautifulSoup,
) -> None:
    """Mutate the placeholder wrapper to carry a child ``<img>``.

    Drops the ``ph`` class so later passes don't re-process it. Decomposes
    ``.ph-label`` (the visible text was meant for the loader, not the
    rendered output). Inserts the ``<img>`` as the first child so overlay
    siblings (e.g. ``.scribble-note``) remain present after the image.
    """
    classes = ph_div.get("class") or []
    if isinstance(classes, str):
        classes = classes.split()
    remaining = [c for c in classes if c != "ph"]
    if remaining:
        ph_div["class"] = remaining
    elif "class" in ph_div.attrs:
        # bs4 doesn't auto-drop empty class lists; clean up so we don't
        # serialize ``class=""``.
        del ph_div["class"]

    label_text = label_el.get_text(strip=True) if label_el else ""
    if label_el is not None:
        label_el.decompose()

    img = soup.new_tag("img")
    img["src"] = url
    if label_text:
        img["alt"] = label_text
        img["data-alt"] = label_text
    img["style"] = "width:100%;height:100%;object-fit:cover;display:block"
    ph_div.insert(0, img)


def _remove_loader_script(soup: BeautifulSoup, target_body: str) -> bool:
    """Remove the inline script whose body matches ``target_body``."""
    for script in soup.find_all("script"):
        if script.get("src"):
            continue
        body = script.string or "".join(str(c) for c in script.contents)
        if isinstance(body, str) and body == target_body:
            script.decompose()
            return True
    return False
