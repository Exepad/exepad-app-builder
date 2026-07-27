"""
Logic surface builder for ComponentBuilder agent.

Builds a ``LogicSurface`` JSON string that bundles:
- App-specific state variables (name, initial value, inferred type)
- State usage guide (useAppState, useArrayState, useApp patterns)

The surface tells the component builder which shared state variables
exist and how to consume them — the sole source of truth for
state interaction patterns.
"""

import structlog
from typing import Any
from pydantic import BaseModel, Field
from main_agent.agents.utils.agent_docs_loader import load_agent_doc

logger = structlog.get_logger(__name__)


# =============================================================================
# Helpers
# =============================================================================


def _load_guide(path: str) -> str:
    """Load a guide doc, returning empty string on failure."""
    try:
        return load_agent_doc(path)
    except FileNotFoundError:
        logger.warning("Guide doc not found", path=path)
        return ""


def _infer_type(value: Any) -> str:
    """Infer a human-readable type string from a state variable's initial value."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        # $persist pattern: { "$persist": true, "initial": <value> }
        if "$persist" in value:
            return _infer_type(value.get("initial"))
        return "object"
    return "unknown"


# =============================================================================
# Surface Models
# =============================================================================


class StateVariableSurface(BaseModel):
    """A single state variable from frontend.logic.state."""

    name: str
    initial_value: Any = None
    type: str = "null"


class StateSurface(BaseModel):
    """State variables available to code components.

    Contains all app-specific shared state variables plus the usage guide
    that explains useAppState, useArrayState, useApp patterns, derived
    values, and $persist behavior.
    """

    items: list[StateVariableSurface] = Field(default_factory=list)
    guide: str = ""


class LogicSurface(BaseModel):
    """Logic surface for code components.

    Contains app-specific state variables with usage guide.
    """

    state: StateSurface | None = None


# =============================================================================
# Builder
# =============================================================================


def build_logic_surface(logic_config: dict | None) -> str:
    """Build a JSON logic surface string for ComponentBuilder.

    Extracts state variables from ``frontend.logic`` (or parsed logic.json),
    infers types from initial values, and attaches the state usage guide.
    Returns empty string if no state variables exist.

    Args:
        logic_config: The ``frontend.logic`` dict from app_config or parsed
            logic.json artifact. Expected shape: ``{"state": {"key": value}}``.
    """
    if not logic_config:
        return ""

    state_raw = logic_config.get("state", {})
    if not state_raw or not isinstance(state_raw, dict):
        return ""

    items = []
    for name, value in state_raw.items():
        # For $persist entries, surface the initial value
        initial = value
        if isinstance(value, dict) and "$persist" in value:
            initial = value.get("initial")

        items.append(
            StateVariableSurface(
                name=name,
                initial_value=initial,
                type=_infer_type(value),
            )
        )

    if not items:
        return ""

    state_surface = StateSurface(
        items=items,
        guide=_load_guide("surfaces/logic_surface/docs/STATE_USAGE_GUIDE.md"),
    )

    surface = LogicSurface(state=state_surface)
    return surface.model_dump_json(exclude_none=True)
