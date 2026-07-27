# Skills authoring guide

Exepad's agents load specialised instruction supplements at LLM
inference time via Google ADK's official `SkillToolset` (ships in
`google-adk` ≥ 1.18). The on-disk format is the
[agentskills.io specification](https://agentskills.io/specification),
the same one Anthropic, Google, and other vendors converge on.

This document is the authoring reference for adding, editing, or
auditing skills inside Exepad.

## Where skills live

Five skill roots, all under `packages/schemas/data/agent_docs/`. Every
top-level area splits into `docs/` (loaded statically into the agent's
instruction via `InstructionBuilder.add_doc`) and `skills/` (loaded at
LLM inference time via the agent's `SkillToolset`).

| Root | Consumer | Skills |
|------|----------|--------|
| `frontend/component_builder/skills/` | ComponentBuilder, ComponentBuilderMultiple | 27 (3 flow + 24 domain) |
| `frontend/design_builder/skills/` | DesignSystemBuilder | 2 (`design-pattern`) |
| `backend/skills/` | BackendModelBuilder, BackendHandlerBuilder, SeedDataBuilder (shared) | 3 (`backend-pattern`) |
| `diagnostic/skills/` | Surveyor | 6 (one per `ProfileLiteral`) |
| `design_bundle_importer/skills/` | DesignImporter | 2 (one per bundle source) |

Each skill is its own directory:

```
<skill-root>/
└── <kebab-skill-name>/
    ├── SKILL.md           # required — frontmatter + body
    ├── references/        # optional — additional Markdown docs
    │   └── REFERENCE.md
    ├── assets/            # optional — TSX/JSON/SVG samples
    │   └── example_1.tsx
    └── scripts/           # optional — `.py`/`.sh`/`.bash`, runnable via run_skill_script
        └── setup.sh
```

### `docs/` vs `skills/` per area

Every functional area follows a consistent layout — `docs/` for static
material and `skills/` for ADK-loaded skills:

```
packages/schemas/data/agent_docs/
├── common/      docs/                              ← cross-cutting safety/refusal rules
├── support/     docs/                              ← AppHelpDesk's user-help docs
├── planner/     docs/                              ← Creator + Editor planning material
├── editor/      docs/                              ← Editor-specific decision tree, action schemas
├── frontend/
│   ├── component_builder/    docs/  +  skills/    ← ComponentBuilder + Multiple
│   ├── design_builder/       docs/  +  skills/    ← DesignSystemBuilder
│   └── logic_builder/        docs/                 ← LogicBuilder (no skills today)
├── backend/                  docs/  +  skills/    ← BackendModelBuilder/HandlerBuilder/SeedDataBuilder
├── diagnostic/               docs/  +  skills/    ← Surveyor
├── design_bundle_importer/          skills/       ← DesignImporter (skills only)
└── surfaces/
    ├── backend_surface/     docs/                  ← cross-builder backend reference docs
    └── logic_surface/       docs/                  ← cross-builder logic-state reference docs
```

Static docs are loaded via `InstructionBuilder.add_doc("<area>/docs/<file>.md")`
and concatenated into the agent's static instruction. Skills are loaded
at LLM inference time via the agent's `SkillToolset` — only the L1
preamble (name + description) is in the cached prefix; the LLM calls
`load_skill(skill_name)` to pull the body when relevant.

## SKILL.md format

Spec-pure YAML frontmatter + Markdown body:

```markdown
---
name: crud-data-app
description: useModel CRUD wiring — data tables, edit/create modals, dashboard KPIs over a model, model-backed forms. Load when the component plan involves persistent entity records, table/grid views, modal-driven create/edit/delete, or dashboard KPIs computed from useModel data. Keywords: crud, table, data-table, form, modal, edit, delete, create, useModel, dashboard, kpi.
metadata:
  kind: domain
---

# Skill: CRUD Data App Wiring

…body…
```

### Frontmatter fields used by Exepad

| Field | Required | Constraint | Notes |
|-------|----------|-----------|-------|
| `name` | yes | 1–64 chars, lowercase `a-z` + digits + hyphens, no leading/trailing/consecutive hyphens, **MUST equal the parent directory name** | Spec invariant. |
| `description` | yes | 1–1024 chars | Encodes both *what the skill does* and *when to load it*. The LLM sees this as a single line in the `<available_skills>` XML block; it must be unambiguous about when to call `load_skill`. |
| `metadata.kind` | required by Exepad | family-specific value (see below) | Universal marker that answers "what kind of skill is this?" across families. The conformance test enforces the per-family value. |

Other spec fields (`license`, `compatibility`, `allowed-tools`) are not
used today — leave them off.

#### Per-family `metadata.kind` values

| Family | Allowed `kind` values | Additional metadata keys |
|--------|----------------------|--------------------------|
| frontend (`frontend/component_builder/skills/`) | `"domain"` or `"flow"` | none |
| backend (`backend/skills/`) | `"backend-pattern"` | `applies_to` recommended (e.g. `backend-model-builder`) |
| design builder (`frontend/design_builder/skills/`) | `"design-pattern"` | none |
| diagnostic (`diagnostic/skills/`) | `"diagnostic-profile"` | `applies_to`, `tool_budget`, `intent_keywords` (all string-valued) |
| design importer (`design_bundle_importer/skills/`) | `"design-importer"` | none |

**`metadata` values must be strings.** The agentskills.io spec defines
metadata as `map<string, string>`. ADK's pydantic model accepts
arbitrary types but cross-runtime portability requires we stay
spec-strict. Lists are not allowed (the conformance test will fail).
ADK's reserved `adk_additional_tools` (must be a list of strings) is
the only documented exception, and we don't use it yet.

### Body sizing

Spec recommendation:

* `<5000 tokens` (~20 000 chars) of body content
* `<500 lines`

The conformance test enforces both as hard caps — every Exepad skill
currently honors them, and we keep it that way to avoid bloating the L2
prefill on activation. If a skill grows past either cap, push detail
into `references/<topic>.md` and reference it from the body via
`load_skill_resource(skill_name='<name>', file_path='references/<topic>.md')`.

### Asset references

When you copy reference TSX into `assets/example_<N>.tsx`, point to it
from the body so the LLM knows it's available:

```markdown
## Canonical implementations (load on demand)
- `load_skill_resource(skill_name='crud-data-app', file_path='assets/example_1.tsx')` —
  truncated source from the `stats-dashboard-1` reference block.
```

The conformance test asserts every `assets/example_<N>.tsx` referenced
from a body actually exists on disk.

## How agents see skills

Each agent that owns a `SkillToolset` automatically gets four tools
injected by ADK, and a default system instruction is prepended to every
LLM request along with an `<available_skills>` XML block listing the
catalogue's `name` + `description` (~100 tokens per skill, the L1
discovery surface).

| Tool | When the LLM calls it |
|------|------------------------|
| `list_skills()` | Optional — see the catalogue. Often unnecessary because `<available_skills>` is already in the prompt. |
| `load_skill(skill_name)` | Pulls the SKILL.md body (L2). Agent-side state records the activation under `_adk_activated_skill_<agent_name>`. |
| `load_skill_resource(skill_name, file_path)` | Pulls a `references/`, `assets/`, or `scripts/` file (L3). Loaded on demand. |
| `run_skill_script(skill_name, file_path, ...)` | Executes a `scripts/*.py` / `*.sh` / `*.bash`. Requires the agent to have a `code_executor` configured. We don't use this surface today. |

## Adding a new skill

1. Create `<root>/<kebab-name>/SKILL.md` with frontmatter + body.
2. If the skill teaches a layout pattern, drop a truncated TSX example
   under `<kebab-name>/assets/example_1.tsx` and reference it from the
   body.
3. Run `pytest apps/agent/tests/unit/test_skills_conformance.py` —
   spec-conformance + sizing + asset-existence pass before merge.
4. Update the expected catalogue set in
   `tests/unit/test_skills_conformance.py` (`_EXPECTED_FRONTEND` /
   `_EXPECTED_BACKEND` / `_EXPECTED_DESIGN_BUILDER` /
   `_EXPECTED_DIAGNOSTIC` / `_EXPECTED_DESIGN_IMPORTER`).
5. The skill is now discoverable — no further wiring is needed because
   the agent's `SkillToolset` reads from disk via
   `main_agent/agents/utils/skills.py:load_*_skills` (which uses ADK's
   `list_skills_in_dir`).

## Renaming or deleting a skill

* **Rename:** rename the directory; bump `frontmatter.name` to match;
  grep the codebase + agent_docs/ for the old kebab name and update any
  cross-references.
* **Delete:** remove the directory; remove the name from the expected
  catalogue set in `test_skills_conformance.py`. The agents pick up
  the change at next boot — there is no registry to update.

## Why the current architecture

* **No `SkillSelectorAgent`.** Skills are no longer pre-resolved by a
  separate LLM. The agent that uses them owns its discovery via the
  `SkillToolset`.
* **No `skill_context` / `flow_skill_context` input fields.** The L1
  XML preamble is part of the cached prefix; the L2 `load_skill` tool
  result lands in per-conversation history (~3 extra round-trips per
  ComponentBuilder build). This is the explicit trade — official spec
  + portable storage in exchange for a small latency cost on each
  build.
* **`metadata.kind`** is universal. Every family stamps a different
  value (`domain`/`flow` | `diagnostic-profile` | `design-importer`)
  but the field always answers "what kind of skill is this?" without
  reading the directory path. The LLM matches against `description`
  text only — the kind value is for telemetry, conformance gates, and
  human readability.
