"""Central registry for active ADK eval wrappers and docs-facing labels."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EvalAgentSpec:
    """Single ADK-evaluated agent entry."""

    key: str
    description: str
    agent_module: str
    fast_eval_path: str
    rubric_eval_path: str
    marker: str
    docs_label: str


ACTIVE_EVAL_SPECS: tuple[EvalAgentSpec, ...] = (
    EvalAgentSpec(
        key="help_desk",
        description="Routing: AppHelpDeskAgent",
        agent_module="tests.eval.agents.help_desk",
        fast_eval_path="routing/help_desk",
        rubric_eval_path="routing/help_desk_rubric",
        marker="eval_routing",
        docs_label="AppHelpDeskAgent",
    ),
    EvalAgentSpec(
        key="response_writer",
        description="Support: ResultResponseWriter",
        agent_module="tests.eval.agents.response_writer",
        fast_eval_path="support/response_writer",
        rubric_eval_path="support/response_writer_rubric",
        marker="eval_support",
        docs_label="ResultResponseWriter",
    ),
)


AGENT_EVAL_CONFIGS_FAST = [
    (spec.fast_eval_path, spec.agent_module, spec.description, spec.marker)
    for spec in ACTIVE_EVAL_SPECS
]

AGENT_EVAL_CONFIGS_RUBRIC = [
    (spec.rubric_eval_path, spec.agent_module, spec.description, spec.marker)
    for spec in ACTIVE_EVAL_SPECS
]


AGENT_MODULES = {spec.key: spec.agent_module for spec in ACTIVE_EVAL_SPECS}


BUILDING_CONFIDENCE_NOTE = (
    "Building-layer confidence comes from deterministic replay and pipeline tests, "
    "not ADK eval wrappers."
)
