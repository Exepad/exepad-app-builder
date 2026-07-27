"""Dispatcher for the component-TSX auto-fix pass.

Thin orchestrator: builds a :class:`FixContext`, then hands it to each
category module in sequence. The per-category modules (``component_imports``,
``component_inline_styles``, ``component_urls_images``, ``component_m3_colors``,
``component_null_safety``, ``component_typos``, ``component_a11y_ux``,
``component_polishing``) own the actual fix logic.

Each category is run inside a per-fixer rollback wrapper. After the fixer
returns, ``validate_tsx_syntax`` re-parses the output via esbuild; on
failure the wrapper reverts the fixer's mutations and the pipeline
continues with the next category. Without this layer, a single
corrupting fixer poisons the whole batch and the end-of-pipeline gate's
Tier B fallback throws away every other fixer's safe mutations along
with the unsafe one — the failure mode that shipped React-#130 crashes
in app ``ze1ltmf9``.

Each fix message recorded on ``fixes_applied`` is prefixed with
``[<fixer>]`` so production logs are bisection-friendly: the fixer
that emitted any given fix is queryable by name.

The public entry point ``apply_auto_fixes`` preserves the exact signature
consumers already depend on.
"""

from __future__ import annotations

from typing import Callable

import structlog

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.fixers.component_a11y_ux import (
    apply_component_a11y_ux_fixes,
)
from main_agent.services.validation.fixers.component_enum_case import (
    apply_component_enum_case_fixes,
)
from main_agent.services.validation.fixers.component_dead_signout import (
    apply_component_dead_signout_fixes,
)
from main_agent.services.validation.fixers.component_react_hooks_from_sdk import (
    apply_component_react_hooks_from_sdk_fixes,
)
from main_agent.services.validation.fixers.component_forbidden_apis import (
    apply_component_forbidden_api_fixes,
)
from main_agent.services.validation.fixers.component_image_array_shape import (
    apply_component_image_array_shape_fixes,
)
from main_agent.services.validation.fixers.component_icons import (
    apply_component_icons_fixes,
)
from main_agent.services.validation.fixers.component_imports import (
    apply_component_imports_fixes,
)
from main_agent.services.validation.fixers.component_inline_styles import (
    apply_component_inline_styles_fixes,
)
from main_agent.services.validation.fixers.component_jsx_text_escapes import (
    apply_component_jsx_text_escape_fixes,
)
from main_agent.services.validation.fixers.component_m3_colors import (
    apply_component_m3_colors_fixes,
)
from main_agent.services.validation.fixers.component_null_safety import (
    apply_component_null_safety_fixes,
)
from main_agent.services.validation.fixers.component_polishing import (
    apply_component_polishing_fixes,
)
from main_agent.services.validation.fixers.component_redundant_json_parse import (
    apply_component_redundant_json_parse_fixes,
)
from main_agent.services.validation.fixers.component_sdk_format_method import (
    apply_component_sdk_format_method_fixes,
)
from main_agent.services.validation.fixers.component_sdk_prop_renames import (
    apply_component_sdk_prop_renames_fixes,
)
from main_agent.services.validation.fixers.component_typography import (
    apply_component_typography_fixes,
)
from main_agent.services.validation.fixers.component_typos import (
    apply_component_typos_fixes,
)
from main_agent.services.validation.fixers.component_urls_images import (
    apply_component_urls_images_fixes,
)
from main_agent.services.validation.syntax_validator import validate_tsx_syntax

logger = structlog.get_logger(__name__)


# Type alias for the uniform fixer signature (tsx, ctx, fixes_applied) -> tsx.
_Fixer = Callable[[str, FixContext, list[str]], str]


def _apply_with_rollback(
    name: str,
    fn: _Fixer,
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    """Run a fixer; revert its mutations if the output fails to parse.

    Per-fixer rollback prevents one corrupting fixer from poisoning the
    whole pipeline. Three failure modes handled:

    1. **Fixer raises:** logged, mutations reverted, pipeline continues.
    2. **Fixer output fails esbuild parse:** logged with the rolled-back
       fix list (so the offending fixer is named in production logs),
       mutations reverted, pipeline continues.
    3. **Fixer output is clean:** new fixes get an ``[<fixer>]`` prefix
       so logs surface which fixer emitted each entry.

    Note: when esbuild is not on PATH (dev environments), ``validate_tsx_syntax``
    fails open and returns ``(True, [])``. Per-fixer rollback then
    no-ops — same risk profile as today's pipeline. Production agents
    have esbuild vendored; Change C will make missing esbuild fail loud.
    """
    pre_tsx = tsx
    pre_fixes_len = len(fixes_applied)

    try:
        out = fn(tsx, ctx, fixes_applied)
    except Exception as exc:
        logger.error(
            "fixer_raised",
            fixer=name,
            error=str(exc),
            error_type=type(exc).__name__,
        )
        del fixes_applied[pre_fixes_len:]
        return pre_tsx

    valid, errors = validate_tsx_syntax(out)
    if not valid:
        rolled = list(fixes_applied[pre_fixes_len:])
        del fixes_applied[pre_fixes_len:]
        logger.error(
            "fixer_corrupted_jsx_rolled_back",
            fixer=name,
            errors=errors[:2],
            rolled_fixes=rolled,
        )
        return pre_tsx

    # Tag the new fix entries with the fixer name so production logs are
    # bisection-friendly. Each entry becomes ``"[<fixer>] <message>"``.
    new_fixes = fixes_applied[pre_fixes_len:]
    fixes_applied[pre_fixes_len:] = [
        f"[{name}] {msg}" if not msg.startswith("[") else msg for msg in new_fixes
    ]
    return out


# Ordered list of (name, fn) pairs. The order matters — see the comment
# in ``apply_auto_fixes`` for why ``forbidden_apis`` runs before
# ``imports`` and ``inline_styles`` runs before ``urls_images``.
_FIXER_PIPELINE: tuple[tuple[str, _Fixer], ...] = (
    # ``sdk_prop_renames`` runs FIRST: it rewrites SDK prop hallucinations
    # (e.g. ``<AnimatedCounter value=...>`` → ``to=``) which the
    # `component_sdk_required_props` AST rule would otherwise flag as a
    # missing required prop. Running before any other fixer keeps the
    # rewrite simple (no other fixer has changed the JSX yet) and means
    # downstream fixers see canonical prop names.
    ("sdk_prop_renames", apply_component_sdk_prop_renames_fixes),
    # ``sdk_format_method`` runs in the same opening group as the prop-rename
    # fixer: rewrites ``format.currency(N)`` → ``Intl.NumberFormat(...).format(N)``
    # before the ``component.sdk.format_method_invalid`` AST rule flags it.
    # SDK ``format`` is a date-fns callable, not an object — the LLM emits
    # ``format.currency`` regularly because Intl-style libs use that shape.
    ("sdk_format_method", apply_component_sdk_format_method_fixes),
    ("forbidden_apis", apply_component_forbidden_api_fixes),
    # ``react_hooks_from_sdk`` runs BEFORE ``imports``: it rewrites React hooks
    # the LLM imported from ``@exepad/sdk`` (``useState`` → ``React.useState``)
    # and ensures ``React`` is imported. Running before imports means the
    # introduced ``React.`` usage and the de-listed bare-hook import are
    # reconciled by the imports pass with no stale specifier left behind.
    ("react_hooks_from_sdk", apply_component_react_hooks_from_sdk_fixes),
    # ``dead_signout`` runs BEFORE ``imports``: it injects
    # ``onClick={() => navigate("/logout")}`` on unwired Sign-Out buttons,
    # introducing a ``navigate(`` usage that the imports pass then
    # auto-adds to the SDK import when missing (same hand-off as
    # ``forbidden_apis`` → ``imports``).
    ("dead_signout", apply_component_dead_signout_fixes),
    # ``icons`` runs BEFORE ``imports``: the rewrite introduces
    # ``<Icons.X/>`` JSX which then needs ``Icons`` in the SDK import.
    # The icons fixer adds it locally when an SDK import line exists; if
    # the file has no SDK import yet, ``imports`` will add a fresh
    # import block on the next slot.
    ("icons", apply_component_icons_fixes),
    ("imports", apply_component_imports_fixes),
    ("inline_styles", apply_component_inline_styles_fixes),
    # ``image_array_shape`` runs BEFORE ``urls_images``: rewriting bare
    # top-level ``keywords:`` array elements into the canonical
    # ``image: { keywords, importance }`` shape ensures the downstream
    # image resolver's array-aware regex matches every entry. Without
    # this, gallery-style data arrays render with empty placeholders.
    ("image_array_shape", apply_component_image_array_shape_fixes),
    ("urls_images", apply_component_urls_images_fixes),
    ("m3_colors", apply_component_m3_colors_fixes),
    ("null_safety", apply_component_null_safety_fixes),
    # ``redundant_json_parse`` removes the defensive ``JSON.parse(field
    # || "[]")`` pattern on columns declared ``type: "json"``. The
    # app-backend auto-parses those columns; the second branch crashes
    # with ``SyntaxError: "[object Object]" is not valid JSON`` whenever
    # the seed stored the value as an object. Gated on the model
    # schema so text-typed JSON-looking strings are left alone. First
    # surfaced on app alo48zsn (2026-05-15) PlansSubscriptions render.
    ("redundant_json_parse", apply_component_redundant_json_parse_fixes),
    # ``enum_case`` mutates string literal *contents* inside
    # ``useModel({ filters })`` arg objects; ``null_safety`` (chain
    # insertion) and ``typos`` (identifier fuzzy-match) don't touch
    # those byte ranges, so this slot is collision-free. Per-fixer
    # rollback covers any remaining blast radius.
    ("enum_case", apply_component_enum_case_fixes),
    ("typos", apply_component_typos_fixes),
    ("a11y_ux", apply_component_a11y_ux_fixes),
    # ``jsx_text_escapes`` decodes ``\uXXXX``/``\xXX`` that landed in JSX text
    # (renders literally — only string literals decode escapes). AST-scoped to
    # ``jsx_text`` nodes, so it never touches string/template literals or
    # ``{...}`` expressions. Late slot: content-only byte rewrite, no new
    # identifiers/imports.
    ("jsx_text_escapes", apply_component_jsx_text_escape_fixes),
    ("polishing", apply_component_polishing_fixes),
    # ``typography`` runs LAST: byte-level rewrites on className strings
    # (numeric font-NNN → named font-{weight}) that don't introduce new
    # identifiers or imports. Safe to place after every other category;
    # placing it after ``polishing`` ensures any classes synthesized by
    # earlier fixers are also normalized.
    #
    # NOTE: the ``@exepad/sdk`` barrel → subpath import split is intentionally
    # NOT a pipeline fixer. ``apply_auto_fixes`` must stay minimal/idempotent
    # on already-clean code (many callers and tests rely on that), and the
    # split is a deploy-targeting transform, not a correctness fix. It runs as
    # an explicit final step in the component SAVE seams instead — see
    # ``split_sdk_barrel`` (fixers/component_sdk_subpaths.py) and its call sites
    # in artifact_tools.py and importers/tools/jsx_to_tsx/dispatcher.py.
    ("typography", apply_component_typography_fixes),
)


def apply_auto_fixes(
    tsx: str,
    models: list[dict],
    actions: dict,
    state_keys: dict,
    expected_component_name: str = "",
    handlers: list[dict] | None = None,
    page_slugs: list[str] | None = None,
    theme_palette: dict[str, str] | None = None,
    stock_provider_configured: bool = True,
    security_enabled: bool = False,
) -> tuple[str, list[str]]:
    """Apply deterministic rewrites to a component TSX source.

    Each fixer category runs inside a per-fixer rollback gate: if its
    output fails esbuild parse, the mutation is reverted and the next
    fixer runs on the pre-mutation source. Safe fixers' mutations are
    preserved even if a later fixer corrupts.

    Pipeline order matters:

    - ``forbidden_apis`` runs BEFORE ``imports``: rewriting
      ``window.location.href = X`` to ``navigate(X)`` introduces a new
      ``navigate(`` usage that the imports fixer then auto-adds to the
      SDK import statement on the very next line.
    - ``inline_styles`` runs BEFORE ``urls_images``: downstream fixers
      and the post-fix syntax gate expect canonical JSX style objects
      with camelCase keys.

    Returns:
        ``(fixed_tsx, list_of_fixes_applied)``. Each fix message is
        prefixed with ``[<fixer>]`` for production-log bisection.
    """
    ctx = FixContext(
        expected_component_name=expected_component_name,
        models=models,
        handlers=handlers,
        state_keys=state_keys if isinstance(state_keys, dict) else {},
        page_slugs=page_slugs,
        theme_palette=theme_palette,
        stock_provider_configured=stock_provider_configured,
        security_enabled=security_enabled,
    )
    fixes_applied: list[str] = []

    for name, fn in _FIXER_PIPELINE:
        tsx = _apply_with_rollback(name, fn, tsx, ctx, fixes_applied)

    return tsx, fixes_applied
