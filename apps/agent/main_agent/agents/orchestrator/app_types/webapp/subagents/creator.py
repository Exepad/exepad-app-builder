"""
Creator Subagent.

Takes a user prompt (and optionally HTML files) and outputs a structured plan
for building an app, including component breakdown, design system tokens,
navigation type, and per-component building instructions.
"""

from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.tools import load_artifacts
from pydantic import BaseModel, Field, ValidationInfo, model_validator
from typing import Literal, Optional
from datetime import datetime
from dotenv import load_dotenv

from config import get_agent_model, AgentName
from main_agent.agents.utils.agent_docs_loader import InstructionBuilder, get_app_type_doc
from main_agent.agents.utils.thought_signature_fix import (
    strip_thinking_metadata,
    strip_thinking_from_response,
)
from google.adk.planners import BuiltInPlanner
from google.genai import types
from ...shared.models import (
    LogicPlan,
    BackendPlan,
    SecurityPlan,
)
from .....tools.content_artifact_tools import (
    save_content_artifact_tool,
    save_plan_artifact_tool,
)

load_dotenv()

import structlog

logger = structlog.get_logger(__name__)

CREATOR_NAME = AgentName.CREATOR


# =============================================================================
# Input Schema
# =============================================================================


class CreatorInput(BaseModel):
    """Defines the input structure for the CreatorAgent."""

    app_name: str = Field(description="The name of the app.")
    app_description: str = Field(
        description=(
            "The description of the app. This field is required and provides "
            "the initial description from the user about what app they want to build."
        )
    )

    image_catalog_summary: str = Field(
        default="No images available.",
        description="Summary of available images from user uploads.",
    )
    document_artifact_list: list[str] = Field(
        default=[],
        description=(
            "List of small document artifacts available for loading "
            "(e.g., ['doc:product-spec.md']). Use load_artifacts to read these."
        ),
    )
    large_document_list: list[dict] = Field(
        default=[],
        description=(
            "List of large documents with summaries. " "Each entry has 'source_name' and 'summary'."
        ),
    )

    user_referenced_images: list[str] = Field(
        default=[],
        description=(
            "Image UUIDs explicitly referenced by user with @filename syntax. "
            "USE THESE - they represent clear user intent."
        ),
    )
    user_referenced_documents: list[str] = Field(
        default=[],
        description=(
            "Document artifact names explicitly referenced by user with @filename syntax. "
            "USE THESE - they represent clear user intent."
        ),
    )
    user_referenced_large_documents: list[dict] = Field(
        default=[],
        description=(
            "Large documents explicitly referenced by user with @filename syntax. "
            "Each entry has 'uuid', 'source_name', 'summary'. "
            "USE THESE - they represent clear user intent."
        ),
    )
    bundle_domain_hints: str = Field(
        default="",
        description=(
            "Digest of a user-uploaded design bundle (Stitch/Claude Design). "
            "Contains brand name, page slugs, nav labels, headlines, image alts, "
            "and a body-copy sample extracted directly from the uploaded HTML. "
            "AUTHORITATIVE for brand domain and visual direction: the user authored "
            "this in a design tool, so any inference about what kind of app to "
            "build must align with these hints. Empty when no bundle was uploaded."
        ),
    )
    bundle_page_slugs: list[str] = Field(
        default_factory=list,
        description=(
            "Canonical page slugs present in the uploaded design bundle. When this "
            "list is non-empty, the app's CONTENT PAGES must be EXACTLY this set — "
            "do not invent additional pages (FAQ, Privacy, Terms, Testimonials). "
            "The user authored these pages in the design tool; anything extra is "
            "scope creep that gets dropped before deploy. Legal pages can be added "
            "later via the editor. Empty when no bundle was uploaded (normal "
            "description-driven flow — you may propose pages freely)."
        ),
    )
    data_ingest_report: str = Field(
        default="",
        description=(
            "Prose summary emitted by the DataIngester pre-pass when the user "
            "uploaded tabular files (Excel/CSV/PDF tables/DOCX/PPTX tables). "
            "Lists the backend models that will be auto-provisioned from the "
            "uploads with REAL seed data. If non-empty, **do NOT redeclare those "
            "models in `app_backend_plan.models`** — the workflow merges them in "
            "after you return. Plan handlers and components that consume those "
            "models; if the user requested an analytical view (captured in the "
            "per-model `notes`), plan a runtime handler that computes the "
            "aggregate against the imported rows."
        ),
    )


# =============================================================================
# Output Schema
# =============================================================================


class ComponentPlan(BaseModel):
    """Plan for a single app component."""

    name: str = Field(
        description="PascalCase component name (e.g., 'HomeContent', 'DashboardSidebar', 'MainHeader', 'MainFooter')."
    )
    role: Literal["header", "sidebar", "footer", "content"] = Field(
        description="The component's role in the app layout: 'header' for top navigation, 'sidebar' for side navigation, 'footer' for page footer, 'content' for page body content."
    )
    page_slug: Optional[str] = Field(
        default=None,
        description="The page slug this component belongs to, required when role is 'content' (e.g., '/', '/about', '/dashboard'). Set to null for header, sidebar, and footer components which appear on all pages.",
    )
    page_title: Optional[str] = Field(
        default=None,
        description=(
            "The PAGE-SPECIFIC portion of the title only — do NOT include "
            "the brand or app name. The runtime composes the final "
            "``<title>`` as ``{page_title} | {appName}`` automatically; "
            "duplicating the brand here yields ``Acme | Pricing | Acme``. "
            "Required when role is 'content' (e.g., 'Home', 'About Us', "
            "'Dashboard', 'Pricing', 'FAQ'). Set to null for header, "
            "sidebar, and footer components."
        ),
    )
    building_plan_artifact: str = Field(
        default="",
        description=(
            "Artifact filename containing this component's building plan "
            "(e.g. 'plan:HomeContent.md'). Creator MUST save the plan via "
            "``save_plan_artifact`` BEFORE emitting structured output and "
            "set this field to the returned filename. The workflow then "
            "loads the artifact and injects bullets into the plan dict's "
            "``building_plan`` key for downstream consumers. Always "
            "escalate — keeping the inline list out of the schema is what "
            "keeps the structured-output payload under the model's "
            "max_output_tokens cap."
        ),
    )
    building_plan: list[str] = Field(
        default=[],
        description=(
            "OPTIONAL inline building plan bullets (4-8 per component, <=100 chars "
            "each). Use this when emitting bullets directly INSTEAD OF calling "
            "save_plan_artifact (e.g. on non-Gemini providers like "
            "deepseek-v4-flash that skip tool calls). The materializer prefers "
            "inline > artifact > synthesis. Leave empty ([]) on the Gemini "
            "artifact-ref path and for large apps. Never set both this and "
            "building_plan_artifact for the same component."
        ),
    )
    interactive_elements: list[str] = Field(
        default=[],
        description="Interactive elements this component contains: charts, forms, toggles, modals, data tables, filters, etc.",
    )
    image_references: list[str] = Field(
        default=[],
        description="Exact image UUIDs from image_catalog_summary to use in this component. Copy UUID strings character-for-character.",
    )
    content_artifact: str = Field(
        default="",
        description="Artifact filename containing markdown content for this component (e.g., 'content:home:hero.md'). If provided, builder loads this instead of relying solely on building_plan.",
    )
    source_html_artifact: str = Field(
        default="",
        description=(
            "Artifact filename containing authoritative cleaned HTML source for "
            "this component (e.g., 'content:home:page.html'). Produced by the "
            "DesignImporter for design-bundle imports (Stitch / Claude "
            "Design). When non-empty, ComponentBuilder loads the artifact via "
            "load_artifacts and TRANSLATES the HTML to TSX — preserving layout, "
            "classes, and structure verbatim — instead of generating structure "
            "from building_plan. Distinct from content_artifact (which carries "
            "markdown copy): HTML source is layout-authoritative."
        ),
    )
    page_summary: str = Field(
        default="",
        description="3-5 sentence description of what the page does and its key content. Required for content components.",
    )
    page_short_summary: str = Field(
        default="",
        description="Exactly one sentence summarizing the page. Required for content components.",
    )
    page_type: Literal["WebPageProps"] = Field(
        default="WebPageProps",
        description="Page type: always 'WebPageProps' for code component pages.",
    )
    complexity_level: Literal["basic", "intermediate", "complex"] = Field(
        default="intermediate",
        description=(
            "Component complexity: 'basic' for static content and simple layout, "
            "'intermediate' for interactive elements and data display, "
            "'complex' for charts, CRUD data tables, games, or real-time features."
        ),
    )


class DesignSystemPlan(BaseModel):
    """Design system tokens for the app."""

    primary_color: str = Field(
        description="Primary brand color in hex. Vary by domain — e.g. '#B45309' (warm amber), '#0F766E' (teal), '#9333EA' (vivid purple), '#C2410C' (burnt orange), '#15803D' (forest green)."
    )
    secondary_color: str = Field(
        description="Secondary accent color in hex. Contrast with primary — e.g. '#D97706' (golden), '#DB2777' (magenta), '#0891B2' (cyan), '#7C3AED' (violet)."
    )
    surface_color: str = Field(
        description="Surface/background color in hex. NOT always white — e.g. '#FFFBEB' (warm cream), '#F0FDF4' (mint tint), '#FFF1F2' (rose tint), '#F8FAFC' (cool gray), '#1E1B2E' (dark mode)."
    )
    error_color: str = Field(description="Error/destructive action color in hex (e.g., '#DC2626').")
    headline_font: str = Field(
        description="Google Font for headings. Be creative — match the brand personality. Examples: 'Bricolage Grotesque', 'Fraunces', 'Instrument Serif', 'Sora', 'Libre Baskerville', 'Playfair Display'."
    )
    body_font: str = Field(
        description="Google Font for body text. Prioritize readability, but vary across apps. Examples: 'Karla', 'Lora', 'Nunito', 'Rubik', 'Albert Sans', 'Figtree'."
    )
    design_style: list[str] = Field(
        description="6-12 DISTINCTIVE visual design bullets. Each bullet = one specific visual decision (mood, color temperature, border treatment, shadow style, spacing personality, sidebar appearance, typography character). NEVER use generic phrases like 'professional and data-dense' or 'dark sidebar with light content'."
    )


class CreatorOutput(BaseModel):
    """Defines the output structure for the CreatorAgent."""

    app_name: str = Field(description="The name of the app.")
    app_building_plan_artifact: str = Field(
        default="",
        description=(
            "Artifact filename for the app-wide building plan "
            "(e.g. 'plan:app.md'). Creator MUST save the plan via "
            "``save_plan_artifact`` BEFORE emitting structured output and "
            "set this field to the returned filename. The workflow loads "
            "the artifact and injects bullets into the plan dict's "
            "``app_building_plan`` key for downstream consumers."
        ),
    )
    app_building_plan: list[str] = Field(
        default=[],
        description=(
            "OPTIONAL inline app-wide building plan bullets (8-14 bullets, "
            "<=100 chars each). Use this when emitting bullets directly INSTEAD "
            "OF calling save_plan_artifact. The materializer prefers "
            "inline > artifact > synthesis. Leave empty ([]) on the Gemini "
            "artifact-ref path and for large apps. Never set both this and "
            "app_building_plan_artifact."
        ),
    )
    navigation_type: Literal["HeaderMenuTop", "SidebarMenuLeft"] = Field(
        description="The navigation pattern: 'HeaderMenuTop' for top header navigation (websites) or 'SidebarMenuLeft' for left sidebar navigation (dashboards)."
    )
    design_system: DesignSystemPlan = Field(
        description="Design system tokens: colors, fonts, and style direction for the entire app."
    )
    component_plans: list[ComponentPlan] = Field(
        description="Ordered list of component plans. Include one content component per page. Optionally include a navigation component (header or sidebar) and a footer — these may be omitted for form apps or distraction-free layouts."
    )
    app_logic_plan: LogicPlan = Field(
        default_factory=LogicPlan,
        description="Plan for frontend.logic (state variables only). Empty for content-only sites.",
    )
    app_backend_plan: BackendPlan = Field(
        default_factory=BackendPlan,
        description="Plan for backend config (models, handlers). Set backend_type='none' for content-only sites, 'static' for inline datasets only, 'dynamic' for D1 models.",
    )
    app_security_plan: SecurityPlan = Field(
        default_factory=SecurityPlan,
        description="Plan for authentication and authorization. Set needs_auth=true when login/signup/roles/permissions are required.",
    )
    app_favicon_svg: str = Field(
        default="",
        description=(
            "A small inline SVG string for the app's browser tab favicon. "
            "Must start with '<svg' and end with '</svg>'. "
            "viewBox='0 0 32 32', simple shapes only (circle, rect, path, text, polygon), "
            "max 3-4 elements, use the app's primary color from design_system. "
            "No external references, no <image> tags, no filters or gradients with IDs."
        ),
    )
    reasoning: str = Field(
        default="",
        max_length=400,
        description=(
            "ONE short sentence (≤400 chars, ≤60 words) noting why this "
            "app type / navigation / page set was chosen. NOT an essay. "
            "Optional — leave empty when the choice is obvious from "
            "app_description. This field is observability-only and is "
            "never read by downstream pipeline stages, so length-bound "
            "it strictly to keep the structured response under the "
            "max_output_tokens cap."
        ),
    )

    @model_validator(mode="after")
    def _enforce_artifact_for_content_pages(self, info: ValidationInfo) -> "CreatorOutput":
        """Schema-level invariant: every content component rendered as
        code MUST escalate its building plan via ``save_plan_artifact``
        and reference the artifact in ``building_plan_artifact``.

        ``ComponentPlan.building_plan_artifact`` carries ``default=""`` so
        chrome roles can legitimately ship empty.
        That same default lets Gemini's structured-output mode silently
        drop the field on regular content components when prose rules are
        the only enforcement (observed with Gemini 3 Flash Preview after
        multi-turn ``save_plan_artifact`` tool calls).

        **Context-gated raise.** ADK's ``LlmAgent`` validates the model
        response via ``output_schema.model_validate_json(result)`` with no
        validation context (see ``google/adk/agents/llm_agent.py``). The
        agent's retry plumbing now classifies a ``pydantic.ValidationError``
        from that parse as retryable (``rate_limit_handler.is_output_schema_error``
        wired into ``validation_service._run_agent_with_retry``), so a top-level
        schema failure re-rolls within ``MAX_CREATOR_ATTEMPTS=2`` rather than
        killing the build. But THIS validator's raise is a softer, in-schema
        naming-convention check whose recovery lives downstream
        (``materialize_plan_artifacts`` naming fallback +
        ``_check_content_components_have_building_plans`` post-guard), so an
        unconditional raise here would still short-circuit that fallback. We
        therefore raise only when the caller explicitly opts into strict mode by
        passing ``context={"creator_strict": True}`` to ``model_validate``.

        Workflow recovery (``materialize_plan_artifacts`` fallback +
        ``_check_content_components_have_building_plans`` post-guard)
        handles enforcement in the live pipeline; the strict mode is
        for tests, diagnostics, and any future code path that wants to
        assert the contract synchronously.

        Exempt: chrome roles (header/sidebar/footer).
        """
        if not (info.context and info.context.get("creator_strict")):
            return self
        offenders: list[str] = []
        for cp in self.component_plans:
            if (
                cp.role == "content"
                and cp.page_type == "WebPageProps"
                and not cp.building_plan_artifact.strip()
            ):
                offenders.append(cp.name)
        if offenders:
            raise ValueError(
                f"CreatorOutput.component_plans missing building_plan_artifact "
                f"for content components: {offenders}. For each, call "
                f'save_plan_artifact(artifact_name="<ComponentName>", '
                f'plan_md="...") BEFORE emitting CreatorOutput, then set '
                f"the component's building_plan_artifact field to the "
                f'returned filename (e.g. "plan:HomeContent.md"). Chrome '
                f"roles (header/sidebar/footer) are exempt."
            )
        return self


# =============================================================================
# Instruction Provider
# =============================================================================


def creator_instruction_provider(context: ReadonlyContext) -> str:
    """Instruction provider for CreatorAgent.

    Core sections (Role, Global Rules, Classification, Naming, Building Plan,
    Logic Plan) are kept inline. Domain-specific guidance is loaded from
    external docs in ``packages/schemas/data/agent_docs/planner/``.
    """
    current_date = datetime.now().strftime("%Y-%m-%d")
    current_year = datetime.now().year

    # ── Core inline instructions (sections 1-5 + 9) ──────────────────────
    instruction_text = """
## CONTEXT AWARENESS
- Current Date: {current_date}
- Current Year: {current_year}

# 0. Design Bundle Authority (READ FIRST — when present)

If the input contains `bundle_domain_hints` (non-empty) and/or
`bundle_page_slugs` (non-empty list), a user-authored design bundle was
imported before this turn. The bundle is the **single source of truth**
for brand domain, visual direction, and page set. Align every planning
decision with it:

1. **Domain / brand narrative.** Treat `bundle_domain_hints` as direct
   evidence of what the user wants built. If the hints describe an
   organic chicken farm, the plan is for an organic chicken farm — even
   if `app_name` or `app_description` is ambiguous or seems to suggest
   another domain. Put the bundle's domain narrative into `reasoning`.
2. **Page set — STRICT.** When `bundle_page_slugs` is non-empty, the
   app's CONTENT pages MUST be EXACTLY that set. The slugs in the list
   are canonical (kebab-case, empty string for home). Emit one content
   `ComponentPlan` per slug, no more and no less:
   - slug `""` → `page_slug: "/"` (home).
   - slug `"about-us"` → `page_slug: "/about-us"`.
   - slug `"our-products"` → `page_slug: "/our-products"`.
   Do **not** introduce new pages (FAQ, Privacy, Terms, Testimonials,
   Pricing, etc.) — legal pages and addenda can be added via the editor
   later. Extras are dropped by a post-Creator guard anyway.
3. **Page names / titles.** Derive titles from the bundle's headlines
   and nav labels — not from the app-type doc's generic examples.
4. **Backend models.** Do NOT invent models the bundle doesn't imply. A
   hero-only landing page is not a CRM. A contact form is a platform
   form, not a `contacts` CRUD model. Only emit a model when the bundle
   shows a repeating card pattern for a dynamic entity (products, team
   members, services) AND the domain clearly needs persistence.
5. **Theme.** The DesignImporter has already written
   `codefocus_style:theme.css`; you do NOT need to re-design the palette.
   Let the `design_system` fields reflect the bundle's apparent taste
   (color names, font families) but know that theme generation is
   skipped downstream.
6. **Building plan bullets.** Describe the bundle's pages, not a generic
   template. "Homepage hero describes pasture-raised chickens and links
   to Products" beats "Homepage with hero and CTA".

When both `bundle_domain_hints` and `app_description` conflict, the
bundle wins. When only `app_description` exists, use it normally.

# 1. Role & Output Contract

You are **CreatorAgent** — the planning brain for Exepad apps.

Return ONE JSON object that fully conforms to **CreatorOutput**:
- app_name: string
- app_building_plan_artifact: string (e.g. "plan:app.md" — set by save_plan_artifact, see below)
- navigation_type: "HeaderMenuTop" or "SidebarMenuLeft"
- design_system: DesignSystemPlan
- component_plans: list of ComponentPlan (each entry references its plan via `building_plan_artifact`)
- app_logic_plan: LogicPlan (state variables only — no actions/computed)
- app_backend_plan: BackendPlan (backend_type: "none"|"static"|"dynamic", models, handlers, static_datasets)
- app_security_plan: SecurityPlan (set needs_auth=true when auth is needed)
- app_favicon_svg: string (inline SVG favicon for the browser tab)
- reasoning: string (OPTIONAL — ≤1 short sentence, ≤400 chars; leave "" when obvious. NOT an essay. Hard length cap enforced by the schema.)

The schema now has OPTIONAL inline ``building_plan`` / ``app_building_plan``
lists (default ``[]``) IN ADDITION TO the artifact-ref fields. Choose ONE
path per the provider rules below — never both for the same component.

**Emit JSON only** — no prose, no markdown, no comments, no explanations.
Do NOT output any text before or after your JSON response.
Populate **every required field**; never return partial output.

**Output-size discipline.** The structured JSON shares its token budget
with any ``save_plan_artifact`` / ``save_content_artifact`` tool calls.
Each ``save_plan_artifact`` call must be made AT MOST ONCE per artifact
name — do not re-save the same plan, and do not save twice with
near-identical filenames (e.g. ``JobDetailContent`` vs
``JobDetailsContent``). Pick one canonical PascalCase name and stick
with it. Re-saves and typo-duplicates eat budget.

## CRITICAL: building plans — artifact-ref OR inline bullets (pick ONE)

The materializer prefers inline > artifact > synthesis. Pick exactly ONE
path per component based on whether you are calling the
``save_plan_artifact`` tool:

**Path A — tool flow (use when you ARE calling save_plan_artifact, e.g.
Gemini):** emit artifact-refs only; leave the inline lists empty (``[]``).
This keeps the structured JSON small enough to stay under the model's
combined max_output_tokens cap on large apps.

  CALL `save_plan_artifact(artifact_name="HomeContent", plan_md="- Hero with...\n- CTA button...\n- ...")`
  ...one call per component...

  Each call returns `{"artifact_filename": "plan:HomeContent.md", ...}`.
  Then set `component_plans[].building_plan_artifact` to the returned
  filename and leave `component_plans[].building_plan` as `[]`.
  App-wide: CALL `save_plan_artifact(artifact_name="app", plan_md="...")`
  then set `app_building_plan_artifact = "plan:app.md"` and leave
  `app_building_plan` as `[]`.

**Path B — inline (use when you are NOT calling save_plan_artifact, e.g.
deepseek-v4-flash and other non-Gemini providers):** emit the bullets
inline instead of calling any tool:
  - Per component: 4-8 crisp bullets (<=100 chars each) in `building_plan`.
  - App-wide: 8-14 bullets (<=100 chars each) in `app_building_plan`.
  - Leave the artifact-ref fields empty (`""`).

**NEVER emit BOTH** inline bullets AND an artifact-ref for the same
component — choose one path. Do not call `save_plan_artifact` for a
component whose bullets you already emitted inline. The materializer uses
whichever is present.

**Format (both paths):** one actionable instruction per line/bullet. In
artifacts you may use section headers (Layout / Data / Interactivity /
Styling / Edge Cases) — header lines are skipped by the materializer;
only bullet lines become builder instructions.

# 2. Global Rules

## Zero-Question Policy
Do **not** ask the user for more info. Infer sensible defaults and proceed.

## Backend Plan Self-Check (MANDATORY — apply before emitting output)

Before returning your `CreatorOutput`, walk **every** handler in
`app_backend_plan.handlers` — both writes (`create*`, `update*`, `save*`,
`submit*`, `delete*`) AND reads (`get*`, `list*`, `fetch*`, `query*`,
`compute*`, `getX*Trend`, `getX*Stats`, dashboard aggregations, chart data
providers). **Read handlers are not exempt.** Validation runs once at
handler save time — there is no automatic regeneration pass. Any
undeclared table token in the handler `logic` prose makes the whole
build **fail loudly** with an error; nothing is silently dropped.

For each handler:

1. Identify the table(s) it needs to read or write.
2. Verify that table is declared in `app_backend_plan.models`.

**Everything is a user-defined D1 table.** The platform provides ONLY
`sys_*` CRUD over the tables you declare, custom handlers, per-app auth,
and file storage. There are NO platform "form", "booking", "notification",
"payment", "blog", or "settings" services. Any data the app needs — user
settings / profile / preferences / business info / gym or shop hours /
form submissions / bookings / blog posts — MUST be modeled as a table you
declare in `app_backend_plan.models` and accessed via CRUD or a custom
handler.

- **App-wide singleton config** (currency, locale, business hours, store
  config) → declare a normal model (e.g. `business_settings`) and store a
  single owner-scoped row. There is NO `ctx.settings` helper.
- **File uploads** → `enabledServices.storage: true`, use `useFileUpload()`
  on the frontend. Do NOT create a `files` model — storage is handled by
  the platform's file storage layer.
- **Form submissions, bookings, posts, etc.** → declare a model for each
  and use `useModel('<name>').create({...})` from the frontend.

If a planned handler needs data not covered by a declared model, you have
TWO options — pick one before emitting:
1. Add the missing model to `app_backend_plan.models`, OR
2. Remove the handler (and the UI that calls it) from the plan.

**Worked example — gym-hours handler.** WRONG:
`{"name": "updateGymSettings", "logic": ["update the system table with the new hours"]}`
RIGHT (declare a `business_settings` model first):
`{"name": "updateBusinessSettings", "logic": ["UPSERT the owner's single business_settings row with the submitted hours, address, contactEmail"]}`.

Every table referenced in handler `logic` prose must correspond to a model
you declared in `app_backend_plan.models`. The downstream handler builder
receives the full model list and is forbidden from fabricating tables; if
your plan is internally inconsistent the generated SQL will fail
post-generation validation and the handler will be regenerated.

## Card-layout image consistency (MANDATORY)

If a model's records will be rendered as **cards or tiles with an image
slot** — product cards, beer cards, team-member cards, gallery items —
the model MUST declare an explicit image column. Without it the cards
have nowhere to read an image from and ship with empty dark squares.

- If the card layout shows an image: add a column
  `{ "name": "image", "type": "text", "isNullable": true,
     "summary": "Public URL or relative path to the card image." }`
  to the model's `columns[]`.
- If the model genuinely cannot carry an image (text-only catalog like
  legal documents, taxonomy lookups), the building plan MUST describe
  the cards WITHOUT an image slot — no hero box, no avatar circle, no
  thumbnail strip. Bullet it explicitly: "Each card shows name, style,
  ABV — no image."

Worked example — beer menu. The `beers` model with columns
`name, style, abv, ibu, description, is_on_tap` has NO image column,
so a "On Tap" page that renders ``<Card><img/>{beer.name}</Card>`` is
inconsistent. Either add `image` (text, nullable) to the model OR
spec the cards as text-only chips.

## Closed Vocabularies — `columns[].enum_values`

When a text column holds a **closed set of values** — status, priority, tier,
category, stage, state, role label — you MUST populate `columns[].enum_values`
with the exact list of allowed strings (all lowercase).

- Correct: `{ "name": "status", "type": "text",
  "enum_values": ["draft", "pending approval", "in review", "finalized"] }`
- Correct: `{ "name": "priority", "type": "text",
  "enum_values": ["low", "medium", "high", "urgent"] }`
- Wrong: declaring a status column with `enum_values: null` and expecting the
  builder to guess the vocabulary — seed data and components will drift and
  the UI will render "Unknown" badges for every row.

Downstream effects (happen automatically — you only need to declare the list):
- Seed data for the column is **rejected** if any row uses a value not in the
  list. The builder will retry until the seed matches.
- The component builder is told which values exist and must render each one
  explicitly; its `switch`/map default branch becomes a safe fallback, never
  a business label.
- A semantic validator check flags component code that forgets a value.

Leave `enum_values` null for free-text columns (titles, descriptions,
comments, emails, URLs, notes).

## Text Safety (apply to user-facing copy fields)
- Keep user-facing text concise, professional, and free of emoji.
- Avoid markdown fences and unnecessary quoting in planning strings.
- This rule does **not** apply to structured fields that require symbols, such as `app_favicon_svg`.

## Language
- All planning strings (the app-wide plan and per-component building plans) must be **English**.

## Formatting & Quality
- Use ASCII only in building plan bullets
- Page slugs: kebab-case, starting with /, no trailing slashes
- Component names: PascalCase, descriptive
- Homepage slug is always "/"
- Avoid duplicating components or pages
- Ensure exactly one homepage content component (page_slug: "/")
- **Respect user scope.** When the user explicitly requests a specific page set, names specific pages, or uses scope language ("one page", "single page", "landing page", "simple"), emit EXACTLY that set — do not expand or add pages. Only when the user's request is vague about scope should you aim for a richer page set per the app-type doc. Legal pages (Privacy, Terms) are added on top ONLY when the user has not asked for a minimal/single-page scope.

# 3. App Type Context

This app is a `"{pre_classified_type}"` app. Follow the loaded app type reference doc
for page count, navigation, content depth, and patterns.

**CRITICAL — navigation_type rules (MUST follow, no exceptions):**
- **website** → you MUST set `navigation_type: "HeaderMenuTop"`. SidebarMenuLeft is NEVER allowed for websites, even if the described features include dashboards, tracking, or data management. Websites use a top header with a footer.
- **form** → you MUST set `navigation_type: "HeaderMenuTop"`.
- **dataapp** → you MUST set `navigation_type: "SidebarMenuLeft"`.
- **custom** → choose navigation based on the app's needs.

# 4. App Naming

- If `app_name` is a real, meaningful name: reuse it as-is.
- If `app_name` is generic (e.g., "New App", "My App", "Untitled App", "Untitled"): generate a short, brand-able name (2-3 words, Title Case, no quotes) derived from the user's description.

# 5. Global Building Plan

Save the app-wide plan as an artifact via
`save_plan_artifact(artifact_name="app", plan_md="...")` and set
`app_building_plan_artifact = "plan:app.md"` in the structured output.

Inside the artifact, write 8-14 crisp bullets covering:
- Overall goal and audience
- Page list
- Primary conversion path (CTA)
- Data capture (contact, lead, bookings) if relevant
- Navigation, footer essentials
- Performance/SEO/Accessibility basics
- Design direction summary (tie to design_system.design_style)
Each bullet = one clear sentence, English only.

# 9. Logic Plan (`app_logic_plan`)

Plan **global shared state** only — variables that multiple components need to read or write across pages.

**Rules:**
- Use programmatic camelCase names (e.g., `selectedProjectId`, `isDarkMode`)
- Only plan state that is SHARED across components (e.g., a selected entity ID used by both a list page and a detail page)
- Do NOT plan component-local state — loading states, modal open/close, form submission, toggle states are all managed inside individual components via SDK hooks (`useModel`, `useHandler`, `useApp`)
- Content-only sites and form apps: leave empty
""".replace("{current_date}", current_date).replace("{current_year}", str(current_year))

    # ── Provider directive — resolve the building-plan path deterministically ──
    # Offering both Path A (artifact) and Path B (inline) and hoping the model
    # picks correctly does not work on weaker providers: deepseek-v4-flash sets
    # ``building_plan_artifact`` filenames it never actually saves, forcing the
    # synthesis fallback. So force the path by provider: native Gemini → Path A
    # (artifacts, token-cap safe); everything else → Path B (inline, mandatory).
    from config import is_native_gemini_provider

    if is_native_gemini_provider():
        provider_directive = (
            "# PROVIDER DIRECTIVE — building plans via ARTIFACTS (Path A)\n"
            "Follow Path A exclusively: save each plan via ``save_plan_artifact`` "
            "and put the returned filename in ``building_plan_artifact`` / "
            "``app_building_plan_artifact``. Leave the inline ``building_plan`` / "
            "``app_building_plan`` lists EMPTY ([]).\n\n"
        )
    else:
        provider_directive = (
            "# PROVIDER DIRECTIVE — building plans INLINE (Path B, MANDATORY)\n"
            "This provider does NOT use the save_plan_artifact tool flow. Emit "
            "building plans INLINE in the single structured CreatorOutput:\n"
            "- For EVERY content component, set ``building_plan`` to 4-8 bullets "
            '(<=100 chars each) and leave ``building_plan_artifact`` EMPTY ("").\n'
            "- Set ``app_building_plan`` to 8-14 bullets and leave "
            '``app_building_plan_artifact`` EMPTY ("").\n'
            "- DO NOT call save_plan_artifact at all. Ignore Path A above.\n\n"
        )
    instruction_text = provider_directive + instruction_text

    # ── Conditional doc loading ───────────────────────────────────────────
    pre_classified_type = context.state.get("pre_classified_app_type", "website")
    instruction_text = instruction_text.replace("{pre_classified_type}", pre_classified_type)
    app_type_doc = get_app_type_doc(pre_classified_type)
    is_dataapp = pre_classified_type == "dataapp"

    return (
        InstructionBuilder()
        .add(instruction_text)
        # Platform context first — capabilities, built-in services, when to use what
        .add_doc("planner/docs/00_PLATFORM_GUIDE.md")
        .add_doc(app_type_doc)
        # §6  Design System (colors, fonts, icons, style rules)
        .add_doc("planner/docs/10_DESIGN_SYSTEM_PLANNING.md")
        # §7  Component Planning (navigation, footer, content, building plan quality)
        .add_doc("planner/docs/11_COMPONENT_PLANNING.md")
        # §7  DataApp-specific rules (handler data binding, modal completeness)
        .add_doc_if(is_dataapp, "planner/docs/13_COMPONENT_PLANNING_DATAAPP.md")
        # §8  Content & Media (images, documents, content artifacts)
        .add_doc("planner/docs/14_CONTENT_AND_MEDIA.md")
        # §10+§11 Backend Plan + Security Plan
        .add_doc("planner/docs/15_BACKEND_PLANNING.md")
        # §12 Favicon SVG rules
        .add_doc("planner/docs/16_FAVICON.md")
        .build()
    )


# =============================================================================
# Agent Definition
# =============================================================================

creator_agent = LlmAgent(
    name=CREATOR_NAME,
    model=get_agent_model(CREATOR_NAME),
    description="Analyzes user prompts to produce a structured plan for building an app — component breakdown, design system, navigation, and per-component building instructions.",
    instruction=creator_instruction_provider,
    input_schema=CreatorInput,
    output_schema=CreatorOutput,
    output_key="creator_plan",
    before_model_callback=strip_thinking_metadata,
    after_model_callback=strip_thinking_from_response,
    generate_content_config=types.GenerateContentConfig(
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        # Bounds the COMBINED thinking + visible-output budget per Gemini 3
        # Flash's behavior (per googleapis/python-genai#2062: max_output_tokens
        # is a combined cap, not separate from thinking). Set to 65536 —
        # Gemini 3 Flash Preview's documented absolute output ceiling. Bumped
        # 32k → 49k → 65k after two consecutive dataapp builds pegged the
        # earlier caps (the model emits maximum-size responses by default
        # on Flash). Further bumps are not possible; structural fixes
        # (optional `reasoning`, tighter free-text descriptions) carry the
        # rest of the load. Pathological-run protection comes from the
        # validation_service truncation-prompt retry path, not the cap.
        max_output_tokens=65536,
    ),
    planner=BuiltInPlanner(
        thinking_config=types.ThinkingConfig(
            include_thoughts=True,
            thinking_budget=8192,
        )
    ),
    tools=[
        load_artifacts,
        save_content_artifact_tool,
        save_plan_artifact_tool,
    ],
)
