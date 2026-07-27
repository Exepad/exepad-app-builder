"""Backend builders — model config, handler code, and seed data generation.

All backend building is orchestrated by BackendBuilder, which decomposes
the creator's BackendPlan and runs sub-agents in parallel.
"""

from .backend_builder import BackendBuilder, BackendBuildResult
from .backend_model_builder import BackendModelBuilderInput, backend_model_builder_agent
from .seed_data_builder import SeedDataBuilderInput, seed_data_builder_agent
from .backend_handler_builder import (
    backend_handler_builder_agent,
    BackendHandlerBuilderInput,
)

__all__ = [
    # Orchestrator
    "BackendBuilder",
    "BackendBuildResult",
    # Model builder
    "BackendModelBuilderInput",
    "backend_model_builder_agent",
    # Seed builder
    "SeedDataBuilderInput",
    "seed_data_builder_agent",
    # Handler builder
    "backend_handler_builder_agent",
    "BackendHandlerBuilderInput",
]
