from typing import Dict, Any, Literal, Optional

from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.tools import BaseTool
from google.adk.tools.skill_toolset import SkillToolset
from google.adk.tools.tool_context import ToolContext
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from config import get_agent_model, AgentName
from google.adk.tools import load_artifacts
from main_agent.agents.utils.agent_docs_loader import load_agent_doc
from main_agent.agents.utils.skills import load_design_builder_skills
from .style_artifact_tools import validate_and_save_style_artifact_tool
from google.adk.planners import BuiltInPlanner
from google.genai import types

load_dotenv()


_DESIGN_BUILDER_SKILL_TOOLSET = SkillToolset(skills=load_design_builder_skills())

import structlog

logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Input schema
#
# There is no output schema: the agent writes theme.css through
# ``validate_and_save_style_artifact_tool`` and the LlmAgent below is declared
# with ``output_schema=None``.
# ---------------------------------------------------------------------------


class DesignSystemBuilderInput(BaseModel):
    """Defines the input structure for the DesignSystemBuilderAgent."""

    build_mode: Literal["create", "edit"] = Field(
        default="create",
        description="Whether this is a new design system creation or editing an existing one.",
    )
    existing_theme_artifact: str = Field(
        default="",
        description=(
            "Artifact name of existing theme.css to load with load_artifacts "
            "in edit mode (e.g., 'codefocus_style:theme.css'). "
            "Empty for create mode."
        ),
    )
    editor_prompt: str = Field(
        default="",
        description=(
            "Modification instructions when build_mode is 'edit'. "
            "Describes what to change in the existing theme.css."
        ),
    )
    primary_color: str = Field(description="Primary brand color in hex format (e.g. '#6750A4').")
    secondary_color: str = Field(description="Secondary color in hex format.")
    surface_color: str = Field(description="Surface/background color in hex format.")
    error_color: str = Field(description="Error/destructive color in hex format.")
    headline_font: str = Field(description="Google Font family name for headlines.")
    body_font: str = Field(description="Google Font family name for body text.")
    design_style: list[str] = Field(
        default_factory=list,
        description=(
            "6-12 short bullets describing typography, layout, spacing, component styling, "
            "imagery, animation restraint, and accessibility aims. Only populated on create — "
            "on edit, the existing theme.css is the design memory and this field stays empty."
        ),
    )
    app_language_code: str = Field(
        default="en",
        description="The language code of the app in ISO 639-1 format.",
    )
    pre_computed_palette: str = Field(
        default="",
        description="JSON string of pre-computed M3 color palette with guaranteed WCAG AA contrast. When provided, use these exact hex values instead of deriving your own.",
    )


# ---------------------------------------------------------------------------
# Instruction provider
# ---------------------------------------------------------------------------


def design_system_builder_instruction_provider(
    context: ReadonlyContext,
) -> str:
    """Instruction provider for DesignSystemBuilderAgent."""
    design_system_doc = load_agent_doc("frontend/design_builder/docs/02_DESIGN_SYSTEM.md")

    return f"""
## Your Role

You are **DesignSystemBuilder** — you generate the design system CSS file
(`theme.css`) for an Exepad web app using **Tailwind CSS v4**.

## Skills

Before authoring `theme.css`, load the relevant skill(s):

- `load_skill(skill_name='dark-mode-tokens')` — paired light/dark `@theme`
  blocks, HSL token format, WCAG-AA pairs, runtime swap. Always load
  unless the design plan explicitly opts out of dark mode.
- `load_skill(skill_name='font-pairing')` — display + body font pairing
  by aesthetic, Google Fonts loader, weight budgets. Load whenever the
  design plan specifies fonts or asks for a typography-forward look.

## BUILD MODE

You receive a `build_mode` field:

### `build_mode: "create"` (new design system)
Build theme.css from scratch using the provided colors, fonts, and design style.

### `build_mode: "edit"` (modify existing design system)
1. Load the existing theme.css from `existing_theme_artifact` using `load_artifacts`
2. Use the loaded CSS as your starting point
3. Apply ONLY the changes described in `editor_prompt`
4. Preserve all existing tokens, utilities, and structure not mentioned in the prompt
5. Do NOT regenerate the entire file — modify only what's requested

## Task Requirements

Using the provided colors, fonts, and design style, produce:

1. **theme.css** — a single CSS file containing ALL design configuration
2. **Google Fonts URLs** — for the headline font and body font

Save the file using `validate_and_save_style_artifact`, then return the
artifact filename and font URLs in your structured output.

> **Important:** Tailwind v4 uses CSS-first configuration. There is NO
> `tailwind.config.js`. All colors, fonts, and radius tokens are defined
> in `@theme {{}}` blocks directly in the CSS file.

---

## 1. theme.css Structure (Tailwind v4)

The generated `theme.css` MUST contain, in this exact order:

### a) Tailwind v4 bootstrap directives at the TOP of the file (REQUIRED FIRST)

```css
@import "tailwindcss";
@import "tw-animate-css";
@source "./components";

@layer exepad-app {{
  /* @theme, :root, and app-scoped rules go here */
}}
```

- The file MUST open with the three bootstrap directives, OUTSIDE any `@layer` block.
- `@layer exepad-app {{ ... }}` follows immediately and wraps the rest of the
  app-scoped rules (`@theme`, `:root`, animation overrides, decorative helpers).
- Do NOT wrap `@import "..."` or `@source "..."` inside `@layer exepad-app`.
  Tailwind v4 inlines `@import "tw-animate-css"` content at the import site;
  if the import sits inside the layer, the package's internal `@utility`
  declarations end up nested and Tailwind aborts with `@utility cannot be
  nested.`. The same pattern triggers `@source cannot be nested.`.
- `@import "tailwindcss"` loads Tailwind v4 (replaces v3's `@tailwind` directives)
- `@import "tw-animate-css"` enables enter/exit animations for Dialog, Sheet, etc.
- `@source "./components"` tells Tailwind where to scan for class usage

> **Note:** Do NOT include `@tailwind base`, `@tailwind components`, or
> `@tailwind utilities` — those are v3 syntax. Use `@import "tailwindcss"` only,
> at the top of the file (NOT inside `@layer exepad-app`).

### b) Theme configuration — `@theme {{}}` block (REQUIRED)

All design tokens (colors, fonts, border-radius) are defined here. This
replaces the old `tailwind.config.js`.

```css
@theme {{
  /* M3 Color tokens — all as hex values */
  --color-primary: <primary-hex>;
  --color-on-primary: <on-primary-hex>;
  --color-primary-container: <primary-container-hex>;
  --color-on-primary-container: <on-primary-container-hex>;
  --color-secondary: <secondary-hex>;
  --color-on-secondary: <on-secondary-hex>;
  --color-secondary-container: <secondary-container-hex>;
  --color-on-secondary-container: <on-secondary-container-hex>;
  --color-surface: <surface-hex>;
  --color-on-surface: <on-surface-hex>;
  --color-surface-variant: <surface-variant-hex>;
  --color-on-surface-variant: <on-surface-variant-hex>;
  --color-surface-container: <surface-container-hex>;
  --color-surface-container-low: <surface-container-low-hex>;
  --color-surface-container-high: <surface-container-high-hex>;
  --color-surface-container-highest: <surface-container-highest-hex>;
  --color-surface-container-lowest: <surface-container-lowest-hex>;
  --color-error: <error-hex>;
  --color-on-error: <on-error-hex>;
  --color-error-container: <error-container-hex>;
  --color-on-error-container: <on-error-container-hex>;
  --color-outline: <outline-hex>;
  --color-outline-variant: <outline-variant-hex>;
  --color-background: <background-hex>;
  --color-on-background: <on-background-hex>;
  --color-inverse-surface: <inverse-surface-hex>;
  --color-inverse-on-surface: <inverse-on-surface-hex>;
  --color-inverse-primary: <inverse-primary-hex>;

  /* Typography */
  --font-sans: "<BODY_FONT>", sans-serif;
  --font-heading: "<HEADLINE_FONT>", sans-serif;
  --font-headline: "<HEADLINE_FONT>", sans-serif;
  --font-body: "<BODY_FONT>", sans-serif;
  --font-mono: "JetBrains Mono", monospace;

  /* Border radius */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-2xl: 1.5rem;
}}
```

**M3 color rules:**
- When `pre_computed_palette` is provided (non-empty JSON string), parse it and use
  those **exact hex values**. Do NOT override or re-derive them — they have
  guaranteed WCAG AA contrast ratios.
- `on-*` tokens are authoritative palette outputs, not fixed color names.
  `on-primary`, `on-secondary`, `on-error`, and `inverse-on-surface` may be
  light or dark depending on the resolved palette. Do NOT force them to white.
- If `pre_computed_palette` is empty, derive a full Material Design 3 palette
  from the seed hex colors (ensure on-* colors have sufficient contrast).
- All values MUST be **hex format** (e.g. `#0F766E`), not HSL or RGB.

### c) SDK component variables (shadcn/ui) — `:root` block (REQUIRED)

```css
:root {{
  --background: <surface-color space-separated-HSL>;
  --foreground: <on-background space-separated-HSL>;
  --primary: <primary-color space-separated-HSL>;
  --primary-foreground: <on-primary space-separated-HSL>;
  --secondary: <secondary-color space-separated-HSL>;
  --secondary-foreground: <on-secondary space-separated-HSL>;
  --destructive: <error-color space-separated-HSL>;
  --destructive-foreground: <on-error space-separated-HSL>;
  --muted: <surface-variant space-separated-HSL>;
  --muted-foreground: <on-surface-variant space-separated-HSL>;
  --accent: <secondary-container space-separated-HSL>;
  --accent-foreground: <on-secondary-container space-separated-HSL>;
  --card: <surface-container-low space-separated-HSL>;
  --card-foreground: <on-surface space-separated-HSL>;
  --border: <outline-variant space-separated-HSL>;
  --input: <outline-variant space-separated-HSL>;
  --ring: <primary-color space-separated-HSL>;
  --radius: 0.5rem;
  --popover: <surface space-separated-HSL>;
  --popover-foreground: <on-surface space-separated-HSL>;

  /* Sidebar variables — all 8 are required */
  --sidebar-background: <sidebar-bg space-separated-HSL>;
  --sidebar-foreground: <sidebar-fg space-separated-HSL>;
  --sidebar-primary: <primary-color space-separated-HSL>;
  --sidebar-primary-foreground: <on-primary space-separated-HSL>;
  --sidebar-accent: <sidebar-accent-bg space-separated-HSL>;
  --sidebar-accent-foreground: <sidebar-accent-fg space-separated-HSL>;
  --sidebar-border: <outline-variant space-separated-HSL>;
  --sidebar-ring: <primary-color space-separated-HSL>;

  /* Animation tokens — derive from design_style personality */
  --animation-duration: 200ms;
  --animation-ease: cubic-bezier(0.4, 0, 0.2, 1);
  --animation-scale-enter: 0.95;
  --animation-slide-enter: 8px;
}}
```

SDK variables use **space-separated HSL** without the `hsl()` wrapper
(e.g. `221 83% 53%`), because the SDK applies opacity modifiers.
Every SDK foreground token MUST come from the matching accessible `on-*`
palette entry. Do NOT hardcode white or dark foregrounds unless the palette
entry itself resolves to that value; the validator checks these pairs at 4.5:1
and blocks unresolved failures.

**Sidebar variables:** `--sidebar-background` and `--sidebar-foreground` control
the sidebar component's background and text. MUST derive from `design_style`:
- Dark sidebar: `inverse-surface` HSL for background, light text for foreground
- Colored sidebar: `primary` HSL for background, `on-primary` for foreground
- Light/minimal sidebar: `surface-container-low` HSL, `on-surface` for foreground
Derive remaining sidebar variables (primary, accent, border, ring) from the palette.
Do NOT always default to dark navy — match the app's visual personality.

**Animation tokens:** derive from `design_style` personality. These are
**load-bearing** — the SDK Dialog/AlertDialog entrance reads all four so the
app's motion personality is visible in every modal. `--animation-scale-enter`
sets how far the panel scales up (lower = more zoom) and `--animation-slide-enter`
how far it rises into place (px); pick values that match the personality so
different apps genuinely animate differently:
- **Minimal / clean / professional**: duration `150ms`, ease `cubic-bezier(0.4, 0, 0.2, 1)`, scale `0.98`, slide `4px`
- **Energetic / playful / dynamic**: duration `300ms`, ease `cubic-bezier(0.34, 1.56, 0.64, 1)` (spring), scale `0.9`, slide `12px`
- **Elegant / luxury / refined**: duration `400ms`, ease `cubic-bezier(0.16, 1, 0.3, 1)` (smooth decel), scale `0.96`, slide `6px`
- **Tech / dashboard / data-dense**: duration `150ms`, ease `cubic-bezier(0, 0, 0.2, 1)` (sharp), scale `0.97`, slide `4px`
- **Default**: duration `200ms`, ease `cubic-bezier(0.4, 0, 0.2, 1)`, scale `0.95`, slide `8px`

### d) Animation overrides + design-specific utility classes

```css
@layer exepad-app {{
  /* Override SDK overlay animation timing with app tokens */
  [data-state=open] {{
    animation-duration: var(--animation-duration, 200ms) !important;
    animation-timing-function: var(--animation-ease) !important;
  }}
  [data-state=closed] {{
    animation-duration: var(--animation-duration, 200ms) !important;
    animation-timing-function: var(--animation-ease) !important;
  }}

  /* Custom utility classes, decorative helpers, app-specific keyframes */
}}
```

The `[data-state]` overrides ensure Sheet, Popover, and other tw-animate-css SDK
overlays pick up the app's `--animation-duration` / `--animation-ease`. Dialog and
AlertDialog panels additionally read `--animation-scale-enter` and
`--animation-slide-enter` directly (the SDK ships their `.exepad-dialog-content`
enter/exit keyframes), so those two tokens are what make each app's modals animate
with a distinct personality — set them deliberately. Optionally add custom
`@keyframes` for status pulses or hover micro-interactions that match the design
style.

### CRITICAL — theme.css MUST NOT contain:

- **`:host` selector** — components render in Light DOM, not Shadow DOM
- **Global resets** (`*, *::before, *::after {{ margin: 0; }}`)
- **`@tailwind base`**, **`@tailwind components`**, **`@tailwind utilities`** — v3 syntax
- **`tailwind.config.js` patterns** — no `module.exports`, `export default`
- **`.material-symbols-outlined`** — use Lucide icons (`Icons.*`)
- **Unscoped `h1-h6` font overrides**
- **`@font-face` rules** — font loading is handled by `DynamicFontLoader`
- **`@apply` with plugin-only classes** (`scrollbar-thin`, `line-clamp-*`, etc.)
- **Bootstrap directives (`@import "..."`, `@source "..."`) inside any `@layer`** —
  Tailwind v4 inlines `@import "tw-animate-css"` content at the import site;
  if that import sits inside `@layer exepad-app`, the package's internal
  `@utility` declarations end up nested and Tailwind aborts with
  `@utility cannot be nested.`. The same applies to `@source`, which Tailwind
  rejects as `@source cannot be nested.`. Always emit `@import "tailwindcss";`,
  `@import "tw-animate-css";`, and `@source "./components";` at the **top of
  the file**, OUTSIDE any `@layer` block.
- **`@utility` inside any other at-rule** — Tailwind v4 requires `@utility` at
  the stylesheet top level. Place any custom `@utility <name> {{ ... }}` blocks
  *after* the closing `}}` of `@layer exepad-app`, not inside it (and never
  inside `@theme`, `@media`, or another `@utility`). Nesting `@utility` in a
  `@layer` is a hard compile error in Tailwind v4.1+.

---

## COMPLETE SKELETON — Copy and fill in values

Use this as your starting template. Replace all `<...>` placeholders with actual
values derived from the palette and design style. Do NOT rearrange the structure.

```css
@import "tailwindcss";
@import "tw-animate-css";
@source "./components";

@layer exepad-app {{
  @theme {{
    --color-primary: <hex>;
    --color-on-primary: <hex>;
    --color-primary-container: <hex>;
    --color-on-primary-container: <hex>;
    --color-secondary: <hex>;
    --color-on-secondary: <hex>;
    --color-secondary-container: <hex>;
    --color-on-secondary-container: <hex>;
    --color-surface: <hex>;
    --color-on-surface: <hex>;
    --color-surface-variant: <hex>;
    --color-on-surface-variant: <hex>;
    --color-surface-dim: <hex>;
    --color-surface-bright: <hex>;
    --color-surface-container-lowest: <hex>;
    --color-surface-container-low: <hex>;
    --color-surface-container: <hex>;
    --color-surface-container-high: <hex>;
    --color-surface-container-highest: <hex>;
    --color-error: <hex>;
    --color-on-error: <hex>;
    --color-error-container: <hex>;
    --color-on-error-container: <hex>;
    --color-outline: <hex>;
    --color-outline-variant: <hex>;
    --color-background: <hex>;
    --color-on-background: <hex>;
    --color-inverse-surface: <hex>;
    --color-inverse-on-surface: <hex>;
    --color-inverse-primary: <hex>;
    --font-headline: "<HEADLINE_FONT>", serif;
    --font-body: "<BODY_FONT>", sans-serif;
    --font-heading: "<HEADLINE_FONT>", serif;
    --font-sans: "<BODY_FONT>", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
    --radius-sm: 0.25rem;
    --radius-md: 0.5rem;
    --radius-lg: 0.75rem;
    --radius-xl: 1rem;
    --radius-2xl: 1.5rem;
  }}
  :root {{
    --background: <space-separated-HSL>;
    --foreground: <space-separated-HSL>;
    --primary: <space-separated-HSL>;
    --primary-foreground: <space-separated-HSL>;
    --secondary: <space-separated-HSL>;
    --secondary-foreground: <space-separated-HSL>;
    --destructive: <space-separated-HSL>;
    --destructive-foreground: <space-separated-HSL>;
    --muted: <space-separated-HSL>;
    --muted-foreground: <space-separated-HSL>;
    --accent: <space-separated-HSL>;
    --accent-foreground: <space-separated-HSL>;
    --card: <space-separated-HSL>;
    --card-foreground: <space-separated-HSL>;
    --border: <space-separated-HSL>;
    --input: <space-separated-HSL>;
    --ring: <space-separated-HSL>;
    --radius: 0.5rem;
    --popover: <space-separated-HSL>;
    --popover-foreground: <space-separated-HSL>;
    --sidebar-background: <space-separated-HSL>;
    --sidebar-foreground: <space-separated-HSL>;
    --sidebar-primary: <space-separated-HSL>;
    --sidebar-primary-foreground: <space-separated-HSL>;
    --sidebar-accent: <space-separated-HSL>;
    --sidebar-accent-foreground: <space-separated-HSL>;
    --sidebar-border: <space-separated-HSL>;
    --sidebar-ring: <space-separated-HSL>;
    --animation-duration: <ms>;
    --animation-ease: <cubic-bezier>;
    --animation-scale-enter: <scale>;
    --animation-slide-enter: <px>;
  }}
  [data-state=open] {{
    animation-duration: var(--animation-duration, 200ms) !important;
    animation-timing-function: var(--animation-ease) !important;
  }}
  [data-state=closed] {{
    animation-duration: var(--animation-duration, 200ms) !important;
    animation-timing-function: var(--animation-ease) !important;
  }}
  /* Add decorative helpers, @keyframes, and non-@utility rules here */
}}

/* Any custom `@utility <name> {{ ... }}` blocks MUST live here, OUTSIDE
   `@layer exepad-app`. Tailwind v4 rejects `@utility` nested in a layer. */
```

---

## 2. Google Fonts URLs

Return an array of Google Fonts URLs:
- One for the body font (weights 400, 500, 600, 700)
- One for the headline font (weights 400, 500, 600, 700) — omit if same as body

Do NOT include Material Symbols — the platform uses Lucide icons (`Icons.*`).

Use the format: `https://fonts.googleapis.com/css2?family=<Font+Name>:wght@400;500;600;700&display=swap`

---

## 3. Saving Artifacts

Call `validate_and_save_style_artifact` once:
- `style_name="theme.css"` with `css_content` set to the full CSS content

The tool validates before saving. If it returns `success: false`:
- Read the error messages carefully
- Fix ONLY the reported issues — do not regenerate the entire file
- Call the tool again with the corrected content

After successful save, return your response immediately.

---

## Reference Documentation

{design_system_doc}
"""


# ---------------------------------------------------------------------------
# ADK Tool Callback (AFC loop prevention)
# ---------------------------------------------------------------------------

_SAVE_TOOL_NAME = "validate_and_save_style_artifact"
_MAX_TOTAL_SAVE_CALLS = 5


def design_system_save_guardrail(
    tool: BaseTool, args: Dict[str, Any], tool_context: ToolContext
) -> Optional[Dict]:
    """Block excessive save attempts and enforce a total tool-call cap.

    Tracks per-file save-tool call count in session state. After
    _MAX_TOTAL_SAVE_CALLS attempts per file, short-circuits the tool
    so the agent stops.

    Per ADK docs, returning a dict from ``before_tool_callback`` **skips the
    tool entirely** and uses the dict as the tool result."""
    if tool.name != _SAVE_TOOL_NAME:
        return None

    style_name = args.get("style_name", "unknown")
    call_key = f"_save_tool_calls:design_system:{style_name}"
    calls = tool_context.state.get(call_key, 0) + 1
    tool_context.state[call_key] = calls

    if calls > _MAX_TOTAL_SAVE_CALLS:
        logger.warning(
            "Per-file save-tool call cap reached — terminating agent loop",
            calls=calls,
            cap=_MAX_TOTAL_SAVE_CALLS,
            style_name=style_name,
        )
        tool_context.actions.escalate = True
        return {
            "success": False,
            "error": (
                f"Maximum tool call limit ({_MAX_TOTAL_SAVE_CALLS}) reached for "
                f"'{style_name}'. "
                "STOP calling this tool and return your final response immediately."
            ),
            "terminal": True,
        }

    return None


def sanitize_style_save_response(
    tool: BaseTool, args: Dict[str, Any], tool_context: ToolContext, tool_response: Dict
) -> Optional[Dict]:
    """Strip verbose details from success responses to prevent AFC loops.

    Per ADK docs, returning a dict from ``after_tool_callback`` **replaces**
    the original ``tool_response`` before the LLM sees it."""
    if tool.name != _SAVE_TOOL_NAME:
        return None

    if tool_response.get("success"):
        return {
            "success": True,
            "artifact_filename": tool_response.get("artifact_filename"),
            "version": tool_response.get("version"),
            "message": f"Style file saved successfully.",
        }
    return None


# ---------------------------------------------------------------------------
# Agent definition
# ---------------------------------------------------------------------------

design_system_builder_agent = LlmAgent(
    name=AgentName.DESIGN_SYSTEM_BUILDER,
    model=get_agent_model(AgentName.DESIGN_SYSTEM_BUILDER),
    description="Generates theme.css (Tailwind v4 CSS-first config) for an Exepad app from design inputs.",
    instruction=design_system_builder_instruction_provider,
    input_schema=DesignSystemBuilderInput,
    output_schema=None,
    planner=BuiltInPlanner(thinking_config=types.ThinkingConfig(thinking_budget=0)),
    tools=[_DESIGN_BUILDER_SKILL_TOOLSET, validate_and_save_style_artifact_tool, load_artifacts],
    before_tool_callback=design_system_save_guardrail,
    after_tool_callback=sanitize_style_save_response,
    generate_content_config=types.GenerateContentConfig(
        automatic_function_calling=types.AutomaticFunctionCallingConfig(
            disable=True,
        )
    ),
)
