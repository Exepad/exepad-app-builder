"""ComponentBuilderMultiple — multi-file frontend coding agent.

Sibling to ComponentBuilder. Where ComponentBuilder is a single-file
worker (one TSX in, one TSX out, retries scoped to that file),
ComponentBuilderMultiple operates over the entire frontend artifact
set in a single LLM turn — receiving a natural-language prompt and
discovering the file set itself via a Claude-Code-style coding-agent
tool surface (Read / Write / Edit / Glob / Grep + code intelligence +
state inspection).

The Editor is the planner (no artifact-content visibility); this
agent is the worker (full discovery + edit responsibility).

Cache shape: ``static_authoring_prefix()`` is byte-identical to the
prefix ComponentBuilder consumes — both agents share that prompt-
cache key. The per-agent suffix (``multi_file_suffix()``) appended
after carries the multi-file behavior block.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.planners import BuiltInPlanner
from google.adk.tools import load_artifacts
from google.genai import types
from pydantic import BaseModel, Field

from config import (
    AgentName,
    COMPONENT_BUILDER_MAX_OUTPUT_TOKENS,
    get_agent_model,
)
from main_agent.agents.utils.agent_docs_loader import InstructionBuilder
from main_agent.agents.utils.tool_call_normalizer import normalize_tool_call_names

from .artifact_tools import (
    delete_artifact_tool,
    describe_artifact_tool,
    discover_dependencies_tool,
    edit_artifact_tool,
    find_symbol_references_tool,
    inspect_app_state_tool,
    list_artifacts_tool,
    search_artifacts_tool,
    validate_and_save_tsx_component_artifact_tool,
    validate_and_save_tsx_module_artifact_tool,
)
from .component_builder import (
    _FRONTEND_SKILL_TOOLSET,
    multi_file_suffix,
    static_authoring_prefix,
)
from .theme_token_tool import add_theme_tokens_tool

from google.adk.tools.skill_toolset import SkillToolset
from main_agent.agents.utils.skills import load_frontend_polish_skills

# =============================================================================
# Input schema — prompt-only worker contract
# =============================================================================


class ComponentBuilderMultipleInput(BaseModel):
    """Input for ComponentBuilderMultiple.

    The agent receives a single natural-language ``prompt`` plus
    read-only context. NO targets list, NO per-file structure, NO
    permission flags, NO mount metadata. The prompt IS the plan.

    The agent uses its tool surface (``list_artifacts``,
    ``search_artifacts``, ``find_symbol_references``,
    ``discover_dependencies``, ``describe_artifact``,
    ``inspect_app_state``, ``load_artifacts``, ``edit_artifact``,
    ``validate_and_save_tsx_component_artifact``,
    ``validate_and_save_tsx_module_artifact``,
    ``add_theme_tokens``, ``delete_artifact``) to discover and edit
    files.
    """

    prompt: str = Field(
        description=(
            "Natural-language task description. Example: 'Rename the "
            "Card component prop `label` to `title` everywhere it's "
            "used. Update the Card declaration and every consumer.'"
        )
    )

    # Read-only context — same JSON surfaces ComponentBuilder uses, byte-stable
    # for cache reuse. Skills (build-flow + domain) are NOT carried as input
    # fields; the agent loads them at inference time via its SkillToolset.
    design_system_context: str = Field(
        default="",
        description="JSON string with design system info: colors, fonts, spacing, etc.",
    )
    backend_surface: str = Field(
        default="",
        description=(
            "JSON string of backend surface (models + handlers + storage + "
            "security + forms). Each section contains data items and a usage guide."
        ),
    )
    logic_surface: str = Field(
        default="",
        description=("JSON string of logic surface (shared state variables + usage guide)."),
    )
    app_context: str = Field(
        default="",
        description=(
            "JSON string of app-level context: page slugs, component manifest, "
            "navigation. The agent can also call inspect_app_state for live state."
        ),
    )
    image_urls: str = Field(
        default="",
        description="JSON string mapping image UUIDs to resolved URLs.",
    )
    app_language_code: str = Field(
        default="en",
        description="The language code of the app in ISO 639-1 format.",
    )


# =============================================================================
# Instruction provider
# =============================================================================


def component_builder_multiple_instruction_provider(context: ReadonlyContext) -> str:
    """Combine the shared static prefix with the multi-file suffix and authoring docs.

    The prefix is BYTE-IDENTICAL to the one ComponentBuilder uses, so
    both agents share the same prompt-cache key for the long
    cross-cutting authoring rules. The cache breaks at the per-agent
    suffix (single-file vs multi-file behavior).
    """
    return (
        InstructionBuilder()
        .add(static_authoring_prefix())
        .add(multi_file_suffix())
        # Shared authoring docs (same set ComponentBuilder uses)
        .add_doc("frontend/component_builder/docs/03_COMPONENT_PATTERNS.md")
        .add_doc("frontend/component_builder/docs/05_CODE_COMPONENTS.md")
        .add_doc("frontend/component_builder/docs/10_COLOR_AND_LAYOUT.md")
        .add_doc("frontend/component_builder/docs/11_IMAGES.md")
        .add_doc("frontend/component_builder/docs/12_ANTI_PATTERNS.md")
        .build()
    )


# =============================================================================
# Agent definition
# =============================================================================


component_builder_multiple_agent = LlmAgent(
    name=AgentName.COMPONENT_BUILDER_MULTIPLE,
    model=get_agent_model(AgentName.COMPONENT_BUILDER_MULTIPLE),
    description=(
        "Multi-file frontend worker. Receives a natural-language prompt + "
        "read-only context, discovers files via its coding-agent tool "
        "surface, and edits cross-file cascades in one turn."
    ),
    instruction=component_builder_multiple_instruction_provider,
    input_schema=ComponentBuilderMultipleInput,
    output_schema=None,
    include_contents="none",
    planner=BuiltInPlanner(thinking_config=types.ThinkingConfig(thinking_budget=8000)),
    tools=[
        # Skills (list_skills / load_skill / load_skill_resource / run_skill_script)
        _FRONTEND_SKILL_TOOLSET,
        # Read
        load_artifacts,
        list_artifacts_tool,
        search_artifacts_tool,
        describe_artifact_tool,
        discover_dependencies_tool,
        find_symbol_references_tool,
        inspect_app_state_tool,
        # Write
        validate_and_save_tsx_component_artifact_tool,
        validate_and_save_tsx_module_artifact_tool,
        edit_artifact_tool,
        add_theme_tokens_tool,
        # Delete
        delete_artifact_tool,
    ],
    after_model_callback=normalize_tool_call_names,
    generate_content_config=types.GenerateContentConfig(
        max_output_tokens=COMPONENT_BUILDER_MAX_OUTPUT_TOKENS,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    ),
)


# =============================================================================
# Polish-mode variant — design-import cleanup pass
# =============================================================================
#
# Architectural backbone for the design-import drift fix (Track 3 in
# ~/.claude/plans/create-a-full-fix-modular-horizon.md). The mechanical
# html_to_tsx translator emits byte-faithful TSX from the design bundle.
# Routing that output back through the SAME ComponentBuilderMultiple agent
# that user-driven edits use (with the full 27-skill toolset including
# `landing-page-marketing`, `scratch-creation`, etc.) caused
# the LLM to regenerate sections that should have been preserved verbatim
# (RC#2, RC#3, RC#9, RC#12, RC#13, RC#15 in app w4hov6ht's drift inventory).
#
# This variant differs in THREE ways from the full agent:
#   1. SkillToolset is narrowed to `component-editing` + `state-hooks` +
#      `theme-token-migration` only (see `load_frontend_polish_skills`).
#      Marketing / landing-page / scratch-creation skills are unavailable
#      via `list_skills` and `load_skill`.
#   2. Write tools restricted to `edit_artifact_tool` (string-replace) only.
#      `validate_and_save_tsx_component_artifact_tool` +
#      `validate_and_save_tsx_module_artifact_tool` (full-file rewrites) are
#      NOT registered. The agent CANNOT rewrite a file end-to-end; every
#      change is a named, surgical edit against the existing source.
#   3. Instruction provider replaces the full-agent prompt with a strict
#      "translation polish only" contract (see
#      `component_builder_polish_instruction_provider`). Allowed edits are
#      enumerated; forbidden categories explicitly include "invent new copy"
#      and "apply marketing/hero templates".
#
# Shares with the full agent: input schema (so prompt-cache prefix matches
# where reused), output key, the same validation chain (esbuild → tsc →
# AST → fixers → semantic → style coverage) inside `edit_artifact_tool`,
# the same `_codefocus_sibling_modules` workflow seed. The polish variant
# IS dispatched conditionally by EditingWorkflow's
# `_run_phase_frontend_build` when `StateKeys.EDIT_PLAN_SOURCE ==
# "design_import"` — for user-driven edit turns, the full agent is used
# unchanged (no regression risk).


_FRONTEND_POLISH_SKILL_TOOLSET = SkillToolset(skills=load_frontend_polish_skills())


def component_builder_polish_instruction_provider(context: ReadonlyContext) -> str:
    """Polish-mode prompt — translation-only contract.

    Byte-stable across components: per-component data (the wiring list,
    model hints) flows through the input schema's `prompt` field, not
    through this system instruction. The cache shape mirrors the full
    agent's prefix-then-suffix structure so the static prefix can still
    cross-reuse with ComponentBuilder when the wider product set
    eventually adopts the polish-mode pattern.
    """
    return (
        InstructionBuilder()
        .add(static_authoring_prefix())
        .add(
            "\n"
            "# TRANSLATION POLISH MODE\n"
            "\n"
            "You are running in **translation polish mode**. The TSX you are\n"
            "being asked to modify was MECHANICALLY TRANSLATED from a\n"
            "design-tool export (Stitch, Claude Design). That TSX is the\n"
            "**source of truth** for layout, copy, addresses, phone numbers,\n"
            "hours, prices, section ordering, and every word of body text.\n"
            "\n"
            "**Your job is platform compliance, not regeneration.** Make the\n"
            "smallest set of edits needed to bring the TSX into platform\n"
            "compliance. You can ONLY use `edit_artifact_tool` (string-\n"
            "replace within an existing artifact). There is NO\n"
            "`validate_and_save_*` tool — you cannot rewrite a file end-to-end.\n"
            "\n"
            "## SCOPE — POLISH YOUR OWN ENTRY ONLY\n"
            "\n"
            "You will polish EXACTLY ONE entry component, named in the user\n"
            "prompt. Every other module in `_codefocus_sibling_modules` is\n"
            "READ-ONLY context to help you understand how your entry connects\n"
            "to the rest of the app — DO NOT edit them. The runtime enforces\n"
            "this: `edit_artifact_tool` will REJECT writes outside your entry\n"
            "file with a `terminal: true` error. Do not waste tool calls\n"
            "attempting them. If a bug surfaces in a supporting module, leave\n"
            "it — a follow-up edit turn will address it.\n"
            "\n"
            "## ALLOWED EDIT CATEGORIES\n"
            "Every edit you make MUST fall into exactly one of:\n"
            "\n"
            "1. **SDK-IMPORT** — Add an import for a symbol the TSX already\n"
            "   references (e.g. `Icons` is used but not imported).\n"
            "2. **USEMODEL-WIRING** — Replace a hardcoded array referenced in\n"
            "   the input prompt's \"Wire the following extracted backend\n"
            "   models\" list with `useModel('<name>')`. NEVER for arrays not\n"
            "   in that list, even if a model with a related name exists.\n"
            "\n"
            "   When you render a per-row image inside the `.map(...)`\n"
            "   callback, you MUST bind an image source — pick ONE:\n"
            "       <ExepadImage src={row.image_url} keywords={row.name} ... />\n"
            "       <img src={image_urls[row.image_uuid]} alt={row.name}\n"
            "            width={...} height={...} />\n"
            "   A user-uploaded catalog UUID resolves to a URL via the\n"
            "   `image_urls` map — emit a PLAIN `<img src={image_urls[UUID]}>`,\n"
            '   never `<ExepadImage vendor="catalog">` (a src-less catalog tag\n'
            "   renders a blank box).\n"
            "   NEVER emit `<ExepadImage keywords={dynamic} />` alone — the\n"
            "   runtime cannot resolve per-row dynamic keywords to a deployed\n"
            "   asset, so the card renders a blank skeleton.\n"
            '3. **NAV-WIRING** — Convert `<a href="#">` to `<Link to="/<slug>">`\n'
            "   when the link text matches a known page slug in app_context.\n"
            "4. **ICON-SYSTEM** — Whenever the file contains ANY\n"
            '   `<span class="material-symbols-outlined">{glyph}</span>`\n'
            "   (or the same span with extra layout classes), you MUST\n"
            "   replace EACH occurrence with `<Icons.{PascalCase} />` from\n"
            "   `@exepad/sdk`. No exceptions for partial migrations: a\n"
            "   file with both `<Icons.*>` AND raw `material-symbols-\n"
            "   outlined` spans renders the raw glyph names as plain text\n"
            "   when the Material Symbols font is not loaded (it is not,\n"
            "   in the runtime).\n"
            "\n"
            "   Glyph-name conversion: snake_case → PascalCase. Common\n"
            "   maps: `chevron_right`→`ChevronRight`, `chevron_left`→\n"
            "   `ChevronLeft`, `arrow_right`→`ArrowRight`, `menu`→`Menu`,\n"
            "   `close`→`X`, `add`→`Plus`, `delete`→`Trash2`, `mail`→\n"
            "   `Mail`, `phone`→`Phone`, `map_pin`→`MapPin`, `home`→\n"
            "   `Home`, `search`→`Search`, `egg`→`Egg`. For glyphs without\n"
            "   a lucide-react equivalent (e.g. `potted_plant`, `grass`),\n"
            "   pick the closest semantic match (`Sprout`, `Leaf`).\n"
            "\n"
            "   Preserve any sizing or color classes by moving them to the\n"
            "   `className` prop on the Icon component.\n"
            '5. **NULL-SAFETY** — Add `?? []` / `?? ""` / `?.` guards around\n'
            "   newly-introduced `useModel` data accesses.\n"
            "\n"
            "## FORBIDDEN MUTATIONS\n"
            "You must NOT do any of the following:\n"
            "\n"
            "- Add new sections (FAQ, testimonials, hero overlays) not in source\n"
            "- Replace addresses, phone numbers, hours, or any literal text\n"
            "- Add or remove form fields beyond what the source had\n"
            '- Replace `src="__ASSET_IMG:assets/imports/...__"` or\n'
            '  `data-asset-relpath="imports/..."` with stock-photo keywords\n'
            '  or a `vendor="..."` stock tag. These are **pinned design-import\n'
            "  assets** — preserve byte-for-byte.\n"
            "- Add `brightness-[0.4]` + `bg-black/50` overlays on heroes UNLESS\n"
            "  the source already has `text-white` (or `text-on-primary`,\n"
            "  `text-inverse-*`) on the same section's text.\n"
            "- Invent `onClick` handlers when the source `<button>` has none.\n"
            "  Leave the button as-is.\n"
            "- Rename or rewrite section headings, badges, or button text.\n"
            "- Enrich image keywords. Pass `alt` through to `keywords` verbatim.\n"
            "- Apply marketing/landing-page/scratch-creation templates. (Those\n"
            "  skills are not available in this mode anyway.)\n"
            "\n"
            "## DISCOVERY + EDIT WORKFLOW\n"
            "\n"
            "1. Call `list_artifacts` + `describe_artifact` to read the\n"
            "   target component's current source.\n"
            "2. Walk the source and identify which lines need ONE of the 5\n"
            "   allowed edit categories. If you find a non-compliant pattern\n"
            "   that does NOT fit a category, **leave it** — do not silently\n"
            "   fix it.\n"
            "3. For each needed edit, call `edit_artifact_tool` with the\n"
            "   smallest `old_string` that uniquely identifies the location\n"
            "   plus the `new_string` that satisfies the category rule.\n"
            "4. After all edits, stop. Do not call `validate_and_save_*`\n"
            "   (it is not in your toolset).\n"
            "\n"
            "## SKILLS\n"
            "\n"
            "Three skills are available via `list_skills` / `load_skill`:\n"
            "  - `component-editing` — preserve image / nav / icon contracts.\n"
            "  - `state-hooks` — useModel / useApp / useHandler patterns.\n"
            "  - `theme-token-migration` — Tailwind v3 → v4 fixups.\n"
            "\n"
            "Load `component-editing` first on every turn; the other two only\n"
            "when an edit you're about to make falls in their scope.\n"
        )
        # Authoring docs — same set as the full agent. The polish prompt
        # above is layered on top of the static authoring prefix so the
        # agent still knows the SDK contract.
        .add_doc("frontend/component_builder/docs/03_COMPONENT_PATTERNS.md")
        .add_doc("frontend/component_builder/docs/05_CODE_COMPONENTS.md")
        .add_doc("frontend/component_builder/docs/10_COLOR_AND_LAYOUT.md")
        .add_doc("frontend/component_builder/docs/11_IMAGES.md")
        .add_doc("frontend/component_builder/docs/12_ANTI_PATTERNS.md")
        .build()
    )


component_builder_polish_agent = LlmAgent(
    name=AgentName.COMPONENT_BUILDER_MULTIPLE_POLISH,
    model=get_agent_model(AgentName.COMPONENT_BUILDER_MULTIPLE_POLISH),
    description=(
        "Polish-mode variant of ComponentBuilderMultiple. Dispatched ONLY by "
        "DesignImportWorkflow for the post-translation cleanup pass. Narrow "
        "skill toolset (3 skills), edit-only tool surface (no full-file "
        "writes), preservation-first prompt — the mechanical TSX is the "
        "source of truth, this agent only adds platform compliance."
    ),
    instruction=component_builder_polish_instruction_provider,
    input_schema=ComponentBuilderMultipleInput,  # same as full agent
    output_schema=None,
    include_contents="none",
    planner=BuiltInPlanner(thinking_config=types.ThinkingConfig(thinking_budget=8000)),
    tools=[
        # Narrow 3-skill toolset (the architectural guardrail).
        _FRONTEND_POLISH_SKILL_TOOLSET,
        # Read tools — same as full agent. The agent needs full discovery.
        load_artifacts,
        list_artifacts_tool,
        search_artifacts_tool,
        describe_artifact_tool,
        discover_dependencies_tool,
        find_symbol_references_tool,
        inspect_app_state_tool,
        # Write — `edit_artifact_tool` ONLY. No `validate_and_save_*`, no
        # `add_theme_tokens_tool` (theme is the translator's responsibility),
        # no `delete_artifact_tool` (can't drop sections).
        edit_artifact_tool,
    ],
    after_model_callback=normalize_tool_call_names,
    generate_content_config=types.GenerateContentConfig(
        max_output_tokens=COMPONENT_BUILDER_MAX_OUTPUT_TOKENS,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    ),
)
