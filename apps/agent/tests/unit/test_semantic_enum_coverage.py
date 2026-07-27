"""Unit tests for ``check_enum_coverage`` semantic validator check.

Covers the bug class where a generated component hardcodes a stale status
vocabulary (e.g. ``approved|denied|pending``) while the model's real
``enum_values`` are ``draft|pending approval|in review|finalized``. The
component's ``default`` branch then silently renders every row with the
wrong label. See plan file ``quizzical-finding-map.md`` Fix 2.
"""

import pytest

from main_agent.services.validation.semantic_validator import (
    _collect_enum_columns,
    check_enum_coverage,
    run_semantic_checks,
)

# ---------------------------------------------------------------------------
# _collect_enum_columns — the shape-agnostic extractor
# ---------------------------------------------------------------------------


class TestCollectEnumColumns:
    def test_accepts_snake_case(self):
        models = [
            {
                "name": "requests",
                "columns": [
                    {"name": "title", "type": "text"},
                    {
                        "name": "status",
                        "type": "text",
                        "enum_values": ["draft", "in review", "finalized"],
                    },
                ],
            }
        ]
        assert _collect_enum_columns(models) == [
            ("requests", "status", ["draft", "in review", "finalized"])
        ]

    def test_accepts_camel_case(self):
        models = [
            {
                "name": "orders",
                "columns": [
                    {"name": "state", "type": "text", "enumValues": ["new", "paid"]},
                ],
            }
        ]
        assert _collect_enum_columns(models) == [("orders", "state", ["new", "paid"])]

    def test_skips_empty_and_missing(self):
        models = [
            {
                "name": "m",
                "columns": [
                    {"name": "a", "type": "text", "enum_values": None},
                    {"name": "b", "type": "text", "enum_values": []},
                    {"name": "c", "type": "text"},
                    {"name": "d", "type": "text", "enum_values": ["x"]},
                ],
            }
        ]
        assert _collect_enum_columns(models) == [("m", "d", ["x"])]

    def test_handles_missing_model(self):
        assert _collect_enum_columns([]) == []
        assert _collect_enum_columns([{"columns": [{"name": "x", "enum_values": ["a"]}]}]) == []


# ---------------------------------------------------------------------------
# check_enum_coverage — branch counting
# ---------------------------------------------------------------------------


STATUS_MODEL = {
    "name": "requests",
    "columns": [
        {
            "name": "status",
            "type": "text",
            "enum_values": ["draft", "pending approval", "in review", "finalized"],
        }
    ],
}


class TestCheckEnumCoverageSwitchStatement:
    def test_full_coverage_via_switch_passes(self):
        """Every declared value has a case → no warning."""
        tsx = """
        function getStatusBadge(status: string) {
          switch (status) {
            case "draft": return <Badge>Draft</Badge>;
            case "pending approval": return <Badge>Pending Approval</Badge>;
            case "in review": return <Badge>In Review</Badge>;
            case "finalized": return <Badge>Finalized</Badge>;
            default: return <Badge>Unknown</Badge>;
          }
        }
        // caller: getStatusBadge(request.status)
        """
        assert check_enum_coverage(tsx, [STATUS_MODEL]) == []

    def test_missing_case_warns_with_exact_missing_values(self):
        """Only three of four values handled → warning names the missing one."""
        tsx = """
        function getStatusBadge(status: string) {
          switch (status) {
            case "draft": return <Badge>Draft</Badge>;
            case "pending approval": return <Badge>Pending</Badge>;
            case "in review": return <Badge>Review</Badge>;
            default: return <Badge>Unknown</Badge>;
          }
        }
        // request.status rendering
        """
        warnings = check_enum_coverage(tsx, [STATUS_MODEL])
        assert len(warnings) == 1
        assert "finalized" in warnings[0]
        assert "requests" in warnings[0]
        assert "status" in warnings[0]

    def test_flowstate_reproducer(self):
        """Exact bug from FlowState Approval audit — 3000% mislabel case.

        The generated component only handled approved|denied|pending,
        so every seeded row with a real status fell through to 'Draft'.
        The check should flag all four missing declared values.
        """
        tsx = """
        import { Badge } from "@exepad/sdk";

        const getStatusBadge = (status: string) => {
          const s = status?.toLowerCase();
          switch (s) {
            case "approved":
              return <Badge className="bg-secondary">Approved</Badge>;
            case "denied":
              return <Badge className="bg-error">Denied</Badge>;
            case "pending":
              return <Badge className="bg-amber-500">Pending</Badge>;
            default:
              return <Badge className="bg-surface">Draft</Badge>;
          }
        };

        // Called from the requests table:
        // <TableCell>{getStatusBadge(req.status)}</TableCell>
        """
        warnings = check_enum_coverage(tsx, [STATUS_MODEL])
        assert len(warnings) == 1
        msg = warnings[0]
        for missing in ["draft", "pending approval", "in review", "finalized"]:
            assert missing in msg, f"expected missing {missing!r} in warning"


class TestCheckEnumCoverageObjectMap:
    def test_full_coverage_via_object_map(self):
        tsx = """
        const STATUS_STYLES: Record<string, string> = {
          "draft": "bg-gray-200",
          "pending approval": "bg-amber-100",
          "in review": "bg-blue-100",
          "finalized": "bg-emerald-100",
        };
        // row.status lookup
        const cls = STATUS_STYLES[row.status] ?? "bg-neutral-100";
        """
        assert check_enum_coverage(tsx, [STATUS_MODEL]) == []

    def test_partial_coverage_via_object_map_warns(self):
        tsx = """
        const STATUS_STYLES = {
          "draft": "bg-gray",
          "finalized": "bg-green",
        };
        // request.status render
        return <span className={STATUS_STYLES[request.status]} />;
        """
        warnings = check_enum_coverage(tsx, [STATUS_MODEL])
        assert len(warnings) == 1
        assert "pending approval" in warnings[0]
        assert "in review" in warnings[0]


class TestCheckEnumCoverageEdgeCases:
    def test_no_enum_values_is_noop(self):
        models = [
            {
                "name": "comments",
                "columns": [{"name": "author", "type": "text"}],
            }
        ]
        tsx = """
        switch (row.author) { case "alice": return 1; default: return 0; }
        """
        assert check_enum_coverage(tsx, models) == []

    def test_component_does_not_render_column_is_noop(self):
        """Component never branches on the enum column — no warning.

        The enum_values declaration is about *rendering correctness* when
        the component DOES branch. A form component that only writes
        status (not renders it) shouldn't be warned.
        """
        tsx = """
        function CreateRequestForm() {
          const { create } = useModel("requests");
          const [title, setTitle] = React.useState("");
          return <form onSubmit={() => create({ title })}>...</form>;
        }
        """
        assert check_enum_coverage(tsx, [STATUS_MODEL]) == []

    def test_multiple_models_multiple_enums(self):
        """Different enum columns on different models — each tracked separately."""
        models = [
            {
                "name": "requests",
                "columns": [
                    {
                        "name": "status",
                        "type": "text",
                        "enum_values": ["draft", "finalized"],
                    }
                ],
            },
            {
                "name": "tasks",
                "columns": [
                    {
                        "name": "priority",
                        "type": "text",
                        "enum_values": ["low", "high"],
                    }
                ],
            },
        ]
        # Component covers status fully but misses priority="high".
        tsx = """
        function statusBadge(status: string) {
          switch (status) {
            case "draft": return "d";
            case "finalized": return "f";
            default: return "?";
          }
        }
        function priorityBadge(priority: string) {
          switch (priority) {
            case "low": return "lo";
            default: return "?";
          }
        }
        """
        warnings = check_enum_coverage(tsx, models)
        assert len(warnings) == 1
        assert "priority" in warnings[0]
        assert "high" in warnings[0]

    def test_empty_models_list_is_noop(self):
        assert check_enum_coverage("switch (x) { case 'y': return 1; }", []) == []


# ---------------------------------------------------------------------------
# Integration with run_semantic_checks
# ---------------------------------------------------------------------------


class TestRunSemanticChecksIntegration:
    def test_enum_coverage_surfaces_as_warning_not_error(self):
        """Warning-level so the artifact ships; not blocking."""
        tsx = """
        import { Badge } from "@exepad/sdk";
        function getStatusBadge(status: string) {
          switch (status) {
            case "draft": return <Badge>Draft</Badge>;
            default: return <Badge>Unknown</Badge>;
          }
        }
        // request.status usage
        export default function RequestList() {
          const { data } = useModel("requests");
          return <div>{(data ?? []).map(r => getStatusBadge(r.status))}</div>;
        }
        """
        result = run_semantic_checks(
            tsx=tsx,
            models=[STATUS_MODEL],
            logic={},
            page_slugs=["/"],
            expected_component_name="RequestList",
        )
        # Should NOT be an error — must be a warning so deploys aren't blocked
        # by intentional collapsed renderings.
        enum_errors = [e for e in result.errors if "enum_values" in e]
        enum_warnings = [w for w in result.warnings if "enum_values" in w]
        assert enum_errors == []
        assert len(enum_warnings) >= 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
