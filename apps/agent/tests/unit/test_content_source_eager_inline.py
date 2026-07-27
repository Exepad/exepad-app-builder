"""Eager-inline content_source — the no-save fix for content-backed components.

Root cause (reproduced live against deepseek-v4-flash, 2026-06-27): content-backed
components (Terms / Footer / RecipeDetail) passed only a content_artifact NAME, so
the weak model spent its single turn calling ``load_artifacts`` and never reached
the save tool -> ``builder_no_save`` placeholder. Data-only components (no content
artifact) saved fine. Controlled test: with content inlined + "do not load",
load_artifacts calls dropped 8/8 -> 0/8 and saves rose to ~7/8.

Fix: CreationWorkflow eagerly loads the content body into ``content_source`` and
blanks the artifact name (mirroring the edit-mode ``existing_source`` pattern), so
the model has the content in hand and no name to tempt a redundant load.

These tests pin the pure pieces the fix hinges on.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder import (
    ComponentBuilderInput,
    single_file_suffix,
)
from main_agent.agents.orchestrator.app_types.webapp.workflows import creation_workflow as cw

pytestmark = [pytest.mark.unit]


def _ctx() -> SimpleNamespace:
    return SimpleNamespace(session=SimpleNamespace(id="s", user_id="u", app_name="a", state={}))


def test_eager_load_inlines_body_and_blanks_name(monkeypatch):
    """On success: returns (body, "") — body inlined, name blanked so the model
    has nothing to load_artifacts."""

    async def fake_load(ctx, key):
        assert key == "content:terms:body.md"
        return "# Terms\nReal markdown copy."

    monkeypatch.setattr(cw.ArtifactManager, "load_artifact_as_string", staticmethod(fake_load))

    body, name = asyncio.run(
        cw.CreationWorkflow._eager_load_content_source(_ctx(), "content:terms:body.md")
    )
    assert body == "# Terms\nReal markdown copy."
    assert name == ""  # blanked — no name to tempt load_artifacts


def test_eager_load_empty_body_keeps_name_as_fallback(monkeypatch):
    """Empty/absent artifact body: keep the name so the model can still load it."""

    async def fake_load(ctx, key):
        return ""

    monkeypatch.setattr(cw.ArtifactManager, "load_artifact_as_string", staticmethod(fake_load))

    body, name = asyncio.run(
        cw.CreationWorkflow._eager_load_content_source(_ctx(), "content:x:y.md")
    )
    assert body == ""
    assert name == "content:x:y.md"  # fail-safe fallback path preserved


def test_eager_load_exception_is_failsafe(monkeypatch):
    """A load failure must never be worse than today: empty body, name preserved."""

    async def boom(ctx, key):
        raise RuntimeError("artifact store down")

    monkeypatch.setattr(cw.ArtifactManager, "load_artifact_as_string", staticmethod(boom))

    body, name = asyncio.run(
        cw.CreationWorkflow._eager_load_content_source(_ctx(), "content:x:y.md")
    )
    assert body == ""
    assert name == "content:x:y.md"


def test_eager_load_no_artifact_is_noop():
    """No content artifact -> both empty, no load attempted."""
    body, name = asyncio.run(cw.CreationWorkflow._eager_load_content_source(_ctx(), ""))
    assert body == ""
    assert name == ""


def test_input_carries_content_source():
    """The schema accepts the inlined content body."""
    inp = ComponentBuilderInput(
        component_name="TermsContent",
        component_role="content",
        building_plan=["render terms"],
        design_system_context="{}",
        output_artifact_name="TermsContent",
        content_source="# Terms\nbody",
    )
    assert inp.content_source == "# Terms\nbody"
    assert inp.content_artifact == ""  # default blank


def test_single_file_suffix_warns_against_load_when_inlined():
    """The shared instruction (standalone + slot cached prefix) must tell the model
    to use content_source directly and NOT call load_artifacts."""
    suffix = single_file_suffix()
    assert "content_source" in suffix
    assert "load_artifacts" in suffix
    # The guidance must be a prohibition, not an invitation.
    lowered = suffix.lower()
    assert "do not call" in lowered or "do not\ncall" in lowered


# ---------------------------------------------------------------------------
# Review finding #3: the synthesized building_plan ("Load page copy/content from
# artifact: X") contradicts an eager-inlined content_source — telling the model
# both to use the inlined copy AND to load_artifacts re-tempts the no-save round
# trip on exactly the weak-model cohort this fix targets. Strip it when inlined.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bullet,expected",
    [
        ("Load page copy/content from artifact: content:terms:body.md", True),
        ("load content from artifact foo", True),
        ("Load the copy from the artifact", True),
        ("Page title: Terms of Service", False),
        ("Render the legal sections", False),
        ("Load a hero image at the top", False),  # "load" but not an artifact ref
        ("", False),
        (None, False),
    ],
)
def test_is_load_artifact_directive(bullet, expected):
    assert cw._is_load_artifact_directive(bullet) is expected


def _build_input(monkeypatch, *, body: str, plan_item: dict):
    async def fake_load(ctx, key):
        return body

    monkeypatch.setattr(cw.ArtifactManager, "load_artifact_as_string", staticmethod(fake_load))
    wf = cw.CreationWorkflow.__new__(cw.CreationWorkflow)
    return asyncio.run(
        wf._build_component_builder_input(
            _ctx(),
            plan_item,
            0,
            design_context="{}",
            app_language_code="en",
            app_context="{}",
            image_uuid_to_url={},
            backend_config={},
            plan={},
            app_secondary_type="",
            logic_surface="",
        )
    )


def test_load_directive_stripped_when_content_inlined(monkeypatch):
    """Inline succeeds -> the contradictory load bullet is dropped, content_source
    holds the body, and the artifact name is blanked."""
    plan_item = {
        "name": "TermsContent",
        "role": "content",
        "content_artifact": "content:terms:body.md",
        "building_plan": [
            "Page title: Terms of Service",
            "Render the legal sections",
            "Load page copy/content from artifact: content:terms:body.md",
        ],
    }
    inp = _build_input(monkeypatch, body="# Terms\nReal copy.", plan_item=plan_item)
    assert inp.content_source == "# Terms\nReal copy."
    assert inp.content_artifact == ""
    assert inp.building_plan == ["Page title: Terms of Service", "Render the legal sections"]
    assert not any("artifact" in b.lower() for b in inp.building_plan)


def test_load_directive_kept_when_inline_fails(monkeypatch):
    """Inline fails (empty body) -> the load bullet AND the artifact name are kept,
    so the model can still load the content itself (fail-safe, never worse)."""
    plan_item = {
        "name": "TermsContent",
        "role": "content",
        "content_artifact": "content:terms:body.md",
        "building_plan": [
            "Page title: Terms of Service",
            "Load page copy/content from artifact: content:terms:body.md",
        ],
    }
    inp = _build_input(monkeypatch, body="", plan_item=plan_item)
    assert inp.content_source == ""
    assert inp.content_artifact == "content:terms:body.md"
    assert "Load page copy/content from artifact: content:terms:body.md" in inp.building_plan
