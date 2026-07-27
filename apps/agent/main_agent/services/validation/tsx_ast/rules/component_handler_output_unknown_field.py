"""``component.handlers.unknown_output_field`` — warn when a component
reads a member of a ``useHandler('X')`` binding that the producer
handler doesn't emit.

The bug this catches
--------------------

App ``n1aloggh`` (2026-05-13): ``ReportsContent.tsx`` did:
``opt.totalTco``, ``opt.type`` against the result of
``useHandler('getProjectComparison')``. The handler returned
``{label, categories, oneTime, annualRecurring}`` per option — no
``totalTco``, no ``type``. The frontend rendered ``$NaN`` on every
option card and a $0 "Projected Savings" tile.

The sibling rule ``component.charts.datakey_handler_mismatch`` already
catches this for Recharts ``dataKey=`` / ``nameKey=`` literals. This
rule extends the same producer/consumer cross-check to ALL member
access on handler bindings, not just chart props.

Fail-open contract
------------------

The rule depends on ``ctx.handler_sources``. When unavailable (e.g.,
edit mode before source rehydration, or a workflow that didn't plumb
it through) the rule yields no findings. Same convention as the chart
rule.

Severity
--------

**Warning** — first rollout. Static reasoning about JS member access is
inherently approximate (computed property access, type narrowing,
intermediate object reshaping) so false-positives are likely. Errors
ship to the user as warnings; the agent sees them but isn't forced into
a retry. Promote to ``error`` after telemetry confirms the false-positive
rate is acceptable.
"""

from __future__ import annotations

from typing import Iterator

from ..shape_inference import (
    infer_consumer_field_reads,
    infer_handler_emitted_keys,
)
from .base import AstContext, Finding


# Members commonly accessed on a useHandler() return value that are NOT
# fields the producer emits — they're part of the hook's API surface
# (``data``, ``loading``, ``error``, ``execute``, ``refetch``). Skip
# them so the rule doesn't flag idiomatic usage.
_HOOK_API_MEMBERS: frozenset[str] = frozenset(
    {"data", "loading", "error", "execute", "refetch"}
)


class HandlerOutputUnknownFieldRule:
    """Warn when ``handlerBinding.X`` references an unknown producer key."""

    id = "component.handlers.unknown_output_field"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        if not ctx.handler_sources:
            return  # fail open — no producer source to cross-check

        sites = infer_consumer_field_reads(ctx.tsx)
        if not sites:
            return

        # Cache emitted-keys per handler.
        cache: dict[str, set[str]] = {}

        def _keys_for(handler_name: str) -> set[str]:
            cached = cache.get(handler_name)
            if cached is not None:
                return cached
            src = ctx.handler_sources.get(handler_name) if ctx.handler_sources else None
            keys = infer_handler_emitted_keys(src) if src else set()
            cache[handler_name] = keys
            return keys

        seen: set[tuple[str, str]] = set()
        for site in sites:
            # Producer kind is "handler" for useHandler bindings, "model"
            # for useModel. Only audit handlers — useModel field reads
            # are covered by the model-column cross-reference rules.
            if getattr(site, "producer_kind", None) != "handler":
                continue
            producer = site.producer
            if producer == "unknown" or producer not in ctx.handler_sources:
                continue
            valid_keys = _keys_for(producer)
            if not valid_keys:
                continue  # handler emits no static literals — fail open
            for field_name in site.fields_read:
                if field_name in _HOOK_API_MEMBERS:
                    continue
                if field_name in valid_keys:
                    continue
                key = (producer, field_name)
                if key in seen:
                    continue
                seen.add(key)
                # Take the first read site's line/col for the finding location.
                line, col = site.sites[0] if site.sites else (1, 0)
                yield Finding(
                    rule_id=self.id,
                    severity="warning",
                    line=line,
                    col=col,
                    message=(
                        f"useHandler('{producer}') return value has no field "
                        f"'{field_name}'. Producer emits: "
                        f"{sorted(valid_keys)}."
                    ),
                    fix_hint=(
                        f"Either pick an existing key from "
                        f"{sorted(valid_keys)}, or update the "
                        f"'{producer}' handler to emit '{field_name}'."
                    ),
                )
