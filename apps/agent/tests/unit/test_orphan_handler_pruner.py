"""Tests for the post-assembly orphan-handler pruner.

A handler is orphan when no component references it via ``useHandler(...)``.
The DesignImporter occasionally declares an ``email`` handler for a
contact/newsletter form while ComponentBuilder wires the form to
``fetch('/_forms/submit')`` — the handler ships as dead JS.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services.orphan_handler_pruner import (
    _collect_handler_names_from_config,
    _collect_model_names_from_config,
    _handler_names_referenced_in_tsx,
    _model_names_referenced_in_tsx,
    _remove_handler_from_config,
    prune_orphan_handlers,
    report_model_usage_consistency,
)

pytestmark = [pytest.mark.unit]


class TestCollectHandlerNames:
    def test_from_repo_backend_dict(self):
        cfg = {"repo": {"backend": {"handlers": {"submitInquiry": {}, "fetchStats": {}}}}}
        assert _collect_handler_names_from_config(cfg) == ["submitInquiry", "fetchStats"]

    def test_from_repo_backend_list(self):
        cfg = {
            "repo": {
                "backend": {
                    "handlers": [
                        {"name": "submitInquiry", "method": "submitInquiry"},
                        {"name": "otherHandler"},
                    ]
                }
            }
        }
        assert _collect_handler_names_from_config(cfg) == ["submitInquiry", "otherHandler"]

    def test_from_backend_list_only(self):
        cfg = {"backend": {"handlers": [{"name": "x"}, {"name": "y"}]}}
        assert _collect_handler_names_from_config(cfg) == ["x", "y"]

    def test_empty_config_returns_empty_list(self):
        assert _collect_handler_names_from_config({}) == []


class TestReferencedInTsx:
    def test_picks_up_both_quote_styles(self):
        tsx = (
            'const a = useHandler("foo");\n'
            "const b = useHandler('bar');\n"
            'const c = useHandler(  "baz"  , { params: {} });\n'
        )
        assert _handler_names_referenced_in_tsx(tsx) == {"foo", "bar", "baz"}

    def test_ignores_non_useHandler_mentions(self):
        tsx = "// useHandler('note') in a comment should still count but useModel('x') should not"
        refs = _handler_names_referenced_in_tsx(tsx)
        assert "note" in refs
        assert "x" not in refs


class TestRemoveHandler:
    def test_removes_from_dict_shape(self):
        cfg = {
            "repo": {"backend": {"handlers": {"submitInquiry": {}, "keep": {}}}},
        }
        _remove_handler_from_config(cfg, "submitInquiry")
        assert cfg["repo"]["backend"]["handlers"] == {"keep": {}}

    def test_removes_from_list_shape(self):
        cfg = {"backend": {"handlers": [{"name": "submitInquiry"}, {"name": "keep"}]}}
        _remove_handler_from_config(cfg, "submitInquiry")
        assert cfg["backend"]["handlers"] == [{"name": "keep"}]

    def test_nonexistent_handler_is_noop(self):
        cfg = {"backend": {"handlers": [{"name": "a"}]}}
        _remove_handler_from_config(cfg, "notThere")
        assert cfg["backend"]["handlers"] == [{"name": "a"}]


@pytest.mark.asyncio
class TestPruneOrphanHandlers:
    async def _make_ctx(self, component_tsx: dict[str, str]):
        """Build a fake ctx whose artifact loader returns the given TSX per
        artifact name."""
        ctx = MagicMock()
        ctx.session = MagicMock()
        ctx.session.id = "s"
        ctx.session.user_id = "u"
        ctx.session.app_name = "a"

        async def fake_load(ctx_arg, artifact_key):  # noqa: ARG001
            return component_tsx.get(artifact_key, "")

        # Monkey-patch ArtifactManager.load_artifact_as_string on the
        # module under test.
        from main_agent.agents.orchestrator.app_types.webapp.services import (
            orphan_handler_pruner,
        )

        orphan_handler_pruner.ArtifactManager.load_artifact_as_string = AsyncMock(
            side_effect=fake_load
        )
        return ctx

    async def test_prunes_handler_with_no_useHandler_reference(self):
        cfg = {
            "repo": {
                "backend": {
                    "handlers": {"submitInquiry": {"summary": "contact form"}},
                }
            },
            "backend": {"handlers": [{"name": "submitInquiry", "summary": "contact form"}]},
        }
        component_plans = [{"name": "ContactContent"}]
        tsx_by_key = {
            "codefocus_component:ContactContent.tsx": (
                '<form onSubmit={(e) => { fetch("/_forms/submit", ...); }}>' "..." "</form>"
            )
        }
        ctx = await self._make_ctx(tsx_by_key)

        pruned = await prune_orphan_handlers(ctx, cfg, component_plans)

        assert pruned == ["submitInquiry"]
        assert cfg["repo"]["backend"]["handlers"] == {}
        assert cfg["backend"]["handlers"] == []

    async def test_keeps_handler_that_is_actually_used(self):
        cfg = {"repo": {"backend": {"handlers": {"fetchStats": {}}}}}
        component_plans = [{"name": "DashboardContent"}]
        tsx_by_key = {
            "codefocus_component:DashboardContent.tsx": (
                'const { data } = useHandler("fetchStats", { params: {} });'
            )
        }
        ctx = await self._make_ctx(tsx_by_key)

        pruned = await prune_orphan_handlers(ctx, cfg, component_plans)

        assert pruned == []
        assert cfg["repo"]["backend"]["handlers"] == {"fetchStats": {}}

    async def test_no_handlers_declared_returns_empty(self):
        cfg = {"repo": {"backend": {}}}
        component_plans = [{"name": "HomeContent"}]
        ctx = await self._make_ctx({})

        pruned = await prune_orphan_handlers(ctx, cfg, component_plans)
        assert pruned == []


class TestCollectModelNames:
    def test_from_repo_backend_models_list(self):
        cfg = {"repo": {"backend": {"models": [{"name": "products"}, {"name": "orders"}]}}}
        assert _collect_model_names_from_config(cfg) == ["products", "orders"]

    def test_empty_returns_empty(self):
        assert _collect_model_names_from_config({}) == []


class TestModelsReferencedInTsx:
    def test_picks_up_both_quote_styles(self):
        tsx = (
            'const { data } = useModel("products", { limit: 2 });\n'
            "const other = useModel('orders');\n"
        )
        assert _model_names_referenced_in_tsx(tsx) == {"products", "orders"}


@pytest.mark.asyncio
class TestReportModelUsageConsistency:
    async def _make_ctx_with_tsx(self, component_tsx: dict[str, str]):
        # Reuse the mock setup helper from the pruner test.
        from main_agent.agents.orchestrator.app_types.webapp.services import (
            orphan_handler_pruner,
        )

        async def fake_load(ctx_arg, artifact_key):  # noqa: ARG001
            return component_tsx.get(artifact_key, "")

        orphan_handler_pruner.ArtifactManager.load_artifact_as_string = AsyncMock(
            side_effect=fake_load
        )
        return MagicMock()

    async def test_warns_when_only_some_pages_wire_the_model(self):
        cfg = {
            "repo": {"backend": {"models": [{"name": "products"}]}},
        }
        # HomeContent wires it; ProductsContent mentions "products" in
        # copy but doesn't call useModel (hardcoded bento grid).
        tsx_by_key = {
            "codefocus_component:HomeContent.tsx": (
                'const { data: products } = useModel("products", { limit: 2 });'
            ),
            "codefocus_component:ProductsContent.tsx": (
                "<h1>Our Products</h1><div>Hardcoded products list</div>"
            ),
        }
        ctx = await self._make_ctx_with_tsx(tsx_by_key)

        warnings = await report_model_usage_consistency(
            ctx,
            cfg,
            [{"name": "HomeContent"}, {"name": "ProductsContent"}],
        )

        assert len(warnings) == 1
        warn = warnings[0]
        assert warn["model"] == "products"
        assert "HomeContent" in warn["using"]
        assert "ProductsContent" in warn["not_using"]

    async def test_no_warning_when_all_pages_consistent(self):
        cfg = {"repo": {"backend": {"models": [{"name": "products"}]}}}
        tsx_by_key = {
            "codefocus_component:Home.tsx": 'useModel("products")',
            "codefocus_component:Products.tsx": 'useModel("products")',
        }
        ctx = await self._make_ctx_with_tsx(tsx_by_key)
        warnings = await report_model_usage_consistency(
            ctx, cfg, [{"name": "Home"}, {"name": "Products"}]
        )
        assert warnings == []

    async def test_no_warning_when_no_page_references_the_model(self):
        # Model declared but no component references it even in copy —
        # that's an orphan-model case (distinct from inconsistency).
        # Consistency check stays silent; the model is either seeds-only
        # or legitimately unused.
        cfg = {"repo": {"backend": {"models": [{"name": "inventory"}]}}}
        tsx_by_key = {
            "codefocus_component:Home.tsx": "<h1>Welcome</h1>",
        }
        ctx = await self._make_ctx_with_tsx(tsx_by_key)
        warnings = await report_model_usage_consistency(ctx, cfg, [{"name": "Home"}])
        assert warnings == []
