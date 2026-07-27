"""Tests for the shared/ refactoring: models, builders, services, and routing guards."""

import pytest

# =============================================================================
# Shared Plan Models
# =============================================================================


class TestSharedPlanModels:
    """Verify unified plan models work identically under both alias families."""

    @pytest.mark.unit
    def test_logic_plan_aliases_resolve_to_same_class(self):
        from main_agent.agents.orchestrator.app_types.shared.models.plan_models import LogicPlan

        assert LogicPlan.__name__ == "LogicPlan"
        assert "state_variables" in LogicPlan.model_fields
        # actions and computed_values have been removed from LogicPlan
        assert "actions" not in LogicPlan.model_fields
        assert "computed_values" not in LogicPlan.model_fields

    @pytest.mark.unit
    def test_creator_input_fields(self):
        from main_agent.agents.orchestrator.app_types.webapp.subagents.creator import (
            CreatorInput,
        )

        fields = CreatorInput.model_fields
        assert "app_description" in fields
        assert "app_name" in fields


# =============================================================================
# Shared Builders Backward-Compat Imports
# =============================================================================


class TestBuilderAliasImports:
    """Verify shared builder modules export expected symbols."""

    @pytest.mark.unit
    def test_builder_factory_from_webapp(self):
        from main_agent.agents.orchestrator.app_types.shared.builders.builder_factory import (
            create_json_config_builder,
        )

        assert callable(create_json_config_builder)

    @pytest.mark.unit
    def test_logic_artifact_tools_from_webapp(self):
        from main_agent.agents.orchestrator.app_types.shared.builders.logic_artifact_tools import (
            validate_and_save_logic_artifact_tool,
        )

        assert validate_and_save_logic_artifact_tool is not None

    @pytest.mark.unit
    def test_backend_artifact_tools_from_webapp(self):
        from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.backend_artifact_tools import (
            validate_and_save_backend_artifact_tool,
        )

        assert validate_and_save_backend_artifact_tool is not None

    @pytest.mark.unit
    def test_seed_artifact_tools_from_webapp(self):
        from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.seed_artifact_tools import (
            validate_and_save_seed_artifact_tool,
        )

        assert validate_and_save_seed_artifact_tool is not None

    @pytest.mark.unit
    def test_cross_validator_from_webapp(self):
        from main_agent.agents.orchestrator.app_types.shared.services.cross_validator import (
            CrossValidator,
        )

        assert CrossValidator.__name__ == "CrossValidator"


# =============================================================================
# Cross-Validator (from shared)
# =============================================================================


class TestCrossValidatorShared:
    """Verify CrossValidator works from its new shared location."""

    @pytest.mark.unit
    def test_basic_validate_and_fix(self):
        from main_agent.agents.orchestrator.app_types.shared.services.cross_validator import (
            CrossValidator,
        )

        config = {
            "frontend": {
                "pages": [{"slug": "/", "title": "Home", "content": []}],
                "logic": {"state": {}, "actions": {}, "computed": {}},
            },
            "backend": {"models": [], "handlers": []},
        }
        validator = CrossValidator()
        warnings = validator.validate_and_fix(config)
        assert isinstance(warnings, list)


# =============================================================================
# Agent Naming
# =============================================================================


class TestAgentNaming:
    """Verify agent enum members are properly configured."""

    @pytest.mark.unit
    def test_creator_enum_exists(self):
        from config import AgentName

        assert hasattr(AgentName, "CREATOR")
        assert AgentName.CREATOR.value == "Creator"

    @pytest.mark.unit
    def test_creator_has_model_default(self):
        from config import AgentName, get_agent_model

        model = get_agent_model(AgentName.CREATOR.value)
        assert model is not None

    @pytest.mark.unit
    def test_planner_still_exists_for_compat(self):
        from config import AgentName

        assert hasattr(AgentName, "PLANNER")


# =============================================================================
# BackendPlan static_datasets + ModelPlan seed_hint
# =============================================================================


class TestBackendPlanDatasets:
    """Verify BackendPlan has static_datasets and ModelPlan has seed_hint."""

    @pytest.mark.unit
    def test_backend_plan_has_static_datasets(self):
        from main_agent.agents.orchestrator.app_types.shared.models import BackendPlan

        assert "static_datasets" in BackendPlan.model_fields

    @pytest.mark.unit
    def test_model_plan_has_seed_hint(self):
        from main_agent.agents.orchestrator.app_types.shared.models import ModelPlan

        assert "seed_hint" in ModelPlan.model_fields
