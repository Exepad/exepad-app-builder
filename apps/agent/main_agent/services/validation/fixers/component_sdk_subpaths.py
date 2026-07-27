"""Split a component's bare ``@exepad/sdk`` barrel import into subpath imports.

The SDK ships as a bare ``@exepad/sdk`` barrel (the global import-map target,
byte-frozen because immutable deployed apps depend on it) PLUS additive,
per-entry subpath chunks::

    @exepad/sdk/core      cheap UI + platform hooks + helpers (the default)
    @exepad/sdk/charts    recharts namespace + chart wrappers
    @exepad/sdk/motion    framer-motion + motion presets
    @exepad/sdk/forms     Calendar / InputOTP / Command / Drawer / Carousel
    @exepad/sdk/overlays  Dialog / Sheet / Popover / Tooltip / DropdownMenu / …
    @exepad/sdk/icons     curated lucide ``Icons`` namespace (~76 KB gzip)

The LLM keeps emitting the simple, reliable ``import { X, Y } from '@exepad/sdk'``
contract. This fixer — running LAST, after every other import fixer has settled
the bare-barrel statement — rewrites it into per-subpath imports so a page that
uses only cheap UI never downloads/parses the 443 KB-gzip monolith.

Why this is safe / additive:
- The routing table (``load_sdk_subpaths``) is generated from the SDK entry
  source, with a build gate (``check-split-chunks.mjs``) asserting every runtime
  export is routed to exactly one subpath and none leak into core.
- A symbol the table doesn't know (e.g. an unstripped hallucination) is LEFT on
  the bare ``@exepad/sdk`` barrel — identical to today's behaviour for that name.
- ``tsc`` resolves the subpaths via the staged ``node_modules/@exepad/sdk``
  ``exports`` map (``tsc_validator/runner.py``); narrowing of ``useModel`` etc.
  flows through the subpath re-export of the augmented ``@exepad/sdk`` module.
- The dispatcher's per-fixer rollback re-parses the output with esbuild, so a
  malformed rewrite reverts to the bare barrel rather than shipping broken TSX.

Gate it off entirely with ``EXEPAD_SDK_SPLIT_IMPORTS=0``.
"""

from __future__ import annotations

import os
import re

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.tsx_ast.catalog import load_sdk_subpaths

# Bare-barrel import statement. The closing quote class ``['"]@exepad/sdk['"]``
# matches ONLY the bare specifier — ``@exepad/sdk/core`` etc. never match (their
# slash falls outside the quote), so re-running this fixer is a no-op.
_BARE_SDK_IMPORT_RE = re.compile(
    r"import\s+(?P<typeonly>type\s+)?\{(?P<names>[^}]*)\}\s*from\s*['\"]@exepad/sdk['\"]\s*;?"
)

# Deterministic emission order: core first (the common case), then the heavy
# entries, then any residual names kept on the bare barrel.
_SUBPATH_ORDER = (
    "@exepad/sdk/core",
    "@exepad/sdk/charts",
    "@exepad/sdk/motion",
    "@exepad/sdk/forms",
    "@exepad/sdk/overlays",
    "@exepad/sdk/icons",
)

_BARE = "@exepad/sdk"

_DISABLED_VALUES = {"0", "false", "no", "off", ""}


def _split_enabled() -> bool:
    """True unless ``EXEPAD_SDK_SPLIT_IMPORTS`` is explicitly disabled."""
    return os.environ.get("EXEPAD_SDK_SPLIT_IMPORTS", "1").strip().lower() not in _DISABLED_VALUES


def _exported_name(spec: str) -> str:
    """The ``@exepad/sdk`` export name a specifier imports (the routing key).

    ``Button``            → ``Button``
    ``motion as Motion``  → ``motion``  (the source name, before ``as``)
    ``type CarouselApi``  → ``CarouselApi``
    """
    s = spec.strip()
    s = re.sub(r"^type\s+", "", s)
    # Split on ` as ` — the source/export name is the part BEFORE the alias.
    return re.split(r"\s+as\s+", s, maxsplit=1)[0].strip()


def split_sdk_barrel(tsx: str) -> tuple[str, list[str]]:
    """Rewrite a bare ``@exepad/sdk`` import into per-subpath imports.

    Returns ``(new_tsx, fixes)``. ``fixes`` is empty (and ``new_tsx is tsx``)
    when the split is disabled, the routing table is unavailable, there is no
    bare-barrel import, or nothing in it is recognised — every one of those is
    a safe no-op that leaves the monolith-resolving barrel in place.

    This is the canonical entry point, called explicitly from the component
    SAVE seams (NOT from ``apply_auto_fixes`` — see dispatcher.py). It is
    idempotent: already-split code has no bare barrel left to match.
    """
    if not _split_enabled():
        return tsx, []

    table = load_sdk_subpaths()
    if not table:
        return tsx, []

    matches = list(_BARE_SDK_IMPORT_RE.finditer(tsx))
    if not matches:
        return tsx, []

    # Collect specifiers across every bare-barrel statement. A whole-statement
    # ``import type { … }`` is normalised to per-specifier inline ``type``
    # qualifiers so the rewrite emits a single import form per subpath.
    buckets: dict[str, list[str]] = {}
    residual: list[str] = []
    routed_any = False

    for m in matches:
        type_only = bool(m.group("typeonly"))
        for raw in m.group("names").split(","):
            spec = raw.strip()
            if not spec:
                continue
            if type_only and not spec.startswith("type "):
                spec = f"type {spec}"
            name = _exported_name(spec)
            subpath = table.get(name)
            if subpath is None:
                residual.append(spec)
            else:
                buckets.setdefault(subpath, []).append(spec)
                routed_any = True

    # Nothing recognised → leave the file exactly as-is (no churn, no risk).
    if not routed_any:
        return tsx, []

    # Build the replacement block in deterministic order.
    lines: list[str] = []
    ordered_subpaths = [sp for sp in _SUBPATH_ORDER if sp in buckets]
    # Any subpath not in the known order (future entry) appended sorted.
    ordered_subpaths += sorted(sp for sp in buckets if sp not in _SUBPATH_ORDER)
    for sp in ordered_subpaths:
        specs = ", ".join(sorted(set(buckets[sp])))
        lines.append(f"import {{ {specs} }} from '{sp}';")
    if residual:
        specs = ", ".join(sorted(set(residual)))
        lines.append(f"import {{ {specs} }} from '{_BARE}';")
    block = "\n".join(lines)

    # Replace the first bare-barrel statement with the block; delete the rest
    # (consuming one trailing newline each so no blank lines pile up). Work
    # right-to-left so earlier spans stay valid.
    out = tsx
    for idx in range(len(matches) - 1, -1, -1):
        m = matches[idx]
        start, end = m.start(), m.end()
        if idx == 0:
            out = out[:start] + block + out[end:]
        else:
            if end < len(out) and out[end] == "\n":
                end += 1
            out = out[:start] + out[end:]

    pretty = ", ".join(sp.rsplit("/", 1)[-1] for sp in ordered_subpaths)
    return out, [f"Split @exepad/sdk barrel import into subpaths: {pretty}"]


def apply_component_sdk_subpath_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    """Fixer-signature adapter around :func:`split_sdk_barrel`.

    Kept for unit tests and any future inclusion in a fixer pipeline; the
    production save seams call :func:`split_sdk_barrel` directly. ``ctx`` is
    unused (the split needs only the source + the routing table).
    """
    out, fixes = split_sdk_barrel(tsx)
    fixes_applied.extend(fixes)
    return out
