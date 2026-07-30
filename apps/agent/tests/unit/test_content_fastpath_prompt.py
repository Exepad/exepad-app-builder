"""ComponentBuilder content fast-path prompt contract (2026-06-27).

Deeper root cause of the long-content no-save on weak non-Gemini models: the
universal "ALWAYS LOAD SKILLS … Begin every turn by load_skill" prelude makes
the model spend its single ``include_contents="none"`` turn on a skill-discovery
tool call (``list_skills``) and the run ends before any save. For a content
component the copy is already inlined into ``content_source``, so no skill is
needed. A litellm repro vs deepseek-v4-flash flipped 0/6 → 5/6 saved once the
prompt told content components to skip skills and save first.

These pin the PROMPT CONTRACT deterministically (no live key needed): the
content fast-path directive is present in the suffix and the BUILD-FLOW prelude
carries the matching carve-out. (The end-to-end behaviour is proven by a live
weak-model rebuild during the test session.)
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder import (
    single_file_suffix,
    static_authoring_prefix,
)

pytestmark = [pytest.mark.unit]


def test_suffix_has_prose_fast_path_skill_skip():
    suffix = single_file_suffix()
    # The fast-path is scoped to PURE PROSE pages (not all content components).
    assert "Prose-page fast-path" in suffix
    assert "PURE PROSE" in suffix
    # The tools the weak model must NOT call when content_source is inlined.
    assert "list_skills" in suffix
    assert "load_skill" in suffix
    assert "load_artifacts" in suffix
    # And the imperative to save first (substring chosen to not span a line wrap).
    assert "FIRST and ONLY" in suffix
    assert "save tool" in suffix


def test_interactive_content_pages_still_load_domain_skill():
    """The fast-path must NOT suppress domain skills on interactive content
    pages (pricing/charts/tables) — that would undercut the pricing-CTA rule.
    (Review finding, 2026-06-27.)"""
    suffix = single_file_suffix()
    assert "interactive" in suffix
    assert "pricing-table" in suffix


def test_build_flow_prelude_references_the_exception():
    prefix = static_authoring_prefix()
    assert "ALWAYS LOAD SKILLS" in prefix  # the prelude still exists for other components
    assert "Exception — prose content fast-path" in prefix
    # Interactive content pages are explicitly kept on the skill-loading path.
    assert "interactive content pages" in prefix
