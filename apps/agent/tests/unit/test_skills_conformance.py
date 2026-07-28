"""Spec-conformance tests for every SKILL.md on disk.

Runs ADK's in-process ``_validate_skill_dir`` (the same checks
``skills-ref validate`` performs externally) over each skill directory
under the three roots, plus extra Exepad-specific guards:

* Catalogue completeness (27 frontend + 6 diagnostic + 2 design-importer).
* ``frontmatter.metadata`` values are all strings (agentskills.io spec —
  ADK's pydantic model is looser, but cross-runtime portability requires
  spec-strict).
* ``frontmatter.metadata.kind`` is one of ``{"domain", "flow"}`` for the
  frontend set.
* ``description`` length ≤ 1024 chars; non-empty.
* SKILL.md body line count ≤ 500 and char count ≤ 20_000 (~5000 tokens),
  enforced as hard caps so drift is caught before bloating L2 prefill.
* Every ``assets/example_<N>.tsx`` referenced from a SKILL.md body
  actually exists on disk.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from google.adk.skills._utils import _validate_skill_dir

from main_agent.agents.utils.agent_docs_loader import AGENT_DOCS_DIR
from main_agent.agents.utils.skills import (
    load_backend_skills,
    load_design_builder_skills,
    load_design_importer_skills,
    load_diagnostic_skills,
    load_frontend_skills,
    validate_all_skills,
)

pytestmark = [pytest.mark.unit]

_FRONTEND_ROOT = AGENT_DOCS_DIR / "frontend" / "component_builder" / "skills"
_DESIGN_BUILDER_ROOT = AGENT_DOCS_DIR / "frontend" / "design_builder" / "skills"
_BACKEND_ROOT = AGENT_DOCS_DIR / "backend" / "skills"
_DIAGNOSTIC_ROOT = AGENT_DOCS_DIR / "diagnostic" / "skills"
_DESIGN_IMPORTER_ROOT = AGENT_DOCS_DIR / "design_bundle_importer" / "skills"

_BODY_LINE_LIMIT = 500  # spec recommendation, enforced as hard cap
_BODY_CHAR_LIMIT = 20_000  # ~5000 tokens, spec recommendation, enforced as hard cap
_DESCRIPTION_LIMIT = 1024

_EXPECTED_FRONTEND = {
    # Flow skills (3)
    "scratch-creation",
    "component-editing",
    "theme-token-migration",
    # Domain skills — original (13)
    "crud-data-app",
    "charts-visualization",
    "kanban-board",
    "game-arcade",
    "game-board",
    "game-simulation",
    "game-3d",
    "map-embed",
    "component-header",
    "component-sidebar",
    "component-footer",
    "content-artifact",
    "theme-toggle",
    # Domain skills — added 2026-05 (10)
    "landing-page-marketing",
    "pricing-table",
    "modal-dialog-patterns",
    "multi-step-wizard",
    "search-and-filter",
    "empty-error-loading-states",
    "file-upload-image",
    "a11y-keyboard-aria",
    "responsive-mobile-first",
    "animation-motion",
    # Domain skills — added 2026-05-12 (1)
    "state-hooks",
}

_EXPECTED_BACKEND = {
    "database-schema-design",
    "handler-patterns-rpc",
    "seed-data-csv",
}

_EXPECTED_DESIGN_BUILDER = {
    "dark-mode-tokens",
    "font-pairing",
}

_EXPECTED_DIAGNOSTIC = {
    "bug-root-cause",
    "integration-context",
    "referent-and-current-state",
    "cascade-enumeration",
    "performance-audit",
    "a11y-audit",
}

_EXPECTED_DESIGN_IMPORTER = {"stitch-importer", "claude-design-importer"}


def _iter_skill_dirs(root: Path):
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        if not (entry / "SKILL.md").is_file() and not (entry / "skill.md").is_file():
            continue
        yield entry


class TestCatalogue:
    def test_frontend_catalogue(self):
        names = {s.name for s in load_frontend_skills()}
        assert names == _EXPECTED_FRONTEND, (
            f"Frontend skill catalogue drift. Missing: "
            f"{_EXPECTED_FRONTEND - names}, unexpected: {names - _EXPECTED_FRONTEND}"
        )
        # Self-check: the number of skill directories on disk must equal the
        # pinned set size, so the pinned set cannot silently drift out of sync
        # with the skills actually on disk (the docstring/group counts are
        # expected to mirror len(_EXPECTED_FRONTEND)). Derived from the pinned
        # set and the on-disk discovery helper — no separately hardcoded literal.
        on_disk = {d.name for d in _iter_skill_dirs(_FRONTEND_ROOT)}
        assert len(on_disk) == len(_EXPECTED_FRONTEND), (
            f"On-disk frontend skill count {len(on_disk)} != pinned "
            f"{len(_EXPECTED_FRONTEND)}; disk-only: {on_disk - _EXPECTED_FRONTEND}, "
            f"pinned-only: {_EXPECTED_FRONTEND - on_disk}"
        )

    def test_backend_catalogue(self):
        names = {s.name for s in load_backend_skills()}
        assert names == _EXPECTED_BACKEND, (
            f"Backend skill catalogue drift. Missing: "
            f"{_EXPECTED_BACKEND - names}, unexpected: {names - _EXPECTED_BACKEND}"
        )

    def test_design_builder_catalogue(self):
        names = {s.name for s in load_design_builder_skills()}
        assert names == _EXPECTED_DESIGN_BUILDER

    def test_diagnostic_catalogue(self):
        names = {s.name for s in load_diagnostic_skills()}
        assert names == _EXPECTED_DIAGNOSTIC

    def test_design_importer_catalogue(self):
        names = {s.name for s in load_design_importer_skills()}
        assert names == _EXPECTED_DESIGN_IMPORTER


class TestSpecConformance:
    """Every directory must pass ADK's _validate_skill_dir."""

    def test_validate_all_skills_returns_no_problems(self):
        problems = validate_all_skills()
        assert not problems, "\n".join(problems)


class TestMetadataInvariants:
    def test_frontend_metadata_kind_is_set(self):
        for skill in load_frontend_skills():
            kind = skill.frontmatter.metadata.get("kind")
            assert kind in {
                "domain",
                "flow",
            }, f"{skill.name}: metadata.kind={kind!r}, expected 'domain' or 'flow'"

    def test_diagnostic_metadata_shape(self):
        """Diagnostic profiles share a uniform shape:
        ``kind=diagnostic-profile`` plus consumer + budget + keyword hints.
        """
        for skill in load_diagnostic_skills():
            md = skill.frontmatter.metadata
            assert md.get("kind") == "diagnostic-profile", (
                f"{skill.name}: metadata.kind={md.get('kind')!r}, " "expected 'diagnostic-profile'"
            )
            for required in ("applies_to", "tool_budget", "intent_keywords"):
                assert required in md, f"{skill.name}: missing diagnostic metadata key {required!r}"

    def test_design_importer_metadata_kind(self):
        for skill in load_design_importer_skills():
            kind = skill.frontmatter.metadata.get("kind")
            assert (
                kind == "design-importer"
            ), f"{skill.name}: metadata.kind={kind!r}, expected 'design-importer'"

    def test_backend_metadata_kind(self):
        for skill in load_backend_skills():
            kind = skill.frontmatter.metadata.get("kind")
            assert (
                kind == "backend-pattern"
            ), f"{skill.name}: metadata.kind={kind!r}, expected 'backend-pattern'"

    def test_design_builder_metadata_kind(self):
        for skill in load_design_builder_skills():
            kind = skill.frontmatter.metadata.get("kind")
            assert (
                kind == "design-pattern"
            ), f"{skill.name}: metadata.kind={kind!r}, expected 'design-pattern'"

    def test_every_skill_has_metadata_kind(self):
        """Cross-family invariant: ``metadata.kind`` always answers
        'what kind of skill is this?' regardless of family.
        """
        for loader in (
            load_frontend_skills,
            load_backend_skills,
            load_design_builder_skills,
            load_diagnostic_skills,
            load_design_importer_skills,
        ):
            for skill in loader():
                kind = skill.frontmatter.metadata.get("kind")
                assert (
                    isinstance(kind, str) and kind
                ), f"{skill.name}: metadata.kind must be a non-empty string"

    def test_metadata_values_are_strings(self):
        # agentskills.io spec: metadata is a map<string, string>. ADK's
        # pydantic model is looser (allows lists), but we keep it strict
        # for cross-runtime portability. Exception: ADK reserves
        # ``adk_additional_tools`` (must be a list of strings).
        for skill_loader_fn in (
            load_frontend_skills,
            load_backend_skills,
            load_design_builder_skills,
            load_diagnostic_skills,
            load_design_importer_skills,
        ):
            for skill in skill_loader_fn():
                for key, value in skill.frontmatter.metadata.items():
                    if key == "adk_additional_tools":
                        continue
                    assert isinstance(value, str), (
                        f"{skill.name}.metadata[{key!r}] = {value!r} "
                        f"({type(value).__name__}); spec requires string-valued"
                    )


_ALL_LOADERS = [
    load_frontend_skills,
    load_backend_skills,
    load_design_builder_skills,
    load_diagnostic_skills,
    load_design_importer_skills,
]


class TestDescriptionLength:
    @pytest.mark.parametrize("loader", _ALL_LOADERS)
    def test_description_within_spec_cap(self, loader):
        for skill in loader():
            desc = skill.description
            assert desc, f"{skill.name}: description is empty"
            assert (
                len(desc) <= _DESCRIPTION_LIMIT
            ), f"{skill.name}: description is {len(desc)} chars (max {_DESCRIPTION_LIMIT})"


class TestBodySize:
    """Enforces the agentskills.io spec body recommendations as hard caps.

    The spec marks ``<500 lines`` and ``<5000 tokens (~20k chars)`` as
    recommendations, but every Exepad skill currently honors both. We
    gate at the recommendation directly so future drift is caught
    before bloating any skill's L2 prefill.

    If a skill outgrows these caps, split detail into ``references/``
    files and load them on demand via ``load_skill_resource``.
    """

    @pytest.mark.parametrize("loader", _ALL_LOADERS)
    def test_body_within_spec_recommendation(self, loader):
        for skill in loader():
            body = skill.instructions
            line_count = body.count("\n") + 1
            char_count = len(body)
            assert line_count <= _BODY_LINE_LIMIT, (
                f"{skill.name}: body is {line_count} lines "
                f"(spec recommends ≤{_BODY_LINE_LIMIT}). "
                "Move detailed material to references/."
            )
            assert char_count <= _BODY_CHAR_LIMIT, (
                f"{skill.name}: body is {char_count} chars "
                f"(spec recommends ≤{_BODY_CHAR_LIMIT}, ~5000 tokens). "
                "Move detailed material to references/."
            )


_RESOURCE_REFERENCE_RE = re.compile(
    r"file_path\s*=\s*['\"](assets|references|scripts)/([^'\"]+)['\"]"
)

_SKILL_ROOTS = {
    "frontend": (load_frontend_skills, _FRONTEND_ROOT),
    "backend": (load_backend_skills, _BACKEND_ROOT),
    "design_builder": (load_design_builder_skills, _DESIGN_BUILDER_ROOT),
    "diagnostic": (load_diagnostic_skills, _DIAGNOSTIC_ROOT),
    "design_importer": (load_design_importer_skills, _DESIGN_IMPORTER_ROOT),
}


class TestResourceReferences:
    """Every assets/, references/, or scripts/ path the body cites in a
    ``load_skill_resource(file_path=...)`` call must exist on disk.

    Spec rule: file references are resolved relative to the skill root
    and should be one level deep — see https://agentskills.io/specification.
    """

    @pytest.mark.parametrize("loader_key", list(_SKILL_ROOTS.keys()))
    def test_resource_refs_resolve(self, loader_key):
        loader, root = _SKILL_ROOTS[loader_key]
        for skill in loader():
            skill_dir = root / skill.name
            for match in _RESOURCE_REFERENCE_RE.finditer(skill.instructions):
                kind, rel = match.group(1), match.group(2)
                target = skill_dir / kind / rel
                assert target.is_file(), (
                    f"{skill.name}: SKILL.md references {kind}/{rel} "
                    f"but {target} does not exist"
                )
                assert "/" not in rel, (
                    f"{skill.name}: {kind}/{rel} is more than one level "
                    "deep — spec recommends keeping references one level "
                    "from SKILL.md"
                )


class TestDirectoryNameInvariant:
    """AgentSkills.io spec invariant: name must equal directory name.

    ADK's _validate_skill_dir already checks this; we add an explicit
    test so the failure mode is obvious if it ever drifts.
    """

    @pytest.mark.parametrize(
        "root",
        [
            _FRONTEND_ROOT,
            _BACKEND_ROOT,
            _DESIGN_BUILDER_ROOT,
            _DIAGNOSTIC_ROOT,
            _DESIGN_IMPORTER_ROOT,
        ],
    )
    def test_dir_names_match_frontmatter_names(self, root):
        for skill_dir in _iter_skill_dirs(root):
            problems = _validate_skill_dir(skill_dir)
            for problem in problems:
                assert "does not match directory name" not in problem, f"{skill_dir}: {problem}"
