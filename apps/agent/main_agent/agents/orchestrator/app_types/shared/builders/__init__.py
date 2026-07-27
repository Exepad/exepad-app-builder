"""Shared builders for app generation.

Backend builders (model, handler, seed) are under backend_builders/.
Logic builder and shared utilities remain here.
"""

from .logic_builder import LogicBuilderInput, logic_builder_agent
from .builder_factory import create_json_config_builder

# Re-export backend builders from new location
from .backend_builders import (
    BackendBuilder,
    BackendBuildResult,
    BackendModelBuilderInput,
    backend_model_builder_agent,
    SeedDataBuilderInput,
    seed_data_builder_agent,
    backend_handler_builder_agent,
)

__all__ = [
    # Logic
    "LogicBuilderInput",
    "logic_builder_agent",
    # Factory
    "create_json_config_builder",
    # Backend builders (re-exported)
    "BackendBuilder",
    "BackendBuildResult",
    "BackendModelBuilderInput",
    "backend_model_builder_agent",
    "SeedDataBuilderInput",
    "seed_data_builder_agent",
    "backend_handler_builder_agent",
]
