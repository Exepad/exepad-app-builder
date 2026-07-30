"""``component.sdk.use_current_user_nullable_field_chain`` — chained
access on a nullable ``useCurrentUser()`` field must use optional-chain.

The bug this catches
--------------------

App ``eiu7xj0v`` (2026-05-14): ``EmployeesContent.tsx`` does:

    const user = useCurrentUser();
    const isAdmin = user.roles.includes("admin");
    // ...
    <h2>{user.name.charAt(0)}</h2>

``useCurrentUser()`` never returns ``null`` — it falls back to
``anonymousUser = {id:null, email:null, name:null, roles:[], isAuthenticated:false}``
(``packages/exepad-sdk/src/platform/useCurrentUser.ts:4-18``). So
``user.roles.includes(...)`` is safe (``roles`` defaults to ``[]``),
but ``user.name.charAt(0)`` crashes when ``name`` is ``null`` — and
``name``/``email``/``id`` are typed nullable in the SDK's
``CurrentUser`` interface (``packages/exepad-sdk/src/platform/types.ts:84-90``).

Rule scope
----------

Flag chained access on the **nullable** fields without an optional
chain or an explicit null guard upstream:

* ``user.id.X``        → flag (id is ``string | null``)
* ``user.email.X``     → flag (email is ``string | null``)
* ``user.name.X``      → flag (name is ``string | null | undefined``)
* ``user.id?.X``       → ok (already optional-chained)
* ``user.email ? user.email.X : '?'`` → flag (we don't narrow; the
  agent should write ``user.email?.X`` either way for consistency)
* ``user.roles.X``     → never flag (roles defaults to ``[]``)
* ``user.isAuthenticated.X`` → never flag (boolean)
* Bare ``user.email`` in JSX  → never flag (interpolates ``null`` fine)

The rule is intentionally conservative: it triggers only on chained
member access (``user.id.X.Y...`` or ``user.id(...)``), not on bare
field reads — those interpolate ``null`` harmlessly into JSX text.

Fail-open contract
------------------

If the component doesn't bind ``useCurrentUser()`` at all, the rule
yields no findings. Aliasing through intermediate variables
(``const u = useCurrentUser(); u.id.toUpperCase()``) is supported. We
don't trace through more complex aliases (object spread,
destructured fields) — those fall through to fail-open.

Severity
--------

Warning at first ship; escalate after replay confirms the false-positive
rate is acceptable. Pairs with the deterministic auto-fix in
``fixers/component_null_safety.py`` which rewrites ``user.<field>.X``
to ``user.<field>?.X`` when the field is in the nullable set.
"""

from __future__ import annotations

from typing import Iterator, Optional

from tree_sitter import Node

from ..walker import walk
from .base import AstContext, Finding


_RULE_ID = "component.sdk.use_current_user_nullable_field_chain"

# Fields on the SDK's ``CurrentUser`` interface that are typed nullable.
# Source: packages/exepad-sdk/src/platform/types.ts:84-90.
# If the SDK schema changes, update this set together.
_NULLABLE_FIELDS: frozenset[str] = frozenset({"id", "email", "name"})


class UseCurrentUserNullableFieldChainRule:
    """Chained access on a nullable ``useCurrentUser()`` field needs ``?.``."""

    id = _RULE_ID
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        # 1. Collect every local that aliases the return of ``useCurrentUser()``:
        #    const user = useCurrentUser();         → "user"
        #    const u: CurrentUser = useCurrentUser(); → "u"
        # Destructured bindings like ``const { id } = useCurrentUser()`` are
        # not covered today — the agent rarely emits that shape and the
        # destructure flattens any nesting we'd want to flag.
        aliases = _collect_use_current_user_aliases(ctx.tree.root_node, ctx.source_buf)
        if not aliases:
            return

        seen: set[tuple[int, int, str]] = set()
        for node in walk(ctx.tree.root_node):
            if node.type != "member_expression":
                continue
            # We care only about chained access — i.e. the parent of this
            # member_expression must ALSO be a member_expression (for
            # ``user.id.X``), a call_expression with this as callee (for
            # ``user.id()``), or a subscript_expression (for ``user.id[0]``).
            parent = node.parent
            if parent is None:
                continue
            outer_is_chain = (
                parent.type == "member_expression"
                # ``user.id?.X`` — already optional-chained
                or parent.type == "subscript_expression"
                or (
                    parent.type == "call_expression"
                    and parent.child_by_field_name("function") == node
                )
            )
            if not outer_is_chain:
                continue

            # The chain link AFTER ``.id`` is what matters: is the OUTER
            # access optional? ``user.id?.X`` → safe (skip). ``user?.id.X``
            # → unsafe (don't skip — inner optional protects against
            # ``user`` being null, but ``id`` itself is the nullable field).
            # Since ``useCurrentUser()`` never returns null, the inner
            # optional is redundant either way; the rule only judges
            # access PAST the nullable field. ``member_expression``,
            # ``subscript_expression``, and ``call_expression`` can all
            # carry the ``?.`` operator.
            if _has_optional_link(parent):
                continue

            # Decode the (root, field) of this member_expression.
            obj = node.child_by_field_name("object")
            prop = node.child_by_field_name("property")
            if obj is None or obj.type != "identifier":
                continue
            if prop is None or prop.type != "property_identifier":
                continue
            root_name = ctx.source_buf[obj.start_byte : obj.end_byte].decode("utf-8")
            field_name = ctx.source_buf[prop.start_byte : prop.end_byte].decode(
                "utf-8"
            )
            if root_name not in aliases:
                continue
            if field_name not in _NULLABLE_FIELDS:
                continue

            line = prop.start_point[0] + 1
            col = prop.start_point[1]
            seen_key = (line, col, field_name)
            if seen_key in seen:
                continue
            seen.add(seen_key)

            yield Finding(
                rule_id=_RULE_ID,
                severity="warning",
                line=line,
                col=col,
                message=(
                    f"`{root_name}.{field_name}` is nullable per SDK "
                    f"`CurrentUser` type — chained access "
                    f"`{root_name}.{field_name}.X` crashes when "
                    f"`{field_name}` is null (anonymous user). "
                    f"Use optional chain: `{root_name}.{field_name}?.X`."
                ),
                fix_hint=(
                    f"rewrite `{root_name}.{field_name}.<member>` to "
                    f"`{root_name}.{field_name}?.<member>` — paired auto-fix "
                    f"available in component_null_safety fixer."
                ),
            )


# ── helpers ──────────────────────────────────────────────────────────


def _collect_use_current_user_aliases(root: Node, buf: bytes) -> set[str]:
    """Return the set of local-binding names assigned ``useCurrentUser()``.

    Walks every ``variable_declarator`` whose value is a (possibly
    member-chained) call to ``useCurrentUser`` and whose name is a
    plain identifier. Destructured bindings (``{ id } = useCurrentUser()``)
    are out of scope — see rule docstring.
    """
    out: set[str] = set()
    for node in walk(root):
        if node.type != "variable_declarator":
            continue
        value = node.child_by_field_name("value")
        name = node.child_by_field_name("name")
        if value is None or name is None:
            continue
        if name.type != "identifier":
            continue
        if not _is_use_current_user_call(value, buf):
            continue
        out.add(buf[name.start_byte : name.end_byte].decode("utf-8"))
    return out


def _is_use_current_user_call(value_node: Node, buf: bytes) -> bool:
    """True if ``value_node`` is ``useCurrentUser()`` (or chained on its
    return, e.g. ``useCurrentUser().something`` — unusual but tolerated).
    """
    n: Optional[Node] = value_node
    while n is not None and n.type == "member_expression":
        n = n.child_by_field_name("object")
    if n is None or n.type != "call_expression":
        return False
    callee = n.child_by_field_name("function")
    if callee is None or callee.type != "identifier":
        return False
    return buf[callee.start_byte : callee.end_byte].decode("utf-8") == "useCurrentUser"


def _has_optional_link(node: Node) -> bool:
    """True if ``node`` carries an ``?.`` operator at its top level.

    Tree-sitter's TypeScript grammar represents the optional operator
    as either an ``optional_chain`` named node OR an anonymous ``?.``
    token (depending on grammar version). Member, subscript, and call
    expressions can all carry it.
    """
    for child in node.children:
        if child.type == "optional_chain":
            return True
        if not child.is_named:
            text = child.text.decode("utf-8") if child.text else ""
            if text == "?.":
                return True
    return False
