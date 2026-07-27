"""ResultResponseWriterAgent wrapper for ADK evaluation.

This module exposes the ResultResponseWriterAgent as root_agent for isolated testing.
"""

from main_agent.agents.orchestrator.app_types.shared.subagents.chat_response_writer import (
    result_response_writer_agent,
)

# ADK evaluator expects 'agent' variable
agent = result_response_writer_agent
