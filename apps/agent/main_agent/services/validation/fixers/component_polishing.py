"""Final polishing passes for component TSX auto-fix.

Covers:

- Rewrite borderline Tailwind greys (``text-gray-300/400``, same for
  slate / zinc / neutral / stone) to shade 600 for WCAG AA on light
  backgrounds.
- Rewrite ``animate-in ... duration-N`` classNames to use the
  arbitrary-value form ``[animation-duration:Nms]`` so React doesn't
  emit an implicit ``transition: all`` that triggers first-paint
  layout shift.
- Rewrite JSX inline-style ``animationDuration: 'var(--animation-duration)'``
  (no fallback) to ``'var(--animation-duration, 200ms)'`` so the
  animation has a defined duration when the SPA shell hasn't set the
  custom property yet (sibling variant of the className fix above).
- Annotate untyped ``useRef([])`` / ``useState([])`` calls with
  ``<any[]>`` so the array opens to ``.push(...)`` of any shape — TS
  otherwise infers ``never[]`` and rejects every push (tsc.2345).
- Rewrite the root child's bare ``overflow-hidden`` token to
  ``overflow-x-clip`` so canvas/sprite containers preserve horizontal
  clipping without breaking vertical page scroll.

``console.log/warn/error/info/debug`` stripping moved to
``component_forbidden_apis.py`` — a paren-balanced scanner there handles
inline calls, nested arguments, and the four non-``log`` methods that
the previous line-anchored regex here missed.

**AST migration status (Change H.2):** The animate-in duration pass and
the overflow-hidden-on-root pass both run through the
:class:`JsxAstMutator` harness now — they iterate static className spans
and splice replacements via the AST, so comments, prose, and SVG strings
that incidentally contain the source patterns can no longer be mutated.
The contrast pass already used ``rewrite_classname_text`` (className-only)
and stays as-is. The untyped-array pass already walked the tree-sitter
AST directly and stays as-is.
"""

from __future__ import annotations

import re

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.tsx_ast.mutator import JsxAstMutator
from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.walker import (
    _classname_static_value,
    _classname_value_inner_span,
    find_by_type,
    jsx_tag_name,
    rewrite_classname_text,
)


def apply_component_polishing_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    # Fix 6: auto-repair low-contrast Tailwind text classes.
    #
    # The Code Focus pipeline already reports WCAG contrast violations on the
    # compiled theme (see style_coverage.auto_fix_contrast_pairs), but
    # component TSX frequently ships with `text-gray-300/400` on light
    # backgrounds — borderline per WCAG AA. Rewriting those to safe
    # equivalents kills the per-component warnings without bothering the LLM
    # with a repair turn.
    #
    # Scope is deliberately narrow:
    #   - only `text-*-{shade}` classes (never background or border colors)
    #   - only shades 300/400 (500 typically passes AA)
    #   - only gray / slate / zinc / neutral / stone hue families
    #   - rewritten to shade 600
    #
    # CRITICAL: we must NOT rewrite variant-prefixed classes like
    # `dark:text-gray-400`, `hover:text-slate-300`, `md:text-zinc-400`.
    # A dark-mode variant uses a light gray ON a dark background — rewriting
    # to gray-600 would MAKE the contrast worse. The negative lookbehind
    # `(?<![:\w])` ensures we only match bare classes (preceded by start of
    # string, whitespace, or `"`/`'`).
    _contrast_fixes_applied = 0
    _low_contrast_pattern = re.compile(
        r"(?<![:\w])text-(gray|slate|zinc|neutral|stone)-(300|400)\b"
    )

    def _fix_low_contrast_in_class(class_text: str) -> str:
        nonlocal _contrast_fixes_applied

        def repl(m: re.Match) -> str:
            nonlocal _contrast_fixes_applied
            _contrast_fixes_applied += 1
            return f"text-{m.group(1)}-600"

        return _low_contrast_pattern.sub(repl, class_text)

    tsx = rewrite_classname_text(tsx, _fix_low_contrast_in_class)
    if _contrast_fixes_applied > 0:
        fixes_applied.append(
            f"Contrast: rewrote {_contrast_fixes_applied} text-*-300/400 class(es) "
            f"→ text-*-600 (WCAG AA on light backgrounds)"
        )

    # Fix 7: rewrite `animate-in ... duration-N` → `animate-in ... [animation-duration:Nms]`.
    #
    # Tailwind v4's `.duration-N` rule emits a bare `transition-duration: Ns`
    # declaration. Because no `transition-property` is set on the element, the
    # CSS spec defaults it to `all`, which means EVERY computed-style change
    # (padding/margin/width/...) interpolates over N ms when React mutates
    # className between conditional render branches (loading → loaded).
    #
    # The arbitrary-value variant `[animation-duration:Nms]` sets only
    # `animation-duration` directly — no transition-duration, no implicit
    # `transition: all`. The `animate-in` keyframe then runs at the intended
    # duration and other properties don't interpolate.
    #
    # Scope:
    #   - className must contain `animate-in` or `animate-out` (entrance anim)
    #   - className must contain a bare `duration-N` (numeric or `[...]`)
    #   - className must NOT contain `transition-*` (any transition class)
    #     — if transitions are explicitly opted-into, `duration-N` is correct.
    #   - `data-[state=...]:duration-N` is fine (shadcn pattern, only fires on
    #     state change) — only the BARE `duration-N` is rewritten.
    #
    # AST-migrated: walks every static className span via JsxAstMutator. The
    # legacy raw-regex form (`re.sub(...)` over `tsx`) could in theory match
    # `className="..."` patterns embedded in JSX prose, comments, or string
    # literals — JsxAstMutator restricts mutation to the inner text of real
    # className attributes by construction.
    tsx = _fix_animate_in_duration(tsx, fixes_applied)

    # Fix 7b: rewrite inline ``style={{ animationDuration: 'var(--animation-duration)' }}``
    # (no fallback) to ``'var(--animation-duration, 200ms)'``. Sibling
    # variant of Fix 7 — the JSX-inline-style form rather than the
    # className form. Observed shipping 8× in app r3hfcgx5 (2026-05-14)
    # even though Fix 7's className variant was deployed. The SPA shell
    # doesn't always set ``--animation-duration`` on the root by the
    # time the first animate-in keyframes run, so the duration falls
    # back to whatever default the user agent picks for ``initial``
    # (typically 0s → instant flash). A `200ms` fallback matches the
    # default the Code Focus theme already uses.
    tsx = _fix_animation_duration_inline_style(tsx, fixes_applied)

    # Fix 8: annotate untyped ``useRef([])`` / ``useState([])`` with
    # ``<any[]>``. TS strict mode infers ``never[]`` from a bare ``[]``
    # initializer, so any later ``arr.push(item)`` fails with tsc.2345
    # (target type 'never'). We widen to ``any[]`` so the array accepts
    # pushes — safer than crashing the build, and the LLM can refine to
    # a stricter generic on a later edit.
    #
    # Detection is AST-driven: only triggers on call_expressions where
    # the function identifier is exactly ``useRef`` / ``useState``, no
    # type_arguments are present, and the single argument is an empty
    # array literal. This skips ``useRef<Foo[]>([])`` (already typed),
    # ``useRef([1, 2])`` (non-empty initializer infers correctly),
    # ``useRef(null)`` and any other non-array form.
    tsx = _fix_untyped_empty_array_calls(tsx, fixes_applied)

    # Fix 9: rewrite the root child's bare ``overflow-hidden`` token to
    # ``overflow-x-clip``. Mirror of ``OverflowHiddenOnRootRule``: the
    # LLM commonly emits ``<div className="overflow-hidden ...">`` as
    # the only child of ``<LightDOMContainer>`` for canvas / sprite
    # roots, but ``overflow-hidden`` clips vertical page scroll too.
    # Rewrite preserves horizontal clip intent without breaking scroll.
    #
    # AST-migrated: locates the LightDOMContainer's first JSX child via
    # tree-sitter, then mutates only that child's className inner span.
    # The legacy regex matched inside JSDoc/`//` comments mentioning
    # `<LightDOMContainer>` — it would happily rewrite className text
    # inside comments and string literals. AST traversal skips them.
    tsx = _fix_overflow_hidden_on_root(tsx, fixes_applied)

    return tsx


# ---------------------------------------------------------------------------
# Fix 7 — animate-in + bare duration-N (AST-migrated)
# ---------------------------------------------------------------------------


_ANIMATE_IN_OUT_RE = re.compile(r"\banimate-(?:in|out)\b")
_BARE_DURATION_RE = re.compile(r"\bduration-(\d+|\[(\d+)ms\])(?![\w-])")
_TRANSITION_RE = re.compile(
    r"\btransition(?:-(?:all|colors|opacity|transform|shadow|none))?\b"
)
_DATA_STATE_DURATION_RE = re.compile(
    r"data-\[state=[^\]]+\]:duration-(?:\d+|\[\d+ms\])"
)


def _rewrite_animate_in_duration_in_class(class_text: str) -> str | None:
    """Pure className-text rewriter for the animate-in + duration-N pattern.

    Returns the rewritten class string when a rewrite applied; ``None`` when
    the input is left unchanged. Pulled out of ``apply_component_polishing_fixes``
    so the JsxAstMutator caller can decide whether to queue an edit based
    on whether the pure function actually changed anything.
    """
    if not _ANIMATE_IN_OUT_RE.search(class_text):
        return None
    if _TRANSITION_RE.search(class_text):
        return None
    # Mask data-[state=...]:duration-N so we don't rewrite it.
    masked = _DATA_STATE_DURATION_RE.sub("__DSDURATION__", class_text)
    if not _BARE_DURATION_RE.search(masked):
        return None

    def _convert(d: re.Match) -> str:
        value = d.group(1)
        if value.startswith("["):
            ms = d.group(2)
        else:
            ms = value
        return f"[animation-duration:{ms}ms]"

    rewritten = _BARE_DURATION_RE.sub(_convert, masked)
    rewritten = rewritten.replace("__DSDURATION__", "")
    # Restore data-[state=...]:duration-N occurrences if the masking
    # collapsed them; their byte content is preserved as-is in the
    # surviving spans, but the explicit recovery here matches the
    # legacy regex's observable behaviour.
    for ds in _DATA_STATE_DURATION_RE.findall(class_text):
        if ds not in rewritten:
            rewritten = (rewritten + " " + ds).strip()
    rewritten = re.sub(r"\s+", " ", rewritten).strip()
    if rewritten == class_text:
        return None
    return rewritten


def _fix_animate_in_duration(tsx: str, fixes_applied: list[str]) -> str:
    mutator = JsxAstMutator(tsx)
    if not mutator.parsed:
        return tsx

    fix_count = 0
    for site in mutator.iter_classnames():
        rewritten = _rewrite_animate_in_duration_in_class(site.class_text)
        if rewritten is None:
            continue
        mutator.queue_replace(site.inner_start, site.inner_end, rewritten)
        fix_count += 1

    if fix_count == 0:
        return tsx

    fixes_applied.append(
        f"Animation: rewrote {fix_count} `animate-in ... duration-N` "
        f"className(s) → `[animation-duration:Nms]` to avoid implicit "
        f"`transition: all` causing first-paint layout shift"
    )
    return mutator.build()


# ---------------------------------------------------------------------------
# Fix 7b — animationDuration: 'var(--animation-duration)' inline-style fallback
# ---------------------------------------------------------------------------


# Matches a string literal of exactly ``var(--animation-duration)`` with NO
# fallback (no comma) — single- or double-quoted. We only touch the
# fallback-less form because the fallback form is already correct.
#
# The regex is anchored on the opening + closing quote, so we won't match
# things like ``'var(--animation-duration-fast)'`` (different custom prop)
# or ``'var(--animation-duration, 200ms)'`` (already has fallback).
_ANIM_DURATION_NO_FALLBACK_RE = re.compile(
    r"""(?P<q>['"])var\(--animation-duration\)(?P=q)"""
)


def _fix_animation_duration_inline_style(
    tsx: str, fixes_applied: list[str]
) -> str:
    """Add a ``200ms`` fallback to ``'var(--animation-duration)'`` literals.

    Scope: the regex matches the EXACT string literal
    ``'var(--animation-duration)'`` (either quote style). Every realistic
    occurrence in component TSX is inside a JSX inline style object —
    ``style={{ animationDuration: 'var(--animation-duration)' }}`` or
    ``style={{ animationDuration: "var(--animation-duration)" }}``. We
    don't try to be cleverer than that: the literal has no legitimate
    second usage in component code, so a textual rewrite is safe and
    avoids the overhead of walking the AST to locate every JSX
    attribute that contains an object expression.

    Safety: the regex is anchored on the quote pair, so it cannot
    rewrite ``var(--animation-duration-fast)`` (different prop) or
    ``var(--animation-duration, 200ms)`` (already correct).
    """
    fix_count = [0]

    def _replace(m: re.Match) -> str:
        fix_count[0] += 1
        q = m.group("q")
        return f"{q}var(--animation-duration, 200ms){q}"

    rewritten = _ANIM_DURATION_NO_FALLBACK_RE.sub(_replace, tsx)
    if fix_count[0] == 0:
        return tsx

    fixes_applied.append(
        f"Animation: added `200ms` fallback to {fix_count[0]} inline "
        f"`style={{ animationDuration: 'var(--animation-duration)' }}` "
        f"literal(s) to prevent first-paint instant-flash when the SPA "
        f"shell hasn't set the custom property yet"
    )
    return rewritten


# ---------------------------------------------------------------------------
# Fix 8 — useRef([]) / useState([]) → useRef<any[]>([]) / useState<any[]>([])
# (already AST; unchanged from pre-H.2)
# ---------------------------------------------------------------------------


def _fix_untyped_empty_array_calls(tsx: str, fixes_applied: list[str]) -> str:
    """Annotate ``useRef([])`` / ``useState([])`` with ``<any[]>``.

    Walks every ``call_expression`` once; collects byte-offset edits and
    splices them in right-to-left so earlier offsets stay valid as later
    sites are rewritten.
    """
    try:
        tree = parse_tsx(tsx)
    except Exception:
        return tsx
    buf = source_bytes(tsx)

    edits: list[tuple[int, int, str]] = []  # (start, end, replacement)
    rewritten_count = 0
    for call in find_by_type(tree.root_node, "call_expression"):
        callee = call.child_by_field_name("function")
        if callee is None or callee.type != "identifier":
            continue
        callee_name = buf[callee.start_byte : callee.end_byte].decode("utf-8")
        if callee_name not in ("useRef", "useState"):
            continue
        # Skip already-typed calls — ``useRef<T>([])`` has a
        # ``type_arguments`` named child positioned between the function
        # identifier and the argument list.
        if any(c.type == "type_arguments" for c in call.named_children):
            continue
        args = call.child_by_field_name("arguments")
        if args is None or args.named_child_count != 1:
            continue
        arg = args.named_children[0]
        # Empty array literal: tree-sitter-typescript types it as
        # ``array`` with zero named children. ``[]`` only — any element
        # makes inference work, so we leave those alone.
        if arg.type != "array" or arg.named_child_count != 0:
            continue
        # Splice ``<any[]>`` between the callee and the arguments. The
        # opening paren is the first child of ``arguments`` (unnamed).
        insert_byte = callee.end_byte
        edits.append((insert_byte, insert_byte, "<any[]>"))
        rewritten_count += 1

    if not edits:
        return tsx

    # Apply right-to-left so earlier byte offsets remain valid.
    out = buf
    for start, end, replacement in sorted(edits, key=lambda e: -e[0]):
        out = out[:start] + replacement.encode("utf-8") + out[end:]

    fixes_applied.append(
        f"Typed {rewritten_count} untyped useRef/useState empty array(s) → "
        f"<any[]> (avoids tsc.2345 'never[]' inference)"
    )
    return out.decode("utf-8")


# ---------------------------------------------------------------------------
# Fix 9 — overflow-hidden on root child of LightDOMContainer (AST-migrated)
# ---------------------------------------------------------------------------


def _first_jsx_child_of(jsx_element_node):
    """Return the first JSX element child of a ``jsx_element`` node, or None.

    Skips text-only children (whitespace between tags) and the
    ``jsx_opening_element`` / ``jsx_closing_element`` siblings of the
    wrapper itself. Returns either a ``jsx_element`` or
    ``jsx_self_closing_element``.
    """
    for child in jsx_element_node.children:
        if child.type == "jsx_element":
            return child
        if child.type == "jsx_self_closing_element":
            return child
    return None


def _opening_of(jsx_node):
    """Return the ``jsx_opening_element`` of a ``jsx_element``, or the
    ``jsx_self_closing_element`` itself when called on one.
    """
    if jsx_node.type == "jsx_self_closing_element":
        return jsx_node
    for child in jsx_node.children:
        if child.type == "jsx_opening_element":
            return child
    return None


def _fix_overflow_hidden_on_root(tsx: str, fixes_applied: list[str]) -> str:
    """Rewrite root child's bare ``overflow-hidden`` token to ``overflow-x-clip``.

    Only rewrites the bare token; ``hover:overflow-hidden`` /
    ``md:overflow-hidden`` / etc. are left intact (they don't affect base
    layout). Idempotent — running again on the rewritten output is a no-op.

    Walks the AST to find every ``<LightDOMContainer>`` element; for each,
    locates the first JSX child element and mutates only that child's
    className inner span via :class:`JsxAstMutator`. Comments, string
    literals, and JSX prose mentioning ``<LightDOMContainer>`` are
    structurally untouchable.
    """
    mutator = JsxAstMutator(tsx)
    if not mutator.parsed or mutator.tree is None:
        return tsx

    rewrites = 0
    for jsx_el in find_by_type(mutator.tree.root_node, "jsx_element"):
        opening = _opening_of(jsx_el)
        if opening is None:
            continue
        if jsx_tag_name(opening, mutator.buf) != "LightDOMContainer":
            continue
        first_child = _first_jsx_child_of(jsx_el)
        if first_child is None:
            continue
        child_opening = _opening_of(first_child)
        if child_opening is None:
            continue
        class_text = _classname_static_value(child_opening, mutator.buf)
        if class_text is None:
            continue
        tokens = class_text.split()
        if "overflow-hidden" not in tokens:
            continue
        new_tokens = [
            "overflow-x-clip" if t == "overflow-hidden" else t for t in tokens
        ]
        span = _classname_value_inner_span(child_opening, mutator.buf)
        if span is None:
            continue
        mutator.queue_replace(span[0], span[1], " ".join(new_tokens))
        rewrites += 1

    if rewrites == 0:
        return tsx

    fixes_applied.append(
        "Layout: rewrote root overflow-hidden → overflow-x-clip "
        "(preserves horizontal clip without breaking page scroll)"
    )
    return mutator.build()
