"""Validation runner for E2E tests.

This module orchestrates running all validations on test results,
combining SSE event validations with app config schema validation.
"""

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from .sse_parser import SSEEvent
from .validators import (
    ValidationResult,
    ValidationReport,
    run_sse_validations,
)

# Add the project root to the path to import main_agent modules
project_root = Path(__file__).parent.parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))


class ValidationRunner:
    """Orchestrates all validations for E2E test results.

    Combines:
    - SSE event validations (progress, chat, errors)
    - App config schema validation (using existing validate_app_config)
    """

    def __init__(self, skip_config_validation: bool = False):
        """Initialize the validation runner.

        Args:
            skip_config_validation: If True, skip app config schema validation
        """
        self.skip_config_validation = skip_config_validation

    def run_all_validations(
        self,
        events: List[SSEEvent],
        app_config: Optional[Dict[str, Any]] = None,
    ) -> ValidationReport:
        """Run all validations on test results.

        Args:
            events: List of SSE events from the test
            app_config: Optional app config to validate

        Returns:
            Complete validation report
        """
        report = ValidationReport()

        # Run SSE event validations
        sse_results = run_sse_validations(events)
        report.results.extend(sse_results)

        # Run app config validation if provided
        if app_config and not self.skip_config_validation:
            config_result = self.run_config_validation(app_config)
            report.results.append(config_result)

        return report

    def run_config_validation(
        self,
        app_config: Dict[str, Any],
        target_type: str = "WebAppProps",
    ) -> ValidationResult:
        """Validate app config against schema.

        Uses validate_app_config from the packages/schemas/scripts/py/validation
        package.

        Args:
            app_config: The app configuration to validate
            target_type: Expected type (WebAppProps, WebPageProps, etc.)

        Returns:
            Validation result
        """
        try:
            from validation import validate_app_config

            # Convert config to JSON string as expected by validate_app_config
            config_str = json.dumps(app_config)

            # Run validation
            result = validate_app_config(config_str, target_type)

            passed = result.get("valid", False)
            errors = result.get("errors", [])

            return ValidationResult(
                name="app_config_schema",
                passed=passed,
                severity="error",
                message="; ".join(errors[:5]) if errors else "App config is valid",
                details={
                    "valid": passed,
                    "error_count": len(errors),
                    "errors": errors[:20],  # Limit to first 20 errors
                },
            )

        except ImportError as e:
            return ValidationResult(
                name="app_config_schema",
                passed=False,
                severity="warning",
                message=f"Could not import validation module: {e}",
                details={"import_error": str(e)},
            )
        except Exception as e:
            return ValidationResult(
                name="app_config_schema",
                passed=False,
                severity="error",
                message=f"Validation error: {e}",
                details={"exception": str(e)},
            )

    def run_schema_validation(
        self,
        app_config: Dict[str, Any],
        target_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Run schema validation and return detailed results for saving.

        This method returns the raw validation results including all errors,
        suitable for saving to a file for detailed analysis.

        Args:
            app_config: The app configuration to validate
            target_type: Optional target type (auto-detected if None)

        Returns:
            Dict with validation results:
            {
                "valid": bool,
                "target_type": str,
                "error_count": int,
                "errors": List[str],
                "validation_source": str
            }
        """
        try:
            from validation import validate_app_config

            # Convert config to JSON string as expected by validate_app_config
            config_str = json.dumps(app_config)

            # Run validation (target_type=None means auto-detect)
            result = validate_app_config(config_str, target_type)

            return {
                "valid": result.get("valid", False),
                "target_type": target_type or "auto-detected",
                "error_count": len(result.get("errors", [])),
                "errors": result.get("errors", []),
                "validation_source": "packages/schemas/scripts/py/validation",
            }

        except ImportError as e:
            return {
                "valid": False,
                "target_type": target_type,
                "error_count": 1,
                "errors": [f"Could not import validation module: {e}"],
                "validation_source": "import_error",
            }
        except Exception as e:
            return {
                "valid": False,
                "target_type": target_type,
                "error_count": 1,
                "errors": [f"Validation error: {e}"],
                "validation_source": "exception",
            }

    def run_sse_only(self, events: List[SSEEvent]) -> ValidationReport:
        """Run only SSE event validations.

        Useful when app config is not available.

        Args:
            events: List of SSE events

        Returns:
            Validation report with SSE results only
        """
        report = ValidationReport()
        sse_results = run_sse_validations(events)
        report.results.extend(sse_results)
        return report


def validate_test_results(
    events: List[SSEEvent],
    app_config: Optional[Dict[str, Any]] = None,
    print_results: bool = True,
) -> ValidationReport:
    """Convenience function to validate test results.

    Args:
        events: List of SSE events
        app_config: Optional app config
        print_results: If True, print validation summary

    Returns:
        Validation report
    """
    runner = ValidationRunner()
    report = runner.run_all_validations(events, app_config)

    if print_results:
        print("\n" + "=" * 60)
        print("VALIDATION RESULTS")
        print("=" * 60)

        for result in report.results:
            status = "✓" if result.passed else "✗"
            severity_label = f"[{result.severity.upper()}]" if not result.passed else ""
            print(f"{status} {result.name} {severity_label}")
            if not result.passed:
                print(f"   → {result.message}")

        print("=" * 60)
        print(f"Overall: {'PASSED' if report.passed else 'FAILED'}")
        print(f"Errors: {len(report.errors)}, Warnings: {len(report.warnings)}")
        print("=" * 60 + "\n")

    return report
