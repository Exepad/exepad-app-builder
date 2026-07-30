"""Platform catalogs used by the advisory AST rules.

**Component-facing catalogs** (image domains, M3 tokens, Tailwind hex map,
SDK hook nullable schema, status words, lucide icon list, SDK export list)
live further down in this module. They back both the AST rules and the
regex fall-backs in ``services.validation.regex_checks``, so both sides
stay in lock-step when a catalog changes.
"""

from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path

import structlog

from .._env import require_in_production

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Platform-owned D1 tables — reserved table name catalogs.
# ---------------------------------------------------------------------------
#
# Handlers may reference some of these via raw SQL (e.g. ``_auth_users`` for
# auth handlers). These lists are the canonical source of truth; the AST
# rules read them from here.

PLATFORM_TABLES_RAW_ALLOWED: frozenset[str] = frozenset(
    {
        "_auth_users",
        "_auth_sessions",
        "_auth_accounts",
        "_auth_verification_tokens",
        "_auth_api_keys",
        "_files",
    }
)

# Table → helper the LLM should use instead of raw SQL. No platform tables
# are routed through a helper today; the platform exposes ``sys_*`` CRUD and
# custom handlers over user-defined tables only.
PLATFORM_TABLES_HELPER_ONLY: dict[str, str] = {}


# ---------------------------------------------------------------------------
# System columns every platform-managed D1 table carries.
# ---------------------------------------------------------------------------
#
# The app-backend CRUD layer injects these on create and exposes them on
# reads even when the declared model omits them, so qualified SQL
# references like ``guests.created_at`` must not be flagged as undeclared.
# Keep this in sync with the CRUD implementation in
# ``apps/app-backend/src/crud/``.

PLATFORM_SYSTEM_COLUMNS: frozenset[str] = frozenset(
    {
        "rowid",
        "id",
        "created_at",
        "updated_at",
        "owner_id",
    }
)


# ---------------------------------------------------------------------------
# Import allow-list — shared by handler and component rule sets.
# ---------------------------------------------------------------------------

ALLOWED_IMPORT_SOURCES: frozenset[str] = frozenset({"@exepad/sdk"})


# ---------------------------------------------------------------------------
# Extension package allow-list — frontend COMPONENTS only (not handlers).
# ---------------------------------------------------------------------------
#
# Generated components may import a small, vetted set of runtime "extension"
# packages in addition to ``@exepad/sdk``. These resolve in the browser via
# the static import map injected from the runtime's extension registry
# (``apps/runtime/client/src/lib/extensionRegistry.ts`` →
# ``vite-plugin-ext-importmap.ts``) and survive the deploy bundle because the
# component bundler externalizes ``@exepad/*``
# (``packages/deploy-utils/src/bundle/components.ts``).
#
# Scope rules (keep this list TIGHT):
#   * EXACT specifier match only — NO subpaths. The esm.sh ``three`` build
#     ships the core only; ``@exepad/ext-three/addons/...`` (OrbitControls,
#     loaders, …) is NOT resolvable, so subpath imports must still be
#     rejected. The import rule treats this set as exact (see
#     ``ImportsNonSdkRule(allowed_exact=...)``), unlike the prefix-matched
#     ``ALLOWED_IMPORT_SOURCES`` which intentionally allows ``@exepad/sdk/*``.
#   * COMPONENTS only — wired into ``component_rules()``; handlers run on the
#     backend (no import map, separate bundle) and keep the SDK-only policy.
#   * The matching ambient-module shim for the tsc Stage-1.5 gate is built
#     from THIS set in ``tsc_validator/runner.py`` so the two never drift.
#
# Currently enabled: the 3D / WebGL pair from the registry. Widen only with a
# doc + skill + test for the added package (the agent must know how to use it).
# KEEP IN SYNC with ``apps/runtime/client/src/lib/extensionRegistry.ts`` and
# ``packages/exepad-sdk/src/ext.d.ts``.
ALLOWED_EXTENSION_IMPORTS: frozenset[str] = frozenset(
    {
        "@exepad/ext-three",  # Three.js r0.170 — WebGL 3D engine (games, viewers)
        "@exepad/ext-pixi",  # Pixi.js 8 — WebGL 2D renderer
    }
)


# ---------------------------------------------------------------------------
# ExepadImage defaults — component auto-fix fallback.
# ---------------------------------------------------------------------------

# Five-word fallback that satisfies the keyword minimum check when the
# generator emitted an ``<ExepadImage>`` without keywords or alt text.
EXEPAD_IMAGE_FALLBACK_KEYWORDS: str = "abstract soft gradient background with warm natural lighting"


# ---------------------------------------------------------------------------
# Lucide icon catalog (shipped as a JSON asset alongside this module).
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def load_lucide_icons() -> frozenset[str]:
    """Return the complete set of valid ``lucide-react`` icon names.

    The list lives in ``services/validation/valid_lucide_icons.json``.

    - **Dev:** missing/unreadable → empty set; callers treat the icon
      check as disabled.
    - **Production:** missing/unreadable raises
      :class:`ProductionDependencyMissing`. Without the catalog the
      icon-rescue helper can't work and React-#130 crashes ship —
      ``ze1ltmf9`` failure mode.

    Raises:
        ProductionDependencyMissing: When the file is missing/unreadable
            and ``ENVIRONMENT=production``.
    """
    path = Path(__file__).resolve().parents[1] / "valid_lucide_icons.json"
    try:
        with open(path) as f:
            return frozenset(json.load(f))
    except Exception:
        # Production fails loud: this file is committed in the agent
        # source tree, so a missing/unreadable load means the source
        # tree is broken. Without the catalog the icon-rescue helper
        # can't work and React-#130 crashes ship — the ``ze1ltmf9``
        # failure mode.
        require_in_production(
            dependency="valid_lucide_icons.json",
            hint=(
                "This file is committed at "
                "apps/agent/main_agent/services/validation/valid_lucide_icons.json. "
                "If it's missing the source tree is broken — rebuild the "
                "agent container."
            ),
        )
        logger.warning("valid_lucide_icons.json not loadable — icon catalog empty")
        return frozenset()


# ---------------------------------------------------------------------------
# SDK export catalog — generated by the exepad-sdk build.
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def load_sdk_exports() -> frozenset[str]:
    """Return the flat list of names exported from ``@exepad/sdk``.

    The list is produced by the SDK build at
    ``packages/exepad-sdk/dist/sdk-exports.json``. It is used to detect
    JSX elements whose PascalCase tag name resolves to an SDK symbol that
    the component forgot to import.

    Includes BOTH ``flat`` (named exports — functions, components,
    individual values) AND ``namespaces`` (top-level namespace objects
    like ``Icons``, ``Charts``, ``Motion``). The earlier
    flat-only version caused a noisy add+strip loop in the import
    auto-fixer: ``Icons`` was missing from the catalog so the strip pass
    removed it, then the hardcoded fallback list re-added it on the
    same pass. Net result was the same (import survived) but the log
    contradicted itself on every component using ``<Icons.X/>``.

    - **Dev:** missing/unreadable → empty frozenset; the auto-fixer's
      allow-list is empty so import-stripping is disabled (safe, just
      less precise).
    - **Production:** missing/unreadable raises
      :class:`ProductionDependencyMissing`. With an empty allow-list
      the auto-fixer would strip every ``@exepad/sdk`` import — the
      ``ze1ltmf9`` failure mode.

    Raises:
        ProductionDependencyMissing: When no candidate path resolves to
            a readable JSON catalog and ``ENVIRONMENT=production``.
    """
    # Container layout (Dockerfile vendors into /packages/...) first,
    # then walk up from this file for the monorepo dev layout.
    candidates: list[Path] = [Path("/packages/exepad-sdk/dist/sdk-exports.json")]
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidates.append(parent / "packages" / "exepad-sdk" / "dist" / "sdk-exports.json")

    for path in candidates:
        try:
            if path.is_file():
                with open(path) as f:
                    data = json.load(f)
                names: set[str] = set(data.get("flat", []))
                # Namespace keys (Icons, Charts, Motion) are top-level
                # importable objects; ``_`` is an internal root and is
                # filtered out.
                names.update(
                    ns for ns in data.get("namespaces", {}).keys() if ns and not ns.startswith("_")
                )
                return frozenset(names)
        except Exception:
            continue

    # Production fails loud: deploy-agent.sh vendors sdk-exports.json from
    # packages/exepad-sdk/dist/. A missing/unreadable catalog means the
    # auto-fixer's allow-list is empty and every @exepad/sdk import gets
    # stripped silently — the failure mode that shipped React-#130 crashes
    # in app ``ze1ltmf9``. Refuse to start with empty catalog in prod.
    require_in_production(
        dependency="sdk-exports.json",
        hint=(
            "deploy-agent.sh vendors this from packages/exepad-sdk/dist/ — "
            "a missing/unreadable catalog means the auto-fixer would strip "
            "every @exepad/sdk import. Run `pnpm build:sdk` and redeploy."
        ),
    )
    logger.warning("sdk-exports.json not loadable — SDK completeness catalog empty")
    return frozenset()


@lru_cache(maxsize=1)
def load_sdk_subpaths() -> dict[str, str]:
    """Return the symbol → subpath-specifier routing table for import splitting.

    Maps each public SDK symbol to the additive subpath entry that exports
    it, e.g. ``{"Charts": "@exepad/sdk/charts", "Button": "@exepad/sdk/core",
    "Icons": "@exepad/sdk/icons", ...}``. Produced by the SDK build at
    ``packages/exepad-sdk/dist/sdk-subpaths.json`` (generated from
    ``src/entries/*.ts`` by ``scripts/gen-subpaths.mjs``, so it can never
    drift from what the chunks actually export).

    The ``component_sdk_subpaths`` auto-fixer uses this to rewrite a
    generated component's bare ``import { ... } from '@exepad/sdk'`` into
    per-subpath imports, so a core-only page never downloads/parses the
    443 KB-gzip monolith.

    **Fail-open by design (unlike** :func:`load_sdk_exports` **).** The split
    is a pure performance optimization, not a correctness gate: if the table
    is missing or unreadable the fixer simply leaves the bare barrel in place
    (the monolith still resolves every symbol via the global import map). So
    this returns an empty dict on any failure in *every* environment —
    degrading to "no split" is always safe, whereas hard-failing the agent
    over a perf table would be strictly worse.
    """
    candidates: list[Path] = [Path("/packages/exepad-sdk/dist/sdk-subpaths.json")]
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidates.append(parent / "packages" / "exepad-sdk" / "dist" / "sdk-subpaths.json")

    for path in candidates:
        try:
            if path.is_file():
                with open(path) as f:
                    data = json.load(f)
                table: dict[str, str] = {}
                for subpath, names in (data.get("entries") or {}).items():
                    if not isinstance(subpath, str) or not isinstance(names, list):
                        continue
                    for name in names:
                        if isinstance(name, str) and name:
                            # First writer wins; the SDK build gate guarantees
                            # no symbol is listed under two subpaths.
                            table.setdefault(name, subpath)
                return table
        except Exception:
            continue

    logger.info("sdk-subpaths.json not loadable — import splitting disabled (bare barrel kept)")
    return {}


# ---------------------------------------------------------------------------
# Layout offset patterns — regex-only, but catalogued here so the single
# source of truth matches the AST/rule ecosystem.
# ---------------------------------------------------------------------------

LAYOUT_OFFSET_PATTERNS: tuple[tuple[str, str], ...] = (
    (
        r"(?:left|ml|margin-left)-64\b",
        "Hardcoded sidebar offset (left-64) — content is in a flex container, no offset needed",
    ),
    (
        r"(?:left|ml|margin-left)-\[256px\]",
        "Hardcoded sidebar offset [256px] — content is in a flex container, no offset needed",
    ),
)


# ---------------------------------------------------------------------------
# Radix ``*Trigger`` components that wrap their child in Slot under
# ``asChild``. Used by the auto-fix that rewrites mixed icon+text children
# into a single ``<span>`` so React's Children.only does not reject them.
# ---------------------------------------------------------------------------

TRIGGER_ASCHILD_COMPONENTS: tuple[str, ...] = (
    "DialogTrigger",
    "AlertDialogTrigger",
    "PopoverTrigger",
    "SheetTrigger",
    "TooltipTrigger",
    "DropdownMenuTrigger",
    "HoverCardTrigger",
    "CollapsibleTrigger",
    "ContextMenuTrigger",
    "MenubarTrigger",
    "NavigationMenuTrigger",
    "AccordionTrigger",
    "SelectTrigger",
)


# ---------------------------------------------------------------------------
# Image domain lists — used by the hallucinated-URL check and the URL
# rewriter that replaces unlicensed sources with ``__PLACEHOLDER__``.
# ---------------------------------------------------------------------------

# Operators (especially self-host) can extend this via the
# ``ALLOWED_IMAGE_DOMAINS`` env var (whitespace- and/or comma-separated)
# so locally-hosted image hosts aren't rewritten to ``__PLACEHOLDER__``.
ALLOWED_IMAGE_DOMAINS: frozenset[str] = frozenset(
    {
        "storage.googleapis.com",
        "lh3.googleusercontent.com",
        "googleusercontent.com",
        "exepad.com",
        "fonts.googleapis.com",
        "fonts.gstatic.com",
        # Lorem Picsum — keyless, hotlink-safe, deterministic. The keyless
        # fallback provider (see image_generation_utils.get_image_from_picsum),
        # so its URLs must survive the auto-fixer instead of being stripped.
        "picsum.photos",
        # Openverse — keyless Creative-Commons fallback. The resolver embeds
        # its ``api.openverse.org`` thumbnail URLs, which must survive the
        # auto-fixer (nothing re-sources a keyless provider's own URL).
        "api.openverse.org",
    }
    | {
        entry.strip()
        for entry in re.split(r"[\s,]+", os.getenv("ALLOWED_IMAGE_DOMAINS", ""))
        if entry.strip()
    }
)

HALLUCINATED_IMAGE_DOMAINS: frozenset[str] = frozenset(
    {
        "unsplash.com",
        "images.unsplash.com",
        "source.unsplash.com",
        "placeholder.com",
        "via.placeholder.com",
        "placehold.co",
        "placehold.it",
        "placekitten.com",
        "placecorgi.com",
        "dummyimage.com",
        "lorempixel.com",
        "loremflickr.com",
        "fakeimg.pl",
        "pravatar.cc",
        "randomuser.me",
        "cloudinary.com",
        "imgur.com",
        "b2bpic.net",
        "img.b2bpic.net",
        "shutterstock.com",
        "image.shutterstock.com",
        "istockphoto.com",
        "media.istockphoto.com",
        "gettyimages.com",
        "media.gettyimages.com",
        "stock.adobe.com",
        "depositphotos.com",
        "st.depositphotos.com",
        "dreamstime.com",
        "123rf.com",
        "freepik.com",
        "img.freepik.com",
        # NOTE: pexels.com / images.pexels.com AND pixabay.com / cdn.pixabay.com
        # are intentionally NOT here — Pexels and Pixabay are FREE fetch
        # providers, so a provider-valid URL from either must not be flagged as
        # a hallucination. (When a key IS configured the resolver still owns
        # sourcing via the "unknown" path; when none is, the URL is kept
        # verbatim.)
        "stocksnap.io",
        "rawpixel.com",
    }
)


# ---------------------------------------------------------------------------
# SDK hook nullable-field schema — ``{hook_name: {nullable field names}}``.
# ---------------------------------------------------------------------------
#
# ``useCurrentUser()`` returns ``{id: null, email: null, name: null}`` for
# anonymous users. Component rules and auto-fixes inject optional chaining
# based on this schema.

SDK_HOOK_NULLABLE_FIELDS: dict[str, frozenset[str]] = {
    "useCurrentUser": frozenset({"id", "email", "name"}),
}


# ---------------------------------------------------------------------------
# Status-word catalog — canonical lowercase enum values and their
# title-case siblings. Drives the auto-fix that rewrites ``"Paid"`` → ``"paid"``
# on save/update calls.
# ---------------------------------------------------------------------------

STATUS_WORDS_LOWER: frozenset[str] = frozenset(
    {
        "paid",
        "pending",
        "sent",
        "draft",
        "overdue",
        "active",
        "inactive",
        "completed",
        "cancelled",
        "failed",
        "approved",
        "rejected",
        "open",
        "closed",
        "processing",
        "shipped",
        "delivered",
        "refunded",
        "archived",
    }
)

STATUS_WORDS_TITLE: frozenset[str] = frozenset(w.capitalize() for w in STATUS_WORDS_LOWER)


# ---------------------------------------------------------------------------
# Tailwind palette → hex mapping, used by contrast math.
# ---------------------------------------------------------------------------
#
# Only the palette values that the LLM regularly picks for text/background
# pairs. Extend as new collisions are discovered in production.

TAILWIND_HEX_MAP: dict[str, str] = {
    "black": "#000000",
    "white": "#ffffff",
    "slate-50": "#f8fafc",
    "slate-100": "#f1f5f9",
    "slate-200": "#e2e8f0",
    "slate-300": "#cbd5e1",
    "slate-400": "#94a3b8",
    "slate-500": "#64748b",
    "slate-600": "#475569",
    "slate-700": "#334155",
    "slate-800": "#1e293b",
    "slate-900": "#0f172a",
    "gray-50": "#f9fafb",
    "gray-100": "#f3f4f6",
    "gray-200": "#e5e7eb",
    "gray-300": "#d1d5db",
    "gray-400": "#9ca3af",
    "gray-500": "#6b7280",
    "gray-600": "#4b5563",
    "gray-700": "#374151",
    "gray-800": "#1f2937",
    "gray-900": "#111827",
    "zinc-50": "#fafafa",
    "zinc-100": "#f4f4f5",
    "zinc-200": "#e4e4e7",
    "zinc-300": "#d4d4d8",
    "zinc-400": "#a1a1aa",
    "zinc-500": "#71717a",
    "zinc-600": "#52525b",
    "zinc-700": "#3f3f46",
    "zinc-800": "#27272a",
    "zinc-900": "#18181b",
    "red-50": "#fef2f2",
    "red-100": "#fee2e2",
    "red-600": "#dc2626",
    "red-700": "#b91c1c",
    "orange-50": "#fff7ed",
    "orange-100": "#ffedd5",
    "orange-600": "#ea580c",
    "amber-50": "#fffbeb",
    "amber-100": "#fef3c7",
    "amber-600": "#d97706",
    "yellow-50": "#fefce8",
    "yellow-100": "#fef9c3",
    "green-50": "#f0fdf4",
    "green-100": "#dcfce7",
    "green-600": "#16a34a",
    "green-700": "#15803d",
    "emerald-50": "#ecfdf5",
    "emerald-100": "#d1fae5",
    "emerald-600": "#059669",
    "teal-50": "#f0fdfa",
    "teal-100": "#ccfbf1",
    "teal-600": "#0d9488",
    "cyan-50": "#ecfeff",
    "cyan-100": "#cffafe",
    "sky-50": "#f0f9ff",
    "sky-100": "#e0f2fe",
    "blue-50": "#eff6ff",
    "blue-100": "#dbeafe",
    "blue-500": "#3b82f6",
    "blue-600": "#2563eb",
    "blue-700": "#1d4ed8",
    "indigo-50": "#eef2ff",
    "indigo-100": "#e0e7ff",
    "indigo-600": "#4f46e5",
    "violet-50": "#f5f3ff",
    "violet-100": "#ede9fe",
    "violet-600": "#7c3aed",
    "purple-50": "#faf5ff",
    "purple-100": "#f3e8ff",
    "purple-600": "#9333ea",
    "pink-50": "#fdf2f8",
    "pink-100": "#fce7f3",
    "pink-600": "#db2777",
    "rose-50": "#fff1f2",
    "rose-100": "#ffe4e6",
    "rose-600": "#e11d48",
}


# ---------------------------------------------------------------------------
# Material 3 semantic-token catalogs — conservative fallbacks when the
# runtime theme palette is missing a token.
# ---------------------------------------------------------------------------

M3_LIGHT_HEX_FALLBACKS: dict[str, str] = {
    "surface": "#ffffff",
    "background": "#ffffff",
    "surface-variant": "#f1f5f9",
    "surface-container": "#f8fafc",
    "surface-container-low": "#f8fafc",
    "surface-container-high": "#f1f5f9",
    "surface-container-highest": "#e2e8f0",
    "surface-container-lowest": "#ffffff",
    "primary-container": "#dbeafe",
    "secondary-container": "#d1fae5",
    "tertiary-container": "#ede9fe",
    "error-container": "#fee2e2",
    "primary-fixed": "#dbeafe",
    "secondary-fixed": "#d1fae5",
    "tertiary-fixed": "#ede9fe",
    "on-surface": "#1c1b1f",
    "on-surface-variant": "#49454f",
    "on-background": "#1c1b1f",
    "on-primary": "#ffffff",
    "on-secondary": "#ffffff",
    "on-tertiary": "#ffffff",
    "on-error": "#ffffff",
    "on-primary-container": "#1c1b1f",
    "on-secondary-container": "#1c1b1f",
    "on-tertiary-container": "#1c1b1f",
    "on-error-container": "#1c1b1f",
    "on-primary-fixed": "#1c1b1f",
    "on-secondary-fixed": "#1c1b1f",
    "on-tertiary-fixed": "#1c1b1f",
    "inverse-surface": "#1c1b1f",
    "inverse-on-surface": "#ffffff",
}

M3_REFERENCE_LIGHT_TEXT: str = "#ffffff"
M3_REFERENCE_DARK_TEXT: str = "#1c1b1f"

# Semantic bg-token → expected on-token pairing.
M3_BG_TO_TEXT: dict[str, str] = {
    "primary": "on-primary",
    "secondary": "on-secondary",
    "tertiary": "on-tertiary",
    "error": "on-error",
    "surface": "on-surface",
    "background": "on-background",
    "primary-container": "on-primary-container",
    "secondary-container": "on-secondary-container",
    "tertiary-container": "on-tertiary-container",
    "error-container": "on-error-container",
    "primary-fixed": "on-primary-fixed",
    "secondary-fixed": "on-secondary-fixed",
    "tertiary-fixed": "on-tertiary-fixed",
    "surface-variant": "on-surface-variant",
    "surface-container": "on-surface",
    "surface-container-low": "on-surface",
    "surface-container-high": "on-surface",
    "surface-container-highest": "on-surface",
    "surface-container-lowest": "on-surface",
    "inverse-surface": "inverse-on-surface",
}

# Inverse mapping for text-token → bg-token lookups.
M3_TEXT_TO_BG: dict[str, str] = {
    text_token: bg_token for bg_token, text_token in M3_BG_TO_TEXT.items() if text_token
}

# Surface tokens the contrast walker treats as explicitly light.
M3_LIGHT_ANCESTOR_TOKENS: frozenset[str] = frozenset(
    {
        "surface",
        "white",
        "background",
        "surface-variant",
        "surface-container",
        "surface-container-low",
        "surface-container-high",
        "surface-container-highest",
        "surface-container-lowest",
        "primary-container",
        "secondary-container",
        "tertiary-container",
        "error-container",
        # Fixed tones pin to the container shade — light tints, dark on-* text.
        "primary-fixed",
        "secondary-fixed",
        "tertiary-fixed",
    }
)

# Surface tokens the contrast walker treats as explicitly dark. Tertiary is a
# saturated accent derived from primary+secondary, so it mirrors their scoping.
M3_DARK_ANCESTOR_TOKENS: frozenset[str] = frozenset({"primary", "secondary", "tertiary", "error"})

# Every token that may legitimately appear as a ``bg-*`` class — decides
# whether a className contributes to ancestor scoping at all.
M3_BG_TOKENS: frozenset[str] = (
    M3_LIGHT_ANCESTOR_TOKENS | M3_DARK_ANCESTOR_TOKENS | frozenset({"inverse-surface"})
)

# Every M3 token the validator recognizes — bgs, texts, and any token
# that appears in ``M3_BG_TO_TEXT`` / ``M3_TEXT_TO_BG`` on either side.
M3_TOKENS: frozenset[str] = frozenset(
    set(M3_LIGHT_HEX_FALLBACKS) | set(M3_BG_TO_TEXT) | set(M3_TEXT_TO_BG)
)
