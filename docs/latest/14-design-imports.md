# Design Imports

> **Not active in the self-hosted build.** The import pipeline reads extracted
> bundle entries from a cloud object store, which the single container has no
> route to. `dispatch_design_bundle` short-circuits when `ENVIRONMENT=selfhost`
> — the value both `docker/entrypoint.sh` and `run.sh` export — and the request
> falls through to the ordinary description-driven build. The code below ships
> in the repo and this document describes how it works, but nothing on this page
> runs in a self-hosted container today.

When a user uploads a design bundle (Stitch ZIP, Claude Design HTML+JSX, or
similar) the agent runs a **deterministic-first import pipeline** instead of
the normal LLM-driven Creator. The LLM's only job is to plan slug/chrome
mappings and pick four M3 theme pillars; every byte of HTML, CSS, JSX, and
asset content is preserved verbatim from the bundle by deterministic Python
passes.

**Key sources:**
- `apps/agent/main_agent/agents/orchestrator/importers/`
- `apps/agent/main_agent/agents/orchestrator/app_types/webapp/workflows/design_import_workflow.py` (top-level workflow that owns the import flow)
- `apps/agent/main_agent/agents/orchestrator/app_types/webapp/workflows/creation_workflow.py` (delegated-to for the post-plan build pipeline)
- `apps/agent/main_agent/agents/orchestrator/app_types/webapp/workflows/editing_workflow.py` (post-creation cleanup + data-wiring via `_run_phase_frontend_build`)

Steps below attributed to an "upload service" or a "deploy service" belong to
the hosted upload/deploy surface that originates the bundle and compiles its
output. That surface is not part of this repo.

---

## Why this exists

The original Onix Studio bug at `https://p1.exepad.com/a/preview-8mtmbi4y/`
demonstrated the LLM translating cleanly-extracted HTML into fabricated
content: client names invented, team members dropped, an entire "Closing CTA"
section added, `href` attributes stripped. Removing the LLM from the
translation hop entirely eliminates that fabrication class.

The pipeline that emerged is now the canonical path for every Stitch / Claude
Design / Anima upload, with three additional shipped phases that extended it
to handle Babel-shell apps (HTML page + sibling `.jsx` modules).

---

## Pipeline overview

```
Dashboard upload (ZIP / HTML+JSX bundle)
       │
       ▼
┌──────────────────────────────────────┐
│ upload service (hosted; not in repo) │
│ • Stores bundle bytes in object store│
│ • Persists DesignBundle row          │
│ • POSTs /r to agent w/ design_bundle_id │
└──────────────┬───────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ agent: PipelineOrchestrator                                          │
│   design_bundle_id present → DesignImportWorkflow.execute            │
└──────────────┬──────────────────────────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ DesignImportWorkflow.execute                                         │
│ ─────────────────────────────                                        │
│                                                                       │
│ Phase 0 — dispatcher.dispatch_design_bundle                           │
│   • Fetches manifest from backend                                     │
│   • bundle_stager iterates every ZIP entry, classifies                │
│     (page-html / partial / asset / script / style)                    │
│   • Uploads each as a `bundle:*` artifact                             │
│   • Source detection: stitch | claude-design                          │
│                                                                       │
│ Phase 1 — DesignImporter LLM (small)                                  │
│   • Reads `bundle:manifest.md` + format-specific skill                │
│     (`stitch_importer` / `claude_design_importer`)                    │
│   • Returns `DecompositionPlan` — slug mappings, chrome roles,        │
│     four M3 theme pillars, navigation, backend intent                 │
│   • NO HTML/CSS/JSX bodies in the response                            │
│                                                                       │
│ Phase 1.5 — Deterministic decomposition (NO LLM)                      │
│   • runner.run_design_decomposition reads `bundle:*` source bytes     │
│   • Pass A: build theme.css                                           │
│       — collect verbatim @layer blocks                                │
│       — derive 26 M3 tokens from 4 pillars (compute_m3_palette)       │
│       — symmetric font-alias resolution                               │
│   • Pass B: per-page                                                  │
│       — emit content:<slug>:page.html (cleaned, byte-faithful)        │
│       — _emit_babel_shell_artifact emits content:<slug>:script.jsx    │
│         AND (when BABEL_SHELL_PER_MODULE=1) per-sibling module        │
│         artifacts under content:<slug>:scripts/<Name>.jsx              │
│   • Pass C: chrome regions → content:main:{header,footer}.html        │
│   • Pass D: synthesize_creator_plan with supporting_modules per       │
│     entry component                                                   │
│                                                                       │
│ Phase 2 — materialize_design_import_images                            │
│   • Walk every <img> in cleaned HTML                                  │
│   • Pull asset bytes from `bundle:*` (or external URL with Pexels    │
│     recovery for dead sources)                                        │
│   • Re-upload to repo.assets.images at /repo/assets/images/<id>.<ext>│
│   • Rewrite src to __ASSET_IMG:<id> placeholder                       │
│                                                                       │
│ Phase 2 — bundle_digest                                               │
│   • Distil brand_name, page_slugs, headlines for downstream use      │
│                                                                       │
│ Phase 2 — grounding (importers/grounding.py)                          │
│   • ground_design_import_metadata mutates creator_plan in place      │
│   • Reseeds placeholder app_name (e.g. `InToTheHobby_Main_vId`)      │
│     from bundle_digest.brand_name / first page_title /               │
│     first proper-noun chunk of page_summary                           │
│   • Renames generic content components (PostFeed, FeaturedContent,   │
│     MainContent, …) when the page has a meaningful title              │
│                                                                       │
│ Phase 2.3 — app_secondary_type reconciliation                         │
│   • dataapp only when SidebarMenuLeft AND (LLM emitted models OR     │
│     Phase 3.1 extracted models). Otherwise website.                   │
│                                                                       │
│ Phase 3.1 — deterministic data extraction                             │
│   • data_extractor.extract_babel_shell_data walks sibling JSX         │
│   • Finds top-level `const NAME = [{...}]` arrays with at least      │
│     one `.map()` consumer                                              │
│   • Promotes them to backend ModelPlan entries; seed rows stashed    │
│     in StateKeys.EXTRACTED_SEED_DATA for SeedDataBuilder              │
│   • Wiring candidates surface on creator_plan["design_import_meta"]  │
│                                                                       │
│ Phase 3 — Mechanical TSX translation (deterministic)                  │
│   • translate_design_import_components walks every component_plan     │
│     with source_jsx_modules                                            │
│   • Per cluster: transform_babel_shell_modules → entry +              │
│     supporting modules, save codefocus_component/module:*.tsx         │
│   • Merge translated bodies into _codefocus_sibling_modules           │
│                                                                       │
│ Phase 4 — Backend artifact build (LLM, when backend_type=="dynamic") │
│   • Direct BackendBuilder.build_create() call (NOT via                │
│     CreationWorkflow.execute — DesignImportWorkflow owns the call).   │
│   • Runs BackendModelBuilder + BackendHandlerBuilder + SeedDataBuilder │
│     in parallel.                                                      │
│   • Materialises backend.json, handler_code:*.tsx, seed:*.csv.        │
│   • Static designs (no models / handlers) skip this phase.            │
│                                                                       │
│ Phase 5 — Initial app_config assembly (deterministic)                 │
│   • AssemblyService.assemble_app_config produces StateKeys.APP_CONFIG │
│     from staged artifacts + creator_plan.                             │
│                                                                       │
│ Phase 6 — Frontend compliance EditPlan synthesis                      │
│   • One FrontendBuildAction per entry component:                      │
│       prompt = "Validate and clean up entry X and its supporting      │
│                 modules m1, m2, … . Wire <symbol> in module           │
│                 <consumer> → useModel('<model>')."                    │
│   • Push to StateKeys.EDIT_PLAN AND set                               │
│     StateKeys.EDIT_PLAN_SOURCE = "design_import".                     │
│                                                                       │
│ Phase 7 — Delegate to EditingWorkflow.execute()                       │
│   • _plan_edits sees EDIT_PLAN_SOURCE=="design_import" and SKIPS      │
│     the Editor LLM (parses the pre-built plan directly).              │
│   • Backend phases (1–7) short-circuit on empty action lists.         │
│   • Phase 8 frontend_build dispatches ComponentBuilderMultiple        │
│     per action — one LLM turn with full cross-file visibility         │
│     (Glob, Grep, find_symbol_references, edit_artifact).              │
│                                                                       │
│ Final Tailwind compile gate validates every TSX (entries + modules).  │
│ A bundle_hash is computed per entry and its source path bumped when   │
│ supporting modules change → the deploy re-bundles on next publish.    │
└─────────────────────────────────────┬───────────────────────────────┘
                                      ▼
┌──────────────────────────────────────────────────────────────┐
│ agent → orchestrator callback (BackendNotificationService)   │
│ POSTs the assembled config + output file references          │
└──────────────┬───────────────────────────────────────────────┘
               ▼
┌──────────────────────────────────────────────────────────────┐
│ deploy                                                       │
│                                                              │
│ For each entry in repo.frontend.components:                  │
│   Has supporting_modules? (Phase 2)                          │
│   ├─ YES → multi-module bundle                               │
│   │        (esbuild --bundle=true, stages entry + each        │
│   │         module, externals: react, sdk)                    │
│   └─ NO  → single-file transform                             │
│                                                              │
│ On compile failure: substitute placeholder card TSX so the   │
│ page renders "needs your attention" (not a missing module).  │
└──────────────────────────────────────────────────────────────┘
```

---

## Two source flavors

| Source | Trigger | Treatment |
|---|---|---|
| **Stitch** (HTML pages) | bundle's `source` field is `"stitch"` | Each HTML page → `content:<slug>:page.html`. Pure HTML→TSX mechanical translation. |
| **Claude Design / Anima** (HTML + sibling JSX) | bundle's `source` field is `"claude-design"` | Same plus per-page Babel-shell sibling JSX detection → `content:<slug>:script.jsx` (concat) and, when `BABEL_SHELL_PER_MODULE=1`, per-sibling `content:<slug>:scripts/<Name>.jsx` artifacts. |

Source is detected by the `bundle_stager` from manifest content and stored on
`skill_context["bundle_source"]`; the decomposition runner then dispatches to
the right handler under `tools/decomposition/handlers/`.

---

## The four LLM picks

The DesignImporter agent is small and intentionally constrained. It does NOT
write code. It returns a `DecompositionPlan` (`tools/decomposition/plan.py`)
with these fields:

- **`pages: list[PageMapping]`** — one per slug. `output_artifact` MUST be a
  staged `bundle:*` page-html key.
- **`chrome: list[ChromeRegion]`** — header / footer / sidebar with selectors
  that the runner uses to extract the cleaned chrome HTML.
- **`theme.pillars`** — exactly four M3 base colors (primary, secondary,
  surface, error). Each MUST be either a hex literal or a `--var` name that
  resolves to a hex in the bundle's CSS. The runner derives the remaining 26
  M3 tokens via `compute_m3_palette` — no fabricated defaults.
- **`navigation_type`** + **`navigation_items`** — `HeaderMenuTop` /
  `SidebarMenuLeft`; the runner uses this to pick `app_secondary_type`
  (`website` vs `dataapp`).

Every other byte the deployed app needs (HTML bodies, CSS @layer blocks, JSX
sources, image bytes) flows through the deterministic runner reading the
original `bundle:*` artifacts. The LLM cannot fabricate content because it
never writes content.

---

## Phase nomenclature

The codebase carries two unrelated "Phase N" namespaces because two waves of design-import work landed at different times:

- **Babel-shell per-module wave**: `Phase 2` = per-sibling JSX emission (`BABEL_SHELL_PER_MODULE=1`). See the next section. *(The previously-numbered "Phase 4" — Editor `module_name` targeting — was retired when `ModifyComponentAction` was folded into `FrontendBuildAction`. Module discovery is now handled by `ComponentBuilderMultiple`'s import-graph tools.)*
- **Plan-grounding + data-extraction wave**: `Phase 2` = metadata grounding (`importers/grounding.py`), `Phase 2.3` = `app_secondary_type` reconciliation, `Phase 3.1` = deterministic data extraction. *(The previously-inlined "Phase 2.5" module cleanup and "Phase 3.3" data wiring loops were removed from `creation_workflow.py`; their work is now performed by `DesignImportWorkflow`'s post-creation `FrontendBuildAction` dispatch — the cleanup intent and the wiring intent both flow into a single `ComponentBuilderMultiple` invocation per entry, with full cross-file visibility.)*

Where it matters in source comments and PR titles, the surrounding context disambiguates. The pipeline diagram above uses the workflow-level numbering (the second wave); the `transform_babel_shell_modules` translator and the `BABEL_SHELL_PER_MODULE` flag use the first wave.

---

## Babel-shell per-module path (Phase 2)

Claude Design exports a runnable React app: an HTML shell + N sibling `.jsx`
files + an inline `<script type="text/babel">` bootstrap block. Each sibling
JSX file typically owns one logical concern (DataLib, Charts, Sidebar, etc.).

**Phase 2** (gated on `BABEL_SHELL_PER_MODULE=1`) emits one TSX per sibling
JSX with cross-file ES `import { X } from "./Module"` statements. The
backend's `compile_component_bundle` stages all the modules in a temp dir
and runs `esbuild --bundle=true --external:react --external:@exepad/sdk`
to produce one JS bundle per page (no runtime change).

**Per-module edits during the editing flow.** When the user edits a
Babel-shell app post-creation, the Editor emits a `FrontendBuildAction`
whose prompt names the affected entry / module(s). `ComponentBuilderMultiple`
discovers the file set via its import-graph tool surface
(`discover_dependencies`, `find_symbol_references`, `describe_artifact`)
rather than relying on the planner to enumerate targets — the planner
has metadata-only visibility and cannot inspect TSX bodies. Surgical
prop renames and signature updates use `edit_artifact` instead of full
file rewrites, so token cost and risk track the actual change rather
than the file size.

**Bundle-hash deploy invalidation**: the output stage computes
`bundle_hash = sha256(entry_hash + sorted(module_hashes))` and embeds it in
the entry's `source` path. When ANY module changes, the entry's path bumps —
the deploy loop sees a fresh source and triggers a re-bundle, even when the
entry's TSX bytes are unchanged. The field is declared as
`RepoComponentProps.bundle_hash` in
[`packages/types/src/config.ts`](../../packages/types/src/config.ts); the
computation lives in the hosted output/deploy surface, not in this repo.

---

## Three component-build paths

After the decomposition runner has staged sources, the per-component build
loop in `creation_workflow.py` chooses one of three translation paths per
`component_plan`:

| Path | Trigger | Translator | LLM involvement |
|---|---|---|---|
| **A. Mechanical HTML** | `source_html_artifact` set, no JSX siblings | `transform_html_to_tsx` | None when high-confidence + no plan items. Otherwise ComponentBuilder runs in edit mode against the mechanical baseline. |
| **B. Single-file Babel-shell** | `source_jsx_artifact` set | `transform_jsx_to_tsx` | None — entire concat translates mechanically. |
| **C. Per-module Babel-shell** | `source_jsx_modules` non-empty (Phase 2 flag on) | `transform_babel_shell_modules` (orchestrator) + `transform_jsx_module` (per file) | None for translation. Phase 4 module edits route ComponentBuilder against a single module. |

The mechanical translator always runs when source artifacts exist. Confidence
is informational only — even at "low" confidence (web components, MathML,
exotic HTML), the byte-faithful baseline is the saved component. There is no
LLM fallback for design imports.

---

## Design-import parity gate

When path A's `building_plan` carries plan items (data binding, link wiring,
form submission), ComponentBuilder runs in edit mode and may modify the
mechanical baseline. The save tool's
[`_check_design_import_parity`](../../apps/agent/main_agent/agents/orchestrator/app_types/webapp/subagents/artifact_tools.py)
runs an AST diff against `_design_import_mechanical_tsx:<name>` (pushed
before the LLM is invoked). Any drift outside the plan items returns a
terminal failure and the workflow restores the mechanical baseline so the
static-but-correct version ships.

This gate is what closes the Onix Studio fabrication class even when the LLM
DOES participate in the build.

---

## Phase 2 — metadata grounding

The DesignImporter LLM is intentionally unaware of the loaded HTML/CSS/JSX. It plans from the manifest skeleton, which means it sometimes emits values that look reasonable in isolation but have no relationship to the actual design — e.g. `app_name="InToTheHobby_Main_vId"` (a template ID), or content components named `PostFeed` / `FeaturedContent` regardless of what the page is.

`importers/grounding.py:ground_design_import_metadata` runs as a deterministic Python post-pass on the synthesized `creator_plan`, after `bundle_digest` has been computed. It:

- Detects placeholder-shaped `app_name` (versioned suffixes, multi-underscore chains, `_vId` / `_Main_` / `_TBD_` substrings, > 40 chars) and reseeds from `bundle_digest.brand_name` → first page's `page_title` → first proper-noun chunk of `page_summary`.
- Detects generic content-component names against a frozen set (`PostFeed`, `FeaturedContent`, `MainContent`, `Hero`, `Card`, …) and derives a name from the page title when the title is meaningful (i.e. not just "Page" / "Overview" / "Section").

It mutates the plan in place and returns metadata reporting what changed; that metadata is folded into `creator_plan["design_import_meta"]` for downstream consumers (Assembly, telemetry).

---

## Phase 3 — deterministic data extraction + wiring

Claude Design dashboards routinely ship a `data.jsx` sibling that declares a top-level array used by a sibling page module via `.map()`:

```js
// data.jsx
const STUDENTS = [
  { id: 1000, name: "Amelia", grade: 5, gpa: 3.8 },
  { id: 1001, name: "Henry",  grade: 7, gpa: 3.6 },
];

// page-students.jsx
function StudentsTable() {
  return <table>{STUDENTS.map(s => <tr>...</tr>)}</table>;
}
```

The DesignImporter LLM rarely surfaces these as backend models — they look like static UI chrome at the planning level. **Phase 3.1** (`importers/tools/jsx_to_tsx/data_extractor.py`) walks every Babel-shell sibling with tree-sitter and:

1. Finds every top-level `const NAME = [{...}, {...}, …]`.
2. Confirms at least one `.map()` consumer exists in any sibling.
3. Infers a `ModelPlan`-compatible column schema (intersection of keys across the first N rows; type per column from the JSON literals).
4. Returns the raw seed rows so SeedDataBuilder writes a CSV without re-querying an LLM.

The extractor is conservative: it skips heterogeneous arrays, arrays containing JSX or function expressions, computed keys, and spread elements. Better to under-promote than over-promote.

Output flows through `creator_plan["design_import_meta"]`:

- `extracted_models` — list of `{name, source_symbol, source_module, columns, row_count}` entries promoted to `app_backend_plan.models`.
- `extracted_wiring` — list of `{module_name, symbol, model_name, source_module}` candidates for Phase 3.3.
- Raw seed rows stashed in `StateKeys.EXTRACTED_SEED_DATA` so SeedDataBuilder can pick them up.

**Wiring rewrite** then runs as part of `DesignImportWorkflow`'s post-creation `FrontendBuildAction` dispatch (the successor to the previously-inlined Phase 2.5 + 3.3 loops). For each entry component, the synthesized `FrontendBuildAction.prompt` carries both the cleanup intent ("validate the mechanical TSX") AND the wiring intent ("rewrite `<symbol>` in module `<consumer>` → `useModel('<model>').data`"). `ComponentBuilderMultiple` runs once per entry with full cross-file visibility — declarations and consumers update together in one LLM turn, and the surgical `edit_artifact` tool handles the `.map()` site rewrites without re-emitting whole files.

This is also what flips `app_secondary_type` to `dataapp` for sidebar-layout imports that the LLM marked static — the extracted models satisfy the "dynamic backend exists" half of the Phase 2.3 rule.

---

## Asset image flow

Stock images and uploaded assets follow a placeholder-rewrite-then-resolve
pattern:

1. `materialize_design_import_images` walks `<img>` tags in the cleaned HTML.
2. Each image is uploaded to `repo.assets.images[<id>]` with a stable hash
   path and the `<img src>` is rewritten to `__ASSET_IMG:<id>` placeholder.
3. The mechanical TSX translator preserves the placeholder verbatim.
4. At deploy time the asset bytes are copied into the app's object store at
   `/a/<public_id>/repo/assets/images/<id>.<ext>` and the placeholder in the
   compiled JS is rewritten to that absolute URL.

Dead source URLs trigger a Pexels keyword search for a same-aspect-ratio
replacement before falling back to a plain placeholder rectangle.

---

## File map

```
apps/agent/main_agent/agents/orchestrator/importers/
├── dispatcher.py              # entry from CreationWorkflow (no-op under ENVIRONMENT=selfhost)
├── bundle_fetch.py            # object-store fetch of bundle bytes
├── bundle_stager.py           # ZIP → bundle:* artifacts
├── bundle_digest.py           # extract brand_name, page_slugs, headlines
├── design_importer.py         # DesignImporter LLM agent + image materializer
├── grounding.py               # Phase 2: app_name + component-name reseed
└── tools/
    ├── decomposition/
    │   ├── runner.py          # deterministic theme + per-page + chrome pass
    │   ├── plan.py            # DecompositionPlan schema
    │   └── handlers/          # source-specific (stitch, claude-design)
    ├── html_to_tsx/           # mechanical HTML → TSX
    ├── jsx_to_tsx/
    │   ├── transformer.py     # legacy single-file Babel-shell translator
    │   ├── module_transformer.py  # Phase 2 per-module translator
    │   └── data_extractor.py  # Phase 3.1 deterministic data extractor
    └── image_asset_rewriter.py    # __ASSET_IMG: placeholder rewriter
```

The deploy-time compile (single-file transform vs. multi-module bundle, and the
routing between them) lives in the deploy surface that consumes the agent's
output, not in this repo.

---

## Feature flag

`BABEL_SHELL_PER_MODULE` controls whether the importer emits per-sibling TSX
modules (Phase 2 / Phase 4) or mechanically concatenates them into one entry
(legacy). It is read from the agent process environment
(`main_agent/agents/orchestrator/importers/tools/decomposition/runner.py`) and
is **off** unless set to `1`/`true`/`yes`/`on`.

The flag requires the deploy surface to support multi-module bundling —
otherwise apps with `supporting_modules` fail to bundle and render blank.
Existing apps minted before the flag was enabled keep working under the legacy
concat path.

Rollback: unset the flag and restart the agent. Multi-module bundle compile
then never fires (all entries have empty `supporting_modules`) and the legacy
single-file path takes over.
