"""Factory functions for the tsx_ast rule sets.

Three factories:

- ``shared_tsx_rules`` — rules whose logic is identical for handler TSX
  and component TSX (forbidden APIs, import allow-list). Included by
  both ``handler_rules()`` and ``component_rules()``.
- ``handler_rules`` — the shared set plus handler-only rules (export
  shape, handler signature, SQL, settings, services, return-fields).
- ``component_rules`` — the shared set plus component-only rules
  (hooks, refs, JSX, a11y, structure).

Order within each list is irrelevant — ``run_rules`` sorts findings by
``(severity, line, col)`` before returning — but the grouping here
keeps related rules together for scannability.

Adding a new rule: implement it in ``tsx_ast/rules/<name>.py``, import
it here, and append an instance to the matching factory.
"""

from __future__ import annotations

from ..catalog import ALLOWED_EXTENSION_IMPORTS
from .base import Rule
from .component_arbitrary_hex_color import ArbitraryHexColorRule
from .component_a11y import (
    ButtonAriaLabelRule,
    DialogDescriptionRule,
    HeadingOrderRule,
)
from .component_chart_field_match import ChartFieldMismatchRule
from .component_handler_output_unknown_field import HandlerOutputUnknownFieldRule
from .component_handler_param_match import HandlerParamsMismatchRule
from .component_hook_null_safety import UseCurrentUserNullableFieldChainRule
from .component_chart_units import FractionPercentMismatchRule
from .component_filter_enum_case import FilterEnumCaseMismatchRule
from .component_fk_id_label import FkIdAsLabelRule
from .component_hardcoded_activity_dates import HardcodedActivityDateRule
from .component_hardcoded_data import HardcodedKpiLiteralRule
from .component_hardcoded_overrides_usemodel import HardcodedOverridesUseModelRule
from .component_hero_contrast import HeroImageContrastRule
from .component_layout_policy import (
    AnimateInBareDurationRule,
    OverflowHiddenOnRootRule,
)
from .component_button_no_onclick import ButtonComponentNoOnClickRule
from .component_dead_action_button import DeadActionButtonRule
from .component_navigate_unknown_route import NavigateUnknownRouteRule
from .component_no_math_random import NoMathRandomInComponentRule
from .component_orphan_form_input import OrphanFormInputRule
from .component_raw_internal_anchor import RawInternalAnchorRule
from .exepad_image_dynamic_keywords_no_src import (
    ExepadImageDynamicKeywordsNoSrcRule,
)
from .material_symbols_leak import MaterialSymbolsLeakRule
from .component_hooks import (
    ConditionalHooksRule,
    HooksAfterEarlyReturnRule,
    UseAppSelectorRule,
)
from .component_imports import SdkImportCompletenessRule
from .component_inline_style_tag import InlineStyleTagRule
from .component_intl_format_arity import IntlNumberFormatExtraArgRule
from .component_invalid_font_weight import InvalidFontWeightRule
from .component_jsx import RawImgTagRule
from .component_sdk_format_method import SdkFormatMethodRule
from .component_sdk_required_props import SdkRequiredPropsRule
from .component_m3_colors import M3ColorPairingRule
from .component_refs import IconsUnknownRule
from .sdk_undeclared_call import SdkUndeclaredCallRule
from .component_route_h1 import PerRouteH1Rule
from .component_structure import ComponentExportNameRule
from .fail_loudly import PlanFailLoudlyRule
from .forbidden_apis import ForbiddenApiRule
from .forbidden_browser_apis import ForbiddenBrowserApiRule
from .handler_export import HandlerExportRule, HandlerSignatureRule
from .handler_owner_scope import HandlerOwnerFilterScopeMismatchRule
from .handler_sql_enum_case import HandlerSqlEnumCaseRule
from .imports import ImportsNonSdkRule
from .return_fields import ReturnMissingFieldRule
from .sql_dynamic_query import SqlDynamicQueryRule
from .sql_model_references import SqlUndeclaredTableRule
from .sql_parameterization import SqlParamInjectionRule
from .sql_undeclared_column import SqlUndeclaredColumnRule


def shared_tsx_rules(allowed_exact_imports: frozenset[str] = frozenset()) -> list[Rule]:
    """Rules that apply to every TSX artifact — handler OR component.

    The ``@exepad/sdk``-only import policy holds in both contexts. Components
    additionally admit a vetted extension set (``allowed_exact_imports``,
    passed by ``component_rules()``); handlers call with the default empty set
    and stay SDK-only — they run on the backend with no browser import map and
    a separate bundle, so an extension import there would silently break.

    ``ForbiddenApiRule`` is intentionally NOT in the shared list — it has a
    per-context flag (``useeffect_dom_exempt``) that handlers and components
    want set differently, so each factory instantiates it locally with the
    correct configuration.
    """
    return [
        ImportsNonSdkRule(allowed_exact=allowed_exact_imports),
    ]


def handler_rules() -> list[Rule]:
    """Rule set for handler TSX — shared rules plus handler-specific.

    Rule instances are stateless today, but returning a fresh list per
    call keeps the door open for stateful rules (e.g. rules that build a
    cache on first invocation).
    """
    return [
        *shared_tsx_rules(),
        # Forbidden-API catalogue — strict (no useEffect exemption;
        # handlers run on Workers and have no DOM whatsoever).
        ForbiddenApiRule(),
        # Runtime context — Workers has no DOM
        ForbiddenBrowserApiRule(),
        # Structural
        HandlerExportRule(),
        HandlerSignatureRule(),
        # Contract signalling from builder plans
        PlanFailLoudlyRule(),
        # Output integrity
        ReturnMissingFieldRule(),
        # SQL — blocking
        SqlParamInjectionRule(),
        SqlUndeclaredTableRule(),
        # Advisory (warning severity)
        SqlDynamicQueryRule(),
        SqlUndeclaredColumnRule(),
        # SQL literal vs declared enum_values casing — paired with the
        # handler_enum_case auto-fixer for deterministic resolution.
        HandlerSqlEnumCaseRule(),
        # Owner filter must respect ownerScope: shared-scoped tables
        # must NOT include `WHERE owner_id = ?` (the seed-time synthetic
        # owner never matches the request user, so the filter hides every
        # row). Backstops the handler-patterns-rpc skill update; warning
        # severity at first ship.
        HandlerOwnerFilterScopeMismatchRule(),
    ]


def component_rules() -> list[Rule]:
    """Rule set for component TSX — shared rules plus component-specific.

    Components may import the vetted runtime extension packages
    (``ALLOWED_EXTENSION_IMPORTS`` — e.g. ``@exepad/ext-three`` for WebGL 3D);
    the allowance is scoped here so it never reaches handler TSX.
    """
    return [
        *shared_tsx_rules(ALLOWED_EXTENSION_IMPORTS),
        # Forbidden-API catalogue — DOM patterns inside ``useEffect``
        # callbacks are allowed in components. The mechanical
        # design-import pipeline wraps source ``<script>`` bodies in a
        # single ``React.useEffect``, and idiomatic React itself uses
        # ``document.addEventListener`` and refs assigned via
        # ``getElementById`` lookups inside effects. ``eval`` / ``cn`` /
        # raw ``fetch`` / ``console.log`` / ``localStorage`` /
        # ``window.location`` mutation remain forbidden everywhere.
        ForbiddenApiRule(useeffect_dom_exempt=True),
        # Structural
        ComponentExportNameRule(),
        # Hook safety — Rules of Hooks, useApp selector form
        ConditionalHooksRule(),
        # Hooks after a conditional early return → React #300 render crash
        # (esbuild/tsc can't see it; this AST rule is the only guard).
        HooksAfterEarlyReturnRule(),
        UseAppSelectorRule(),
        # Cross-references — most cross-reference checks (unknown
        # model/handler/state/route/payload-fields, undeclared JSX refs,
        # null-safety on useModel/useApp) moved to the tsc Stage-1.5
        # gate. Icons stay AST-checked because the gate types
        # ``Icons`` as ``any``.
        IconsUnknownRule(),
        # JSX element shape
        RawImgTagRule(),
        # Raw ``<style>`` elements bypass the @layer exepad-app scope —
        # selectors apply globally and risk cross-component collisions.
        # Recommend Tailwind arbitrary classes or theme.css instead.
        InlineStyleTagRule(),
        # Required-prop checks for SDK components typed as ``any`` in
        # the tsc gate (per its scope: identifier/cross-ref only, never
        # JSX shape — see agent_sdk_gate.d.ts:11-19). Pairs with the
        # ``sdk_prop_renames`` fixer that auto-corrects common
        # hallucinations (e.g. ``value=`` → ``to=``) before this rule
        # sees the post-fix TSX.
        SdkRequiredPropsRule(),
        # ``format.X`` member access — ``format`` is date-fns (callable),
        # not an object. LLM hallucinates ``format.currency`` regularly.
        # Pairs with ``sdk_format_method`` fixer that auto-rewrites the
        # currency case; rule catches the rest (``.number``, ``.percent``).
        SdkFormatMethodRule(),
        SdkImportCompletenessRule(),
        # Call-expression sibling of `SdkImportCompletenessRule`: catches
        # bare SDK callable identifiers (hooks + functions) used without
        # import. JSX rule covers `<Foo>`; this rule covers `foo()`.
        # A hook called without importing it (e.g. `useModel(...)`) crashes
        # at runtime with ReferenceError → ErrorBoundary fallback hides the
        # whole component.
        SdkUndeclaredCallRule(),
        # M3 color-pairing — single walker pass emitting findings under
        # 5 historical rule_ids (component.m3.inverse_surface_pairing,
        # light_surface_inverse_text, dark_surface_light_text,
        # dark_bg_text_pairing, light_text_on_light_bg). Phase 5 merge.
        M3ColorPairingRule(),
        # Arbitrary hex Tailwind classes (`bg-[#0d9488]` / `text-[#hex]`)
        # bypass the M3 theme tokens. Warning severity — output renders
        # correctly, but theme swaps / white-label rebrands cannot
        # affect these classes. r3hfcgx5 OrdersContent shipped 5 of
        # these in status badges; the agent docs now include a recipe
        # using theme tokens (10_COLOR_AND_LAYOUT.md).
        ArbitraryHexColorRule(),
        # Accessibility advisories
        HeadingOrderRule(),
        ButtonAriaLabelRule(),
        DialogDescriptionRule(),
        # Each route page component must carry one <h1> heading.
        PerRouteH1Rule(),
        # Layout / animation policy (Phase 4 ports from semantic_validator)
        OverflowHiddenOnRootRule(),
        AnimateInBareDurationRule(),
        # Numeric font-weight utilities (`font-700`/`font-800`) silently
        # no-op in Tailwind v4 — paired with the typography auto-fixer
        # that rewrites them to the named utility.
        InvalidFontWeightRule(),
        # Hero contrast — light-text heading over image background needs
        # strong darkening (image filter OR ≥50% overlay).
        HeroImageContrastRule(),
        # Filter literal vs declared enum_values (case mismatch warning,
        # paired with the deterministic enum_case auto-fixer).
        FilterEnumCaseMismatchRule(),
        # FK id rendered as label inside a label-y JSX cell — reminds
        # the LLM to do the join (manual until PR-2 ships, then native).
        FkIdAsLabelRule(),
        # Chart Y-axis percent template paired with fraction-shaped dataKey.
        FractionPercentMismatchRule(),
        ChartFieldMismatchRule(),
        # Warning-severity sibling of the chart rule: any member access
        # on a useHandler() binding whose key isn't emitted by the
        # producer. Caught the ``opt.totalTco`` hallucination on app
        # n1aloggh that the chart rule missed because the read site
        # wasn't a chart dataKey.
        HandlerOutputUnknownFieldRule(),
        # Symmetric counterpart: useHandler('X', { params: { Y } })
        # must send keys that handler X actually reads via ctx.params.
        # Strict input validator otherwise rejects with VALIDATION_ERROR
        # ("Unrecognized key(s) in object: 'Y'") and the page never
        # loads. Caught the inert-tabs / unloaded-dashboard class on
        # app eiu7xj0v (2026-05-14). Warning severity at first ship;
        # escalate to error after replay confirms no false positives.
        HandlerParamsMismatchRule(),
        # SDK ``useCurrentUser()`` returns ``CurrentUser`` whose ``id``,
        # ``email``, and ``name`` fields are typed nullable. Chained
        # access (``user.email.toLowerCase()`` etc.) crashes on
        # anonymous users — flag missing optional chains. ``roles``
        # defaults to ``[]`` and ``isAuthenticated`` is boolean, so
        # those chains are safe. Warning severity at first ship.
        UseCurrentUserNullableFieldChainRule(),
        # KPI cards holding hardcoded literals (heuristic, warning-only).
        HardcodedKpiLiteralRule(),
        # Hardcoded data arrays (≥3 object literals) that shadow a
        # ``useModel('X')`` call in the same component — i9bm2ti4
        # (2026-05-16) PlansContent/BillingContent/CalendarContent
        # imported useModel for show but rendered hardcoded mock
        # arrays. Error-severity to force a corrective re-plan.
        HardcodedOverridesUseModelRule(),
        # Activity-feed-shaped JSX with hardcoded relative-time or
        # short-form date strings ("2h ago", "Yesterday", "Sep 24") —
        # almost always agent-imagined data not bound to any handler.
        HardcodedActivityDateRule(),
        # Form inputs whose ``name=`` attr is never read via
        # ``formData.get(...)`` — implies UI suggests a value will save
        # while the submit handler silently drops it.
        OrphanFormInputRule(),
        # Raw `<span class="material-symbols-outlined">{glyph}</span>` —
        # the runtime doesn't load the Material Symbols webfont, so the
        # span renders the literal glyph name as plain text. Error when
        # the file already imports `Icons` from `@exepad/sdk` (mixed
        # systems are a guaranteed user-visible bug), warning otherwise.
        # rdzn62gx Footer.tsx shipped three of these (2026-05-16).
        MaterialSymbolsLeakRule(),
        # `<ExepadImage keywords={dynamic} />` inside a `.map()` without
        # `src=` (or `vendor="catalog"`) renders a blank skeleton: the
        # runtime can't resolve dynamic per-row keywords to a deployed
        # asset. 9vvnqllg HomeContent "Latest Products" cards shipped
        # with empty image boxes for this exact reason.
        ExepadImageDynamicKeywordsNoSrcRule(),
        # ``*Button`` function components that swallow ``onClick`` —
        # caught at definition time, before three of them end up as
        # dead Quick Actions on a Dashboard.
        ButtonComponentNoOnClickRule(),
        # Direct ``<button>``/``<Button>`` JSX usages with action-verb
        # text but no onClick/href/type=submit binding — the user-visible
        # sibling pattern (r3hfcgx5 OrdersContent "Export CSV", 2026-05-14).
        DeadActionButtonRule(),
        # ``Math.random()`` in component bodies — random demo data leaks
        # into shipped charts/lists (r3hfcgx5 dashboard donut, 2026-05-14).
        # Doc says no (12_ANTI_PATTERNS.md '## No Math.random() in render')
        # but the LLM ignores it; error-severity block forces a corrective
        # re-plan.
        NoMathRandomInComponentRule(),
        # ``Intl.NumberFormat(...).format(a, b)`` — ``.format`` only takes
        # one argument; the LLM commonly passes a per-row currency as a
        # phantom second arg. Output renders in the constructor's
        # currency, not the row's. Warning severity (rendered output is
        # still legal currency, just wrong currency for some rows).
        IntlNumberFormatExtraArgRule(),
        # ``navigate("/X")`` targets a slug that isn't declared in
        # frontend.pages — usually a hallucinated platform pseudo-route
        # like ``/logout`` (r3hfcgx5 MainSidebar, 2026-05-14). Platform
        # pseudo-routes → error (use the SDK signOut/auth pattern);
        # generic unknown slugs → warning with available-slugs hint.
        NavigateUnknownRouteRule(),
        # An app is served under a basePath, so a raw <a href="/x"> resolves
        # against the ORIGIN and points outside the app — plain left-click is
        # saved by a navigate() onClick, but modifier-click / copy-link /
        # crawlers are not (Cedar Ridge Lodge MainHeader, 2026-07-25).
        RawInternalAnchorRule(),
    ]
