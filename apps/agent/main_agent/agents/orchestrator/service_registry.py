"""
Service registry for PipelineOrchestrator.

Provides a single entry point for constructing and wiring all services
and workflows used by the orchestrator.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Callable, Optional

from google.adk.agents import LlmAgent

if TYPE_CHECKING:
    from .app_types.shared.services.validation_service import ValidationService
    from .app_types.webapp.workflows.creation_workflow import CreationWorkflow
    from .app_types.webapp.workflows.design_import_workflow import DesignImportWorkflow
    from .app_types.webapp.workflows.editing_workflow import EditingWorkflow


@dataclass
class ServiceRegistry:
    """Aggregates all services and workflows required by PipelineOrchestrator.

    Constructed via the ``create()`` class method which instantiates every
    service, wires cross-references, and builds workflow objects.
    """

    validation_service: ValidationService
    creation_workflow: CreationWorkflow
    editing_workflow: Optional[EditingWorkflow]
    design_import_workflow: Optional[DesignImportWorkflow]

    @classmethod
    def create(
        cls,
        *,
        write_result_response_fn: Callable[..., Any],
        emit_chat_directly_fn: Callable[..., Any],
        emit_decline_directly_fn: Callable[..., Any],
        creator_agent: LlmAgent,
        component_builder_agent: LlmAgent,
        component_builder_multiple_agent: Optional[LlmAgent] = None,
        component_builder_polish_agent: Optional[LlmAgent] = None,
        design_system_builder_agent: Optional[LlmAgent] = None,
        editor_agent: Optional[LlmAgent] = None,
        pre_creator_agent: Optional[LlmAgent] = None,
        design_importer_agent: Optional[LlmAgent] = None,
        data_ingester_agent: Optional[LlmAgent] = None,
    ) -> "ServiceRegistry":
        """Build all services + workflows and wire cross-references."""
        from .app_types.shared.services.validation_service import ValidationService
        from .app_types.webapp.workflows.creation_workflow import (
            CreationWorkflow,
        )
        from .app_types.webapp.workflows.editing_workflow import (
            EditingWorkflow,
        )
        from .app_types.webapp.services.codefocus_assembly_service import (
            AssemblyService,
        )
        from .app_types.webapp.services.codefocus_post_processing import (
            PostProcessingService,
        )
        from .app_types.shared.builders import (
            logic_builder_agent as shared_logic_builder,
            BackendBuilder,
            backend_model_builder_agent as shared_model_builder,
            seed_data_builder_agent as shared_seed_builder,
            backend_handler_builder_agent as shared_handler_builder,
        )

        validation_service = ValidationService()

        cf_post_processing = PostProcessingService()
        cf_assembly = AssemblyService()

        backend_builder = BackendBuilder(
            backend_model_builder_agent=shared_model_builder,
            backend_handler_builder_agent=shared_handler_builder,
            seed_data_builder_agent=shared_seed_builder,
        )

        # DataIngester (pre-pass for tabular uploads). Resolve a default
        # if the caller didn't pre-pass one so existing test fixtures that
        # ignore the new arg keep working — the workflow itself gates on
        # ``DATA_INGEST_ENABLED`` before running it.
        if data_ingester_agent is None:
            from .app_types.webapp.subagents.data_ingester import (
                data_ingester_agent as _data_ingester_default,
            )

            data_ingester_agent = _data_ingester_default

        creation_workflow = CreationWorkflow(
            creator_agent=creator_agent,
            component_builder_agent=component_builder_agent,
            design_system_builder_agent=design_system_builder_agent,
            post_processing_service=cf_post_processing,
            assembly_service=cf_assembly,
            write_result_response_fn=write_result_response_fn,
            emit_chat_directly_fn=emit_chat_directly_fn,
            emit_decline_directly_fn=emit_decline_directly_fn,
            validation_service=validation_service,
            logic_builder_agent=shared_logic_builder,
            backend_builder=backend_builder,
            pre_creator_agent=pre_creator_agent,
            design_importer_agent=design_importer_agent,
            data_ingester_agent=data_ingester_agent,
        )

        # ComponentBuilderMultiple is required by EditingWorkflow.
        # Resolve it if the caller didn't pre-pass one.
        if component_builder_multiple_agent is None:
            from .app_types.webapp.subagents.component_builder_multiple import (
                component_builder_multiple_agent as _cbm_default,
            )

            component_builder_multiple_agent = _cbm_default

        # Polish-mode variant (design-import cleanup path). Resolved
        # similarly so callers that don't pass one still get sensible
        # default wiring. EditingWorkflow routes between this and the
        # full agent based on ``StateKeys.EDIT_PLAN_SOURCE``.
        if component_builder_polish_agent is None:
            from .app_types.webapp.subagents.component_builder_multiple import (
                component_builder_polish_agent as _cbm_polish_default,
            )

            component_builder_polish_agent = _cbm_polish_default

        editing_workflow = None
        if editor_agent:
            editing_workflow = EditingWorkflow(
                editor_agent=editor_agent,
                component_builder_agent=component_builder_agent,
                component_builder_multiple_agent=component_builder_multiple_agent,
                component_builder_polish_agent=component_builder_polish_agent,
                post_processing_service=cf_post_processing,
                assembly_service=cf_assembly,
                write_result_response_fn=write_result_response_fn,
                logic_builder_agent=shared_logic_builder,
                backend_builder=backend_builder,
                design_system_builder_agent=design_system_builder_agent,
                validation_service=validation_service,
                data_ingester_agent=data_ingester_agent,
            )

        design_import_workflow = None
        if design_importer_agent and editing_workflow:
            from .app_types.webapp.workflows.design_import_workflow import (
                DesignImportWorkflow,
            )

            design_import_workflow = DesignImportWorkflow(
                editing_workflow=editing_workflow,
                backend_builder=backend_builder,
                design_importer_agent=design_importer_agent,
                validation_service=validation_service,
            )

        return cls(
            validation_service=validation_service,
            creation_workflow=creation_workflow,
            editing_workflow=editing_workflow,
            design_import_workflow=design_import_workflow,
        )
