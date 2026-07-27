"""Typo fixes for component TSX auto-fix.

Covers:

- Undeclared JSX handler references (``onClick={saveAllAllDirty}`` →
  ``onClick={saveAllDirty}``) via fuzzy-match against declared identifiers.
- ``useModel('Xs')`` / ``useHandler('Xs')`` / ``setState('Xs')`` string-argument
  typos against the known model / handler / state-key sets.
- ``navigate('/path')`` / ``href="/path"`` typos against the app's page slugs.
"""

from __future__ import annotations

import re
from difflib import get_close_matches

from main_agent.services.validation.fixers._context import FixContext

# Auth-shaped tokens that should map to the canonical ``/logout`` route.
# Matches ``logout``, ``log-out``, ``log_out``, ``signout``, ``sign-out``,
# ``logoff`` (case-insensitive). Anchored so ``logo`` / ``logon`` /
# ``signal`` don't match.
_AUTH_LOGOUT_TOKEN = re.compile(
    r"(?:^|[/_\-])(?:log[\-_]?out|sign[\-_]?out|logoff)/?$",
    re.IGNORECASE,
)
# Symmetric for ``/login``: ``login``, ``log-in``, ``log_in``, ``signin``,
# ``sign-in``, ``signon``.
_AUTH_LOGIN_TOKEN = re.compile(
    r"(?:^|[/_\-])(?:log[\-_]?in|sign[\-_]?in|signon)/?$",
    re.IGNORECASE,
)


def _normalise_auth_path(bare_path: str) -> str | None:
    """Return ``/logout`` / ``/login`` if ``bare_path`` looks auth-shaped.

    ``bare_path`` is the navigate / href target with any leading ``/``
    stripped (e.g. ``"_auth/logout"``, ``"auth/sign-out"``, ``"logoff"``).
    The platform mounts canonical ``/logout`` and ``/login`` routes, but
    the LLM frequently hallucinates backend-shaped variants. Returning
    the canonical form lets the typo fixer redirect them BEFORE the
    fallback pass silently rewrites them to the homepage.

    Returns ``None`` when the path doesn't look auth-shaped.
    """
    if _AUTH_LOGOUT_TOKEN.search(bare_path):
        return "/logout"
    if _AUTH_LOGIN_TOKEN.search(bare_path):
        return "/login"
    return None


def apply_component_typos_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    models = ctx.models
    handlers = ctx.handlers
    state_keys = ctx.state_keys
    page_slugs = ctx.page_slugs

    # Undeclared JSX handler reference fuzzy-fix: saveAllAllDirty → saveAllDirty
    # Collect declared identifiers for fuzzy matching
    declared_ids: set[str] = set()
    for dm in re.finditer(r"(?:const|let|var)\s+(\w+)", tsx):
        declared_ids.add(dm.group(1))
    for dm in re.finditer(r"function\s+(\w+)", tsx):
        declared_ids.add(dm.group(1))

    handler_ref_pat = re.compile(r"(on[A-Z]\w*=\{)(\w+)(\})")

    def _fix_handler_ref(m):
        prefix, ref, suffix = m.group(1), m.group(2), m.group(3)
        if ref not in declared_ids:
            close = get_close_matches(ref, list(declared_ids), n=1, cutoff=0.8)
            if close:
                fixes_applied.append(f"Typo: {prefix}{ref}{suffix} → {prefix}{close[0]}{suffix}")
                return f"{prefix}{close[0]}{suffix}"
        return m.group(0)

    tsx = handler_ref_pat.sub(_fix_handler_ref, tsx)

    # Typo fixes — SCOPED to specific SDK call patterns, not global string replace.
    model_names = {m["name"] for m in models} if models else set()

    def fix_model_typo(m):
        ref = m.group(1)
        if ref not in model_names:
            close = get_close_matches(ref, list(model_names), n=1, cutoff=0.8)
            if close:
                fixes_applied.append(f"Typo: useModel('{ref}') → useModel('{close[0]}')")
                return m.group(0).replace(ref, close[0])
        return m.group(0)

    if model_names:
        tsx = re.sub(r"(?<![\w$.])useModel\s*\(\s*['\"]([^'\"]+)['\"]", fix_model_typo, tsx)

    handler_names = (
        {h["name"] for h in (handlers or []) if isinstance(h, dict)} if handlers else set()
    )

    def fix_handler_typo(m):
        ref = m.group(1)
        if ref not in handler_names:
            close = get_close_matches(ref, list(handler_names), n=1, cutoff=0.8)
            if close:
                fixes_applied.append(f"Typo: useHandler('{ref}') → useHandler('{close[0]}')")
                return m.group(0).replace(ref, close[0])
        return m.group(0)

    if handler_names:
        tsx = re.sub(r"(?<![\w$.])useHandler\s*\(\s*['\"]([^'\"]+)['\"]", fix_handler_typo, tsx)

    state_key_set = set(state_keys.keys()) if isinstance(state_keys, dict) else set()

    def fix_state_typo(m):
        ref = m.group(1)
        if ref not in state_key_set:
            close = get_close_matches(ref, list(state_key_set), n=1, cutoff=0.8)
            if close:
                fixes_applied.append(f"Typo: setState('{ref}') → setState('{close[0]}')")
                return m.group(0).replace(ref, close[0])
        return m.group(0)

    if state_key_set:
        tsx = re.sub(r"setState\s*\(\s*['\"]([^'\"]+)['\"]", fix_state_typo, tsx)

    # Auto-fix navigate() path typos — use fuzzy matching to correct page slug
    # typos instead of flagging as error and requiring LLM retry.
    #
    # Slug normalisation: callers pass ``page_slugs`` in either form —
    # bare (``"products"``) or absolute (``"/products"``). The SDK's
    # ``navigate()`` and ``<Link>`` require the absolute form because the
    # basePath prepend only happens for paths that start with ``/``. The
    # bare-slug fixer (``component_urls_images``) runs earlier in the
    # same pass and prepends ``/`` to LLM-emitted bare slugs; if we then
    # treat ``/products`` as "unknown" here and fuzzy-match back to the
    # bare ``products``, we undo that fix and ship broken navigation
    # (browser concatenates basePath and bare slug without a separator
    # → ``/a/preview-xyzproducts``).
    #
    # Fix: normalise every slug on both sides by stripping a single
    # leading ``/`` before comparison, and always emit the canonical
    # absolute form (``"/" + match``) when we DO rewrite a typo — so a
    # subsequent bare-slug pass is unnecessary and the SDK sees an
    # absolute path.
    if page_slugs:

        def _normalise(slug: str) -> str:
            if slug.startswith("/"):
                return slug[1:]
            return slug

        bare_page_slugs = [_normalise(s) for s in page_slugs]
        page_slug_set = set(bare_page_slugs)
        system_routes = {"/logout", "/login", "/signup", "/register", "/"}
        external_prefixes = ("http://", "https://", "#", "mailto:", "tel:", "//")

        def _fix_navigate_path(m: re.Match) -> str:
            prefix = m.group(1)  # e.g. "navigate('" or 'href="'
            path = m.group(2)
            suffix = m.group(3)
            if path in system_routes:
                return m.group(0)
            if "${" in path or "$" in path:
                return m.group(0)  # Dynamic path
            if path.startswith(external_prefixes):
                return m.group(0)  # External / fragment / mailto / tel
            bare_path = _normalise(path)
            if bare_path in page_slug_set:
                return m.group(0)
            # Auth-shaped path normalisation. The platform mounts canonical
            # ``/logout`` and ``/login`` routes (LogoutHandler / LoginForm in
            # ClientPageRenderer); the LLM frequently emits Django- or
            # backend-shaped variants (``/_auth/logout``, ``/auth/sign-out``,
            # ``/logoff``, ``/sign-in``). Recognise these BEFORE the
            # fuzzy/fallback pass, otherwise the fallback below silently
            # rewrites them to the first declared page — shipping a logout
            # button that goes to the dashboard instead of logging out.
            auth_target = _normalise_auth_path(bare_path)
            if auth_target is not None:
                fixes_applied.append(
                    f"Normalised auth-shaped path '{path}' → '{auth_target}' "
                    f"(canonical platform route)"
                )
                return f"{prefix}{auth_target}{suffix}"
            close = get_close_matches(bare_path, bare_page_slugs, n=1, cutoff=0.6)
            if close:
                corrected = "/" + close[0] if close[0] else "/"
                fixes_applied.append(f"Fixed navigate path typo: '{path}' → '{corrected}'")
                return f"{prefix}{corrected}{suffix}"
            # Zero fuzzy-match — the generated nav target has no plausible
            # counterpart in the plan (e.g. sidebar with ghost `/my-tasks`,
            # `/sprints`, `/analytics` links when only `/` exists). Rewrite
            # to the first declared page so the link is a harmless redirect
            # to home instead of a 404 dead end.
            fallback_bare = bare_page_slugs[0] if bare_page_slugs else ""
            fallback = "/" + fallback_bare if fallback_bare else "/"
            fixes_applied.append(
                f"Rewrote unresolved navigate path '{path}' → '{fallback}' "
                f"(no matching page in plan; redirecting to first page)"
            )
            return f"{prefix}{fallback}{suffix}"

        tsx = re.sub(
            r"""((?:handle)?[Nn]avigate\s*\(\s*['"])([^'"]+)(['"])""",
            _fix_navigate_path,
            tsx,
        )
        tsx = re.sub(
            r"""(href[:=]\s*['"])([^'"]+)(['"])""",
            lambda m: (_fix_navigate_path(m) if m.group(2).startswith("/") else m.group(0)),
            tsx,
        )

    return tsx
