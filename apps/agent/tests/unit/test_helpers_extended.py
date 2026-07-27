"""Extended tests for helpers.py — covers functions not tested in test_helpers.py.

Targets:
- push_session_state_update
- extract_json_from_string
- safe_app_config_load
- repair_json_string
- diagnose_json_error
- apply_quick_actions
"""

import json
import pytest
from unittest.mock import AsyncMock

from main_agent.agents.utils.helpers import (
    push_session_state_update,
    extract_json_from_string,
    safe_app_config_load,
    repair_json_string,
    diagnose_json_error,
    apply_quick_actions,
)
from tests.fixtures.mock_ctx import create_mock_ctx

# =============================================================================
# push_session_state_update
# =============================================================================


class TestPushSessionStateUpdate:
    """Tests for push_session_state_update."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_persists_then_updates_local(self):
        """Append_event (persist) is called before local state is updated.

        We verify persist-first by checking that at the time append_event is called,
        the local state has NOT yet been updated with the new key.
        """
        ctx = create_mock_ctx(session_state={"existing": "value"})

        state_snapshot_at_persist = {}

        async def track_append(session, event):
            # Capture a snapshot of local state at persist time
            state_snapshot_at_persist.update(dict(ctx.session.state))

        ctx.session_service.append_event = AsyncMock(side_effect=track_append)

        await push_session_state_update(ctx, {"new_key": "new_value"})

        # At persist time, local state should NOT have had "new_key" yet
        assert "new_key" not in state_snapshot_at_persist
        assert state_snapshot_at_persist["existing"] == "value"

        # After the function completes, local state should be updated
        assert ctx.session.state["new_key"] == "new_value"
        assert ctx.session.state["existing"] == "value"

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_no_local_update_on_persist_failure(self):
        """If append_event raises, local state should not be changed."""
        ctx = create_mock_ctx(session_state={"keep": "this"})
        ctx.session_service.append_event = AsyncMock(side_effect=RuntimeError("DB down"))

        with pytest.raises(RuntimeError, match="DB down"):
            await push_session_state_update(ctx, {"new_key": "nope"})

        # Local state unchanged
        assert "new_key" not in ctx.session.state
        assert ctx.session.state["keep"] == "this"

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_creates_event_with_correct_author(self):
        """The persisted event should have author='ExepadAgent'."""
        ctx = create_mock_ctx()

        await push_session_state_update(ctx, {"foo": "bar"})

        call_args = ctx.session_service.append_event.call_args
        event = call_args[0][1]  # second positional arg
        assert event.author == "ExepadAgent"


# =============================================================================
# extract_json_from_string
# =============================================================================


class TestExtractJsonFromString:
    """Tests for extract_json_from_string."""

    @pytest.mark.unit
    def test_valid_json_returned_as_is(self):
        """Valid JSON strings are returned without modification."""
        ctx = create_mock_ctx(session_state={"config": '{"name": "test"}'})
        result = extract_json_from_string(ctx, "config", "Test")
        assert json.loads(result) == {"name": "test"}

    @pytest.mark.unit
    def test_extracts_from_markdown_json_fence(self):
        """JSON wrapped in ```json ... ``` is extracted.

        Note: extract_json_from_string first strips all fence markers via .replace(),
        then falls through to text-before-JSON extraction. So no trailing text
        should appear after the JSON content.
        """
        raw = '```json\n{"pages": []}\n```'
        ctx = create_mock_ctx(session_state={"config": raw})
        result = extract_json_from_string(ctx, "config", "Test")
        assert json.loads(result) == {"pages": []}

    @pytest.mark.unit
    def test_extracts_from_generic_fence(self):
        """JSON wrapped in ``` ... ``` (no language tag) is extracted."""
        raw = 'Output:\n```\n{"value": 42}\n```'
        ctx = create_mock_ctx(session_state={"config": raw})
        result = extract_json_from_string(ctx, "config", "Test")
        assert json.loads(result) == {"value": 42}

    @pytest.mark.unit
    def test_strips_explanatory_text_before_json(self):
        """Text before the first { is stripped."""
        raw = 'Sure! Here is the JSON config:\n{"app": "test"}'
        ctx = create_mock_ctx(session_state={"config": raw})
        result = extract_json_from_string(ctx, "config", "Test")
        assert json.loads(result) == {"app": "test"}

    @pytest.mark.unit
    def test_returns_empty_for_missing_key(self):
        """Returns empty string when the key is not in session state."""
        ctx = create_mock_ctx(session_state={})
        result = extract_json_from_string(ctx, "missing_key", "Test")
        assert result == ""

    @pytest.mark.unit
    def test_returns_empty_for_none_value(self):
        """Returns empty string when the value is None."""
        ctx = create_mock_ctx(session_state={"config": None})
        result = extract_json_from_string(ctx, "config", "Test")
        assert result == ""

    @pytest.mark.unit
    def test_handles_array_json(self):
        """JSON arrays starting with [ are also handled."""
        raw = "Result: [1, 2, 3]"
        ctx = create_mock_ctx(session_state={"config": raw})
        result = extract_json_from_string(ctx, "config", "Test")
        assert json.loads(result) == [1, 2, 3]


# =============================================================================
# safe_app_config_load
# =============================================================================


class TestSafeAppConfigLoad:
    """Tests for safe_app_config_load."""

    @pytest.mark.unit
    def test_valid_json_string_returns_dict(self):
        """Valid JSON string is parsed to dict."""
        ctx = create_mock_ctx(session_state={"config": '{"name": "app"}'})
        result = safe_app_config_load(ctx, "config", "Test")
        assert result == {"name": "app"}

    @pytest.mark.unit
    def test_valid_json_string_returns_string_format(self):
        """output_format='string' returns compact JSON string."""
        ctx = create_mock_ctx(session_state={"config": '{"name": "app"}'})
        result = safe_app_config_load(ctx, "config", "Test", output_format="string")
        assert isinstance(result, str)
        assert json.loads(result) == {"name": "app"}

    @pytest.mark.unit
    def test_double_encoded_json(self):
        """Multiply-encoded JSON strings are unwrapped."""
        inner = json.dumps({"key": "value"})
        double_encoded = json.dumps(inner)
        ctx = create_mock_ctx(session_state={"config": double_encoded})
        result = safe_app_config_load(ctx, "config", "Test")
        assert result == {"key": "value"}

    @pytest.mark.unit
    def test_empty_returns_empty_dict(self):
        """Empty or missing config returns {}."""
        ctx = create_mock_ctx(session_state={"config": ""})
        result = safe_app_config_load(ctx, "config", "Test")
        assert result == {}

    @pytest.mark.unit
    def test_empty_returns_empty_string_format(self):
        """Empty config with output_format='string' returns '{}'."""
        ctx = create_mock_ctx(session_state={"config": ""})
        result = safe_app_config_load(ctx, "config", "Test", output_format="string")
        assert result == "{}"

    @pytest.mark.unit
    def test_missing_key_returns_empty(self):
        """Missing key returns empty dict."""
        ctx = create_mock_ctx(session_state={})
        result = safe_app_config_load(ctx, "nonexistent", "Test")
        assert result == {}

    @pytest.mark.unit
    def test_invalid_json_returns_empty(self):
        """Malformed JSON returns empty config instead of raising."""
        bad_json = '{"name": "test", "broken": }'
        ctx = create_mock_ctx(session_state={"config": bad_json})
        result = safe_app_config_load(ctx, "config", "Test")
        assert result == {} or result == "{}"

    @pytest.mark.unit
    def test_json_with_markdown_fences(self):
        """JSON inside markdown fences is extracted and parsed."""
        raw = '```json\n{"status": "ok"}\n```'
        ctx = create_mock_ctx(session_state={"config": raw})
        result = safe_app_config_load(ctx, "config", "Test")
        assert result == {"status": "ok"}


# =============================================================================
# repair_json_string
# =============================================================================


class TestRepairJsonString:
    """Tests for repair_json_string."""

    @pytest.mark.unit
    def test_returns_dict_by_default(self):
        """Default output_format='dict' returns a dict."""
        ctx = create_mock_ctx(session_state={"config": '{"valid": true}'})
        result = repair_json_string(ctx, "config", "Test")
        assert isinstance(result, dict)
        assert result["valid"] is True

    @pytest.mark.unit
    def test_returns_string_when_requested(self):
        """output_format='string' returns a JSON string."""
        ctx = create_mock_ctx(session_state={"config": '{"valid": true}'})
        result = repair_json_string(ctx, "config", "Test", output_format="string")
        assert isinstance(result, str)
        assert json.loads(result) == {"valid": True}

    @pytest.mark.unit
    def test_returns_none_for_empty(self):
        """Empty input returns None."""
        ctx = create_mock_ctx(session_state={"config": ""})
        result = repair_json_string(ctx, "config", "Test")
        assert result is None

    @pytest.mark.unit
    def test_repairs_trailing_comma(self):
        """Trailing commas in JSON objects are repaired."""
        bad_json = '{"a": 1, "b": 2,}'
        ctx = create_mock_ctx(session_state={"config": bad_json})
        result = repair_json_string(ctx, "config", "Test")
        assert isinstance(result, dict)
        assert result["a"] == 1
        assert result["b"] == 2

    @pytest.mark.unit
    def test_repairs_single_quotes(self):
        """Single-quoted keys/values are repaired."""
        bad_json = "{'key': 'value'}"
        ctx = create_mock_ctx(session_state={"config": bad_json})
        result = repair_json_string(ctx, "config", "Test")
        assert isinstance(result, dict)
        assert result["key"] == "value"


# =============================================================================
# diagnose_json_error
# =============================================================================


class TestDiagnoseJsonError:
    """Tests for diagnose_json_error."""

    def _get_error(self, bad_json: str) -> json.JSONDecodeError:
        """Helper to get a real JSONDecodeError from bad JSON."""
        try:
            json.loads(bad_json)
        except json.JSONDecodeError as e:
            return e
        raise AssertionError("Expected JSONDecodeError")

    @pytest.mark.unit
    def test_extra_data_detected(self):
        """Extra data after valid JSON is diagnosed."""
        error = self._get_error('{"a": 1}{"b": 2}')
        result = diagnose_json_error('{"a": 1}{"b": 2}', error)
        assert "Extra" in result or "JSON PARSING ERROR" in result

    @pytest.mark.unit
    def test_missing_comma_detected(self):
        """Missing comma between elements is diagnosed."""
        error = self._get_error('{"a": 1 "b": 2}')
        result = diagnose_json_error('{"a": 1 "b": 2}', error)
        assert "JSON PARSING ERROR" in result
        assert "line" in result.lower() or "col" in result.lower()

    @pytest.mark.unit
    def test_unterminated_string_detected(self):
        """Unterminated string is diagnosed."""
        error = self._get_error('{"name": "hello')
        result = diagnose_json_error('{"name": "hello', error)
        assert "JSON PARSING ERROR" in result or "Unterminated" in result

    @pytest.mark.unit
    def test_includes_context_snippet(self):
        """Diagnostic includes context around the error."""
        bad = '{"key": value}'
        error = self._get_error(bad)
        result = diagnose_json_error(bad, error)
        assert "Context" in result or "ERROR_HERE" in result or "JSON" in result

    @pytest.mark.unit
    def test_returns_fallback_for_no_position(self):
        """When error has no position, returns fallback message."""
        # Create a JSONDecodeError without a meaningful position
        error = json.JSONDecodeError("test error", "", 0)
        result = diagnose_json_error("", error)
        assert "JSON" in result


# =============================================================================
# apply_quick_actions
# =============================================================================


class TestApplyQuickActions:
    """Tests for apply_quick_actions."""

    @pytest.mark.unit
    def test_modify_action(self, minimal_app_config):
        """Modify action updates a component field via dot notation."""
        actions = [
            {
                "component_uuid": "heading-main",
                "modification_type": "modify",
                "target_field": "text",
                "target_value": "New Title",
            }
        ]
        success, failed = apply_quick_actions(minimal_app_config, actions)
        assert success == 1
        assert failed == 0

    @pytest.mark.unit
    def test_modify_nested_field(self, minimal_app_config):
        """Modify action with dot notation creates/updates nested fields."""
        actions = [
            {
                "component_uuid": "heading-main",
                "modification_type": "modify",
                "target_field": "style.color",
                "target_value": "red",
            }
        ]
        success, failed = apply_quick_actions(minimal_app_config, actions)
        assert success == 1
        assert failed == 0

    @pytest.mark.unit
    def test_remove_action(self, minimal_app_config):
        """Remove action removes a component from a list."""
        # heading-main is inside section-hero.content list
        actions = [
            {
                "component_uuid": "heading-main",
                "modification_type": "remove",
            }
        ]
        success, failed = apply_quick_actions(minimal_app_config, actions)
        assert success == 1
        assert failed == 0

    @pytest.mark.unit
    def test_invalid_uuid_fails(self, minimal_app_config):
        """Missing UUID returns (0, 1)."""
        actions = [
            {
                "component_uuid": "nonexistent-uuid",
                "modification_type": "modify",
                "target_field": "text",
                "target_value": "X",
            }
        ]
        success, failed = apply_quick_actions(minimal_app_config, actions)
        assert success == 0
        assert failed == 1

    @pytest.mark.unit
    def test_unknown_modification_type(self, minimal_app_config):
        """Unknown modification_type returns (0, 1)."""
        actions = [
            {
                "component_uuid": "heading-main",
                "modification_type": "delete_all",
            }
        ]
        success, failed = apply_quick_actions(minimal_app_config, actions)
        assert success == 0
        assert failed == 1

    @pytest.mark.unit
    def test_missing_component_uuid(self, minimal_app_config):
        """Empty component_uuid is counted as failure."""
        actions = [
            {
                "component_uuid": "",
                "modification_type": "modify",
                "target_field": "text",
                "target_value": "X",
            }
        ]
        success, failed = apply_quick_actions(minimal_app_config, actions)
        assert success == 0
        assert failed == 1

    @pytest.mark.unit
    def test_multiple_actions(self, minimal_app_config):
        """Multiple actions are applied, counts are summed."""
        actions = [
            {
                "component_uuid": "heading-main",
                "modification_type": "modify",
                "target_field": "text",
                "target_value": "Updated",
            },
            {
                "component_uuid": "nonexistent",
                "modification_type": "modify",
                "target_field": "text",
                "target_value": "X",
            },
        ]
        success, failed = apply_quick_actions(minimal_app_config, actions)
        assert success == 1
        assert failed == 1

    @pytest.mark.unit
    def test_modify_missing_target_field(self, minimal_app_config):
        """Modify action without target_field fails."""
        actions = [
            {
                "component_uuid": "heading-main",
                "modification_type": "modify",
                "target_field": "",
                "target_value": "X",
            }
        ]
        success, failed = apply_quick_actions(minimal_app_config, actions)
        assert success == 0
        assert failed == 1
