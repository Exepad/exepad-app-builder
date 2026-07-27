"""Sibling-modules refresh tests.

After every successful save / delete, the artifact tool layer is
expected to keep ``_codefocus_sibling_modules`` in lock-step with the
session-level artifact store so the *next* save / edit in the SAME
agent turn sees fresh peer source bytes. This is what gives
``ComponentBuilderMultiple`` cross-file tsc visibility on its first try.

Plan §2a covers the contract. These tests pin down the helpers that
implement it (``_refresh_sibling_modules``, ``_drop_sibling_module``,
``_record_artifact_write_kind``).
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.artifact_tools import (
    _drop_sibling_module,
    _record_artifact_write_kind,
    _refresh_sibling_modules,
)

pytestmark = [pytest.mark.unit]


# --------------------------------------------------------------------------- #
# Lightweight tool-context stand-in. The helpers only touch ``.state``.
# --------------------------------------------------------------------------- #


class _MockToolContext:
    def __init__(self, state: dict | None = None, agent_name: str = "") -> None:
        self.state: dict = state if state is not None else {}
        # ``_record_artifact_write_kind`` reads ``agent_name`` to decide
        # whether to namespace the write key per-polish-slot. Empty string
        # ⇒ falls through to the original global key, preserving these
        # tests' expectations.
        self.agent_name: str = agent_name


# --------------------------------------------------------------------------- #
# _refresh_sibling_modules
# --------------------------------------------------------------------------- #


class TestRefreshSiblingModules:
    def test_first_save_seeds_dict_keyed_by_bare_name(self):
        ctx = _MockToolContext()
        body = "import { React } from '@exepad/sdk'; export default function Hero(){}"
        _refresh_sibling_modules(ctx, "codefocus_component:Hero.tsx", body)
        # Bare name = no prefix, no .tsx extension.
        assert ctx.state["_codefocus_sibling_modules"] == {"Hero": body}

    def test_module_filename_keys_by_bare_name(self):
        ctx = _MockToolContext()
        body = "export function Card(){}"
        _refresh_sibling_modules(ctx, "codefocus_module:Card.tsx", body)
        assert ctx.state["_codefocus_sibling_modules"] == {"Card": body}

    def test_overwrites_existing_entry_with_fresh_source(self):
        ctx = _MockToolContext(
            state={"_codefocus_sibling_modules": {"Card": "OLD"}}
        )
        _refresh_sibling_modules(ctx, "codefocus_module:Card.tsx", "NEW")
        assert ctx.state["_codefocus_sibling_modules"] == {"Card": "NEW"}

    def test_preserves_other_modules_in_dict(self):
        ctx = _MockToolContext(
            state={
                "_codefocus_sibling_modules": {
                    "Hero": "import { React } from '@exepad/sdk';",
                    "Card": "OLD",
                }
            }
        )
        _refresh_sibling_modules(ctx, "codefocus_module:Card.tsx", "NEW")
        assert ctx.state["_codefocus_sibling_modules"] == {
            "Hero": "import { React } from '@exepad/sdk';",
            "Card": "NEW",
        }

    def test_repairs_non_dict_sibling_state(self):
        # The workflow seeds the dict, but tests / partial state could end
        # up with a non-dict value. The helper must replace it cleanly
        # rather than crash.
        ctx = _MockToolContext(state={"_codefocus_sibling_modules": "garbage"})
        _refresh_sibling_modules(ctx, "codefocus_component:Hero.tsx", "B")
        assert ctx.state["_codefocus_sibling_modules"] == {"Hero": "B"}

    def test_handles_filename_without_prefix_gracefully(self):
        ctx = _MockToolContext()
        # Defensive: even if a save tool somehow passed an unprefixed
        # name through, the helper must not crash. The bare key falls
        # back to the input minus the `.tsx` suffix.
        _refresh_sibling_modules(ctx, "Hero.tsx", "code")
        assert "Hero" in ctx.state["_codefocus_sibling_modules"]

    def test_visible_to_next_save_in_same_turn(self):
        # This is the central guarantee: the next save in the same turn
        # sees the freshly-saved peer.
        ctx = _MockToolContext()
        _refresh_sibling_modules(ctx, "codefocus_component:Hero.tsx", "v1")
        assert ctx.state["_codefocus_sibling_modules"]["Hero"] == "v1"
        # Simulate "next save" overwriting the same module
        _refresh_sibling_modules(ctx, "codefocus_component:Hero.tsx", "v2")
        assert ctx.state["_codefocus_sibling_modules"]["Hero"] == "v2"


# --------------------------------------------------------------------------- #
# _drop_sibling_module
# --------------------------------------------------------------------------- #


class TestDropSiblingModule:
    def test_drops_existing_entry(self):
        ctx = _MockToolContext(
            state={"_codefocus_sibling_modules": {"Hero": "X", "Card": "Y"}}
        )
        _drop_sibling_module(ctx, "codefocus_component:Hero.tsx")
        assert ctx.state["_codefocus_sibling_modules"] == {"Card": "Y"}

    def test_noop_when_module_not_present(self):
        ctx = _MockToolContext(
            state={"_codefocus_sibling_modules": {"Card": "Y"}}
        )
        _drop_sibling_module(ctx, "codefocus_component:Missing.tsx")
        assert ctx.state["_codefocus_sibling_modules"] == {"Card": "Y"}

    def test_noop_when_state_has_non_dict(self):
        ctx = _MockToolContext(state={"_codefocus_sibling_modules": None})
        # Must not crash — just leave state alone.
        _drop_sibling_module(ctx, "codefocus_component:Hero.tsx")
        assert ctx.state["_codefocus_sibling_modules"] is None


# --------------------------------------------------------------------------- #
# _record_artifact_write_kind
# --------------------------------------------------------------------------- #


class TestRecordArtifactWriteKind:
    def test_records_first_create(self):
        ctx = _MockToolContext()
        _record_artifact_write_kind(ctx, "codefocus_module:Card.tsx", "created")
        assert ctx.state["_files_created_this_turn"] == ["codefocus_module:Card.tsx"]

    def test_appends_subsequent_creates(self):
        ctx = _MockToolContext()
        _record_artifact_write_kind(ctx, "codefocus_module:Card.tsx", "created")
        _record_artifact_write_kind(ctx, "codefocus_component:Hero.tsx", "created")
        assert ctx.state["_files_created_this_turn"] == [
            "codefocus_module:Card.tsx",
            "codefocus_component:Hero.tsx",
        ]

    def test_dedupes_same_filename_within_turn(self):
        ctx = _MockToolContext()
        _record_artifact_write_kind(ctx, "codefocus_module:Card.tsx", "created")
        _record_artifact_write_kind(ctx, "codefocus_module:Card.tsx", "created")
        assert ctx.state["_files_created_this_turn"] == ["codefocus_module:Card.tsx"]

    def test_create_and_delete_use_independent_keys(self):
        ctx = _MockToolContext()
        _record_artifact_write_kind(ctx, "codefocus_module:NewCard.tsx", "created")
        _record_artifact_write_kind(ctx, "codefocus_module:OldCard.tsx", "deleted")
        assert ctx.state["_files_created_this_turn"] == ["codefocus_module:NewCard.tsx"]
        assert ctx.state["_files_deleted_this_turn"] == ["codefocus_module:OldCard.tsx"]

    def test_polish_slot_writes_to_per_slot_key(self):
        """When the caller is one of the polish pool's slots, the write
        MUST land on a slot-scoped key (``_files_{kind}_this_turn__{slot}``)
        so parallel slots don't corrupt a shared list. Non-polish callers
        keep the legacy global key — covered by the tests above."""
        slot = "component_builder_multiple_polish_slot_2"
        ctx = _MockToolContext(agent_name=slot)
        _record_artifact_write_kind(ctx, "codefocus_module:Shell.tsx", "modified")

        # Slot-scoped key holds the entry; the global key stays untouched.
        assert ctx.state[f"_files_modified_this_turn__{slot}"] == [
            "codefocus_module:Shell.tsx"
        ]
        assert "_files_modified_this_turn" not in ctx.state

    def test_polish_slots_write_to_disjoint_per_slot_keys(self):
        """Two polish slots writing in the same session must NOT collide —
        each slot's writes land on its own ``_files_modified_this_turn__{slot}``."""
        slot1 = "component_builder_multiple_polish_slot_1"
        slot2 = "component_builder_multiple_polish_slot_2"

        ctx1 = _MockToolContext(agent_name=slot1)
        ctx2 = _MockToolContext(agent_name=slot2)
        # Share the same state dict (single session state) — under
        # parallel dispatch ADK branches but the keys remain on the
        # same backing mapping.
        shared = {}
        ctx1.state = shared
        ctx2.state = shared

        _record_artifact_write_kind(ctx1, "codefocus_component:HomeContent.tsx", "modified")
        _record_artifact_write_kind(ctx2, "codefocus_component:AboutContent.tsx", "modified")

        assert shared[f"_files_modified_this_turn__{slot1}"] == [
            "codefocus_component:HomeContent.tsx"
        ]
        assert shared[f"_files_modified_this_turn__{slot2}"] == [
            "codefocus_component:AboutContent.tsx"
        ]


# --------------------------------------------------------------------------- #
# Inline cross-slot overlap detector
# --------------------------------------------------------------------------- #


class TestInlineCrossSlotOverlapDetector:
    """The v2 fix adds a per-save overlap detector inside
    ``_record_artifact_write_kind``. With the ``edit_artifact_tool``
    ownership gate in place this is defensively redundant, but it stays
    as a tripwire — if a future write tool skips the gate, the collision
    is logged the moment it happens (not at round-end, which a
    ``WORKFLOW_TIMEOUT`` cancellation would skip)."""

    def test_fires_when_peer_slot_already_wrote_same_file(self):
        from unittest.mock import patch

        slot1 = "component_builder_multiple_polish_slot_1"
        slot2 = "component_builder_multiple_polish_slot_2"

        shared: dict = {"_polish_active_slots": [slot1, slot2]}
        ctx1 = _MockToolContext(state=shared, agent_name=slot1)
        ctx2 = _MockToolContext(state=shared, agent_name=slot2)

        # slot_1 records the modification first — no peer has the file
        # yet, so no warning.
        with patch(
            "main_agent.agents.orchestrator.app_types.webapp.subagents.artifact_tools.logger"
        ) as logger_mock:
            _record_artifact_write_kind(
                ctx1, "codefocus_component:Shared.tsx", "modified"
            )
            assert not any(
                call.args and call.args[0] == "cross_slot_module_overlap_inline"
                for call in logger_mock.warning.call_args_list
            )

        # slot_2 records the SAME filename — peer-scan finds slot_1's
        # write, emits the inline warning.
        with patch(
            "main_agent.agents.orchestrator.app_types.webapp.subagents.artifact_tools.logger"
        ) as logger_mock:
            _record_artifact_write_kind(
                ctx2, "codefocus_component:Shared.tsx", "modified"
            )
            warning_calls = [
                call for call in logger_mock.warning.call_args_list
                if call.args and call.args[0] == "cross_slot_module_overlap_inline"
            ]
            assert len(warning_calls) == 1
            kwargs = warning_calls[0].kwargs
            assert kwargs["filename"] == "codefocus_component:Shared.tsx"
            assert kwargs["self_slot"] == slot2
            assert kwargs["peer_slot"] == slot1
            assert kwargs["kind"] == "modified"

    def test_non_polish_writer_never_triggers_detector(self):
        from unittest.mock import patch

        slot1 = "component_builder_multiple_polish_slot_1"
        peer_state: dict = {
            "_polish_active_slots": [slot1],
            f"_files_modified_this_turn__{slot1}": [
                "codefocus_component:Shared.tsx"
            ],
        }
        # Non-polish agent_name, even with a peer slot already holding
        # the same filename — detector must NOT fire (polish-slot-only).
        ctx = _MockToolContext(state=peer_state, agent_name="ComponentBuilder")

        with patch(
            "main_agent.agents.orchestrator.app_types.webapp.subagents.artifact_tools.logger"
        ) as logger_mock:
            _record_artifact_write_kind(
                ctx, "codefocus_component:Shared.tsx", "modified"
            )
            assert not any(
                call.args and call.args[0] == "cross_slot_module_overlap_inline"
                for call in logger_mock.warning.call_args_list
            )

    def test_polish_slot_writing_alone_does_not_warn(self):
        """Single-slot writes (no peer has touched the file yet) must
        stay silent; otherwise every save would log a spurious warning."""
        from unittest.mock import patch

        slot1 = "component_builder_multiple_polish_slot_1"
        slot2 = "component_builder_multiple_polish_slot_2"
        ctx = _MockToolContext(
            state={"_polish_active_slots": [slot1, slot2]},
            agent_name=slot1,
        )

        with patch(
            "main_agent.agents.orchestrator.app_types.webapp.subagents.artifact_tools.logger"
        ) as logger_mock:
            _record_artifact_write_kind(
                ctx, "codefocus_component:Solo.tsx", "modified"
            )
            assert not any(
                call.args and call.args[0] == "cross_slot_module_overlap_inline"
                for call in logger_mock.warning.call_args_list
            )
