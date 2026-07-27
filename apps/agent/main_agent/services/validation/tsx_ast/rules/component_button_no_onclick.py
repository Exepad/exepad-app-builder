"""``component.handlers.button_component_no_onclick`` — a function whose
name ends in ``Button`` must accept an ``onClick`` prop (or accept
``...rest`` so callers can pass one through).

The bug this catches
--------------------

App ``coje33ih`` DashboardContent (2026-05-12) defined::

    function ActionButton({ icon, label }) {
      return <button className="..."><div>{icon}</div><span>{label}</span></button>;
    }

and rendered three of them as Quick Actions:

    <ActionButton icon={<Icons.Plus />}        label="New Cost Entry" />
    <ActionButton icon={<Icons.RefreshCw />}   label="Recalculate Projections" />
    <ActionButton icon={<Icons.Download />}    label="Export Analysis (PDF)" />

Every call site looks actionable to the user, but the component itself
neither destructures ``onClick`` nor spreads ``...rest`` onto the inner
``<button>`` — so nothing the caller passes can ever fire. The button
is dead JSX.

Resolution shape
----------------

Walk every top-level ``function NAMEButton(...)`` declaration (and
the same for ``const NAMEButton = (...)``). Inspect the parameter's
object-pattern destructure:

* If it explicitly destructures ``onClick`` → pass.
* If it captures a rest pattern (``...rest``, ``...props``) → pass —
  callers' ``onClick`` flows through.
* Otherwise → warning: "this Button-shaped component swallows
  ``onClick``; callers can't wire actions through it."

Severity
--------

Warning. False-positive risk on legitimate non-interactive components
named *Button (e.g. ``LinkButton`` that delegates to ``<a href>``), so
we warn rather than block. The signal in practice is strong: every
``ActionButton``-class regression we've seen had no escape hatch.
"""

from __future__ import annotations

import re
from typing import Iterator

from tree_sitter import Node

from .base import AstContext, Finding


# A component whose name ends in ``Button`` is the audit target. Skipping
# the very generic ``Button`` itself (SDK / shadcn primitive, not a
# locally defined wrapper).
_BUTTON_NAME_RE = re.compile(r"[A-Za-z0-9_]+Button$")


class ButtonComponentNoOnClickRule:
    """``*Button`` function components must accept ``onClick`` (or
    ``...rest``)."""

    id = "component.handlers.button_component_no_onclick"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        for node in _iter_local_function_declarations(ctx.tree.root_node, ctx.source_buf):
            comp_name, params_node, decl_node = node
            if comp_name == "Button":
                continue  # The SDK primitive itself, not a wrapper.
            if not _BUTTON_NAME_RE.match(comp_name):
                continue
            if _params_accept_onclick_or_rest(params_node, ctx.source_buf):
                continue
            yield Finding(
                rule_id=self.id,
                severity="warning",
                message=(
                    f"<{comp_name}> is a Button-shaped component but its props "
                    f"signature destructures neither 'onClick' nor '...rest', "
                    f"so callers passing 'onClick' or 'onPress' will be "
                    f"silently dropped — the button does nothing when clicked. "
                    f"Either accept onClick explicitly, or take '...rest' and "
                    f"spread it onto the underlying <button>."
                ),
                line=decl_node.start_point[0] + 1,
                col=decl_node.start_point[1],
                fix_hint=(
                    "destructure {{ onClick, ...rest }} from props and "
                    "spread {{...rest}} on the underlying button element"
                ),
            )


# ── helpers ──────────────────────────────────────────────────────────


def _iter_local_function_declarations(
    root: Node, buf: bytes
) -> Iterator[tuple[str, Node, Node]]:
    """Yield (name, params_node, declaration_node) for every locally
    declared function component.

    Recognises:
      * ``function Name(...) { ... }``
      * ``const Name = (...) => ...``
      * ``const Name = function(...) { ... }``
    """
    stack: list[Node] = [root]
    while stack:
        node = stack.pop()
        if node.type == "function_declaration":
            name_node = node.child_by_field_name("name")
            params_node = node.child_by_field_name("parameters")
            if name_node is not None and params_node is not None:
                name = buf[name_node.start_byte : name_node.end_byte].decode("utf-8")
                yield (name, params_node, node)
        elif node.type == "variable_declarator":
            name_node = node.child_by_field_name("name")
            value_node = node.child_by_field_name("value")
            if (
                name_node is not None
                and name_node.type == "identifier"
                and value_node is not None
            ):
                name = buf[name_node.start_byte : name_node.end_byte].decode("utf-8")
                params_node: Node | None = None
                if value_node.type == "arrow_function":
                    params_node = value_node.child_by_field_name("parameters")
                elif value_node.type == "function_expression":
                    params_node = value_node.child_by_field_name("parameters")
                if params_node is not None:
                    yield (name, params_node, node)
        stack.extend(node.named_children)


def _params_accept_onclick_or_rest(params_node: Node, buf: bytes) -> bool:
    """Return True if the function's first parameter destructure (object
    pattern) explicitly destructures ``onClick`` OR captures a rest
    pattern (``...rest``/``...props``).

    Examples that PASS:
      ``function X({ onClick, label }) { ... }``
      ``function X({ label, ...rest }) { ... }``
      ``function X(props) { ... }``           — opaque ``props``, can't
        statically rule out onClick — fail open (return True).

    Example that FAILS (returns False):
      ``function X({ icon, label }) { ... }``
    """
    # The first formal parameter — skip whitespace / commas.
    first_param: Node | None = None
    for child in params_node.named_children:
        first_param = child
        break
    if first_param is None:
        # Zero-arg function — definitely doesn't accept onClick. But we
        # don't want to nag every render-only widget; treat as
        # fail-open (return True) because zero-arg ``*Button`` is
        # unusual and probably intentional.
        return True

    # Required parameter wraps: ``required_parameter > X``; optional
    # parameter wraps: ``optional_parameter > X``; the inner node is the
    # destructure pattern (or a plain identifier for opaque props).
    pattern_node = first_param
    if pattern_node.type in ("required_parameter", "optional_parameter"):
        # The destructure / identifier is the ``pattern`` child.
        inner = pattern_node.child_by_field_name("pattern")
        if inner is not None:
            pattern_node = inner

    if pattern_node.type == "identifier":
        # Opaque ``props`` — can't statically rule onClick in or out;
        # fail open. Most callers spread or read props.onClick.
        return True

    if pattern_node.type != "object_pattern":
        # Some other shape (assignment_pattern with default, array_pattern,
        # etc.) — fail open.
        return True

    for child in pattern_node.named_children:
        if child.type == "rest_pattern":
            return True
        if child.type == "shorthand_property_identifier_pattern":
            name = buf[child.start_byte : child.end_byte].decode("utf-8")
            if name == "onClick":
                return True
        elif child.type == "pair_pattern":
            key = child.child_by_field_name("key")
            if key is not None and key.type in (
                "property_identifier",
                "identifier",
            ):
                kname = buf[key.start_byte : key.end_byte].decode("utf-8")
                if kname == "onClick":
                    return True
        elif child.type == "object_assignment_pattern":
            # ``onClick = () => {}`` default — still counts as accepting it.
            ident = next(iter(child.named_children), None)
            if ident is not None and ident.type == "shorthand_property_identifier_pattern":
                name = buf[ident.start_byte : ident.end_byte].decode("utf-8")
                if name == "onClick":
                    return True
    return False
