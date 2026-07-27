"""Design-tool import pipeline (Stitch, Claude Design).

Modules in this package implement the skill-based design-import pipeline:

  * `bundle_fetch.py`     — Django manifest fetch helper.
  * `bundle_stager.py`    — downloads each bundle file from GCS and stages
                            it as a `bundle:<kind>:<relpath>` artifact;
                            emits `bundle:manifest.md` (the agent's index).
  * `dispatcher.py`       — format detection + skill-context stashing only.
  * `design_importer.py`  — skill-based LLM agent. Loads `bundle:*` inputs
                            via `load_artifacts` and returns a
                            `DecompositionPlan` (in
                            `state["design_decomposition_plan"]`)
                            describing slug mappings, chrome roles, theme
                            tokens, navigation, and backend intent.
  * `tools/decomposition/` — deterministic Python pipeline that reads the
                             plan and the original `bundle:*` artifacts and
                             writes every `content:*.html`,
                             `codefocus_style:theme.css`, and metadata
                             artifact byte-for-body-faithful.

Format-specific rules (Stitch vs Claude Design) live in the skill markdown
files under `packages/schemas/data/agent_docs/design_bundle_importer/`, not
in Python. The skill library loads them alongside `_shared.md` (the format-
agnostic plan contract) and inlines them into the importer agent's
instruction at runtime.
"""
