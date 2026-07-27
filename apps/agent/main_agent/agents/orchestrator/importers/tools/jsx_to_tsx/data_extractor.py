"""Deterministic data-shape extractor for Babel-shell sibling JSX.

When a Claude Design dashboard imports as a Babel-shell (multiple
sibling .jsx files concatenated by the source bundle), one sibling
typically declares static data:

```js
// data.jsx
const STUDENTS = [
  { id: 1000, name: "Amelia", grade: 5, gpa: 3.8 },
  { id: 1001, name: "Henry",  grade: 7, gpa: 3.6 },
  ...
];
```

…and another consumes it via ``.map()``:

```js
// page-students.jsx
function StudentsTable() {
  return <table>{STUDENTS.map(s => <tr>...</tr>)}</table>;
}
```

The DesignImporter LLM rarely surfaces these as backend models. This
extractor walks the sibling AST deterministically and:

  1. Finds every top-level ``const NAME = [{...}, {...}, ...]``
  2. Confirms there's at least one ``.map()`` consumer in any sibling
  3. Infers a ``ModelPlan``-compatible column schema from the first
     N elements (intersection of keys, type per column)
  4. Returns the raw seed rows so SeedDataBuilder can write a CSV
     without re-querying an LLM

The extractor is deterministic (tree-sitter, no LLM) and conservative
(skips heterogeneous arrays, arrays containing JSX or function
expressions, computed keys, spread elements). Better to under-promote
than over-promote.

Used by the Phase 2 grounding helper (``importers/grounding.py``) to
populate ``creator_plan["app_backend_plan"]["models"]`` and stash seed
rows in ``StateKeys.EXTRACTED_SEED_DATA`` for SeedDataBuilder to pick
up later.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Literal, Optional

import structlog
from tree_sitter import Node

from main_agent.services.validation.tsx_ast.parser import (
    node_text,
    parse_tsx,
    source_bytes,
)

logger = structlog.get_logger(__name__)


# ── Public API types ────────────────────────────────────────────────


_ColumnType = Literal["text", "integer", "real", "json"]


@dataclass
class ExtractedColumn:
    """One inferred column on an extracted model."""

    name: str
    type: _ColumnType
    required: bool = True  # set False when the field is missing in some rows


@dataclass
class WiringCandidate:
    """One module that consumes an extracted symbol and could be
    rewritten by ComponentBuilder edit-mode in Phase 3.3."""

    module_name: str  # consumer module that maps over the symbol
    symbol: str
    model_name: str  # snake_case plural the symbol becomes
    source_module: str  # module that DECLARED the symbol (for the import strip)


@dataclass
class ExtractedDataModel:
    """One backend model derived from a Babel-shell data sibling."""

    name: str  # snake_case plural — "students" from "STUDENTS"
    source_symbol: str  # original JS identifier — "STUDENTS"
    source_module: str  # sibling that declared it — "Data"
    columns: list[ExtractedColumn]
    seed_rows: list[dict]  # the literal array contents as Python objects
    consumers: list[str] = field(default_factory=list)
    """Sibling module names that consume the symbol via ``.map()``."""


@dataclass
class ExtractionResult:
    """Output of ``extract_babel_shell_data``."""

    models: list[ExtractedDataModel]
    wiring_candidates: list[WiringCandidate]
    skipped: list[tuple[str, str, str]]
    """(module_name, symbol, reason) for arrays we considered but rejected."""


# ── Public entry point ──────────────────────────────────────────────


def extract_babel_shell_data(
    modules: Iterable[tuple[str, str]],
) -> ExtractionResult:
    """Walk sibling JSX sources for top-level data arrays.

    Args:
        modules: iterable of ``(module_name, source_text)`` tuples for
            every sibling in a Babel-shell page (per-module emission).

    Returns:
        ExtractionResult with discovered models + wiring candidates +
        skipped reasons.
    """
    module_list = list(modules)
    if not module_list:
        return ExtractionResult(models=[], wiring_candidates=[], skipped=[])

    # Pass 1: find candidate arrays + parse their literals.
    candidates: list[_RawCandidate] = []
    skipped: list[tuple[str, str, str]] = []
    for module_name, source in module_list:
        if not source or not source.strip():
            continue
        try:
            tree = parse_tsx(source)
        except Exception as exc:
            logger.warning(
                "data_extractor_parse_failed",
                module=module_name,
                error=str(exc),
            )
            continue
        buf = source_bytes(source)
        for symbol, array_node, reason in _walk_top_level_arrays(
            tree.root_node, buf
        ):
            if reason is not None:
                skipped.append((module_name, symbol, reason))
                continue
            rows, parse_skip = _parse_array_of_objects(array_node, buf)
            if parse_skip is not None:
                skipped.append((module_name, symbol, parse_skip))
                continue
            if not rows:
                skipped.append((module_name, symbol, "empty_array"))
                continue
            candidates.append(
                _RawCandidate(
                    module_name=module_name,
                    symbol=symbol,
                    rows=rows,
                )
            )

    if not candidates:
        return ExtractionResult(models=[], wiring_candidates=[], skipped=skipped)

    # Pass 2: count `.map()` consumers across all sibling modules.
    consumer_map = _find_map_consumers(
        module_list, {c.symbol for c in candidates}
    )

    # Pass 3: build models from candidates that have at least one consumer.
    models: list[ExtractedDataModel] = []
    wiring: list[WiringCandidate] = []
    used_names: set[str] = set()
    for cand in candidates:
        consumers = sorted(consumer_map.get(cand.symbol, set()))
        if not consumers:
            skipped.append((cand.module_name, cand.symbol, "no_map_consumer"))
            continue
        columns = _infer_columns(cand.rows)
        if not columns:
            skipped.append(
                (cand.module_name, cand.symbol, "no_inferable_columns")
            )
            continue
        model_name = _disambiguate(_to_snake_plural(cand.symbol), used_names)
        used_names.add(model_name)
        models.append(
            ExtractedDataModel(
                name=model_name,
                source_symbol=cand.symbol,
                source_module=cand.module_name,
                columns=columns,
                seed_rows=cand.rows,
                consumers=consumers,
            )
        )
        for consumer in consumers:
            wiring.append(
                WiringCandidate(
                    module_name=consumer,
                    symbol=cand.symbol,
                    model_name=model_name,
                    source_module=cand.module_name,
                )
            )

    return ExtractionResult(
        models=models,
        wiring_candidates=wiring,
        skipped=skipped,
    )


# ── Internals ───────────────────────────────────────────────────────


@dataclass
class _RawCandidate:
    module_name: str
    symbol: str
    rows: list[dict]


def _walk_top_level_arrays(
    root: Node, buf: bytes
) -> Iterable[tuple[str, Node, Optional[str]]]:
    """Yield ``(symbol, array_node, skip_reason)`` for each top-level
    ``const NAME = [...]`` declaration.

    ``skip_reason`` is ``None`` when the candidate is worth parsing;
    otherwise a short string explaining why we skipped (the caller
    records it for diagnostics).
    """
    for stmt in root.children:
        node = stmt
        # Unwrap `export const NAME = [...]` and `export const X, Y = ...`.
        if stmt.type == "export_statement":
            decl = stmt.child_by_field_name("declaration")
            if decl is None:
                continue
            node = decl
        if node.type not in ("lexical_declaration", "variable_declaration"):
            continue
        for declarator in node.named_children:
            if declarator.type != "variable_declarator":
                continue
            name_node = declarator.child_by_field_name("name")
            value_node = declarator.child_by_field_name("value")
            if name_node is None or value_node is None:
                continue
            if name_node.type != "identifier":
                continue
            symbol = node_text(name_node, buf)
            if value_node.type != "array":
                continue
            yield symbol, value_node, None


def _parse_array_of_objects(
    array_node: Node, buf: bytes
) -> tuple[list[dict], Optional[str]]:
    """Parse an ``array`` node as a list of object literals.

    Returns ``(rows, skip_reason)``. ``rows`` is a list of dicts when
    the array is a homogeneous list of pure object literals; otherwise
    an empty list with a non-None ``skip_reason``.
    """
    rows: list[dict] = []
    for elem in array_node.named_children:
        if elem.type != "object":
            return [], "non_object_element"
        try:
            row = _parse_object(elem, buf)
        except _SkipExtraction as e:
            return [], e.reason
        rows.append(row)
    return rows, None


class _SkipExtraction(Exception):
    """Internal signal: the literal contains something we won't extract."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


def _parse_object(obj_node: Node, buf: bytes) -> dict:
    """Parse an object literal into a Python dict. Raises
    ``_SkipExtraction`` on anything we won't safely extract:
    function/method shorthand, computed keys, spread elements,
    template literals, JSX expressions, etc."""
    out: dict = {}
    for prop in obj_node.named_children:
        if prop.type != "pair":
            # Shorthand `{ x }` could resolve via cross-file lookup but
            # we'd need scope analysis. Spread `{ ...x }` same. Skip.
            raise _SkipExtraction(f"non_pair_property:{prop.type}")
        key_node = prop.child_by_field_name("key")
        value_node = prop.child_by_field_name("value")
        if key_node is None or value_node is None:
            raise _SkipExtraction("malformed_pair")
        key = _parse_key(key_node, buf)
        value = _parse_value(value_node, buf)
        out[key] = value
    return out


def _parse_key(node: Node, buf: bytes) -> str:
    if node.type == "property_identifier":
        return node_text(node, buf)
    if node.type == "string":
        text = node_text(node, buf)
        if len(text) >= 2 and text[0] in ("\"", "'") and text[-1] == text[0]:
            return text[1:-1]
        return text
    if node.type == "number":
        return node_text(node, buf)
    raise _SkipExtraction(f"computed_or_unknown_key:{node.type}")


def _parse_value(node: Node, buf: bytes) -> Any:
    """Convert a tree-sitter value node into a Python object. Raises
    ``_SkipExtraction`` on anything that isn't pure data."""
    if node.type == "string":
        return _parse_string(node_text(node, buf))
    if node.type == "number":
        return _parse_number(node_text(node, buf))
    if node.type == "true":
        return True
    if node.type == "false":
        return False
    if node.type == "null":
        return None
    if node.type == "undefined":
        return None
    if node.type == "unary_expression":
        # `+5` / `-3.14` — only unary +/- on numeric literals are safe.
        op_node = node.child_by_field_name("operator")
        arg_node = node.child_by_field_name("argument")
        if op_node is None or arg_node is None:
            raise _SkipExtraction("unary_no_args")
        op = node_text(op_node, buf)
        if op not in ("+", "-"):
            raise _SkipExtraction(f"unary_op:{op}")
        if arg_node.type != "number":
            raise _SkipExtraction(f"unary_non_numeric:{arg_node.type}")
        n = _parse_number(node_text(arg_node, buf))
        return -n if op == "-" else n
    if node.type == "array":
        return [_parse_value(c, buf) for c in node.named_children]
    if node.type == "object":
        return _parse_object(node, buf)
    if node.type in ("template_string", "template_substitution"):
        raise _SkipExtraction("template_string")
    if node.type in (
        "arrow_function",
        "function",
        "function_expression",
        "method_definition",
        "call_expression",
        "jsx_element",
        "jsx_self_closing_element",
        "identifier",
        "member_expression",
        "binary_expression",
        "ternary_expression",
    ):
        raise _SkipExtraction(f"non_literal_value:{node.type}")
    raise _SkipExtraction(f"unknown_value:{node.type}")


def _parse_string(text: str) -> str:
    """Strip surrounding quotes from a JS string literal and decode
    common escape sequences.

    Handles ``\\\\`` (literal backslash), ``\\n``, ``\\t``, ``\\r``,
    ``\\"``, ``\\'``, and ``\\<other>`` (drop the backslash). Walks
    left-to-right so a literal backslash sequence (``"a\\\\nb"`` →
    ``a\\nb``) doesn't get re-interpreted as a newline by a later
    replace pass."""
    if len(text) < 2 or text[0] not in ("\"", "'") or text[-1] != text[0]:
        return text
    inner = text[1:-1]
    out: list[str] = []
    i = 0
    n = len(inner)
    while i < n:
        c = inner[i]
        if c != "\\" or i + 1 >= n:
            out.append(c)
            i += 1
            continue
        nxt = inner[i + 1]
        out.append({
            "\\": "\\",
            "n": "\n",
            "t": "\t",
            "r": "\r",
            "\"": "\"",
            "'": "'",
            "/": "/",
            "0": "\0",
        }.get(nxt, nxt))
        i += 2
    return "".join(out)


def _parse_number(text: str) -> float | int:
    """Parse a JS number literal. ``5`` → int, ``5.0`` → float."""
    txt = text.replace("_", "")  # JS numeric separator
    try:
        if "." in txt or "e" in txt or "E" in txt:
            return float(txt)
        return int(txt, 0)
    except ValueError:
        return float(txt)


def _find_map_consumers(
    modules: list[tuple[str, str]],
    symbols: set[str],
) -> dict[str, set[str]]:
    """Return ``{symbol: {consumer_module_names}}`` for every symbol
    referenced as data in any module.

    Counts ANY identifier reference to the symbol that's NOT inside
    its own declaration. Examples that count:
      * ``SYMBOL.map(...)``  — direct iteration
      * ``SYMBOL.filter(...).map(...)`` — chain
      * ``SYMBOL.length``, ``SYMBOL.find(...)``, ``SYMBOL.slice(...)``
      * ``useState(SYMBOL)`` / ``React.useState(SYMBOL)`` — state seed
      * ``<LineChart data={SYMBOL}/>``, ``Object.values(SYMBOL)``,
        ``[...SYMBOL]`` — pass-through to other components / utils

    Uses tree-sitter so string/comment text doesn't false-match.
    Identifiers inside the declaration (``const SYMBOL = [...]``) are
    skipped via the lexical_declaration parent check so the symbol
    doesn't count as its own consumer for that line.

    Self-references in OTHER statements (the module that defines
    SYMBOL also renders it) DO count — same module + same symbol
    means the symbol's declaring module is also a consumer.
    """
    out: dict[str, set[str]] = {s: set() for s in symbols}
    for module_name, source in modules:
        if not source or not symbols:
            continue
        if not any(sym in source for sym in symbols):
            continue
        try:
            tree = parse_tsx(source)
        except Exception:
            continue
        buf = source_bytes(source)

        # Skip identifiers inside top-level lexical_declarations whose
        # binding name matches one of our symbols — those are the
        # declarations themselves, not consumption.
        declaration_spans: list[tuple[int, int]] = []
        for stmt in tree.root_node.children:
            node = stmt
            if stmt.type == "export_statement":
                decl = stmt.child_by_field_name("declaration")
                if decl is not None:
                    node = decl
            if node.type not in ("lexical_declaration", "variable_declaration"):
                continue
            for declarator in node.named_children:
                if declarator.type != "variable_declarator":
                    continue
                name_node = declarator.child_by_field_name("name")
                if name_node is None or name_node.type != "identifier":
                    continue
                if node_text(name_node, buf) in symbols:
                    declaration_spans.append((stmt.start_byte, stmt.end_byte))

        # Walk every identifier node and check if it names a symbol.
        # Skip identifiers used as a property name in member access
        # (`obj.SYMBOL` would be a property lookup, not a reference to
        # our symbol).
        stack: list[Node] = [tree.root_node]
        while stack:
            node = stack.pop()
            if node.type == "identifier":
                name = node_text(node, buf)
                if name in symbols:
                    inside_decl = any(
                        s <= node.start_byte < e for s, e in declaration_spans
                    )
                    if not inside_decl:
                        parent = node.parent
                        is_property_name = (
                            parent is not None
                            and parent.type == "member_expression"
                            and parent.child_by_field_name("property") is node
                        )
                        if not is_property_name:
                            out[name].add(module_name)
            for child in node.children:
                stack.append(child)
    return out


def _find_calls(root: Node) -> Iterable[Node]:
    """Yield every call_expression in the subtree (local helper to
    avoid importing from validation/walker which has unrelated deps)."""
    stack: list[Node] = [root]
    while stack:
        node = stack.pop()
        if node.type == "call_expression":
            yield node
        for child in node.children:
            stack.append(child)


def _infer_columns(rows: list[dict]) -> list[ExtractedColumn]:
    """Infer a column list from the first N rows. Required = field
    appears in every row; otherwise optional.

    Type inference per column:
      - All values bool/int/None → integer
      - All values float → real
      - Mix of int + float → real
      - All values dict/list → json
      - All values string → text
      - Anything mixed → text (safest cast)
      - Field whose values are all None → text (default)
    """
    sample = rows[: min(len(rows), 25)]
    if not sample:
        return []
    union: dict[str, list[Any]] = {}
    intersection: set[str] | None = None
    for row in sample:
        keys = set(row.keys())
        intersection = keys if intersection is None else intersection & keys
        for k, v in row.items():
            union.setdefault(k, []).append(v)
    if intersection is None:
        intersection = set()

    columns: list[ExtractedColumn] = []
    for name, values in union.items():
        col_type = _infer_type(values)
        columns.append(
            ExtractedColumn(
                name=_snake_case(name),
                type=col_type,
                required=name in intersection,
            )
        )
    return columns


def _infer_type(values: list[Any]) -> _ColumnType:
    non_none = [v for v in values if v is not None]
    if not non_none:
        return "text"
    if all(isinstance(v, (dict, list)) for v in non_none):
        return "json"
    if all(isinstance(v, bool) for v in non_none):
        return "integer"  # SQLite has no bool; D1 stores 0/1
    if all(isinstance(v, int) and not isinstance(v, bool) for v in non_none):
        return "integer"
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in non_none):
        return "real"
    return "text"


# ── Naming ──────────────────────────────────────────────────────────


def _to_snake_plural(symbol: str) -> str:
    """``STUDENTS`` → ``students``, ``CLASSES_TODAY`` →
    ``classes_today``, ``Calendar`` → ``calendars`` (adds plural -s
    when the symbol is singular)."""
    snake = _snake_case(symbol)
    if not snake:
        return ""
    return _pluralize(snake)


def _snake_case(name: str) -> str:
    """``CamelCase`` → ``camel_case``, ``STUDENTS`` → ``students``,
    ``CLASSES_TODAY`` → ``classes_today``, ``alreadyMixed`` →
    ``already_mixed``, ``HTTPRequest`` → ``http_request``."""
    if not name:
        return ""
    # Split on existing underscores first so we don't double-snake.
    parts = name.split("_")
    out_parts: list[str] = []
    for part in parts:
        if not part:
            continue
        # Two-stage regex: handle "ABBRWord" → "ABBR_Word" first, then
        # standalone "wordW" → "word_W" boundaries. Skip splitting
        # between consecutive uppercase letters (so STUDENTS stays one
        # word, not S_T_U_D...).
        spaced = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", part)
        spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", spaced)
        out_parts.append(spaced.lower())
    return "_".join(out_parts)


_PLURAL_KEEP_AS_IS = frozenset({
    "data", "info", "metadata", "fish", "sheep",
})


def _pluralize(name: str) -> str:
    """Cheap pluralizer — handles the common cases used in dashboard
    data (students, classes, messages, charts, …). NOT a full English
    pluralizer.

    Only pluralizes the LAST chunk of an underscore-separated name,
    and only when the name doesn't already look plural. ``CLASSES_TODAY``
    is treated as already-plural because the head noun ``classes`` ends
    in 's' — pluralizing the tail (``today`` → ``todays``) would give
    a nonsensical compound.
    """
    if not name:
        return name
    chunks = name.split("_")
    # If ANY chunk is already plural-shaped (ends in 's', 'ies', 'es'),
    # treat the whole name as plural and don't add another suffix.
    if any(_looks_plural(c) for c in chunks):
        return name
    last = chunks[-1]
    if last in _PLURAL_KEEP_AS_IS:
        return name
    if last.endswith("y") and len(last) > 1 and last[-2] not in "aeiou":
        # baby → babies
        chunks[-1] = last[:-1] + "ies"
    elif last.endswith(("s", "x", "z")) or last.endswith("ch") or last.endswith("sh"):
        chunks[-1] = last + "es"
    else:
        chunks[-1] = last + "s"
    return "_".join(chunks)


def _looks_plural(chunk: str) -> bool:
    """Heuristic: does ``chunk`` already look like a plural noun?"""
    if not chunk:
        return False
    if chunk in _PLURAL_KEEP_AS_IS:
        return True
    if chunk.endswith("ies") or chunk.endswith("es") or chunk.endswith("s"):
        # Filter false positives where the singular form ends in 's'
        # already (`gas`, `bus`, `news`) — too many edge cases to be
        # exhaustive. Two-letter chunks ending in 's' are usually not
        # plural (`is`, `as`); reject those.
        if len(chunk) <= 2:
            return False
        return True
    return False


def _disambiguate(name: str, used: set[str]) -> str:
    """Add a numeric suffix when ``name`` collides with an already-used
    model name in this extraction batch."""
    if name not in used:
        return name
    i = 2
    while f"{name}_{i}" in used:
        i += 1
    return f"{name}_{i}"
