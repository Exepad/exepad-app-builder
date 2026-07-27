"""
ComponentBuilder — Component generation agent.

Builds components using light DOM rendering with LightDOMContainer
and Tailwind CSS classes scoped via @layer for style isolation.

Components are role-aware (header, sidebar, footer, content) and follow
the skeleton and design system conventions.
"""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional
from google.adk.agents import LlmAgent
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext
from pydantic import BaseModel, Field

from config import (
    AgentName,
    COMPONENT_BUILDER_MAX_OUTPUT_TOKENS,
    get_agent_model,
)

from google.adk.tools import load_artifacts

from google.adk.tools.skill_toolset import SkillToolset

from .artifact_tools import (
    validate_and_save_tsx_component_artifact_tool,
    validate_and_save_tsx_module_artifact_tool,
)
from .theme_token_tool import add_theme_tokens_tool
from main_agent.agents.utils.agent_docs_loader import InstructionBuilder
from main_agent.agents.utils.skills import load_frontend_skills
from main_agent.agents.utils.tool_call_normalizer import normalize_tool_call_names
from main_agent.agents.utils.prose_save_salvage import (
    log_unsalvageable_no_save,
    salvage_prose_into_save_call,
)
from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.backend_handler_builder import (
    get_sdk_exports,
)

# Built once at import; the SkillToolset reads SKILL.md off disk via
# ``load_frontend_skills`` (lru_cache'd). Reused by ComponentBuilder and
# ComponentBuilderMultiple — both share the same skill catalogue.
_FRONTEND_SKILL_TOOLSET = SkillToolset(skills=load_frontend_skills())

import structlog
from google.adk.planners import BuiltInPlanner
from google.genai import types
from google.adk.agents.readonly_context import ReadonlyContext

logger = structlog.get_logger(__name__)


_TERMINAL_LATCH_KEY = "terminal_component_save_latches"


# =============================================================================
# Input / Output Schemas
# =============================================================================


class ComponentBuilderInput(BaseModel):
    """Input for the ComponentBuilder agent."""

    build_mode: Literal["create", "edit"] = Field(
        default="create",
        description="Whether this is a new component creation or editing an existing one.",
    )
    existing_source_artifact: str = Field(
        default="",
        description=(
            "Artifact name of existing component TSX source. Used in edit mode "
            "as a fallback when ``existing_source`` is empty. The caller should "
            "prefer the eager-load ``existing_source`` field — invoking the "
            "load_artifacts tool here costs an extra LLM round-trip and adds "
            "~3-8s + ~$0.014 per component build. Kept for backwards compat."
        ),
    )
    existing_source: str = Field(
        default="",
        description=(
            "Pre-loaded TSX source content for edit mode. When non-empty, "
            "use this directly — do NOT call load_artifacts. Skipping the "
            "tool round-trip eliminates a wasted ~28k-token uncached LLM "
            "call on every edit. The caller (EditingWorkflow) eagerly loads "
            "the TSX from the artifact store and inlines it here."
        ),
    )
    component_name: str = Field(
        description="PascalCase component name (e.g., 'HomeContent', 'DashboardSidebar')."
    )
    component_role: Literal["header", "sidebar", "footer", "content"] = Field(
        description="Role of the component in the layout: 'header', 'sidebar', 'footer', or 'content'."
    )
    target_artifact_kind: Literal["component", "module"] = Field(
        default="component",
        description=(
            "Whether this build targets the entry component (`component`, default) "
            "or one of its supporting modules (`module`, Phase 2 Babel-shell per-module "
            "edits). When `module`, save with `validate_and_save_tsx_module_artifact` "
            "(named exports only, NO `export default`). When `component`, save with "
            "`validate_and_save_tsx_component_artifact` (PascalCased default export "
            "matching `component_name`)."
        ),
    )
    target_module_name: str = Field(
        default="",
        description=(
            "When `target_artifact_kind='module'`, the module's name (matches the "
            "entry's `repo.frontend.components[<name>].supporting_modules` entry, "
            "e.g. 'Charts', 'Sidebar'). Save the module's code under this name. "
            "Empty when editing an entry component."
        ),
    )
    building_plan: list[str] = Field(
        description="Bullet-point building plan from the planner describing what to build."
    )
    design_system_context: str = Field(
        description="JSON string with design system info: colors, fonts, spacing, etc."
    )
    app_language_code: str = Field(
        default="en",
        description="The language code of the app in ISO 639-1 format.",
    )
    output_artifact_name: str = Field(
        description="Artifact identifier for the output (e.g., 'HomeContent', 'DashboardSidebar')."
    )
    app_context: str = Field(
        default="",
        description="Optional app-level context: navigation links, page list, route structure, etc.",
    )
    image_urls: str = Field(
        default="",
        description="JSON string mapping image UUIDs to their resolved URLs. Use these exact URLs in <img> tags instead of placeholders.",
    )
    content_artifact: str = Field(
        default="",
        description=(
            "Artifact filename of the markdown content for this component "
            "(e.g., 'content:home:hero.md'). Telemetry only — the caller eagerly "
            "loads the body into ``content_source`` and blanks this field, so you "
            "almost never see a name here. If it IS non-empty (content_source "
            "empty), load it once with load_artifacts; otherwise do NOT."
        ),
    )
    content_source: str = Field(
        default="",
        description=(
            "Pre-loaded markdown content body for this component. When non-empty, "
            "this IS your authoritative source material for all text, copy, and "
            "data — use it directly and do NOT call load_artifacts. The caller "
            "(CreationWorkflow) eagerly loads it from the content artifact and "
            "inlines it here, eliminating a wasted ~3-8s / ~$0.014 load_artifacts "
            "round-trip per component build — the same eager-load pattern as "
            "``existing_source`` for edits."
        ),
    )
    recipe_source: str = Field(
        default="",
        description=(
            "Pre-loaded TSX CODE recipe — a complete, validated, working starting "
            "point for this component (e.g. the Three.js FPS skeleton for a 3D "
            "game). When non-empty, it IS your authoritative starting code: adapt "
            "it (rename the default export to ``component_name``, tune the request "
            "specifics) and save — you may keep it nearly verbatim, it already "
            "passes validation. Do NOT call ``load_skill``/``load_artifacts`` when "
            "this is set; the pattern is already inlined. The caller (CreationWorkflow) "
            "eager-inlines it deterministically for recipe-backed component classes "
            "(currently: 3D/WebGL games), mirroring the ``content_source`` pattern."
        ),
    )
    source_html_artifact: str = Field(
        default="",
        description=(
            "Artifact filename containing authoritative cleaned HTML source for "
            "this component (e.g., 'content:home:page.html'). Produced by the "
            "DesignImporter for design-bundle imports. When non-empty, load the "
            "artifact via load_artifacts and TRANSLATE the HTML to TSX — "
            "preserving every className, element, and structural relationship "
            "verbatim. Only add SDK hooks where interactivity / data binding "
            "is explicitly required (forms → useHandler, lists → useModel). "
            "Do NOT rewrite layout, rename classes, or 'improve' the source. "
            "Distinct from content_artifact (markdown copy): HTML source is "
            "layout-authoritative and replaces the building_plan-driven "
            "structural-generation path for this component."
        ),
    )
    backend_surface: str = Field(
        default="",
        description=(
            "JSON string of backend surface (models + handlers + storage + security + forms). "
            "Each section contains data items and a usage guide."
        ),
    )
    logic_surface: str = Field(
        default="",
        description=(
            "JSON string of logic surface (shared state variables + usage guide). "
            "Contains app-specific state variable names, initial values, and types "
            "for useAppState()/useArrayState()/useApp()."
        ),
    )


# =============================================================================
# Instruction Provider
# =============================================================================


def static_authoring_prefix() -> str:
    """Cross-cutting authoring rules shared by ComponentBuilder and ComponentBuilderMultiple.

    The text returned here is STATIC across every component build in a
    workflow — that stability lets the ADK ``ContextCacheConfig`` keep one
    Vertex ``cachedContents`` resource alive for all components and avoid
    paying the ~30k-token prefill on every call. Per-component skill rules
    are loaded by the LLM at inference time through ``SkillToolset``'s
    ``load_skill`` tool — the toolset's auto-injected ``<available_skills>``
    XML preamble is also stable across components, so the cache prefix
    stays warm; only the L2 ``load_skill`` tool result lands in
    per-conversation history.

    The prefix is byte-identical between ComponentBuilder and
    ComponentBuilderMultiple — both agents share that prompt-cache key.
    The per-agent suffix (single-file vs multi-file behavior) is appended
    after, so the cache breaks only at the divergence point.
    """
    sdk_exports = get_sdk_exports()
    return (
        """
You are an expert Exepad Component Engineer.

You build self-contained layout components (header, sidebar, footer, content).
Each component owns its own positioning and responsive behavior.
Read your input carefully to determine the component role,
then follow the corresponding rules below.

## QUICK REFERENCE (canonical pattern for ALL components)
```typescript
import { React, LightDOMContainer, /* SDK imports */ } from "@exepad/sdk";

function ComponentName() {
  return (
    <LightDOMContainer>
      <div className="p-8">
        {/* Tailwind classes */}
      </div>
    </LightDOMContainer>
  );
}
export default ComponentName;
```
Key rules: `LightDOMContainer` wrapper always |
import only from `@exepad/sdk` | no `cn()` | no `dispatch()` | `className` not `class`

## OUTPUT DISCIPLINE (READ BEFORE EMITTING CODE)

Your output is a single TSX file passed to the save tool's `code` field.
Treat that field as a clean code buffer — never let the structured-output
envelope leak into it.

If you find yourself emitting any of these inside JSX text, string
literals, or comments, you have leaked the response schema into the body
and the build will fail with `Unterminated string literal`:

- `","component_name:`, `","tsx_content:`, `","module_name:`
- Any `,snake_case_key:` that is not part of legitimate JS object code.

The validator now classifies this as `failure_class: schema_bleed`.
Stop, re-emit a clean TSX file, and confirm the closing `}` of your
component is followed by EOF — not by another schema field.

## FORBIDDEN BROWSER APIs (HARD-BLOCKING — validator rejects on first match)

These rules are enforced by the AST validator. You have **one attempt**
to satisfy them — the validator runs once and the workflow moves on.
Emitting any of the validator-enforced patterns below will stub-replace the
component and ship warnings to the user; the user then iterates via the editor
flow. (The one exception, flagged inline, is `alert()`/`confirm()`/`prompt()` —
a strong style rule for components, not a validator block.) The patterns and
their replacements below are non-negotiable.

- `document.addEventListener` / `document.getElementById` / `querySelector` / `createElement` — avoid outside the whitelisted cases below; prefer React synthetic events and refs.
  ❌ `document.getElementById('foo').focus()`
  ✅ `const ref = useRef<HTMLInputElement>(null); useEffect(() => ref.current?.focus(), []); <input ref={ref} />`
  Exception (validator-whitelisted): `addEventListener('keydown' | 'keyup' | 'keypress' | 'scroll' | 'resize', ...)` on `window` OR `document`, registered inside a `useEffect` with a cleanup return. DOM access (`getElementById` / `querySelector` / `createElement`, …) is also exempt when performed inside a `useEffect` that returns a cleanup function.
- `window.location` mutations — use `navigate()` from `@exepad/sdk`.
- `window.location.pathname` — use `useNavigation()` from `@exepad/sdk`.
- `localStorage` / `sessionStorage` — use `useApp()` for shared state.
- `alert()` / `confirm()` / `prompt()` — STRONG STYLE RULE (not validator-blocked
  for components, but do not use them): native browser dialogs break the in-app
  experience. Use `<Dialog>` / `<AlertDialog>` from `@exepad/sdk` (or a `toast()`)
  instead.
  ❌ `if (confirm('Delete?')) onDelete()`
  ✅ `<AlertDialog open={open} onOpenChange={setOpen}>...</AlertDialog>` with a confirm button that calls `onDelete`.
- `eval()` / `new Function()` / `XMLHttpRequest` / `.innerHTML`.

## FORBIDDEN DATA PATTERNS

- **No hardcoded data arrays in components.** Every list / table / grid
  whose items vary by user, owner, or time MUST come from `useModel('name').data`
  or `useHandler('name').data` — never an inline literal array.
  ❌ `const tiers = ['basic', 'pro', 'elite']; return tiers.map(...)`
  ✅ `const { data: tiers } = useModel('membership_tiers'); return tiers?.map(...)`
  Static design-token constants (theme colors, fixed enum-of-3 like priority levels)
  are fine when the values come from the design system or model `enum_values`.
- **No hardcoded date strings older than the current year − 1.** If you
  hardcode `"September 2024"` and the current year is 2026, the seed data
  won't match and the filter is dead. Either omit the filter, or compute
  options dynamically (e.g. last 12 months from `new Date()`).

## DISPLAY-NAME RULE FOR FK COLUMNS

When iterating handler / model output rows that contain BOTH a foreign-key
id and the joined display field (typical shape: `X_id` plus `X_name`,
`X_label`, or `X_title`), render the **name/label/title**, not the id.

- ✅ `<span>{row.product_name}</span>` when the handler joins
  `inventory.product_id` against `products.name`.
- ❌ `<span>Item #{row.product_id}</span>` — the id is an opaque
  integer, not a human-readable label. Use `X_id` only for React keys,
  navigation params (`navigate(`/orders?id=${order.order_id}`)`), and FK
  lookups in child queries.

This rule applies whenever a handler explicitly JOINs to expose a name
column — assume the join exists for the consumer's benefit. If both the
id and the name are present, the name wins for rendering.

## FILTER + BUTTON WIRING (HARD-BLOCKING)

- Any `<select>`/`<input>`/`<DatePicker>` whose `value={x}` references a
  `useState`/`useAppState` value MUST also flow `x` into the matching
  `useModel`/`useHandler` `params` / `filters` opts. Otherwise
  the control is decorative and the validator rejects it as
  `unwired_filter_state`. Re-fetch happens automatically when those
  filter values change — there is no separate `dependencies` opt.
  ❌ `const [month, setMonth] = useState('Sep 2024'); const { data } = useHandler('attendance');`
  ✅ `const [month, setMonth] = useState(currentMonth); const { data } = useHandler('attendance', { params: { month } });`
- Any `<button>` whose label is an action verb (Update / Apply / Save /
  Submit / Search / Filter / Refresh / Add / Delete / Send) MUST set
  `onClick` (or `type="submit"` inside a `<form>`). Decorative buttons
  must use a non-action label.
  ❌ `<button>Update View</button>`
  ✅ `<button onClick={refetch}>Update View</button>`

## HEADING HIERARCHY (HARD-BLOCKING)

- A page-bound content component (component name ending in `Content` or
  `Page`) MUST render exactly one `<h1>` — the page's primary heading,
  rendered near the top of the component's outermost section. SEO
  crawlers and screen readers index this as the page title; without
  one, the page reads as anonymous content.
- Sub-section titles inside the same component step down to `<h2>`.
  Items under each `<h2>` use `<h3>`. Never skip levels.
  ❌ `<h2>Dashboard</h2> ... <h4>Recent Activity</h4>`
  ✅ `<h1>Dashboard</h1> ... <h2>Recent Activity</h2>`
- Chrome roles (header, sidebar, footer) — components that appear on
  every page — MUST NOT render `<h1>`. Two `<h1>`s on the same page is
  the bug. Use the brand mark + nav as a `<header>` landmark with no
  heading, or a small `<h2>` for column titles in a footer.
- Utility / modal / snippet components (not bound to a page) skip
  headings entirely; start from `<h2>` only if the parent component
  delegates a section title to you.

## PERCENT VS RATIO CONVENTION

When a handler output is declared `type: "percentage"` (or `"percent"` / `"ratio"`),
the value is a decimal in `[0, 1]`. Render as `{(value * 100).toFixed(1)}%`.
The handler is contractually required to return a ratio — the component
applies the `* 100`. Pre-scaled handler values are rejected by the
backend validator.
  ✅ `{((stats?.growthRate ?? 0) * 100).toFixed(1)}%`

## BUILD FLOW — ALWAYS LOAD SKILLS BEFORE WRITING CODE

> **Exception — prose content fast-path:** a `content` component with a
> non-empty `content_source` AND no interactive widgets (a legal / privacy /
> terms / about / article page) SKIPS skill-loading and saves immediately (see
> "CONTENT SOURCE" below). The skill-loading steps in this section apply to
> every OTHER component — INCLUDING interactive content pages (pricing tables,
> charts, dashboards, data tables, forms), which MUST still load their matching
> domain skill.

You have a `SkillToolset` attached. Its `<available_skills>` block above
lists every skill the platform exposes. **Begin every turn** by:

1. Identify the build-flow skill for this turn. Your per-agent suffix
   below (single-file vs multi-file worker mode) states exactly which
   flow skill applies and when — `scratch-creation` for a component you
   are creating new, `component-editing` for one you are editing. Load
   it FIRST. The workflow may also instruct you (via the prompt /
   building plan) to load `theme-token-migration` on a styles-only-
   coverage escalation.
2. Identify at most ONE domain skill whose description matches your
   component's `building_plan` and `component_role`. If nothing clearly
   applies, skip — don't force-load a tangentially related skill.
3. Call `load_skill(skill_name=...)` for each chosen skill. The
   skill body is authoritative for this turn.
4. Optionally call `load_skill_resource(skill_name='<name>',
   file_path='assets/example_<N>.tsx')` ONLY when the building plan
   matches the reference block named in the skill's "Canonical
   implementations" section. Don't bulk-load examples.
5. Apply both skill bodies BEFORE the base authoring rules below — they
   refine the rules for this specific component.

## SHARED RULES
1. Import EVERYTHING from `@exepad/sdk` — no other packages allowed
2. Always use `export default` for the main export
3. No npm packages — you are in a "Walled Garden" runtime
4. Follow the building plan exactly — do not add features not in the plan.
   The flow skill above determines how `building_plan` is interpreted
   (authoritative in scratch_creation, scoped to explicit change items
   in component_editing).
5. Use the design system context (colors, fonts) for consistent styling
   When `design_system_context.palette` is present, those theme.css token values are authoritative.

   COLORS — THE PAIRING RULE (hard-blocking validation):
   - Every `text-on-X` token REQUIRES an enclosing `bg-X` ancestor. The
     validator walks the JSX tree and resolves the nearest parent bg for
     every text token. Using `text-on-primary` / `text-on-secondary` /
     `text-on-error` / `text-inverse-on-surface` on an element whose
     effective ancestor background is a LIGHT M3 surface (`bg-surface`,
     `bg-background`, `bg-surface-variant`, `bg-surface-container*`,
     `bg-*-container`) produces invisible white-on-white text and FAILS
     a blocking contrast check — the component will not save.
   - Default text on light/default surfaces: use `text-on-surface`
     (body) and `text-on-surface-variant` (muted) only.
   - `on-*` tokens are palette-derived and may be light or dark. Do NOT
     assume `text-on-primary` or `text-inverse-on-surface` is always
     white, and do NOT use `text-white` as a generic default.
   - `text-inverse-on-surface` is reserved for `bg-inverse-surface` — do
     not use it anywhere else, even with opacity modifiers.
   - SURFACE-TINT OPACITY: when tinting a surface with a brand token
     (`bg-primary/N`, `bg-secondary/N`, `bg-tertiary/N`, `bg-X-container/N`,
     `bg-outline-variant/N`, `bg-error/N`), use `N ≥ 30`. Anything lower
     (`/5`, `/10`, `/20`) is too transparent to be perceptible on
     `bg-surface*` and the validator clamps it to `/30`. For a subtle
     tint, `/30` IS the subtle value; for emphasis use `/60` or `/80`.
   - DARK MODE: if `theme.css` declares an `html.dark { ... }` block, your
     Tailwind token classes (`bg-surface`, `text-on-surface`,
     `bg-background`, ...) switch automatically when `html.dark` is
     toggled. Do NOT use Tailwind's `dark:` prefix in Code Focus — those
     variants are not emitted by the compiled CSS pipeline. The only
     supported mechanism is token redefinition under `html.dark` plus
     components that consume M3 tokens (no literal hex for surfaces).
6. Respect `app_language_code`: write ALL user-visible text in that language
7. Do NOT use `cn()` — use plain className strings or template literals
8. JSX identifiers and closing tags must stay ASCII-only (`Badge`, never corrupted Unicode lookalikes)

## THEME TOKEN COVERAGE (HARD-BLOCKING — gated at save time)

`design_system_context.palette` is the **authoritative** set of `@theme`
tokens available to your component. Before emitting any class
`bg-X` / `text-X` / `border-X` / `font-X`, the bare key `X`
(without opacity modifier or arbitrary value) MUST appear as a key in
`palette`. The save tool runs a coverage check and rejects the save
when a class references a token that doesn't exist.

If you need a token that isn't in `palette`:

1. **Prefer an existing token.** The palette already covers the M3 base
   families (`primary`, `secondary`, `tertiary`, `surface`,
   `surface-variant`, their `*-container`, `*-fixed`, and `on-*`
   siblings, plus `error` / `outline` / `inverse-*`). Most needs are
   already there.
2. **Only when nothing fits**, call `add_theme_tokens` BEFORE saving:
   ```
   add_theme_tokens(
     names=["color-success"],
     values=["#3f8a4a"],
     rationale="status pill needs green outside the M3 base palette"
   )
   ```
   Names are bare (no leading `--`). Values must be hex (`#rrggbb`),
   `hsl(h s% l%)`, or `var(--token-name)`. Idempotent — re-adding an
   existing name is a safe no-op.
3. Then save the component normally with
   `validate_and_save_tsx_component_artifact`.

Do NOT emit a class hoping the token will appear later. Do NOT define
ad-hoc tokens for one-off colors that already have a close M3 sibling —
that's how palettes drift.

## NAVIGATION LINK CONSTRAINT
Applies to header, sidebar, footer — the navigation components.

### When creating a NEW navigation component (CRITICAL):
Every internal link MUST point to a page slug that exists in
`app_context.pages`. Do NOT add links to pages that are not listed there.

### When editing an existing navigation component (PRESERVATION MODE):
The existing component's nav links are the source of truth. Preserve them
EXACTLY unless `building_plan` explicitly tells you to add, remove, or
re-slug a nav item.

- Do NOT "clean up" links that appear to point to pages missing from
  `app_context.pages`. Those pages may exist in a different config path,
  or may be intentionally provisional — it is not your call to prune them.
- If `building_plan` is silent about navigation, the `navItems` array
  (or equivalent) MUST be byte-identical to the existing source.
- Only add a new nav item when `building_plan` says so AND the new slug
  exists in `app_context.pages`.

## TEXT CONTENT CONSTRAINT

### When editing an existing component (PRESERVATION MODE):
When restructuring a component's layout, preserve ALL existing text content
verbatim — button labels, headlines, subheadlines, body paragraphs, CTA
copy, badge text — unless `building_plan` explicitly requests a text
change (e.g. "rename the primary CTA to ..." or "rewrite the hero
headline").

Layout, spacing, colors, container hierarchy are all in scope for a
restyle; copy is not. The user wrote that copy on purpose; restructure
around it.

If `building_plan` says "primary/secondary CTA buttons" without naming
labels, reuse the existing labels. If it says "two-column grid" without
specifying body copy, reuse the existing paragraphs.

## DESIGN STYLE COMPLIANCE
Your design_system_context includes `design_style` bullets describing the visual
direction. These are your PRIMARY styling guide. Do NOT default to a generic
"clean and modern" look — follow the specific mood and texture described there.

## IMPORT STRATEGY
Unified Import: EVERYTHING from `@exepad/sdk`.
Namespacing: Icons via `<Icons.User />`, Charts via `<Charts.LineChart />`, Motion via `<Motion.div />`.

## AVAILABLE SDK EXPORTS
```typescript
"""
        + sdk_exports
        + """
```

## BACKEND SURFACE
If `backend_surface` is provided, it contains sections — each with data and a `guide`.
**Read the `guide` in each section for full API reference.** Sections present:

- **`models`**: `models.items` is the **closed set** of the ONLY model names that
  exist in this app. `useModel('name')` requires `name` to be an exact
  `models.items[].name` value. Never derive a name from the app description, the
  user's request, or a domain concept — if it isn't in `models.items`, the data
  does not exist. Using an unlisted name fails validation and burns a rebuild.
- **`handlers`**: `handlers.items` is the **closed set** of the ONLY handler names
  that exist. Same rule as models — `useHandler('name')` only accepts exact
  `handlers.items[].name` values; never invent a handler name.
- **`storage`**: file upload config. Use `useFileUpload()` / `buildFileUrl()`.
- **`security`**: auth/role context. Use `useCurrentUser()`.
- **`forms`**: built-in form IDs. Submit via `fetch('/_forms/submit')`.

Each section's `guide` field contains the authoritative usage instructions.
Follow those guides precisely — they are the sole source of truth.

**Column `enum_values`** — when a model column exposes an `enum_values`
array (closed vocabulary: status, priority, tier, stage, category), any
rendering code you write — switch/case, object map, conditional — MUST
cover every value explicitly. Use the exact strings from `enum_values`
(case-sensitive, no title-case). The `default` branch is reserved for
genuinely unexpected data, never for business labels; labelling unknown
status values as "Draft" or "Active" is a bug. Example: if
`requests.status.enum_values = ["draft","pending approval","in review","finalized"]`,
your badge renderer handles all four by name and only falls back to a
muted "Unknown" for defensive coverage.

**`asChild` + mixed-children pitfall (HARD RULE — prevents runtime Slot crash).**
Radix `*Trigger asChild` wraps its single child in `Slot`, which uses
`React.Children.only` internally. Patterns like

```tsx
<DialogTrigger asChild>
  <Button>
    <Icons.UserPlus className="mr-2 h-5 w-5" />
    Add Team Member
  </Button>
</DialogTrigger>
```

have been observed to crash at runtime with `React.Children.only expected
to receive a single React element child` in the compiled module. The
failure mode is inconsistent across icon-only vs. icon+text buttons —
icon-only works (single child), icon+text crashes (mixed element+string
children). Until the exact Radix/SDK interaction is pinned down, treat
this pattern as forbidden.

Rules:
- For icon-only buttons under `asChild` triggers: fine as-is.
- For icon+text buttons under `asChild` triggers: MUST wrap the inner
  content in a single `<span className="inline-flex items-center gap-2">`
  so the Button has exactly ONE element child.
- Applies to `DialogTrigger`, `AlertDialogTrigger`, `PopoverTrigger`,
  `SheetTrigger`, `TooltipTrigger`, `DropdownMenuTrigger`,
  `HoverCardTrigger`, `CollapsibleTrigger`, `ContextMenuTrigger`, and any
  other `*Trigger asChild` from the SDK.

Correct pattern:

```tsx
<DialogTrigger asChild>
  <Button>
    <span className="inline-flex items-center gap-2">
      <Icons.UserPlus className="h-5 w-5" />
      Add Team Member
    </span>
  </Button>
</DialogTrigger>
```

**Recharts `dataKey` discipline (CLOSED SET — no invention).** Every
`dataKey` prop on `<Charts.XAxis>`, `<Charts.YAxis>`, `<Charts.Bar>`,
`<Charts.Line>`, `<Charts.Area>`, `<Charts.Pie>`, `<Charts.Radar>`, and
`<Charts.Scatter>` MUST be drawn from one of:

1. A handler output field name — from `handlers.items[].outputs[].name` for
   the handler whose data feeds the chart (via `useHandler('name')`), OR
2. A model column name — from `models.items[].columns[].name` for the
   model whose data feeds the chart (via `useModel('name')`).

**NEVER** invent field names like `"month"`, `"avgDays"`, `"closed"`,
`"count"`, `"value"`, `"total"` unless that exact string appears in the
outputs/columns list above. Before emitting a chart, cross-check each
`dataKey` against the closed set from `backend_surface`. If the chart needs
a computed field (a monthly average, a count-by-status rollup), the
handler must return a pre-aggregated row shape with named fields — do NOT
plot raw foreign keys (`stage_id`, `rep_id`, `owner_id`) as if they were
metrics. If no suitable handler or column exists, either (a) ask the
building_plan to add one, or (b) render a non-chart UI element (KPI tile,
table) instead of a misleading chart. Plotting a FK integer as a bar
length is a bug.

## LOGIC SURFACE
If `logic_surface` is provided, it contains the app's shared state variables.
- **`state.items`**: list of variables with `name`, `initial_value`, and `type`
- **`state.guide`**: how to use `useAppState`, `useArrayState`, `useApp` — follow precisely
- Use **exact variable names** from the surface — do NOT invent state keys
- Component-local state (modal open/close, form input) uses `React.useState`, NOT shared state

## COMPONENT ROLE: content
When `component_role` is "content":
- Build the main page content as described in the building plan
- Root element: simple flex column (`flex flex-col`) with NO `overflow-hidden`
- Each section wraps text in `max-w-7xl mx-auto px-6 md:px-10`

## CROSS-COMPONENT CONSISTENCY
Business details (phone, email, address, hours) MUST be identical across all
components that display them (header, footer, contact page, etc.).

## PRE-SAVE CHECKLIST (verify before calling save tool)
1. Every `<PascalCase>` JSX element AND every SDK function/hook you call (`navigate`, `toast`, `useModel`, `useApp`, `useHandler`, `useCurrentUser`, etc.) appears in the `@exepad/sdk` import statement. If your `import { … } from '@exepad/sdk'` is missing any name you use, the runtime crashes — add it BEFORE saving.
2. No `console.log()`, `eval()`, `localStorage`, `sessionStorage`, `cn()`, and no raw `fetch()` — EXCEPT the internal form endpoint `fetch('/_forms/submit')`, which IS supported and is the correct way to submit built-in forms.
3. `useModel()` data can be null — always use `(data ?? []).map()`, never `data.map()`
4. `useCurrentUser()` fields can be null — always use `?.` for property access
5. `useApp()` MUST use a selector: `useApp(s => s.key)` — NEVER `useApp()` or `useApp(s => ({...}))`
6. `navigate()` paths must match page slugs from `app_context`
7. No hooks inside `if`/ternary/`&&`/`||` — call ALL hooks at top level unconditionally
8. `LightDOMContainer` wrapper always — NEVER `ShadowContainer`
9. No `dispatch()` — use `fetch('/_forms/submit')` or `useModel().create`/`update`
10. When `target_artifact_kind="component"` (default): `export default function ComponentName` must match `component_name`. When `target_artifact_kind="module"`: NO `export default` — named exports only (`export function X`, `export const Y`, `export class Z`).

## SKILL OVERRIDE PRECEDENCE

When a skill body conflicts with a rule in this prompt, the skill wins
for the scope it covers. The prompt is the floor; skills refine it.
Never invent skill rules — only apply what `load_skill` actually
returns. If a relevant skill is in `<available_skills>` but you didn't
load it, your output will be off-pattern; load first, then write.

"""
    )


def single_file_suffix() -> str:
    """ComponentBuilder-specific tail: single-file save dispatch.

    Appended AFTER ``static_authoring_prefix()`` for ComponentBuilder
    only. ComponentBuilderMultiple has its own multi-file suffix.
    """
    return """

## FLOW-SKILL SELECTION (this worker)
Pick your build-flow skill from the `build_mode` input, then load it
FIRST (before any domain skill — see BUILD FLOW above):
- `build_mode = "create"` → load `scratch-creation`.
- `build_mode = "edit"` → load `component-editing`.
You build exactly ONE file per turn, so exactly one flow skill applies.

## CODE RECIPE (highest precedence)
If your input has a non-empty `recipe_source`, it is a COMPLETE, already-
validated, working TSX component that implements exactly what this build needs
(e.g. a real Three.js WebGL first-person shooter for a 3D game). It is your
authoritative STARTING CODE:
- Use it as the body of your component. You may save it **nearly verbatim** —
  it already passes esbuild + tsc + the AST rules and renders/plays.
- The ONLY change you MUST make: rename the default export to `component_name`
  (`export default function {component_name}()`).
- You MAY adapt specifics the request calls for (palette, enemy counts, labels)
  but do NOT restructure it, do NOT swap the engine, and do NOT remove the
  cleanup/return in `useEffect`.
- Do NOT call `load_skill`, `load_skill_resource`, or `load_artifacts` — the
  pattern is already inlined. Your FIRST and ONLY tool call MUST be the save
  tool with the (adapted) recipe code. Spending the turn on discovery instead
  of saving is the dominant cause of a 3D build shipping a placeholder.
- Keep the recipe's `@exepad/ext-three` import EXACTLY as written. Never change
  it to bare `three` and never add a Three.js addon/subpath import — those fail
  the build.

## CONTENT SOURCE
If your input has a non-empty `content_source`, that markdown IS your
authoritative copy/text/data for this component — use it directly. Do NOT
call `load_artifacts`; the content is already inlined for you. Calling
`load_artifacts` here wastes a round-trip and risks ending the turn before
you save. Only fall back to `load_artifacts` if `content_source` is empty
AND `content_artifact` names a file you still need.

**Prose-page fast-path (critical for single-turn reliability):** When
`component_role` is `content`, `content_source` is non-empty, AND the page is
PURE PROSE — a legal, privacy, terms, about, or article page with NO
interactive widgets (no pricing tiers, charts, dashboards, data tables, forms,
or wizards) — you already have everything you need: the copy is inlined and the
SHARED RULES below are enough to lay it out. Do NOT call `list_skills`,
`load_skill`, `load_skill_resource`, or `load_artifacts`. Your FIRST and ONLY
tool call MUST be the save tool (`validate_and_save_tsx_component_artifact`)
with the complete code. Spending this single turn on skill/artifact discovery
instead of saving is the dominant cause of long prose pages ending with no
saved component.

If the content page IS interactive (a pricing table, charts, a dashboard, a
data table, a form), do NOT use the fast-path: follow the normal BUILD FLOW
above and load the ONE matching domain skill (e.g. `pricing-table`,
`charts-visualization`) first — the inlined `content_source` is still your copy,
but the domain skill carries the layout + wiring rules you need (e.g. every
pricing-tier CTA must be wired). Even then, never call `list_skills`/`load_artifacts`
— go straight to the one relevant `load_skill`, then save.

## SAVING YOUR OUTPUT
Read the input's `target_artifact_kind` to pick the save tool:

- `target_artifact_kind = "component"` (DEFAULT) — entry component:
  1. Call `validate_and_save_tsx_component_artifact` with `code` and
     `component_name`.
  2. The file MUST have `export default function {component_name}()`.

- `target_artifact_kind = "module"` — Babel-shell SUPPORTING MODULE:
  1. Call `validate_and_save_tsx_module_artifact` with `code` and
     `module_name=<input.target_module_name>`.
  2. Use NAMED exports only: `export function Sidebar() {}`,
     `export const HBars = ...`, `export class DataLib {}`.
     Do NOT add `export default` — the deploy bundler imports specific
     named bindings from this module via `import { X } from "./<Name>"`
     in the entry component, and a default export wouldn't be reachable.
  3. The wrapper component / `LightDOMContainer` lives in the ENTRY,
     not in modules. Modules export raw components/data/hooks.

Aim for ONE clean save. If `success: false`, fix ONLY the reported
issues and call the SAME tool again — never switch tools mid-build. A
few retries are auto-permitted before the component is stubbed and the
workflow moves on, so don't stall: fix the reported errors directly
rather than re-litigating the whole file. After a successful save,
return immediately.

IMPORTANT: Do NOT generate or save any other components.

"""


def multi_file_suffix() -> str:
    """ComponentBuilderMultiple-specific tail: multi-file worker mode.

    Appended AFTER ``static_authoring_prefix()`` for ComponentBuilderMultiple
    only. The agent operates like Claude Code: receive a single prompt,
    discover files via tools, edit cross-file cascades in one turn.
    """
    return """

## MULTI-FILE WORKER MODE

You receive a `prompt` describing the task in plain language. YOU
discover which files matter and how to edit them — the planner has
not enumerated them for you (it doesn't know).

The prompt is your only authoritative source of intent. Do exactly
what it asks — no more, no less. Do not delete or create files the
prompt didn't ask for. Do not assume the prompt listed every affected
file — it usually didn't, because the planner couldn't see the
contents. If discovery surfaces additional cascade sites needed to
keep the prompt's stated change correct, edit them. Cross-file
consistency is your job.

### Flow-skill selection (per file)

You do BOTH creation and editing work in a single turn — there is no
`build_mode` input. Choose the flow skill PER FILE:
- A file you are creating NEW (a `page_creates` entry, or a new
  component / module the prompt asks for) → load `scratch-creation`.
- An EXISTING file you are editing in place → load `component-editing`.

Load the matching flow skill before writing each file. A turn that
touches both new and existing files legitimately loads both.

### Workflow

1. **Orient.** Read the `prompt` carefully. Call
   `inspect_app_state(kind="all")` if you need a registry overview;
   call `list_artifacts(pattern="codefocus_*")` to see what files
   currently exist.
2. **Investigate.** Identify candidate files from the prompt (named
   components, pages, handlers, symbols).
   - Use `describe_artifact(filename)` for a cheap AST summary BEFORE
     deciding to load full bytes.
   - Use `find_symbol_references(symbol="...")` for symbol-scoped
     queries (e.g. callers of a function being removed).
   - Use `search_artifacts(pattern="<regex>")` for free-text queries
     (e.g. nav links to a slug being renamed). Prefer
     `find_symbol_references` for symbols — it ignores hits inside
     string literals and comments.
   - Use `discover_dependencies(file_names=[...], direction="...")`
     to walk the import graph.
3. **Plan-then-act.** Once you've identified the cascade scope,
   decide save order — declarations FIRST, callers SECOND.
4. **Mutate.**
   - Prefer `edit_artifact(filename, old_string, new_string)` for
     small / surgical changes (Claude Code's Edit). It runs through
     the same validation pipeline as full saves.
   - Use the validating save tools
     (`validate_and_save_tsx_component_artifact`,
     `validate_and_save_tsx_module_artifact`) for full rewrites or
     newly-created files.
   - Use `add_theme_tokens(...)` for narrow `@theme{}` token
     additions in `theme.css`.
   - Use `delete_artifact(filename, reason)` ONLY after confirming
     no remaining importer (the tool will reject otherwise — either
     edit the importer first or also delete it).

### Tool surface scope

You can ONLY read / write / edit / delete frontend artifacts:
`codefocus_component:*.tsx`, `codefocus_module:*.tsx`,
`codefocus_style:theme.css`. Backend artifacts (`handler_code:*`,
`backend.json`, seeds) are owned by their dedicated builders — your
write/delete tools will reject those filenames with a redirect.

When the prompt describes a cascade from a handler change ("Find
every `useHandler('legacy_export')` caller and remove the call"),
locate the callers via `search_artifacts` / `find_symbol_references`
and edit the FRONTEND files only. Do NOT attempt to modify or delete
the handler artifact itself.

### Constraints

- Single-attempt save contract: aim for ONE clean save per file. A few
  retries are auto-permitted on validation failure before the file is
  stubbed and the workflow moves on, but don't sidestep the caps by
  issuing many small edits — the same retry budget applies across every
  `edit_artifact` / save tool invocation.
- The system prompt above lists every authoring rule (forbidden
  APIs, hooks, JSX, M3 tokens, accessibility) — they apply to every
  file you touch.

When the prompt's intent is satisfied, return immediately.

"""


def component_builder_instruction_provider(context: ReadonlyContext) -> str:
    """Instruction provider for ComponentBuilder.

    Combines the shared static prefix with the single-file suffix and
    appends per-domain authoring docs.
    """
    return (
        InstructionBuilder()
        .add(static_authoring_prefix())
        .add(single_file_suffix())
        # Skeleton, patterns, code components
        .add_doc("frontend/component_builder/docs/03_COMPONENT_PATTERNS.md")
        .add_doc("frontend/component_builder/docs/05_CODE_COMPONENTS.md")
        # Color contrast, layout, responsive rules
        .add_doc("frontend/component_builder/docs/10_COLOR_AND_LAYOUT.md")
        # Image and ExepadImage rules
        .add_doc("frontend/component_builder/docs/11_IMAGES.md")
        # Anti-patterns, null safety
        .add_doc("frontend/component_builder/docs/12_ANTI_PATTERNS.md")
        # Data fetching contracts (useModel / useHandler / useCount /
        # useCurrentUser nullability). Pairs with V2/V3/S1 validators.
        .add_doc("frontend/component_builder/docs/13_DATA_FETCHING.md")
        # Domain + flow skills (theme-toggle, charts-visualization,
        # kanban-board, scratch-creation, etc.) are NOT inlined here. They
        # live as SKILL.md directories on disk and are exposed to the LLM
        # via the SkillToolset attached to the agent below. The toolset
        # auto-injects an <available_skills> XML preamble on every turn;
        # the LLM calls load_skill / load_skill_resource to pull the body
        # at inference time.
        .build()
    )


# =============================================================================
# ADK Tool Callbacks (cross-component bleed prevention + AFC loop control)
# =============================================================================

_SAVE_TOOL_NAME = "validate_and_save_tsx_component_artifact"
_MODULE_SAVE_TOOL_NAME = "validate_and_save_tsx_module_artifact"
_SAVE_TOOL_NAMES: frozenset[str] = frozenset({_SAVE_TOOL_NAME, _MODULE_SAVE_TOOL_NAME})
_MAX_TOTAL_SAVE_CALLS = 8


def component_save_guardrail(
    tool: BaseTool, args: Dict[str, Any], tool_context: ToolContext
) -> Optional[Dict]:
    """Block cross-component bleed and enforce a total tool-call cap.

    Workflows set ``_expected_component_name`` in session state before each
    builder invocation; this callback reads it and short-circuits the tool
    when the LLM tries to save a different component / module.

    The same guard covers both save tools (component + supporting module).
    For module saves, ``_expected_component_name`` is set to the MODULE name
    by the editing workflow so the bleed check still works — the LLM might
    confuse modules across an edit batch the same way it confuses entry
    components.

    The total-call cap prevents unbounded AFC loops: if the LLM keeps calling
    the save tool with code that fails validation, we stop after
    ``_MAX_TOTAL_SAVE_CALLS`` attempts so the agent run terminates.

    Per ADK docs, returning a dict from ``before_tool_callback`` **skips the
    tool entirely** and uses the dict as the tool result."""
    if tool.name not in _SAVE_TOOL_NAMES:
        return None

    current_component = tool_context.state.get("_expected_component_name", "unknown")
    terminal_latches = tool_context.state.get(_TERMINAL_LATCH_KEY, {})
    if isinstance(terminal_latches, dict) and current_component in terminal_latches:
        logger.warning(
            "Terminal save-tool latch hit — short-circuiting repeated tool call",
            component=current_component,
        )
        tool_context.actions.escalate = True
        return {
            "success": False,
            "error": terminal_latches[current_component],
            "terminal": True,
        }

    # ── Per-component call cap (safety net for unbounded validation loops) ──
    # The counter is scoped to the current component via _expected_component_name
    # so it resets naturally when the workflow moves to the next component.
    call_key = f"_save_tool_calls:{current_component}"
    calls = tool_context.state.get(call_key, 0) + 1
    tool_context.state[call_key] = calls
    if calls > _MAX_TOTAL_SAVE_CALLS:
        logger.warning(
            "Per-component save-tool call cap reached — terminating agent loop",
            calls=calls,
            cap=_MAX_TOTAL_SAVE_CALLS,
            component=current_component,
        )
        tool_context.actions.escalate = True
        return {
            "success": False,
            "error": (
                f"Maximum tool call limit ({_MAX_TOTAL_SAVE_CALLS}) reached for "
                f"'{current_component}'. "
                "STOP calling this tool and return your final response immediately."
            ),
            "terminal": True,
        }

    expected = tool_context.state.get("_expected_component_name")
    # Both save tools take the entity name as their second positional arg:
    # the component tool calls it `component_name`, the module tool calls
    # it `module_name`. Read whichever the caller passed.
    received = args.get("component_name") or args.get("module_name") or ""

    if expected and received != expected:
        logger.warning(
            "Cross-component bleed blocked by before_tool_callback",
            expected=expected,
            received=received,
            agent=tool_context.agent_name,
        )
        return {
            "success": False,
            "error": (
                f"You are building '{expected}', not '{received}'. "
                f"Generate ONLY the artifact for '{expected}'."
            ),
        }

    # Phase 4: enforce that the LLM picks the RIGHT save tool for the
    # current target. The workflow sets `_expected_save_tool_name` to
    # whichever save tool corresponds to the targeted artifact kind
    # (component vs module). When unset (every workflow except
    # editing_workflow's module-edit branch), default to the component
    # tool so a stray module-tool call during creation / entry edits
    # gets blocked too. Without this, the LLM could call the component
    # tool with `component_name="Charts"` while the workflow expects a
    # module save of "Charts" — the bleed-name check would pass (names
    # match), the file would land at `codefocus_component:Charts.tsx`
    # instead of `codefocus_module:Charts.tsx`, and the post-save
    # loader would silently miss → action marked failed.
    expected_tool = tool_context.state.get("_expected_save_tool_name") or _SAVE_TOOL_NAME
    if tool.name != expected_tool:
        logger.warning(
            "Wrong save tool blocked by before_tool_callback",
            expected_tool=expected_tool,
            received_tool=tool.name,
            agent=tool_context.agent_name,
        )
        return {
            "success": False,
            "error": (
                f"Wrong save tool: you called {tool.name!r} but this build "
                f"targets a {('module' if expected_tool == _MODULE_SAVE_TOOL_NAME else 'component')}; "
                f"call {expected_tool!r} instead. Modules use NAMED exports "
                f"only (no `export default`); components use `export default "
                f"function {expected}()`."
            ),
        }
    return None


def component_builder_after_model_callback(callback_context, llm_response):
    """Composed ``after_model_callback`` for the component builders (standalone
    agent + parallel slots).

    Runs two conservative response rewrites for weak / non-Gemini models:
      1. :func:`normalize_tool_call_names` — repair a near-miss tool name so a
         single fumbled spelling can't hard-crash the build.
      2. :func:`salvage_prose_into_save_call` — when the model returns a TSX
         component as prose with NO tool call (the dominant off-Gemini no-save
         failure), rewrite the response into a synthetic save call so the code
         flows through the normal guardrail + validation + save path instead of
         being discarded.

    The two are mutually exclusive in practice (normalize acts only when a
    function call is present; salvage only when one is absent), but composing
    them keeps a single callback slot. ADK takes a non-None return as the
    replacement response.
    """
    result = llm_response
    changed = False
    normalized = normalize_tool_call_names(callback_context, result)
    if normalized is not None:
        result = normalized
        changed = True
    salvaged = salvage_prose_into_save_call(callback_context, result)
    if salvaged is not None:
        return salvaged
    # Neither a tool call nor salvageable code: record WHAT the model said before
    # the turn ends, otherwise this — the most common weak-model failure — reaches
    # the workflow as an unexplained `builder_no_save`. Diagnostic only.
    log_unsalvageable_no_save(callback_context, result)
    return result if changed else None


def sanitize_save_response(
    tool: BaseTool, args: Dict[str, Any], tool_context: ToolContext, tool_response: Dict
) -> Optional[Dict]:
    """Strip verbose details from success responses to prevent AFC loops.

    The ``warnings`` and ``auto_fixes_applied`` fields in a success response
    incentivise the model to "fix" them in a subsequent AFC turn, even though
    the save already succeeded.  This callback replaces the response with a
    minimal success dict so the model stops after saving.  The full details
    remain in server-side logs for analysis.

    Per ADK docs, returning a dict from ``after_tool_callback`` **replaces**
    the original ``tool_response`` before the LLM sees it."""
    if tool.name not in _SAVE_TOOL_NAMES:
        return None

    if tool_response.get("success"):
        message = "Component saved successfully. Your task is complete."
        if tool_response.get("advisory_count"):
            message = (
                "Component saved successfully. Non-blocking warnings were recorded "
                "and shipped with the artifact — do not retry solely for them. "
                "Your task is complete."
            )
        return {
            "success": True,
            "artifact_filename": tool_response.get("artifact_filename"),
            "version": tool_response.get("version"),
            "message": message,
        }
    return None


# =============================================================================
# Agent Definition
# =============================================================================

component_builder_agent = LlmAgent(
    name=AgentName.COMPONENT_BUILDER,
    model=get_agent_model(AgentName.COMPONENT_BUILDER),
    description="Builds layout components (header, sidebar, footer, content) using light DOM rendering.",
    instruction=component_builder_instruction_provider,
    input_schema=ComponentBuilderInput,
    output_schema=None,
    include_contents="none",
    planner=BuiltInPlanner(thinking_config=types.ThinkingConfig(thinking_budget=0)),
    tools=[
        _FRONTEND_SKILL_TOOLSET,
        validate_and_save_tsx_component_artifact_tool,
        validate_and_save_tsx_module_artifact_tool,
        add_theme_tokens_tool,
        load_artifacts,
    ],
    before_tool_callback=component_save_guardrail,
    after_tool_callback=sanitize_save_response,
    after_model_callback=component_builder_after_model_callback,
    generate_content_config=types.GenerateContentConfig(
        # Hard cap on output tokens — prevents Gemini's degenerate-repetition
        # loops from emitting 30-40k-token components like the ``xdk89qba``
        # MainHeader (3,627 lines, same nav block 32×). When this fires, the
        # truncated JSX fails the existing Stage 1 esbuild check at
        # ``artifact_tools.py:287`` and triggers retry-with-feedback. See
        # ``config.py:COMPONENT_BUILDER_MAX_OUTPUT_TOKENS`` for tuning.
        max_output_tokens=COMPONENT_BUILDER_MAX_OUTPUT_TOKENS,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    ),
)
