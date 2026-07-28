"""Dependency graph + symbol intelligence + state inspection for ComponentBuilderMultiple.

Four primitives:

- ``build_dependency_graph`` — AST-based import resolution across staged
  frontend artifacts. Output is per-file ``imports`` + ``imported_by``
  with optional transitive closure.
- ``find_symbol_references`` — TSX-aware lookup for a symbol name; reports
  imports / declarations / references / jsx_element kinds with byte offsets.
- ``describe_artifact`` — cheap AST summary for a single file (exports,
  imports, hooks used, JSX root, props signature).
- ``inspect_app_state`` — read-only view of workflow state (pages,
  models, handlers, frontend state keys, component manifest) so the
  agent can refresh stale context across long fix-up turns.

The agent's tool surface is frontend-only; backend artifacts
(``handler_code:*``, ``backend.json``, seeds) are deliberately
excluded — they have specialized builders.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Literal

from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.scope_analyzer import analyze_module
from main_agent.services.validation.tsx_ast.walker import (
    find_by_type,
    iter_jsx_opening_elements,
    jsx_tag_name,
    walk,
)


# --------------------------------------------------------------------------- #
# Frontend artifact prefix helpers
# --------------------------------------------------------------------------- #

_COMPONENT_PREFIX = "codefocus_component:"
_MODULE_PREFIX = "codefocus_module:"


def _strip_prefix(filename: str) -> str:
    """Return the bare file name (no prefix, no extension) for an artifact."""
    for prefix in (_COMPONENT_PREFIX, _MODULE_PREFIX):
        if filename.startswith(prefix):
            base = filename[len(prefix):]
            if base.endswith(".tsx"):
                base = base[:-4]
            return base
    return filename


def _resolve_relative_import_to_artifact(
    raw: str,
    available_names: set[str],
) -> str | None:
    """Resolve an ES import specifier to an artifact name.

    Handles ``./Foo``, ``./Foo.tsx``, ``./components/Foo``. Returns the
    matching ``codefocus_module:`` or ``codefocus_component:`` artifact
    name, or None when unresolved (bare specifiers like ``react``,
    ``@exepad/sdk`` etc.).
    """
    if not raw or not raw.startswith("."):
        return None

    # Strip any extension
    spec = raw
    for ext in (".tsx", ".ts", ".jsx", ".js"):
        if spec.endswith(ext):
            spec = spec[: -len(ext)]
            break

    # Pull the last path segment — ``./components/Foo`` → ``Foo``
    base = spec.rsplit("/", 1)[-1]
    if not base:
        return None

    # Modules are imported far more often than entry components; check
    # both prefixes and prefer module first.
    for candidate in (
        f"{_MODULE_PREFIX}{base}.tsx",
        f"{_COMPONENT_PREFIX}{base}.tsx",
    ):
        if candidate in available_names:
            return candidate
    return None


# --------------------------------------------------------------------------- #
# Dependency graph — build_dependency_graph
# --------------------------------------------------------------------------- #


def _collect_imports(source: str) -> list[str]:
    """Return raw import-source specifiers found in the file.

    Walks the AST for ``import_statement`` nodes; falls back to a regex
    when tree-sitter fails to parse (Babel-shell legacy bodies sometimes
    fail). The regex match is intentionally narrow.
    """
    specs: list[str] = []
    try:
        tree = parse_tsx(source)
        buf = source_bytes(source)
        for node in find_by_type(tree.root_node, "import_statement"):
            # The source spec is the last string child
            for child in walk(node):
                if child.type == "string":
                    text = buf[child.start_byte: child.end_byte].decode("utf-8", errors="replace")
                    if len(text) >= 2 and text[0] in ('"', "'") and text[-1] == text[0]:
                        text = text[1:-1]
                    specs.append(text)
                    break
    except Exception:
        # Defensive regex fallback
        pattern = re.compile(
            r"""(?:^|[\s;])(?:import\s+(?:[^'"\n]+from\s+)?|export\s+[^'"\n]+from\s+)['"]([^'"\n]+)['"]""",
            re.MULTILINE,
        )
        specs = pattern.findall(source)
    return specs


def build_dependency_graph(
    artifact_sources: dict[str, str],
    file_names: Iterable[str] | None = None,
    *,
    direction: Literal["imports", "imported_by", "both"] = "both",
    transitive: bool = False,
) -> dict[str, dict[str, list[str]]]:
    """Build the import graph across staged frontend artifacts.

    Returns a dict keyed by artifact filename:
    ``{<filename>: {"imports": [...], "imported_by": [...]}}``.

    When ``file_names`` is provided, only those files are reported in
    the result; the full graph still drives the lookups so transitive
    closures over isolated subgraphs are correct.

    Backend artifacts (``handler_code:*``) are excluded — different
    namespace, owned by BackendHandlerBuilder.
    """
    available = {
        name for name in artifact_sources
        if name.startswith(_COMPONENT_PREFIX) or name.startswith(_MODULE_PREFIX)
    }
    forward: dict[str, set[str]] = {name: set() for name in available}
    reverse: dict[str, set[str]] = {name: set() for name in available}

    for name in available:
        source = artifact_sources.get(name) or ""
        for raw in _collect_imports(source):
            resolved = _resolve_relative_import_to_artifact(raw, available)
            if resolved and resolved != name:
                forward[name].add(resolved)
                reverse[resolved].add(name)

    def _close(seed: str, edges: dict[str, set[str]]) -> set[str]:
        seen: set[str] = set()
        stack = list(edges.get(seed, set()))
        while stack:
            n = stack.pop()
            if n in seen:
                continue
            seen.add(n)
            stack.extend(edges.get(n, set()))
        return seen

    targets = list(file_names) if file_names is not None else sorted(available)
    out: dict[str, dict[str, list[str]]] = {}
    for name in targets:
        if name not in available:
            out[name] = {"imports": [], "imported_by": []}
            continue
        if transitive:
            imp_set = _close(name, forward)
            inv_set = _close(name, reverse)
        else:
            imp_set = forward.get(name, set())
            inv_set = reverse.get(name, set())

        entry: dict[str, list[str]] = {}
        if direction in ("imports", "both"):
            entry["imports"] = sorted(imp_set)
        if direction in ("imported_by", "both"):
            entry["imported_by"] = sorted(inv_set)
        out[name] = entry
    return out


# --------------------------------------------------------------------------- #
# Symbol references — find_symbol_references
# --------------------------------------------------------------------------- #


@dataclass
class SymbolHit:
    filename: str
    line_no: int
    byte_offset: int
    kind: Literal["import", "declaration", "reference", "jsx_element"]
    context_snippet: str


def _byte_to_line(buf: bytes, byte_offset: int) -> int:
    """Convert a byte offset to a 1-based line number."""
    return buf[:byte_offset].count(b"\n") + 1


def _byte_line(buf: bytes, byte_offset: int) -> str:
    """Return the line of source containing ``byte_offset`` (no newline)."""
    start = buf.rfind(b"\n", 0, byte_offset) + 1
    end = buf.find(b"\n", byte_offset)
    if end == -1:
        end = len(buf)
    return buf[start:end].decode("utf-8", errors="replace")


def _identifier_text(node, buf: bytes) -> str:
    return buf[node.start_byte: node.end_byte].decode("utf-8", errors="replace")


def find_symbol_references(
    symbol: str,
    artifact_sources: dict[str, str],
    *,
    kinds: list[str] | None = None,
    name_glob: str = "codefocus_*",
) -> list[SymbolHit]:
    """TSX-aware lookup for ``symbol``.

    Walks each artifact's tree-sitter AST. Reports identifier nodes
    matching ``symbol`` and classifies each by AST context:

    - ``import`` — inside an ``import_statement`` (specifier or default).
    - ``declaration`` — function / class / lexical / variable declaration name.
    - ``jsx_element`` — JSX opening-tag identifier.
    - ``reference`` — every other identifier use.

    Symbols inside string literals or comments are NOT matched (because
    they aren't ``identifier`` AST nodes).
    """
    import fnmatch

    if kinds is None or "all" in kinds:
        wanted: set[str] = {"import", "declaration", "reference", "jsx_element"}
    else:
        wanted = set(kinds)

    hits: list[SymbolHit] = []
    for filename, source in sorted(artifact_sources.items()):
        if not (filename.startswith(_COMPONENT_PREFIX) or filename.startswith(_MODULE_PREFIX)):
            continue
        if not fnmatch.fnmatchcase(filename, name_glob):
            continue
        try:
            tree = parse_tsx(source)
            buf = source_bytes(source)
        except Exception:
            continue

        # Pre-compute the byte ranges of every import_statement so we can
        # classify a hit as "import" by containment.
        import_ranges = [
            (n.start_byte, n.end_byte)
            for n in find_by_type(tree.root_node, "import_statement")
        ]

        # JSX opening element tags
        jsx_tag_offsets: set[int] = set()
        for el in iter_jsx_opening_elements(tree.root_node):
            tag = jsx_tag_name(el, buf)
            if tag != symbol:
                continue
            # Locate the identifier node child to grab its start_byte
            for child in el.children:
                if child.type in ("identifier", "nested_identifier"):
                    jsx_tag_offsets.add(child.start_byte)
                    break

        # Walk identifier-bearing nodes
        for node in walk(tree.root_node):
            if node.type not in (
                "identifier",
                "type_identifier",
                "shorthand_property_identifier",
            ):
                continue
            if _identifier_text(node, buf) != symbol:
                continue

            offset = node.start_byte

            # JSX tag?
            if offset in jsx_tag_offsets:
                kind: Literal["import", "declaration", "reference", "jsx_element"] = (
                    "jsx_element"
                )
            elif any(start <= offset < end for start, end in import_ranges):
                kind = "import"
            else:
                kind = _classify_identifier_kind(node)

            if kind not in wanted:
                continue

            hits.append(
                SymbolHit(
                    filename=filename,
                    line_no=_byte_to_line(buf, offset),
                    byte_offset=offset,
                    kind=kind,
                    context_snippet=_byte_line(buf, offset).strip(),
                )
            )
    return hits


def _classify_identifier_kind(node) -> Literal["declaration", "reference"]:
    """Walk up the parent chain to decide if this identifier is a binder."""
    parent = node.parent
    if parent is None:
        return "reference"
    if parent.type in (
        "function_declaration",
        "class_declaration",
        "method_definition",
    ):
        # First identifier child of a declaration is the bound name
        for child in parent.children:
            if child.type == "identifier":
                if child.start_byte == node.start_byte:
                    return "declaration"
                break
    if parent.type in ("variable_declarator", "lexical_declaration", "variable_declaration"):
        # name = ...
        first_id = next(
            (c for c in parent.children if c.type in ("identifier", "type_identifier")),
            None,
        )
        if first_id is not None and first_id.start_byte == node.start_byte:
            return "declaration"
    return "reference"


# --------------------------------------------------------------------------- #
# Describe artifact — describe_artifact
# --------------------------------------------------------------------------- #


@dataclass
class ArtifactDescription:
    filename: str
    exports: list[str] = field(default_factory=list)
    imports: list[dict[str, Any]] = field(default_factory=list)
    hooks_used: list[str] = field(default_factory=list)
    jsx_root_tag: str | None = None
    props_signature: str | None = None
    state_keys_referenced: list[str] = field(default_factory=list)
    lines: int = 0
    bytes: int = 0


_HOOK_PATTERN = re.compile(r"\buse[A-Z][A-Za-z0-9]*")


def describe_artifact(filename: str, source: str) -> ArtifactDescription:
    """Cheap structural summary for a single artifact.

    Avoids dumping the full bytes — lets the agent decide whether a file
    matters before pulling its source.
    """
    desc = ArtifactDescription(
        filename=filename,
        lines=source.count("\n") + (1 if source and not source.endswith("\n") else 0),
        bytes=len(source.encode("utf-8")),
    )
    if not source.strip():
        return desc

    # Exports + import-spec parsing reuse the existing scope analyzer.
    analysis = analyze_module(source)
    desc.exports = list(analysis.exports)

    # Imports: walk import_statement nodes for (specifier, names[]) pairs.
    try:
        tree = parse_tsx(source)
        buf = source_bytes(source)
    except Exception:
        return desc

    for node in find_by_type(tree.root_node, "import_statement"):
        spec = None
        names: list[str] = []
        for child in walk(node):
            if child.type == "string" and spec is None:
                text = buf[child.start_byte: child.end_byte].decode("utf-8", errors="replace")
                if len(text) >= 2 and text[0] in ('"', "'") and text[-1] == text[0]:
                    text = text[1:-1]
                spec = text
            elif child.type == "import_specifier":
                for sub in child.children:
                    if sub.type == "identifier":
                        names.append(_identifier_text(sub, buf))
                        break
            elif child.type == "identifier":
                # default-import path: ``import Foo from "./Foo"``
                if not names:
                    names.append(_identifier_text(child, buf))
        if spec is not None:
            desc.imports.append({"from": spec, "names": names})

    # Hooks: identifiers matching ``use[A-Z]...``
    hooks: set[str] = set()
    for node in walk(tree.root_node):
        if node.type == "identifier":
            text = _identifier_text(node, buf)
            if _HOOK_PATTERN.fullmatch(text):
                hooks.add(text)
    desc.hooks_used = sorted(hooks)

    # JSX root + props_signature: first export-default function in the
    # source typically returns a single JSX root.
    for node in find_by_type(tree.root_node, "function_declaration"):
        # First parameter list
        for child in node.children:
            if child.type == "formal_parameters":
                desc.props_signature = buf[
                    child.start_byte: child.end_byte
                ].decode("utf-8", errors="replace")
                break
        # First JSX element returned at top of body
        for child in walk(node):
            if child.type in ("jsx_element", "jsx_self_closing_element"):
                # opening_element first child identifier
                opening = (
                    child.children[0] if child.children else None
                )
                if opening is None:
                    continue
                tag_id = next(
                    (c for c in opening.children if c.type == "identifier"),
                    None,
                )
                if tag_id is not None:
                    desc.jsx_root_tag = _identifier_text(tag_id, buf)
                    break
        if desc.jsx_root_tag is not None:
            break

    # State keys referenced via useApp(s => s.key) — best-effort regex.
    # Group 1 = selector parameter, group 2 = state-key name.
    desc.state_keys_referenced = sorted({
        m.group(2)
        for m in re.finditer(
            r"useApp\s*\(\s*([a-zA-Z_$]\w*)\s*=>\s*\1\.(\w+)", source
        )
    })

    return desc


# --------------------------------------------------------------------------- #
# App state inspection — inspect_app_state
# --------------------------------------------------------------------------- #


InspectKind = Literal["pages", "models", "handlers", "state_keys", "components", "all"]


def inspect_app_state(
    kind: InspectKind,
    *,
    backend_config: dict[str, Any] | None = None,
    logic_config: dict[str, Any] | None = None,
    pages: list[dict[str, Any]] | None = None,
    components: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Read-only view of workflow state for the agent.

    Source is the live workflow state bundles, NOT the static-injection
    JSON strings (which can become stale across long agent turns).
    """
    backend_config = backend_config or {}
    logic_config = logic_config or {}
    pages = pages or []
    components = components or {}

    def _pages_view() -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for p in pages:
            comp_names: list[str] = []
            for c in p.get("content", []) or []:
                name = c.get("componentName") if isinstance(c, dict) else None
                if name:
                    comp_names.append(name)
            out.append(
                {
                    "slug": p.get("slug", ""),
                    "title": p.get("title", ""),
                    "uuid": p.get("uuid", ""),
                    "components": comp_names,
                }
            )
        return out

    def _models_view() -> list[dict[str, Any]]:
        models = backend_config.get("models", []) or []
        out: list[dict[str, Any]] = []
        for m in models:
            cols = []
            for c in m.get("columns", []) or []:
                cols.append(
                    {
                        "name": c.get("name", ""),
                        "type": c.get("type", ""),
                        "required": bool(c.get("required", False)),
                    }
                )
            out.append({"name": m.get("name", ""), "columns": cols})
        return out

    def _handlers_view() -> list[dict[str, Any]]:
        handlers = backend_config.get("handlers", []) or []
        out: list[dict[str, Any]] = []
        for h in handlers:
            sig_parts = []
            for inp in h.get("inputs", []) or []:
                if isinstance(inp, dict):
                    sig_parts.append(f"{inp.get('name', '')}: {inp.get('type', '')}")
            out.append(
                {
                    "name": h.get("name", ""),
                    "signature": "(" + ", ".join(sig_parts) + ")",
                    "models_used": h.get("models_used", []) or [],
                }
            )
        return out

    def _state_keys_view() -> list[dict[str, Any]]:
        state_block = (logic_config.get("state") or {}) if isinstance(logic_config, dict) else {}
        out: list[dict[str, Any]] = []
        if isinstance(state_block, dict):
            for key, meta in state_block.items():
                if isinstance(meta, dict):
                    out.append(
                        {
                            "key": key,
                            "type": meta.get("type", ""),
                            "default": meta.get("initial_value", meta.get("default")),
                            "scope": meta.get("scope", "shared"),
                        }
                    )
                else:
                    out.append({"key": key, "default": meta, "type": "", "scope": "shared"})
        return out

    def _components_view() -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        if isinstance(components, dict):
            for name, meta in components.items():
                if isinstance(meta, dict):
                    out.append(
                        {
                            "name": name,
                            "role": meta.get("role", ""),
                            "supporting_modules": meta.get("supporting_modules", []) or [],
                        }
                    )
                else:
                    out.append({"name": name, "role": "", "supporting_modules": []})
        return out

    if kind == "pages":
        return {"pages": _pages_view()}
    if kind == "models":
        return {"models": _models_view()}
    if kind == "handlers":
        return {"handlers": _handlers_view()}
    if kind == "state_keys":
        return {"state_keys": _state_keys_view()}
    if kind == "components":
        return {"components": _components_view()}
    if kind == "all":
        return {
            "pages": _pages_view(),
            "models": _models_view(),
            "handlers": _handlers_view(),
            "state_keys": _state_keys_view(),
            "components": _components_view(),
        }
    return {"error": f"Unknown kind {kind!r}"}
