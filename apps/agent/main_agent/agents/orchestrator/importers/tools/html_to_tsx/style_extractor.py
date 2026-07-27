"""Strip ``<style>`` blocks from imported HTML (defensive).

The decomposition runner's ``html_cleaner.extract_body`` already calls
``drop_styles=True`` by default, so ``<style>`` blocks shouldn't survive
into per-page content artifacts. This module exists as a safety net for:

* Chrome-region extraction in some handlers that may set
  ``drop_styles=False``.
* Hand-authored HTML imports that bypass the decomposition runner.
* Source HTML with malformed body containers where the cleaner's
  selector-based stripping missed a ``<style>`` block.

Public entry: :func:`extract_styles`.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class StyleExtractionResult:
    """Outcome of scanning an HTML tree for ``<style>`` blocks."""

    body: str
    """Concatenated bodies of every removed ``<style>`` block.

    Empty when none were found. The transformer saves this as the
    ``design_import_styles:{Name}.css`` sidecar artifact when non-empty.
    """

    count: int = 0
    """Number of ``<style>`` blocks removed."""


def extract_styles(soup_root) -> StyleExtractionResult:
    """Remove every ``<style>`` element from ``soup_root`` and return
    the concatenated CSS body.

    Args:
        soup_root: A BeautifulSoup ``Tag`` or ``BeautifulSoup`` instance.
            The tree is mutated in-place — ``<style>`` elements are
            removed via ``decompose()``.

    Returns:
        A :class:`StyleExtractionResult` with the joined CSS and a
        count of removed blocks.
    """
    bodies: list[str] = []
    count = 0

    for style in soup_root.find_all("style"):
        body = style.string or style.get_text() or ""
        body = body.strip()
        if body:
            bodies.append(body)
            count += 1
        style.decompose()

    return StyleExtractionResult(
        body="\n\n".join(bodies) if bodies else "",
        count=count,
    )
