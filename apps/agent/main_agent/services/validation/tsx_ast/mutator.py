"""JSX-aware AST mutation harness for component-TSX auto-fixers.

Use this when a fixer needs to mutate JSX in a way regex cannot do safely:

* mutate every ``className`` value's inner text (Tailwind utility list
  rewrites — opacity clamp, contrast bump, animation-duration swap)
* mutate any other JSX attribute value by name (``style=``,
  ``aria-label=``, etc.)
* splice arbitrary new content at byte offsets without disturbing
  surrounding JSX

The class wraps tree-sitter parsing + byte-offset splicing so individual
fixers don't reinvent parser construction, edit ordering, or
byte→character index conversion.

**Why this exists.** Pre-H.1 fixers used ``re.sub`` over raw TSX, which
corrupts JSX whenever a regex pattern crosses a JSX boundary (e.g., the
match spans an SVG path string, a JSX expression child, or a template
literal with ``${...}``). Mutating *only* inside known JSX value spans is
structurally incapable of producing that corruption class — the entire
"fixer broke JSX" failure mode disappears for migrated callers.

The harness is paired with the per-fixer rollback wrapper in
``services/validation/fixers/dispatcher.py`` (Change A): if a migrated
fixer still manages to produce malformed output, the dispatcher rolls
back its mutations and the rest of the pipeline survives.

Typical usage::

    mutator = JsxAstMutator(tsx)
    for site in mutator.iter_classnames():
        if "animate-in" in site.class_text and "transition" not in site.class_text:
            new_text = _rewrite_duration(site.class_text)
            mutator.queue_replace(site.inner_start, site.inner_end, new_text)
    fixed = mutator.build()

The ``ClassNameSite`` and ``JsxAttributeSite`` dataclasses are immutable
view objects. Edits are queued via ``queue_replace`` and applied once on
``build``; the harness sorts edits right-to-left so earlier byte offsets
remain valid as later sites are spliced.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

from tree_sitter import Node, Tree

from .parser import parse_tsx
from .walker import (
    _classname_static_value,
    _classname_value_inner_span,
    iter_jsx_attributes,
    iter_jsx_opening_elements,
    string_literal_value,
    template_string_static_value,
)


# --------------------------------------------------------------------------- #
# Site dataclasses
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class ClassNameSite:
    """A static ``className`` attribute located in the TSX source.

    ``inner_start`` / ``inner_end`` are byte offsets into the UTF-8
    encoded source; they bracket the value text *excluding* surrounding
    quotes or backticks. ``class_text`` is the decoded inner text with
    any ``${...}`` substitutions stripped, matching the legacy
    classname-walker contract.
    """

    element: Node
    class_text: str
    inner_start: int
    inner_end: int


@dataclass(frozen=True)
class JsxAttributeSite:
    """A JSX attribute located in the TSX source.

    ``value_kind`` is one of:

    * ``"flag"`` — attribute appears with no value (``<img disabled>``).
      ``value_text`` / ``inner_start`` / ``inner_end`` are ``None``.
    * ``"string"`` — ``attr="..."``. ``value_text`` holds the string
      contents; the inner span brackets the bytes between the two quotes.
    * ``"template"`` — ``attr={\\`...\\`}`` static template (no ``${...}``).
      ``value_text`` holds the static text; the inner span brackets the
      bytes between the two backticks.
    * ``"expression"`` — ``attr={expr}``. ``value_text`` is ``None`` (the
      expression body is opaque to this harness); the inner span brackets
      the bytes inside the braces, exclusive of the braces themselves.
      Callers should treat the expression body as opaque unless they
      have their own AST-aware unpacker for it.
    """

    element: Node
    name: str
    value_kind: str
    value_text: str | None
    inner_start: int | None
    inner_end: int | None


# --------------------------------------------------------------------------- #
# Mutator
# --------------------------------------------------------------------------- #


class JsxAstMutator:
    """Tree-sitter-backed JSX mutation harness.

    Construct with the source string, iterate sites with
    ``iter_classnames`` / ``iter_jsx_attributes``, queue replacements via
    ``queue_replace``, and emit the rewritten source via ``build``. The
    instance is single-use: edits are applied exactly once, and a subsequent
    ``build`` call returns the same string without re-applying.

    Failure modes:

    * Source fails to parse: ``parsed`` is False, the iterators yield
      nothing, and ``build`` returns the original source unchanged.
    * Overlapping edits queued: ``build`` raises ``ValueError`` rather
      than silently producing a corrupt splice.
    """

    def __init__(self, source: str) -> None:
        self._source = source
        self._buf = source.encode("utf-8")
        try:
            self._tree: Tree | None = parse_tsx(source)
        except Exception:
            self._tree = None
        self._edits: list[tuple[int, int, str]] = []
        self._built: str | None = None

    # ------------------------------------------------------------------ #
    # Inspection
    # ------------------------------------------------------------------ #

    @property
    def parsed(self) -> bool:
        """True iff the source parsed successfully."""
        return self._tree is not None

    @property
    def source(self) -> str:
        """The original source string the mutator was constructed with."""
        return self._source

    @property
    def tree(self) -> Tree | None:
        """The underlying tree-sitter ``Tree``, or ``None`` if parse failed.

        Exposed for fixers that need richer AST queries than
        ``iter_classnames`` / ``iter_jsx_attributes`` provide (e.g.,
        "find the first JSX child of ``<LightDOMContainer>``"). Fixers
        should still route every mutation through ``queue_replace`` so
        the safe-splice contract holds.
        """
        return self._tree

    @property
    def buf(self) -> bytes:
        """UTF-8 encoded source buffer the parser sees.

        Pair with ``tree`` for byte-offset extraction:
        ``mutator.buf[node.start_byte:node.end_byte].decode("utf-8")``.
        """
        return self._buf

    # ------------------------------------------------------------------ #
    # Iteration
    # ------------------------------------------------------------------ #

    def iter_classnames(self) -> Iterator[ClassNameSite]:
        """Yield one site per JSX element with a static ``className``.

        Skips opaque dynamic forms (``className={fn()}``, identifier-only)
        and ``${...}``-laden templates — mutating those would also rewrite
        the embedded substitution expressions.
        """
        if self._tree is None:
            return
        for element in iter_jsx_opening_elements(self._tree.root_node):
            class_text = _classname_static_value(element, self._buf)
            if class_text is None:
                continue
            span = _classname_value_inner_span(element, self._buf)
            if span is None:
                continue
            yield ClassNameSite(
                element=element,
                class_text=class_text,
                inner_start=span[0],
                inner_end=span[1],
            )

    def iter_jsx_attributes(self, name: str) -> Iterator[JsxAttributeSite]:
        """Yield every JSX element where attribute ``name`` is present.

        See :class:`JsxAttributeSite` for the four ``value_kind`` variants
        the harness distinguishes. The iterator emits one site per
        attribute occurrence, in source order. ``${...}``-laden template
        values surface as ``"expression"`` so callers don't accidentally
        mutate a substitution as if it were static text.
        """
        if self._tree is None:
            return
        for element in iter_jsx_opening_elements(self._tree.root_node):
            for attr in iter_jsx_attributes(element):
                if attr.named_child_count == 0:
                    continue
                name_node = attr.named_children[0]
                attr_name = self._buf[name_node.start_byte : name_node.end_byte].decode("utf-8")
                if attr_name != name:
                    continue
                yield self._build_attribute_site(element, attr, name)

    # ------------------------------------------------------------------ #
    # Edit queue
    # ------------------------------------------------------------------ #

    def queue_replace(self, start_byte: int, end_byte: int, replacement: str) -> None:
        """Queue a byte-range replacement.

        ``start_byte`` and ``end_byte`` are offsets into the UTF-8
        encoded source. ``replacement`` is plain ``str`` (the harness
        handles encoding). Empty ranges are accepted and treated as
        insertions at ``start_byte``.

        Raises:
            RuntimeError: When ``build()`` has already been called. The
                instance is single-use to keep edit ordering deterministic.
            ValueError: When ``start_byte > end_byte`` or either offset
                falls outside the source bounds. Detection happens at
                queue time so mistakes surface near their author.
        """
        # Check the lifecycle precondition first — if the mutator is
        # already built, no bounds check matters.
        if self._built is not None:
            raise RuntimeError(
                "queue_replace: cannot queue further edits after build() has been called"
            )
        if start_byte < 0 or end_byte > len(self._buf):
            raise ValueError(
                f"queue_replace: byte range {start_byte}..{end_byte} outside source "
                f"(len={len(self._buf)})"
            )
        if start_byte > end_byte:
            raise ValueError(
                f"queue_replace: start_byte {start_byte} > end_byte {end_byte}"
            )
        self._edits.append((start_byte, end_byte, replacement))

    @property
    def queued_edit_count(self) -> int:
        """Number of edits currently queued (un-applied)."""
        return len(self._edits)

    # ------------------------------------------------------------------ #
    # Build
    # ------------------------------------------------------------------ #

    def build(self) -> str:
        """Apply queued edits and return the rewritten source.

        Idempotent: a second call returns the same string without
        re-applying edits.

        Raises:
            ValueError: When two queued edits overlap. The mutator
                refuses to produce ambiguously-spliced output.
        """
        if self._built is not None:
            return self._built
        if not self._edits:
            self._built = self._source
            return self._built

        # Sort right-to-left so earlier offsets stay valid as we splice.
        sorted_edits = sorted(self._edits, key=lambda e: (-e[0], -e[1]))

        # Detect overlaps (after sort they're adjacent in reverse order).
        for i in range(len(sorted_edits) - 1):
            later_start, _, _ = sorted_edits[i]
            _, earlier_end, _ = sorted_edits[i + 1]
            if earlier_end > later_start:
                raise ValueError(
                    f"build: overlapping edits queued — "
                    f"earlier_end={earlier_end} > later_start={later_start}"
                )

        out = self._buf
        for start, end, replacement in sorted_edits:
            out = out[:start] + replacement.encode("utf-8") + out[end:]

        self._built = out.decode("utf-8")
        return self._built

    # ------------------------------------------------------------------ #
    # Internals
    # ------------------------------------------------------------------ #

    def _build_attribute_site(
        self, element: Node, attr: Node, name: str
    ) -> JsxAttributeSite:
        if attr.named_child_count == 1:
            return JsxAttributeSite(
                element=element,
                name=name,
                value_kind="flag",
                value_text=None,
                inner_start=None,
                inner_end=None,
            )
        value = attr.named_children[1]
        if value.type == "string":
            return JsxAttributeSite(
                element=element,
                name=name,
                value_kind="string",
                value_text=string_literal_value(value, self._buf),
                inner_start=value.start_byte + 1,
                inner_end=value.end_byte - 1,
            )
        if value.type == "jsx_expression":
            inner: Node | None = None
            for child in value.named_children:
                if child.type != "comment":
                    inner = child
                    break
            if inner is not None and inner.type == "string":
                return JsxAttributeSite(
                    element=element,
                    name=name,
                    value_kind="string",
                    value_text=string_literal_value(inner, self._buf),
                    inner_start=inner.start_byte + 1,
                    inner_end=inner.end_byte - 1,
                )
            if inner is not None and inner.type == "template_string":
                static_text = template_string_static_value(inner, self._buf)
                if static_text is not None:
                    return JsxAttributeSite(
                        element=element,
                        name=name,
                        value_kind="template",
                        value_text=static_text,
                        inner_start=inner.start_byte + 1,
                        inner_end=inner.end_byte - 1,
                    )
            # Opaque expression — the inner span covers the bytes between
            # the braces, exclusive. Tree-sitter places `{` at start_byte
            # and `}` one byte before end_byte for the jsx_expression
            # wrapper; bracket the body itself.
            return JsxAttributeSite(
                element=element,
                name=name,
                value_kind="expression",
                value_text=None,
                inner_start=value.start_byte + 1,
                inner_end=value.end_byte - 1,
            )
        # Unknown value shape — treat as opaque with NO safe inner span.
        # tree-sitter shouldn't produce this branch on well-formed TSX,
        # but if it does we refuse to claim a span the caller could splice
        # over wrapper bytes (quotes, braces, etc.).
        return JsxAttributeSite(
            element=element,
            name=name,
            value_kind="expression",
            value_text=None,
            inner_start=None,
            inner_end=None,
        )
