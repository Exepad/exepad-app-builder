"""Tests for the SkillToolset-driven DesignImporter agent.

The agent emits a ``DecompositionPlan`` JSON; the deterministic runner
(see ``importers/tools/decomposition/runner.py``) reads that plan and
writes every cleaned artifact byte-for-body-faithful from the staged
``bundle:*`` source bytes. These tests lock down:

  * The instruction provider surfaces the staged ``skill_name`` and
    directs the LLM to call ``load_skill`` on it.
  * The two design-importer SKILL.md directories are spec-conformant
    AgentSkills.io skills (one per format).
  * The agent definition wires a SkillToolset alongside ``load_artifacts``
    and ``save_plan_artifact_tool``; the legacy ``save_design_artifact``
    tool has been retired.

Allow-list / MIME / artifact-save behavior tests for the legacy
``save_design_artifact`` tool have been deleted alongside the tool itself.
The runner's equivalent invariants are exercised in
``tests/unit/orchestrator/importers/decomposition/test_runner.py``.
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.importers.design_importer import (
    DesignImporterInput,
    design_importer_agent,
    design_importer_instruction_provider,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.plan import (
    DecompositionPlan,
)
from main_agent.agents.utils.agent_docs_loader import AGENT_DOCS_DIR
from main_agent.agents.utils.skills import load_design_importer_skills

pytestmark = [pytest.mark.unit]


# ── Instruction provider ──────────────────────────────────────────────────


class _ROCtx:
    """Minimal ReadonlyContext stub."""

    def __init__(self, state: dict):
        self.state = state


class TestInstructionProvider:
    def test_includes_preamble_and_load_skill_directive(self):
        ctx = _ROCtx(
            state={
                "design_bundle_skill_context": {
                    "skill_name": "stitch-importer",
                }
            }
        )
        out = design_importer_instruction_provider(ctx)
        assert "DesignBundleImporter" in out
        assert "manifest_markdown" in out
        # New contract: prompt directs LLM to call load_skill.
        assert "load_skill" in out
        assert "stitch-importer" in out
        # DecompositionPlan schema preamble is still present.
        assert "DecompositionPlan" in out
        assert "content::page.html" in out or "content:<kebab-slug>:page.html" in out

    def test_surfaces_claude_design_skill_name(self):
        ctx = _ROCtx(
            state={
                "design_bundle_skill_context": {
                    "skill_name": "claude-design-importer",
                }
            }
        )
        out = design_importer_instruction_provider(ctx)
        assert "claude-design-importer" in out
        assert "load_skill" in out

    def test_missing_skill_name_still_renders_preamble(self):
        ctx = _ROCtx(state={})
        out = design_importer_instruction_provider(ctx)
        # Preamble + load_skill template still render; the substituted
        # skill_name is empty but the schema preamble is intact.
        assert "DecompositionPlan" in out


# ── SKILL.md directories are spec-conformant ─────────────────────────────


class TestDesignImporterSkills:
    def test_loads_two_skills(self):
        skills = load_design_importer_skills()
        names = {s.name for s in skills}
        assert names == {"stitch-importer", "claude-design-importer"}

    def test_skill_dirs_on_disk(self):
        for slug in ("stitch-importer", "claude-design-importer"):
            skill_dir = AGENT_DOCS_DIR / "design_bundle_importer" / "skills" / slug
            assert skill_dir.is_dir(), f"missing skill directory for {slug}"
            assert (skill_dir / "SKILL.md").is_file(), f"missing SKILL.md for {slug}"

    def test_skill_bodies_inline_shared_contract(self):
        for skill in load_design_importer_skills():
            body = skill.instructions
            # The shared cross-format contract must be inlined into each
            # SKILL.md body so a single load_skill call is sufficient.
            assert "DecompositionPlan" in body, (
                f"{skill.name} SKILL.md body missing the DecompositionPlan "
                "shared contract"
            )


# ── Input schema + agent ──────────────────────────────────────────────────


class TestAgent:
    def test_input_schema_defaults(self):
        d = DesignImporterInput(
            source="stitch",
            app_name="HappyDoods",
            app_description="Import the uploaded design",
            manifest_markdown="# Manifest\n\n- bundle:html:index.html",
        )
        assert d.app_name == "HappyDoods"
        assert d.app_description == "Import the uploaded design"
        assert "bundle:html:index.html" in d.manifest_markdown
        assert "bundle_id" not in DesignImporterInput.model_fields
        assert "skill_name" not in DesignImporterInput.model_fields
        assert d.app_language_code == "en"

    def test_agent_has_pydantic_output_schema(self):
        assert design_importer_agent.output_schema is DecompositionPlan
        assert design_importer_agent.output_key == "design_decomposition_plan"

    def test_agent_matches_creator_structured_output_config(self):
        assert design_importer_agent.before_model_callback is not None
        assert design_importer_agent.after_model_callback is not None
        assert design_importer_agent.generate_content_config is not None
        afc = design_importer_agent.generate_content_config.automatic_function_calling
        assert afc is not None
        assert afc.disable is True
        assert design_importer_agent.planner is not None

    def test_agent_registers_load_artifacts_and_save_plan_artifact(self):
        # save_design_artifact has been retired — the deterministic runner
        # is the new write surface. The agent reads bundle:* sources via
        # load_artifacts when judging slugs / theme mappings, and writes
        # the app-wide plan via save_plan_artifact (the per-component
        # plans are overridden by the runner so the agent doesn't escalate
        # those — see design_importer_instruction_provider).
        # SkillToolset is the family-shared skill loader (see
        # main_agent/agents/utils/skills.py); it provides the four
        # ``list_skills`` / ``load_skill`` / ``load_skill_resource`` /
        # ``run_skill_script`` tools at inference time.
        names = {getattr(t, "name", type(t).__name__) for t in design_importer_agent.tools}
        assert names == {"load_artifacts", "save_plan_artifact", "SkillToolset"}

    def test_agent_caps_combined_thinking_and_output_budget(self):
        # max_output_tokens cap protects against the same Gemini 3 hang
        # that bit Creator (googleapis/python-genai#2062). 32768 leaves
        # ample room for the DecompositionPlan payload while bounding
        # the combined thinking + visible-output budget.
        cfg = design_importer_agent.generate_content_config
        assert cfg is not None
        assert cfg.max_output_tokens == 32768
