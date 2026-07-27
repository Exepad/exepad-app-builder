"""Unit tests for prose-TSX → synthetic-save-call salvage.

Locks the contract that when a weak model returns a component as prose with NO
tool call, the after_model_callback rewrites the response into a save tool call
(routed through the normal guardrail + validation path) — turning the dominant
off-Gemini no-save failure into a save instead of an opaque placeholder.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from main_agent.agents.utils.prose_save_salvage import (
    _MODULE_SAVE_TOOL_NAME,
    _SAVE_TOOL_NAME,
    extract_tsx_from_prose,
    log_unsalvageable_no_save,
    salvage_prose_into_save_call,
)

pytestmark = [pytest.mark.unit]

_COMPONENT = (
    'import { React, LightDOMContainer } from "@exepad/sdk";\n'
    "function AdoptContent() {\n"
    "  return <LightDOMContainer><div>Adopt</div></LightDOMContainer>;\n"
    "}\n"
    "export default AdoptContent;\n"
)

_MODULE = (
    'import { React } from "@exepad/sdk";\n'
    "export function Sidebar() { return <nav>links</nav>; }\n"
)


# ── input fakes (mirror test_tool_call_normalizer.py) ────────────────────────
def _text_part(text):
    return SimpleNamespace(function_call=None, text=text)


def _call_part(name):
    return SimpleNamespace(function_call=SimpleNamespace(name=name, args={}), text=None)


def _resp(parts):
    return SimpleNamespace(content=SimpleNamespace(parts=parts))


def _ctx(agent_name="component_builder_slot_1", state=None):
    return SimpleNamespace(agent_name=agent_name, state=state if state is not None else {})


# ── extract_tsx_from_prose ───────────────────────────────────────────────────
def test_extract_fenced_tsx_block():
    text = f"Here is the component:\n```tsx\n{_COMPONENT}```\nLet me know!"
    assert extract_tsx_from_prose(text) == _COMPONENT.strip()


def test_extract_untagged_fence():
    text = f"```\n{_COMPONENT}```"
    assert extract_tsx_from_prose(text) == _COMPONENT.strip()


def test_extract_prefers_block_with_default_export():
    snippet = "```tsx\nexport const x = 1; // tiny example helper line padding\n```"
    real = f"```tsx\n{_COMPONENT}```"
    text = f"Example:\n{snippet}\nFull component:\n{real}"
    assert extract_tsx_from_prose(text) == _COMPONENT.strip()


def test_extract_unfenced_raw_dump():
    assert extract_tsx_from_prose(_COMPONENT) == _COMPONENT.strip()


def test_extract_rejects_non_code_prose():
    assert extract_tsx_from_prose("I cannot build this component without more info.") is None
    assert extract_tsx_from_prose("") is None
    assert extract_tsx_from_prose(None) is None


def test_extract_rejects_tiny_snippet():
    # Has an export but is too short to be a real component.
    assert extract_tsx_from_prose("```tsx\nexport default X;\n```") is None


# ── salvage_prose_into_save_call ─────────────────────────────────────────────
def test_salvage_noop_when_function_call_present():
    resp = _resp([_call_part(_SAVE_TOOL_NAME)])
    assert salvage_prose_into_save_call(_ctx(), resp) is None


def test_salvage_noop_on_empty_or_none():
    assert salvage_prose_into_save_call(_ctx(), None) is None
    assert salvage_prose_into_save_call(_ctx(), SimpleNamespace(content=None)) is None
    assert salvage_prose_into_save_call(_ctx(), _resp([])) is None


def test_salvage_slot_scoped_component():
    state = {"_expected_component_name__component_builder_slot_1": "AdoptContent"}
    resp = _resp([_text_part(f"```tsx\n{_COMPONENT}```")])
    out = salvage_prose_into_save_call(_ctx("component_builder_slot_1", state), resp)
    assert out is resp  # non-None → ADK replaces the response
    parts = out.content.parts
    assert len(parts) == 1
    fc = parts[0].function_call
    assert fc.name == _SAVE_TOOL_NAME
    assert fc.args["component_name"] == "AdoptContent"
    assert "export default AdoptContent" in fc.args["code"]


def test_salvage_sequential_global_key():
    state = {"_expected_component_name": "AdoptContent"}
    resp = _resp([_text_part(f"```tsx\n{_COMPONENT}```")])
    out = salvage_prose_into_save_call(_ctx("ComponentBuilder", state), resp)
    assert out is resp
    assert out.content.parts[0].function_call.args["component_name"] == "AdoptContent"


def test_salvage_module_uses_module_tool_and_arg():
    state = {
        "_expected_component_name__component_builder_slot_2": "Sidebar",
        "_expected_save_tool_name__component_builder_slot_2": _MODULE_SAVE_TOOL_NAME,
    }
    resp = _resp([_text_part(f"```tsx\n{_MODULE}```")])
    out = salvage_prose_into_save_call(_ctx("component_builder_slot_2", state), resp)
    assert out is resp
    fc = out.content.parts[0].function_call
    assert fc.name == _MODULE_SAVE_TOOL_NAME
    assert fc.args["module_name"] == "Sidebar"
    assert "code" in fc.args


def test_salvage_bails_when_no_expected_name():
    # Code is present but we can't attribute it to a target → leave untouched.
    resp = _resp([_text_part(f"```tsx\n{_COMPONENT}```")])
    assert salvage_prose_into_save_call(_ctx("component_builder_slot_1", {}), resp) is None


def test_salvage_bails_on_non_code_prose():
    state = {"_expected_component_name__component_builder_slot_1": "AdoptContent"}
    resp = _resp([_text_part("Sorry, I need the model schema first.")])
    assert salvage_prose_into_save_call(_ctx("component_builder_slot_1", state), resp) is None


# ── composed callback (normalize + salvage) ──────────────────────────────────
def test_composed_callback_salvages_prose():
    from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder import (
        component_builder_after_model_callback,
    )

    state = {"_expected_component_name__component_builder_slot_1": "AdoptContent"}
    resp = _resp([_text_part(f"```tsx\n{_COMPONENT}```")])
    out = component_builder_after_model_callback(_ctx("component_builder_slot_1", state), resp)
    assert out is resp
    assert out.content.parts[0].function_call.name == _SAVE_TOOL_NAME


def test_composed_callback_normalizes_bad_tool_name():
    from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder import (
        component_builder_after_model_callback,
    )

    resp = _resp([_call_part("load_artifact")])  # near-miss alias
    out = component_builder_after_model_callback(_ctx(), resp)
    assert out is resp
    assert out.content.parts[0].function_call.name == "load_artifacts"


def test_composed_callback_noop_on_clean_call():
    from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder import (
        component_builder_after_model_callback,
    )

    resp = _resp([_call_part(_SAVE_TOOL_NAME)])
    assert component_builder_after_model_callback(_ctx(), resp) is None


# ── no-save diagnostics (log_unsalvageable_no_save) ──────────────────────────
# The dominant weak-model failure is a turn that returns neither a tool call nor
# salvageable code. Salvage declines silently, so without this the workflow only
# ever records "no artifact after builder" with no trace of the model's message.
def test_no_save_diag_logs_when_model_never_calls_save():
    state = {"_expected_component_name__component_builder_slot_1": "GalleryContent"}
    resp = _resp([_text_part("I need more information about the gallery images.")])
    assert log_unsalvageable_no_save(_ctx("component_builder_slot_1", state), resp) is True


def test_no_save_diag_silent_after_a_successful_save():
    """The trailing 'saved successfully' text turn must NOT be reported."""
    state = {
        "_expected_component_name__component_builder_slot_1": "GalleryContent",
        "_save_tool_calls:GalleryContent": 1,
    }
    resp = _resp([_text_part("Component saved successfully.")])
    assert log_unsalvageable_no_save(_ctx("component_builder_slot_1", state), resp) is False


def test_no_save_diag_silent_when_a_tool_was_called():
    state = {"_expected_component_name__component_builder_slot_1": "GalleryContent"}
    resp = _resp([_call_part(_SAVE_TOOL_NAME)])
    assert log_unsalvageable_no_save(_ctx("component_builder_slot_1", state), resp) is False


def test_no_save_diag_silent_without_an_expected_component():
    resp = _resp([_text_part("some text")])
    assert log_unsalvageable_no_save(_ctx("component_builder_slot_1", {}), resp) is False


def test_no_save_diag_flags_a_rejected_code_fence():
    """A fenced block the extractor rejected is a DIFFERENT bug than a refusal —
    had_code_fence separates them in the log.

    Asserts the EMITTED EVENT, not just the return value: `caplog` captures
    nothing here because apps/agent never calls structlog.configure(), so
    structlog does not route through stdlib logging. (Adversarial review
    2026-07-25 caught the original caplog block asserting nothing at all.)
    """
    import structlog

    state = {"_expected_component_name__component_builder_slot_1": "TermsContent"}
    # Fenced, but no export -> extract_tsx_from_prose refuses to salvage it.
    resp = _resp([_text_part("```tsx\nconst a = 1;\n```")])
    assert extract_tsx_from_prose(resp.content.parts[0].text) is None

    with structlog.testing.capture_logs() as logs:
        assert log_unsalvageable_no_save(_ctx("component_builder_slot_1", state), resp) is True

    assert len(logs) == 1
    ev = logs[0]
    assert ev["event"] == "builder_no_save_response"
    assert ev["component"] == "TermsContent"
    assert ev["had_code_fence"] is True
    assert ev["log_level"] == "warning"


def test_no_save_diag_reports_a_refusal_as_having_no_code_fence():
    """The other sub-shape: no code at all -> only re-prompting can fix it."""
    import structlog

    state = {"_expected_component_name__component_builder_slot_1": "GalleryContent"}
    resp = _resp([_text_part("I need more information about the gallery images.")])
    with structlog.testing.capture_logs() as logs:
        assert log_unsalvageable_no_save(_ctx("component_builder_slot_1", state), resp) is True
    assert logs[0]["had_code_fence"] is False
    assert logs[0]["text_len"] == len("I need more information about the gallery images.")


def test_no_save_diag_truncates_an_oversized_preview():
    """A whole component must not be dumped into the rig log."""
    import structlog

    from main_agent.agents.utils.prose_save_salvage import _NO_SAVE_PREVIEW_CHARS

    state = {"_expected_component_name__component_builder_slot_1": "HugeContent"}
    huge = "x" * (_NO_SAVE_PREVIEW_CHARS * 4)
    with structlog.testing.capture_logs() as logs:
        log_unsalvageable_no_save(
            _ctx("component_builder_slot_1", state), _resp([_text_part(huge)])
        )
    assert len(logs[0]["preview"]) == _NO_SAVE_PREVIEW_CHARS
    assert logs[0]["text_len"] == len(huge)


def test_no_save_diag_never_mutates_the_response():
    state = {"_expected_component_name__component_builder_slot_1": "GalleryContent"}
    part = _text_part("no code here")
    resp = _resp([part])
    log_unsalvageable_no_save(_ctx("component_builder_slot_1", state), resp)
    assert resp.content.parts == [part]
    assert resp.content.parts[0].function_call is None


def test_composed_callback_still_returns_none_on_unsalvageable_no_save():
    """Diagnostics must not turn a no-op turn into a response replacement."""
    from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder import (
        component_builder_after_model_callback,
    )

    state = {"_expected_component_name__component_builder_slot_1": "GalleryContent"}
    resp = _resp([_text_part("I cannot build this component.")])
    assert (
        component_builder_after_model_callback(_ctx("component_builder_slot_1", state), resp)
        is None
    )


# ── per-dispatch scoping of the no-save guard (review 2026-07-25) ────────────
# `_save_tool_calls:{component}` is session-cumulative and only the no-save retry
# resets it, so a bare `if counter: return False` silenced the diagnostic forever
# for any component that had ever saved.
def test_no_save_diag_fires_on_a_redispatch_after_an_earlier_save():
    """Component saved on an earlier dispatch, then no-saves on a later one."""
    from main_agent.agents.utils.prose_save_salvage import _dispatch_snapshot_key

    slot = "component_builder_slot_1"
    state = {
        "_expected_component_name__" + slot: "HeroContent",
        "_save_tool_calls:HeroContent": 1,  # cumulative, from a prior dispatch
        _dispatch_snapshot_key(slot, "HeroContent"): 1,  # baseline for THIS dispatch
    }
    resp = _resp([_text_part("I already built that component.")])
    assert log_unsalvageable_no_save(_ctx(slot, state), resp) is True


def test_no_save_diag_silent_when_this_dispatch_did_save():
    """Counter advanced past the dispatch baseline -> a real save happened."""
    from main_agent.agents.utils.prose_save_salvage import _dispatch_snapshot_key

    slot = "component_builder_slot_1"
    state = {
        "_expected_component_name__" + slot: "HeroContent",
        "_save_tool_calls:HeroContent": 2,
        _dispatch_snapshot_key(slot, "HeroContent"): 1,
    }
    resp = _resp([_text_part("Component saved successfully.")])
    assert log_unsalvageable_no_save(_ctx(slot, state), resp) is False


def test_no_save_diag_snapshot_is_per_component_not_just_per_slot():
    """A slot reused for a different component starts from that component's own
    baseline, not the previous occupant's."""
    from main_agent.agents.utils.prose_save_salvage import _dispatch_snapshot_key

    slot = "component_builder_slot_2"
    state = {
        "_expected_component_name__" + slot: "ContactContent",
        "_save_tool_calls:MainFooter": 1,  # round-1 occupant saved
        _dispatch_snapshot_key(slot, "MainFooter"): 0,
        _dispatch_snapshot_key(slot, "ContactContent"): 0,  # round-2 baseline
    }
    resp = _resp([_text_part("I've already built and saved the MainFooter component.")])
    assert log_unsalvageable_no_save(_ctx(slot, state), resp) is True
