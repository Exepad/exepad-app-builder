"""Unit tests for ``_reconcile_page_access`` in the webapp creation workflow.

Regression coverage for the trailing-whitespace slug bug: the LLM occasionally
emits ``{"/ ": "authenticated"}`` for the root page. Runtime ACL lookup is an
exact-match on the page slug, so a stale ``"/ "`` key silently falls back to
``defaultAccess`` and would silently misroute access if the default ever
diverged from the intended per-page level.
"""

import pytest

from main_agent.agents.orchestrator.app_types.webapp.workflows.creation_workflow import (
    _reconcile_page_access,
)

pytestmark = [pytest.mark.unit]


def _content_plan(slug: str) -> dict:
    return {"role": "content", "page_slug": slug}


class TestReconcilePageAccessWhitespace:
    def test_strips_trailing_space_on_slug_key(self):
        result = _reconcile_page_access(
            {"/ ": "authenticated", "/calendar": "authenticated"},
            [_content_plan("/"), _content_plan("/calendar")],
            "TestAgent",
        )
        assert result == {"/": "authenticated", "/calendar": "authenticated"}

    def test_strips_leading_space_on_slug_key(self):
        result = _reconcile_page_access(
            {" /admin": "role:admin"},
            [_content_plan("/admin")],
            "TestAgent",
        )
        assert result == {"/admin": "role:admin"}

    def test_drops_empty_slug_after_strip(self):
        result = _reconcile_page_access(
            {"   ": "public", "/dashboard": "authenticated"},
            [_content_plan("/dashboard")],
            "TestAgent",
        )
        assert result == {"/dashboard": "authenticated"}

    def test_normalizes_actual_slugs_with_whitespace(self):
        # If the upstream component plan also has a space, both sides
        # normalize and still match.
        result = _reconcile_page_access(
            {"/ ": "authenticated"},
            [_content_plan("/ ")],
            "TestAgent",
        )
        assert result == {"/": "authenticated"}

    def test_preserves_wildcards_unchanged(self):
        result = _reconcile_page_access(
            {"/admin/*": "role:admin", "/admin": "role:admin"},
            [_content_plan("/admin")],
            "TestAgent",
        )
        assert result == {"/admin/*": "role:admin", "/admin": "role:admin"}

    def test_normalizes_when_no_component_plans(self):
        # Even without component plans we must strip whitespace so the
        # downstream config writer doesn't persist the malformed key.
        result = _reconcile_page_access(
            {"/ ": "authenticated"},
            [],
            "TestAgent",
        )
        assert result == {"/": "authenticated"}

    def test_root_rewrite_to_first_content_slug(self):
        result = _reconcile_page_access(
            {"/": "public"},
            [_content_plan("/dashboard"), _content_plan("/profile")],
            "TestAgent",
        )
        assert result == {"/dashboard": "public"}

    def test_drops_unknown_non_root_slug(self):
        result = _reconcile_page_access(
            {"/ghost": "authenticated", "/dashboard": "authenticated"},
            [_content_plan("/dashboard")],
            "TestAgent",
        )
        assert result == {"/dashboard": "authenticated"}

    def test_non_string_keys_dropped(self):
        result = _reconcile_page_access(
            {123: "authenticated", "/dashboard": "authenticated"},
            [_content_plan("/dashboard")],
            "TestAgent",
        )
        assert result == {"/dashboard": "authenticated"}

    def test_empty_input_returns_empty(self):
        assert _reconcile_page_access({}, [_content_plan("/")], "TestAgent") == {}
        assert _reconcile_page_access(None, [_content_plan("/")], "TestAgent") == {}
