"""Strip ``<script>`` blocks from imported HTML.

Walks a BeautifulSoup tree (already parsed by the transformer) and:

1. Removes every ``<script>`` element from the tree (mutating in place).
2. Concatenates the bodies into a single JS string for the sidecar
   ``design_import_scripts:{Name}.js`` artifact.
3. Drops well-known analytics / tracking scripts up-front so they
   don't pollute the sidecar (and don't tempt a later behavioral pass
   to translate them).

The transformer never emits ``<script>`` tags in TSX. React components
do not embed runtime scripts; behavior is added by ComponentBuilder
(edit mode) via React hooks per per-component plan items.

External-src scripts (``<script src="...">``) are dropped regardless.
The transformer cannot fetch and translate external code; the sidecar
artifact will note them as warnings for the workflow log.

Public entry: :func:`extract_scripts`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Patterns that identify analytics / tracking scripts. Match against
# the script body's first 1KB AND the ``src`` attribute. Conservative —
# false-positives drop a script the user actually wanted; false-negatives
# leak analytics into the sidecar (mostly harmless, ComponentBuilder will
# also drop them per skill rules).
_ANALYTICS_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bgtag\s*\(", re.IGNORECASE),
    re.compile(r"\bdataLayer\s*=", re.IGNORECASE),
    re.compile(r"google-analytics\.com", re.IGNORECASE),
    re.compile(r"googletagmanager\.com", re.IGNORECASE),
    re.compile(r"\bfbq\s*\(", re.IGNORECASE),
    re.compile(r"connect\.facebook\.net", re.IGNORECASE),
    re.compile(r"\bplausible\s*[\(\.]", re.IGNORECASE),
    re.compile(r"plausible\.io", re.IGNORECASE),
    re.compile(r"\bhj\s*\(", re.IGNORECASE),
    re.compile(r"static\.hotjar\.com", re.IGNORECASE),
    re.compile(r"\bclarity\s*\(", re.IGNORECASE),
    re.compile(r"\.clarity\.ms", re.IGNORECASE),
    re.compile(r"posthog\.(com|init|capture|identify)", re.IGNORECASE),
    re.compile(r"\bsegmentLoader\b", re.IGNORECASE),
    re.compile(r"cdn\.segment\.com", re.IGNORECASE),
    re.compile(r"\bmixpanel\.(init|track)", re.IGNORECASE),
    re.compile(r"\bamplitude\.(init|getInstance)", re.IGNORECASE),
    re.compile(r"\bheap\.(load|track)", re.IGNORECASE),
]

# Claude-Design's placeholder loader leaves these scripts in the body
# after the runner's placeholder transformer has already baked the
# results into real ``<img>`` tags. They're dead code by the time we
# see them.
_PLACEHOLDER_LOADER_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bconst\s+PH\s*=", re.IGNORECASE),
    re.compile(r"\bconst\s+MAP\s*=", re.IGNORECASE),
    re.compile(r"querySelectorAll\s*\(\s*['\"]\.ph", re.IGNORECASE),
    re.compile(r"\bph-label\b", re.IGNORECASE),
]


@dataclass
class ScriptExtractionResult:
    """Outcome of scanning an HTML tree for script blocks."""

    body: str
    """Concatenated bodies of all kept (non-analytics) scripts.

    Empty when no scripts survived filtering. The transformer saves
    this as the ``design_import_scripts:{Name}.js`` sidecar artifact.
    """

    dropped_analytics: int = 0
    """Number of scripts dropped because they matched analytics
    patterns."""

    dropped_external: list[str] = field(default_factory=list)
    """``src`` URLs of external scripts that were dropped (warnings)."""

    dropped_placeholder_loader: int = 0
    """Number of scripts dropped because they were the import bundle's
    placeholder loader (already baked into the DOM by the runner)."""

    low_confidence: bool = False
    """True when the HTML had ``<script type="module">`` or another
    pattern the mechanical pipeline can't handle. The workflow may
    fall back to the legacy LLM ComponentBuilder path."""


def extract_scripts(soup_root) -> ScriptExtractionResult:
    """Remove every ``<script>`` element from ``soup_root`` and return
    the concatenated body of the kept scripts.

    Args:
        soup_root: A BeautifulSoup ``Tag`` or ``BeautifulSoup`` instance.
            The tree is mutated in-place — ``<script>`` elements are
            removed via ``decompose()``.

    Returns:
        A :class:`ScriptExtractionResult` with the kept body and
        diagnostic counters.
    """
    result = ScriptExtractionResult(body="")
    bodies: list[str] = []

    # ``find_all`` returns a snapshot; safe to mutate during iteration.
    for script in soup_root.find_all("script"):
        type_attr = (script.get("type") or "").lower().strip()
        src_attr = (script.get("src") or "").strip()

        # External-src scripts are dropped (we can't translate them).
        if src_attr:
            result.dropped_external.append(src_attr)
            script.decompose()
            continue

        # ``type="module"`` is a low-confidence signal — modern import
        # syntax doesn't translate cleanly to React hooks. Mark and drop.
        if type_attr in ("module", "importmap"):
            result.low_confidence = True
            script.decompose()
            continue

        # Skip type="application/ld+json" and similar data scripts —
        # they're metadata, not behavior.
        if type_attr and type_attr != "text/javascript":
            script.decompose()
            continue

        body = script.string or script.get_text() or ""
        body = body.strip()

        if not body:
            script.decompose()
            continue

        if _is_analytics(body):
            result.dropped_analytics += 1
            script.decompose()
            continue

        if _is_placeholder_loader(body):
            result.dropped_placeholder_loader += 1
            script.decompose()
            continue

        bodies.append(body)
        script.decompose()

    if bodies:
        # Concatenate with double newlines for readability in the sidecar.
        result.body = "\n\n".join(bodies)
    return result


def _is_analytics(body: str) -> bool:
    """Return True when the script body matches an analytics pattern."""
    sample = body[:1024]
    return any(pattern.search(sample) for pattern in _ANALYTICS_PATTERNS)


def _is_placeholder_loader(body: str) -> bool:
    """Return True when the script body is Claude-Design's placeholder loader."""
    sample = body[:1024]
    matches = sum(1 for pattern in _PLACEHOLDER_LOADER_PATTERNS if pattern.search(sample))
    # Require at least 2 distinct markers — single ``MAP =`` could be
    # legitimate user code.
    return matches >= 2
