"""``component.handlers.orphan_form_input`` — every named ``<Input>`` /
``<Select>`` / ``<Textarea>`` inside a ``<form onSubmit>`` must be read
by some ``formData.get("name")`` call somewhere in the same file.

The bug this catches
--------------------

App ``coje33ih`` SettingsContent (2026-05-12): the agent rendered a
settings form with 5 named inputs (``projection_period``, ``currency``,
``labor_rate``, ``org_name``, ``dept_name``), then in ``handleSave``
only read 3 via ``formData.get(...)`` and submitted those to
``updateBusinessSettings``. The UI implied all 5 fields save; in
production they vanished silently. Same class as a Dialog that posts
half its inputs to a partial handler payload.

Resolution shape
----------------

Conservative, file-scoped check:

1. Bail if no ``<form onSubmit={...}>`` element exists in the file
   (component is not a form-submitting component).
2. Collect every literal ``name="X"`` attribute on form-shaped JSX:
   ``Input`` / ``Select`` / ``Textarea`` (SDK / shadcn casing) and the
   raw ``input`` / ``select`` / ``textarea`` HTML elements. Skip JSX
   that nests inside a tighter ``<form>`` — only audit names belonging
   to the outer form.
3. Collect every literal first-argument to ``formData.get(...)`` /
   ``formData.getAll(...)`` ANYWHERE in the file.
4. Skip CONTROLLED inputs — ``value=``/``checked=`` bound together with an
   ``onChange``-family handler. Those read through React state, not the
   FormData API, so ``formData.get`` is irrelevant to them.
5. Any remaining input name not present in the get-set yields a finding.

Step 4 exists because without it the rule fires on the *idiomatic* React
form. Live example (Cedar Ridge Lodge ContactContent, 2026-07-25): a
correct controlled form — ``const [formData, setFormData] = useState({...})``
with ``value={formData.name} onChange={...}`` on each field and a submit that
posts ``formData.name`` etc. — drew four warnings claiming "the field is
rendered but its value is dropped on submit". Every one was false: the values
submit fine. The rule was matching only the UNCONTROLLED shape, and the state
object happening to be *named* ``formData`` made the miss especially
confusing. The advice it emits ("or remove the input") is actively harmful
when acted on in a later edit.

Severity
--------

Warning. Residual false-positive risk on rare "name is purely HTML semantic"
uses (e.g. autofill hints without intent to submit) — the user can
correct or extend the input list. The bug-class itself is high signal
in practice; most ``name=`` attrs on UNCONTROLLED form-shaped inputs DO
intend submission.
"""

from __future__ import annotations

from typing import Iterator

from tree_sitter import Node

from ..walker import (
    iter_jsx_opening_elements,
    jsx_attribute_string_value,
    jsx_tag_name,
)
from .base import AstContext, Finding

# Form-input shapes whose ``name=`` attr we audit. Includes SDK / shadcn
# wrapper components (``Input``, ``Select``, ``Textarea``) and the raw
# HTML element forms used by some agent outputs.
_INPUT_TAGS: frozenset[str] = frozenset(
    {
        "Input",
        "Select",
        "Textarea",
        "Checkbox",
        "RadioGroup",
        "input",
        "select",
        "textarea",
    }
)

# Form-submit container — only audit inputs inside one of these. Without
# a ``<form onSubmit>`` ancestor, ``name`` attrs are not meaningful for
# our purposes (they may be passed to platform-form integrations).
_FORM_TAGS: frozenset[str] = frozenset({"form"})


class OrphanFormInputRule:
    """Form-input ``name="X"`` must be read by some ``formData.get("X")``."""

    id = "component.handlers.orphan_form_input"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        # Bail if there's no <form onSubmit> in the file at all.
        form_ranges = list(_iter_form_onsubmit_ranges(ctx.tree.root_node, ctx.source_buf))
        if not form_ranges:
            return

        # Gather every literal ``formData.get("X") / formData.getAll("X")``
        # name across the whole file — function-scope tracing is brittle
        # in JSX, so we accept the slight over-permissiveness.
        read_names = _collect_formdata_get_names(ctx.tree.root_node, ctx.source_buf)

        for elem in iter_jsx_opening_elements(ctx.tree.root_node):
            tag = jsx_tag_name(elem, ctx.source_buf)
            if tag not in _INPUT_TAGS:
                continue
            name_value = jsx_attribute_string_value(elem, "name", ctx.source_buf)
            if not name_value:
                continue
            # Must be inside one of the form-onSubmit ranges.
            if not _any_range_contains(form_ranges, elem.start_byte):
                continue
            if name_value in read_names:
                continue
            # Controlled input: its value lives in React state, so the FormData
            # API is simply not how it submits. Not an orphan.
            #
            # Gated on the file reading NO FormData at all. When a file DOES call
            # formData.get(...), that IS its submit path, and a named input the
            # handler forgot to read is the original bug class again — being
            # controlled does not save it, because the payload is built from the
            # get() calls. Ungated, the exemption silenced those true positives.
            if not read_names and _is_controlled_input(elem, ctx.source_buf):
                continue
            yield Finding(
                rule_id=self.id,
                severity="warning",
                message=(
                    f'<{tag} name="{name_value}"> is inside a <form onSubmit> '
                    f'but no formData.get("{name_value}") call reads it. The '
                    f"field is rendered but its value is dropped on submit. "
                    f'Either read it via formData.get("{name_value}") and '
                    f"include it in the handler payload, or remove the input."
                ),
                line=elem.start_point[0] + 1,
                col=elem.start_point[1],
                fix_hint=(
                    f'add formData.get("{name_value}") to the submit handler '
                    f"and forward the value to the bound handler's params"
                ),
            )


# ── helpers ──────────────────────────────────────────────────────────

# A React-controlled input binds its displayed value AND publishes edits back.
_VALUE_ATTRS: frozenset[str] = frozenset({"value", "checked"})
_CHANGE_ATTRS: frozenset[str] = frozenset(
    {"onChange", "onValueChange", "onCheckedChange", "onInput"}
)


def _jsx_attribute_names(opening: Node, buf: bytes) -> set[str]:
    """Names of every ``jsx_attribute`` on an opening element (value ignored)."""
    names: set[str] = set()
    for attr in opening.named_children:
        if attr.type != "jsx_attribute":
            continue
        name_node = next(iter(attr.named_children), None)
        if name_node is None:
            continue
        names.add(buf[name_node.start_byte : name_node.end_byte].decode("utf-8"))
    return names


def _is_controlled_input(opening: Node, buf: bytes) -> bool:
    """True for a React-controlled input: a bound ``value``/``checked`` PLUS a
    change handler.

    Both halves are required deliberately. ``value`` alone is a static/readonly
    field that may still be intended to submit via FormData, and a handler alone
    (e.g. ``onChange`` used only for validation) leaves the value uncontrolled —
    in both cases the orphan check still carries signal.
    """
    attrs = _jsx_attribute_names(opening, buf)
    return bool(attrs & _VALUE_ATTRS) and bool(attrs & _CHANGE_ATTRS)


def _iter_form_onsubmit_ranges(root: Node, buf: bytes) -> Iterator[tuple[int, int]]:
    """Yield (start_byte, end_byte) of every ``<form onSubmit={...}>``'s
    enclosing element. We need the WHOLE element (open + body + close)
    so inputs inside the form's children fall within range.
    """
    for opening in iter_jsx_opening_elements(root):
        tag = jsx_tag_name(opening, buf)
        if tag not in _FORM_TAGS:
            continue
        # Require an onSubmit attr; presence (not value) is enough.
        has_onsubmit = False
        for attr in opening.named_children:
            if attr.type != "jsx_attribute":
                continue
            name_node = next(iter(attr.named_children), None)
            if name_node is None:
                continue
            attr_name = buf[name_node.start_byte : name_node.end_byte].decode("utf-8")
            if attr_name == "onSubmit":
                has_onsubmit = True
                break
        if not has_onsubmit:
            continue
        enclosing = opening.parent if opening.parent is not None else opening
        yield (enclosing.start_byte, enclosing.end_byte)


def _collect_formdata_get_names(root: Node, buf: bytes) -> set[str]:
    """Return the set of literal first-args to ``formData.get(...)`` /
    ``formData.getAll(...)`` anywhere in the file.

    Recognises any local FormData binding name — the agent sometimes
    aliases (``const fd = new FormData(...)``). To keep the scan cheap
    we don't trace the alias; we accept any ``X.get("Y")`` /
    ``X.getAll("Y")`` whose receiver identifier is one of the common
    FormData spellings.
    """
    formdata_receivers: frozenset[str] = frozenset({"formData", "fd", "form", "data"})
    out: set[str] = set()
    stack: list[Node] = [root]
    while stack:
        node = stack.pop()
        if node.type == "call_expression":
            callee = node.child_by_field_name("function")
            args = node.child_by_field_name("arguments")
            if callee is not None and callee.type == "member_expression" and args is not None:
                obj = callee.child_by_field_name("object")
                prop = callee.child_by_field_name("property")
                if (
                    obj is not None
                    and prop is not None
                    and obj.type == "identifier"
                    and prop.type == "property_identifier"
                ):
                    obj_name = buf[obj.start_byte : obj.end_byte].decode("utf-8")
                    prop_name = buf[prop.start_byte : prop.end_byte].decode("utf-8")
                    if obj_name in formdata_receivers and prop_name in (
                        "get",
                        "getAll",
                    ):
                        for arg in args.named_children:
                            if arg.type == "string":
                                raw = buf[arg.start_byte : arg.end_byte].decode("utf-8")
                                if len(raw) >= 2 and raw[0] in "'\"" and raw[-1] in "'\"":
                                    out.add(raw[1:-1])
                            # Only the first positional arg matters.
                            break
        stack.extend(node.named_children)
    return out


def _any_range_contains(ranges: list[tuple[int, int]], byte_pos: int) -> bool:
    for start, end in ranges:
        if start <= byte_pos < end:
            return True
    return False
