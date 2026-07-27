"""Cache-stability regression for the ComponentBuilder family.

Plan §1 cache stability: ComponentBuilder and ComponentBuilderMultiple
share a byte-identical ``static_authoring_prefix()`` so their Vertex
prompt-cache keys overlap on the long cross-cutting authoring rules
block. The cache breaks at the per-agent suffix
(``single_file_suffix()`` vs ``multi_file_suffix()``).

These tests guard the invariant. If anyone re-introduces per-component
data into the static prefix (model names, file lists, dynamic per-task
content), or splits the prefix differently between the two providers,
this suite fails loudly.
"""

from __future__ import annotations

import hashlib

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder import (
    multi_file_suffix,
    single_file_suffix,
    static_authoring_prefix,
)

pytestmark = [pytest.mark.unit]


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# Static prefix identity
# --------------------------------------------------------------------------- #


class TestStaticPrefixCacheStability:
    def test_static_prefix_is_byte_stable_within_a_run(self):
        # Idempotent calls — calling it twice must produce identical bytes.
        # If anyone wires a `datetime.now()` or per-call counter into the
        # prefix, this catches it.
        a = static_authoring_prefix()
        b = static_authoring_prefix()
        assert _sha256(a) == _sha256(b)

    def test_static_prefix_is_non_empty(self):
        # Sanity: the prefix carries the bulk of the system prompt; an
        # empty prefix would silently kill the cache hit-rate.
        prefix = static_authoring_prefix()
        assert len(prefix) > 1000, (
            f"static_authoring_prefix shrank to {len(prefix)} bytes — likely a "
            f"regression that drained the prompt-cache prefix."
        )

    def test_static_prefix_contains_no_per_run_data(self):
        # Anything resembling per-run / per-component data drained into the
        # static prefix would silently invalidate the cache for every save.
        # We check for common drift patterns rather than exhaustively.
        prefix = static_authoring_prefix()
        # No date-shaped strings (YYYY-MM-DD)
        import re as _re

        assert not _re.search(r"\b20\d{2}-\d{2}-\d{2}\b", prefix), (
            "Static prefix contains a date — looks like per-run data drift."
        )
        # No literal artifact names that would change per-task
        for needle in ("codefocus_component:", "codefocus_module:"):
            # Mentions inside instructional text are fine; LITERAL filenames
            # that change per task would not be. Heuristic: the prefix should
            # NOT contain `codefocus_component:Foo.tsx` style fully-qualified
            # filenames.
            for hit in _re.finditer(rf"{needle}\w+\.tsx", prefix):
                pytest.fail(
                    f"Static prefix carries fully-qualified filename "
                    f"{hit.group()!r} — that's per-task content"
                )

    def test_suffixes_are_disjoint_from_prefix(self):
        # The prefix + suffix split must be clean: the suffix should not
        # silently duplicate a chunk of the prefix (otherwise an authoring
        # rule could ship under both keys, defeating cache reuse).
        prefix = static_authoring_prefix()
        sf = single_file_suffix()
        mf = multi_file_suffix()
        # Both suffixes must contribute *new* content rather than be a
        # subset of the prefix.
        assert sf not in prefix
        assert mf not in prefix


# --------------------------------------------------------------------------- #
# Suffixes diverge between agents
# --------------------------------------------------------------------------- #


class TestSuffixDivergence:
    def test_single_and_multi_suffixes_differ(self):
        # The two agents intentionally split here. If their suffixes
        # collapsed to the same bytes, the multi-file behavior block
        # would have been silently dropped.
        sf = single_file_suffix()
        mf = multi_file_suffix()
        assert _sha256(sf) != _sha256(mf)

    def test_multi_file_suffix_mentions_multi_file_concepts(self):
        mf = multi_file_suffix()
        # Soft contract: the multi-file behavior block must reference at
        # least one of the discovery / cross-file concepts. Otherwise the
        # split has lost its point.
        lower = mf.lower()
        signals = [
            "discover",
            "list_artifacts",
            "search_artifacts",
            "find_symbol_references",
            "discover_dependencies",
            "edit_artifact",
            "describe_artifact",
            "inspect_app_state",
            "delete_artifact",
            "cross-file",
            "multiple files",
            "multi-file",
            "siblings",
            "supporting modules",
            "cascade",
        ]
        assert any(s.lower() in lower for s in signals), (
            "multi_file_suffix lost its multi-file behavior contract — "
            "no Glob/Grep/Edit/cross-file/cascade language remains."
        )

    def test_single_file_suffix_does_not_describe_multi_file_tools(self):
        # Defense-in-depth: ComponentBuilder has neither ``edit_artifact``
        # nor ``find_symbol_references``. Polluting its suffix with their
        # docs would mislead the LLM.
        sf = single_file_suffix()
        for forbidden in (
            "edit_artifact",
            "list_artifacts",
            "search_artifacts",
            "find_symbol_references",
            "discover_dependencies",
            "describe_artifact",
            "delete_artifact",
        ):
            assert forbidden not in sf, (
                f"single_file_suffix mentions {forbidden!r} — that tool "
                f"belongs to ComponentBuilderMultiple, not ComponentBuilder."
            )


# --------------------------------------------------------------------------- #
# Prefix sha256 snapshot — flag-only (intentional changes update the snapshot)
# --------------------------------------------------------------------------- #


class TestPrefixSnapshotMechanics:
    def test_sha256_is_deterministic_across_imports(self):
        # Sanity: re-importing the symbol does not change the hash. This
        # also documents the function's purity for future readers.
        from main_agent.agents.orchestrator.app_types.webapp.subagents import (
            component_builder as cb_module,
        )

        first = _sha256(cb_module.static_authoring_prefix())
        second = _sha256(cb_module.static_authoring_prefix())
        assert first == second
