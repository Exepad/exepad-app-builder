"""Tests for validation.frontend — expression syntax and action reference validation."""

import pytest

# ===========================================================================
# Expression syntax validation
# ===========================================================================


class TestValidateExpressionSyntax:
    @pytest.fixture(autouse=True)
    def _import(self):
        from validation import validate_expression_syntax

        self.validate = validate_expression_syntax

    @pytest.mark.unit
    def test_valid_simple_expression(self):
        errors = self.validate("{{state.count}}", "root.text")
        assert errors == []

    @pytest.mark.unit
    def test_valid_computed_expression(self):
        errors = self.validate("{{computed.total}}", "root.text")
        assert errors == []

    @pytest.mark.unit
    def test_valid_expression_with_function(self):
        errors = self.validate("{{state.items.filter(x => x.active)}}", "root.text")
        assert errors == []

    @pytest.mark.unit
    def test_valid_nested_quotes(self):
        errors = self.validate("{{\"he said 'hi'\"}}", "root.text")
        assert errors == []

    @pytest.mark.unit
    def test_no_expression_no_error(self):
        errors = self.validate("plain text without expressions", "root.text")
        assert errors == []

    @pytest.mark.unit
    def test_multiple_expressions_in_one_string(self):
        errors = self.validate("{{state.a}} and {{state.b}}", "root.text")
        assert errors == []

    @pytest.mark.unit
    def test_empty_expression(self):
        errors = self.validate("{{}}", "root.text")
        assert len(errors) == 1
        assert "Empty expression" in errors[0]

    @pytest.mark.unit
    def test_empty_expression_with_spaces(self):
        errors = self.validate("{{  }}", "root.text")
        assert len(errors) == 1
        assert "Empty expression" in errors[0]

    @pytest.mark.unit
    def test_invalid_prefix_dollar(self):
        errors = self.validate("${{state.count}}", "root.text")
        assert len(errors) >= 1
        assert any("Invalid character" in e and "$" in e for e in errors)

    @pytest.mark.unit
    def test_invalid_prefix_at(self):
        errors = self.validate("@{{state.count}}", "root.text")
        assert len(errors) >= 1
        assert any("Invalid character" in e for e in errors)

    @pytest.mark.unit
    def test_unbalanced_parens(self):
        errors = self.validate("{{func(a, b}}", "root.text")
        assert len(errors) >= 1
        assert any("Unclosed '('" in e for e in errors)

    @pytest.mark.unit
    def test_unbalanced_brackets(self):
        errors = self.validate("{{arr[0}}", "root.text")
        assert len(errors) >= 1
        assert any("Unclosed '['" in e for e in errors)

    @pytest.mark.unit
    def test_unbalanced_double_quote(self):
        errors = self.validate('{{state.name + "hello}}', "root.text")
        assert len(errors) >= 1
        assert any("double quote" in e.lower() for e in errors)


# ===========================================================================
# Expression reference validation
# ===========================================================================


class TestValidateExpressionReferences:
    @pytest.fixture(autouse=True)
    def _import(self):
        from validation import validate_expression_references

        self.validate = validate_expression_references

    @pytest.mark.unit
    def test_valid_state_reference(self):
        warnings = self.validate("{{state.count}}", "root.text", {"count"}, set())
        assert warnings == []

    @pytest.mark.unit
    def test_valid_computed_reference(self):
        warnings = self.validate("{{computed.total}}", "root.text", set(), {"total"})
        assert warnings == []

    @pytest.mark.unit
    def test_undefined_state_field_warning(self):
        warnings = self.validate("{{state.missing}}", "root.text", {"count"}, set())
        assert len(warnings) == 1
        assert "state.missing" in warnings[0]

    @pytest.mark.unit
    def test_undefined_computed_field_warning(self):
        warnings = self.validate("{{computed.missing}}", "root.text", set(), {"total"})
        assert len(warnings) == 1
        assert "computed.missing" in warnings[0]

    @pytest.mark.unit
    def test_empty_state_fields_skips_check(self):
        warnings = self.validate("{{state.anything}}", "root.text", set(), set())
        assert warnings == []

    @pytest.mark.unit
    def test_empty_computed_fields_skips_check(self):
        warnings = self.validate("{{computed.anything}}", "root.text", set(), set())
        assert warnings == []

    @pytest.mark.unit
    def test_multiple_references_mixed(self):
        warnings = self.validate(
            "{{state.a}} + {{computed.b}}",
            "root.text",
            {"a"},
            {"total"},  # b is NOT in computed
        )
        assert len(warnings) == 1
        assert "computed.b" in warnings[0]


# ===========================================================================
# Recursive expression scanning
# ===========================================================================


class TestValidateAllExpressions:
    @pytest.fixture(autouse=True)
    def _import(self):
        from validation import validate_all_expressions

        self.validate = validate_all_expressions

    @pytest.mark.unit
    def test_recursive_scan_finds_nested_expressions(self):
        data = {"level1": {"level2": {"text": "{{func(a}}"}}}
        errors, warnings = self.validate(data)
        assert len(errors) >= 1
        assert any("Unclosed '('" in e for e in errors)

    @pytest.mark.unit
    def test_recursive_scan_traverses_lists(self):
        data = {"items": [{"text": "{{state.a}}"}, {"text": "${{state.b}}"}]}
        errors, warnings = self.validate(data)
        assert any("Invalid character" in e for e in errors)

    @pytest.mark.unit
    def test_returns_errors_and_warnings_tuple(self):
        result = self.validate({"text": "hello"})
        assert isinstance(result, tuple)
        assert len(result) == 2
        errors, warnings = result
        assert isinstance(errors, list)
        assert isinstance(warnings, list)

    @pytest.mark.unit
    def test_no_state_fields_skips_references(self):
        data = {"text": "{{state.anything}}"}
        errors, warnings = self.validate(data, None, None)
        assert warnings == []


# ===========================================================================
# Action extraction
# ===========================================================================


class TestExtractDefinedActions:
    @pytest.fixture(autouse=True)
    def _import(self):
        from validation import _extract_defined_actions

        self.extract = _extract_defined_actions

    @pytest.mark.unit
    def test_new_format_frontend_logic_actions(self):
        config = {"frontend": {"logic": {"actions": {"submit": {}, "reset": {}}}}}
        result = self.extract(config)
        assert result == {"submit", "reset"}

    @pytest.mark.unit
    def test_legacy_format_root_actions(self):
        config = {"actions": {"save": {}, "delete": {}}}
        result = self.extract(config)
        assert result == {"save", "delete"}

    @pytest.mark.unit
    def test_no_actions_defined(self):
        config = {"frontend": {}}
        result = self.extract(config)
        assert result == set()


# ===========================================================================
# Action reference validation
# ===========================================================================


class TestValidateActionReferences:
    @pytest.fixture(autouse=True)
    def _import(self):
        from validation import validate_action_references

        self.validate = validate_action_references

    @pytest.mark.unit
    def test_defined_action_no_error(self):
        data = {
            "frontend": {
                "pages": [{"content": [{"action": {"name": "submit"}}]}],
            }
        }
        errors = self.validate(data, {"submit"})
        assert errors == []

    @pytest.mark.unit
    def test_undefined_action_with_suggestions(self):
        data = {
            "frontend": {
                "pages": [{"content": [{"action": {"name": "missing"}}]}],
            }
        }
        errors = self.validate(data, {"submit", "save"})
        assert len(errors) >= 1
        assert any("missing" in e and ("submit" in e or "save" in e) for e in errors)

    @pytest.mark.unit
    def test_undefined_action_no_actions_defined(self):
        data = {
            "frontend": {
                "pages": [{"content": [{"action": {"name": "submit"}}]}],
            }
        }
        errors = self.validate(data, set())
        assert len(errors) >= 1
        assert any("no actions are defined" in e for e in errors)

    @pytest.mark.unit
    def test_nested_action_trigger_found(self):
        data = {
            "frontend": {
                "pages": [
                    {"content": [{"children": [{"nested": [{"action": {"name": "deep_action"}}]}]}]}
                ]
            }
        }
        errors = self.validate(data, {"other_action"})
        assert len(errors) >= 1
        assert any("deep_action" in e for e in errors)

    @pytest.mark.unit
    @pytest.mark.parametrize("prop", ["onChange", "onSubmit", "onSelect", "onValueChange"])
    def test_various_trigger_properties(self, prop):
        data = {
            "frontend": {
                "pages": [{"content": [{prop: {"name": "myAction"}}]}],
            }
        }
        errors = self.validate(data, {"otherAction"})
        assert len(errors) >= 1
        assert any("myAction" in e for e in errors)
