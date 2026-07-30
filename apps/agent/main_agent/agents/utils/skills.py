"""ADK SkillToolset loader helpers.

Single import boundary between Exepad and ``google.adk.skills``. Every
agent that owns a ``SkillToolset`` constructs it through one of the
``load_*`` helpers below so the on-disk skill directories are the
canonical source of truth.

Five skill roots live under ``packages/schemas/data/agent_docs/``:

* ``frontend/component_builder/skills/`` — domain + flow skills consumed
  by ComponentBuilder and ComponentBuilderMultiple.
* ``frontend/design_builder/skills/`` — design-system patterns consumed
  by DesignSystemBuilder.
* ``backend/skills/`` — backend patterns consumed by BackendModelBuilder,
  BackendHandlerBuilder, and SeedDataBuilder (shared toolset).
* ``diagnostic/skills/`` — investigation profiles consumed by Surveyor.
* ``design_bundle_importer/skills/`` — format-specific decomposition
  rules consumed by DesignImporter.

Each subdirectory is a complete AgentSkills.io spec skill (SKILL.md +
optional ``references/``, ``assets/``, ``scripts/``).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import structlog
from google.adk.skills import Skill, load_skill_from_dir
from google.adk.skills._utils import _validate_skill_dir

from main_agent.agents.utils.agent_docs_loader import AGENT_DOCS_DIR

logger = structlog.get_logger(__name__)


_FRONTEND_SKILLS_DIR = AGENT_DOCS_DIR / "frontend" / "component_builder" / "skills"
_DESIGN_BUILDER_SKILLS_DIR = AGENT_DOCS_DIR / "frontend" / "design_builder" / "skills"
_BACKEND_SKILLS_DIR = AGENT_DOCS_DIR / "backend" / "skills"
_DIAGNOSTIC_SKILLS_DIR = AGENT_DOCS_DIR / "diagnostic" / "skills"
_DESIGN_IMPORTER_SKILLS_DIR = AGENT_DOCS_DIR / "design_bundle_importer" / "skills"

_ALL_SKILL_ROOTS = (
    _FRONTEND_SKILLS_DIR,
    _DESIGN_BUILDER_SKILLS_DIR,
    _BACKEND_SKILLS_DIR,
    _DIAGNOSTIC_SKILLS_DIR,
    _DESIGN_IMPORTER_SKILLS_DIR,
)


def _load_all_from(root: Path) -> list[Skill]:
    """Load every skill directory under ``root`` via ADK's loader.

    Skips entries that aren't directories or don't contain SKILL.md so
    a stray ``_registry.json`` or README doesn't fail the agent boot.
    """
    if not root.is_dir():
        logger.warning("[skills] root missing", path=str(root))
        return []
    skills: list[Skill] = []
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        if not (entry / "SKILL.md").is_file() and not (entry / "skill.md").is_file():
            continue
        skills.append(load_skill_from_dir(entry))
    return skills


@lru_cache(maxsize=1)
def load_frontend_skills() -> list[Skill]:
    """Catalogue for ComponentBuilder + ComponentBuilderMultiple."""
    return _load_all_from(_FRONTEND_SKILLS_DIR)


# Narrow polish-mode subset used by the design-import cleanup variant of
# ComponentBuilderMultiple. Excludes every "build from a template" skill
# (`landing-page-marketing`, `hero-images`, `scratch-creation`,
# `responsive-mobile-first`, etc.) that would bias the LLM toward
# regenerating the source design rather than translating it.
# The three skills in the allowlist all deal with surgical local edits:
#   * component-editing  — preserve image contract / navigation / icons
#   * state-hooks        — useModel / useApp / useHandler wiring patterns
#   * theme-token-migration — Tailwind v3 → v4 token fixups
# When invoked in design-import polish mode, the agent's job is platform
# compliance, NOT redesign. See `_root_causes.md` RC#2, #3, #9, #12, #13, #15
# and the Track 3 design in
# `~/.claude/plans/create-a-full-fix-modular-horizon.md`.
_POLISH_MODE_SKILL_ALLOWLIST = frozenset(
    {"component-editing", "state-hooks", "theme-token-migration"}
)


@lru_cache(maxsize=1)
def load_frontend_polish_skills() -> list[Skill]:
    """Narrow catalogue for the design-import polish-mode cleanup pass.

    Returns only the 3 skills in ``_POLISH_MODE_SKILL_ALLOWLIST`` so the
    polish agent's available_skills XML preamble (and via ``load_skill``)
    cannot surface fresh-creation marketing/template skills.
    """
    all_skills = _load_all_from(_FRONTEND_SKILLS_DIR)
    return [s for s in all_skills if getattr(s, "name", "") in _POLISH_MODE_SKILL_ALLOWLIST]


@lru_cache(maxsize=1)
def load_design_builder_skills() -> list[Skill]:
    """Catalogue for DesignSystemBuilder."""
    return _load_all_from(_DESIGN_BUILDER_SKILLS_DIR)


@lru_cache(maxsize=1)
def load_backend_skills() -> list[Skill]:
    """Catalogue shared by BackendModelBuilder, BackendHandlerBuilder, SeedDataBuilder."""
    return _load_all_from(_BACKEND_SKILLS_DIR)


@lru_cache(maxsize=1)
def load_diagnostic_skills() -> list[Skill]:
    """Catalogue for Surveyor."""
    return _load_all_from(_DIAGNOSTIC_SKILLS_DIR)


@lru_cache(maxsize=1)
def load_design_importer_skills() -> list[Skill]:
    """Catalogue for DesignImporter."""
    return _load_all_from(_DESIGN_IMPORTER_SKILLS_DIR)


def validate_all_skills() -> list[str]:
    """Run ADK's ``_validate_skill_dir`` over every skill on disk.

    Returns a flat list of human-readable problem strings. Empty list
    means all skills are spec-conformant. Used by
    ``tests/unit/test_skills_conformance.py`` and ``make precommit``.
    """
    problems: list[str] = []
    for root in _ALL_SKILL_ROOTS:
        if not root.is_dir():
            problems.append(f"skill root missing: {root}")
            continue
        for entry in sorted(root.iterdir()):
            if not entry.is_dir():
                continue
            if not (entry / "SKILL.md").is_file() and not (entry / "skill.md").is_file():
                continue
            for issue in _validate_skill_dir(entry):
                problems.append(f"{entry.relative_to(AGENT_DOCS_DIR)}: {issue}")
    return problems
