r"""``component.charts.fraction_percent_mismatch`` — flag chart Y-axis
formatters that template ``${val}%`` while the data is a 0..1 fraction.

Catches the StayNexus dashboard failure where the occupancy chart shows
``0.075%`` instead of ``7.5%``: the handler returns ``rate`` as a 0..1
fraction (per its own comment), but the chart's
``tickFormatter={(val) => `${val}%`}`` appends ``%`` directly. Same
rule fires when the same component renders ``r.rate * 100`` once and
bare ``r.rate`` paired with ``%`` text elsewhere — a unit-confusion
self-contradiction.

Heuristic, never auto-fixed: the rewrite is risky (caller might have
intentionally pre-multiplied), so we only emit warnings.

Detection:

1. Walk every ``<Charts.YAxis>`` element.
2. Look at its ``tickFormatter`` attribute. If the formatter source
   matches ``` `${VAR}%` ``` (or ``"${VAR}%"``) with no ``*100`` and no
   ``toFixed`` chain on a multiplied expression, mark it as a "naked
   percent template".
3. In the same chart wrapper, find ``<Charts.Area|Bar|Line>``-style
   elements with a ``dataKey`` whose value is one of the canonical
   fraction names (``rate``, ``ratio``, ``pct``, ``percent``,
   ``percentage``, ``fraction``) or has the ``_rate`` / ``_pct``
   suffix.
4. If both conditions hold, emit a warning at the YAxis position.
"""

from __future__ import annotations

import re
from typing import Iterator

from ..walker import (
    iter_jsx_opening_elements,
    jsx_attribute_string_value,
    jsx_attribute_value_node,
    jsx_tag_name,
)
from .base import AstContext, Finding

# Canonical fraction-shape field names. Suffix matches (``_rate``,
# ``_pct``) handle compound names without enumerating every domain.
_FRACTION_NAMES: frozenset[str] = frozenset(
    {"rate", "ratio", "pct", "percent", "percentage", "fraction"}
)
_FRACTION_SUFFIXES: tuple[str, ...] = ("_rate", "_pct", "_ratio", "_percent")

# Detect a "naked percent template" — ``\`${ident}%\``` or
# ``"${ident}%"`` — where the substitution is a single bare identifier
# (no math, no ``toFixed``, no ``Math.round``). The bare-identifier
# constraint is what distinguishes this from a correct multiplication.
_NAKED_PERCENT_TPL = re.compile(r"`\s*\$\{\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\}\s*%\s*`")
_MULTIPLY_BY_HUNDRED = re.compile(r"\*\s*100\b")


# Series elements whose ``dataKey`` we consult.
_SERIES_TAGS: frozenset[str] = frozenset({"Charts.Area", "Charts.Bar", "Charts.Line"})


class FractionPercentMismatchRule:
    id = "component.charts.fraction_percent_mismatch"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        # First, collect a set of dataKey values referenced anywhere in
        # the file by series elements. We don't try to scope to the
        # nearest chart wrapper — small-component co-location means
        # "any fraction-shaped key in this file" is a strong enough
        # signal in practice and avoids brittle parent-walking.
        fraction_keys = _collect_fraction_data_keys(ctx)
        if not fraction_keys:
            return

        for element in iter_jsx_opening_elements(ctx.tree.root_node):
            tag = jsx_tag_name(element, ctx.source_buf)
            if tag != "Charts.YAxis":
                continue
            formatter_node = jsx_attribute_value_node(element, "tickFormatter", ctx.source_buf)
            if formatter_node is None:
                continue
            formatter_src = ctx.source_buf[
                formatter_node.start_byte : formatter_node.end_byte
            ].decode("utf-8")
            # Bail if the formatter already multiplies by 100 — the
            # caller is expressing a percent intent already.
            if _MULTIPLY_BY_HUNDRED.search(formatter_src):
                continue
            if not _NAKED_PERCENT_TPL.search(formatter_src):
                continue
            yield Finding(
                rule_id=self.id,
                severity="warning",
                message=(
                    "<Charts.YAxis> tickFormatter renders `${val}%` "
                    "directly, but a sibling chart series uses a "
                    "fraction-shaped dataKey ("
                    f"{', '.join(sorted(fraction_keys))}). "
                    "If your handler returns rate as 0..1, the axis "
                    "will show '0.05%' instead of '5%'. Use "
                    "`${(val * 100).toFixed(0)}%` (or fix the "
                    "handler to return 0..100)."
                ),
                line=element.start_point[0] + 1,
                col=element.start_point[1],
                fix_hint="multiply by 100 in tickFormatter or change handler return shape",
            )


def _collect_fraction_data_keys(ctx: AstContext) -> set[str]:
    """Walk every series element in the file and return the set of
    dataKey strings whose name matches the fraction shape."""
    keys: set[str] = set()
    for element in iter_jsx_opening_elements(ctx.tree.root_node):
        tag = jsx_tag_name(element, ctx.source_buf)
        if tag not in _SERIES_TAGS:
            continue
        key = jsx_attribute_string_value(element, "dataKey", ctx.source_buf)
        if key is None:
            continue
        if key in _FRACTION_NAMES or any(key.endswith(s) for s in _FRACTION_SUFFIXES):
            keys.add(key)
    return keys
