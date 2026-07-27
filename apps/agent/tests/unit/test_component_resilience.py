"""Tests for component-failure resilience: classifier, placeholder, component_issues.

These back up the platform-robustness change: the build no longer aborts on
recoverable per-component validation failures. Recoverable components ship as
placeholder artifacts and surface in ``component_issues`` so the editor can
show a fix-list to the user.
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services.component_failure_service import (
    FATAL_FAILURE_CLASSES,
    build_component_generation_warning,
    build_component_issues,
    build_placeholder_component_tsx,
    is_fatal_component_failure,
)
from main_agent.constants import StateKeys

pytestmark = [pytest.mark.unit]


class TestIsFatalComponentFailure:
    def test_unwired_filter_state_is_recoverable(self):
        # `validation_failed` is the generic classifier bucket for things
        # like `component.refs.unwired_filter_state` — the original bug.
        assert is_fatal_component_failure("validation_failed") is False

    def test_contrast_is_recoverable(self):
        assert is_fatal_component_failure("contrast_token_mismatch") is False

    def test_forbidden_document_api_is_recoverable(self):
        # The component renders; only the offending handler/effect fails at
        # runtime. Placeholder is preferable to aborting the whole build.
        assert is_fatal_component_failure("forbidden_document_api") is False

    def test_jsx_syntax_error_is_fatal(self):
        assert is_fatal_component_failure("jsx_syntax_error") is True

    def test_jsx_tag_corruption_is_recoverable(self):
        # Under the always-ship contract, only esbuild parse failure
        # blocks save. Tag-corruption maps to a recoverable class.
        assert is_fatal_component_failure("jsx_tag_corruption") is False

    def test_none_and_empty_are_not_fatal(self):
        assert is_fatal_component_failure(None) is False
        assert is_fatal_component_failure("") is False

    def test_fatal_set_documented(self):
        # The module-level constant is the contract; callers read it to
        # decide whether to abort. Guard against accidental shrinkage.
        assert "jsx_syntax_error" in FATAL_FAILURE_CLASSES
        assert "validation_failed" not in FATAL_FAILURE_CLASSES


class TestBuildPlaceholderComponentTsx:
    def test_uses_lightdomcontainer_and_exports_default(self):
        tsx = build_placeholder_component_tsx(
            "PetsContent",
            "Filter state 'petSpecies' is not wired into useHandler",
            failure_class="validation_failed",
        )
        assert "<LightDOMContainer>" in tsx
        assert "export default PetsContent" in tsx
        assert "function PetsContent()" in tsx

    def test_imports_only_from_exepad_sdk(self):
        tsx = build_placeholder_component_tsx("X", "reason")
        # Exactly one import, pointing at @exepad/sdk.
        imports = [ln for ln in tsx.splitlines() if ln.startswith("import ")]
        assert len(imports) == 1
        assert '"@exepad/sdk"' in imports[0]

    def test_escapes_dangerous_characters_in_reason(self):
        # Braces would break JSX text interpolation; backticks would break
        # a template literal if we ever embedded the reason in one.
        tsx = build_placeholder_component_tsx("X", "breaking {braces} and `backticks`")
        assert "breaking (braces) and 'backticks'" in tsx
        assert "{braces}" not in tsx

    def test_caps_reason_length(self):
        long = "x" * 2000
        tsx = build_placeholder_component_tsx("X", long)
        assert "..." in tsx
        assert "x" * 2000 not in tsx

    def test_no_data_hooks_or_browser_apis(self):
        tsx = build_placeholder_component_tsx("X", "reason")
        assert "useModel" not in tsx
        assert "useHandler" not in tsx
        assert "document." not in tsx
        assert "window." not in tsx


class TestBuildComponentIssues:
    def test_empty_state_returns_empty_list(self):
        assert build_component_issues({}) == []

    def test_issue_marked_recoverable_and_carries_reason(self):
        session = {
            StateKeys.UNRESOLVED_COMPONENTS: {
                "PetsContent": "Filter state 'petSpecies' never passed into useHandler",
            },
            StateKeys.COMPONENT_FAILURE_DETAILS: {
                "PetsContent": {
                    "failure_class": "validation_failed",
                    "first_error": "Filter state 'petSpecies' never passed into useHandler",
                },
            },
        }
        issues = build_component_issues(session)
        assert len(issues) == 1
        issue = issues[0]
        assert issue["component_name"] == "PetsContent"
        assert issue["failure_class"] == "validation_failed"
        assert issue["is_fatal"] is False
        assert issue["placeholder_rendered"] is True
        assert "petSpecies" in issue["failure_reason"]

    def test_fatal_issue_marks_no_placeholder(self):
        session = {
            StateKeys.UNRESOLVED_COMPONENTS: {"Broken": "Unexpected token '<'"},
            StateKeys.COMPONENT_FAILURE_DETAILS: {
                "Broken": {
                    "failure_class": "jsx_syntax_error",
                    "first_error": "Unexpected token '<'",
                }
            },
        }
        issues = build_component_issues(session)
        assert issues[0]["is_fatal"] is True
        assert issues[0]["placeholder_rendered"] is False


class TestBuildComponentGenerationWarning:
    def test_warning_type_is_non_terminal(self):
        warning, assistant, _ = build_component_generation_warning(
            {"PetsContent": "validation_failed"},
        )
        # The consumer's "terminal failure" check keys off this type string;
        # warning must NOT match component_generation_failed.
        assert warning["type"] == "component_generation_warning"
        assert "PetsContent" in warning["components"]
        # Assistant wording should not suggest the app was discarded.
        assert "deployed" not in assistant.lower() or "not deployed" not in assistant.lower()
        assert "PetsContent" in assistant

    def test_truncates_large_component_lists(self):
        unresolved = {f"C{i}": "validation_failed" for i in range(8)}
        warning, _, _ = build_component_generation_warning(unresolved)
        assert "and 3 more" in warning["summary"]
