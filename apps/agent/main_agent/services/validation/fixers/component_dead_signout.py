"""``component_dead_signout`` — guarantee a working Sign-Out affordance.

Two related failure modes, one fixer
-------------------------------------

**1. Dead button (wire it).** Generated sidebars (see the
``component-sidebar`` skill) render a footer Sign-Out button. The LLM
sometimes drops the handler, shipping a dead button::

    <button title="Sign Out" aria-label="Sign out">
      <Icons.LogOut className="w-4 h-4" />
    </button>

Clicking does nothing — the user is stuck logged in. This fixer wires it
to the platform sign-out handler.

**2. Missing button (inject it).** Sometimes the LLM omits the Sign-Out
button *entirely* — then there is no dead button to wire, and an
auth-enabled app ships with NO way to log out. When the app requires
authentication (``FixContext.security_enabled``) and the component is the
sidebar and it has no sign-out affordance, this fixer injects a complete
Sign-Out button.

The canonical sign-out (and why NOT ``/logout``)
------------------------------------------------

Logout is a **platform action, not a page**. The blessed pattern
(``03_COMPONENT_PATTERNS.md`` + the shipped agent examples) is the
built-in ``auth_signout`` handler::

    const { execute: signOut } = useHandler("auth_signout", { autoFetch: false });
    <button onClick={signOut}>Sign out</button>

``navigate("/logout")`` is explicitly REJECTED by the
``component.routing.navigate_unknown_route`` rule (error severity), so a
fixer that emitted it would just trade a dead button for a validation
failure. This fixer therefore injects the ``auth_signout`` hook (once, at
the top of the component body, alongside the other hooks → rules-of-hooks
safe) and binds the button's ``onClick`` to it.

Why the existing validators miss it
-----------------------------------

``DeadActionButtonRule`` only scans VISIBLE ``jsx_text`` for action verbs
and is a *warning* — an icon-only dead Sign-Out button ships regardless.
No rule checks for the *presence* of a logout affordance. This
deterministic fixer closes both gaps.

Scope (deliberately narrow → near-zero false positives)
-------------------------------------------------------

Does nothing if the component already references ``auth_signout``.

*Wiring* rewrites a ``<button>`` / ``<Button>`` ONLY when ALL hold:

- It has NO handler binding already (``onClick`` / ``onPress`` / ``href`` /
  ``type="submit"`` / ``asChild`` / spread props).
- It is unambiguously a sign-out control — either ``title`` / ``aria-label``
  matches a sign-out/log-out phrase, OR it has a ``LogOut`` icon child.

*Injection* only fires when ALL hold:

- ``security_enabled`` is True (the app requires login).
- The component name contains ``sidebar`` (the app shell).
- It looks like a real navigation shell (uses ``navigate(`` / ``<nav>`` /
  ``useCurrentUser`` / ``NavLink``).
- Nothing was wired this pass (there is genuinely no sign-out button).

Either path needs the ``signOut`` hook; if a safe insertion point for it
can't be found (e.g. a concise-body arrow component with no statement
block), the whole fix is abandoned rather than emit a button that
references an undeclared ``signOut``. ``useHandler`` / ``Icons`` get
auto-imported by the downstream ``imports`` / ``icons`` passes. Per-fixer
rollback reverts the whole splice if it ever produces unparseable JSX — so
a bad splice degrades to "no fix", never to a broken artifact.
"""

from __future__ import annotations

import re

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.walker import (
    iter_jsx_opening_elements,
    jsx_attribute_string_value,
    jsx_tag_name,
    walk,
)

_BUTTON_TAG_NAMES = frozenset({"button", "Button", "IconButton"})

# A sign-out / log-out phrase in title / aria-label (handles "Sign out",
# "Sign-Out", "Log out", "Logout", any case / hyphen / spacing).
_SIGNOUT_LABEL_RE = re.compile(r"(sign|log)\s*-?\s*out", re.IGNORECASE)

# Handler / delegation attributes that mean the button is already wired.
_HANDLER_RE = re.compile(
    r"\b(onClick|onPress|onSelect|asChild)\b"
    r'|\bhref\s*='
    r'|\btype\s*=\s*["\']submit["\']'
    r"|\{\s*\.\.\.[A-Za-z_][\w$]*\s*\}"
)

# Markers that the component is a genuine navigation shell (not a widget that
# merely happens to have "sidebar" in its name). Gates injection.
_APP_SHELL_SIGNAL_RE = re.compile(r"navigate\s*\(|useCurrentUser|<nav\b|NavLink")

# The platform sign-out hook, injected once at the top of the component body
# (alongside the other hooks → rules-of-hooks safe). `useHandler` is
# auto-imported by the downstream imports pass.
_SIGNOUT_HOOK = (
    "\n  const { execute: signOut } = "
    'useHandler("auth_signout", { autoFetch: false });'
)

# A self-contained Sign-Out button injected as the last child of the sidebar
# panel. Inherits the panel's text color (no hardcoded text-white/black so it
# stays visible on light AND dark sidebars); ``mt-auto`` floats it to the
# bottom of the flex-col panel. Bound to the injected ``signOut`` hook.
_SIGNOUT_INJECTION_BUTTON = (
    "\n        <button onClick={signOut}"
    ' aria-label="Sign Out" title="Sign Out"'
    ' className="mt-auto flex items-center gap-3 w-full px-3 py-2 rounded-md'
    ' text-sm font-medium opacity-80 hover:opacity-100 transition-opacity">'
    '\n          <Icons.LogOut className="w-4 h-4 shrink-0" />'
    "\n          <span>Sign Out</span>"
    "\n        </button>\n      "
)


def _text(node, buf: bytes) -> str:
    return buf[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def _opening_tag_name_end(element, buf: bytes) -> int | None:
    """Byte offset just after the opening tag's name (``<button`` → after
    ``button``), where the new ``onClick`` attribute is spliced in."""
    name_node = element.child_by_field_name("name")
    if name_node is None:
        for child in element.children:
            if child.type in ("identifier", "nested_identifier", "member_expression"):
                name_node = child
                break
    return name_node.end_byte if name_node is not None else None


def _has_logout_icon_descendant(jsx_element, buf: bytes) -> bool:
    """True iff a descendant icon element resolves to a ``LogOut`` icon
    (``<Icons.LogOut/>`` or a bare ``<LogOut/>``)."""
    for el in iter_jsx_opening_elements(jsx_element):
        tag = jsx_tag_name(el, buf) or ""
        base = tag.rsplit(".", 1)[-1] if "." in tag else tag
        if base == "LogOut":
            return True
    return False


def _is_signout_button(opening, jsx_element, buf: bytes) -> bool:
    for attr in ("title", "aria-label"):
        val = jsx_attribute_string_value(opening, attr, buf)
        if val and _SIGNOUT_LABEL_RE.search(val):
            return True
    # Icon-child detection needs the element subtree (self-closing has none).
    if jsx_element is not None and _has_logout_icon_descendant(jsx_element, buf):
        return True
    return False


def _element_tag(jsx_element, buf: bytes) -> str:
    """Tag name of a ``jsx_element`` (read from its opening child)."""
    for child in jsx_element.children:
        if child.type == "jsx_opening_element":
            return jsx_tag_name(child, buf)
    return ""


def _closing_element_start(jsx_element) -> int | None:
    """Byte offset of the element's ``</tag>`` closer, where a final child
    is spliced in. ``None`` for elements with no closing tag."""
    for child in jsx_element.children:
        if child.type == "jsx_closing_element":
            return child.start_byte
    return None


def _is_root_jsx(node) -> bool:
    """True when ``node`` has no enclosing JSX element (it's the component's
    returned root, modulo non-JSX wrappers like ``return (`` / arrow body)."""
    parent = node.parent
    while parent is not None:
        if parent.type in ("jsx_element", "jsx_fragment", "jsx_self_closing_element"):
            return False
        parent = parent.parent
    return True


def _outermost_jsx(tree):
    """The widest JSX node with no JSX ancestor — the component's root."""
    best = None
    best_span = -1
    for node in walk(tree.root_node):
        if node.type not in ("jsx_element", "jsx_fragment", "jsx_self_closing_element"):
            continue
        if not _is_root_jsx(node):
            continue
        span = node.end_byte - node.start_byte
        if span > best_span:
            best_span = span
            best = node
    return best


def _find_injection_element(tree, buf: bytes):
    """Pick where to inject the Sign-Out button.

    Priority: the sidebar PANEL (first ``<aside>``), else the first
    ``<nav>``, else the outermost JSX element. Targeting ``<aside>`` (the
    skill's panel element) keeps the button inside the styled sidebar rather
    than the ``<LightDOMContainer>`` wrapper around it.
    """
    asides = []
    navs = []
    roots = []
    for node in walk(tree.root_node):
        if node.type != "jsx_element":
            continue
        tag = _element_tag(node, buf)
        if tag == "aside":
            asides.append(node)
        elif tag == "nav":
            navs.append(node)
        if _is_root_jsx(node):
            roots.append(node)
    if asides:
        return asides[0]
    if navs:
        return navs[0]
    if roots:
        roots.sort(key=lambda n: (n.end_byte - n.start_byte), reverse=True)
        return roots[0]
    return None


def _component_body_insert_byte(tree) -> int | None:
    """Byte offset just after the opening ``{`` of the component function
    body — where the ``signOut`` hook is injected (top of body, before any
    early returns → rules-of-hooks safe). Found by walking up from the
    outermost JSX to its nearest ``statement_block``. ``None`` for
    concise-body arrows (no block to inject into)."""
    root = _outermost_jsx(tree)
    if root is None:
        return None
    parent = root.parent
    while parent is not None:
        if parent.type == "statement_block":
            return parent.start_byte + 1
        parent = parent.parent
    return None


def apply_component_dead_signout_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    # Already wired to the platform sign-out? Nothing to do.
    if "auth_signout" in tsx:
        return tsx

    name_lc = (getattr(ctx, "expected_component_name", "") or "").lower()
    inject_candidate = bool(getattr(ctx, "security_enabled", False)) and "sidebar" in name_lc

    # Fast pre-screen: only pay for a parse when (a) a sign-out affordance is
    # plausibly present to WIRE, or (b) injection is a candidate (an
    # auth-enabled sidebar — which by definition may have NO sign-out yet).
    if (
        not _SIGNOUT_LABEL_RE.search(tsx)
        and "LogOut" not in tsx
        and not inject_candidate
    ):
        return tsx

    try:
        tree = parse_tsx(tsx)
    except Exception:
        return tsx
    buf = source_bytes(tsx)

    edits: list[tuple[int, int, str]] = []

    # ── Pass 1: wire any unhandled Sign-Out button(s) to signOut. ──
    for opening in iter_jsx_opening_elements(tree.root_node):
        if jsx_tag_name(opening, buf) not in _BUTTON_TAG_NAMES:
            continue
        if _HANDLER_RE.search(_text(opening, buf)):
            continue  # already wired

        # The enclosing <button>…</button> element (None for self-closing).
        jsx_element = None
        if opening.type == "jsx_opening_element":
            parent = opening.parent
            if parent is not None and parent.type == "jsx_element":
                jsx_element = parent

        if not _is_signout_button(opening, jsx_element, buf):
            continue

        insert_byte = _opening_tag_name_end(opening, buf)
        if insert_byte is None:
            continue
        edits.append((insert_byte, insert_byte, " onClick={signOut}"))

    wired_count = len(edits)

    # ── Pass 2: inject a Sign-Out button when an auth-enabled sidebar has
    #    no sign-out button at all and looks like a real nav shell. ──
    injected = False
    if (
        inject_candidate
        and wired_count == 0
        and _APP_SHELL_SIGNAL_RE.search(tsx)
    ):
        target = _find_injection_element(tree, buf)
        if target is not None:
            close_start = _closing_element_start(target)
            if close_start is not None:
                edits.append((close_start, close_start, _SIGNOUT_INJECTION_BUTTON))
                injected = True

    if not edits:
        return tsx

    # Any button edit references ``signOut`` → the hook MUST be declared.
    # If no safe insertion point exists (concise-body arrow, etc.), abandon
    # the whole fix rather than ship a button bound to an undeclared name.
    hook_byte = _component_body_insert_byte(tree)
    if hook_byte is None:
        return tsx
    edits.append((hook_byte, hook_byte, _SIGNOUT_HOOK))

    out = buf
    for start, end, replacement in sorted(edits, key=lambda e: -e[0]):
        out = out[:start] + replacement.encode("utf-8") + out[end:]

    if wired_count:
        fixes_applied.append(
            f"Wired {wired_count} unhandled Sign-Out button(s) to the "
            "auth_signout handler"
        )
    if injected:
        fixes_applied.append(
            "Injected a Sign-Out button (auth_signout) into the auth-enabled "
            "sidebar (no logout affordance was present)"
        )
    return out.decode("utf-8")
