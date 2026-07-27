"""Tests for the backend handler failure service (Lever C stub).

When BackendHandlerBuilder produces no artifact even after the one-shot retry,
the generator writes a deterministic crash-safe stub so the artifact exists at
deploy and the build continues instead of aborting (mirrors the frontend
component placeholder).
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.handler_failure_service import (  # noqa: E501
    PLACEHOLDER_HANDLER_SENTINEL,
    build_placeholder_handler_tsx,
    is_placeholder_handler_tsx,
)

pytestmark = [pytest.mark.unit]


class TestBuildPlaceholderHandler:
    def test_contains_sentinel_export_and_empty_return(self):
        tsx = build_placeholder_handler_tsx("getUpcomingEvents")
        assert PLACEHOLDER_HANDLER_SENTINEL in tsx
        # Canonical handler contract: single-arg HandlerContext, function named
        # `handler`, exported via `export default handler;`, flat empty return.
        assert 'import { HandlerContext } from "@exepad/sdk";' in tsx
        assert "async function handler(ctx: HandlerContext)" in tsx
        assert "export default handler;" in tsx
        assert "return {};" in tsx

    def test_handler_name_recorded_in_sentinel(self):
        # The exported function is always `handler`; the handler name it replaces
        # is carried in the sentinel comment so the stub stays traceable.
        tsx = build_placeholder_handler_tsx("getOnTapBeers")
        assert f"{PLACEHOLDER_HANDLER_SENTINEL}: getOnTapBeers" in tsx
        assert "export default handler;" in tsx

    def test_stub_passes_tsx_syntax_validator(self):
        # esbuild fails open when absent, so this asserts "no errors" (valid or
        # fail-open) — the stub must never introduce a syntax error.
        from main_agent.services.validation.syntax_validator import validate_tsx_syntax

        ok, errors = validate_tsx_syntax(build_placeholder_handler_tsx("getX"))
        assert ok is True
        assert errors == []


class TestIsPlaceholderHandler:
    def test_round_trips(self):
        assert is_placeholder_handler_tsx(build_placeholder_handler_tsx("getX")) is True

    def test_false_for_normal_handler(self):
        normal = (
            'import { HandlerContext } from "@exepad/sdk";\n'
            "async function handler(ctx: HandlerContext) { return { total: 1 }; }\n"
            "export default handler;\n"
        )
        assert is_placeholder_handler_tsx(normal) is False

    def test_false_for_empty_or_none(self):
        assert is_placeholder_handler_tsx("") is False
        assert is_placeholder_handler_tsx(None) is False
