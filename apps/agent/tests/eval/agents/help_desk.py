"""AppHelpDeskAgent wrapper for ADK evaluation.

This module exposes the AppHelpDeskAgent as root_agent for isolated testing.
"""

from main_agent.agents.orchestrator.app_types.shared.subagents.app_help_desk import (
    app_help_desk_agent,
)

# ADK evaluator expects 'agent' variable
agent = app_help_desk_agent
