"""Unit tests for the plan artifact materializer.

Locks down the Creator → workflow handoff contract: artifacts saved via
``save_plan_artifact`` are inlined into the classic ``building_plan: list[str]``
shape before any downstream consumer (ComponentBuilder, summary
builders) reads the plan dict.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services.plan_artifact_materializer import (
    _parse_plan_markdown,
    _synthesize_building_plan,
    materialize_plan_artifacts,
)
from main_agent.errors import PipelineError

pytestmark = [pytest.mark.unit]


# =============================================================================
# Markdown parser
# =============================================================================


class TestParsePlanMarkdown:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            # Hyphen bullets
            ("- foo\n- bar", ["foo", "bar"]),
            # Asterisk bullets
            ("* foo\n* bar", ["foo", "bar"]),
            # Plus bullets
            ("+ foo\n+ bar", ["foo", "bar"]),
            # Bullet character (Unicode)
            ("• foo\n• bar", ["foo", "bar"]),
            # Mixed bullet styles
            ("- foo\n* bar\n+ baz\n• qux", ["foo", "bar", "baz", "qux"]),
            # Plain lines (no bullet) keep content verbatim
            ("first\nsecond\nthird", ["first", "second", "third"]),
            # Empty input → empty list
            ("", []),
            # Whitespace-only → empty list
            ("\n\n\t  \n", []),
        ],
    )
    def test_bullet_variants(self, raw: str, expected: list[str]):
        assert _parse_plan_markdown(raw) == expected

    def test_skips_section_headers(self):
        md = "## Layout\n- hero\n- nav\n## Data\n- useModel users"
        assert _parse_plan_markdown(md) == ["hero", "nav", "useModel users"]

    def test_skips_top_level_headings(self):
        md = "# Title\n- bullet"
        assert _parse_plan_markdown(md) == ["bullet"]

    def test_strips_surrounding_whitespace(self):
        md = "  - foo  \n\t- bar\n"
        assert _parse_plan_markdown(md) == ["foo", "bar"]

    def test_blank_lines_dropped(self):
        md = "- foo\n\n\n- bar\n\n"
        assert _parse_plan_markdown(md) == ["foo", "bar"]

    def test_unicode_content_preserved(self):
        md = "- レイアウト: ヒーロー画像\n- データ: 製品リスト"
        assert _parse_plan_markdown(md) == [
            "レイアウト: ヒーロー画像",
            "データ: 製品リスト",
        ]


# =============================================================================
# Materializer
# =============================================================================


def _mock_ctx(image_catalog: list[dict] | None = None) -> MagicMock:
    """Minimal InvocationContext mock — only the bits the materializer
    touches via ArtifactManager.load_artifact_as_string and the
    image_catalog read from session state.
    """
    ctx = MagicMock()
    ctx.artifact_service = MagicMock()
    ctx.session = MagicMock()
    ctx.session.id = "test-session"
    ctx.session.user_id = "test-user"
    ctx.session.app_name = "test-app"
    # ctx.session.state must be a real dict so ``.get("image_catalog", [])``
    # returns an actual list, not a MagicMock proxy. Older tests that don't
    # set the catalog get an empty list (no-op for distribution logic).
    ctx.session.state = {"image_catalog": image_catalog or []}
    return ctx


def _patch_loader(return_value: dict[str, str]):
    """Patch ArtifactManager.load_artifact_as_string with a per-filename map."""

    async def loader(ctx, filename, version=None):
        return return_value.get(filename)

    return patch(
        "main_agent.agents.orchestrator.app_types.webapp.services."
        "plan_artifact_materializer.ArtifactManager.load_artifact_as_string",
        new=AsyncMock(side_effect=loader),
    )


class TestMaterializePlanArtifacts:
    @pytest.mark.asyncio
    async def test_app_artifact_materializes_into_inline_list(self):
        plan = {
            "app_building_plan": [],
            "app_building_plan_artifact": "plan:app.md",
            "component_plans": [],
        }
        with _patch_loader({"plan:app.md": "- Goal: build platformer\n- Pages: home, play"}):
            await materialize_plan_artifacts(plan, _mock_ctx())

        assert plan["app_building_plan"] == [
            "Goal: build platformer",
            "Pages: home, play",
        ]
        # Artifact ref is cleared after successful materialization so the
        # plan dict has a single source of truth for downstream callers.
        assert plan["app_building_plan_artifact"] == ""

    @pytest.mark.asyncio
    async def test_inline_wins_over_artifact_when_both_populated(self):
        """New contract: inline bullets take precedence over an artifact ref.
        The Creator instruction forbids emitting both, but if some path ever
        leaves a non-empty inline ``building_plan`` next to an artifact ref,
        the inline list wins and the artifact is NOT loaded — resolution order
        is inline > artifact > synthesis. The stale artifact ref is cleared so
        downstream callers see a single source of truth.
        """
        plan = {
            "app_building_plan": ["inline app bullet"],
            "app_building_plan_artifact": "plan:app.md",
            "component_plans": [
                {
                    "name": "HomeContent",
                    "building_plan": ["inline home bullet"],
                    "building_plan_artifact": "plan:HomeContent.md",
                },
            ],
        }
        with _patch_loader(
            {
                "plan:app.md": "- canonical app bullet 1\n- canonical app bullet 2",
                "plan:HomeContent.md": "- canonical home bullet",
            }
        ):
            await materialize_plan_artifacts(plan, _mock_ctx())

        # Inline kept; artifact body ignored; stale ref cleared.
        assert plan["app_building_plan"] == ["inline app bullet"]
        assert plan["app_building_plan_artifact"] == ""
        assert plan["component_plans"][0]["building_plan"] == ["inline home bullet"]
        assert plan["component_plans"][0]["building_plan_artifact"] == ""

    @pytest.mark.asyncio
    async def test_artifact_ref_not_cleared_when_load_fails(self):
        """If the artifact load fails (missing or empty) AND there is no inline
        list, keep the ref so logs still show the bogus filename and the
        failure is debuggable. (With a non-empty inline list, inline wins and
        the ref is cleared without a load — covered by the inline-precedence
        test above.)"""
        plan = {
            "app_building_plan": [],
            "app_building_plan_artifact": "plan:nonexistent.md",
            "component_plans": [],
        }
        with _patch_loader({}):  # loader returns None
            await materialize_plan_artifacts(plan, _mock_ctx())

        assert plan["app_building_plan"] == []
        assert plan["app_building_plan_artifact"] == "plan:nonexistent.md"

    @pytest.mark.asyncio
    async def test_per_component_artifact_materializes(self):
        plan = {
            "app_building_plan": ["app bullet"],
            "component_plans": [
                {
                    "name": "HomeContent",
                    "building_plan": [],
                    "building_plan_artifact": "plan:HomeContent.md",
                },
                {
                    "name": "GameContent",
                    "building_plan": [],
                    "building_plan_artifact": "plan:GameContent.md",
                },
            ],
        }
        with _patch_loader(
            {
                "plan:HomeContent.md": "- Hero with CTA\n- Features section",
                "plan:GameContent.md": "- Canvas\n- Physics\n- Score",
            }
        ):
            await materialize_plan_artifacts(plan, _mock_ctx())

        assert plan["component_plans"][0]["building_plan"] == [
            "Hero with CTA",
            "Features section",
        ]
        assert plan["component_plans"][0]["building_plan_artifact"] == ""
        assert plan["component_plans"][1]["building_plan"] == [
            "Canvas",
            "Physics",
            "Score",
        ]
        assert plan["component_plans"][1]["building_plan_artifact"] == ""
        # App-wide unchanged (no app artifact set).
        assert plan["app_building_plan"] == ["app bullet"]

    @pytest.mark.asyncio
    async def test_missing_artifact_leaves_inline_list_alone(self):
        """Loader returns None → materializer warns and preserves the
        existing inline list. Never destructive."""
        plan = {
            "app_building_plan": ["fallback bullet"],
            "app_building_plan_artifact": "plan:missing.md",
            "component_plans": [],
        }
        with _patch_loader({}):  # no entries
            await materialize_plan_artifacts(plan, _mock_ctx())

        assert plan["app_building_plan"] == ["fallback bullet"]

    @pytest.mark.asyncio
    async def test_no_artifact_refs_is_noop(self):
        """When neither artifact field is set, every list[str] passes
        through unchanged. This is the common case for design-import
        flows and small custom apps."""
        plan = {
            "app_building_plan": ["a", "b"],
            "component_plans": [
                {"name": "HomeContent", "building_plan": ["x", "y"]},
            ],
        }
        with _patch_loader({}):
            await materialize_plan_artifacts(plan, _mock_ctx())

        assert plan["app_building_plan"] == ["a", "b"]
        assert plan["component_plans"][0]["building_plan"] == ["x", "y"]

    @pytest.mark.asyncio
    async def test_idempotent(self):
        """Calling twice is safe. First call materializes + clears the
        artifact ref; second call sees an empty ref and is a true no-op
        on the already-populated inline list."""
        plan = {
            "app_building_plan": [],
            "app_building_plan_artifact": "plan:app.md",
            "component_plans": [],
        }
        loader = AsyncMock(side_effect=lambda ctx, fn, version=None: "- one\n- two")
        with patch(
            "main_agent.agents.orchestrator.app_types.webapp.services."
            "plan_artifact_materializer.ArtifactManager.load_artifact_as_string",
            new=loader,
        ):
            await materialize_plan_artifacts(plan, _mock_ctx())
            first = list(plan["app_building_plan"])
            await materialize_plan_artifacts(plan, _mock_ctx())
            second = list(plan["app_building_plan"])

        assert first == second == ["one", "two"]
        # Loader called once; second pass skipped because ref was cleared.
        assert loader.await_count == 1

    @pytest.mark.asyncio
    async def test_handles_non_dict_component_plan_entries(self):
        """component_plans may contain stray non-dict entries from
        upstream serialization — must not crash."""
        plan = {
            "component_plans": [
                None,
                "not a dict",
                {"name": "Real", "building_plan": [], "building_plan_artifact": "plan:Real.md"},
            ],
        }
        with _patch_loader({"plan:Real.md": "- bullet"}):
            await materialize_plan_artifacts(plan, _mock_ctx())

        assert plan["component_plans"][2]["building_plan"] == ["bullet"]

    @pytest.mark.asyncio
    async def test_returns_same_dict(self):
        plan = {"component_plans": []}
        with _patch_loader({}):
            result = await materialize_plan_artifacts(plan, _mock_ctx())
        assert result is plan

    @pytest.mark.asyncio
    async def test_naming_convention_fallback_recovers_dropped_artifact_ref(self):
        """When Creator's structured output drops `building_plan_artifact`
        on a content/WebPageProps row, the materializer should still
        recover the plan from the deterministic `plan:{name}.md` key that
        save_plan_artifact wrote. This is the safety net for the Gemini
        adherence regression on optional-by-schema, required-by-prose
        fields.
        """
        plan = {
            "component_plans": [
                {
                    "name": "JobListContent",
                    "role": "content",
                    "page_slug": "/jobs",
                    "page_type": "WebPageProps",
                    "building_plan_artifact": "",
                },
            ],
        }
        with _patch_loader(
            {"plan:JobListContent.md": "- Filterable list\n- Salary range slider"}
        ):
            await materialize_plan_artifacts(plan, _mock_ctx())

        cp = plan["component_plans"][0]
        assert cp["building_plan"] == ["Filterable list", "Salary range slider"]
        assert cp["building_plan_artifact"] == ""

    @pytest.mark.asyncio
    async def test_fallback_skips_when_inline_plan_already_present(self):
        """Decomposition path: inline `building_plan` already populated by
        the design-import runner. The fallback must not clobber it even
        when the conventional artifact key happens to exist.
        """
        plan = {
            "component_plans": [
                {
                    "name": "HomeContent",
                    "role": "content",
                    "page_slug": "/",
                    "page_type": "WebPageProps",
                    "building_plan_artifact": "",
                    "building_plan": ["already populated by decomposition runner"],
                },
            ],
        }
        with _patch_loader({"plan:HomeContent.md": "- should not load this"}):
            await materialize_plan_artifacts(plan, _mock_ctx())

        cp = plan["component_plans"][0]
        assert cp["building_plan"] == ["already populated by decomposition runner"]

    @pytest.mark.asyncio
    async def test_fallback_skips_chrome_roles(self):
        """Header / sidebar / footer don't go through the strict schema
        rule; they may legitimately ship without a plan. The fallback
        must not invent one for them.
        """
        plan = {
            "component_plans": [
                {
                    "name": "MainSidebar",
                    "role": "sidebar",
                    "page_slug": None,
                    "building_plan_artifact": "",
                },
            ],
        }
        with _patch_loader({"plan:MainSidebar.md": "- should not load"}):
            await materialize_plan_artifacts(plan, _mock_ctx())

        cp = plan["component_plans"][0]
        assert "building_plan" not in cp or not cp["building_plan"]

    @pytest.mark.asyncio
    async def test_fallback_skips_blog_main_page_props(self):
        """BlogMainPageProps is platform-rendered, not a code component."""
        plan = {
            "component_plans": [
                {
                    "name": "BlogIndex",
                    "role": "content",
                    "page_slug": "/blog",
                    "page_type": "BlogMainPageProps",
                    "building_plan_artifact": "",
                },
            ],
        }
        with _patch_loader({"plan:BlogIndex.md": "- should not load"}):
            await materialize_plan_artifacts(plan, _mock_ctx())

        cp = plan["component_plans"][0]
        assert "building_plan" not in cp or not cp["building_plan"]

    @pytest.mark.asyncio
    async def test_fallback_no_op_when_artifact_missing(self):
        """Fallback only fires when the artifact actually exists. If it
        doesn't, the loop falls through and the existing post-materialization
        guard catches the empty plan downstream — same behavior as before.
        """
        plan = {
            "component_plans": [
                {
                    "name": "GhostContent",
                    "role": "content",
                    "page_slug": "/ghost",
                    "page_type": "WebPageProps",
                    "building_plan_artifact": "",
                },
            ],
        }
        with _patch_loader({}):  # no artifacts staged
            await materialize_plan_artifacts(plan, _mock_ctx())

        cp = plan["component_plans"][0]
        assert "building_plan" not in cp or not cp["building_plan"]

    @pytest.mark.asyncio
    async def test_non_dict_plan_passes_through(self):
        """Defensive: the function should not crash on garbage input."""
        result = await materialize_plan_artifacts(None, _mock_ctx())  # type: ignore[arg-type]
        assert result is None

    @pytest.mark.asyncio
    async def test_artifact_field_with_whitespace_only_treated_as_unset(self):
        """Defensive: empty/whitespace artifact ref shouldn't trigger a load."""
        plan = {
            "app_building_plan": ["fallback"],
            "app_building_plan_artifact": "   ",
            "component_plans": [],
        }
        loader_mock = AsyncMock(return_value=None)
        with patch(
            "main_agent.agents.orchestrator.app_types.webapp.services."
            "plan_artifact_materializer.ArtifactManager.load_artifact_as_string",
            new=loader_mock,
        ):
            await materialize_plan_artifacts(plan, _mock_ctx())

        # Loader was never called for app or per-component (both whitespace).
        loader_mock.assert_not_called()
        assert plan["app_building_plan"] == ["fallback"]


class TestDownstreamHandoff:
    """End-to-end contract tests: after materialization, the resulting
    plan dict is what downstream consumers (ComponentBuilder, summary
    builders) actually receive. The materializer is the only place that
    knows about artifact refs; everyone else reads the inline list.
    """

    @pytest.mark.asyncio
    async def test_component_builder_input_contains_materialized_bullets(self):
        """ComponentBuilder consumes the plan via ``ComponentBuilderInput.building_plan``.
        After materialization, the bullet list must contain the bullets
        from the artifact body — otherwise the builder receives an empty
        plan and ships an under-specified component. The bullet text is
        also the L1 signal the LLM uses (via SkillToolset's
        ``<available_skills>`` preamble + description match) to decide
        which domain skill to ``load_skill``.
        """
        plan = {
            "app_building_plan": [],
            "app_building_plan_artifact": "plan:app.md",
            "component_plans": [
                {
                    "name": "PipelineContent",
                    "role": "content",
                    "page_slug": "/pipeline",
                    "complexity_level": "complex",
                    "building_plan": [],
                    "building_plan_artifact": "plan:PipelineContent.md",
                },
                {
                    "name": "DashboardContent",
                    "role": "content",
                    "page_slug": "/",
                    "complexity_level": "intermediate",
                    "building_plan": [],
                    "building_plan_artifact": "plan:DashboardContent.md",
                },
            ],
        }
        with _patch_loader(
            {
                "plan:app.md": "- ATS app\n- Pipelines + analytics",
                "plan:PipelineContent.md": (
                    "## Layout\n- Kanban board with stage columns\n"
                    "## Data\n- useModel('candidates')\n"
                    "- Drag candidates between stages"
                ),
                "plan:DashboardContent.md": (
                    "- Hiring funnel chart\n- KPI tiles for offers / hires"
                ),
            }
        ):
            await materialize_plan_artifacts(plan, _mock_ctx())

        # Round-trip the materialized plan as JSON the workflow would
        # serialize for ComponentBuilder.
        builder_payload = json.dumps(plan["component_plans"])

        # The bullet text "Kanban board" is the load-bearing signal — the
        # ComponentBuilder LLM matches it against the kanban-board skill's
        # description in <available_skills> and load_skills accordingly.
        # Without materialization the field is empty and the LLM has no
        # signal to pick a skill at all.
        assert "Kanban board with stage columns" in builder_payload
        assert "useModel('candidates')" in builder_payload
        assert "Hiring funnel chart" in builder_payload

        # And the artifact refs are scrubbed from the payload so they
        # don't confuse downstream LLMs that might mistake them for
        # actionable filenames.
        assert "plan:PipelineContent.md" not in builder_payload
        assert "plan:DashboardContent.md" not in builder_payload


# =============================================================================
# Duplicate building_plan_artifact dedup
# =============================================================================


class TestDuplicateBuildingPlanArtifactCheck:
    """Guard against Creator emitting the same plan artifact for multiple
    content components — a regression that causes legal pages to render
    brand storytelling (seen 2026-05-12 on luna-rest / jmhd6gv7).
    """

    @pytest.mark.asyncio
    async def test_raises_when_two_content_components_share_artifact(self):
        plan = {
            "component_plans": [
                {
                    "name": "AboutContent",
                    "role": "content",
                    "building_plan_artifact": "plan:AboutContent.md",
                },
                {
                    "name": "PrivacyContent",
                    "role": "content",
                    "building_plan_artifact": "plan:AboutContent.md",
                },
            ],
        }
        with _patch_loader({"plan:AboutContent.md": "- bullet"}):
            with pytest.raises(PipelineError) as exc_info:
                await materialize_plan_artifacts(plan, _mock_ctx())

        msg = str(exc_info.value)
        assert "plan:AboutContent.md" in msg
        assert "AboutContent" in msg
        assert "PrivacyContent" in msg

    @pytest.mark.asyncio
    async def test_raises_when_three_components_share_artifact(self):
        """The luna-rest case: About / Privacy / Terms all point at the
        About plan."""
        plan = {
            "component_plans": [
                {
                    "name": "AboutContent",
                    "role": "content",
                    "building_plan_artifact": "plan:AboutContent.md",
                },
                {
                    "name": "PrivacyContent",
                    "role": "content",
                    "building_plan_artifact": "plan:AboutContent.md",
                },
                {
                    "name": "TermsContent",
                    "role": "content",
                    "building_plan_artifact": "plan:AboutContent.md",
                },
            ],
        }
        with _patch_loader({"plan:AboutContent.md": "- bullet"}):
            with pytest.raises(PipelineError) as exc_info:
                await materialize_plan_artifacts(plan, _mock_ctx())

        # All three component names should appear in the diagnostic.
        msg = str(exc_info.value)
        assert "AboutContent" in msg
        assert "PrivacyContent" in msg
        assert "TermsContent" in msg

    @pytest.mark.asyncio
    async def test_unique_artifacts_per_content_component_passes(self):
        """The canonical happy path — each content component owns its plan."""
        plan = {
            "component_plans": [
                {
                    "name": "AboutContent",
                    "role": "content",
                    "building_plan_artifact": "plan:AboutContent.md",
                },
                {
                    "name": "PrivacyContent",
                    "role": "content",
                    "building_plan_artifact": "plan:PrivacyContent.md",
                },
                {
                    "name": "TermsContent",
                    "role": "content",
                    "building_plan_artifact": "plan:TermsContent.md",
                },
            ],
        }
        with _patch_loader(
            {
                "plan:AboutContent.md": "- About bullet",
                "plan:PrivacyContent.md": "- Privacy bullet",
                "plan:TermsContent.md": "- Terms bullet",
            }
        ):
            # Must not raise.
            await materialize_plan_artifacts(plan, _mock_ctx())

        assert plan["component_plans"][0]["building_plan"] == ["About bullet"]
        assert plan["component_plans"][1]["building_plan"] == ["Privacy bullet"]
        assert plan["component_plans"][2]["building_plan"] == ["Terms bullet"]

    @pytest.mark.asyncio
    async def test_chrome_roles_exempt_from_dedup(self):
        """MainHeader + MainFooter etc. don't carry page semantics —
        sharing a plan artifact between them is improbable but not the
        bug class we're guarding against. Only ``role=="content"``
        triggers the check."""
        plan = {
            "component_plans": [
                {
                    "name": "MainHeader",
                    "role": "header",
                    "building_plan_artifact": "plan:Chrome.md",
                },
                {
                    "name": "MainFooter",
                    "role": "footer",
                    "building_plan_artifact": "plan:Chrome.md",
                },
            ],
        }
        with _patch_loader({"plan:Chrome.md": "- chrome bullet"}):
            # Must not raise — chrome components aren't content.
            await materialize_plan_artifacts(plan, _mock_ctx())

    @pytest.mark.asyncio
    async def test_empty_artifact_refs_not_counted_as_duplicates(self):
        """Decomposition + design-import paths leave the ref empty and
        populate `building_plan` inline. Multiple empty refs are not a
        collision — empty != duplicate."""
        plan = {
            "component_plans": [
                {
                    "name": "HomeContent",
                    "role": "content",
                    "building_plan_artifact": "",
                    "building_plan": ["already populated"],
                },
                {
                    "name": "AboutContent",
                    "role": "content",
                    "building_plan_artifact": "",
                    "building_plan": ["already populated too"],
                },
            ],
        }
        with _patch_loader({}):
            # Must not raise — empty refs are skipped.
            await materialize_plan_artifacts(plan, _mock_ctx())


# =============================================================================
# Building-plan synthesis safety net
# =============================================================================


class TestSynthesizeBuildingPlanHelper:
    """`_synthesize_building_plan` turns a component's other planning fields
    into a usable bullet list when no artifact body is available."""

    def test_builds_bullets_from_all_fields(self):
        cp = {
            "name": "HomeContent",
            "page_title": "Quick Notes - Capture Ideas",
            "page_short_summary": "Homepage intro with hero and CTA.",
            "page_summary": "Bold hero section. Features grid below. Final call to action.",
            "interactive_elements": ["add note button", "search box"],
            "content_artifact": "content:home:hero.md",
        }
        bullets = _synthesize_building_plan(cp)
        assert "Page title: Quick Notes - Capture Ideas" in bullets
        assert "Homepage intro with hero and CTA." in bullets
        # page_summary split into sentence-level bullets.
        assert "Bold hero section." in bullets
        assert "Features grid below." in bullets
        assert "Final call to action." in bullets
        assert "Include interactive elements: add note button, search box" in bullets
        assert "Load page copy/content from artifact: content:home:hero.md" in bullets

    def test_dedupes_repeated_sentences(self):
        cp = {
            "name": "X",
            "page_short_summary": "One sentence.",
            "page_summary": "One sentence.",  # same as short — must not double up
        }
        bullets = _synthesize_building_plan(cp)
        assert bullets.count("One sentence.") == 1

    def test_returns_empty_when_no_signal(self):
        # No usable fields → empty, so the downstream guard still fires.
        assert _synthesize_building_plan({"name": "Empty", "role": "content"}) == []


class TestSynthesisSafetyNet:
    """When a content component references a plan artifact the model never
    saved (common with OpenRouter/LiteLLM providers that emit the final plan
    in one turn without save_plan_artifact tool calls), the materializer
    synthesizes a building_plan from the summaries instead of leaving it empty
    for the FATAL workflow guard.
    """

    @pytest.mark.asyncio
    async def test_synthesizes_when_referenced_artifact_missing(self):
        plan = {
            "component_plans": [
                {
                    "name": "HomeContent",
                    "role": "content",
                    "page_type": "WebPageProps",
                    "page_slug": "/",
                    "page_title": "Quick Notes",
                    "page_short_summary": "Landing page for the notes app.",
                    "page_summary": "Hero with tagline. Feature highlights. CTA to start.",
                    "content_artifact": "content:home:hero.md",
                    "building_plan_artifact": "plan:HomeContent.md",
                },
            ],
        }
        # Loader returns nothing — the artifact the model referenced was never saved.
        with _patch_loader({}):
            await materialize_plan_artifacts(plan, _mock_ctx())

        cp = plan["component_plans"][0]
        assert cp["building_plan"], "synthesis should have populated a non-empty plan"
        assert "Hero with tagline." in cp["building_plan"]
        # Ref is cleared so downstream sees the inline plan as source of truth.
        assert cp["building_plan_artifact"] == ""

    @pytest.mark.asyncio
    async def test_does_not_clobber_real_artifact(self):
        """When the artifact DOES exist, its body wins — synthesis must not run."""
        plan = {
            "component_plans": [
                {
                    "name": "HomeContent",
                    "role": "content",
                    "page_summary": "Synthesized fallback should not appear.",
                    "building_plan_artifact": "plan:HomeContent.md",
                },
            ],
        }
        with _patch_loader({"plan:HomeContent.md": "- Real artifact bullet"}):
            await materialize_plan_artifacts(plan, _mock_ctx())

        cp = plan["component_plans"][0]
        assert cp["building_plan"] == ["Real artifact bullet"]

    @pytest.mark.asyncio
    async def test_skips_chrome_roles(self):
        """Header/footer don't need a synthesized content plan."""
        plan = {
            "component_plans": [
                {
                    "name": "MainHeader",
                    "role": "header",
                    "page_summary": "Nav with logo and links.",
                    "building_plan_artifact": "plan:MainHeader.md",
                },
            ],
        }
        with _patch_loader({}):
            await materialize_plan_artifacts(plan, _mock_ctx())

        cp = plan["component_plans"][0]
        assert "building_plan" not in cp or not cp["building_plan"]

    @pytest.mark.asyncio
    async def test_full_creator_shape_passes_downstream_guard(self):
        """End-to-end shape from the real deepseek/OpenRouter failure: every
        content component references a plan:*.md it never saved. After
        materialization all content components must carry a non-empty
        building_plan so `_check_content_components_have_building_plans`
        no longer raises.
        """
        names = ["HomeContent", "AboutContent", "FeaturesContent", "PricingContent"]
        plan = {
            "component_plans": [
                {
                    "name": n,
                    "role": "content",
                    "page_type": "WebPageProps",
                    "page_slug": "/" if n == "HomeContent" else f"/{n.lower()}",
                    "page_title": f"{n} title",
                    "page_summary": f"{n} does something useful. It has a section.",
                    "building_plan_artifact": f"plan:{n}.md",
                }
                for n in names
            ],
        }
        with _patch_loader({}):  # none of the referenced artifacts exist
            await materialize_plan_artifacts(plan, _mock_ctx())

        empty = [
            cp["name"]
            for cp in plan["component_plans"]
            if cp.get("role") == "content" and not cp.get("building_plan")
        ]
        assert empty == [], f"these content components still lack a plan: {empty}"


# =============================================================================
# Image distribution safety net
# =============================================================================


def _img(uuid: str, is_logo: bool = False) -> dict:
    return {"uuid": uuid, "url": f"https://exepad/{uuid}", "is_logo": is_logo}


class TestImageDistributionSafetyNet:
    """Round-robin unused catalog UUIDs into content components when the
    LLM under-uses a large image catalog.

    Triggers when (a) catalog has >=10 entries AND (b) <2 distinct UUIDs
    are referenced across all content components. Logos excluded. Only
    fills empty ``image_references`` arrays.
    """

    @pytest.mark.asyncio
    async def test_distributes_when_under_used_with_large_catalog(self):
        # 12 catalog images (1 logo + 11 content); LLM only used the logo.
        catalog = [_img("logo-1", is_logo=True)] + [_img(f"c-{i}") for i in range(11)]
        plan = {
            "component_plans": [
                {"name": "MainHeader", "role": "header", "image_references": ["logo-1"]},
                {"name": "HomeContent", "role": "content", "image_references": []},
                {"name": "AboutContent", "role": "content", "image_references": []},
            ],
        }
        with _patch_loader({}):
            await materialize_plan_artifacts(plan, _mock_ctx(image_catalog=catalog))

        home_refs = plan["component_plans"][1]["image_references"]
        about_refs = plan["component_plans"][2]["image_references"]
        assert len(home_refs) >= 1
        assert len(about_refs) >= 1
        # Logo must not bleed into content distribution.
        assert "logo-1" not in home_refs and "logo-1" not in about_refs
        # No duplicates across content (round-robin yields distinct UUIDs).
        assert set(home_refs).isdisjoint(set(about_refs))

    @pytest.mark.asyncio
    async def test_no_op_when_llm_already_distributed_enough(self):
        catalog = [_img(f"c-{i}") for i in range(15)]
        plan = {
            "component_plans": [
                {"name": "HomeContent", "role": "content", "image_references": ["c-0", "c-1"]},
                {"name": "AboutContent", "role": "content", "image_references": ["c-2"]},
                {"name": "MoreContent", "role": "content", "image_references": []},
            ],
        }
        with _patch_loader({}):
            await materialize_plan_artifacts(plan, _mock_ctx(image_catalog=catalog))

        # >=2 UUIDs already referenced (c-0, c-1, c-2) — threshold not crossed.
        assert plan["component_plans"][2]["image_references"] == []

    @pytest.mark.asyncio
    async def test_no_op_when_catalog_too_small(self):
        catalog = [_img(f"c-{i}") for i in range(5)]  # < 10
        plan = {
            "component_plans": [
                {"name": "HomeContent", "role": "content", "image_references": []},
            ],
        }
        with _patch_loader({}):
            await materialize_plan_artifacts(plan, _mock_ctx(image_catalog=catalog))

        # Small catalogs left alone — distribution is for under-utilization,
        # not minor gaps.
        assert plan["component_plans"][0]["image_references"] == []

    @pytest.mark.asyncio
    async def test_preserves_existing_references_on_filled_slots(self):
        catalog = [_img(f"c-{i}") for i in range(15)]
        plan = {
            "component_plans": [
                {"name": "HomeContent", "role": "content", "image_references": ["c-0"]},
                {"name": "AboutContent", "role": "content", "image_references": []},
            ],
        }
        # Only 1 UUID referenced — below threshold (2), so should fire on
        # AboutContent. HomeContent's array is non-empty and must not be
        # overwritten.
        with _patch_loader({}):
            await materialize_plan_artifacts(plan, _mock_ctx(image_catalog=catalog))

        assert plan["component_plans"][0]["image_references"] == ["c-0"]
        assert len(plan["component_plans"][1]["image_references"]) >= 1
        assert "c-0" not in plan["component_plans"][1]["image_references"]

    @pytest.mark.asyncio
    async def test_no_op_when_no_image_catalog_in_state(self):
        plan = {
            "component_plans": [
                {"name": "HomeContent", "role": "content", "image_references": []},
            ],
        }
        # _mock_ctx() default: empty catalog list.
        with _patch_loader({}):
            await materialize_plan_artifacts(plan, _mock_ctx())

        assert plan["component_plans"][0]["image_references"] == []
