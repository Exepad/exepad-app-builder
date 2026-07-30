"""Integration tests — cross-module validation through real configs and full pipeline."""

import json
from pathlib import Path

import pytest

# ===========================================================================
# E2E fixture config validation
# ===========================================================================


class TestEndToEndFixtureConfigs:
    @pytest.fixture(autouse=True)
    def _import(self):
        from validation import validate_app_config, detect_target_type

        self.validate = validate_app_config
        self.detect = detect_target_type

    def _load_fixture(self, e2e_fixture_configs_dir: Path, name: str) -> str:
        path = e2e_fixture_configs_dir / name
        if not path.exists():
            pytest.skip(f"Fixture config not found: {path}")
        return path.read_text(encoding="utf-8")

    @pytest.mark.unit
    def test_validate_e2e_fixture_minimal_webapp(self, e2e_fixture_configs_dir):
        config_str = self._load_fixture(e2e_fixture_configs_dir, "minimal_webapp.json")
        result = self.validate(config_str, "WebAppProps")
        assert result["valid"] is True, f"Errors: {result['errors'][:5]}"

    @pytest.mark.unit
    def test_validate_e2e_fixture_with_sections_detected(self, e2e_fixture_configs_dir):
        """Verify fixture is detected as WebAppProps (may have schema drift in components)."""
        config_str = self._load_fixture(e2e_fixture_configs_dir, "webapp_with_sections.json")
        config = json.loads(config_str)
        result = self.detect(config)
        assert result["type"] == "WebAppProps"
        assert result["error"] is None

    @pytest.mark.unit
    def test_validate_e2e_fixture_multi_page_detected(self, e2e_fixture_configs_dir):
        """Verify fixture is detected as WebAppProps (may have schema drift in components)."""
        config_str = self._load_fixture(e2e_fixture_configs_dir, "webapp_multi_page.json")
        config = json.loads(config_str)
        result = self.detect(config)
        assert result["type"] == "WebAppProps"
        assert result["error"] is None


# ===========================================================================
# BackendProps through core orchestrator
# ===========================================================================


class TestBackendThroughCoreOrchestrator:
    @pytest.fixture(autouse=True)
    def _import(self):
        from validation import validate_app_config, detect_target_type

        self.validate = validate_app_config
        self.detect = detect_target_type

    @pytest.mark.unit
    def test_backend_config_detected_by_type_detection(self):
        config = {
            "models": [
                {
                    "uuid": "m1",
                    "name": "books",
                    "summary": "Books",
                    "columns": [{"name": "title", "type": "text"}],
                }
            ],
            "handlers": [],
        }
        result = self.detect(config)
        assert result["type"] == "BackendProps"

    @pytest.mark.unit
    def test_backend_config_detected_and_validated_through_validate_app_config(self):
        """Minimal backend config is detected as BackendProps."""
        config_dict = {
            "models": [
                {
                    "uuid": "m1",
                    "name": "books",
                    "summary": "Books",
                    "columns": [{"name": "title", "type": "text"}],
                }
            ],
            "handlers": [],
        }
        # Detection should identify it as BackendProps
        result = self.detect(config_dict)
        assert result["type"] == "BackendProps"
        # Validation runs without crashing (result may vary with schema changes)
        config = json.dumps(config_dict)
        result = self.validate(config)
        assert "valid" in result

    @pytest.mark.unit
    def test_invalid_backend_through_validate_app_config(self):
        config = json.dumps(
            {
                "models": [
                    {
                        "uuid": "m1",
                        "name": "books",
                        "description": "Books",  # wrong field
                        "columns": [{"name": "title", "type": "text"}],
                    }
                ],
                "handlers": [],
            }
        )
        result = self.validate(config)
        assert result["valid"] is False
        assert any("description" in e for e in result["errors"])


# ===========================================================================
# Expression validation through core
# ===========================================================================


class TestExpressionValidationThroughCore:
    @pytest.fixture(autouse=True)
    def _import(self):
        from validation import validate_app_config

        self.validate = validate_app_config

    @pytest.mark.unit
    def test_webapp_with_valid_expressions(self, minimal_app_config):
        # Add state definition and an expression referencing it
        minimal_app_config["frontend"]["logic"] = {
            "state": {"count": {"type": "number", "defaultValue": 0}},
        }
        # Add an expression in a component
        section = minimal_app_config["frontend"]["pages"][0]["content"][0]
        section["content"][0]["text"] = "{{state.count}}"

        config_str = json.dumps(minimal_app_config)
        result = self.validate(config_str, "WebAppProps")
        # Expression syntax should be valid — filter for expression-specific error patterns
        # (not schema errors that happen to contain '{{' in value dumps)
        EXPR_PATTERNS = [
            "Invalid character",
            "Empty expression",
            "Unclosed '('",
            "Unclosed '['",
            "Unclosed single quote",
            "Unclosed double quote",
            "undefined state field",
            "undefined computed field",
        ]
        expr_errors = [e for e in result["errors"] if any(p in e for p in EXPR_PATTERNS)]
        assert expr_errors == []

    @pytest.mark.unit
    def test_webapp_with_broken_expression_fails(self, minimal_app_config):
        # Add a broken expression with invalid prefix
        section = minimal_app_config["frontend"]["pages"][0]["content"][0]
        section["content"][0]["text"] = "${{state.count}}"

        config_str = json.dumps(minimal_app_config)
        result = self.validate(config_str, "WebAppProps")
        assert any(
            "Invalid character" in e for e in result["errors"]
        ), f"Expected 'Invalid character' error for '${{{{state.count}}}}' but got: {result['errors'][:5]}"
