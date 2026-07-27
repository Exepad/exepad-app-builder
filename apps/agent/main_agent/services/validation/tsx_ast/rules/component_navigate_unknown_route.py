"""``component.routing.navigate_unknown_route`` — ``navigate("/X")``
target must be a declared page slug.

The bug this catches
--------------------

App ``r3hfcgx5`` (2026-05-14): MainSidebar's user-profile chip wired
the logout icon to::

    <button onClick={() => navigate("/logout")}>...</button>

The app has 7 pages (``/`` / ``/inventory`` / ``/orders`` /
``/partners`` / ``/staff`` / ``/feedback`` / ``/settings``) — none
of them is ``/logout``. Clicking takes the user to a missing-route
state. Logout is a **platform** concern (the runtime SDK / Django
session) not a page-routable thing in the app.

Per ``03_COMPONENT_PATTERNS.md`` (auto-completes on typed literal
routes) and ``packages/types/`` (``WebAppProps`` route enum), the
target is statically resolvable in most cases — and almost every
``navigate("/logout")`` / ``navigate("/auth/login")`` /
``navigate("/profile")`` we've seen in agent output is a hallucinated
platform-shaped pseudo-route. This rule catches them.

Resolution shape
----------------

Two findings emitted depending on the target:

- ``navigate("/X")`` where ``/X`` looks like a platform pseudo-route
  (``/logout``, ``/sign-out``, ``/login``, ``/auth/...``) — emit
  **error** with the logout pattern hint (use ``useCurrentUser()``
  or platform auth flow).
- ``navigate("/Y")`` where ``/Y`` is a static literal AND is NOT in
  ``ctx.page_slugs`` AND is NOT a query-string variant of a known
  slug (``/orders?id=...``) — emit **warning** ("unknown route").

Dynamic targets — ``navigate(href)``, ``navigate(`/orders/${id}`)``,
``navigate(buildUrl(...))`` — are skipped entirely. We can't analyse
them statically and the false-positive cost outweighs the catch rate.

Fail-open
---------

If ``ctx.page_slugs`` is ``None`` or empty (e.g. handler-rule context,
validation pre-Creator run) the rule short-circuits. We'd rather miss
a navigation bug than block a save on missing context.
"""

from __future__ import annotations

import re
from typing import Iterator

from .base import AstContext, Finding


_RULE_ID = "component.routing.navigate_unknown_route"


# ``navigate("/literal")`` or ``navigate('/literal')`` — capture the
# string literal. The non-greedy body and explicit ``/`` prefix avoid
# matching template literals (handled separately and skipped) and
# non-route strings.
_NAVIGATE_LITERAL_RE = re.compile(
    r"\bnavigate\s*\(\s*['\"](/[^'\"]*)['\"]\s*[,)]"
)


# Platform pseudo-routes the LLM commonly invents. These are never
# pages; they're auth flows / platform UI. Any match here is a hard
# error with the logout / auth pattern hint.
_PLATFORM_PSEUDO_ROUTES = frozenset({
    "/logout",
    "/log-out",
    "/sign-out",
    "/signout",
    "/login",
    "/log-in",
    "/sign-in",
    "/signin",
    "/auth",
    "/auth/login",
    "/auth/signin",
    "/auth/logout",
    "/auth/signout",
    "/auth/signup",
    "/auth/register",
    "/register",
    "/sign-up",
    "/signup",
})


def _strip_query_and_fragment(path: str) -> str:
    """Return the path portion of ``/path?query#fragment``."""
    for sep in ("?", "#"):
        i = path.find(sep)
        if i != -1:
            path = path[:i]
    return path


def _normalize_slug(slug: str) -> str:
    """Match the reconciler's normalization: strip whitespace, ensure
    leading ``/``, drop trailing ``/`` (except for root)."""
    s = slug.strip()
    if not s.startswith("/"):
        s = "/" + s
    if s != "/" and s.endswith("/"):
        s = s.rstrip("/")
    return s


class NavigateUnknownRouteRule:
    """``navigate("/X")`` target must be a declared page slug.

    Skips dynamic targets (template literals, function calls). Emits
    error on platform pseudo-routes, warning on unknown static slugs.
    """

    id = _RULE_ID
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        if not ctx.page_slugs:
            return  # fail open
        valid = {_normalize_slug(s) for s in ctx.page_slugs}
        tsx = ctx.tsx
        for m in _NAVIGATE_LITERAL_RE.finditer(tsx):
            target_raw = m.group(1)
            target = _normalize_slug(_strip_query_and_fragment(target_raw))
            line = tsx[: m.start()].count("\n") + 1
            if target in _PLATFORM_PSEUDO_ROUTES:
                yield Finding(
                    rule_id=_RULE_ID,
                    severity="error",
                    line=line,
                    col=0,
                    message=(
                        f"`navigate(\"{target_raw}\")` targets a "
                        f"platform pseudo-route. Logout / sign-in / "
                        f"auth flows are NOT app pages — they are "
                        f"handled by the platform's `auth_signout` "
                        f"handler. Use: "
                        f"`const { '{ execute: signOut }' } = useHandler('auth_signout', { '{ autoFetch: false }' }); "
                        f"<button onClick={ '{signOut}' }>Logout</button>`. "
                        f"See 03_COMPONENT_PATTERNS.md for the recipe."
                    ),
                    fix_hint=(
                        "Remove the navigate() call. Bind the button "
                        "to `useHandler('auth_signout', { autoFetch: "
                        "false }).execute`."
                    ),
                )
                continue
            if target not in valid:
                # Show available slugs in the hint — helps the LLM
                # pick a real one on retry.
                preview = sorted(valid)[:6]
                yield Finding(
                    rule_id=_RULE_ID,
                    severity="warning",
                    line=line,
                    col=0,
                    message=(
                        f"`navigate(\"{target_raw}\")` — '{target}' is "
                        f"not a declared page slug. App pages: "
                        f"{', '.join(preview)}"
                        f"{'…' if len(valid) > 6 else ''}. Either fix "
                        f"the literal or add a page with this slug to "
                        f"the plan."
                    ),
                    fix_hint=(
                        f"replace with one of: {', '.join(preview)}"
                    ),
                )
