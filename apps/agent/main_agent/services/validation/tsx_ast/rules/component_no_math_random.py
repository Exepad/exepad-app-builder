"""``component.data.math_random`` — forbid ``Math.random()`` in the
component RENDER path.

The bug this catches
--------------------

App ``r3hfcgx5`` (2026-05-14): the Code Focus DashboardContent shipped a
"Category Mix" donut chart populated by ``Math.floor(Math.random() * 50)``
— mocked demo data the LLM invented because the page plan didn't include
a category-aggregation handler. The chart rendered as a kaleidoscope of
random slices on every render, leaking through review because the
validator never flagged it.

``packages/schemas/data/agent_docs/frontend/component_builder/docs/12_ANTI_PATTERNS.md``
(section "## No Math.random() in render") already says "NEVER use
``Math.random()`` or ``Date.now()`` in the render path or JSX
expressions." The doc is in ComponentBuilder's prompt chain
but the LLM ignored it. A static rule + auto-suggest closes the gap.

The principle: render-position, not app-type
--------------------------------------------

The thing that makes the donut a bug is *where* the randomness runs: in
the **render path** (a ``useMemo`` / inline ``.map`` / JSX expression that
computes the values React paints), where it produces different demo data
on every render. By contrast, **every legitimate** ``Math.random`` —
a canvas game's per-frame spawn, a 2048 tile placement, a card shuffle, a
dice roll, a one-shot id — runs in **deferred** code: an event handler, a
``useEffect``, a ``requestAnimationFrame`` / ``useGameLoop`` loop, a
``useCallback``, a named helper, or a ``useRef`` / ``useMemo([])`` init.

So the rule flags a ``Math.random`` only when it executes during render,
and exempts it when it lives in a deferred-execution function. This is
**app-type agnostic**: it covers arcade canvas games, keyboard DOM games
(2048 / Tetris / Snake), AND click DOM games (memory / cards / dice)
uniformly, with no game-detection heuristic to leak. A dashboard's
``Math.random`` chart data (in a ``useMemo`` / render) stays flagged even
if the dashboard also has arrow-key navigation, a keyboard-shortcut
legend, or an animated rAF counter — because the randomness is still in
render position.

Two layers:

1. **Whole-component exemption for arcade games** (``_is_canvas_or_hook_game``):
   a ``useGameLoop`` / ``useKeys`` call, or a canvas draw (``.getContext(``
   / ``<canvas>``) plus an animation loop. This is kept because arcade
   games sometimes seed render-level state (e.g. a module/component-body
   ``const STARS = Array.from(..., () => Math.random())`` starfield) that
   the render-position pass would otherwise flag. A static canvas *chart*
   (``getContext`` with no loop) is NOT a game and falls through to layer 2.
2. **Render-position pass** (``_is_in_deferred_context``) for everything
   else: exempt a ``Math.random`` nested in a deferred function, flag it
   in render position.

Detection is AST-based
----------------------

``Math.random`` is found as a ``member_expression`` (object ``Math`` —
bare or ``window``/``globalThis``/``self``-qualified — property
``random``). A ``Math.random`` inside a **comment, string, or JSX text** is
not a member expression, so it is never flagged (e.g. a code comment
"avoids Math.random()"). ``customMath.random`` is never matched.

Out-of-scope
------------

We do NOT forbid ``Date.now()`` (the doc's other anti-pattern). It is
overwhelmingly used legitimately (timestamps, cache keys, debounce) and
false-positives would outweigh the bug it catches.

Module-level helpers vs the component
-------------------------------------

The render boundary is the **component function** specifically — the
outermost function that calls a hook or returns JSX — NOT just any
top-level function. Real game/interactive code is full of module-level
factory helpers (``shuffleArray`` / ``buildDeck`` / ``createParticles``)
that hold ``Math.random`` and are only ever called from a deferred site (a
``useState(() => …)`` lazy initializer, a ``useEffect``, a click handler).
Those helpers are classified by the call graph, not flagged on sight.

Known residuals
---------------

A *transitive* call-graph check catches the idiomatic refactored donut — a
named helper (``const make = () => …Math.random…`` or ``function make(){}``)
whose value flows into render is flagged when any call site (following
helper → helper chains) runs during render. This now also catches the
former **two-hop** form (``make`` called only by ``wrap``, ``wrap`` called
from render). A few narrow forms still slip (accepted cost of staying
game-agnostic, far narrower than the inline ``useMemo`` form the bug took):

- **Aliased call** — ``const build = make; const data = build()``. The scan
  matches call sites by identifier, so an alias is missed.
- **Shadowed name** — when the helper's name binds more than once, the
  identifier-only scan can't tell the bindings apart, so we fall back to
  *deferred* (exempt). This protects real game helpers from a false flag at
  the cost of exempting a same-named donut helper.
- **Recursion cycle** — a mutually-recursive helper pair short-circuits to
  *deferred* (exempt) to guarantee termination.
"""

from __future__ import annotations

from typing import Iterator

from ..walker import find_by_type, find_calls
from .base import AstContext, Finding

_RULE_ID = "component.data.math_random"

# ── Arcade-game whole-component exemption (layer 1) ──────────────────────
_RAF_IDENTIFIERS: frozenset[str] = frozenset({"requestAnimationFrame", "cancelAnimationFrame"})
_RAF_WINDOW_OBJECTS: frozenset[str] = frozenset({"window", "globalThis", "self"})
_GAME_HOOKS: frozenset[str] = frozenset({"useGameLoop", "useKeys"})

# ── Deferred-execution classification (layer 2, render-position) ─────────
_FN_TYPES: frozenset[str] = frozenset(
    {
        "arrow_function",
        "function_declaration",
        "function_expression",
        "generator_function",
        "generator_function_declaration",
        "method_definition",
    }
)
# Named functions / methods (when nested below the component) are helpers →
# deferred. The component function itself is handled separately (it is the
# outermost function = the render boundary).
_NAMED_FN_TYPES: frozenset[str] = frozenset(
    {"function_declaration", "generator_function_declaration", "method_definition"}
)
# Calls whose CALLBACK argument runs deferred (after render). Matched by
# bare identifier or by member property (React.useEffect, window.addEventListener).
# ``useState``/``useReducer`` are here for their FUNCTION argument only — a
# lazy initializer ``useState(() => Math.random())`` (one-shot, like useRef)
# and a reducer ``useReducer((s, a) => ..., init)`` (runs on dispatch, never
# render). The EAGER ``useState(Math.random())`` form passes Math.random as a
# direct (non-function) arg, so it does not hit this branch and stays flagged.
_DEFERRED_CALLBACK_FNS: frozenset[str] = frozenset(
    {
        "useEffect",
        "useLayoutEffect",
        "useCallback",
        "useGameLoop",
        "useKeys",
        "useState",
        "useReducer",
        "setTimeout",
        "setInterval",
        "requestAnimationFrame",
        "queueMicrotask",
        "addEventListener",
    }
)


def _text(node, buf: bytes) -> str:
    return buf[node.start_byte : node.end_byte].decode("utf-8")


# ── Layer 1: arcade-game whole-component exemption ───────────────────────


def _has_canvas_element(root, buf: bytes) -> bool:
    """True if the component renders a literal ``<canvas>`` element."""
    for jsx_type in ("jsx_opening_element", "jsx_self_closing_element"):
        for el in find_by_type(root, jsx_type):
            name_node = el.child_by_field_name("name")
            if name_node is not None and _text(name_node, buf) == "canvas":
                return True
    return False


def _is_canvas_or_hook_game(root, buf: bytes) -> bool:
    """Arcade game signature: a game-only SDK hook (``useGameLoop`` /
    ``useKeys``), or a canvas draw (``.getContext(`` / ``<canvas>``) plus an
    animation loop (``requestAnimationFrame`` / ``cancelAnimationFrame``)."""
    has_loop = False
    has_canvas = False
    for call in find_calls(root):
        callee = call.child_by_field_name("function")
        if callee is None:
            continue
        if callee.type == "identifier":
            name = _text(callee, buf)
            if name in _GAME_HOOKS:
                return True  # useGameLoop / useKeys — game-only hooks
            if name in _RAF_IDENTIFIERS:
                has_loop = True
        elif callee.type == "member_expression":
            prop = callee.child_by_field_name("property")
            prop_text = _text(prop, buf) if prop is not None else ""
            if prop_text == "getContext":
                has_canvas = True  # X.getContext('2d') — canvas draw
            elif prop_text in _RAF_IDENTIFIERS:
                obj = callee.child_by_field_name("object")
                if obj is not None and _text(obj, buf) in _RAF_WINDOW_OBJECTS:
                    has_loop = True  # window.requestAnimationFrame(...)
    if not has_loop:
        return False
    return has_canvas or _has_canvas_element(root, buf)


# ── Layer 2: render-position pass ────────────────────────────────────────


def _is_math_object(obj, buf: bytes) -> bool:
    """True if ``obj`` is the ``Math`` global (bare or window-qualified).

    Matches ``Math`` and ``window.Math`` / ``globalThis.Math`` / ``self.Math``;
    rejects ``customMath`` and ``scheduler.Math`` (a non-global namespace)."""
    if obj.type == "identifier":
        return _text(obj, buf) == "Math"
    if obj.type == "member_expression":
        inner = obj.child_by_field_name("object")
        prop = obj.child_by_field_name("property")
        if inner is not None and prop is not None:
            return _text(prop, buf) == "Math" and _text(inner, buf) in _RAF_WINDOW_OBJECTS
    return False


def _iter_math_random_nodes(root, buf: bytes) -> Iterator:
    """Yield ``Math.random`` member-expression nodes (object = the ``Math``
    global, property ``random``). Skips comments / strings / JSX text (not
    member expressions) and ``customMath.random``."""
    for me in find_by_type(root, "member_expression"):
        obj = me.child_by_field_name("object")
        prop = me.child_by_field_name("property")
        if obj is None or prop is None:
            continue
        if _text(prop, buf) == "random" and _is_math_object(obj, buf):
            yield me


def _has_empty_deps(call, buf: bytes) -> bool:
    """True if a ``useMemo``/``useRef`` call's 2nd arg is an empty ``[]``."""
    args = call.child_by_field_name("arguments")
    if args is None or args.named_child_count < 2:
        return False
    deps = args.named_children[1]
    return deps.type == "array" and deps.named_child_count == 0


def _callee_name(call, buf: bytes) -> str:
    """The call's function name — bare identifier, or the property of a
    member callee (so ``React.useEffect`` → ``useEffect``)."""
    callee = call.child_by_field_name("function")
    if callee is None:
        return ""
    if callee.type == "identifier":
        return _text(callee, buf)
    if callee.type == "member_expression":
        prop = callee.child_by_field_name("property")
        return _text(prop, buf) if prop is not None else ""
    return ""


def _is_outermost_fn(fn) -> bool:
    """True if ``fn`` has no function ancestor — i.e. it is the top-level
    component function (the render boundary), not a nested helper/callback."""
    cur = fn.parent
    while cur is not None:
        if cur.type in _FN_TYPES:
            return False
        cur = cur.parent
    return True


def _fn_bound_name(fn, buf: bytes) -> str | None:
    """The name a helper is bound to: a ``function foo(){}`` declaration's
    name, or the identifier of a ``const foo = () => ...`` arrow. ``None`` for
    anonymous/inline functions."""
    if fn.type in ("function_declaration", "generator_function_declaration"):
        nm = fn.child_by_field_name("name")
        return _text(nm, buf) if nm is not None else None
    parent = fn.parent
    if parent is not None and parent.type == "variable_declarator":
        nm = parent.child_by_field_name("name")
        if nm is not None and nm.type == "identifier":
            return _text(nm, buf)
    return None


def _is_hook_name(name: str) -> bool:
    """``useState`` / ``useEffect`` / ``useGameLoop`` … — a ``use`` prefix
    followed by an uppercase letter (so ``user`` / ``used`` do not match)."""
    return len(name) > 3 and name.startswith("use") and name[3].isupper()


def _calls_a_hook(fn, buf: bytes) -> bool:
    """True if ``fn`` calls any React hook (``use*``) — a component signal."""
    for call in find_calls(fn):
        if _is_hook_name(_callee_name(call, buf)):
            return True
    return False


def _contains_jsx(fn) -> bool:
    """True if ``fn`` returns/contains JSX — a component signal."""
    for jsx_type in ("jsx_element", "jsx_self_closing_element", "jsx_fragment"):
        for _ in find_by_type(fn, jsx_type):
            return True
    return False


def _is_render_component(fn, buf: bytes) -> bool:
    """True if this top-level function is the React component (the render
    boundary): it calls a hook or returns JSX. A module-level *helper*
    (``shuffleArray`` / ``buildDeck`` / ``createParticles``) does neither, so
    it is classified by the call graph instead of treated as render."""
    return _calls_a_hook(fn, buf) or _contains_jsx(fn)


def _all_callsites_deferred(name, root, buf: bytes, stack: frozenset) -> bool:
    """True if EVERY ``name(...)`` call site runs in a deferred context
    (transitively), or there are none. False if any call site runs during
    render — meaning the helper's value flows into render data (a refactored
    donut). Helper → helper chains are followed transitively; ``stack`` (the
    set of helper names already being resolved) bounds the recursion so a
    cycle short-circuits to deferred rather than looping forever."""
    for call in find_calls(root):
        callee = call.child_by_field_name("function")
        if callee is not None and callee.type == "identifier" and _text(callee, buf) == name:
            if not _is_in_deferred_context(call, buf, root, _stack=stack):
                return False
    return True


def _declaration_count(name, root, buf: bytes) -> int:
    """How many ``function name(){}`` / ``const name = …`` declarations bind
    ``name`` in this component. Used to detect shadowing — when >1, the
    identifier-only call-site scan can conflate distinct bindings."""
    count = 0
    for fd in find_by_type(root, "function_declaration"):
        nm = fd.child_by_field_name("name")
        if nm is not None and _text(nm, buf) == name:
            count += 1
    for gd in find_by_type(root, "generator_function_declaration"):
        nm = gd.child_by_field_name("name")
        if nm is not None and _text(nm, buf) == name:
            count += 1
    for vd in find_by_type(root, "variable_declarator"):
        nm = vd.child_by_field_name("name")
        if nm is not None and nm.type == "identifier" and _text(nm, buf) == name:
            count += 1
    return count


def _helper_is_deferred(fn, buf: bytes, root, stack: frozenset) -> bool:
    """A named helper (``function foo(){}`` / ``const foo = () => ...``) is
    deferred ONLY when every call site is itself deferred (transitively);
    otherwise it is a render-data builder invoked during render (the
    refactored-donut hole)."""
    name = _fn_bound_name(fn, buf)
    if name is None:
        return True  # anonymous / oddly-bound helper — exempt (conservative-safe)
    if name in stack:
        return True  # recursion cycle — terminate as deferred (safe)
    # Shadowing guard: if the name binds more than once, the identifier-only
    # call-site scan cannot tell the bindings apart, so it might flag a real
    # game helper because a same-named *other* binding is called during render.
    # Fall back to deferred (exempt) — never re-break a game. (Re-accepts the
    # rare shadowed-donut residual.)
    if _declaration_count(name, root, buf) > 1:
        return True
    return _all_callsites_deferred(name, root, buf, stack | {name})


def _is_deferred_call_arg(call, buf: bytes) -> bool:
    """True if an arrow passed to ``call`` runs deferred: useEffect/useCallback/
    setTimeout/rAF/addEventListener and the useState lazy-init / useReducer
    reducer; useRef (one-shot); useMemo([]) (one-shot). useMemo-with-deps is
    RENDER → False."""
    name = _callee_name(call, buf)
    if name in _DEFERRED_CALLBACK_FNS or name == "useRef":
        return True
    return name == "useMemo" and _has_empty_deps(call, buf)


def _is_deferred_fn(fn, buf: bytes, root, stack: frozenset) -> bool:
    """True if this (non-outermost) function runs *deferred* — after render —
    rather than during render. Render functions (a ``useMemo``-with-deps
    callback, an inline ``.map`` arg) return False so the caller keeps walking
    outward (e.g. a ``.map`` inside an ``onClick`` is still deferred via the
    handler)."""
    if fn.type == "method_definition":
        return True  # methods run on invocation, not during render
    if fn.type in _NAMED_FN_TYPES:
        return _helper_is_deferred(fn, buf, root, stack)
    parent = fn.parent
    if parent is None:
        return False
    pt = parent.type
    # const/let f = () => ...  — a named helper; defer only if every call site
    # is deferred (else it builds render data and must be flagged).
    if pt == "variable_declarator":
        return _helper_is_deferred(fn, buf, root, stack)
    # { onTap: () => ... } / assignments — object/property handlers.
    if pt in ("pair", "assignment_expression", "public_field_definition"):
        return True
    # onClick={() => ...} — JSX event-handler attribute.
    if (
        pt == "jsx_expression"
        and parent.parent is not None
        and parent.parent.type == "jsx_attribute"
    ):
        return True
    # Call-argument (useEffect / useState lazy-init / useRef / useMemo([]) / …).
    if pt == "arguments" and parent.parent is not None and parent.parent.type == "call_expression":
        return _is_deferred_call_arg(parent.parent, buf)
    return False


def _is_in_deferred_context(node, buf: bytes, root, *, _stack: frozenset = frozenset()) -> bool:
    """Render-position test: True if ``node`` executes in deferred code
    (handler/effect/loop/helper/useRef/useMemo([])), False if it runs during
    render (component body, ``useMemo``-with-deps, inline ``.map``)."""
    cur = node.parent
    while cur is not None:
        # Direct argument to a one-shot init — ``useRef(Math.random())`` or
        # ``useMemo(Math.random(), [])`` — has no callback wrapper, so catch
        # it at the call. (useMemo-WITH-deps is render data → not caught here.)
        if cur.type == "call_expression":
            name = _callee_name(cur, buf)
            if name == "useRef":
                return True
            if name == "useMemo" and _has_empty_deps(cur, buf):
                return True
        if cur.type in _FN_TYPES:
            if _is_outermost_fn(cur):
                # The render boundary is the COMPONENT function (it calls hooks
                # / returns JSX). A module-level *helper* (``shuffleArray`` /
                # ``buildDeck`` / ``createParticles``) is deferred unless the
                # call graph reaches it from a render position — so resolve it
                # rather than treating every top-level function as render.
                if _is_render_component(cur, buf):
                    return False  # reached the render boundary, no deferred wrapper
                return _helper_is_deferred(cur, buf, root, _stack)
            if _is_deferred_fn(cur, buf, root, _stack):
                return True
            # render-level nested fn (useMemo-deps cb / .map arg) — keep walking
        cur = cur.parent
    return False


class NoMathRandomInComponentRule:
    """Forbid ``Math.random()`` in the component render path.

    The LLM uses ``Math.random()`` to invent chart/list demo data when its
    plan is incomplete — that runs during render and never matches the
    user's intent. Randomness in deferred code (game loops, handlers,
    effects, helpers) is legitimate and exempt. See the module docstring.
    """

    id = _RULE_ID
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        root = ctx.tree.root_node
        buf = ctx.source_buf
        # Layer 1: arcade games (canvas+rAF / useGameLoop / useKeys) are
        # exempt whole-component — they may seed render-level state.
        if _is_canvas_or_hook_game(root, buf):
            return
        # Layer 2: flag Math.random that runs during render; exempt deferred.
        for node in _iter_math_random_nodes(root, buf):
            if _is_in_deferred_context(node, buf, root):
                continue
            yield Finding(
                rule_id=_RULE_ID,
                severity="error",
                line=node.start_point[0] + 1,
                col=node.start_point[1],
                message=(
                    "`Math.random()` is forbidden in the component render path "
                    "— random values render as different demo data on every "
                    "render and never match the user's intent. If a chart "
                    "or list needs aggregated data, request a backend "
                    "handler in the plan. For game/interaction logic, compute "
                    "randomness in an event handler, effect, or game loop "
                    "(not during render); for a stable random id nest it in "
                    "`useMemo(() => Math.random(), [])` or `useRef(Math.random())`."
                ),
                fix_hint=(
                    "Move the `Math.random()` out of the render path: into an "
                    "event handler / useEffect / game loop, or request a real "
                    "handler (e.g. `getCategoryDistribution`) and wire "
                    "`useHandler(...)`. For a one-shot id use "
                    "`useRef(Math.random())`."
                ),
            )
