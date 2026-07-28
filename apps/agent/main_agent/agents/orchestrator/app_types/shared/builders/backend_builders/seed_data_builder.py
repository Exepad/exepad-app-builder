"""
Unified SeedDataBuilder agent -- generates realistic sample records.

Single implementation used by the Code Focus (TSX)
build modes. Uses the full instruction set with example JSON and reference
examples section.

Output: seed data JSON artifact with datasets array, each containing
name, records, and schema_fields.
"""

from typing import Literal, Optional

from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.tools.skill_toolset import SkillToolset
from pydantic import BaseModel, Field
from config import AgentName

from main_agent.agents.utils.skills import load_backend_skills

from ..builder_factory import create_json_config_builder
from .seed_artifact_tools import validate_and_save_seed_artifact_tool
from ...models.plan_models import ModelPlan, StaticDatasetPlan

_BACKEND_SKILL_TOOLSET = SkillToolset(skills=load_backend_skills())


class SeedDataBuilderInput(BaseModel):
    """Input for the SeedDataBuilder agent.

    Receives typed model and static dataset plans directly.
    """

    model_plans: list[ModelPlan] = Field(
        default=[],
        description=(
            "Backend model definitions. For each model with seed_hint, "
            "generate records matching the model's exact column names and types."
        ),
    )
    static_datasets: list[StaticDatasetPlan] = Field(
        default=[],
        description=(
            "Static dataset definitions for hardcoded display data "
            "(pricing tiers, feature lists). Not backed by D1 models."
        ),
    )
    app_context: str = Field(
        default="",
        description=(
            "App name and summary for generating realistic, domain-appropriate data. "
            "Example: 'FitTrack — A fitness tracking dashboard for personal trainers.'"
        ),
    )

    # ── Edit mode ──
    build_mode: Literal["create", "edit"] = Field(
        default="create",
        description="'create' generates fresh seed data; 'edit' applies a described change to existing records.",
    )
    editor_prompt: Optional[str] = Field(
        default=None,
        description=(
            "Edit mode only. Free-text description of the data change to apply to "
            'the CURRENT records, e.g. \'Change the price of "Canvas Daily Tote" to '
            '29; add a product "Linen Throw Blanket" ($60, Home Decor, '
            "personality_match minimalist).'"
        ),
    )
    current_records: dict = Field(
        default_factory=dict,
        description=(
            "Edit mode only. {model_name: [record, ...]} — the CURRENT seed rows. "
            "Apply editor_prompt to these and output the COMPLETE updated dataset "
            "(all rows, changed and unchanged)."
        ),
    )


def seed_data_builder_instruction_provider(context: ReadonlyContext) -> str:
    """Instruction provider for SeedDataBuilder."""
    return """
## Your Role

You are **SeedDataBuilder** — you generate realistic sample data for an Exepad web application.

## Input

You receive:
- `model_plans`: Backend model definitions. Each model has:
  - `name`: Table name (lowercase_snake_case)
  - `columns`: List of ColumnPlan, each with `name`, `type` ("text"|"integer"|"real"|"blob"|"json"), and an optional `enum_values` list
  - `seed_hint`: Hint for generating realistic data
- `static_datasets`: Static dataset definitions. Each has:
  - `name`: Dataset name
  - `schema_fields`: List of field description strings (e.g., "name: text", "price: number")
  - `generation_hint`: Hint for data generation
- `app_context`: App name and description for realistic data

**Columns with `enum_values`** — every seed record MUST use a value drawn
from that exact list, character-for-character, case-sensitive. The seed
validator rejects rows that use any other value, and the builder will retry
with a clearer error. Distribute values realistically (for a status column
with 10 rows, don't make every row "draft"; spread them across the declared
values).

Generate seed data for BOTH model_plans (D1-backed) and static_datasets (inline display data).

## Edit Mode (when `build_mode` = "edit")

You are MODIFYING existing seed data, not inventing fresh data:
- `current_records` holds the CURRENT rows as `{model_name: [record, ...]}`.
- `editor_prompt` describes the change to make (update a value, add a row, remove a row).
- Apply ONLY that change. Preserve every other row and field exactly as-is — same
  `id`s, same values. Do NOT regenerate, reorder, or re-shuffle untouched rows.
- New rows continue the existing `id` sequence (max existing id + 1, +2, …).
- Output the COMPLETE updated dataset (ALL rows for the affected model) via
  `validate_and_save_seed_artifact`, using the model's exact column names/types.

## Output

Generate a JSON object with a `datasets` array. Each entry has:
- `name`: Dataset name (must match a model or static dataset name)
- `records`: Array of realistic data objects (see the record-count guidance in Rules)
- `schema_fields`: Array of field definitions with `name`, `type`, and optional `label`

## Rules

1. **Match the schema exactly**:
   - For model_plans: use EXACT `columns[].name` and `columns[].type` from the model
   - For static_datasets: derive fields from `schema_fields` descriptions
   - Every record must have an `id` field (integer, starting from 1)

2. **Generate realistic data**:
   - Use `app_context` and `seed_hint`/`generation_hint` for domain-appropriate data
   - Names should be realistic (not "Test User 1", "Sample Product")
   - **Dates use deploy-time relative tokens** instead of hard-coded calendar
     dates. The deploy pipeline expands these to actual dates anchored to
     deploy time, so dashboards stay live regardless of when this CSV was
     generated. Use these token forms:
       - `__TODAY__`        → today's date (`YYYY-MM-DD`)
       - `__TODAY__-7d`, `__TODAY__-1d`, `__TODAY__+30d` → date offset
         (units: `d` days, `w` weeks, `mo` months)
       - `__NOW__`          → current ISO timestamp
       - `__NOW__-2h`, `__NOW__-30m`, `__NOW__+5d` → timestamp offset
         (units: `m` minutes, `h` hours, `d`, `w`, `mo`)
     For time-series columns (`check_in_time`, `created_at`, `event_date`,
     `logged_at`, `timestamp`, and any column queried with `date('now', '-N
     days')`), distribute records across `__TODAY__-Nd` through `__TODAY__`
     (typically last 7–30 days). For expiry / valid-until columns on rows
     with `status = "active"`, use future tokens like `__TODAY__+30d` to
     `__TODAY__+180d`. Hard-coded ISO dates (`"2025-01-15"`) remain valid
     for genuinely fixed dates (launch dates, holidays); don't use them for
     "recent activity".
   - Prices, quantities, and metrics should be plausible
   - Use a variety of values (not all the same)

3. **D1 column type → record value mapping**:
   - `text` → realistic strings; for date / datetime columns prefer the
     `__TODAY__-Nd` / `__NOW__-Nh` tokens described in rule 2 over fixed
     ISO strings
   - `integer` → whole numbers (also used for booleans: 0=false, 1=true)
   - `real` → decimal values (prices, ratings, percentages)
   - `json` → serialized JSON string (e.g., '{{"key": "value"}}')
   - `blob` → omit from seed records (binary data)

4. **Record count** (based on dataset purpose):
   - 3-8 records for lookup/reference data (categories, statuses, tags)
   - 5-10 records for simple single-entity forms (contact/newsletter submissions)
   - **20-40 records for dashboard / list-view entities** (orders, applications,
     products, tasks) so tables and charts look alive instead of sparse.
   - **30-50 records for time-series datasets** (attendance logs, event history,
     check-ins, audit trails) spread across **7+ days** so charts and range-based
     trend handlers render meaningful patterns instead of a flat line.
   - Keep datasets under ~50 rows — seed data demonstrates layout, not volume;
     aim for the richer end on the primary list/dashboard entity, fewer for
     forms and lookups.

5. **Data consistency**:
   - If datasets reference each other (e.g., orders reference product IDs),
     ensure the referenced IDs exist in the related dataset
   - Status fields should have a realistic distribution (not all "active")
   - **Status/enum values MUST be lowercase** (e.g., "active", "pending", "success", "failed").
     D1/SQLite is case-sensitive — "Success" will NOT match "success" in component filters.
   - **Status/date coherence:** when a record has both a status enum (`status`, `state`)
     and an expiry/end-date column (`expiry_date`, `expires_at`, `ends_at`,
     `valid_until`, `renewal_date`), ACTIVE-like statuses (`active`, `ongoing`,
     `enrolled`) MUST have dates in the future; EXPIRED-like statuses (`expired`,
     `ended`, `cancelled`) MUST have dates in the past. An ACTIVE row with a past
     expiry is always a bug.

6. **No nested objects in records**:
   - Keep records flat (no nested objects or arrays within a record)
   - If a field needs complex data, serialize as a JSON string

7. **Content simplicity**:
   - Keep ALL string values short — max 80 chars for titles, max 150 for descriptions
   - NEVER generate multiline content (no newlines within field values)
   - Seed data demonstrates app layout and structure, not realistic content depth

## Skills

Before generating records, call `load_skill(skill_name='seed-data-csv')`
for Exepad's realistic-data conventions (region-mixed names, status
distributions, date sequencing, FK consistency, and system-column
handling — owner_id/created_at/updated_at are injected by the seeder,
so omit them).

## Workflow

1. Load the `seed-data-csv` skill.
2. Parse `model_plans` and `static_datasets`
3. For each dataset, determine the exact field schema
4. Generate realistic records following the rules above
5. Call `validate_and_save_seed_artifact` with your complete JSON output
6. If validation fails, fix errors and retry
"""


seed_data_builder_agent = create_json_config_builder(
    name=AgentName.SEED_DATA_BUILDER,
    agent_docs=[],
    role_instruction=seed_data_builder_instruction_provider,
    input_schema=SeedDataBuilderInput,
    validate_tool=validate_and_save_seed_artifact_tool,
    thinking_budget=0,
    extra_tools=[_BACKEND_SKILL_TOOLSET],
)
