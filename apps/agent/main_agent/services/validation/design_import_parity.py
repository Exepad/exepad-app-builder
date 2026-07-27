"""AST-diff parity validator for the design-import edit flow.

Triggered after ComponentBuilder finishes its edit-mode pass on a
mechanical-pipeline TSX skeleton. Compares the saved TSX (``after``)
to the mechanical pipeline's pre-edit output (``before``) and
hard-blocks any drift outside the allowed surgical edits.

The mechanical pipeline (Phases 1–5) produces a TSX with every
source-HTML text node, element count, and class name preserved
verbatim. ComponentBuilder edit mode is allowed to add hooks,
attribute handlers, and substitute marked-candidate leaves to
``useModel`` / ``<Charts.*>`` / ``<MapEmbed>`` per the per-component
``building_plan`` items emitted by Phase 5. Anything else is a
violation: the LLM tried to "improve" the source, which is exactly
the failure mode that motivated this whole pipeline.

MVP detectors (regex-based, no tree-sitter dependency):

1. **Text fidelity** — every text node ≥12 chars in ``before`` must
   appear in ``after`` either verbatim OR as the fallback in a
   ``?? 'literal'`` templating expression.
2. **Backend-name existence** — every ``useModel('NAME')`` or
   ``useHandler('NAME')`` call in ``after`` must reference a name
   that appears in ``backend_surface.models`` or
   ``backend_surface.handlers``. ComponentBuilder must never invent
   a backend name.
3. **Href preservation** — every ``<a href="X">`` in ``before`` must
   appear as ``<a href="X">`` or ``<Link to="X">`` in ``after``.
   Removing an href breaks middle-click + SEO and is forbidden.
4. **Structural tag counts** — ``<section>``, ``<form>``, ``<h1>``
   through ``<h6>`` counts must be EQUAL in ``before`` and ``after``.
   These tags are structural anchors that don't appear inside
   ``useModel(...).map`` templates, so any drift signals fabrication
   (added section) or loss (dropped section).

Non-MVP (deferred): tree-sitter AST-level analysis for
attribute-deltas, hook-positioning, JSX shape comparison.

Public entry: :func:`check_parity`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Violation:
    """A single parity-rule failure."""

    code: str
    """Machine-readable category (e.g. ``"text_drift"``,
    ``"invented_backend"``, ``"removed_href"``,
    ``"structural_tag_drift"``).
    """

    message: str
    """Human-readable description with context (e.g. the dropped
    text snippet, the invented model name, etc.)."""


@dataclass
class ParityResult:
    """Outcome of a parity check."""

    violations: list[Violation] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.violations


# ---------------------------------------------------------------------------
# Regex primitives
# ---------------------------------------------------------------------------

# Match text content between JSX tags. Captures only NavigableString-ish
# regions — not inside ``<script>``/``<style>`` (the transformer strips
# those upstream) and not inside JSX expression braces. Conservative —
# we err toward false-positives (non-text regions appearing as text)
# because the only consequence is asserting they survive into output,
# which they will if shape is preserved.
_TEXT_NODE_RE = re.compile(r">([^<>{}]+)<")
# Default minimum-length threshold for the text-fidelity check. Short
# text nodes (names, emails, single-word labels) need protection from
# direct fabrication ("Maya Chen" → "Elena Rossi") so the threshold is
# low. When ``after`` contains a candidate substitution pattern, sibling
# rows legitimately collapse and short repeating text (one row per
# member) won't survive — we raise the threshold to 30 in that case so
# the substitution path doesn't false-positive on dropped rows. Long
# text (titles, paragraphs) is always checked.
_MIN_TEXT_LEN_DEFAULT = 8
_MIN_TEXT_LEN_WITH_SUBSTITUTION = 30

_SUBSTITUTION_MARKERS_RE = re.compile(
    r"\buseModel\s*\(|\buseHandler\s*\(|<Charts\.|<MapEmbed\b|\.map\s*\(\s*\(",
)

_USEMODEL_RE = re.compile(r"\buseModel\s*\(\s*['\"]([^'\"]+)['\"]")
_USEHANDLER_RE = re.compile(r"\buseHandler\s*\(\s*['\"]([^'\"]+)['\"]")

_A_HREF_RE = re.compile(r'<a\b[^>]*?href="([^"]*)"')
_LINK_TO_RE = re.compile(r'<Link\b[^>]*?to="([^"]*)"')

# Structural tags whose counts must NOT change. These never appear
# inside ``useModel.map`` templates in practice — they're page-level
# anchors, not data-row containers.
_STRUCTURAL_TAGS: tuple[str, ...] = (
    "section",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def check_parity(
    *,
    before_tsx: str,
    after_tsx: str,
    backend_surface: dict[str, Any] | None = None,
) -> ParityResult:
    """Compare pre-edit and post-edit TSX, returning all violations.

    Args:
        before_tsx: The mechanical-pipeline output ComponentBuilder
            received as ``existing_source``. Authoritative for
            content + structural shape.
        after_tsx: The TSX ComponentBuilder saved.
        backend_surface: Dict with optional ``models`` / ``handlers``
            keys (each a list of ``{name: ...}`` dicts or strings).
            Used by the backend-name existence check; when ``None`` or
            empty, the check is permissive (any name is allowed).

    Returns:
        :class:`ParityResult` with the violations list. Empty list
        means the edit is allowed; non-empty means the workflow
        should restore the pre-edit TSX.
    """
    backend_surface = backend_surface or {}
    violations: list[Violation] = []

    violations.extend(_check_text_fidelity(before_tsx, after_tsx))
    violations.extend(_check_backend_name_existence(after_tsx, backend_surface))
    violations.extend(_check_href_preservation(before_tsx, after_tsx))
    violations.extend(_check_structural_tag_counts(before_tsx, after_tsx))

    return ParityResult(violations=violations)


# ---------------------------------------------------------------------------
# Detector 1: text fidelity
# ---------------------------------------------------------------------------


def _check_text_fidelity(before_tsx: str, after_tsx: str) -> list[Violation]:
    """Every meaningful text node in ``before`` must survive in ``after``.

    Survival means either:
    - Verbatim presence anywhere in the after_tsx string.
    - Appearance as the right-hand side of a ``??`` nullish-coalescing
      operator with a string literal (the templating fallback shape).

    Threshold logic:
    - When ``after`` shows no substitution markers (``useModel(`` /
      ``useHandler(`` / ``<Charts.`` / ``<MapEmbed`` / ``.map((``), the
      threshold is 8 chars — catches direct fabrication like
      "Maya Chen" → "Elena Rossi".
    - When ``after`` HAS substitution markers, sibling rows
      legitimately collapse into a single ``useModel.map`` template;
      short repeating text (per-row data) drops are expected. Threshold
      raised to 30 chars so titles/paragraphs are still protected.
    """
    has_substitution = bool(_SUBSTITUTION_MARKERS_RE.search(after_tsx))
    threshold = _MIN_TEXT_LEN_WITH_SUBSTITUTION if has_substitution else _MIN_TEXT_LEN_DEFAULT

    violations: list[Violation] = []
    seen: set[str] = set()
    for match in _TEXT_NODE_RE.finditer(before_tsx):
        text = match.group(1).strip()
        if len(text) < threshold:
            continue
        if text in seen:
            continue
        seen.add(text)
        if _text_present_in_output(text, after_tsx):
            continue
        violations.append(
            Violation(
                code="text_drift",
                message=(
                    f"Source text {text[:60]!r} not preserved in output "
                    "(verbatim or as ?? fallback)"
                ),
            )
        )
    return violations


def _text_present_in_output(text: str, after_tsx: str) -> bool:
    if text in after_tsx:
        return True
    # Allow templating fallback: `?? 'text'` or `?? "text"`
    escaped = re.escape(text)
    fallback = re.compile(r"\?\?\s*['\"]" + escaped + r"['\"]")
    return bool(fallback.search(after_tsx))


# ---------------------------------------------------------------------------
# Detector 2: backend-name existence
# ---------------------------------------------------------------------------


def _check_backend_name_existence(
    after_tsx: str,
    backend_surface: dict[str, Any],
) -> list[Violation]:
    """Every useModel('NAME') / useHandler('NAME') must reference a
    declared backend entry."""
    model_names = _names(backend_surface.get("models") or [])
    handler_names = _names(backend_surface.get("handlers") or [])

    # Permissive when no backend declared: any name is allowed
    # (typical Path B — marketing imports without backend models).
    if not model_names and not handler_names:
        return []

    violations: list[Violation] = []
    for match in _USEMODEL_RE.finditer(after_tsx):
        name = match.group(1)
        if model_names and name not in model_names:
            violations.append(
                Violation(
                    code="invented_backend",
                    message=(
                        f"useModel({name!r}) — '{name}' not in "
                        f"backend_surface.models. Available: "
                        f"{sorted(model_names)}"
                    ),
                )
            )
    for match in _USEHANDLER_RE.finditer(after_tsx):
        name = match.group(1)
        if handler_names and name not in handler_names:
            violations.append(
                Violation(
                    code="invented_backend",
                    message=(
                        f"useHandler({name!r}) — '{name}' not in "
                        f"backend_surface.handlers. Available: "
                        f"{sorted(handler_names)}"
                    ),
                )
            )
    return violations


# ---------------------------------------------------------------------------
# Detector 3: href preservation
# ---------------------------------------------------------------------------


def _normalize_href_for_compare(href: str) -> str:
    """Canonicalize an href for set-difference parity comparison.

    The mechanical-pipeline baseline carries imported-HTML hrefs like
    ``"shop.html"``; the post-edit code goes through the bare-slug
    auto-fixer which rewrites them to ``"/shop"`` (leading slash + ``.html``
    suffix stripped). Without normalization the parity check sees these as
    a removed-then-introduced pair and flags ``removed_href``.

    Normalize both sides identically so cosmetic auto-fix transformations
    don't fire false positives, while *real* drops (LLM dropping the href
    entirely or pointing it at a totally different slug) still surface.

    Rules:
    - Strip surrounding whitespace.
    - Strip leading ``/`` so ``shop.html`` and ``/shop.html`` collide.
    - Strip a trailing ``.html`` so ``shop`` and ``shop.html`` collide.
    - Lowercase so case differences don't trip.
    - Fragment-only links (``#hero``) and protocol links (``mailto:``,
      ``tel:``, ``http://``) are returned untouched.
    """
    s = href.strip()
    if not s:
        return ""
    if s.startswith("#") or ":" in s:
        return s.lower()
    if s.startswith("/"):
        s = s[1:]
    if s.lower().endswith(".html") and len(s) > 5:
        s = s[:-5]
    return s.lower()


def _check_href_preservation(before_tsx: str, after_tsx: str) -> list[Violation]:
    """Every ``<a href>`` in ``before`` must survive as ``<a href>`` or
    ``<Link to>`` in ``after``."""
    before_hrefs = {_normalize_href_for_compare(h) for h in _A_HREF_RE.findall(before_tsx)}
    after_hrefs = {_normalize_href_for_compare(h) for h in _A_HREF_RE.findall(after_tsx)}
    after_links = {_normalize_href_for_compare(h) for h in _LINK_TO_RE.findall(after_tsx)}
    after_seen = after_hrefs | after_links

    # Use the original (un-normalized) value for the violation message so
    # users can grep the source. Build a forward map from normalized →
    # representative original for the messaging path.
    before_originals: dict[str, str] = {}
    for raw in _A_HREF_RE.findall(before_tsx):
        before_originals.setdefault(_normalize_href_for_compare(raw), raw)

    violations: list[Violation] = []
    for normalized in sorted(before_hrefs):
        if not normalized:
            continue
        if normalized in after_seen:
            continue
        href = before_originals.get(normalized, normalized)
        violations.append(
            Violation(
                code="removed_href",
                message=(
                    f"<a href={href!r}> in source not preserved as "
                    "<a href=...> or <Link to=...> in output"
                ),
            )
        )
    return violations


# ---------------------------------------------------------------------------
# Detector 4: structural tag counts
# ---------------------------------------------------------------------------


def _check_structural_tag_counts(before_tsx: str, after_tsx: str) -> list[Violation]:
    """Counts of structural tags (section/form/h1-h6) must be equal."""
    violations: list[Violation] = []
    for tag in _STRUCTURAL_TAGS:
        pattern = re.compile(rf"<{tag}\b")
        before_count = len(pattern.findall(before_tsx))
        after_count = len(pattern.findall(after_tsx))
        if before_count == after_count:
            continue
        direction = "added" if after_count > before_count else "dropped"
        delta = abs(after_count - before_count)
        violations.append(
            Violation(
                code="structural_tag_drift",
                message=(
                    f"<{tag}> count {direction}: source has "
                    f"{before_count}, output has {after_count} "
                    f"({direction} {delta})"
                ),
            )
        )
    return violations


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _names(items: list[Any]) -> set[str]:
    """Extract ``name`` values from a list of dicts or strings."""
    out: set[str] = set()
    for item in items:
        if isinstance(item, str):
            if item:
                out.add(item)
        elif isinstance(item, dict):
            name = item.get("name")
            if isinstance(name, str) and name:
                out.add(name)
    return out
