"""Accessibility / UX fixes for component TSX auto-fix.

Covers:

- Lowercase title-case status keys inside style/label maps
  (``{ Paid: ..., Pending: ... }`` → ``{ paid: ..., pending: ... }``).
- Inject ``<DialogDescription>`` under ``<DialogContent>`` for screen-reader
  a11y, and add the SDK import when it's used but missing.
- Wrap mixed icon+text children of ``<Button>`` inside ``*Trigger asChild``
  in a single ``<span>`` to avoid Radix Slot's ``React.Children.only`` crash.
- Lowercase title-case status string literals in CRUD writes
  (``status: "Sent"`` → ``status: "sent"``) and in function arguments
  (``handleSave("Draft")`` → ``handleSave("draft")``).
- Demote heading tags that skip levels (``<h1>...<h3>`` → ``<h1>...<h2>``)
  so the rendered hierarchy descends sequentially. Visual styling is in
  ``className`` so the tag change doesn't affect appearance.

**AST migration status (Change J):**

* Status-key lowercaser walks tree-sitter ``object`` literals. Replaces
  the legacy ``re.sub(r"\\{[^{}]{20,500}\\}", ...)`` over raw TSX, which
  matched arbitrary brace-blocks (incl. JSX expression bodies, JSDoc
  comments).
* DialogDescription injection walks ``jsx_element`` nodes by tag name.
  Replaces the legacy ``"<DialogDescription" in tsx`` substring check
  that produced the regression-corpus fixture-22 captured bug — JSDoc
  mentions of ``<DialogDescription>`` falsely triggered the "imported
  only" path, leaving real ``<DialogContent>`` elements without the
  screen-reader description child.
* Status-literal lowercaser walks ``pair`` and ``call_expression`` nodes
  via tree-sitter so comments / strings containing ``status: "Sent"``
  are no longer mutated.

The aria-label-on-icon-only-button injector and heading-order demoter
were already AST-based pre-J and are unchanged.
"""

from __future__ import annotations

import re

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.semantic_validator import (
    _SDK_IMPORT_RE,
    _STATUS_WORDS_TITLE,
    _add_sdk_import,
    _wrap_mixed_trigger_button_children,
)
from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.walker import (
    _classname_static_value,
    find_by_type,
    iter_jsx_opening_elements,
    jsx_attribute_string_value,
    jsx_attribute_value_node,
    jsx_tag_name,
    string_literal_value,
    walk,
)

_HEADING_TAG_RE = re.compile(r"^h([1-6])$")

# Card-like container tags whose internal headings should NOT be silently
# promoted to compete with section headings. A heading nested in a
# ``<Card>`` / ``<CardContent>`` is typically a card-internal label (e.g.
# the title of a chart widget, a stat card), not a section anchor — promoting
# it to ``<h2>`` puts it in the DOM at the same level as actual page sections.
# The validator's ``HeadingOrderRule`` warning still fires for these, so
# authors can still see and address the issue; we just don't apply the
# silent rewrite.
_HEADING_CARD_ANCESTOR_TAGS = frozenset({"Card", "CardContent"})


def _is_inside_card_subtree(elem, buf: bytes) -> bool:
    """True iff ``elem`` is nested inside a ``<Card>`` or ``<CardContent>``.

    Walks ``elem.parent`` chain looking for an ancestor whose opening tag
    name is in ``_HEADING_CARD_ANCESTOR_TAGS``. Used by the heading-order
    fixer to skip card-internal labels.
    """
    parent = elem.parent
    while parent is not None:
        if parent.type == "jsx_element":
            for child in parent.children:
                if child.type == "jsx_opening_element":
                    if jsx_tag_name(child, buf) in _HEADING_CARD_ANCESTOR_TAGS:
                        return True
                    break
        parent = parent.parent
    return False


# Function-name-prefix gate for status literal arg rewrites. Only mutate
# the argument when the callee starts with one of these (``handleSave``,
# ``markPaid``, ``setStatus``, etc.) — narrows the surface so we don't
# rewrite bare string args to unrelated functions like ``log("Draft")``.
_STATUS_ARG_PREFIXES = ("save", "update", "set", "handle", "mark")


def apply_component_a11y_ux_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    # Combined AST pass for the four status / DialogDescription
    # migrations — all share one tree-sitter parse to keep the fixer
    # under the 1-second perf budget on large inputs. The passes are
    # mutually independent (they queue edits to disjoint byte ranges,
    # so right-to-left splicing applies them all in one shot).
    tsx = _fix_status_and_dialog_passes(tsx, fixes_applied)
    # Auto-fix: wrap mixed icon+text children of a <Button> under `*Trigger asChild`
    # in a single <span>. Radix Slot (used by *Trigger asChild) calls
    # React.Children.only on its cloned child's structure in some bundling
    # configurations, and icon+text buttons have been observed to crash at
    # runtime with "expected to receive a single React element child". Giving
    # the Button exactly one element child avoids the failure mode entirely.
    tsx, mixed_child_fixes = _wrap_mixed_trigger_button_children(tsx)
    fixes_applied.extend(mixed_child_fixes)
    # Promoter MUST run before the demoter — it creates the <h1> the demoter
    # uses as the level-1 anchor. Otherwise a component whose first heading
    # is <h2> would have that h2 demoted before promotion gets a chance.
    tsx = _fix_route_component_h1_promote(tsx, ctx, fixes_applied)
    tsx = _fix_heading_order_demote(tsx, fixes_applied)
    tsx = _fix_icon_only_button_aria_label(tsx, fixes_applied)
    # Announce read-only star ratings (role=img + value aria-label) — they
    # otherwise convey the value only through icon fill, invisible to a
    # screen reader. Complements the a11y-keyboard-aria skill's guidance
    # (which the model applies inconsistently).
    tsx = _fix_star_rating_aria(tsx, fixes_applied)
    return tsx


def _fix_status_and_dialog_passes(tsx: str, fixes_applied: list[str]) -> str:
    """Combined AST pass: status-key lowercaser + status-literal /
    status-arg rewriters + DialogDescription injection.

    Single tree-sitter parse drives four mutually-independent phases.
    Each phase queues byte-range edits onto a shared list; we splice
    them all right-to-left at the end. The DialogDescription
    "add SDK import" side-effect runs after the splice so its
    string-level rewrite of the import line works on the final source.

    Fast path: a substring pre-screen skips the parse when the source
    clearly has none of the patterns any phase cares about. Important
    for keeping the per-fixer ``< 1s on 1000-line input`` perf budget —
    the typical generated component has neither status maps nor
    DialogContent and shouldn't pay for a tree-sitter parse it can't
    use. The substring scan over a ~50 kB source is microseconds.
    """
    # Fast path — pre-screen substrings cheaply.
    has_dialog = "DialogContent" in tsx or "DialogDescription" in tsx
    has_status = any(w in tsx for w in _STATUS_WORDS_TITLE)
    if not has_dialog and not has_status:
        return tsx

    try:
        tree = parse_tsx(tsx)
    except Exception:
        return tsx
    buf = source_bytes(tsx)

    edits: list[tuple[int, int, str]] = []
    deferred_messages: list[str] = []
    obj_status_records: list[list[str]] = []

    # Phase A: status-key lowercaser (object pairs with ≥2 status hits).
    for obj in find_by_type(tree.root_node, "object"):
        title_case_pairs: list[tuple[int, int, str]] = []
        for child in obj.named_children:
            if child.type != "pair":
                continue
            key = child.child_by_field_name("key")
            if key is None or key.type not in ("property_identifier", "identifier"):
                continue
            name = buf[key.start_byte : key.end_byte].decode("utf-8")
            if name in _STATUS_WORDS_TITLE:
                title_case_pairs.append((key.start_byte, key.end_byte, name))
        if len(title_case_pairs) < 2:
            continue
        names: list[str] = []
        for start, end, name in title_case_pairs:
            edits.append((start, end, name.lower()))
            names.append(name)
        obj_status_records.append(names)

    # Phase B: status: "Title" pair-value lowercaser.
    for pair in find_by_type(tree.root_node, "pair"):
        key = pair.child_by_field_name("key")
        if key is None or key.type not in ("property_identifier", "identifier"):
            continue
        if buf[key.start_byte : key.end_byte].decode("utf-8") != "status":
            continue
        value = pair.child_by_field_name("value")
        if value is None or value.type != "string":
            continue
        text = string_literal_value(value, buf)
        if text not in _STATUS_WORDS_TITLE:
            continue
        lowered = text.lower()
        edits.append((value.start_byte + 1, value.end_byte - 1, lowered))
        deferred_messages.append(f'Lowercased status literal: "{text}" → "{lowered}"')

    # Phase C: handleSave("Title") / markPaid("Title") arg lowercaser.
    for call in find_by_type(tree.root_node, "call_expression"):
        callee = call.child_by_field_name("function")
        if callee is None or callee.type != "identifier":
            continue
        fn_name = buf[callee.start_byte : callee.end_byte].decode("utf-8")
        if not any(fn_name.startswith(p) for p in _STATUS_ARG_PREFIXES):
            continue
        args = call.child_by_field_name("arguments")
        if args is None or args.named_child_count != 1:
            continue
        arg = args.named_children[0]
        if arg.type != "string":
            continue
        text = string_literal_value(arg, buf)
        if text not in _STATUS_WORDS_TITLE:
            continue
        lowered = text.lower()
        edits.append((arg.start_byte + 1, arg.end_byte - 1, lowered))
        deferred_messages.append(
            f'Lowercased status arg: {fn_name}("{text}") → {fn_name}("{lowered}")'
        )

    # Phase D: DialogDescription injection. Two cases: inject the child
    # element (Case 1), or add the SDK import (Case 2). Element edits
    # go through the shared queue; the import-line edit is deferred to
    # after the splice (it's a separate string transformation that
    # touches a different region of the file — the import line).
    has_dialog_description_in_jsx = False
    dialog_content_targets = []  # opening-element nodes needing injection
    for el in iter_jsx_opening_elements(tree.root_node):
        tag = jsx_tag_name(el, buf)
        if tag == "DialogDescription":
            has_dialog_description_in_jsx = True
        if tag == "DialogContent":
            if jsx_attribute_value_node(el, "aria-describedby", buf) is not None:
                continue
            wrapper = el.parent
            if wrapper is None or wrapper.type != "jsx_element":
                continue
            if _has_jsx_child_with_tag(wrapper, "DialogDescription", buf):
                continue
            dialog_content_targets.append(el)

    add_dialog_description_import = False
    add_dialog_description_msg: str | None = None
    if dialog_content_targets and not has_dialog_description_in_jsx:
        for el in dialog_content_targets:
            insert_byte = el.end_byte
            edits.append(
                (
                    insert_byte,
                    insert_byte,
                    '\n            <DialogDescription className="sr-only">'
                    "Dialog content</DialogDescription>",
                )
            )
        add_dialog_description_import = True
        add_dialog_description_msg = "Added DialogDescription for accessibility"
    elif has_dialog_description_in_jsx and not _import_includes_name(tsx, "DialogDescription"):
        add_dialog_description_import = True
        add_dialog_description_msg = "Added missing DialogDescription import"

    # Splice all queued edits right-to-left.
    if edits:
        out = buf
        for start, end, replacement in sorted(edits, key=lambda e: -e[0]):
            out = out[:start] + replacement.encode("utf-8") + out[end:]
        tsx = out.decode("utf-8")

    # Emit telemetry for object-status phase (one entry per object).
    for names in obj_status_records:
        fixes_applied.append(
            f"Lowercased status map keys: " f"{', '.join(f'{n}→{n.lower()}' for n in names)}"
        )
    fixes_applied.extend(deferred_messages)

    # Add DialogDescription to the SDK import line if needed. This is a
    # separate string rewrite (touches the import line, not JSX), runs
    # after the JSX splice so it works on the post-splice source.
    if add_dialog_description_import:
        tsx = _add_sdk_import(tsx, "DialogDescription")
        if add_dialog_description_msg:
            fixes_applied.append(add_dialog_description_msg)
    return tsx


# ---------------------------------------------------------------------------
# AST helpers used by the consolidated status / dialog pass above.
# ---------------------------------------------------------------------------


def _has_jsx_child_with_tag(jsx_element_node, tag_name: str, buf: bytes) -> bool:
    """True iff ``jsx_element_node`` has a direct JSX child element with
    the given tag name. Walks the wrapper's direct children only — does
    not recurse into nested JSX expression bodies (those wrap their own
    scope and shouldn't satisfy "is the description IN the dialog?").
    """
    for child in jsx_element_node.children:
        if child.type == "jsx_element":
            for sub in child.children:
                if sub.type == "jsx_opening_element":
                    if jsx_tag_name(sub, buf) == tag_name:
                        return True
        elif child.type == "jsx_self_closing_element":
            if jsx_tag_name(child, buf) == tag_name:
                return True
    return False


def _import_includes_name(tsx: str, name: str) -> bool:
    """True iff the SDK import line names ``name``.

    Uses ``_SDK_IMPORT_RE`` to find the import line, then word-boundary
    match on the destructured names. The import-line regex is
    bounded to a single import statement, so the comment-match risk is
    minimal here.
    """
    sdk_match = _SDK_IMPORT_RE.search(tsx)
    if sdk_match is None:
        return False
    return bool(re.search(rf"\b{re.escape(name)}\b", sdk_match.group(1)))


# ---------------------------------------------------------------------------
# Icon-only button aria-label injector
# ---------------------------------------------------------------------------
#
# Mirrors the warning emitted by ``ButtonAriaLabelRule`` in
# ``tsx_ast/rules/component_a11y.py``. When we can confidently derive an
# accessible name from the button's children (icon name) or from an
# ``onX`` event handler identifier (handleSearch → "Search"), we splice
# in ``aria-label="..."`` so the warning never reaches the user. When
# nothing is inferable, we leave the element alone — the warning still
# fires and a human or follow-up edit can pick the right label.

_BUTTON_TAG_NAMES = frozenset({"button", "Button", "IconButton", "a"})
_A11Y_ATTRS = ("aria-label", "aria-labelledby", "title")
# Strip these prefixes from event-handler identifiers when deriving a
# label. Order matters — longer prefixes first.
_HANDLER_PREFIXES = ("handleOn", "handle", "on")
# Strip these noisy suffixes after prefix removal.
_HANDLER_SUFFIXES = ("Click", "Press", "Tap")


def _fix_icon_only_button_aria_label(tsx: str, fixes_applied: list[str]) -> str:
    """Inject ``aria-label`` on icon-only buttons when the label is
    inferable from a child icon name or an event-handler identifier.

    Skips buttons that already carry ``aria-label`` / ``aria-labelledby``
    / ``title``, buttons with visible text content, and buttons where no
    label can be confidently derived.
    """
    try:
        tree = parse_tsx(tsx)
    except Exception:
        return tsx
    buf = source_bytes(tsx)

    edits: list[tuple[int, int, str]] = []  # (start, end, replacement)
    fixed_count = 0
    for el in iter_jsx_opening_elements(tree.root_node):
        name = jsx_tag_name(el, buf)
        if name not in _BUTTON_TAG_NAMES:
            continue
        if _has_accessible_name(el, buf):
            continue

        self_closing = el.type == "jsx_self_closing_element"
        if not self_closing:
            jsx_element = el.parent
            if jsx_element is None or jsx_element.type != "jsx_element":
                continue
            if _element_has_visible_text(jsx_element, buf):
                continue
            # An <img alt="…"> child or a descendant aria label already names
            # the element (e.g. logo links `<a><img alt="Acme"/></a>`) — don't
            # inject a redundant/wrong label. Mirrors the rule's exemption.
            if _subtree_provides_accessible_name(jsx_element, buf):
                continue
            label = _label_from_first_child_icon(jsx_element, buf) or _label_from_handler(el, buf)
        else:
            # Self-closing has no children — only the handler hint.
            label = _label_from_handler(el, buf)

        if not label:
            # Nothing inferable — leave for the warning to surface.
            continue

        insert_byte = _opening_tag_name_end(el, buf)
        if insert_byte is None:
            continue
        # Splice ``" aria-label=\"<label>\""`` right after the tag name.
        # Other attributes shift right; valid JSX in every order.
        edits.append((insert_byte, insert_byte, f' aria-label="{label}"'))
        fixed_count += 1

    if not edits:
        return tsx

    out = buf
    for start, end, replacement in sorted(edits, key=lambda e: -e[0]):
        out = out[:start] + replacement.encode("utf-8") + out[end:]

    fixes_applied.append(
        f"Injected aria-label on {fixed_count} icon-only button(s) for screen readers"
    )
    return out.decode("utf-8")


def _has_accessible_name(opening, buf: bytes) -> bool:
    for attr in _A11Y_ATTRS:
        if jsx_attribute_value_node(opening, attr, buf) is not None:
            return True
    return False


# ── Read-only star-rating aria-label injector ────────────────────────────
# A read-only rating rendered as `<div>{[1,2,3,4,5].map(star => <Icons.Star
# className={star <= rating ? …} />)}</div>` conveys its value ONLY through
# icon fill — silent to a screen reader. This injects `role="img"` +
# `aria-label={`${rating} out of 5 stars`}` on the container so the value is
# announced. Value is read from the `<loopVar> <=/< X` comparison; N from the
# mapped array length. Deliberately narrow (see the guards) and rollback-guarded.
_RATING_VALUE_SAFE_RE = re.compile(r"^[A-Za-z0-9_.$ ?()\[\]]+$")
_RATING_CONTAINER_TAGS = frozenset({"div", "span"})


def _opening_element_of(node):
    """Return the opening element for a jsx_element / jsx_self_closing_element."""
    if node.type == "jsx_self_closing_element":
        return node
    if node.type == "jsx_element":
        for c in node.children:
            if c.type == "jsx_opening_element":
                return c
    return None


def _tag_base(opening, buf: bytes) -> str:
    tag = jsx_tag_name(opening, buf)
    return tag.rsplit(".", 1)[-1] if "." in tag else tag


def _mapped_array_length(obj, buf: bytes) -> int | None:
    """Length of the mapped collection: a pure number-literal array
    (``[1,2,3,4,5]`` → 5), ``Array.from({length: N})`` or ``[...Array(N)]``."""
    if obj is None:
        return None
    if obj.type == "array":
        elems = [c for c in obj.named_children if c.type != "comment"]
        if elems and all(c.type == "number" for c in elems):
            return len(elems)
        # else fall through: e.g. `[...Array(5)]` is an array node whose element
        # is a spread, matched by the Array(N) text regex below.
    txt = buf[obj.start_byte : obj.end_byte].decode("utf-8", "ignore")
    m = re.search(r"length\s*:\s*(\d+)", txt) or re.search(r"Array\(\s*(\d+)\s*\)", txt)
    return int(m.group(1)) if m else None


def _arrow_param_names(arrow, buf: bytes) -> set[str]:
    names: set[str] = set()
    for field in ("parameters", "parameter"):
        node = arrow.child_by_field_name(field)
        if node is None:
            continue
        candidates = [node] if node.type == "identifier" else list(node.named_children)
        for p in candidates:
            if p.type == "identifier":
                names.add(buf[p.start_byte : p.end_byte].decode("utf-8", "ignore"))
            else:
                idn = next((i for i in find_by_type(p, "identifier")), None)
                if idn is not None:
                    names.add(buf[idn.start_byte : idn.end_byte].decode("utf-8", "ignore"))
    return names


def _opening_has_event_handler(opening, buf: bytes) -> bool:
    """True when the element carries ANY ``on<Event>`` handler prop. A read-only
    rating display has none; any handler (onClick, onMouseEnter, onFocus, …)
    marks an interactive rating input, which must never be labelled role=img."""
    for attr in find_by_type(opening, "jsx_attribute"):
        name = next(
            (c for c in attr.children if c.type in ("property_identifier", "identifier")),
            None,
        )
        if name is None:
            continue
        nm = buf[name.start_byte : name.end_byte].decode("utf-8", "ignore")
        if nm.startswith("on") and len(nm) > 2 and nm[2].isupper():
            return True
    return False


def _map_returns_bare_star(arrow, buf: bytes) -> bool:
    """True when the map callback returns a bare, NON-INTERACTIVE Star element
    (`<Icons.Star/>` / `<Star/>`). A button wrapper or ANY event handler means
    it's an interactive rating input (each star its own control) — never label
    that as an image."""
    node = arrow.child_by_field_name("body")
    if node is None:
        return False
    if node.type == "statement_block":
        ret = next((r for r in find_by_type(node, "return_statement")), None)
        node = next((c for c in ret.named_children), None) if ret else None
    while node is not None and node.type == "parenthesized_expression":
        node = next((c for c in node.named_children), None)
    if node is None or node.type not in ("jsx_self_closing_element", "jsx_element"):
        return False
    opening = _opening_element_of(node)
    if opening is None or _tag_base(opening, buf) != "Star":
        return False
    return not _opening_has_event_handler(opening, buf)


def _callback_local_names(arrow, buf: bytes) -> set[str]:
    """Names DECLARED inside the map callback body (``const r = …``, destructured
    bindings). Combined with the params, these are the identifiers that do NOT
    exist at the container where the aria-label is spliced."""
    names: set[str] = set()
    body = arrow.child_by_field_name("body")
    if body is None:
        return names
    for vd in find_by_type(body, "variable_declarator"):
        name_node = vd.child_by_field_name("name")
        if name_node is None:
            continue
        if name_node.type == "identifier":
            names.add(buf[name_node.start_byte : name_node.end_byte].decode("utf-8", "ignore"))
        else:  # destructuring pattern → collect every bound identifier
            for idn in find_by_type(name_node, "identifier"):
                names.add(buf[idn.start_byte : idn.end_byte].decode("utf-8", "ignore"))
    return names


def _rating_value_expr(arrow, buf: bytes, params: set[str]) -> str | None:
    """Read the rating value from a `<loopVar> <=/< X` (or `X >=/> <loopVar>`)
    comparison in the callback. Returns X's source text if it is a safe, dynamic,
    IN-SCOPE-at-the-container expression, else None (a false negative is fine —
    shipping an out-of-scope or wrong label is not)."""
    forbidden = params | _callback_local_names(arrow, buf)
    for be in find_by_type(arrow, "binary_expression"):
        op_node = be.child_by_field_name("operator")
        left = be.child_by_field_name("left")
        right = be.child_by_field_name("right")
        if op_node is None or left is None or right is None:
            continue
        op = buf[op_node.start_byte : op_node.end_byte].decode("utf-8", "ignore")
        if op in ("<=", "<"):
            loop, val = left, right
        elif op in (">=", ">"):
            loop, val = right, left
        else:
            continue
        if loop.type != "identifier":
            continue
        if buf[loop.start_byte : loop.end_byte].decode("utf-8", "ignore") not in params:
            continue
        text = buf[val.start_byte : val.end_byte].decode("utf-8", "ignore").strip()
        if not text or len(text) > 60 or not _RATING_VALUE_SAFE_RE.match(text):
            continue
        # A bare numeric literal is a loop bound / constant (`star < 6`), not a
        # dynamic rating — skip so we never announce "6 out of 5 stars".
        if re.sub(r"[()\s]", "", text).isdigit():
            continue
        # The label is spliced onto the CONTAINER, outside the callback. If the
        # value references any param or callback-local binding, that identifier
        # is undefined there → runtime ReferenceError. Bow out (best-effort).
        if any(
            buf[i.start_byte : i.end_byte].decode("utf-8", "ignore") in forbidden
            for i in find_by_type(val, "identifier")
        ):
            continue
        return text
    return None


def _extract_star_rating(jsx_element, buf: bytes) -> tuple[str, int] | None:
    """When ``jsx_element``'s sole body child is ``[..N..].map(loop => <Star/>)``
    for a read-only rating, return ``(valueExpr, N)`` else None."""
    body_exprs = []
    for c in jsx_element.named_children:
        if c.type in ("jsx_opening_element", "jsx_closing_element"):
            continue
        if c.type == "jsx_text":
            if buf[c.start_byte : c.end_byte].decode("utf-8", "ignore").strip():
                return None  # visible text beside the stars → not a pure rating
            continue
        body_exprs.append(c)
    if len(body_exprs) != 1 or body_exprs[0].type != "jsx_expression":
        return None
    call = None
    for cand in find_by_type(body_exprs[0], "call_expression"):
        func = cand.child_by_field_name("function")
        if func is not None and func.type == "member_expression":
            prop = func.child_by_field_name("property")
            if prop is not None and buf[prop.start_byte : prop.end_byte].decode() == "map":
                call = cand
                break
    if call is None:
        return None
    func = call.child_by_field_name("function")
    n = _mapped_array_length(func.child_by_field_name("object"), buf)
    if n is None or not (2 <= n <= 10):
        return None
    args = call.child_by_field_name("arguments")
    arrow = next((a for a in find_by_type(args, "arrow_function")), None) if args else None
    if arrow is None:
        return None
    params = _arrow_param_names(arrow, buf)
    if not params or not _map_returns_bare_star(arrow, buf):
        return None
    value = _rating_value_expr(arrow, buf, params)
    return (value, n) if value else None


def _star_rating_edit(el, buf: bytes) -> tuple[int, str] | None:
    """For a container ``jsx_element`` holding a read-only star rating with no
    accessible name, return ``(spliceOffset, attrText)`` for the role/aria-label
    injection, else None."""
    opening = _opening_element_of(el)
    if opening is None or _tag_base(opening, buf) not in _RATING_CONTAINER_TAGS:
        return None
    if jsx_attribute_value_node(opening, "role", buf) is not None:
        return None
    if _has_accessible_name(opening, buf):
        return None
    extracted = _extract_star_rating(el, buf)
    if extracted is None:
        return None
    value, n = extracted
    pos = _opening_tag_name_end(opening, buf)
    if pos is None:
        return None
    return pos, ' role="img" aria-label={`${' + value + "} out of " + str(n) + " stars`}"


def _fix_star_rating_aria(tsx: str, fixes_applied: list[str]) -> str:
    try:
        tree = parse_tsx(tsx)
    except Exception:
        return tsx
    root = tree.root_node
    if root.has_error:
        return tsx  # never mutate already-broken input
    buf = source_bytes(tsx)
    edits: list[tuple[int, int, str]] = []
    seen: set[int] = set()
    for el in find_by_type(root, "jsx_element"):
        edit = _star_rating_edit(el, buf)
        if edit is None or edit[0] in seen:
            continue
        seen.add(edit[0])
        edits.append((edit[0], edit[0], edit[1]))
    if not edits:
        return tsx
    out = buf
    for start, end, rep in sorted(edits, key=lambda e: -e[0]):
        out = out[:start] + rep.encode("utf-8") + out[end:]
    new_tsx = out.decode("utf-8")
    try:
        if parse_tsx(new_tsx).root_node.has_error:
            return tsx  # rollback: never ship a parse regression
    except Exception:
        return tsx
    fixes_applied.append(
        f"Injected role=img + value aria-label on {len(edits)} read-only star rating(s)"
    )
    return new_tsx


def _subtree_provides_accessible_name(jsx_element, buf: bytes) -> bool:
    """Mirror of ``component_a11y._subtree_provides_accessible_name``.

    True when a descendant supplies an accessible name the wrapper can
    borrow: an ``<img>`` / ``<Image>`` with non-empty ``alt`` (literal or
    dynamic; ``alt=""`` is decorative and excluded), or any descendant
    carrying ``aria-label`` / ``aria-labelledby`` / ``title``.
    """
    for el in iter_jsx_opening_elements(jsx_element):
        for attr in _A11Y_ATTRS:
            if jsx_attribute_value_node(el, attr, buf) is not None:
                return True
        tag = jsx_tag_name(el, buf)
        base = tag.rsplit(".", 1)[-1] if "." in tag else tag
        if base in ("img", "Image"):
            if jsx_attribute_value_node(el, "alt", buf) is not None:
                alt_str = jsx_attribute_string_value(el, "alt", buf)
                if alt_str is None or alt_str.strip():
                    return True
    return False


def _element_has_visible_text(jsx_element, buf: bytes) -> bool:
    """True when the element's body has any non-whitespace ``jsx_text``
    OR any ``jsx_expression`` that resolves to renderable content (e.g.
    ``{link.label}``, ``{filter}``, ``{loading ? "..." : "Save"}``).

    Only BODY children are considered — attribute expressions like
    ``className={x}`` or ``onClick={h}`` are scoped out.

    Expressions whose body is only JSX (e.g. ``{showIcon && <Icon/>}``)
    or only comments don't count — those are decorative.
    """
    return _body_yields_visible_text(jsx_element, buf)


def _body_yields_visible_text(jsx_element, buf: bytes) -> bool:
    """Walk only the body children of ``jsx_element`` (skip opening /
    closing / attribute subtrees). Mirror of
    ``tsx_ast.rules.component_a11y::_body_yields_visible_text``.
    """
    for child in jsx_element.named_children:
        if child.type in ("jsx_opening_element", "jsx_closing_element"):
            continue
        if child.type == "jsx_text":
            text = buf[child.start_byte : child.end_byte].decode("utf-8")
            if text.strip():
                return True
        elif child.type == "jsx_expression":
            if _expression_yields_text(child):
                return True
        elif child.type == "jsx_element":
            if _body_yields_visible_text(child, buf):
                return True
    return False


def _expression_yields_text(jsx_expression_node) -> bool:
    """Mirror of ``component_a11y.py::_expression_yields_text``.

    Treated as renderable text: identifiers, member expressions,
    ternaries, string literals, template strings.
    Treated as decorative: jsx_element / jsx_self_closing_element /
    jsx_fragment children, comments only, ``cond && <Icon/>`` guards.
    """
    for child in jsx_expression_node.named_children:
        if child.type == "comment":
            continue
        if child.type in (
            "jsx_element",
            "jsx_self_closing_element",
            "jsx_fragment",
        ):
            return False
        if child.type == "binary_expression":
            for op_child in child.named_children:
                if op_child.type in (
                    "jsx_element",
                    "jsx_self_closing_element",
                    "jsx_fragment",
                ):
                    return False
            return True
        return True
    return False


def _label_from_first_child_icon(jsx_element, buf: bytes) -> str | None:
    """Find the first DIRECT child JSX element whose tag looks like an
    icon and return a Title-Cased label derived from its name.

    Recognized shapes:
    - ``<Icons.Menu />`` → "Menu"
    - ``<Menu />``       → "Menu" (any PascalCase identifier)
    - ``<Icons.Circle />`` → ``None`` — Circle is the deterministic
      fallback for unknown icons in the icon-typo fixer; it carries no
      semantic meaning. Skip so we don't ship "aria-label='Circle'".

    Only direct children are considered: a deeply-nested icon implies
    the LLM intended a more complex layout (icon next to a label maybe);
    we shouldn't second-guess.
    """
    for child in jsx_element.named_children:
        # The button's own jsx_opening_element / jsx_closing_element are
        # children of the wrapper too — skip them.
        if child.type == "jsx_opening_element":
            continue
        if child.type == "jsx_closing_element":
            continue
        if child.type == "jsx_self_closing_element":
            opening = child
        elif child.type == "jsx_element":
            opening = child.child_by_field_name("open_tag")
            if opening is None:
                # Tree-sitter often doesn't populate field names —
                # find the opening element by type.
                opening = next(
                    (c for c in child.children if c.type == "jsx_opening_element"),
                    None,
                )
            if opening is None:
                continue
        else:
            continue
        tag = jsx_tag_name(opening, buf)
        if not tag:
            continue
        # Dotted form ``Icons.Menu`` → take the segment after the dot.
        base = tag.rsplit(".", 1)[-1] if "." in tag else tag
        # Skip lowercase identifiers (HTML tags like ``span``) — they're
        # not icons. Skip the deterministic Circle fallback.
        if not base or not base[0].isupper():
            continue
        if base == "Circle":
            continue
        return base
    return None


def _label_from_handler(opening, buf: bytes) -> str | None:
    """Derive an aria-label from an ``on<Event>={handlerName}`` attr.

    Scans common handler attributes (``onClick``, ``onPress``,
    ``onChange``) for an identifier-shape value, strips
    ``handle``/``on`` prefixes and ``Click``/``Press`` suffixes, and
    Title-Cases the residue. Returns None when the handler value isn't
    a bare identifier or when the remainder is empty/uninformative.
    """
    for handler_attr in ("onClick", "onPress", "onChange"):
        value = jsx_attribute_value_node(opening, handler_attr, buf)
        if value is None or value.type != "jsx_expression":
            continue
        # Inner expression should be a single identifier.
        for child in value.named_children:
            if child.type == "comment":
                continue
            if child.type != "identifier":
                continue
            ident = buf[child.start_byte : child.end_byte].decode("utf-8")
            label = _strip_handler_decorations(ident)
            if label:
                return label
            break
    return None


def _strip_handler_decorations(ident: str) -> str | None:
    """``handleSearch`` → "Search". ``onMenuOpen`` → "Menu Open".
    Returns None when nothing useful remains (``handleClick`` → "")."""
    if not ident:
        return None
    head = ident
    for prefix in _HANDLER_PREFIXES:
        if head.startswith(prefix) and len(head) > len(prefix) and head[len(prefix)].isupper():
            head = head[len(prefix) :]
            break
    for suffix in _HANDLER_SUFFIXES:
        if head.endswith(suffix) and len(head) > len(suffix):
            head = head[: -len(suffix)]
            break
    if not head:
        return None
    # Split camelCase into words: "MenuOpen" → "Menu Open".
    words = re.findall(r"[A-Z][a-z0-9]*|[a-z0-9]+", head)
    if not words:
        return None
    label = " ".join(w[:1].upper() + w[1:] for w in words if w)
    return label or None


def _opening_tag_name_end(element, buf: bytes) -> int | None:
    """Return the byte offset right after the opening tag's name node.

    For ``<button onClick={x} />`` returns the offset just after
    ``button``. The caller splices `` aria-label="X"`` at that point so
    the result is ``<button aria-label="X" onClick={x} />``.
    """
    name_node = element.child_by_field_name("name")
    if name_node is None:
        for child in element.children:
            if child.type in ("identifier", "nested_identifier", "member_expression"):
                name_node = child
                break
    if name_node is None:
        return None
    return name_node.end_byte


_ROUTE_COMPONENT_SUFFIXES = ("Content", "Page")


def _fix_route_component_h1_promote(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    """Promote the first ``<h2>`` to ``<h1>`` in route-level components missing one.

    The ``PerRouteH1Rule`` warns when a Content/Page component carries no
    ``<h1>``. Warnings ship in the SSE response but do not block save, so
    in practice the heading-less component is what reaches the runtime.
    The page renders without a top-level heading, hurting SEO and a11y.

    Deterministic recovery: when (a) the component name matches the
    Content/Page suffix convention, (b) no ``<h1>`` exists anywhere in the
    JSX, AND (c) at least one ``<h2>`` exists, rewrite the FIRST ``<h2>``
    by source order to ``<h1>``. Heading text and className are
    preserved (visual styling is in className, not the tag).

    The demoter then runs over the same tree and may demote subsequent
    headings to maintain the no-skip invariant. Net effect: the page
    title becomes a real ``<h1>``, sibling section titles stay ``<h2>``.
    """
    name = ctx.expected_component_name or ""
    if not any(name.endswith(suffix) for suffix in _ROUTE_COMPONENT_SUFFIXES):
        return tsx
    # Cheap pre-screen on raw text: skip parse when there's clearly nothing
    # to promote (no h2) OR a textual ``<h1`` somewhere (JSX, comment, OR
    # string literal). The string-literal case is a deliberate fail-safe —
    # rather than parse + over-promote next to an in-string ``<h1>``, we
    # let the rare under-fix slip through; the validator's warning still
    # ships in the SSE response.
    if "<h2" not in tsx or "<h1" in tsx:
        return tsx

    try:
        tree = parse_tsx(tsx)
    except Exception:
        return tsx
    buf = source_bytes(tsx)

    # Walk JSX elements in source order. Defense-in-depth: re-confirm no
    # ``<h1>`` JSX element exists (covers the unlikely case where the
    # substring screen passes but the AST disagrees — e.g. an HTML-entity-
    # encoded ``&lt;h1&gt;`` in source that doesn't trip the screen). Then
    # capture the first ``<h2>`` for promotion.
    first_h2_opener = None
    first_h2_closer = None
    first_h2_line = 0
    for elem in find_by_type(tree.root_node, "jsx_element"):
        opener = elem.child_by_field_name("open_tag")
        closer = elem.child_by_field_name("close_tag")
        if opener is None:
            for child in elem.children:
                if child.type == "jsx_opening_element":
                    opener = child
                elif child.type == "jsx_closing_element":
                    closer = child
        if opener is None:
            continue
        tag = jsx_tag_name(opener, buf)
        if tag == "h1":
            return tsx
        if tag == "h2" and first_h2_opener is None:
            first_h2_opener = opener
            first_h2_closer = closer
            first_h2_line = opener.start_point[0] + 1

    if first_h2_opener is None:
        return tsx

    opener_name = _opening_tag_name_node(first_h2_opener)
    if opener_name is None:
        return tsx
    rewrites: list[tuple[int, int]] = [(opener_name.start_byte, opener_name.end_byte)]
    if first_h2_closer is not None:
        closer_name = _opening_tag_name_node(first_h2_closer)
        if closer_name is not None:
            rewrites.append((closer_name.start_byte, closer_name.end_byte))

    new_buf = bytearray(buf)
    for start, end in sorted(rewrites, key=lambda r: r[0], reverse=True):
        new_buf[start:end] = b"h1"

    fixes_applied.append(
        f"[a11y_ux] Route H1: promoted first <h2> to <h1> at line {first_h2_line} "
        f"(component '{name}' had no <h1>)"
    )
    return bytes(new_buf).decode("utf-8")


def _fix_heading_order_demote(tsx: str, fixes_applied: list[str]) -> str:
    """Demote ``<hN>`` tags that skip a level, top-down by source order.

    Visual styling is carried in ``className`` (e.g. ``font-headline text-2xl``),
    so the heading *level* is independent of appearance. We can deterministically
    rewrite ``<h1>...<h3>...<h4>`` → ``<h1>...<h2>...<h3>`` without changing how
    the page looks, while restoring the descending-by-1 invariant the
    ``HeadingOrderRule`` checks.

    Rules (applied per ``jsx_element`` in source order):
    - First heading whose level > 2 → demote to ``<h2>`` (most-likely intent
      for top-of-section).
    - Subsequent heading at level N > prev_level + 1 → demote to ``prev_level + 1``.
    - Heading at level <= prev_level + 1 → keep.
    - Headings nested inside ``<Card>`` / ``<CardContent>`` are SKIPPED — they
      are typically card-internal labels (chart widget titles, stat cards),
      not section anchors. Promoting them to ``<h2>`` would put a card label
      in the DOM at the same level as actual page sections and produce
      semantic noise in the heading outline. The ``HeadingOrderRule``
      warning still fires for these.

    Both the opening ``<hN>`` and the closing ``</hN>`` tag-name spans are
    rewritten consistently. Self-closing ``<hN/>`` is unusual (heading with
    no content) but supported.
    """
    try:
        tree = parse_tsx(tsx)
    except Exception:
        return tsx
    buf = source_bytes(tsx)

    rewrites: list[tuple[int, int, str, int, int, int]] = []
    # (open_name_start, open_name_end, new_tag, original_level, target_level, line)
    prev_level = 0
    # Sibling unification: two heading patterns that should share a level:
    #   1. Same className + same original tag — rendered identically
    #      (e.g. three footer column titles, all
    #      ``<h4 className="font-headline text-lg ...">``).
    #   2. Same parent jsx_element + same original tag — bare siblings under
    #      one container (e.g. three ``<h3>`` "promise" cards in a grid).
    # Both heuristics prevent a phantom hierarchy where one sibling becomes
    # a section header and the rest stay as its children.
    signature_first_target: dict[tuple[str, int], int] = {}
    parent_first_target: dict[tuple[int, int], int] = {}

    # Walk jsx_element nodes (have both open + close tags). Self-closing
    # is a different node type — handle separately.
    for elem in find_by_type(tree.root_node, "jsx_element"):
        opener = elem.child_by_field_name("open_tag")
        closer = elem.child_by_field_name("close_tag")
        if opener is None:
            # Some grammars expose children without field names; fall back.
            for child in elem.children:
                if child.type == "jsx_opening_element":
                    opener = child
                elif child.type == "jsx_closing_element":
                    closer = child
        if opener is None:
            continue
        tag = jsx_tag_name(opener, buf)
        m = _HEADING_TAG_RE.match(tag)
        if not m:
            continue
        original_level = int(m.group(1))

        # Skip headings nested inside a Card-like container. These are
        # card-internal labels (chart widget titles, stat cards) — promoting
        # them to <h2> would compete with real section headings in the DOM
        # outline. The validator's HeadingOrderRule warning still fires.
        if _is_inside_card_subtree(elem, buf):
            continue

        # Sibling-unification keys.
        class_str = (_classname_static_value(opener, buf) or "").strip()
        parent_id = elem.parent.id if elem.parent is not None else 0
        sig_key = (class_str, original_level)
        parent_key = (parent_id, original_level)

        target: int | None = None
        if sig_key in signature_first_target:
            # Same className+tag as an earlier heading (or both bare with
            # the same tag) — visually identical siblings.
            target = signature_first_target[sig_key]
        elif parent_key in parent_first_target:
            target = parent_first_target[parent_key]
        if target is None:
            # Decide target level via descent rule.
            if prev_level == 0:
                target = original_level if original_level <= 2 else 2
            elif original_level > prev_level + 1:
                target = prev_level + 1
            else:
                target = original_level
            signature_first_target[sig_key] = target
            parent_first_target[parent_key] = target
        # Track the LAST heading's level (not the max). Going back up to
        # an outer level (e.g. h3 → h2 starts a new section) resets the
        # descent budget, so a subsequent h4 in that new section is a
        # skip and gets demoted.
        prev_level = target

        if target == original_level:
            continue

        # Rewrite the opening tag name
        opener_name = _opening_tag_name_node(opener)
        if opener_name is None:
            continue
        new_tag = f"h{target}"
        line = opener.start_point[0] + 1
        rewrites.append(
            (opener_name.start_byte, opener_name.end_byte, new_tag, original_level, target, line)
        )
        # Rewrite the matching closing tag name (if present)
        if closer is not None:
            closer_name = _opening_tag_name_node(closer)
            if closer_name is not None:
                rewrites.append(
                    (
                        closer_name.start_byte,
                        closer_name.end_byte,
                        new_tag,
                        original_level,
                        target,
                        line,
                    )
                )

    # Self-closing headings (``<h3 className="..." />``) are rare but valid;
    # their level still affects sequence even though they have no content.
    # We folded them into the same source-order pass via jsx_self_closing_element.
    # For simplicity we only handle the open+close pair case here; self-closing
    # heading tags fall through unchanged (they're effectively never generated
    # by component authors).

    if not rewrites:
        return tsx

    new_buf = bytearray(buf)
    for start, end, new_tag, original_level, target_level, _line in sorted(
        rewrites, key=lambda r: r[0], reverse=True
    ):
        new_buf[start:end] = new_tag.encode("utf-8")

    # Build telemetry — one entry per opening-tag rewrite (skip duplicate
    # closing-tag entries by deduplicating on (line, original_level)).
    seen: set[tuple[int, int]] = set()
    for _start, _end, _new_tag, original_level, target_level, line in rewrites:
        key = (line, original_level)
        if key in seen:
            continue
        seen.add(key)
        fixes_applied.append(
            f"Heading order: demoted h{original_level} → h{target_level} at line {line}"
        )

    return bytes(new_buf).decode("utf-8")


def _opening_tag_name_node(element):
    """Return the tag-name child node of an opening or closing JSX element.

    Mirrors ``walker.jsx_tag_name`` but returns the *node* so byte spans
    are available for rewrites.
    """
    name_node = element.child_by_field_name("name")
    if name_node is not None:
        return name_node
    for child in element.children:
        if child.type in ("identifier", "nested_identifier", "member_expression"):
            return child
    return None
