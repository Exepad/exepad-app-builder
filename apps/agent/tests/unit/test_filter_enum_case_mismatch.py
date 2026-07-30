"""Tests for ``component.useModel.enum_case_mismatch`` — rule + fixer.

Bug class: a generated component filters by an enum column with the wrong
casing (``filters: { task_type: "full_clean" }`` against
``enum_values=["Full Clean", ...]``), silently returning zero rows because
SQLite is case-sensitive on string equality. The auto-fixer rewrites the
literal to declared casing.
"""

import pytest

from main_agent.services.validation.fixers import apply_auto_fixes
from main_agent.services.validation.semantic_validator import run_semantic_checks
from main_agent.services.validation.tsx_ast import AstContext, parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.component_filter_enum_case import (
    FilterEnumCaseMismatchRule,
)

HOUSEKEEPING_MODEL = {
    "name": "housekeeping_tasks",
    "columns": [
        {"name": "id", "type": "integer"},
        {
            "name": "task_type",
            "type": "text",
            "enum_values": ["Full Clean", "Deep Clean", "Linen Change"],
        },
        {
            "name": "status",
            "type": "text",
            "enum_values": ["pending", "in_progress", "done"],
        },
    ],
}


def _run_rule(tsx: str, models: list[dict]) -> list[str]:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, models=models)
    return [f.message for f in FilterEnumCaseMismatchRule().check(ctx)]


def _run_fixer(tsx: str, models: list[dict]) -> tuple[str, list[str]]:
    return apply_auto_fixes(tsx, models, {}, {})


# ---------------------------------------------------------------------------
# Rule — case mismatch detection
# ---------------------------------------------------------------------------


class TestRule:
    def test_warns_on_lowercase_against_titlecase_enum(self):
        tsx = """
        import {useModel} from '@exepad/sdk';
        function C() {
          const {data} = useModel("housekeeping_tasks", { filters: { task_type: "full_clean" } });
          return data;
        }
        """
        msgs = _run_rule(tsx, [HOUSEKEEPING_MODEL])
        assert len(msgs) == 1
        assert "task_type" in msgs[0]
        assert '"Full Clean"' in msgs[0]

    def test_no_warn_when_byte_match(self):
        tsx = """
        import {useModel} from '@exepad/sdk';
        function C() {
          const {data} = useModel("housekeeping_tasks", { filters: { task_type: "Full Clean" } });
          return data;
        }
        """
        assert _run_rule(tsx, [HOUSEKEEPING_MODEL]) == []

    def test_no_warn_when_no_match_at_all(self):
        # The literal is a wholly novel value — out of scope for this rule
        # (other checks may flag unrelated values); we only flag case mismatches.
        tsx = """
        import {useModel} from '@exepad/sdk';
        function C() {
          const {data} = useModel("housekeeping_tasks", { filters: { task_type: "polishing" } });
          return data;
        }
        """
        assert _run_rule(tsx, [HOUSEKEEPING_MODEL]) == []

    def test_no_warn_when_column_has_no_enum_values(self):
        tsx = """
        import {useModel} from '@exepad/sdk';
        function C() {
          const {data} = useModel("housekeeping_tasks", { filters: { id: "5" } });
          return data;
        }
        """
        assert _run_rule(tsx, [HOUSEKEEPING_MODEL]) == []

    def test_no_warn_when_useModel_call_is_unrelated(self):
        # Calls to other functions named like useModel-ish must not fire.
        tsx = """
        import {something} from '@exepad/sdk';
        function C() {
          const x = something("housekeeping_tasks", { filters: { task_type: "full_clean" } });
          return x;
        }
        """
        assert _run_rule(tsx, [HOUSEKEEPING_MODEL]) == []

    def test_warns_on_status_lowercase_when_enum_is_titlecase(self):
        # Mirror case: status enum is lowercase, literal is titlecase.
        models = [
            {
                "name": "billings",
                "columns": [
                    {
                        "name": "status",
                        "type": "text",
                        "enum_values": ["unpaid", "paid", "partial"],
                    }
                ],
            }
        ]
        tsx = """
        import {useModel} from '@exepad/sdk';
        function C() {
          const {data} = useModel("billings", { filters: { status: "Paid" } });
          return data;
        }
        """
        msgs = _run_rule(tsx, models)
        assert len(msgs) == 1
        assert '"paid"' in msgs[0]

    def test_warns_on_punctuation_only_difference(self):
        # The StayNexus failure mode: underscore vs space.
        tsx = """
        import {useModel} from '@exepad/sdk';
        function C() {
          const {data} = useModel("housekeeping_tasks", { filters: { task_type: "full_clean" } });
          return data;
        }
        """
        msgs = _run_rule(tsx, [HOUSEKEEPING_MODEL])
        assert len(msgs) == 1
        assert '"Full Clean"' in msgs[0]


# ---------------------------------------------------------------------------
# Fixer — deterministic rewrite
# ---------------------------------------------------------------------------


class TestFixer:
    def test_rewrites_lowercase_to_titlecase(self):
        tsx = """import {useModel} from '@exepad/sdk';
function C() {
  const {data} = useModel("housekeeping_tasks", { filters: { task_type: "full_clean" } });
  return data;
}
"""
        out, fixes = _run_fixer(tsx, [HOUSEKEEPING_MODEL])
        assert '"Full Clean"' in out
        assert '"full_clean"' not in out
        assert any("enum case match" in f for f in fixes), fixes

    def test_no_change_when_already_correct(self):
        tsx = """import {useModel} from '@exepad/sdk';
function C() {
  const {data} = useModel("housekeeping_tasks", { filters: { task_type: "Full Clean" } });
  return data;
}
"""
        out, fixes = _run_fixer(tsx, [HOUSEKEEPING_MODEL])
        assert '"Full Clean"' in out
        assert not any("enum_case" in f and "Full Clean" in f for f in fixes)

    def test_handles_multiple_filters_in_one_call(self):
        tsx = """import {useModel} from '@exepad/sdk';
function C() {
  const {data} = useModel("housekeeping_tasks", {
    filters: { task_type: "linen_change", status: "Pending" }
  });
  return data;
}
"""
        out, fixes = _run_fixer(tsx, [HOUSEKEEPING_MODEL])
        assert '"Linen Change"' in out
        assert '"pending"' in out  # rewrote "Pending" → "pending"
        assert '"linen_change"' not in out
        # status was titlecase but enum is lowercase
        assert '"Pending"' not in out

    def test_no_change_when_no_filters_property(self):
        tsx = """import {useModel} from '@exepad/sdk';
function C() {
  const {data} = useModel("housekeeping_tasks", { limit: 5 });
  return data;
}
"""
        out, _ = _run_fixer(tsx, [HOUSEKEEPING_MODEL])
        assert out == tsx

    def test_no_change_when_models_empty(self):
        tsx = """import {useModel} from '@exepad/sdk';
function C() {
  const {data} = useModel("housekeeping_tasks", { filters: { task_type: "full_clean" } });
  return data;
}
"""
        out, _ = _run_fixer(tsx, [])
        assert out == tsx

    def test_integration_rule_runs_through_run_semantic_checks(self):
        # Confirms the rule is actually wired into the public pipeline,
        # not just dispatchable in isolation. Regression guard for
        # default_set.py registration.
        tsx = """import {useModel} from '@exepad/sdk';
function C() {
  const {data} = useModel("housekeeping_tasks", { filters: { task_type: "full_clean" } });
  return data;
}
"""
        result = run_semantic_checks(tsx, [HOUSEKEEPING_MODEL], {}, [])
        all_msgs = result.errors + result.warnings
        assert any("enum_values" in m and "task_type" in m for m in all_msgs), all_msgs

    def test_skips_when_two_declared_values_share_case_insensitive_form(self):
        # If declared values are ["Open", "open"] (theoretical), case-insensitive
        # match isn't unique → no fix, no warning.
        models = [
            {
                "name": "tickets",
                "columns": [
                    {
                        "name": "status",
                        "type": "text",
                        "enum_values": ["Open", "open"],
                    }
                ],
            }
        ]
        tsx = """import {useModel} from '@exepad/sdk';
function C() {
  const {data} = useModel("tickets", { filters: { status: "OPEN" } });
  return data;
}
"""
        out, _ = _run_fixer(tsx, models)
        assert out == tsx
