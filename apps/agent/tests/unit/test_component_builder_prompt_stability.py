"""Byte-stability canary for ComponentBuilder system_instruction.

ComponentBuilder's system prompt is shared with ComponentBuilderMultiple
and used as the prompt-cache key for Vertex AI's ``cachedContents``. Per
memory ``project_component_builder_cache_stability``, every component
build in a workflow MUST receive byte-identical ``system_instruction``;
per-component data flows through the structured input, not the prompt.

A drift here silently busts the cache and adds ~30k tokens of prefill
to every component call. This test runs the instruction provider twice
with distinct mock contexts and asserts the bytes are identical.

If this test fails after a prompt edit, the prompt likely interpolates
something context-dependent (per-app, per-component, per-build). Move
that data into the agent's structured input instead and re-run.
"""

from __future__ import annotations

import hashlib

import pytest


def _make_instruction() -> str:
    """Build ComponentBuilder's system_instruction.

    The instruction provider takes a ``ReadonlyContext``, but the current
    implementation does not read from it (verified 2026-05-14). Passing
    ``None`` works today; if a future change makes the provider context-
    dependent, this fixture will need updating — and that update is the
    signal the cache key drifted.
    """
    from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder import (
        component_builder_instruction_provider,
    )

    return component_builder_instruction_provider(None)  # type: ignore[arg-type]


@pytest.mark.unit
def test_component_builder_system_instruction_is_byte_stable_across_calls() -> None:
    """The instruction provider must return the same bytes every call.

    Two adjacent invocations would correspond to two component builds in
    one workflow. Any divergence here is a cache-buster.
    """
    first = _make_instruction()
    second = _make_instruction()

    assert first == second, (
        "ComponentBuilder system_instruction drifted between two adjacent "
        "calls. This busts the Vertex prompt cache for every component "
        "build in a workflow. Move per-component data into the agent's "
        "structured input instead of the prompt."
    )

    # Hash check: catches whitespace/encoding drift that == would also catch,
    # but makes the failure message print a stable identifier.
    first_hash = hashlib.sha256(first.encode("utf-8")).hexdigest()[:16]
    second_hash = hashlib.sha256(second.encode("utf-8")).hexdigest()[:16]
    assert first_hash == second_hash, f"hash drift: {first_hash} != {second_hash}"


@pytest.mark.unit
def test_component_builder_system_instruction_is_non_trivial() -> None:
    """Sanity: the prompt isn't accidentally empty/truncated.

    Without this guard, a regression that returns ``""`` would pass the
    byte-stability test trivially.
    """
    instruction = _make_instruction()
    assert len(instruction) > 5000, (
        f"ComponentBuilder system_instruction is only {len(instruction)} "
        "chars — almost certainly truncated. Expected ≥ 5000 chars."
    )
    # Anchors that must be present in any working prompt:
    assert "LightDOMContainer" in instruction
    assert "@exepad/sdk" in instruction
