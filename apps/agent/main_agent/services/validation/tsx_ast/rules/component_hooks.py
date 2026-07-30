"""Component hook-safety rules.

Three rules live here:

- ``component.hooks.conditional`` — React hooks called inside ternary
  or short-circuit expressions violate the Rules of Hooks and produce
  React error #185 (infinite re-render) in production.
- ``component.hooks.after_early_return`` — a hook called AFTER a
  conditional early ``return`` (e.g. ``if (loading) return <Spinner/>``
  followed later by ``const x = useMemo(...)``). The hook count differs
  between the loading and loaded renders, crashing the component at
  runtime with React error #300 ("rendered more hooks than during the
  previous render"). This is invisible to esbuild/tsc — only the render
  catches it — so the AST rule is the one line of defence.
- ``component.hooks.useapp_selector`` — ``useApp()`` with no selector,
  or with an inline object selector (``useApp(s => ({...}))``), is a
  direct cause of infinite re-renders because ``useSyncExternalStore``
  compares snapshots with ``Object.is``. The rule flags both forms and
  recommends per-key selector calls.
"""

from __future__ import annotations

from typing import Iterator

from ..walker import find_calls, walk
from .base import AstContext, Finding


class ConditionalHooksRule:
    """Flag React hook calls nested inside conditional expressions."""

    id = "component.hooks.conditional"
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        root = ctx.tree.root_node
        buf = ctx.source_buf
        seen: set[tuple[int, str]] = set()

        for call in find_calls(root):
            callee = call.child_by_field_name("function")
            if callee is None or callee.type != "identifier":
                continue
            name = buf[callee.start_byte : callee.end_byte].decode("utf-8")
            if not _looks_like_hook(name):
                continue

            ancestor_kind = _conditional_ancestor_kind(call, buf)
            if ancestor_kind is None:
                continue

            line = call.start_point[0] + 1
            key = (line, ancestor_kind)
            if key in seen:
                continue
            seen.add(key)

            yield Finding(
                rule_id=self.id,
                severity="error",
                message=(
                    f"Conditional hook call ({ancestor_kind}) — hooks must "
                    f"be called unconditionally at the top level of the component"
                ),
                line=line,
                col=call.start_point[1],
            )


class UseAppSelectorRule:
    """Flag ``useApp`` calls that return the whole store snapshot."""

    id = "component.hooks.useapp_selector"
    severity = "error"

    _MSG_INLINE_OBJECT = (
        "useApp() with inline object selector causes infinite re-renders — "
        "use individual useApp(s => s.key) calls for each property instead"
    )
    _MSG_NO_SELECTOR = (
        "useApp() without selector returns full state object, causing "
        "re-renders on any state change — use useApp(s => s.key) to select "
        "specific values"
    )

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        root = ctx.tree.root_node
        buf = ctx.source_buf

        for call in find_calls(root):
            callee = call.child_by_field_name("function")
            if callee is None or callee.type != "identifier":
                continue
            if buf[callee.start_byte : callee.end_byte].decode("utf-8") != "useApp":
                continue

            args = call.child_by_field_name("arguments")
            # Bare ``useApp()`` — no arguments at all.
            if args is None or args.named_child_count == 0:
                yield Finding(
                    rule_id=self.id,
                    severity="error",
                    message=self._MSG_NO_SELECTOR,
                    line=call.start_point[0] + 1,
                    col=call.start_point[1],
                )
                continue

            first = args.named_children[0]
            if _is_inline_object_selector(first):
                yield Finding(
                    rule_id=self.id,
                    severity="error",
                    message=self._MSG_INLINE_OBJECT,
                    line=call.start_point[0] + 1,
                    col=call.start_point[1],
                )


class HooksAfterEarlyReturnRule:
    """Flag React hooks called after a conditional early return.

    The Rules of Hooks require every hook to run on every render in the
    same order. A common LLM mistake is an early ``return`` guard
    (``if (loading) return <Spinner/>``) followed by another hook
    (``const x = useMemo(...)``): on the loading render the hook is
    skipped, on the loaded render it runs, the hook count changes, and
    React throws #300 ("rendered more hooks than during the previous
    render") — crashing the component to the ErrorBoundary fallback.

    The check is per component-shaped function (any function whose body
    holds top-level hook calls). It finds the earliest *top-level*
    conditional return and flags any *top-level* hook call positioned
    after it. Nested-callback hooks (inside ``useMemo(() => ...)`` args,
    event handlers, ``.map()``) are out of scope here — the conditional
    rule and Rules-of-Hooks placement cover those.
    """

    id = "component.hooks.after_early_return"
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        buf = ctx.source_buf
        for fn in _iter_functions(ctx.tree.root_node):
            body = _function_body(fn)
            if body is None:
                continue
            hook_calls = list(_top_level_hook_calls(body, fn, buf))
            if not hook_calls:
                continue  # not a component / custom-hook function
            boundary = _earliest_conditional_return_byte(body, fn)
            if boundary is None:
                continue
            seen: set[int] = set()
            for call, name in hook_calls:
                if call.start_byte <= boundary:
                    continue
                line = call.start_point[0] + 1
                if line in seen:
                    continue
                seen.add(line)
                yield Finding(
                    rule_id=self.id,
                    severity="error",
                    message=(
                        f"Hook '{name}' is called after a conditional early return — "
                        f"all hooks must run unconditionally before any return "
                        f"(Rules of Hooks; mismatched hook count crashes the render "
                        f"with React error #300). Move every hook above the first "
                        f"`if (...) return`."
                    ),
                    line=line,
                    col=call.start_point[1],
                )


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


_FUNCTION_NODE_TYPES = (
    "function_declaration",
    "arrow_function",
    "function_expression",
    "method_definition",
)


def _iter_functions(root) -> Iterator:
    """Yield every function-shaped node in the tree."""
    for node in walk(root):
        if node.type in _FUNCTION_NODE_TYPES:
            yield node


def _function_body(fn_node):
    """Return the ``statement_block`` body of a function, or None.

    Expression-bodied arrows (``() => <JSX/>``) have no statement block
    and can't host top-level hooks, so they're skipped.
    """
    body = fn_node.child_by_field_name("body")
    if body is not None and body.type == "statement_block":
        return body
    return None


def _enclosing_function(node):
    """The nearest ancestor function node, or None."""
    parent = node.parent
    while parent is not None:
        if parent.type in _FUNCTION_NODE_TYPES:
            return parent
        parent = parent.parent
    return None


def _same_node(a, b) -> bool:
    """Identity test by tree-sitter node id.

    tree-sitter returns a FRESH Python wrapper on every node access, so
    ``a is b`` is unreliable across independent traversals — ``.id`` is the
    stable per-node identifier.
    """
    return a is not None and b is not None and a.id == b.id


def _top_level_hook_calls(body, fn_node, buf: bytes):
    """Yield ``(call_node, name)`` for hook calls whose nearest enclosing
    function is ``fn_node`` — i.e. hooks at the component body level, not
    inside a nested callback (a ``useMemo`` argument arrow, an onClick, …).
    """
    for call in find_calls(body):
        callee = call.child_by_field_name("function")
        if callee is None or callee.type != "identifier":
            continue
        name = buf[callee.start_byte : callee.end_byte].decode("utf-8")
        if not _looks_like_hook(name):
            continue
        if _same_node(_enclosing_function(call), fn_node):
            yield call, name


def _earliest_conditional_return_byte(body, fn_node) -> int | None:
    """Start byte of the first top-level ``if`` statement that can return.

    Only ``if`` statements that are direct children of the component body
    AND contain a ``return`` belonging to the component function (not a
    nested callback) count. Returns None when there's no early return.
    """
    earliest: int | None = None
    for stmt in body.named_children:
        if stmt.type != "if_statement":
            continue
        if not _contains_own_return(stmt, fn_node):
            continue
        if earliest is None or stmt.start_byte < earliest:
            earliest = stmt.start_byte
    return earliest


def _contains_own_return(if_stmt, fn_node) -> bool:
    """True when ``if_stmt`` holds a ``return`` for ``fn_node`` (not nested)."""
    for node in walk(if_stmt):
        if node.type == "return_statement" and _same_node(_enclosing_function(node), fn_node):
            return True
    return False


def _looks_like_hook(name: str) -> bool:
    """React hooks — ``useSomething`` where the char after ``use`` is upper-case."""
    return len(name) >= 4 and name.startswith("use") and name[3].isupper()


_CONDITIONAL_ANCESTOR_LABELS: dict[str, str] = {
    "ternary_expression": "ternary",
    "binary_expression": "&&/||",
}


def _conditional_ancestor_kind(call_node, buf: bytes) -> str | None:
    """Walk up from ``call_node`` and return a label when we hit a conditional.

    Only consider ``ternary_expression`` (``cond ? a : b``) and
    ``binary_expression`` with ``&&`` / ``||``. Stops at the enclosing
    function body — callers inside a nested function aren't the
    component render-path, so Rules of Hooks doesn't apply there.
    """
    node = call_node.parent
    while node is not None:
        if node.type in ("function_declaration", "arrow_function", "method_definition"):
            # Allow the outermost component function to be traversed but
            # stop at nested functions (event handlers, callbacks).
            if node is not call_node.parent.parent:
                return None
        if node.type == "ternary_expression":
            return "ternary"
        if node.type == "binary_expression":
            op = _binary_operator_text(node, buf)
            if op == "&&":
                return "&&"
            if op == "||":
                return "||"
        node = node.parent
    return None


def _binary_operator_text(node, buf: bytes) -> str:
    op = node.child_by_field_name("operator")
    if op is None:
        for child in node.children:
            if not child.is_named:
                op = child
                break
    if op is None:
        return ""
    return buf[op.start_byte : op.end_byte].decode("utf-8")


def _is_inline_object_selector(node) -> bool:
    """``(s) => ({...})`` — arrow with parenthesized-object body."""
    if node.type != "arrow_function":
        return False
    body = node.child_by_field_name("body")
    if body is None:
        return False
    if body.type == "parenthesized_expression":
        for inner in walk(body):
            if inner is body:
                continue
            if inner.type == "object":
                return True
            if (
                inner.type
                not in (
                    "parenthesized_expression",
                    "comment",
                )
                and inner.is_named
            ):
                return False
    return False
