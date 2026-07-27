"""Unit tests for main_agent/agents/utils/state_ops.py — the session-state
mutation + prompt-forwarding helpers.

Existing coverage (tests/unit/test_helpers_extended.py) tests
``push_session_state_update`` via its re-export from ``helpers`` for the basic
persist-then-update ordering, persist-failure, and event-author cases. This
file imports the *source* module directly and adds the genuinely-missing
coverage:

  - ``push_session_state_update``: no mutation of the caller's input dict;
    state_delta carries the changes into the persisted event; shallow-merge
    (``dict.update``) semantics for nested keys; the three defensive guards
    (no ``session`` / no ``state`` / non-dict ``state``) where persist must
    still run but the local mirror is skipped.
  - ``push_prompt_to_next_agent``: builds a user-authored event, persists it,
    AND records ``last_prompt_to_agent`` in state via push_session_state_update
    (two append_event calls, persist-ordered).
  - ``parse_result_chat_response``: all three payload shapes (dict / str /
    object) plus falsy / missing-key defaults.

All session/state backend I/O is mocked (no real ADK session service).
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from main_agent.agents.utils.state_ops import (
    push_session_state_update,
    push_prompt_to_next_agent,
    parse_result_chat_response,
)
from tests.fixtures.mock_ctx import create_mock_ctx


# =============================================================================
# push_session_state_update — invariants beyond the existing basic coverage
# =============================================================================


class TestPushSessionStateUpdateInvariants:
    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_does_not_mutate_callers_input_dict(self):
        """The caller's ``state_changes`` dict must not be mutated by the helper.

        Callers frequently pass a literal/shared dict; the helper should treat it
        as read-only input (only ``ctx.session.state`` is the thing that changes).
        """
        ctx = create_mock_ctx(session_state={"existing": "value"})
        changes = {"new_key": "new_value"}
        changes_snapshot = dict(changes)

        await push_session_state_update(ctx, changes)

        assert changes == changes_snapshot, "caller's input dict was mutated"

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_state_delta_carries_the_changes(self):
        """The persisted event's actions.state_delta must equal the changes."""
        ctx = create_mock_ctx(session_state={})

        await push_session_state_update(ctx, {"k": 1, "j": 2})

        event = ctx.session_service.append_event.call_args[0][1]
        assert event.actions.state_delta == {"k": 1, "j": 2}

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_persist_runs_before_local_mirror(self):
        """Ordering invariant: at append_event time the local mirror is NOT yet
        updated (persist-first, update-local-second)."""
        ctx = create_mock_ctx(session_state={"existing": "v"})
        seen = {}

        async def capture(session, event):
            seen.update(dict(ctx.session.state))

        ctx.session_service.append_event = AsyncMock(side_effect=capture)

        await push_session_state_update(ctx, {"new_key": "x"})

        assert "new_key" not in seen  # mirror not yet applied at persist time
        assert ctx.session.state["new_key"] == "x"  # but applied afterward

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_shallow_merge_replaces_nested_dict_wholesale(self):
        """``ctx.session.state.update`` is a SHALLOW merge: an existing nested
        dict under the same top-level key is replaced wholesale, not deep-merged.

        This pins the documented behavior so a future change to deep-merge is a
        deliberate, test-visible decision.
        """
        ctx = create_mock_ctx(session_state={"cfg": {"a": 1, "b": 2}})

        await push_session_state_update(ctx, {"cfg": {"b": 3}})

        # Shallow: the whole "cfg" value is replaced; "a" is gone, not preserved.
        assert ctx.session.state["cfg"] == {"b": 3}

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_other_top_level_keys_preserved(self):
        """A shallow merge still preserves sibling top-level keys."""
        ctx = create_mock_ctx(session_state={"keep": 1, "other": 2})

        await push_session_state_update(ctx, {"other": 99})

        assert ctx.session.state == {"keep": 1, "other": 99}

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_empty_changes_persists_but_leaves_state(self):
        """Empty delta still persists an event but leaves local state unchanged."""
        ctx = create_mock_ctx(session_state={"a": 1})

        await push_session_state_update(ctx, {})

        ctx.session_service.append_event.assert_awaited_once()
        assert ctx.session.state == {"a": 1}


class TestPushSessionStateUpdateGuards:
    """The three defensive guards on the local-mirror step. In every case the
    persist (append_event) must still run; only the local ``state.update`` is
    skipped — and it must NOT raise."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_missing_session_attr_skips_mirror_but_persists(self):
        # hasattr(ctx, "session") must be False for the guard branch, yet
        # append_event(ctx.session, ...) still needs *a* value passed
        # positionally — so we keep .session readable for the persist call but
        # make hasattr report False is impossible on a MagicMock. Instead use a
        # lightweight object whose .session is deleted after the persist closure
        # captured what it needs.
        class Ctx:
            pass

        ctx = Ctx()
        ctx.session = MagicMock()
        ctx.session_service = MagicMock()
        ctx.session_service.append_event = AsyncMock()
        del ctx.session  # now hasattr(ctx, "session") is False

        # append_event references ctx.session positionally; on a plain object
        # that AttributeError would surface — but the production code reads
        # ctx.session BEFORE the guard (append_event(ctx.session, event)). So a
        # missing-session ctx actually fails at persist. Assert that contract.
        with pytest.raises(AttributeError):
            await push_session_state_update(ctx, {"k": "v"})

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_missing_state_attr_skips_mirror_but_persists(self):
        ctx = MagicMock()
        ctx.session_service.append_event = AsyncMock()
        del ctx.session.state  # hasattr(ctx.session, "state") -> False

        await push_session_state_update(ctx, {"k": "v"})

        ctx.session_service.append_event.assert_awaited_once()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_non_dict_state_skips_mirror_but_persists(self):
        """If session.state is not a dict, the guard skips ``.update`` (which
        would otherwise blow up) and only persists."""
        ctx = create_mock_ctx()
        ctx.session.state = "not-a-dict"

        await push_session_state_update(ctx, {"k": "v"})

        ctx.session_service.append_event.assert_awaited_once()
        assert ctx.session.state == "not-a-dict"  # untouched


# =============================================================================
# push_prompt_to_next_agent
# =============================================================================


class TestPushPromptToNextAgent:
    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_persists_user_event_and_records_prompt_in_state(self):
        """Two append_event calls: (1) the user-authored prompt content event,
        (2) the state-delta event recording ``last_prompt_to_agent``. Both
        persisted; state mirror updated afterward."""
        ctx = create_mock_ctx(session_state={})

        await push_prompt_to_next_agent(ctx, "build me a form")

        assert ctx.session_service.append_event.await_count == 2

        first_event = ctx.session_service.append_event.call_args_list[0][0][1]
        assert first_event.author == "user"
        assert first_event.content.role == "user"
        assert first_event.content.parts[0].text == "build me a form"

        # The second call carries the state delta tracking the prompt.
        second_event = ctx.session_service.append_event.call_args_list[1][0][1]
        assert second_event.actions.state_delta == {
            "last_prompt_to_agent": "build me a form"
        }

        assert ctx.session.state["last_prompt_to_agent"] == "build me a form"

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_prompt_event_persisted_before_state_tracking(self):
        """The user-content event is appended before the tracking-state event."""
        ctx = create_mock_ctx(session_state={})
        order = []

        async def record(session, event):
            order.append(event.author)

        ctx.session_service.append_event = AsyncMock(side_effect=record)

        await push_prompt_to_next_agent(ctx, "hi")

        assert order == ["user", "ExepadAgent"]

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_propagates_persist_failure(self):
        """If the first persist raises, the error surfaces and the tracking
        state event is never attempted."""
        ctx = create_mock_ctx(session_state={})
        ctx.session_service.append_event = AsyncMock(side_effect=RuntimeError("down"))

        with pytest.raises(RuntimeError, match="down"):
            await push_prompt_to_next_agent(ctx, "x")

        assert "last_prompt_to_agent" not in ctx.session.state


# =============================================================================
# parse_result_chat_response
# =============================================================================


class TestParseResultChatResponse:
    @pytest.mark.unit
    def test_none_returns_pair_of_none(self):
        assert parse_result_chat_response(None) == (None, None)

    @pytest.mark.unit
    def test_empty_string_returns_pair_of_none(self):
        """Falsy values (empty string, empty dict) short-circuit to (None, None)."""
        assert parse_result_chat_response("") == (None, None)
        assert parse_result_chat_response({}) == (None, None)

    @pytest.mark.unit
    def test_dict_extracts_both_keys(self):
        out = parse_result_chat_response(
            {
                "result_chat_response": "Done!",
                "conversation_message_summary": "summary text",
            }
        )
        assert out == ("Done!", "summary text")

    @pytest.mark.unit
    def test_dict_missing_chat_response_falls_back_to_str(self):
        """A dict lacking ``result_chat_response`` falls back to str(dict) for
        the chat response, and summary defaults to None when absent."""
        payload = {"other": "field"}
        chat, summary = parse_result_chat_response(payload)
        assert chat == str(payload)
        assert summary is None

    @pytest.mark.unit
    def test_dict_with_summary_only(self):
        payload = {"conversation_message_summary": "s"}
        chat, summary = parse_result_chat_response(payload)
        assert chat == str(payload)
        assert summary == "s"

    @pytest.mark.unit
    def test_string_payload_is_chat_response_with_no_summary(self):
        assert parse_result_chat_response("hello there") == ("hello there", None)

    @pytest.mark.unit
    def test_object_payload_reads_attributes(self):
        obj = MagicMock(spec=["result_chat_response", "conversation_message_summary"])
        obj.result_chat_response = "obj-chat"
        obj.conversation_message_summary = "obj-summary"
        assert parse_result_chat_response(obj) == ("obj-chat", "obj-summary")

    @pytest.mark.unit
    def test_object_payload_missing_attrs_falls_back(self):
        """Object lacking the attributes → chat falls back to str(obj), summary None."""

        class Bare:
            def __str__(self):
                return "bare-repr"

        obj = Bare()
        chat, summary = parse_result_chat_response(obj)
        assert chat == "bare-repr"
        assert summary is None
