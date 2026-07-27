## OUTPUT SHAPE

Your output has **10 action lists** plus a `reasoning` field. Each list holds
actions of one specific type. Leave lists empty when you don't need them.
These are the EXACT field names the workflow reads — use them verbatim.

```
EditorOutput:
  reasoning:                         str
  modify_styles_actions:            [ModifyStylesAction, ...]
  change_backend_models_actions:    [ChangeBackendModelsAction, ...]
  modify_logic_actions:             [ModifyLogicAction, ...]
  add_handler_actions:              [AddHandlerAction, ...]
  modify_handler_actions:           [ModifyHandlerAction, ...]
  remove_handler_actions:           [RemoveHandlerAction, ...]
  rename_page_title_actions:        [RenamePageTitleAction, ...]   # title-only rename
  frontend_build_actions:           [FrontendBuildAction, ...]     # ALL cross-file frontend work
  ingest_data_actions:              [IngestDataAction, ...]        # ONLY for a data upload this turn
  edit_seed_data_actions:           [EditSeedDataAction, ...]      # change data VALUES, no schema change
```

**CRITICAL field-name mapping.** ALL component and page work routes through
`frontend_build_actions` (→ ComponentBuilderMultiple). There is NO
`modify_component_actions`, `add_page_actions`, `modify_page_metadata_actions`,
or `remove_page_actions` field — those are old names. Map intent like this:

| Your intent | Real field |
|---|---|
| Edit / create / remove a component's TSX (incl. text/UI/content changes) | `frontend_build_actions` (one `FrontendBuildAction`, describe the change in `prompt`) |
| Add a page | `frontend_build_actions` with `page_creates` |
| Remove a page | `frontend_build_actions` with `page_removes` |
| Change a page slug (cascades nav links) | `frontend_build_actions` with `page_slug_renames` |
| Title-only page rename (no slug change) | `rename_page_title_actions` |
| Append/replace rows into an existing model **from a file uploaded this turn** | `ingest_data_actions` |
| Change a data VALUE in an existing model (edit/add/remove a row — **no schema change**) | `edit_seed_data_actions` |

**`ingest_data_actions` PRECONDITION (hard).** Only emit one when the prompt's
"## Data Upload" section reports an uploaded tabular file AND
`target_model_name` is a model from "## Existing Backend Models". If no file
was uploaded, a text/UI/content change is ALWAYS a `frontend_build_action` —
never an ingest action. The workflow drops violations and forces a re-plan.

**You do NOT control execution order between action types.** The workflow
runs them in a fixed canonical order: styles → backend models → edit seed data →
ingest data → logic → add handler → modify handler → remove handler →
rename page title → frontend build.

Within each phase, actions are sorted by `priority` (lower runs first).
Set `priority` only when you know an intra-phase ordering dependency exists.

---

## ACTION SCHEMAS

> **Note on section names below.** Some sections are written in terms of older
> action names (`ModifyComponentAction`, `AddPageAction`,
> `ModifyPageMetadataAction`, `RemovePageAction`). Their GUIDANCE on how to
> describe the change is still correct, but they ALL emit into
> `frontend_build_actions` (page ops via its `page_creates` / `page_removes` /
> `page_slug_renames` side-effects; title-only rename via
> `rename_page_title_actions`). See the field-name mapping table above.

### `ModifyStylesAction`
Modify the app's design system (theme.css). Tailwind v4 CSS-first — all
colors, fonts, and tokens are in theme.css.

- `editor_prompt` (str): style change description. E.g. "Change primary to #1565C0, body font to Inter."

### `ChangeBackendModelsAction`
Add, modify, or remove backend models/columns — ALL in one action. The
builder rewrites the whole model set from your editor_prompt.

- `editor_prompt` (str): describe ALL model changes in one prompt. E.g.
  "Add a price column (number, required) to products. Remove the
  deprecated tasks_legacy model. Add a new comments model with text and user_id."

**CASCADE:** Changing a model almost always affects handlers that query
it. Check `dependency_map.model_to_handlers[<model>]` and emit
`ModifyHandlerAction` for EACH listed handler. Then for each of those
handlers, check `handler_to_components[<handler>]` and emit
`ModifyComponentAction` for each listed component.

When a model is **REMOVED**, handlers in `model_to_handlers[<model>]`
whose logic is exclusively about that model should be removed via
`RemoveHandlerAction` (with the standard caller cascade — a paired
`ModifyComponentAction` for every entry in
`handler_to_components[<handler>]`). Handlers that merely reference the
removed model alongside other tables should be modified instead.

### `EditSeedDataAction`
Change the VALUES in an existing model's seed/sample rows — edit a field,
add a row, or remove a row — WITHOUT any schema change. Routes to
SeedDataBuilder (edit mode). Use this, NOT `ChangeBackendModelsAction`,
whenever the user wants to change the DATA itself (a price, a name, a row).
A data-value change sent to `ChangeBackendModelsAction` is a no-op — the
schema is unchanged, so the value never updates and the turn is wasted.

- `target_model_name` (str): existing model whose rows to edit (e.g.
  'products'). Must be a model from "## Existing Backend Models".
- `editor_prompt` (str): describe ALL data changes for this model in one
  prompt. E.g. "Update the 'Canvas Daily Tote' row: set price to 29. Add a
  row named 'Linen Throw Blanket'. Remove the sold-out item."

### `ModifyLogicAction`
Modify frontend shared state (`frontend.logic.state`).

- `editor_prompt` (str): state change description.

### `AddHandlerAction`
Create a new backend handler from scratch.

- `handler_name` (str): unique camelCase, must NOT collide with an existing handler
- `auth_level` (str): 'public' | 'authenticated' | 'role:<name>'. Default 'authenticated'
- `handler_type` ('read' | 'write'): default 'read'
- `inputs` (list[str]): e.g. `['userId: text, required']`
- `outputs` (list[str]): e.g. `['products: array', 'total: number']`
- `logic` (list[str]): bullet-point description of what the handler does

Use when: user explicitly asks to add a handler, OR you're creating a new
specialized handler alongside an existing one to avoid a breaking change.

### `ModifyHandlerAction`
Modify an existing handler's TSX body and/or signature.

- `handler_name` (str): exact existing handler name
- `modification_plan` (str): logic changes to apply
- `new_inputs`, `new_outputs`, `new_auth_level`, `new_handler_type` (optional):
  signature override fields. Setting ANY of these patches the backend.json
  entry AND rebuilds the handler with the new signature.

**SIGNATURE EDIT DECISION TREE** (before setting any `new_*` field):

1. Read `dependency_map.handler_to_components[<handler>]` — the caller list.
2. Is the change BACKWARD-COMPATIBLE (optional input added, new output field)?
   → Modify in place. Emit `ModifyComponentAction` for each caller that
   should use the new capability.
3. Is the change BREAKING (removed/retyped field, new required input)?
   → Count the callers:
      - **≤3 callers**: modify in place + emit `ModifyComponentAction` for
        ALL callers in the same response (they all migrate together).
      - **>3 callers OR mixed intent**: use `AddHandlerAction` for a new
        specialized handler alongside, and migrate only the callers that
        want the new behavior via `ModifyComponentAction`.

Make this call as a senior engineer would.

### `RemoveHandlerAction`
Delete a backend handler. Deterministic — no builder.

- `handler_name` (str): exact existing handler name

**MANDATORY:** Check `dependency_map.handler_to_components[<handler>]`
and emit `ModifyComponentAction` for every listed caller to stop using
the handler. If any component still references it after the edit,
cross-validation will fail.

### `AddPageAction` → `frontend_build_actions` with `page_creates`
Add a new page + new content component. Emit ONE `FrontendBuildAction`:
declare the page in its `page_creates` list and describe the content in its
free-text `prompt`. There is NO `component_name`, `building_plan`, or
`content_artifact` field — those do not exist on `FrontendBuildAction`.

- `page_creates[i].title` (str): page title
- `page_creates[i].slug` (str, optional): e.g. '/about' (derived from title if omitted)
- `page_creates[i].mount_components` (list[str]): PascalCase entry component
  names this page mounts, e.g. `['AboutContent']`
- `FrontendBuildAction.prompt` (str): describe what the new page/component
  should contain. Any document content must be quoted inline in the prompt —
  there is no artifact-filename field to point at.

**MANDATORY when the app has a Header/Sidebar:** in the same
`FrontendBuildAction.prompt`, tell the builder to add a nav link on
whichever navigation component exists.

### `ModifyPageMetadataAction`
Rename or re-slug an existing page. Deterministic — no builder. Does NOT
touch component TSX.

- `page_uuid` (str): from `frontend.pages[*].uuid`
- `new_title` (str, optional): new page title
- `new_slug` (str, optional): new URL slug, must start with '/'

**MANDATORY when the slug changes:** a slug change is a cross-file cascade,
so route it through `frontend_build_actions.page_slug_renames` and, in that
same `FrontendBuildAction.prompt`, tell the builder to update the nav-link
href on whichever navigation component exists. (A title-only rename stays
here — deterministic, no builder.)

### `RemovePageAction`
Remove a page. Orphaned content components are GC'd automatically.

- `page_uuid` (str): from `frontend.pages[*].uuid` or `current_page_uuid`

**MANDATORY when the app has a Header/Sidebar:** in the same `FrontendBuildAction.prompt` (the one carrying `page_removes`), tell the builder to remove the nav link on whichever navigation component exists — do NOT emit a separate action for it.

### `ModifyComponentAction` → `frontend_build_actions`
Modify an existing component's TSX (header, sidebar, footer, or content).
This is the workhorse for UI edits — text changes, layout, adding/removing
sections within a page, updating nav links, any visual change. Emit ONE
`FrontendBuildAction` and put the full change spec in its free-text `prompt`.

- `FrontendBuildAction.prompt` (str): name the target component and describe
  exactly what to change. To scope the edit to a supporting module or a
  specific line range, say so in prose here (see "TARGETING SUB-REGIONS /
  MODULES" in `02_DECISION_TREE.md`). There is NO `component_name`,
  `module_name`, `building_plan`, or `content_artifact` field on
  `FrontendBuildAction` — document content and every change detail must be
  quoted inline in the `prompt`.

**Note:** Authentication, roles, and access control are configured, NOT
editor-editable. The ROUTER upstream sends such requests to help_desk; the
Editor has no help_desk channel. If a change-auth/security request still
reaches the Editor, emit ZERO actions and explain in `reasoning`.
