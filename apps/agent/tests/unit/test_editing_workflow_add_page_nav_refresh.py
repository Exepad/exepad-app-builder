"""Regression tests for the nav-slug refresh after page additions.

A previous edition of ``EditingWorkflow`` initialised
``_validation_context_page_slugs`` once at edit-init from
``existing_pages`` and never refreshed it after a new page was added.
As a result, when an edit added a new page AND modified the
header/footer to link to it in the same turn, the navigate-path
auto-fixer at ``component_typos.apply_component_typos_fixes`` saw a
stale slug list, couldn't find the new slug, and rewrote every link to
the first declared page (``/``). The user could not reach the page they
had asked for.

The fix calls ``_refresh_validation_context`` after each ``page_creates``
side-effect from ``frontend_build_side_effects``, so the validation
context always reflects the current page registry. These tests guard
that seam.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services.codefocus_assembly_service import (
    ComponentEntry,
)
from main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow import (
    EditingWorkflow,
)
from main_agent.services.validation.fixers import apply_auto_fixes

pytestmark = [pytest.mark.unit]


# --------------------------------------------------------------------------- #
# Stubs
# --------------------------------------------------------------------------- #


class _StateLikeMapping(dict):
    """Mimic ADK's ``State`` wrapper.

    ``push_session_state_update`` only mirrors changes locally when
    ``isinstance(ctx.session.state, dict)`` — production state is a
    dict subclass, so we extend ``dict`` here while suppressing the
    ``pop`` / ``__delitem__`` operations the production wrapper
    forbids. Tests must catch any reliance on those (a previous
    regression used ``state.pop()`` and crashed in prod).
    """

    def pop(self, *args, **kwargs):  # pragma: no cover
        raise AttributeError("'State' object has no attribute 'pop'")

    def __delitem__(self, key):  # pragma: no cover
        raise AttributeError("'State' object has no attribute '__delitem__'")


class _StubSessionService:
    async def append_event(self, session, event):
        # State is mirrored locally by push_session_state_update — the
        # event is a no-op for our purposes.
        return None


class _StubSession:
    def __init__(self, initial_state: dict | None = None) -> None:
        self.state = _StateLikeMapping(initial_state or {})


class _StubInvocationContext:
    def __init__(self, initial_state: dict | None = None) -> None:
        self.session = _StubSession(initial_state)
        self.session_service = _StubSessionService()


def _bare_workflow() -> EditingWorkflow:
    """Construct a minimal ``EditingWorkflow`` for sub-helper testing.

    ``_refresh_validation_context`` only touches ``ctx.session.state`` via
    ``push_session_state_update`` — it does not call the agents or
    services held by the workflow. Passing ``None`` for everything is
    safe for the helpers under test.
    """
    return EditingWorkflow(
        editor_agent=SimpleNamespace(),
        component_builder_agent=SimpleNamespace(),
        component_builder_multiple_agent=SimpleNamespace(),
        post_processing_service=SimpleNamespace(),
        assembly_service=SimpleNamespace(),
        write_result_response_fn=lambda *a, **kw: None,
    )


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_refresh_validation_context_merges_added_components_into_page_slugs():
    """``_refresh_validation_context`` must publish a slug list that
    includes both pre-existing pages and pages added in the current
    edit. This is the contract the navigate-path auto-fixer depends on.
    """
    workflow = _bare_workflow()
    ctx = _StubInvocationContext(
        initial_state={"_validation_context_page_slugs": ["/"]},
    )

    existing_pages = [{"slug": "/"}, {"slug": "/products"}]
    added = [
        ComponentEntry(name="TeamContent", role="content", page_slug="/our-team"),
    ]

    await workflow._refresh_validation_context(
        ctx,
        backend_config=None,
        logic_config=None,
        existing_pages=existing_pages,
        added_components=added,
    )

    slugs = ctx.session.state["_validation_context_page_slugs"]
    assert slugs == ["/", "/products", "/our-team"]


@pytest.mark.asyncio
async def test_refresh_validation_context_skips_added_components_without_slug():
    """``ComponentEntry`` allows ``page_slug=None`` for non-page roles
    (e.g., header/footer/sidebar). They must NOT be merged into the
    slug list — they would corrupt the auto-fixer's resolution map.
    """
    workflow = _bare_workflow()
    ctx = _StubInvocationContext()

    existing_pages = [{"slug": "/"}]
    added = [
        ComponentEntry(name="MainHeader", role="header", page_slug=None),
        ComponentEntry(name="TeamContent", role="content", page_slug="/our-team"),
    ]

    await workflow._refresh_validation_context(
        ctx,
        backend_config=None,
        logic_config=None,
        existing_pages=existing_pages,
        added_components=added,
    )

    assert ctx.session.state["_validation_context_page_slugs"] == ["/", "/our-team"]


def test_auto_fixer_preserves_navigate_to_freshly_added_page_when_slugs_are_refreshed():
    """End-to-end at the auto-fix seam: with a refreshed slug list that
    includes the new page, ``navigate('/our-team')`` must survive the
    auto-fix pass — not get rewritten to '/'.

    This is the regression that broke ``1r4s4zhj`` on 2026-04-29: the
    slug list lacked ``/our-team`` and the unresolved-path fallback
    rewrote MainHeader + MainFooter links to the first declared page.
    """
    tsx = """
import { React, navigate } from "@exepad/sdk";
function MainHeader() {
  return (
    <nav>
      <a onClick={() => navigate('/our-team')}>Our Team</a>
    </nav>
  );
}
export default MainHeader;
"""
    fresh_slugs = ["/", "/products", "/about", "/contact", "/our-team"]
    fixed, fixes = apply_auto_fixes(tsx, [], {}, {}, page_slugs=fresh_slugs)
    assert "navigate('/our-team')" in fixed
    assert not any("Rewrote unresolved navigate path '/our-team'" in f for f in fixes)


def test_auto_fixer_rewrites_navigate_when_slugs_are_stale_proves_bug_baseline():
    """Sanity check that the auto-fixer DOES rewrite when the slug list
    is stale. Establishes the baseline behavior the refresh prevents.
    """
    tsx = """
import { React, navigate } from "@exepad/sdk";
function MainHeader() {
  return (
    <nav>
      <a onClick={() => navigate('/our-team')}>Our Team</a>
    </nav>
  );
}
export default MainHeader;
"""
    stale_slugs = ["/", "/products", "/about", "/contact"]
    fixed, fixes = apply_auto_fixes(tsx, [], {}, {}, page_slugs=stale_slugs)
    assert "navigate('/our-team')" not in fixed
    assert "navigate('/')" in fixed
    assert any("Rewrote unresolved navigate path '/our-team'" in f for f in fixes)
