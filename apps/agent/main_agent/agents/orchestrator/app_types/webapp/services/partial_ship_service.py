"""Partial-ship decision: split unresolved-component failures into
fatal vs recoverable.

The Onix Studio post-mortem found the platform was throwing away
already-built components (MainHeader / MainFooter) when one of three
failed (HomeContent). Placeholder logic existed but the abort block
fired regardless — so the user got "Nothing was saved or deployed."

This module is the routing layer used by both creation and editing
workflows when the abort block decides what to do with
``unresolved_components``:

- If ANY component has a fatal failure class
  (:data:`FATAL_FAILURE_CLASSES` in
  ``component_failure_service``) → abort the build (existing flow).

- If only RECOVERABLE failures exist AND
  :data:`config.ENABLE_PARTIAL_SHIP` is on → ship with the
  placeholder TSX already saved by the save-tool, surface a warning
  in the chat response, continue to assembly + deploy.

- If only RECOVERABLE failures but the flag is OFF → abort
  (preserves pre-Pattern-C behaviour during gated rollout).
"""

from __future__ import annotations

from dataclasses import dataclass

import config
from main_agent.agents.orchestrator.app_types.webapp.services.component_failure_service import (
    is_fatal_component_failure,
)


@dataclass
class PartialShipDecision:
    """Outcome of routing one workflow's unresolved components.

    Fields:
        should_abort: True when at least one fatal failure exists OR
            partial-ship is disabled. Caller should run the existing
            ``build_component_generation_failure`` path.
        ship_partial: True when partial-ship is enabled and only
            recoverable failures remain. Caller should run the
            ``build_component_generation_warning`` path and continue
            to assembly.
        fatal_components: Names of components with fatal classes.
        recoverable_components: Names of components with non-fatal
            classes (these have placeholder TSX saved already).
    """

    should_abort: bool
    ship_partial: bool
    fatal_components: list[str]
    recoverable_components: list[str]


def decide(
    all_unresolved: dict[str, str],
    failure_classes: dict[str, str | None],
) -> PartialShipDecision:
    """Route an unresolved-component set to either abort or partial ship.

    Args:
        all_unresolved: Map of ``component_name → reason_string`` from
            session state. The full set of components that failed.
        failure_classes: Map of ``component_name → failure_class`` (or
            None). When a class is missing for a component, it's
            treated as recoverable — conservative: unclassified
            failures fall into the partial-ship bucket so the gating
            flag controls behaviour rather than the absence of
            classification data.

    Returns:
        :class:`PartialShipDecision` describing what the caller should
        do. The decision is pure — no state mutation here.
    """
    if not all_unresolved:
        # No failures at all — caller shouldn't even be here.
        return PartialShipDecision(
            should_abort=False,
            ship_partial=False,
            fatal_components=[],
            recoverable_components=[],
        )

    fatal: list[str] = []
    recoverable: list[str] = []
    for name in all_unresolved:
        cls = failure_classes.get(name)
        if is_fatal_component_failure(cls):
            fatal.append(name)
        else:
            recoverable.append(name)

    if fatal:
        # At least one component can't be salvaged — abort.
        return PartialShipDecision(
            should_abort=True,
            ship_partial=False,
            fatal_components=fatal,
            recoverable_components=recoverable,
        )

    if config.ENABLE_PARTIAL_SHIP:
        return PartialShipDecision(
            should_abort=False,
            ship_partial=True,
            fatal_components=[],
            recoverable_components=recoverable,
        )

    # Recoverable failures exist but partial-ship is gated off.
    # Preserves pre-Pattern-C behaviour during rollout.
    return PartialShipDecision(
        should_abort=True,
        ship_partial=False,
        fatal_components=[],
        recoverable_components=recoverable,
    )
