"""Declarative registry of forbidden JS/DOM APIs and the policy for each.

Every entry MUST declare at least one of:
  - has_auto_fix=True   — a deterministic rewrite exists in fixers/
  - retry_guidance      — prose hint surfaced to the LLM on retry

The invariant is enforced at module-load time so a new forbidden-API rule
can never be introduced without ALSO providing a recovery strategy. This
closes the gap that killed the Onix Studio HomeContent build: the
``addEventListener`` rule existed, but had no auto-fix and no targeted
retry guidance, so the LLM regenerated the same antipattern three times.

The registry is metadata only. Detection logic lives in
``services/validation/tsx_ast/rules/forbidden_apis.py`` (AST-based) and
``services/validation/fixers/component_forbidden_apis.py`` /
``component_polishing.py`` (deterministic rewrites). This module is the
single source of truth for the per-api error message and retry guidance
those layers reference.

Pattern A's retry-feedback builder consults ``get(api_id).retry_guidance``
to compose targeted suggestions when a rule fires repeatedly.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ForbiddenApi:
    """Policy entry for a single forbidden JS/DOM API.

    Fields:
        api_id: Matches the ``emit()`` key used by the AST rule in
            ``forbidden_apis.py`` (e.g. ``"addEventListener"``,
            ``"console_log"``, ``"call:eval"``).
        error_message: Verbatim text emitted by the rule. Mirrored here
            so the registry is the single source of truth.
        has_auto_fix: True iff a deterministic rewrite for this pattern
            exists in the fixers/ directory. Documents the policy
            without coupling the registry to fixer implementations.
        retry_guidance: Targeted hint for the LLM when surgical/regenerate
            retry is invoked for this rule. Should describe the *pattern*
            to use instead — copy-pasteable code is ideal.
    """

    api_id: str
    error_message: str
    has_auto_fix: bool = False
    retry_guidance: str | None = None

    def __post_init__(self) -> None:
        if not (self.has_auto_fix or self.retry_guidance):
            raise ValueError(
                f"ForbiddenApi {self.api_id!r} must declare either "
                f"has_auto_fix=True or retry_guidance — at least one "
                f"recovery path must exist for every forbidden rule."
            )


_REGISTRY: dict[str, ForbiddenApi] = {}


def _register(api: ForbiddenApi) -> ForbiddenApi:
    if api.api_id in _REGISTRY:
        raise ValueError(f"Duplicate ForbiddenApi.api_id: {api.api_id!r}")
    _REGISTRY[api.api_id] = api
    return api


def get(api_id: str) -> ForbiddenApi | None:
    """Return the registered entry for ``api_id`` (None if not registered)."""
    return _REGISTRY.get(api_id)


def all_apis() -> tuple[ForbiddenApi, ...]:
    """Return all registered entries (frozen view, stable order)."""
    return tuple(_REGISTRY.values())


# ─────────────────────────────────────────────────────────────────────
# Initial registry — mirrors the rules in
# ``services/validation/tsx_ast/rules/forbidden_apis.py``. Each entry's
# ``api_id`` matches the ``emit()`` key used there so the AST rule can
# look up the canonical error message and retry guidance.
# ─────────────────────────────────────────────────────────────────────


_register(
    ForbiddenApi(
        api_id="addEventListener",
        error_message=(
            "addEventListener() bypasses React's event system — use React "
            "synthetic events (onClick, onChange, onScroll) or useEffect with refs"
        ),
        has_auto_fix=False,
        retry_guidance=(
            "Replace `window.addEventListener('X', fn)` with the React `onX` "
            "prop on the matching JSX element. For events without a synthetic "
            "equivalent, use a ref + useEffect:\n"
            "  const ref = useRef(null);\n"
            "  useEffect(() => {\n"
            "    const el = ref.current;\n"
            "    if (!el) return;\n"
            "    el.addEventListener('X', fn);\n"
            "    return () => el.removeEventListener('X', fn);\n"
            "  }, []);\n"
            "Note: keydown/keyup/keypress/scroll/resize on window/document "
            "ARE whitelisted when passed as a string literal — only those "
            "events may use addEventListener directly."
        ),
    )
)


_register(
    ForbiddenApi(
        api_id="console_log",
        error_message="console.log() is forbidden — remove debug logging",
        has_auto_fix=True,  # see _strip_console_calls in component_forbidden_apis.py
        retry_guidance=(
            "Remove ALL console.log/warn/error/info/debug() calls from the "
            "component. They are forbidden in production code."
        ),
    )
)


_register(
    ForbiddenApi(
        api_id="dom_access",
        error_message="Direct document access — use React refs",
        has_auto_fix=False,
        retry_guidance=(
            "Replace `document.getElementById/querySelector/createElement` "
            "with `React.useRef(...)` and attach the ref in JSX:\n"
            "  const myRef = React.useRef(null);\n"
            "  // ...\n"
            "  <div ref={myRef}>...</div>"
        ),
    )
)


_register(
    ForbiddenApi(
        api_id="fetch",
        error_message=(
            "fetch() forbidden — use useModel(model).create() for entity "
            "submissions or useHandler(name) for custom RPC"
        ),
        has_auto_fix=False,
        retry_guidance=(
            "Replace `fetch(...)` with the appropriate SDK hook from `@exepad/sdk`:\n"
            "  - `useModel('model_name').create({...})` for inserting rows in your model\n"
            "  - `useHandler('handler_name')` for custom RPC calls\n"
            "Whitelisted destinations (r2.exepad.com, exepad.com/apps) "
            "are still allowed for binary uploads where SDK hooks don't apply."
        ),
    )
)


_register(
    ForbiddenApi(
        api_id="cn",
        error_message=(
            "cn() forbidden in Code Focus — tailwind-merge won't recognize " "custom classes"
        ),
        has_auto_fix=True,  # see apply_component_polishing_fixes
        retry_guidance=(
            "Remove the `cn(...)` wrapper. Use a plain string for static "
            "classes, or a template literal for conditionals:\n"
            "  // before: className={cn('btn', isActive && 'active')}\n"
            "  // after:  className={`btn ${isActive ? 'active' : ''}`}"
        ),
    )
)


_register(
    ForbiddenApi(
        api_id="call:eval",
        error_message="eval() is forbidden",
        has_auto_fix=False,
        retry_guidance=(
            "`eval()` is never permitted. Refactor to use real JS expressions, "
            "JSON.parse for data, or a function call instead of dynamic code "
            "evaluation."
        ),
    )
)


_register(
    ForbiddenApi(
        api_id="new:Function",
        error_message="new Function() is forbidden",
        has_auto_fix=False,
        retry_guidance=(
            "`new Function(...)` builds executable code from a string and is "
            "never permitted. Replace with a regular function declaration."
        ),
    )
)


_register(
    ForbiddenApi(
        api_id="new:XMLHttpRequest",
        error_message="XMLHttpRequest forbidden — use SDK hooks",
        has_auto_fix=False,
        retry_guidance=(
            "Replace `new XMLHttpRequest()` with `useModel('name')` (reads) "
            "or `useHandler('name')` (writes) from `@exepad/sdk`."
        ),
    )
)


_register(
    ForbiddenApi(
        api_id="ident:localStorage",
        error_message="localStorage is forbidden",
        has_auto_fix=False,
        retry_guidance=(
            "Replace `localStorage` with platform state. Persistent values "
            "go through `useModel`/`useHandler` (server-backed). For "
            "in-session shared state, use `useApp(state => state.X)`."
        ),
    )
)


_register(
    ForbiddenApi(
        api_id="ident:sessionStorage",
        error_message="sessionStorage is forbidden",
        has_auto_fix=False,
        retry_guidance=(
            "Replace `sessionStorage` with `useApp(state => state.X)` for "
            "in-session shared state, or with `useModel`/`useHandler` for "
            "server-backed persistence."
        ),
    )
)


_register(
    ForbiddenApi(
        api_id="url_create_object_url",
        error_message=(
            "URL.createObjectURL() forbidden — use downloadFile() or "
            "downloadCsv() from @exepad/sdk for file exports"
        ),
        has_auto_fix=False,
        retry_guidance=(
            "Building a Blob URL + anchor click to trigger a download is the "
            "antipattern that ``downloadFile`` exists to replace. Use:\n"
            "  import { downloadFile, downloadCsv } from '@exepad/sdk';\n"
            "  downloadFile('report.csv', csvContent, 'text/csv');\n"
            "  // OR, for a list of row objects:\n"
            "  downloadCsv('users.csv', users);\n"
            "These helpers handle MIME types, anchor cleanup, and URL "
            "revocation so the agent doesn't have to."
        ),
    )
)


_register(
    ForbiddenApi(
        api_id="body_style_mutation",
        error_message=(
            "document.body.style.* mutation forbidden — use useBodyScrollLock() "
            "or set the style on the relevant JSX element instead"
        ),
        has_auto_fix=False,
        retry_guidance=(
            "Direct mutation of `document.body.style.*` leaks state across "
            "components (e.g. scroll-lock never restored on unmount, "
            "padding-right left behind). Use the sanctioned SDK hook for "
            "scroll lock, and for everything else, render the style on the "
            "element itself:\n"
            "  // BEFORE:\n"
            "  useEffect(() => {\n"
            "    document.body.style.overflow = isOpen ? 'hidden' : '';\n"
            "  }, [isOpen]);\n"
            "  // AFTER:\n"
            "  import { useBodyScrollLock } from '@exepad/sdk';\n"
            "  useBodyScrollLock(isOpen);"
        ),
    )
)


_register(
    ForbiddenApi(
        api_id="window_location",
        error_message="window.location mutation forbidden — use navigate()",
        has_auto_fix=True,  # see apply_component_forbidden_api_fixes
        retry_guidance=(
            "Replace `window.location = X`, `window.location.href = X`, "
            "`window.location.assign(X)`, `window.location.replace(X)`, "
            "and `window.location.reload()` "
            "with `navigate(X)` (imported from `@exepad/sdk`). For form "
            "resets, set local state back to its initial values instead "
            "of reloading the page."
        ),
    )
)


_register(
    ForbiddenApi(
        api_id="innerhtml",
        error_message="innerHTML forbidden — use React JSX",
        has_auto_fix=False,
        retry_guidance=(
            "Never assign to `.innerHTML`. Render the content as JSX "
            "instead — React escapes text safely and tracks the DOM."
        ),
    )
)
