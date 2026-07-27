"""Unit tests for the editing workflow's dependency map builder."""

from unittest.mock import MagicMock

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services.dependency_map_builder import (
    _extract_usehandler_names,
    _handler_references_table,
)

pytestmark = pytest.mark.unit


class TestHandlerReferencesTable:
    def test_from_clause(self):
        assert _handler_references_table("SELECT * FROM products WHERE active = 1", "products")

    def test_join_clause(self):
        assert _handler_references_table(
            "SELECT * FROM orders JOIN products ON orders.product_id = products.id", "products"
        )

    def test_insert_into(self):
        assert _handler_references_table(
            "INSERT INTO products (name, price) VALUES (?, ?)", "products"
        )

    def test_update_clause(self):
        assert _handler_references_table("UPDATE products SET price = ? WHERE id = ?", "products")

    def test_delete_from(self):
        assert _handler_references_table("DELETE FROM products WHERE id = ?", "products")

    def test_case_insensitive(self):
        assert _handler_references_table("select * from PRODUCTS", "products")
        assert _handler_references_table("SELECT * from products", "PRODUCTS")

    def test_multi_space(self):
        assert _handler_references_table("FROM    products", "products")

    def test_rejects_substring(self):
        assert not _handler_references_table("const fromtasks = 5", "tasks")
        assert not _handler_references_table("const tasksFrom = 5", "tasks")

    def test_rejects_identifier_usage(self):
        """Table name as a JS identifier (not inside SQL) shouldn't match."""
        assert not _handler_references_table("const products = []; return products;", "products")

    def test_empty_table_name(self):
        assert not _handler_references_table("SELECT 1", "")


class TestExtractUseHandlerNames:
    def test_single_quote(self):
        assert _extract_usehandler_names("useHandler('getTasks')") == {"getTasks"}

    def test_double_quote(self):
        assert _extract_usehandler_names('useHandler("getTasks")') == {"getTasks"}

    def test_whitespace_tolerant(self):
        assert _extract_usehandler_names("useHandler(  'getTasks'  )") == {"getTasks"}

    def test_multiple_calls(self):
        tsx = """
        const { execute: getA } = useHandler('getA');
        const { execute: getB } = useHandler("getB");
        """
        assert _extract_usehandler_names(tsx) == {"getA", "getB"}

    def test_ignores_dynamic(self):
        """Dynamic handler names (via variable) are intentionally not captured."""
        assert _extract_usehandler_names("useHandler(handlerName)") == set()

    def test_ignores_bare_strings(self):
        """String literals that aren't inside useHandler() calls don't match."""
        assert _extract_usehandler_names("const x = 'getTasks';") == set()

    def test_empty_source(self):
        assert _extract_usehandler_names("") == set()


# ─────────────────────────────────────────────────────────────────────
# build_dependency_map — integration with missing_component_sources
# ─────────────────────────────────────────────────────────────────────


_APP_CONFIG_TWO_COMPS_ONE_HANDLER = {
    "repo": {
        "frontend": {
            "components": {
                "HomeContent": {"source": "code/frontend/components/HomeContent.tsx"},
                "ShowsContent": {"source": "code/frontend/components/ShowsContent.tsx"},
            }
        }
    },
    "backend": {
        "models": [{"name": "shows"}],
        "handlers": [{"name": "getShows"}],
    },
}


def _mock_ctx():
    ctx = MagicMock()
    ctx.session.id = "sess"
    ctx.session.user_id = "user"
    ctx.session.app_name = "orchestrator"
    return ctx
