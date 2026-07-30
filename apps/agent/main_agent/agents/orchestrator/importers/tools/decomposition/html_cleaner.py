"""Deterministic HTML body extraction for the design importer.

Single responsibility: take a raw bundle HTML string, return the ``<body>``
subtree as a string preserving every authored attribute, class, text node,
and HTML entity. Document chrome (``<head>`` and everything inside it,
including head-scoped scripts/links/metadata) is dropped because we extract
``<body>`` only — the head is a sibling, not a descendant.

Critical implementation choices:

* **Parser is locked to ``html.parser``.** ``lxml`` would normalize whitespace,
  rewrite HTML entities (``&amp;`` → ``&``), and re-emit attribute quotes
  inconsistently — all of which violate "byte-for-body-faithful".
* **Output uses ``str(child) for child in body.contents``**, never
  ``str(body)`` (which re-emits ``<body>…</body>``) and never
  ``BeautifulSoup.prettify()`` (which rewrites whitespace).
* **Body-level ``<script>`` tags are PRESERVED.** ComponentBuilder reads
  them as behavioral hints when translating to TSX. Only the explicit
  ``<head>`` scripts are dropped (by virtue of extracting only ``<body>``)
  and any scripts caller already removed (e.g. the ``.ph`` loader,
  consumed by ``ph_transformer`` before this module runs).
* **Empty / fragment input.** If no ``<body>`` is found, the whole soup is
  treated as the body — Stitch sometimes ships fragments without
  ``<html>`` / ``<body>`` wrappers.
"""

from __future__ import annotations

from typing import Iterable, Optional

from bs4 import BeautifulSoup, Comment, Tag


class HtmlCleanerError(RuntimeError):
    """Raised when the cleaner cannot produce a meaningful output."""


def extract_body(
    raw_html: str,
    *,
    drop_styles: bool = True,
    extra_remove_selectors: Optional[Iterable[str]] = None,
) -> str:
    """Return the cleaned body subtree as a string.

    Args:
        raw_html: Source HTML bytes decoded to text.
        drop_styles: When True (default), every ``<style>`` element in the
            body subtree is removed. The style lifter is expected to have
            captured their text already. When False, ``<style>`` tags
            survive verbatim (used by the chrome extractor).
        extra_remove_selectors: Optional CSS selectors whose matches are
            removed from the body subtree before serialization. The runner
            uses this to strip chrome regions out of per-page outputs once
            the chrome has been emitted as a singleton artifact.

    Returns:
        Concatenated string of every body child after removal. For a
        fragment without ``<body>``, returns the cleaned document tree.

    Raises:
        HtmlCleanerError: when the document is empty after cleaning.
    """
    if not isinstance(raw_html, str) or not raw_html.strip():
        raise HtmlCleanerError("input HTML is empty")

    soup = BeautifulSoup(raw_html, "html.parser")
    body = soup.find("body")
    container: Tag = body if isinstance(body, Tag) else soup

    # 1. Strip HTML comments inside the container subtree.
    for comment in container.find_all(string=lambda t: isinstance(t, Comment)):
        comment.extract()

    # 2. Strip body-level chrome leaks. Real-world HTML occasionally puts
    # <meta>, <link>, <title> inside the body (microdata, schema.org). They
    # are still chrome — drop them.
    for tag_name in ("meta", "link", "title"):
        for tag in container.find_all(tag_name):
            tag.decompose()

    # 2b. Fragment fallback: when there is no <body>, the container is the
    # whole soup. A <head> sibling (rare in fragments but possible) would
    # otherwise survive into the output along with all its head-scoped
    # scripts. Drop it explicitly.
    if body is None:
        for head in container.find_all("head"):
            head.decompose()

    # 3. Strip extra selectors first (e.g. chrome regions duplicated inside
    # pages). These come from the LLM's plan; tolerate exotic selectors.
    if extra_remove_selectors:
        for selector in extra_remove_selectors:
            try:
                for match in container.select(selector):
                    match.decompose()
            except Exception:  # noqa: BLE001
                # bs4's CSS engine may reject exotic selectors. The runner
                # logs the original directive; treat unparseable selectors
                # as no-ops so a bad selector doesn't sink the whole page.
                continue

    # 4. Drop <style> tags from the body subtree if requested. The style
    # lifter has already captured their text; we don't want them rendered.
    if drop_styles:
        for style in container.find_all("style"):
            style.decompose()

    # 5. Serialize. Use child-iteration to avoid emitting <body>...</body>,
    # but if the body itself has attributes (Stitch puts ``class="antialiased
    # bg-surface"`` on <body>) wrap the children in a <div> carrying those
    # attributes so they survive into the cleaned output. ComponentBuilder
    # can then translate that wrapper to a top-level ``<div className="...">``.
    out_nodes = _emit_body_children(soup, body, container)

    cleaned = "".join(str(node) for node in out_nodes).strip()
    if not cleaned:
        raise HtmlCleanerError("cleaning produced an empty body")
    return cleaned


def _emit_body_children(soup: BeautifulSoup, body: Optional[Tag], container: Tag) -> list:
    """Return the list of root nodes the cleaner serializes.

    When ``<body>`` carries any attribute (``class``, ``id``, ``data-*``,
    arbitrary), wrap its children in a ``<div>`` carrying those attributes
    so the page-level styling/behavior hints are preserved. Otherwise emit
    the children directly.
    """
    if body is None:
        return list(container.children)
    if not body.attrs:
        return list(body.children)
    wrapper = soup.new_tag("div")
    for attr, val in body.attrs.items():
        wrapper[attr] = val
    for child in list(body.children):
        wrapper.append(child.extract() if hasattr(child, "extract") else child)
    return [wrapper]


def extract_node(
    raw_html: str,
    selector: str,
    *,
    drop_styles: bool = True,
) -> str:
    """Return the first node matching ``selector`` from ``raw_html`` as a string.

    Used by the chrome extractor: load the source artifact, run the LLM-chosen
    selector, return the cleaned subtree.
    """
    if not isinstance(raw_html, str) or not raw_html.strip():
        raise HtmlCleanerError("input HTML is empty")
    soup = BeautifulSoup(raw_html, "html.parser")

    # Strip comments first so the selector match doesn't carry them.
    for comment in soup.find_all(string=lambda t: isinstance(t, Comment)):
        comment.extract()

    match = soup.select_one(selector)
    if match is None:
        raise HtmlCleanerError(f"selector did not match anything: {selector!r}")

    if drop_styles:
        for style in match.find_all("style"):
            style.decompose()

    return str(match).strip()
