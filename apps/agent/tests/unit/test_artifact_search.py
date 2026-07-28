"""Unit tests for `main_agent.services.artifact_search`.

Covers the three coding-agent primitives:
- ``list_artifacts_by_pattern`` (Glob)
- ``search_artifact_contents`` (Grep)
- ``apply_edit_to_artifact`` (Edit splice)
"""

from __future__ import annotations

import pytest

from main_agent.services.artifact_search import (
    FRONTEND_ARTIFACT_PREFIXES,
    apply_edit_to_artifact,
    is_frontend_artifact_name,
    list_artifacts_by_pattern,
    search_artifact_contents,
)

pytestmark = [pytest.mark.unit]


# --------------------------------------------------------------------------- #
# is_frontend_artifact_name + prefix surface
# --------------------------------------------------------------------------- #


class TestFrontendPrefixSurface:
    def test_recognises_each_frontend_prefix(self):
        assert is_frontend_artifact_name("codefocus_component:Foo.tsx")
        assert is_frontend_artifact_name("codefocus_module:Bar.tsx")
        assert is_frontend_artifact_name("codefocus_style:theme.css")

    def test_rejects_backend_prefixes(self):
        assert not is_frontend_artifact_name("handler_code:do_thing.tsx")
        assert not is_frontend_artifact_name("backend.json")
        assert not is_frontend_artifact_name("seed:students.csv")

    def test_rejects_unprefixed(self):
        assert not is_frontend_artifact_name("logic.json")
        assert not is_frontend_artifact_name("README.md")
        assert not is_frontend_artifact_name("")

    def test_prefix_set_is_canonical(self):
        # Plan §2b nails the allowlist; regression guard against silent expansion.
        assert FRONTEND_ARTIFACT_PREFIXES == (
            "codefocus_component:",
            "codefocus_module:",
            "codefocus_style:",
        )


# --------------------------------------------------------------------------- #
# Glob — list_artifacts_by_pattern
# --------------------------------------------------------------------------- #


class TestListArtifactsByPattern:
    @pytest.fixture
    def names(self) -> list[str]:
        return [
            "codefocus_component:Hero.tsx",
            "codefocus_component:Card.tsx",
            "codefocus_module:Charts.tsx",
            "codefocus_module:DataLib.tsx",
            "codefocus_style:theme.css",
            "handler_code:get_users.tsx",  # backend → must be filtered
            "backend.json",
            "logic.json",
        ]

    def test_returns_sorted_dedup_list(self, names):
        result = list_artifacts_by_pattern("codefocus_*", names)
        assert result == sorted(result)
        assert len(result) == len(set(result))

    def test_includes_all_frontend_artifacts_with_codefocus_glob(self, names):
        result = list_artifacts_by_pattern("codefocus_*", names)
        assert result == [
            "codefocus_component:Card.tsx",
            "codefocus_component:Hero.tsx",
            "codefocus_module:Charts.tsx",
            "codefocus_module:DataLib.tsx",
            "codefocus_style:theme.css",
        ]

    def test_module_only_glob(self, names):
        result = list_artifacts_by_pattern("codefocus_module:*", names)
        assert result == [
            "codefocus_module:Charts.tsx",
            "codefocus_module:DataLib.tsx",
        ]

    def test_component_only_glob(self, names):
        result = list_artifacts_by_pattern("codefocus_component:*", names)
        assert result == [
            "codefocus_component:Card.tsx",
            "codefocus_component:Hero.tsx",
        ]

    def test_substring_glob(self, names):
        result = list_artifacts_by_pattern("codefocus_module:*art*", names)
        assert result == ["codefocus_module:Charts.tsx"]

    def test_filters_backend_prefixes_regardless_of_pattern(self, names):
        # Even a permissive pattern must NOT surface backend artifacts.
        result = list_artifacts_by_pattern("*", names)
        for name in result:
            assert is_frontend_artifact_name(name), f"backend leaked: {name}"

    def test_handler_code_glob_returns_empty(self, names):
        # The agent has no business listing handler artifacts.
        assert list_artifacts_by_pattern("handler_code:*", names) == []

    def test_no_matches_returns_empty(self, names):
        assert list_artifacts_by_pattern("codefocus_module:DoesNotExist.tsx", names) == []

    def test_empty_names_input(self):
        assert list_artifacts_by_pattern("codefocus_*", []) == []


# --------------------------------------------------------------------------- #
# Grep — search_artifact_contents
# --------------------------------------------------------------------------- #


class TestSearchArtifactContents:
    @pytest.fixture
    def sources(self) -> dict[str, str]:
        return {
            "codefocus_component:Hero.tsx": (
                "import { React, navigate } from '@exepad/sdk';\n"
                "function Hero() {\n"
                "  return <button onClick={() => navigate('/about')}>Go</button>;\n"
                "}\n"
                "export default Hero;\n"
            ),
            "codefocus_module:Card.tsx": (
                "// A simple Card declaration\n"
                "export function Card({ label }) {\n"
                "  return <div>{label}</div>;\n"
                "}\n"
            ),
            "codefocus_style:theme.css": (
                "@theme { --color-primary: #0f766e; }\n"
            ),
            # Backend artifact — must NEVER be searched
            "handler_code:do_thing.tsx": "export default function do_thing() {}\n",
        }

    def test_simple_match_returns_filename_line_no_offset(self, sources):
        hits, truncated = search_artifact_contents("navigate\\(", sources)
        assert truncated is False
        # "navigate(" appears once — only at the call site.
        assert len(hits) == 1
        h = hits[0]
        assert h.filename == "codefocus_component:Hero.tsx"
        assert h.line_no == 3
        assert "navigate('/about')" in h.line
        assert h.byte_offset >= 0

    def test_skips_backend_artifacts_regardless_of_glob(self, sources):
        hits, _ = search_artifact_contents("export default", sources, name_glob="*")
        # No hit on handler_code:* — the prefix allowlist filters them out.
        assert all(
            not h.filename.startswith("handler_code:") for h in hits
        )

    def test_name_glob_narrows_search(self, sources):
        hits, _ = search_artifact_contents(
            "export", sources, name_glob="codefocus_module:*"
        )
        assert all(h.filename.startswith("codefocus_module:") for h in hits)

    def test_max_results_cap_truncates(self, sources):
        # Force many matches by searching for a very common token
        many_lines = "x\n" * 10
        s = {f"codefocus_module:m{i}.tsx": many_lines for i in range(5)}
        hits, truncated = search_artifact_contents("x", s, max_results=3)
        assert len(hits) == 3
        assert truncated is True

    def test_max_results_not_truncated_when_below_cap(self, sources):
        hits, truncated = search_artifact_contents(
            "navigate\\(", sources, max_results=200
        )
        assert truncated is False
        assert len(hits) == 1

    def test_case_insensitive_flag(self, sources):
        hits, _ = search_artifact_contents("HERO", sources, flags=["i"])
        assert any("Hero" in h.line for h in hits)

    def test_case_sensitive_default(self, sources):
        hits, _ = search_artifact_contents("HERO", sources)
        assert hits == []

    def test_string_literal_and_comment_hits_returned(self, sources):
        # Document the dumb-regex semantics: comment lines DO match.
        hits, _ = search_artifact_contents("simple Card", sources)
        assert any("// A simple Card declaration" in h.line for h in hits)

    def test_invalid_regex_raises(self, sources):
        # Caller catches re.error at the FunctionTool layer; the service
        # itself raises so callers see exactly what failed.
        import re as _re

        with pytest.raises(_re.error):
            search_artifact_contents("[unclosed", sources)

    def test_empty_sources_returns_empty(self):
        hits, truncated = search_artifact_contents("anything", {})
        assert hits == []
        assert truncated is False

    def test_byte_offset_round_trips_through_source(self, sources):
        hits, _ = search_artifact_contents("export default Hero", sources)
        assert len(hits) == 1
        h = hits[0]
        src = sources[h.filename]
        # The reported byte offset MUST point at the first byte of the match.
        assert src[h.byte_offset:].startswith("export default Hero")


# --------------------------------------------------------------------------- #
# Edit — apply_edit_to_artifact
# --------------------------------------------------------------------------- #


class TestApplyEditToArtifact:
    def test_unique_replace_succeeds(self):
        result = apply_edit_to_artifact(
            "function Card({ label }) {}",
            old_string="label",
            new_string="title",
        )
        assert result.ok is True
        assert result.edits_applied == 1
        assert result.new_source == "function Card({ title }) {}"
        assert result.error is None

    def test_replace_all_replaces_every_occurrence(self):
        result = apply_edit_to_artifact(
            "label, label, label",
            old_string="label",
            new_string="title",
            replace_all=True,
        )
        assert result.ok is True
        assert result.edits_applied == 3
        assert result.new_source == "title, title, title"

    def test_non_unique_old_string_rejects_when_replace_all_false(self):
        result = apply_edit_to_artifact(
            "label, label, label",
            old_string="label",
            new_string="title",
            replace_all=False,
        )
        assert result.ok is False
        assert result.edits_applied == 0
        assert result.error is not None
        assert "matched 3 times" in result.error
        # Source MUST be unchanged on failure
        assert result.new_source == "label, label, label"

    def test_old_string_not_found_rejects(self):
        result = apply_edit_to_artifact(
            "function Card() {}",
            old_string="DoesNotExist",
            new_string="title",
        )
        assert result.ok is False
        assert result.edits_applied == 0
        assert "not found" in result.error.lower()

    def test_empty_old_string_rejects(self):
        result = apply_edit_to_artifact(
            "function Card() {}",
            old_string="",
            new_string="x",
        )
        assert result.ok is False
        assert "must not be empty" in result.error

    def test_identical_old_and_new_rejects(self):
        result = apply_edit_to_artifact(
            "function Card() {}",
            old_string="Card",
            new_string="Card",
        )
        assert result.ok is False
        assert "identical" in result.error

    def test_preserves_whitespace_and_indentation(self):
        src = "    const x = 1;\n    const y = 2;\n"
        result = apply_edit_to_artifact(
            src,
            old_string="const x = 1;",
            new_string="const x = 99;",
        )
        assert result.ok is True
        # Leading 4-space indent must survive.
        assert "    const x = 99;" in result.new_source

    def test_replace_all_with_zero_matches_rejects(self):
        result = apply_edit_to_artifact(
            "abc",
            old_string="xyz",
            new_string="123",
            replace_all=True,
        )
        assert result.ok is False
        assert "not found" in result.error.lower()
