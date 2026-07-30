"""``component.jsx.dead_action_button`` — flag action-verb buttons
with no ``onClick`` / ``href`` / form-submit binding.

The bug this catches
--------------------

App ``r3hfcgx5`` (2026-05-14): OrdersContent rendered an Export
toolbar button with no handler::

    <Button variant="outline" className="...">
      <Icons.Download className="mr-2" />
      Export CSV
    </Button>

The user sees an "Export CSV" affordance, clicks, nothing happens.
This is a sibling pattern to ``ButtonComponentNoOnClickRule`` (which
catches *Button-shaped components that swallow onClick); this rule
catches direct usages of ``<button>`` / ``<Button>`` with action
text but no handler binding.

Severity
--------

Warning. The button renders fine; the bug is missing wiring. False
positives are possible on buttons whose handler is wired via parent
form's ``onSubmit`` or Radix slot ``onSelect`` — those edge cases
warrant a soft signal, not a save-block.

Scope
-----

Triggers:

- Tag is ``button`` or ``Button`` (SDK shadcn-style primitive)
- Visible text contains an action verb (Export, Save, Submit, Send,
  Download, Upload, Delete, Remove, Create, Add, Update, Apply,
  Cancel, Confirm, Sign in, Sign up, Log in, Log out)
- Opening tag has NONE of: ``onClick``, ``onPress``, ``href``,
  ``type="submit"``, spread props (``{...x}``), ``asChild`` (Radix
  slot delegation), ``form=`` attribute

Skips:

- The button is a direct child of a Radix Close / Cancel slot
  (``<DialogClose>``, ``<AlertDialogCancel>``, ``<SheetClose>``,
  ``<PopoverClose>``) — those auto-bind close.
- The text is a tooltip-only label like ``"Open"`` / ``"Close"``
  (covered by aria-label rule for icon-only buttons; out of scope
  here).
"""

from __future__ import annotations

import re
from typing import Iterator

from tree_sitter import Node

from ..walker import find_by_type
from .base import AstContext, Finding

_RULE_ID = "component.jsx.dead_action_button"


_ACTION_VERB_RE = re.compile(
    r"\b("
    r"Export|Save|Submit|Send|Download|Upload|Delete|Remove|Create|"
    r"Add|Update|Apply|Confirm|Sign[\s-]?(?:In|Up|Out)|Log[\s-]?(?:In|Out)|"
    # Conversion / pricing CTAs. A pricing tier's button is the single place a
    # dead CTA costs a paying user, yet none of these verbs were here, so
    # "Choose Plan" / "Get Started" / "Subscribe" sailed through unflagged.
    r"Choose|Pick|Select|Get[\s-]?Started|Get[\s-]?Access|Upgrade|Subscribe|"
    r"Buy|Purchase|Order|Checkout|Start[\s-]?(?:Free|Trial)?|Continue|"
    r"Try[\s-]?(?:Free|It)?|Contact[\s-]?(?:Sales|Us)?|Book|Reserve|Join|Pay"
    r")\b",
    re.IGNORECASE,
)


# CTA-ish prop names. A button whose visible label is a data-driven expression
# like ``{tier.cta}`` / ``{plan.label}`` is itself a call-to-action that the
# jsx_text-only pass can't see. Probed only when no static action verb matched.
_CTA_PROP_NAMES = frozenset(
    {"cta", "ctalabel", "ctatext", "label", "text", "title", "action", "buttontext"}
)


# Radix slot wrappers that auto-bind close/cancel handlers. A button
# inside any of these doesn't need its own onClick.
_AUTO_BIND_PARENT_TAGS = frozenset(
    {
        "DialogClose",
        "AlertDialogCancel",
        "AlertDialogAction",
        "SheetClose",
        "PopoverClose",
        "DropdownMenuItem",
    }
)


def _text(node: Node, buf: bytes) -> str:
    return buf[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def _opening_tag_name(opening: Node, buf: bytes) -> str | None:
    for child in opening.children:
        if child.type in ("identifier", "nested_identifier"):
            return _text(child, buf)
    return None


def _has_handler_attribute(opening: Node, buf: bytes) -> bool:
    """Return True when the opening tag binds onClick / href / type=submit
    / spread / asChild — any of which means the button is plausibly wired.
    """
    src = _text(opening, buf)
    if re.search(r"\b(onClick|onPress|onSelect|asChild)\b", src):
        return True
    if re.search(r"\bhref\s*=", src):
        return True
    if re.search(r'\btype\s*=\s*["\']submit["\']', src):
        return True
    # Spread props: `{...rest}` / `{...props}` / `{...handlers}`.
    if re.search(r"\{\s*\.\.\.[A-Za-z_][\w$]*\s*\}", src):
        return True
    return False


def _collect_visible_text(element: Node, buf: bytes) -> str:
    """Concatenate the text content of a JSX element (recursively).

    Picks up ``jsx_text`` nodes anywhere inside the element. Skips
    JSX expressions to avoid false-positives on interpolated state
    (e.g. ``{isSaving ? "Saving…" : "Save"}`` — the static branch
    still triggers correctly via direct text).
    """
    out: list[str] = []
    for descendant in find_by_type(element, "jsx_text"):
        out.append(_text(descendant, buf))
    return " ".join(out).strip()


def _cta_expression_label(element: Node, buf: bytes) -> str | None:
    """Return a CTA-named ``{expr}`` direct child of ``element`` (e.g.
    ``{tier.cta}``), else None.

    Scans only the element's DIRECT expression children (the button's visible
    content), never the opening tag's attribute expressions, so a
    ``className={cn(...)}`` can't trip it. Catches data-driven CTA labels that
    :func:`_collect_visible_text` (jsx_text only) cannot see — the pricing-page
    dead-button miss.
    """
    for child in element.children:
        if child.type != "jsx_expression":
            continue
        inner = _text(child, buf).strip().strip("{}").strip()
        if not inner:
            continue
        terminal = re.split(r"[.\[\]()]", inner)[-1].strip("'\" ")
        if terminal.lower() in _CTA_PROP_NAMES:
            return inner
    return None


def _parent_tag_name(node: Node, buf: bytes) -> str | None:
    """Walk up to the nearest enclosing ``jsx_element`` and return its
    opening tag name. Returns ``None`` when there's no JSX parent
    (top-level)."""
    cur = node.parent
    while cur is not None:
        if cur.type == "jsx_element":
            opening = cur.child_by_field_name("open_tag")
            if opening is None:
                opening = next(
                    (c for c in cur.children if c.type == "jsx_opening_element"),
                    None,
                )
            if opening is not None:
                return _opening_tag_name(opening, buf)
        cur = cur.parent
    return None


class DeadActionButtonRule:
    """Flag ``<button>`` / ``<Button>`` action-verb buttons missing
    a handler binding."""

    id = _RULE_ID
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        buf = ctx.source_buf
        for element in find_by_type(ctx.tree.root_node, "jsx_element"):
            opening = element.child_by_field_name("open_tag")
            if opening is None:
                opening = next(
                    (c for c in element.children if c.type == "jsx_opening_element"),
                    None,
                )
            if opening is None:
                continue
            tag_name = _opening_tag_name(opening, buf)
            if tag_name not in ("button", "Button"):
                continue
            if _has_handler_attribute(opening, buf):
                continue
            # Auto-bind parent (Dialog/Sheet/Popover close-slot)?
            parent_tag = _parent_tag_name(element, buf)
            if parent_tag in _AUTO_BIND_PARENT_TAGS:
                continue
            text_content = _collect_visible_text(element, buf)
            match = _ACTION_VERB_RE.search(text_content)
            if match is not None:
                verb = match.group(0)
            else:
                # No static action verb in the visible text. Fall through to a
                # data-driven CTA label (e.g. <Button>{tier.cta}</Button>),
                # which is itself a call-to-action when unwired.
                cta_label = _cta_expression_label(element, buf)
                if cta_label is None:
                    continue
                verb = cta_label
            line = opening.start_point[0] + 1
            yield Finding(
                rule_id=_RULE_ID,
                severity="warning",
                line=line,
                col=opening.start_point[1],
                message=(
                    f"<{tag_name}> labelled '{verb}' has no onClick / "
                    f"href / type='submit' binding — clicking does "
                    f"nothing. Either wire a handler, set "
                    f'`type="submit"` (when inside a `<form>` with '
                    f"`onSubmit`), or remove the button if it's not "
                    f"meant to be interactive."
                ),
                fix_hint=(
                    f"Add `onClick={{handle{verb.replace(' ', '')}}}` to "
                    f"the <{tag_name}>, or wrap it in a `<form "
                    f'onSubmit={{...}}>` and set `type="submit"`.'
                ),
            )
