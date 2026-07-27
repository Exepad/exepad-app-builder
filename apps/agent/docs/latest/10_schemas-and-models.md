# Schemas & Models

The agent relies on `packages/schemas/` for reference docs, validation helpers, examples, and shared metadata.

---

## Schema Directory

```text
packages/schemas/
  data/
    agent_docs/
      planner/
      editor/
      frontend/
      backend/
      surfaces/
    examples/
    fonts/
    icons/
    full_schema_model/
  scripts/py/
    validation/
    full_schema_utils.py
    example_utils.py
```

## Agent Docs Used by the Live Pipeline

Every functional area follows the `<area>/docs/` (static, loaded into
the agent instruction) + `<area>/skills/` (loaded via SkillToolset at
LLM inference time) split. See [skills.md](skills.md) for the full
authoring reference.

### Planner Docs

Used by `Creator`:

- `planner/docs/00_PLATFORM_GUIDE.md`
- `planner/docs/05_APP_TYPE_*.md`
- `planner/docs/10_DESIGN_SYSTEM_PLANNING.md`
- `planner/docs/11_COMPONENT_PLANNING.md`
- `planner/docs/12_COMPONENT_PLANNING_FORMS.md`
- `planner/docs/13_COMPONENT_PLANNING_DATAAPP.md`
- `planner/docs/14_CONTENT_AND_MEDIA.md`
- `planner/docs/15_BACKEND_PLANNING.md`
- `planner/docs/16_FAVICON.md`

### Editor Docs

Used by `Editor`:

- `editor/docs/00_DEPENDENCY_MAP.md`
- `editor/docs/01_ACTION_SCHEMAS.md`
- `editor/docs/02_DECISION_TREE.md`
- `editor/docs/03_EXAMPLES.md`
- `editor/docs/04_IMAGE_OPS.md`

### Frontend Builder Docs + Skills

Used by `ComponentBuilder` / `ComponentBuilderMultiple`:

- Static docs (`frontend/component_builder/docs/`): `03_COMPONENT_PATTERNS.md`, `05_CODE_COMPONENTS.md`, `10_COLOR_AND_LAYOUT.md`, `11_IMAGES.md`, `12_ANTI_PATTERNS.md`
- Skills (`frontend/component_builder/skills/`): 27 SKILL.md (3 flow + 24 domain), loaded via SkillToolset

Used by `DesignSystemBuilder`:

- Static doc (`frontend/design_builder/docs/`): `02_DESIGN_SYSTEM.md`
- Skills (`frontend/design_builder/skills/`): 2 SKILL.md (`dark-mode-tokens`, `font-pairing`), loaded via SkillToolset

### Logic / Backend Docs + Skills

Used by `LogicBuilder`:

- `frontend/logic_builder/docs/04_UI_LOGIC.md`

Used by `BackendModelBuilder` / `BackendHandlerBuilder` / `SeedDataBuilder`:

- Static docs (`backend/docs/`): `BACKEND_MODELS_CONFIG.md`, `BACKEND_HANDLERS_CONFIG.md`
- Skills (`backend/skills/`): 3 SKILL.md (`database-schema-design`, `handler-patterns-rpc`, `seed-data-csv`), shared SkillToolset

### Surface Guides

Used when building runtime context for downstream builders:

- `surfaces/logic_surface/docs/STATE_USAGE_GUIDE.md`
- `surfaces/backend_surface/docs/07_BACKEND_MODELS_GUIDE.md`
- `surfaces/backend_surface/docs/08_BACKEND_HANDLERS_GUIDE.md`
- `surfaces/backend_surface/docs/09_FILE_STORAGE_GUIDE.md`
- `surfaces/backend_surface/docs/14_AUTH_SECURITY_GUIDE.md`
- `surfaces/backend_surface/docs/15_FORM_SERVICE_GUIDE.md`

## Loading Docs in Code

`main_agent/agents/utils/agent_docs_loader.py` provides:

- `load_agent_doc(doc_name)`
- `load_agent_docs(doc_names)`
- `InstructionBuilder` for conditional prompt assembly

Example:

```python
from main_agent.agents.utils.agent_docs_loader import InstructionBuilder

prompt = (
    InstructionBuilder()
    .add_doc("planner/docs/00_PLATFORM_GUIDE.md")
    .add_doc("planner/docs/11_COMPONENT_PLANNING.md")
    .build()
)
```

## Generated Model / Artifact Shapes

The live webapp builder ultimately assembles UI as `CodeComponentProps` entries that reference generated TSX files.

Common artifacts:

- `codefocus_style:theme.css`
- `codefocus_component:{ComponentName}.tsx`
- `logic.json`
- `backend.json`
- `handler_code:{handler}.tsx`
- `seed:{dataset}.csv`
- `content:{page}:{component}.md`

Common runtime page type:

- `WebPageProps`

### MCP capability on generated apps

When `mcp: { enabled: true }` is set in the backend config, the deployed
app-backend exposes `POST /mcp` (Streamable HTTP, JSON-RPC 2.0) so AI agents
can discover and call CRUD / handler tools via the Model Context Protocol.
Auth is `Bearer exepad_sk_*` (API key) or gateway JWT. The agent does NOT
emit `mcp` blocks by default — this is a platform feature configured at
deploy time. See the app-backend docs for the full surface.

## Pydantic Models

Live agent input/output contracts are defined with Pydantic v2 models inside the agent modules themselves.

Example:

```python
class CreatorInput(BaseModel):
    app_name: str
    app_description: str
    image_catalog_summary: str = "No images available."
    document_artifact_list: list[str] = []
    large_document_list: list[dict] = []
```

These models are the source of truth for:

- ADK structured I/O
- workflow state handoff
- validation in tests
