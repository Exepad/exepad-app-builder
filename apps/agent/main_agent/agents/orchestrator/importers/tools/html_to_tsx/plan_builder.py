"""Phase-5 building-plan augmentation.

Inspects the post-walk JSX, the extracted JS body, and the backend
surface to emit per-component ``building_plan`` items that
ComponentBuilder consumes in edit mode. Two sub-passes:

**5a — Behavioral residuals.** Phase 3 wraps every JS body in a single
``React.useEffect`` block. That works for most patterns but fails for
*DOM-mutation* operations (``replaceWith``, ``innerHTML =``,
``outerHTML =``, ``insertBefore``) — React's reconciliation restores
the original DOM on the next render. When the residual contains such
patterns, we emit a plan item asking ComponentBuilder to translate
them into React state.

**5b — Wiring candidates.** Static repeating elements, inline SVG
charts, and map placeholders are commonly meant to be bound to
backend data. When the workflow declared matching backend models /
handlers, we emit plan items describing each candidate and the
available backend names. ComponentBuilder makes the actual
substitution decisions in edit mode — never inventing names that
aren't in ``backend_surface``.

For Path B (no backend declared) and Path C (backend declared but no
candidates detected), the plan is empty — ComponentBuilder either
runs as a no-op or doesn't run at all.

Public entry: :func:`build_plan_items`.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

# ---------------------------------------------------------------------------
# 5a Behavioral residual patterns
# ---------------------------------------------------------------------------

_DOM_MUTATION_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\.replaceWith\s*\("), "replaceWith"),
    (re.compile(r"\.innerHTML\s*="), "innerHTML"),
    (re.compile(r"\.outerHTML\s*="), "outerHTML"),
    (re.compile(r"\.parentNode\.insertBefore\b"), "parentNode.insertBefore"),
    (re.compile(r"\.parentNode\.removeChild\b"), "parentNode.removeChild"),
    (re.compile(r"\.appendChild\s*\(\s*document\.createElement"), "DOM appendChild"),
]

# ---------------------------------------------------------------------------
# 5b Wiring candidate patterns
# ---------------------------------------------------------------------------

# Match an open tag with a className. Captures (tag_name, className_value).
# Excludes ``<span>`` / ``<small>`` / ``<em>`` / ``<strong>`` since those
# are typically inline formatting, not data-binding candidates.
_TAG_WITH_CLASS_RE = re.compile(
    r'<(?P<tag>[a-zA-Z][a-zA-Z0-9]*)\s+[^>]*?className="(?P<cls>[^"]+)"'
)
_INLINE_FORMATTING_TAGS: frozenset[str] = frozenset(
    {"span", "small", "em", "strong", "b", "i", "u", "mark", "sub", "sup"}
)
_REPEATING_LEAF_MIN_COUNT = 2

# Inline SVG charts: an ``<svg>`` block whose contents include at least
# three of ``<rect>`` / ``<circle>`` / ``<path>`` (data-shape elements)
# typically denotes a bar / scatter / area chart.
_SVG_BLOCK_RE = re.compile(r"<svg\b[^>]*>(?P<body>.*?)</svg>", re.DOTALL)
_CHART_SHAPE_RE = re.compile(r"<(?:rect|circle|path|line|polyline|polygon)\b")
_CHART_SHAPE_MIN_COUNT = 3

# Map placeholders: any element whose className contains a map-related
# token. Conservative — only triggers a plan item when the building_plan
# (Creator's hint) explicitly mentions map embedding.
_MAP_CLASS_RE = re.compile(r'className="[^"]*\b(?:map|mapbox|leaflet|gmap)\b[^"]*"')
_MAP_PLAN_HINT_RE = re.compile(r"\bmap\b", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def build_plan_items(
    *,
    jsx_body: str,
    scripts_js: str,
    component_name: str,
    backend_surface: dict[str, Any] | None = None,
    building_plan: list[str] | None = None,
) -> list[str]:
    """Compose per-component building_plan items.

    Args:
        jsx_body: The post-walk JSX body (after Phase 4 mobile-nav
            scaffold injection).
        scripts_js: Concatenated JS body extracted from
            ``<script>`` tags. Empty when source had no scripts.
        component_name: PascalCase component name. Used to reference
            the sidecar JS artifact in plan items.
        backend_surface: Dict with optional ``models`` and
            ``handlers`` keys. When non-empty, wiring detectors run.
        building_plan: Creator's plan hints (list of strings).
            Currently scanned for the keyword ``map`` to gate the
            map-placeholder detector.

    Returns:
        List of plan-item strings. Empty list means
        ComponentBuilder has no surgical work to do — the mechanical
        TSX is the final output for this component.
    """
    items: list[str] = []

    behavioral = _behavioral_residual_item(scripts_js, component_name)
    if behavioral:
        items.append(behavioral)

    if backend_surface:
        repeating = _repeating_leaves_item(jsx_body, backend_surface)
        if repeating:
            items.append(repeating)

        chart = _chart_candidate_item(jsx_body, backend_surface)
        if chart:
            items.append(chart)

    if building_plan and _plan_mentions_map(building_plan):
        map_item = _map_candidate_item(jsx_body)
        if map_item:
            items.append(map_item)

    return items


# ---------------------------------------------------------------------------
# 5a Behavioral residual
# ---------------------------------------------------------------------------


def _behavioral_residual_item(scripts_js: str, component_name: str) -> str | None:
    """Emit a plan item when the JS body contains DOM-mutation
    patterns the useEffect-wrap can't safely handle.
    """
    if not scripts_js.strip():
        return None

    detected: list[str] = []
    for pattern, label in _DOM_MUTATION_PATTERNS:
        if pattern.search(scripts_js):
            detected.append(label)
    if not detected:
        return None

    deduped = sorted(set(detected))
    return (
        f"BEHAVIORAL: The mechanical pipeline wrapped the source JS in a single "
        f"`React.useEffect`, but the script contains DOM-mutation operations "
        f"({', '.join(deduped)}) that React's reconciliation undoes on every "
        f"re-render. Load `design_import_scripts:{component_name}.js` and "
        f"translate these specific operations into React state — track the "
        f"post-mutation content with `useState` and render it conditionally. "
        f"Do not change any visible source content; only convert the mutation "
        f"to a state-driven re-render."
    )


# ---------------------------------------------------------------------------
# 5b Wiring: repeating leaves
# ---------------------------------------------------------------------------


def _repeating_leaves_item(jsx_body: str, backend_surface: dict[str, Any]) -> str | None:
    """Detect ≥2 sibling elements with the same (tag, className).

    Emits a plan item listing the candidates plus the available
    backend models / handlers. ComponentBuilder picks the matching
    binding in edit mode (or leaves the literal repeat in place when
    nothing matches).
    """
    pairs = Counter(
        (m.group("tag").lower(), m.group("cls")) for m in _TAG_WITH_CLASS_RE.finditer(jsx_body)
    )
    candidates = [
        (tag, cls, count)
        for (tag, cls), count in pairs.items()
        if count >= _REPEATING_LEAF_MIN_COUNT and tag not in _INLINE_FORMATTING_TAGS
    ]
    if not candidates:
        return None

    model_names = _names(backend_surface.get("models") or [])
    handler_names = _names(backend_surface.get("handlers") or [])
    if not model_names and not handler_names:
        return None

    candidate_lines = "\n".join(
        f'  - <{tag} className="{cls}"> × {count}' for tag, cls, count in candidates
    )
    return (
        f"WIRING: detected repeating elements that may bind to backend data. "
        f"For each candidate below, if a model or handler in `backend_surface` "
        f"represents the items, replace the static repeat with "
        f"`useModel('<name>').data?.map((item) => …)` (or "
        f"`useHandler('<name>').data?.map(…)` for read-only data). Use "
        f"`{{item.field ?? 'original-text'}}` templating with the source "
        f"text as the fallback so original content survives in the source "
        f"for grep/diff. Never invent a model name not in the list.\n"
        f"Available models: {', '.join(model_names) or '(none)'}.\n"
        f"Available handlers: {', '.join(handler_names) or '(none)'}.\n"
        f"Candidates:\n{candidate_lines}"
    )


# ---------------------------------------------------------------------------
# 5b Wiring: chart candidates
# ---------------------------------------------------------------------------


def _chart_candidate_item(jsx_body: str, backend_surface: dict[str, Any]) -> str | None:
    """Detect inline SVG blocks shaped like a chart and check whether
    a handler is available to feed the data.
    """
    chart_blocks: list[str] = []
    for m in _SVG_BLOCK_RE.finditer(jsx_body):
        body = m.group("body")
        shape_count = len(_CHART_SHAPE_RE.findall(body))
        if shape_count >= _CHART_SHAPE_MIN_COUNT:
            chart_blocks.append(body[:80])  # snippet for the plan

    if not chart_blocks:
        return None

    handler_names = _names(backend_surface.get("handlers") or [])
    if not handler_names:
        return None

    return (
        f"WIRING: detected {len(chart_blocks)} inline `<svg>` block(s) shaped "
        f"like a chart (≥3 data-shape elements: rect/circle/path). If a "
        f"handler in `backend_surface.handlers` returns matching data, "
        f"replace the SVG with `<Charts.BarChart data={{useHandler('<name>').data ?? []}} />` "
        f"(or LineChart / PieChart / AreaChart depending on the source shape). "
        f"Preserve the surrounding container and labels.\n"
        f"Available handlers: {', '.join(handler_names)}."
    )


# ---------------------------------------------------------------------------
# 5b Wiring: map candidates
# ---------------------------------------------------------------------------


_MAP_CLASS_CAPTURE_RE = re.compile(r'className="([^"]*\b(?:map|mapbox|leaflet|gmap)\b[^"]*)"')


def _map_candidate_item(jsx_body: str) -> str | None:
    """Detect elements with map-related className tokens."""
    matches = _MAP_CLASS_CAPTURE_RE.findall(jsx_body)
    if not matches:
        return None
    classnames = ", ".join(f'"{cls}"' for cls in matches)
    return (
        f"WIRING: detected {len(matches)} element(s) with a map-related "
        f"className ({classnames}) and the building_plan mentions map "
        f"embedding. Replace the placeholder with "
        f"`<MapEmbed center={{[lat, lng]}} markers={{[…]}} />` from "
        f"`@exepad/sdk`. Use a backend model (`useModel('<places>').data`) "
        f"for markers when one is declared; otherwise hardcode the markers "
        f"from the building_plan or seed."
    )


def _plan_mentions_map(building_plan: list[str]) -> bool:
    return any(_MAP_PLAN_HINT_RE.search(line) for line in building_plan if line)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _names(items: list[Any]) -> list[str]:
    """Extract ``name`` fields from a list of dicts or strings."""
    out: list[str] = []
    for item in items:
        if isinstance(item, str):
            out.append(item)
        elif isinstance(item, dict):
            name = item.get("name")
            if isinstance(name, str) and name:
                out.append(name)
    return out
