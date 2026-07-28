"""Pydantic schema for ``DecompositionPlan`` — the DesignImporter's new output.

The LLM no longer emits cleaned HTML or CSS bodies. Instead it produces a
``DecompositionPlan`` describing only judgment calls:

  * Which staged ``bundle:*`` artifact maps to which ``content:<slug>:page.html``.
  * Which artifact / region becomes header/sidebar/footer.
  * How design tokens (``--barn`` etc.) map onto the M3 palette.
  * Backend intent inferred from form / repeating-card patterns.
  * Navigation routes and human-readable notes.

The deterministic runner then loads the original ``bundle:*`` bytes, cleans
them via BeautifulSoup, lifts every CSS rule via tinycss2, and writes every
artifact the design import needs. The LLM cannot silently drop content
because it never types content.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Literal, Optional

from pydantic import BaseModel, Field, ValidationInfo, field_validator, model_validator

from main_agent.agents.orchestrator.app_types.shared.models.plan_models import (
    ColumnPlan,
)
from main_agent.agents.orchestrator.app_types.webapp.subagents.creator import (
    CreatorOutput,
)


# Cyrillic letters whose glyphs are visually identical (or near-identical)
# to common Latin letters. The DesignImporter LLM occasionally emits
# these in design_style bullets (rdzn62gx 2026-05-16 had ``"high-cоntrast"``
# with a Cyrillic ``о``). They pass JSON parse / string compares but
# break case-insensitive matching downstream (e.g. design-style → token
# lookups). NFC-normalize first, then substitute Cyrillic confusables.
_CYRILLIC_TO_LATIN: dict[str, str] = {
    "а": "a", "А": "A",
    "е": "e", "Е": "E",
    "о": "o", "О": "O",
    "р": "p", "Р": "P",
    "с": "c", "С": "C",
    "х": "x", "Х": "X",
    "у": "y", "У": "Y",
    "і": "i", "І": "I",
    "ј": "j", "Ј": "J",
}


def _strip_unicode_confusables(value: str) -> str:
    """NFC-normalize and replace common Cyrillic→Latin confusables.

    Used as a recursive `before`-mode field validator on every string
    field of every model in this module. Keeps the LLM's output in pure
    ASCII-ish Latin so downstream pattern matches (token names, slug
    lookups, theme keys) don't silently miss.
    """
    if not value:
        return value
    normalized = unicodedata.normalize("NFC", value)
    return "".join(_CYRILLIC_TO_LATIN.get(ch, ch) for ch in normalized)


# Accepts canonical ``plan:<name>_v<n>.md`` artifact references OR an
# empty string (the design-importer prompt requests this artifact for
# the app-wide plan only; per-component plans are auto-overridden by the
# runner and the LLM is explicitly told NOT to emit them). Anything else
# is gibberish (rdzn62gx 2026-05-16 emitted ``"ID), .I. {id}"``).
_PLAN_ARTIFACT_RE = re.compile(r"^(plan:[a-z0-9_]+_v\d+\.md|)$")


class _DesignImportComponentPlanStub(BaseModel):
    """Slim per-entry schema for design-import ``creator_plan.component_plans``.

    The runner at ``runner.py::_synthesize_creator_plan`` overrides every
    structural ComponentPlan field (``name``, ``role``, ``page_slug``,
    ``page_title``, ``source_html_artifact``, and for Babel-shell pages
    ``source_jsx_artifact``) deterministically from ``plan.pages`` +
    ``plan.chrome``. It also prefers ``PageMapping.page_summary`` /
    ``page_short_summary`` over the per-entry values. The only fields the
    runner actually carries forward via ``**base`` merge — and which exist
    on the parent ``ComponentPlan`` so they survive Pydantic's default
    ``extra="ignore"`` — are ``image_references``, ``interactive_elements``,
    and ``form_ids``.

    Asking the LLM to author the full ComponentPlan field set just inflates
    the structured-output payload. App 8qfb42sm (2026-05-18) — a 10-page
    "School Dashboard" Claude-Design import — emitted 32,280 candidate
    tokens against the 32,768 ``max_output_tokens`` cap and was truncated
    488 tokens below the limit; the redundant ``component_plans`` field
    accounted for ~6-10K of that. This stub keeps only the load-bearing
    carry-overs plus ``page_slug`` / ``role`` as hints so the runner's
    ``by_slug`` / ``by_role`` lookup still finds the right entry.
    """

    page_slug: Optional[str] = Field(
        default=None,
        description=(
            "Hint for the runner's by_slug lookup so the carry-over fields "
            "below land on the correct page. Use the canonical slug "
            "(``\"\"`` for home, kebab-case otherwise). Set ``None`` for "
            "chrome roles."
        ),
    )
    role: Optional[Literal["header", "sidebar", "footer", "content"]] = Field(
        default=None,
        description=(
            "Hint for the runner's by_role lookup. The runner overwrites "
            "this field; provide it only so chrome carry-overs (e.g. an "
            "icon set referenced from the sidebar) attach to the right "
            "region."
        ),
    )
    image_references: list[str] = Field(
        default_factory=list,
        description=(
            "Exact image UUIDs from ``image_catalog_summary`` to bind to "
            "this component. Carried verbatim into the runner's synthesized "
            "ComponentPlan."
        ),
    )
    interactive_elements: list[str] = Field(
        default_factory=list,
        description=(
            "Short labels describing interactive elements in this "
            "component (charts, data tables, modals, filters, etc.). "
            "Carried verbatim — surfaces in downstream "
            "ComponentBuilderMultiple prompts."
        ),
    )
    form_ids: list[str] = Field(
        default_factory=list,
        description=(
            "Kebab-case form intent ids for any data-collection forms in "
            "this component (e.g. ``contact-inquiry``, ``newsletter-signup``). "
            "Carried verbatim."
        ),
    )


class _LenientCreatorOutput(CreatorOutput):
    """``CreatorOutput`` variant for the design-importer LLM.

    The deterministic runner overrides ``component_plans`` with inline
    ``building_plan`` after the LLM emits ``DecompositionPlan``. The
    importer's prompt explicitly forbids per-component plan artifacts
    ("DO NOT call save_plan_artifact for individual components — the
    runner overrides component_plans"), so its stub component_plans
    legitimately ship with empty ``building_plan_artifact`` for content
    rows.

    The parent validator is context-gated (silent unless the caller
    passes ``creator_strict=True``), so design-importer payloads already
    pass under ADK's default validation. This subclass guarantees they
    *also* pass when someone manually invokes strict mode — the override
    short-circuits before the strict check, regardless of context.

    Also tightens ``app_building_plan_artifact`` against gibberish
    (rdzn62gx LLM emitted ``"ID), .I. {id}"``) and NFC-normalizes /
    de-confuses Cyrillic-look-alike characters in every string field
    (rdzn62gx ``"high-cоntrast"`` with a Cyrillic ``о``).

    Also overrides ``component_plans`` with a slim per-entry stub. See
    ``_DesignImportComponentPlanStub`` for the rationale (8qfb42sm
    2026-05-18 truncation incident).
    """

    component_plans: list[_DesignImportComponentPlanStub] = Field(
        default_factory=list,
        description=(
            "Slim per-component carry-over hints. Emit an entry only when "
            "the component has image bindings, interactive elements, or "
            "form ids worth threading into the synthesized ComponentPlan. "
            "An empty list is acceptable — the runner builds every entry "
            "deterministically from ``pages`` + ``chrome``. DO NOT author "
            "page_summary / page_short_summary here; put them on "
            "``pages[*]`` (PageMapping)."
        ),
    )

    @model_validator(mode="after")
    def _enforce_artifact_for_content_pages(
        self, info: ValidationInfo
    ) -> "_LenientCreatorOutput":
        return self

    @model_validator(mode="after")
    def _scrub_unicode_confusables(
        self, info: ValidationInfo
    ) -> "_LenientCreatorOutput":
        """Walk every string field on the model + nested objects and
        normalize Unicode confusables. Idempotent."""
        for field_name in self.model_fields:
            value = getattr(self, field_name, None)
            cleaned = _walk_and_clean_strings(value)
            if cleaned is not value:
                try:
                    object.__setattr__(self, field_name, cleaned)
                except Exception:
                    pass
        return self

    @model_validator(mode="after")
    def _reject_gibberish_plan_artifact(
        self, info: ValidationInfo
    ) -> "_LenientCreatorOutput":
        """Replace a malformed ``app_building_plan_artifact`` with empty
        string rather than rejecting outright — the runner doesn't depend
        on this field for design imports (per the importer's prompt) and
        an empty value lets the build proceed. A hard ValueError would
        force the LLM to retry an otherwise-good plan."""
        artifact = getattr(self, "app_building_plan_artifact", "") or ""
        if not _PLAN_ARTIFACT_RE.match(artifact.strip()):
            try:
                object.__setattr__(self, "app_building_plan_artifact", "")
            except Exception:
                pass
        return self


def _walk_and_clean_strings(value):
    """Recursive helper for ``_scrub_unicode_confusables`` — walks
    str / list / dict / BaseModel and replaces every string in place."""
    if isinstance(value, str):
        return _strip_unicode_confusables(value)
    if isinstance(value, list):
        new_list = [_walk_and_clean_strings(item) for item in value]
        return new_list if any(a is not b for a, b in zip(new_list, value)) else value
    if isinstance(value, dict):
        new_dict = {k: _walk_and_clean_strings(v) for k, v in value.items()}
        return new_dict if any(
            new_dict[k] is not value[k] for k in value
        ) else value
    if isinstance(value, BaseModel):
        for f in value.model_fields:
            current = getattr(value, f, None)
            cleaned = _walk_and_clean_strings(current)
            if cleaned is not current:
                try:
                    object.__setattr__(value, f, cleaned)
                except Exception:
                    pass
        return value
    return value


class PageMapping(BaseModel):
    """One staged bundle HTML mapped to one cleaned page artifact."""

    bundle_artifact: str = Field(
        description=(
            "Source artifact key. Must already exist in the artifact store "
            "and start with ``bundle:html:``. Example: "
            "``bundle:html:home_happydoods_farm/code.html``."
        ),
    )
    output_artifact: str = Field(
        description=(
            "Cleaned-page artifact key the runner will write. Must match "
            "``content::page.html`` (homepage) or "
            "``content:<kebab-slug>:page.html``."
        ),
    )
    page_slug: str = Field(
        description=(
            "Canonical slug. Empty string for the homepage; otherwise "
            "kebab-case (``a-z0-9`` plus ``-``)."
        ),
    )
    page_route: str = Field(
        description="Route path. ``/`` for the homepage, otherwise ``/<slug>``.",
    )
    page_title: str = Field(description="Human-readable page title for navigation.")

    @field_validator("page_route", "page_slug", mode="before")
    @classmethod
    def _strip_whitespace(cls, value: object) -> object:
        """Defensive strip on string fields the LLM occasionally pads with
        a leading space (e.g. ``" /"`` instead of ``"/"``). Downstream
        ``_route_literal_for_slug`` recovers correctly, but stripping
        here keeps logs clean and avoids leaking whitespace into slug
        canonicalization edge cases."""
        if isinstance(value, str):
            return value.strip()
        return value
    page_summary: str = Field(
        default="",
        description="Long-form summary surfaced into the synthesized creator plan.",
    )
    page_short_summary: str = Field(
        default="",
        description="Short summary surfaced into the synthesized creator plan.",
    )
    script_artifact: Optional[str] = Field(
        default=None,
        description=(
            "When the page is a Babel-shell (``<div id=\"root\"/>`` plus "
            "``<script type=\"text/babel\" src=\"…\">`` siblings), this points "
            "at the staged ``bundle:script:<relpath>`` whose body the JSX "
            "translator should treat as the page's React source. Set this "
            "ONLY for Babel-shell pages; leave ``None`` for normal HTML "
            "pages so the existing html_to_tsx pipeline runs unchanged."
        ),
    )
    script_mode: Optional[Literal["babel-shell"]] = Field(
        default=None,
        description=(
            "Tag identifying which JSX translator path the runner should "
            "use. Currently only ``babel-shell`` is supported. ``None`` "
            "means the page is plain HTML and goes through the standard "
            "html_to_tsx mechanical pipeline."
        ),
    )


class ChromeRegion(BaseModel):
    """Header / sidebar / footer extraction directive."""

    role: Literal["header", "sidebar", "footer"] = Field(
        description="Chrome role. The runner emits one ComponentPlan per role."
    )
    output_artifact: str = Field(
        description=(
            "Where the runner writes the cleaned chrome markup. Must match "
            "``content:main:{header,sidebar,footer}.html``."
        ),
    )
    source_artifact: str = Field(
        description=(
            "Staged bundle artifact key whose markup contains the chrome "
            "(typically ``bundle:doc:partials.html`` for Claude Design or "
            "any per-page ``bundle:html:*`` for Stitch)."
        ),
    )
    selector: str = Field(
        description=(
            "CSS selector that picks the chrome region out of the source "
            "document. Example: ``header.topbar`` or ``footer``."
        ),
    )
    delete_from_pages: bool = Field(
        default=True,
        description=(
            "When True (default), the runner also deletes nodes matching "
            "``selector`` from every per-page output so chrome is not "
            "duplicated. Set False if the chrome only exists in the source "
            "artifact."
        ),
    )
    page_scope: str = Field(
        default="all",
        description=(
            "Per-page chrome scoping. Default ``\"all\"`` — the canonical "
            "chrome rendered on every page (existing behaviour). Set to a "
            "page slug (e.g. ``\"products\"`` or ``\"/\"`` for home) to "
            "emit a per-page chrome OVERRIDE — the runtime renders this "
            "in place of the canonical chrome for that page only. Used "
            "when the source design has page-specific chrome (e.g. a "
            "newsletter form in the products-page footer while other "
            "pages have an address block). Without per-page overrides, "
            "every page collapses to whichever footer the importer picked "
            "as canonical (RC#7 in app w4hov6ht's drift inventory, "
            "2026-05-16)."
        ),
    )


class M3Pillars(BaseModel):
    """The four colors that seed the entire M3 palette.

    Each field is either a source ``--var`` reference (``--barn``,
    ``--cream``, …) that the runner resolves against the bundle's lifted
    ``:root`` declarations, or a literal ``#rrggbb`` hex value. Anything
    else fails plan validation in the runner with a diagnostic listing
    the source vars that ARE present in the bundle.

    The runner derives the remaining 26 M3 tokens (containers, on-colors,
    surface tints, outlines, inverse, error pairs) from these four via
    :func:`compute_m3_palette`, with WCAG AA contrast guaranteed.
    """

    primary: str = Field(
        description=(
            "Brand-leading color. Source ``--var`` name (preferred) or "
            "literal ``#rrggbb``. Example: ``--barn``."
        ),
    )
    secondary: str = Field(
        description=(
            "Secondary accent. Source ``--var`` name or literal hex. " "Example: ``--moss``."
        ),
    )
    surface: str = Field(
        description=(
            "Page background / canvas tone. Source ``--var`` name or "
            "literal hex. Example: ``--cream``."
        ),
    )
    error: str = Field(
        description=(
            "Destructive / error tone. Source ``--var`` name or literal "
            "hex. Pick a clearly red-leaning value; if the design has no "
            "error color, use ``#DC2626``."
        ),
    )


class ThemePlan(BaseModel):
    """LLM-authored decisions about theme token derivation.

    The LLM picks four pillars; the runner derives the rest. Every source
    ``--var`` lifted from the bundle is also mirrored into ``@theme`` so
    verbatim ``var(--*)`` references in the lifted ``@layer exepad-app``
    block still resolve.
    """

    pillars: M3Pillars = Field(
        description=(
            "The four M3 seed colors. The runner derives the full 30-token "
            "palette from these via deterministic color math; the LLM does "
            "not need to provide on-* / container / surface-tint variants."
        ),
    )
    extra_theme_lines: list[str] = Field(
        default_factory=list,
        description=(
            "Extra ``--token: value`` declarations to append inside @theme "
            "(without the leading hyphens or the trailing semicolon). Use "
            "rarely — only when the bundle defines a token Tailwind v4 "
            "expects but the lifter cannot infer (custom radii, motion "
            "tokens, etc.)."
        ),
    )


class BackendModelSpec(BaseModel):
    """One model in the LLM-emitted ``backend_intent``.

    Columns are validated against ``ColumnPlan`` (shared with the
    code-focus backend builder) so the LLM cannot emit empty objects
    like ``{"columns": [{}]}`` and silently produce a zero-column model
    that BackendBuilder then materializes as nothing. Reproduced 2026-05-15
    on app r74zfpfj: DesignImporter (Flash) emitted ``[{}]`` for every
    model, the permissive ``list[dict]`` accepted it, the backend ended up
    empty. ColumnPlan requires ``name`` (no default) so empty dicts are
    now rejected by Pydantic at parse time.
    """

    name: str
    columns: list[ColumnPlan] = Field(default_factory=list)


class BackendHandlerSpec(BaseModel):
    """Per ``_shared.md:172``: ``type`` is ``email|crud|platform_auth``.

    Forms typically don't need a custom handler at all — platform forms are
    stored via ``services.forms.definitions``. Emit a backend handler only
    when the form requires a side-effect platform forms can't model (e.g.
    a signup that enqueues a welcome email with a computed gift code).
    """

    name: str
    type: Literal["email", "crud", "platform_auth"]
    trigger: Literal["form", "list"] = "form"


class BackendIntent(BaseModel):
    """Pass-through schema written verbatim into ``design_import/backend-intent.json``."""

    models: list[BackendModelSpec] = Field(default_factory=list)
    handlers: list[BackendHandlerSpec] = Field(default_factory=list)
    seeds: dict[str, list[dict]] = Field(default_factory=dict)


class DecompositionPlan(BaseModel):
    """The LLM's full output schema for the design importer.

    Replaces the older ``DesignImporterOutput``. The runner reads this plan,
    deterministically produces every ``content:*.html`` and the theme CSS
    from the staged ``bundle:*`` source bytes, and writes the synthesized
    creator plan into session state.
    """

    format: Literal["claude_design", "stitch"] = Field(
        description=(
            "Source bundle format. Single-canvas Claude Design is obsolete "
            "and the runner refuses bundles staged in that mode."
        ),
    )
    pages: list[PageMapping] = Field(
        ...,
        min_length=1,
        description=(
            "One PageMapping per page in the imported site. Must contain at "
            "least one entry. Every entry's ``bundle_artifact`` MUST resolve "
            "to a staged artifact key."
        ),
    )
    chrome: list[ChromeRegion] = Field(default_factory=list)
    theme: ThemePlan
    navigation: dict = Field(
        description=(
            "Body of ``design_import/navigation.json``: "
            "``{routes: [{path,page_slug,title}], default: <slug>}``."
        ),
    )
    backend_intent: Optional[BackendIntent] = Field(
        default=None,
        description=(
            "Optional. When present, the runner saves it as "
            "``design_import/backend-intent.json``. Skip when no dynamic "
            "models or forms were inferred."
        ),
    )
    notes: str = Field(
        default="",
        description=(
            "Markdown notes. Saved as ``design_import/notes.md``. Use this "
            "to flag ambiguities, unmatched ``.ph`` labels, or other "
            "import caveats."
        ),
    )
    creator_plan: _LenientCreatorOutput = Field(
        description=(
            "Creator-compatible plan. The runner patches two fields after "
            "the LLM authors the rest:\n"
            "  * ``component_plans`` — re-pointed at the artifacts the "
            "runner deterministically emitted (so ``source_html_artifact`` "
            "always references real files).\n"
            "  * ``design_system.{primary,secondary,surface,error}_color`` "
            "and font fields — overwritten with the resolved theme tokens.\n"
            "Every other field (``reasoning``, ``app_name``, "
            "``app_building_plan``, ``app_security_plan``, "
            "``app_favicon_svg``, ``design_system.design_style``, etc.) is "
            "kept verbatim from the LLM."
        ),
    )
