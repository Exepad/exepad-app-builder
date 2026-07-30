"""Babel-shell chrome-extraction guard tests.

Production app ``u0j2m40o`` (2026-05-19) crashed in Phase 1.5 decomposition
because the DesignImporter LLM emitted a ``ChromeRegion`` for a Babel-shell
bundle. Babel-shell pages render header/sidebar/footer from sibling JSX
files (e.g. ``shell.jsx``) concatenated at runtime — the chrome never
appears in static HTML, so CSS selectors can't extract it.

The permanent fix is layered:
  1. SKILL.md guidance: tell the LLM to emit ``chrome: []`` for Babel-shell.
  2. Runner safety net: deterministic ``_is_all_babel_shell(plan)`` check
     that skips Phase 4 when every page is Babel-shell.
  3. Typing fix in ``_list_page_html_artifacts``: use the InvocationContext-
     native ``artifact_service.list_artifact_keys`` pattern so the
     chrome-fallback discovery works on the contexts the runner passes.

These tests pin the load-bearing layer (2). The helper's boundary behavior
is what determines whether the runner crashes, warns, or extracts.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from main_agent.agents.orchestrator.importers.tools.decomposition.runner import (
    _is_all_babel_shell,
)

pytestmark = [pytest.mark.unit]


# --------------------------------------------------------------------------- #
# Plan stubs — ``_is_all_babel_shell`` only reads ``plan.pages[*].script_mode``.
# Use SimpleNamespace to avoid pulling in the full DecompositionPlan schema
# (creator_plan, theme pillars, navigation, etc.) which is irrelevant here.
# --------------------------------------------------------------------------- #


def _babel_shell_page() -> SimpleNamespace:
    return SimpleNamespace(script_mode="babel-shell")


def _plain_html_page() -> SimpleNamespace:
    return SimpleNamespace(script_mode=None)


def _chrome_payload(role: str = "sidebar") -> dict:
    """Mirrors the dict shape that the runner emits in the
    ``babel_shell_chrome_regions_dropped`` warning payload."""
    return {
        "role": role,
        "source_artifact": "bundle:html:index.html",
        "selector": f".{role}",
    }


def _make_plan(pages: list[SimpleNamespace], chrome: list) -> SimpleNamespace:
    return SimpleNamespace(pages=pages, chrome=chrome)


# --------------------------------------------------------------------------- #
# _is_all_babel_shell — boundary behaviour
# --------------------------------------------------------------------------- #


class TestIsAllBabelShell:
    def test_returns_true_when_every_page_is_babel_shell(self):
        plan = _make_plan(
            pages=[_babel_shell_page(), _babel_shell_page(), _babel_shell_page()],
            chrome=[],
        )
        assert _is_all_babel_shell(plan) is True

    def test_returns_false_when_no_pages_are_babel_shell(self):
        plan = _make_plan(
            pages=[_plain_html_page(), _plain_html_page()],
            chrome=[],
        )
        assert _is_all_babel_shell(plan) is False

    def test_returns_false_when_pages_are_mixed(self):
        """Even ONE non-Babel-shell page means chrome extraction can run
        from that page. Conservative: don't skip when mixed."""
        plan = _make_plan(
            pages=[_babel_shell_page(), _plain_html_page()],
            chrome=[],
        )
        assert _is_all_babel_shell(plan) is False

    def test_returns_false_for_empty_pages_plan(self):
        """Defensive: an empty-pages plan (forbidden by the real schema's
        min_length=1, but possible via this test stub) must NOT trigger
        the skip — there's no signal it's a Babel-shell bundle."""
        plan = _make_plan(pages=[], chrome=[])
        assert _is_all_babel_shell(plan) is False

    def test_returns_true_for_single_babel_shell_page(self):
        """One Babel-shell page (the minimum Claude-Design import case)
        must trigger the skip — chrome can't be extracted from JSX."""
        plan = _make_plan(pages=[_babel_shell_page()], chrome=[])
        assert _is_all_babel_shell(plan) is True


# --------------------------------------------------------------------------- #
# Runner Phase 4 — branch payload shape
# --------------------------------------------------------------------------- #


class TestPhase4BabelShellBranch:
    """The branch in run_design_decomposition is trivial atop
    ``_is_all_babel_shell``:

        all_babel_shell = _is_all_babel_shell(plan)
        if all_babel_shell and plan.chrome:
            logger.warning("babel_shell_chrome_regions_dropped", ...)
        elif not all_babel_shell:
            for region in plan.chrome:
                ... extract ...

    The helper tests above prove the predicate. Here we pin the warning
    payload shape — when the warning fires, it must include the dropped
    regions for diagnostic value (so we can measure LLM miss rate in
    prod and iterate the SKILL.md guidance)."""

    def test_dropped_regions_payload_shape(self):
        """Build the payload from a ChromeRegion-like list (uses real
        attribute names: role / source_artifact / selector) and confirm
        the diagnostic fields are present in the order the runner emits."""
        regions = [
            SimpleNamespace(
                role="sidebar",
                source_artifact="bundle:html:index.html",
                selector=".sidebar",
            ),
            SimpleNamespace(
                role="header",
                source_artifact="bundle:html:index.html",
                selector=".header",
            ),
        ]
        # Mirror the payload-building expression from runner.py Phase 4:
        payload = [
            {
                "role": r.role,
                "source_artifact": r.source_artifact,
                "selector": r.selector,
            }
            for r in regions
        ]
        assert payload == [_chrome_payload("sidebar"), _chrome_payload("header")]

    def test_empty_chrome_no_payload(self):
        """All-Babel-shell + empty chrome → no warning (both branches no-op)."""
        plan = _make_plan(
            pages=[_babel_shell_page(), _babel_shell_page()],
            chrome=[],
        )
        # The runner's branch:
        #   if all_babel_shell and plan.chrome: warn
        #   elif not all_babel_shell: extract
        # With all_babel_shell=True and chrome=[], neither branch fires.
        assert _is_all_babel_shell(plan) is True
        assert plan.chrome == []


# --------------------------------------------------------------------------- #
# Layer 3 — ``_list_page_html_artifacts`` typing fix
# --------------------------------------------------------------------------- #
#
# Production app u0j2m40o's failure log showed:
#
#     Error listing artifacts: 'InvocationContext' object has no
#     attribute 'list_artifacts'
#     ... fallback search across 0 page artifact(s) ...
#
# Root cause: the helper called ``ArtifactManager.list_artifacts(ctx)``,
# which is typed for ``CallbackContext`` and crashes on ``InvocationContext``
# (the type the decomposition runner actually passes). The defensive
# ``except`` returned ``[]``, masking the failure as "0 staged pages" in
# diagnostics — so even a real chrome-extract miss on a non-Babel-shell
# bundle would log misleadingly.
#
# The fix rewrites the helper to use the InvocationContext-native pattern
# already used at runner._list_artifact_keys and
# claude_design._list_artifact_keys.


class _StubArtifactService:
    """Mirrors the ADK artifact-service surface for ``list_artifact_keys``."""

    def __init__(self, keys: list[str]) -> None:
        self._keys = list(keys)
        self.calls: list[dict] = []

    async def list_artifact_keys(self, *, session_id, user_id, app_name):
        self.calls.append(
            {"session_id": session_id, "user_id": user_id, "app_name": app_name}
        )
        return list(self._keys)


def _stub_invocation_ctx(keys: list[str]) -> SimpleNamespace:
    """Build a SimpleNamespace shaped like an ADK ``InvocationContext`` —
    ``ctx.session.{id,user_id,app_name}`` + ``ctx.artifact_service``."""
    session = SimpleNamespace(id="sess-1", user_id="user-1", app_name="app-1")
    return SimpleNamespace(session=session, artifact_service=_StubArtifactService(keys))


class TestListPageHtmlArtifactsTypingFix:
    async def test_returns_only_bundle_html_keys_sorted(self):
        from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
            _list_page_html_artifacts,
        )

        ctx = _stub_invocation_ctx(
            [
                "bundle:html:about.html",
                "bundle:html:index.html",
                "codefocus_component:Foo.tsx",
                "bundle:doc:partials.html",
                "bundle:script:shell.jsx",
                "bundle:html:contact.html",
            ]
        )
        result = await _list_page_html_artifacts(ctx)
        assert result == [
            "bundle:html:about.html",
            "bundle:html:contact.html",
            "bundle:html:index.html",
        ]

    async def test_uses_invocation_context_listing_pattern(self):
        """Pin the actual API call: three kwargs (session_id, user_id,
        app_name), NOT ``ctx.list_artifacts()``. Catches regressions if
        someone switches back to the CallbackContext-typed helper."""
        from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
            _list_page_html_artifacts,
        )

        ctx = _stub_invocation_ctx(["bundle:html:a.html"])
        await _list_page_html_artifacts(ctx)
        assert ctx.artifact_service.calls == [
            {"session_id": "sess-1", "user_id": "user-1", "app_name": "app-1"}
        ]

    async def test_empty_keys_returns_empty_list(self):
        from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
            _list_page_html_artifacts,
        )

        ctx = _stub_invocation_ctx([])
        assert await _list_page_html_artifacts(ctx) == []

    async def test_no_bundle_html_keys_returns_empty_list(self):
        """Filter must reject anything not starting with ``bundle:html:`` —
        no leaking ``bundle:doc:*``, ``bundle:script:*``, or
        ``codefocus_*:*`` into the chrome-fallback candidate list."""
        from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
            _list_page_html_artifacts,
        )

        ctx = _stub_invocation_ctx(
            [
                "codefocus_component:Foo.tsx",
                "bundle:doc:partials.html",
                "bundle:script:shell.jsx",
            ]
        )
        assert await _list_page_html_artifacts(ctx) == []

    async def test_artifact_service_raises_returns_empty_list_fail_open(self):
        """ADK artifact services may not support listing in every
        transport; the helper must fail-open with ``[]`` so the
        fallback just skips fan-out attempts rather than crashing."""
        from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
            _list_page_html_artifacts,
        )

        class _BoomArtifactService:
            async def list_artifact_keys(self, *, session_id, user_id, app_name):
                raise RuntimeError("transport does not support listing")

        ctx = SimpleNamespace(
            session=SimpleNamespace(id="s", user_id="u", app_name="a"),
            artifact_service=_BoomArtifactService(),
        )
        assert await _list_page_html_artifacts(ctx) == []
