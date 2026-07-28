"""Golden-file handler validation tests.

Runs the full default rule set against realistic multi-line handler TSX
files from the ``fixtures/`` directory. Each test case specifies the
model catalog and expected findings (error/warning) so it validates the
complete pipeline end-to-end — parsing, rule walk, finding sort, and
severity classification.

Correct handlers should produce zero errors (warnings are advisory).
Broken handlers should produce a specific set of expected error/warning
substrings — if a rule fires unexpectedly or fails to fire, the test
catches it immediately.
"""

from __future__ import annotations

from pathlib import Path


from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.default_set import handler_rules
from main_agent.services.validation.tsx_ast.rules.sql_model_references import (
    SqlUndeclaredTableRule,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _load(filename: str) -> str:
    return (FIXTURES / filename).read_text()


def _validate(tsx: str, models: list[dict] | None = None):
    """Run the full rule set and return (errors, warnings) as lists of
    ``Finding.message`` strings (no rule_id/line suffix — raw prose)."""
    tree = parse_tsx(tsx)
    ctx = AstContext(
        tsx=tsx,
        source_buf=source_bytes(tsx),
        tree=tree,
        models=models or [],
    )
    rules = handler_rules()
    if models is None:
        rules = [r for r in rules if not isinstance(r, SqlUndeclaredTableRule)]
    findings = run_rules(ctx, rules)
    errors = [f.message for f in findings if f.severity == "error"]
    warnings = [f.message for f in findings if f.severity == "warning"]
    return errors, warnings


# =========================================================================
# Correct handlers — zero errors expected
# =========================================================================


class TestCorrectHandlers:
    """Every fixture in this class should pass the full rule set with
    zero errors. Warnings are tolerated (advisory)."""

    def test_insert_booking(self):
        errors, _ = _validate(
            _load("correct_insert_booking.tsx"),
            models=[
                {
                    "name": "bookings",
                    "columns": [
                        {"name": "owner_id"},
                        {"name": "service_id"},
                        {"name": "date"},
                        {"name": "customer_name"},
                        {"name": "status"},
                        {"name": "created_at"},
                        {"name": "updated_at"},
                    ],
                }
            ],
        )
        assert errors == [], errors

    def test_read_products(self):
        errors, _ = _validate(
            _load("correct_read_products.tsx"),
            models=[{"name": "products"}],
        )
        assert errors == [], errors

    def test_aggregation_shared_scope(self):
        errors, _ = _validate(
            _load("correct_aggregation_shared.tsx"),
            models=[{"name": "employees"}, {"name": "departments"}],
        )
        assert errors == [], errors

    def test_aggregation_user_scope(self):
        errors, _ = _validate(
            _load("correct_aggregation_user_scope.tsx"),
            models=[{"name": "contacts"}, {"name": "tasks"}],
        )
        assert errors == [], errors

    def test_join_orders_customers(self):
        errors, _ = _validate(
            _load("correct_join_orders_customers.tsx"),
            models=[{"name": "orders"}, {"name": "customers"}],
        )
        assert errors == [], errors

    def test_settings_patch(self):
        errors, _ = _validate(
            _load("correct_settings_patch.tsx"),
            models=[],
        )
        assert errors == [], errors

    def test_chart_data(self):
        errors, _ = _validate(
            _load("correct_chart_data.tsx"),
            models=[{"name": "calls"}],
        )
        assert errors == [], errors


# =========================================================================
# Broken handlers — specific errors expected
# =========================================================================


class TestBrokenHandlers:
    """Every fixture in this class is intentionally broken. The test asserts
    the expected error substrings appear in the findings list so we know
    the correct rule(s) fired."""

    def test_sql_injection(self):
        errors, _ = _validate(
            _load("broken_sql_injection.tsx"),
            models=[{"name": "users"}],
        )
        assert any("SQL injection" in e for e in errors)
        assert any("ctx.params.name" in e for e in errors)

    def test_forbidden_import(self):
        errors, _ = _validate(
            _load("broken_forbidden_import.tsx"),
            models=[],
        )
        assert any("axios" in e for e in errors)

    def test_no_export_default(self):
        errors, _ = _validate(
            _load("broken_no_export_default.tsx"),
            models=[{"name": "products"}],
        )
        assert any("export default" in e for e in errors)

    def test_browser_apis(self):
        """Handler that uses document, localStorage, console.log, setTimeout,
        and window.location — should fire multiple rules."""
        errors, _ = _validate(
            _load("broken_browser_apis.tsx"),
            models=[],
        )
        assert any("document" in e for e in errors), "document.* should be flagged"
        assert any("localStorage" in e for e in errors), "localStorage should be flagged"
        assert any("console.log" in e for e in errors), "console.log should be flagged"
        assert any("setTimeout" in e for e in errors), "setTimeout should be flagged"
        assert any("window" in e for e in errors), "window.* should be flagged"

    def test_undeclared_table(self):
        errors, _ = _validate(
            _load("broken_undeclared_table.tsx"),
            models=[{"name": "guests"}, {"name": "events"}],
        )
        assert any("activity_logs" in e for e in errors)
        # guests IS declared — should NOT be flagged
        assert not any("'guests'" in e for e in errors)

    def test_raw_user_settings(self):
        # ``_user_settings`` is no longer a recognized platform table (the
        # settings service was removed); it's just a reserved ``_`` prefix.
        errors, _ = _validate(
            _load("broken_raw_user_settings.tsx"),
            models=[],
        )
        assert any("_user_settings" in e for e in errors)

    def test_fail_loudly_escalation(self):
        errors, _ = _validate(
            _load("broken_fail_loudly.tsx"),
            models=[{"name": "walkers"}],
        )
        assert any("Hard Rule #5 escalation" in e for e in errors)

    def test_multi_issue_handler(self):
        """A catastrophically broken handler should fire many rules at once."""
        errors, warnings = _validate(
            _load("broken_multi_issue.tsx"),
            models=[],
        )
        # Missing export default
        assert any("export default" in e for e in errors)
        # Forbidden import: lodash
        assert any("lodash" in e for e in errors)
        # eval() forbidden
        assert any("eval()" in e for e in errors)
        # document.* unavailable
        assert any("document" in e for e in errors)
        # localStorage forbidden
        assert any("localStorage" in e for e in errors)
        # Dynamic .prepare() argument (variable q, not a literal)
        assert any("non-literal argument" in w for w in warnings)
        # At least 5 distinct errors
        assert len(errors) >= 5, f"Expected 5+ errors, got {len(errors)}: {errors}"
