"""``handler.forbidden.api`` — catch-all forbidden JS API catalogue.

Flags uses of ``eval``, ``new Function``, ``XMLHttpRequest``,
``localStorage``, ``sessionStorage``, ``console.log``, direct DOM
access (``document.getElementById`` etc.), ``window.location`` mutation,
``addEventListener`` (with keyboard / scroll / resize exemptions), raw
``fetch`` (with whitelisted-domain exemptions), ``.innerHTML =``
assignment, and the ``cn()`` utility.

Most of these patterns cannot occur in a well-formed handler — handlers
are backend code with no DOM — but keeping them in the catalogue costs
nothing and catches the occasional LLM hallucination that spills
frontend idioms into the handler file.

Component contexts are different: the design-import mechanical pipeline
wraps source ``<script>`` bodies in a single ``React.useEffect(() => { … }, [])``
block, and idiomatic React itself routinely uses ``document.addEventListener``,
``document.querySelector``, refs assigned via ``getElementById`` lookups,
and direct-DOM teardown inside ``useEffect``. The error message we emit
for ``addEventListener`` even tells the model to *use useEffect with refs*.
When constructed with ``useeffect_dom_exempt=True`` (the
:func:`component_rules` factory does this), the rule skips the
DOM-related families (``dom_access``, ``addEventListener``, ``innerhtml``)
when the offending node sits inside a ``useEffect(...)`` /
``React.useEffect(...)`` callback. ``eval``, ``cn``, ``fetch``,
``console.log``, ``localStorage`` / ``sessionStorage``, ``new Function``
/ ``new XMLHttpRequest``, and ``window.location`` mutation remain
forbidden everywhere — there is no scenario where they're appropriate
in a component, useEffect or otherwise.

Error messages are sourced from
``services/validation/forbidden_api_registry`` — the single source of
truth that also carries Pattern A's ``retry_guidance`` for each api_id.
The local fallback strings are kept as a safety net should the registry
import ever fail.
"""

from __future__ import annotations

import os
import re
from typing import Iterator

from main_agent.services.validation import forbidden_api_registry as _registry

from ..walker import find_by_type, find_calls, string_literal_value, walk
from .base import AstContext, Finding

_TEMPLATE_FRAGMENT_TYPES: frozenset[str] = frozenset({"string_fragment"})


def _msg(api_id: str, fallback: str) -> str:
    """Look up the registry error message; fall back to ``fallback``.

    The fallback path exists so this rule keeps working in isolation if
    the registry module is ever stubbed (e.g. during a partial import in
    a test). In normal operation, every emit() pulls its message from
    the registry — change a message there and every emitter updates.
    """
    entry = _registry.get(api_id)
    return entry.error_message if entry is not None else fallback


# Identifier → error message for direct call expressions that are always
# forbidden regardless of context. Messages are derived from the registry
# at module load — adding a new entry to the registry surfaces here too.
_FORBIDDEN_CALL_IDENTIFIERS: dict[str, str] = {
    "eval": _msg("call:eval", "eval() is forbidden"),
}

# Constructor name → error message for ``new Foo(...)`` expressions. Both
# ``new Function()`` (code-gen from strings) and ``new XMLHttpRequest()``
# (browser-only API not available in Workers) belong here because in JS
# they are only reachable through ``new``.
_FORBIDDEN_CONSTRUCTORS: dict[str, str] = {
    "Function": _msg("new:Function", "new Function() is forbidden"),
    "XMLHttpRequest": _msg("new:XMLHttpRequest", "XMLHttpRequest forbidden — use SDK hooks"),
}

_FORBIDDEN_IDENTIFIERS: dict[str, str] = {
    "localStorage": _msg("ident:localStorage", "localStorage is forbidden"),
    "sessionStorage": _msg("ident:sessionStorage", "sessionStorage is forbidden"),
}

_ADDLISTENER_ALLOWED_EVENTS: frozenset[str] = frozenset(
    {"keydown", "keyup", "keypress", "scroll", "resize"}
)


def _build_fetch_whitelist() -> tuple[str, ...]:
    """Build the raw-``fetch`` host whitelist at import time.

    Always includes the two production CDN defaults plus the internal
    ``/_forms/submit`` form-submission endpoint (a real, runtime-supported
    route — see the inline note on the ``fetch`` branch). Outside production
    (``ENVIRONMENT != production`` — i.e. dev / self-host) local hosts are
    also allowed so generated code can ``fetch('http://localhost:3000/...')``
    against the self-hosted backend without tripping validation. Operators
    can extend the list in any environment via ``ALLOWED_FETCH_DOMAINS``
    (whitespace- and/or comma-separated), which keeps production strict
    unless explicitly overridden.
    """
    whitelist: list[str] = ["r2.exepad.com", "exepad.com/apps", "/_forms/submit"]
    if os.getenv("ENVIRONMENT", "development") != "production":
        whitelist.extend(["localhost", "127.0.0.1", ".local"])
    for entry in re.split(r"[\s,]+", os.getenv("ALLOWED_FETCH_DOMAINS", "")):
        entry = entry.strip()
        if entry and entry not in whitelist:
            whitelist.append(entry)
    return tuple(whitelist)


_FETCH_WHITELISTED_SUBSTRINGS: tuple[str, ...] = _build_fetch_whitelist()


class ForbiddenApiRule:
    """Flag forbidden JS APIs — eval, DOM access, raw fetch, etc.

    Args:
        useeffect_dom_exempt: When True, the DOM-related families
            (``dom_access`` / ``addEventListener`` / ``innerhtml``) are
            skipped for nodes inside a ``useEffect(...)`` callback.
            ``component_rules()`` enables this; ``handler_rules()``
            leaves it off (handlers never have a DOM).
    """

    id = "handler.forbidden.api"
    severity = "error"

    def __init__(self, *, useeffect_dom_exempt: bool = False) -> None:
        self.useeffect_dom_exempt = useeffect_dom_exempt

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        root = ctx.tree.root_node
        buf = ctx.source_buf
        emitted: set[str] = set()
        exempt = self.useeffect_dom_exempt

        def emit(key: str, msg: str, node, severity: str = "error") -> Finding | None:
            if key in emitted:
                return None
            emitted.add(key)
            return Finding(
                rule_id=self.id,
                severity=severity,
                message=msg,
                line=node.start_point[0] + 1,
                col=node.start_point[1],
            )

        # ---- Call expressions: eval(), cn(), fetch(), console.log(),
        # direct DOM access, addEventListener. ``alert`` / ``confirm`` /
        # ``prompt`` and ``setTimeout`` / ``setInterval`` are handled by
        # the browser-api rule. ``new`` expressions are handled further
        # down the function.
        for call in find_calls(root):
            callee = call.child_by_field_name("function")
            if callee is None:
                continue

            if callee.type == "identifier":
                name = _text(callee, buf)
                if name in _FORBIDDEN_CALL_IDENTIFIERS:
                    if f := emit(f"call:{name}", _FORBIDDEN_CALL_IDENTIFIERS[name], call):
                        yield f
                    continue
                if name == "cn":
                    if f := emit(
                        "cn",
                        _msg(
                            "cn",
                            "cn() forbidden in Code Focus — tailwind-merge "
                            "won't recognize custom classes",
                        ),
                        call,
                    ):
                        yield f
                    continue
                if name == "fetch":
                    # Whitelist ``fetch()`` calls whose FIRST argument is a
                    # string/template literal containing one of the
                    # exemption substrings — R2 uploads, internal form
                    # submission, and the app directory all have to work.
                    # Matching on the argument AST (not raw source bytes)
                    # prevents a nearby comment or string from smuggling a
                    # whitelist keyword past the check.
                    if not _fetch_has_whitelisted_url(call, buf):
                        if f := emit(
                            "fetch",
                            _msg("fetch", "fetch() forbidden — use useModel/useHandler"),
                            call,
                        ):
                            yield f
                    continue

            if callee.type == "member_expression":
                obj = callee.child_by_field_name("object")
                prop = callee.child_by_field_name("property")
                obj_text = _text(obj, buf) if obj is not None else ""
                prop_text = _text(prop, buf) if prop is not None else ""

                # document.getElementById / createElement / querySelector
                if obj_text == "document" and prop_text in (
                    "getElementById",
                    "createElement",
                    "querySelector",
                ):
                    if exempt and _is_inside_useeffect_callback(call, buf):
                        continue
                    if f := emit(
                        "dom_access",
                        _msg("dom_access", "Direct document access — use React refs"),
                        call,
                    ):
                        yield f
                    continue

                # window.addEventListener / document.addEventListener with
                # the whitelisted-event exemption.
                if obj_text in ("window", "document") and prop_text == "addEventListener":
                    if exempt and _is_inside_useeffect_callback(call, buf):
                        continue
                    if not _addlistener_is_whitelisted(call, buf):
                        if f := emit(
                            "addEventListener",
                            _msg(
                                "addEventListener",
                                "addEventListener() bypasses React's event "
                                "system — use React synthetic events (onClick, "
                                "onChange, onScroll) or useEffect with refs",
                            ),
                            call,
                        ):
                            yield f
                    continue

                # console.log() as a member_expression call.
                if obj_text == "console" and prop_text == "log":
                    if f := emit(
                        "console_log",
                        _msg("console_log", "console.log() is forbidden — remove debug logging"),
                        call,
                    ):
                        yield f
                    continue

                # window.location.{reload,assign,replace}() method calls.
                # The assignment branch above catches LHS mutations
                # (``window.location.href = X``); this branch catches the
                # method-call form (``.reload()``, ``.assign(X)``, ``.replace(X)``)
                # which is otherwise unguarded — observed in ContactContent
                # using ``window.location.reload()`` for a form reset.
                if obj_text == "window.location" and prop_text in (
                    "reload",
                    "assign",
                    "replace",
                ):
                    if f := emit(
                        "window_location",
                        _msg(
                            "window_location",
                            "window.location mutation forbidden — use navigate()",
                        ),
                        call,
                    ):
                        yield f

                # URL.createObjectURL() — agents reach for this to build the
                # blob-URL half of a `<a href>.click()` download chain. The
                # sanctioned alternative is ``downloadFile`` /
                # ``downloadCsv`` from @exepad/sdk, which encapsulates the
                # whole sequence (Blob, URL, anchor, revoke). Warning level
                # during the migration grace period (existing showcase apps
                # still use the manual pattern).
                if obj_text == "URL" and prop_text == "createObjectURL":
                    if f := emit(
                        "url_create_object_url",
                        _msg(
                            "url_create_object_url",
                            "URL.createObjectURL() forbidden — use "
                            "downloadFile() or downloadCsv() from @exepad/sdk "
                            "for file exports",
                        ),
                        call,
                        severity="warning",
                    ):
                        yield f
                    continue
                    continue

        # ---- new Foo(...) for forbidden constructors.
        for new_expr in find_by_type(root, "new_expression"):
            ctor = new_expr.child_by_field_name("constructor")
            if ctor is None:
                continue
            ctor_name = _text(ctor, buf)
            if ctor_name not in _FORBIDDEN_CONSTRUCTORS:
                continue
            if f := emit(f"new:{ctor_name}", _FORBIDDEN_CONSTRUCTORS[ctor_name], new_expr):
                yield f

        # ---- Plain identifier references: localStorage, sessionStorage.
        # Walk every ``identifier`` node; exclude ``x.localStorage``-style
        # property accesses by checking the identifier isn't the
        # ``property`` side of a member_expression.
        for ident in find_by_type(root, "identifier"):
            name = _text(ident, buf)
            if name not in _FORBIDDEN_IDENTIFIERS:
                continue
            parent = ident.parent
            if parent is not None and parent.type == "member_expression":
                if parent.child_by_field_name("property") == ident:
                    continue
            if f := emit(f"ident:{name}", _FORBIDDEN_IDENTIFIERS[name], ident):
                yield f

        # ---- window.location = ... / window.location.href = ... mutation
        # AND .innerHTML = ... assignment.
        for assignment in find_by_type(root, "assignment_expression"):
            left = assignment.child_by_field_name("left")
            if left is None or left.type != "member_expression":
                continue
            if _is_window_location_mutation(_text(left, buf)):
                if f := emit(
                    "window_location",
                    _msg(
                        "window_location",
                        "window.location mutation forbidden — use navigate()",
                    ),
                    assignment,
                ):
                    yield f
                continue
            prop = left.child_by_field_name("property")
            if prop is not None and _text(prop, buf) == "innerHTML":
                if exempt and _is_inside_useeffect_callback(assignment, buf):
                    continue
                if f := emit(
                    "innerhtml",
                    _msg("innerhtml", "innerHTML forbidden — use React JSX"),
                    assignment,
                ):
                    yield f
                continue
            # ``document.body.style.X = Y`` mutation — leaks state across
            # components (scroll-lock not restored on unmount, paddingRight
            # left behind). Use ``useBodyScrollLock`` for scroll lock; for
            # everything else, set the style on the JSX element itself.
            # Seen on coje33ih MainSidebar (2026-05-12) where
            # ``document.body.style.overflow = isMobileOpen ? 'hidden' : ''``
            # in a useEffect leaked between page nav events.
            if _is_body_style_mutation(_text(left, buf)):
                # Warning-level (not error) during migration: existing showcase
                # apps still use the bare ``document.body.style.overflow`` pattern
                # for sidebar scroll-lock; downgrading to warning lets them edit
                # without breaking while the agent learns to prefer
                # ``useBodyScrollLock`` going forward.
                if f := emit(
                    "body_style_mutation",
                    _msg(
                        "body_style_mutation",
                        "document.body.style.* mutation discouraged — use "
                        "useBodyScrollLock() or set the style on the "
                        "relevant JSX element instead",
                    ),
                    assignment,
                    severity="warning",
                ):
                    yield f


def _fetch_has_whitelisted_url(call, buf: bytes) -> bool:
    """True when ``fetch(...)``'s first argument statically contains a
    whitelisted substring.

    Inspects only the first argument's subtree (string literals and the
    static fragments of template strings), so a whitelist keyword buried
    in a comment near the call — or in a header value elsewhere in the
    argument list — cannot smuggle the check.
    """
    args = call.child_by_field_name("arguments")
    if args is None or args.named_child_count == 0:
        return False
    first = args.named_children[0]
    for node in _iter_static_strings(first, buf):
        for s in _FETCH_WHITELISTED_SUBSTRINGS:
            # Path-style entries ("/_forms/submit") must be a same-origin
            # RELATIVE prefix (anchored startswith), so a path fragment can't be
            # smuggled inside an attacker-controlled absolute URL
            # ("https://evil.com/_forms/submit"). Host entries stay substring.
            if s.startswith("/"):
                if node.startswith(s):
                    return True
            elif s in node:
                return True
    return False


def _addlistener_is_whitelisted(call, buf: bytes) -> bool:
    """True when the first argument to ``addEventListener`` is a string
    literal naming a whitelisted event (keydown/keyup/keypress/scroll/resize)."""
    args = call.child_by_field_name("arguments")
    if args is None or args.named_child_count == 0:
        return False
    first = args.named_children[0]
    if first.type != "string":
        return False
    value = string_literal_value(first, buf) or ""
    return value in _ADDLISTENER_ALLOWED_EVENTS


def _iter_static_strings(node, buf: bytes) -> Iterator[str]:
    """Yield static string contents found anywhere under ``node``.

    Covers ``string`` literals and the static ``string_fragment`` chunks
    of ``template_string`` nodes. Substitutions (``${...}``) are skipped
    by design — we cannot know their value statically.
    """
    for n in walk(node):
        if n.type == "string":
            val = string_literal_value(n, buf)
            if val:
                yield val
        elif n.type == "template_string":
            for child in n.children:
                if child.type in _TEMPLATE_FRAGMENT_TYPES:
                    yield buf[child.start_byte : child.end_byte].decode("utf-8")


def _is_window_location_mutation(left_text: str) -> bool:
    """True if the LHS of an assignment is ``window.location`` or
    ``window.location.{href,assign,replace}``."""
    if left_text == "window.location":
        return True
    return left_text in {
        "window.location.href",
        "window.location.assign",
        "window.location.replace",
    }


def _is_body_style_mutation(left_text: str) -> bool:
    """True if the LHS of an assignment is ``document.body.style.*``.

    Covers every CSS-property accessor (``overflow``, ``paddingRight``,
    ``cssText``, etc.). The whole subtree is forbidden — there is no
    legitimate reason for a Code Focus component to mutate body styles
    imperatively; ``useBodyScrollLock`` from the SDK owns scroll lock,
    and any other body-level styling belongs in the runtime shell.
    """
    return left_text.startswith("document.body.style.") or left_text == "document.body.style"


def _text(node, buf: bytes) -> str:
    return buf[node.start_byte : node.end_byte].decode("utf-8")


_USEEFFECT_CALLEE_NAMES: frozenset[str] = frozenset(
    {"useEffect", "React.useEffect", "useLayoutEffect", "React.useLayoutEffect"}
)


def _is_inside_useeffect_callback(node, buf: bytes) -> bool:
    """True iff ``node`` lives inside a ``useEffect(...)`` callback body.

    Walks ``node.parent`` upward; for each ancestor ``call_expression``,
    checks whether its callee identifier resolves to one of
    ``useEffect`` / ``React.useEffect`` (or the layout-effect variants —
    same DOM-mutation semantics). The check terminates at the first
    matching ancestor — nested calls inside the effect body still count
    as "inside".

    The walker doesn't validate that ``node`` lies inside the *first*
    argument of the call. In practice React effects accept the callback
    as the first arg and a dependency array as the second; any DOM
    access encountered within those argument positions traces back to a
    matching ``call_expression`` ancestor either way, so a positional
    check would only add fragility.
    """
    current = node.parent
    while current is not None:
        if current.type == "call_expression":
            callee = current.child_by_field_name("function")
            if callee is not None and _callee_matches_useeffect(callee, buf):
                return True
        current = current.parent
    return False


def _callee_matches_useeffect(callee, buf: bytes) -> bool:
    """True iff a call_expression's callee names a useEffect-like hook."""
    if callee.type == "identifier":
        return _text(callee, buf) in _USEEFFECT_CALLEE_NAMES
    if callee.type == "member_expression":
        return _text(callee, buf) in _USEEFFECT_CALLEE_NAMES
    return False
