"""Unit tests for `main_agent.services.dependency_graph`.

Covers four ComponentBuilderMultiple code-intelligence primitives:
- ``build_dependency_graph`` — AST-based import graph + transitive closure
- ``find_symbol_references`` — TSX-aware symbol classifier
- ``describe_artifact`` — cheap structural summary
- ``inspect_app_state`` — read-only workflow-state view
"""

from __future__ import annotations

import pytest

from main_agent.services.dependency_graph import (
    SymbolHit,
    build_dependency_graph,
    describe_artifact,
    find_symbol_references,
    inspect_app_state,
)

pytestmark = [pytest.mark.unit]


# --------------------------------------------------------------------------- #
# build_dependency_graph
# --------------------------------------------------------------------------- #


class TestBuildDependencyGraph:
    @pytest.fixture
    def basic_sources(self) -> dict[str, str]:
        return {
            "codefocus_module:Card.tsx": (
                'export function Card({ label }) { return <div>{label}</div>; }\n'
            ),
            "codefocus_module:DataLib.tsx": (
                'export const STUDENTS = [];\n'
                'export function fmt(x) { return String(x); }\n'
            ),
            "codefocus_component:Hero.tsx": (
                'import { React } from "@exepad/sdk";\n'
                'import { Card } from "./Card";\n'
                'export default function Hero() { return <Card label="hi" />; }\n'
            ),
            "codefocus_component:Dashboard.tsx": (
                'import { Card } from "./Card";\n'
                'import { STUDENTS, fmt } from "./DataLib";\n'
                'export default function Dashboard() { return null; }\n'
            ),
        }

    def test_imports_resolved_to_artifact_names(self, basic_sources):
        g = build_dependency_graph(basic_sources)
        hero = g["codefocus_component:Hero.tsx"]
        assert hero["imports"] == ["codefocus_module:Card.tsx"]
        # Bare specifiers like "@exepad/sdk" are NOT in the graph (unresolvable).
        assert "@exepad/sdk" not in str(hero)

    def test_imported_by_inverse_is_correct(self, basic_sources):
        g = build_dependency_graph(basic_sources)
        card_imported_by = g["codefocus_module:Card.tsx"]["imported_by"]
        assert card_imported_by == [
            "codefocus_component:Dashboard.tsx",
            "codefocus_component:Hero.tsx",
        ]

    def test_direction_imports_only(self, basic_sources):
        g = build_dependency_graph(
            basic_sources,
            file_names=["codefocus_component:Hero.tsx"],
            direction="imports",
        )
        entry = g["codefocus_component:Hero.tsx"]
        assert "imports" in entry
        assert "imported_by" not in entry

    def test_direction_imported_by_only(self, basic_sources):
        g = build_dependency_graph(
            basic_sources,
            file_names=["codefocus_module:Card.tsx"],
            direction="imported_by",
        )
        entry = g["codefocus_module:Card.tsx"]
        assert "imported_by" in entry
        assert "imports" not in entry

    def test_transitive_closure(self):
        # A imports B, B imports C → A's transitive imports include both.
        sources = {
            "codefocus_module:C.tsx": "export const x = 1;\n",
            "codefocus_module:B.tsx": (
                'import { x } from "./C";\nexport const y = x;\n'
            ),
            "codefocus_module:A.tsx": (
                'import { y } from "./B";\nexport const z = y;\n'
            ),
        }
        g = build_dependency_graph(
            sources, file_names=["codefocus_module:A.tsx"], transitive=True
        )
        imports = g["codefocus_module:A.tsx"]["imports"]
        assert "codefocus_module:B.tsx" in imports
        assert "codefocus_module:C.tsx" in imports

    def test_self_import_does_not_create_cycle(self):
        # Pathological: a file imports itself. Should not blow up.
        sources = {
            "codefocus_module:Loop.tsx": (
                'import { foo } from "./Loop";\nexport const foo = 1;\n'
            ),
        }
        g = build_dependency_graph(sources)
        # Self-import is filtered out.
        assert "codefocus_module:Loop.tsx" not in g["codefocus_module:Loop.tsx"][
            "imports"
        ]

    def test_cycle_handled_in_transitive(self):
        # A → B → A
        sources = {
            "codefocus_module:A.tsx": (
                'import { b } from "./B";\nexport const a = 1;\n'
            ),
            "codefocus_module:B.tsx": (
                'import { a } from "./A";\nexport const b = 1;\n'
            ),
        }
        g = build_dependency_graph(
            sources, file_names=["codefocus_module:A.tsx"], transitive=True
        )
        imports = g["codefocus_module:A.tsx"]["imports"]
        # Both A and B reachable; cycle terminates without infinite loop.
        assert "codefocus_module:B.tsx" in imports

    def test_excludes_handler_code_artifacts(self):
        sources = {
            "codefocus_component:Hero.tsx": (
                'import { foo } from "./bar";\nexport default function Hero() {}\n'
            ),
            "handler_code:do_thing.tsx": (
                'export default function do_thing() {}\n'
            ),
        }
        g = build_dependency_graph(sources)
        assert "handler_code:do_thing.tsx" not in g

    def test_unresolvable_bare_specifiers_skipped(self):
        sources = {
            "codefocus_component:X.tsx": (
                'import { React } from "@exepad/sdk";\n'
                'import lodash from "lodash";\n'
                'export default function X() {}\n'
            ),
        }
        g = build_dependency_graph(sources)
        assert g["codefocus_component:X.tsx"]["imports"] == []

    def test_file_names_filter_returns_only_requested(self, basic_sources):
        g = build_dependency_graph(
            basic_sources, file_names=["codefocus_module:Card.tsx"]
        )
        # Only Card is returned even though the graph spans more files.
        assert set(g.keys()) == {"codefocus_module:Card.tsx"}

    def test_unknown_file_in_filter_returns_empty_entry(self, basic_sources):
        g = build_dependency_graph(
            basic_sources, file_names=["codefocus_module:DoesNotExist.tsx"]
        )
        assert g == {
            "codefocus_module:DoesNotExist.tsx": {"imports": [], "imported_by": []}
        }

    def test_empty_sources(self):
        assert build_dependency_graph({}) == {}


# --------------------------------------------------------------------------- #
# find_symbol_references
# --------------------------------------------------------------------------- #


class TestFindSymbolReferences:
    @pytest.fixture
    def sources(self) -> dict[str, str]:
        return {
            "codefocus_module:Card.tsx": (
                'export function Card({ label }) {\n'
                '  return <div>{label}</div>;\n'
                '}\n'
            ),
            "codefocus_component:Hero.tsx": (
                'import { React } from "@exepad/sdk";\n'
                'import { Card } from "./Card";\n'
                'export default function Hero() {\n'
                '  // Card is also mentioned in this comment\n'
                '  const x = "Card in a string literal";\n'
                '  const wrapped = Card;\n'
                '  return <Card label="hi" />;\n'
                '}\n'
            ),
        }

    def test_classifies_import_declaration_reference_jsx(self, sources):
        hits = find_symbol_references("Card", sources)
        kinds_by_file = {}
        for h in hits:
            kinds_by_file.setdefault(h.filename, set()).add(h.kind)

        assert "import" in kinds_by_file["codefocus_component:Hero.tsx"]
        assert "jsx_element" in kinds_by_file["codefocus_component:Hero.tsx"]
        assert "reference" in kinds_by_file["codefocus_component:Hero.tsx"]
        assert "declaration" in kinds_by_file["codefocus_module:Card.tsx"]

    def test_does_not_match_inside_string_literals(self, sources):
        hits = find_symbol_references("Card", sources)
        # The string literal "Card in a string literal" must NOT be reported
        # — it isn't an `identifier` AST node.
        for h in hits:
            assert "string literal" not in h.context_snippet, (
                f"matched inside string: {h.context_snippet}"
            )

    def test_does_not_match_inside_comments(self, sources):
        hits = find_symbol_references("Card", sources)
        for h in hits:
            assert not h.context_snippet.lstrip().startswith("//"), (
                f"matched inside comment: {h.context_snippet}"
            )

    def test_kind_filter_narrows_results(self, sources):
        hits = find_symbol_references("Card", sources, kinds=["jsx_element"])
        assert hits, "should find at least one JSX element"
        assert all(h.kind == "jsx_element" for h in hits)

    def test_kind_filter_imports_only(self, sources):
        hits = find_symbol_references("Card", sources, kinds=["import"])
        assert all(h.kind == "import" for h in hits)
        assert all(h.filename == "codefocus_component:Hero.tsx" for h in hits)

    def test_name_glob_narrows_search(self, sources):
        hits = find_symbol_references("Card", sources, name_glob="codefocus_module:*")
        assert all(h.filename.startswith("codefocus_module:") for h in hits)

    def test_no_matches_returns_empty(self, sources):
        hits = find_symbol_references("DoesNotExist", sources)
        assert hits == []

    def test_byte_offset_round_trips(self, sources):
        hits = find_symbol_references("Card", sources, kinds=["import"])
        assert hits
        h = hits[0]
        src = sources[h.filename]
        # The byte offset should sit at the start of the identifier "Card".
        assert src[h.byte_offset: h.byte_offset + 4] == "Card"

    def test_excludes_handler_code_artifacts(self):
        sources = {
            "handler_code:do_thing.tsx": (
                'export default function do_thing() { const Card = 1; return Card; }\n'
            ),
        }
        hits = find_symbol_references("Card", sources)
        assert hits == []

    def test_empty_symbol_returns_empty(self, sources):
        # Defensive — caller wraps this at the FunctionTool layer, but the
        # service shouldn't blow up on an empty symbol either.
        hits = find_symbol_references("", sources)
        assert hits == []


# --------------------------------------------------------------------------- #
# describe_artifact
# --------------------------------------------------------------------------- #


class TestDescribeArtifact:
    def test_extracts_exports_from_default_function(self):
        src = (
            'import { React } from "@exepad/sdk";\n'
            'export default function Hero() { return <div />; }\n'
        )
        d = describe_artifact("codefocus_component:Hero.tsx", src)
        assert "Hero" in d.exports

    def test_extracts_named_exports(self):
        src = (
            'export function Card() {}\n'
            'export const Tile = 1;\n'
            'export class DataStore {}\n'
        )
        d = describe_artifact("codefocus_module:Card.tsx", src)
        assert set(d.exports) >= {"Card", "Tile", "DataStore"}

    def test_extracts_imports_with_specifiers(self):
        src = (
            'import { React, navigate } from "@exepad/sdk";\n'
            'import { Card } from "./Card";\n'
            'export default function Hero() {}\n'
        )
        d = describe_artifact("codefocus_component:Hero.tsx", src)
        froms = [imp["from"] for imp in d.imports]
        assert "@exepad/sdk" in froms
        assert "./Card" in froms
        sdk_specs = next(imp for imp in d.imports if imp["from"] == "@exepad/sdk")
        assert "React" in sdk_specs["names"]
        assert "navigate" in sdk_specs["names"]

    def test_extracts_hooks(self):
        src = (
            'import { useState, useApp, useModel } from "@exepad/sdk";\n'
            'export default function Hero() {\n'
            '  const [x, setX] = useState(0);\n'
            '  const data = useModel("students");\n'
            '  return null;\n'
            '}\n'
        )
        d = describe_artifact("codefocus_component:Hero.tsx", src)
        assert "useState" in d.hooks_used
        assert "useModel" in d.hooks_used

    def test_extracts_jsx_root_tag(self):
        src = (
            'export default function Hero() {\n'
            '  return <LightDOMContainer><div /></LightDOMContainer>;\n'
            '}\n'
        )
        d = describe_artifact("codefocus_component:Hero.tsx", src)
        assert d.jsx_root_tag == "LightDOMContainer"

    def test_extracts_props_signature(self):
        src = (
            'export default function Hero({ title, count }) {\n'
            '  return <div />;\n'
            '}\n'
        )
        d = describe_artifact("codefocus_component:Hero.tsx", src)
        assert d.props_signature is not None
        assert "title" in d.props_signature
        assert "count" in d.props_signature

    def test_extracts_state_keys_via_useapp(self):
        src = (
            'import { useApp } from "@exepad/sdk";\n'
            'export default function Hero() {\n'
            '  const open = useApp(s => s.modalOpen);\n'
            '  const tab = useApp(s => s.activeTab);\n'
            '  return null;\n'
            '}\n'
        )
        d = describe_artifact("codefocus_component:Hero.tsx", src)
        assert "modalOpen" in d.state_keys_referenced
        assert "activeTab" in d.state_keys_referenced

    def test_lines_and_bytes_set(self):
        src = "a\nb\nc\n"
        d = describe_artifact("codefocus_module:Tiny.tsx", src)
        assert d.lines >= 3
        assert d.bytes == len(src.encode("utf-8"))

    def test_empty_source_returns_minimal_description(self):
        d = describe_artifact("codefocus_module:Empty.tsx", "")
        assert d.exports == []
        assert d.imports == []
        assert d.hooks_used == []
        assert d.jsx_root_tag is None

    def test_unparseable_source_does_not_raise(self):
        # Tree-sitter is forgiving but malformed input shouldn't crash here.
        src = "this is not valid tsx {{{\n"
        d = describe_artifact("codefocus_module:Bad.tsx", src)
        assert d.bytes == len(src.encode("utf-8"))


# --------------------------------------------------------------------------- #
# inspect_app_state
# --------------------------------------------------------------------------- #


class TestInspectAppState:
    @pytest.fixture
    def fixture_state(self):
        return {
            "backend_config": {
                "models": [
                    {
                        "name": "students",
                        "columns": [
                            {"name": "id", "type": "number", "required": True},
                            {"name": "grade", "type": "number", "required": False},
                        ],
                    }
                ],
                "handlers": [
                    {
                        "name": "get_students",
                        "inputs": [{"name": "limit", "type": "number"}],
                        "models_used": ["students"],
                    }
                ],
            },
            "logic_config": {
                "state": {
                    "modalOpen": {
                        "type": "boolean",
                        "initial_value": False,
                        "scope": "shared",
                    }
                }
            },
            "pages": [
                {
                    "uuid": "page-1",
                    "slug": "/students",
                    "title": "Students",
                    "content": [
                        {"componentName": "StudentsContent"},
                        {"componentName": "StudentsHeader"},
                    ],
                }
            ],
            "components": {
                "StudentsContent": {
                    "role": "content",
                    "supporting_modules": ["DataLib", "Charts"],
                }
            },
        }

    def test_kind_pages(self, fixture_state):
        result = inspect_app_state(kind="pages", **fixture_state)
        assert "pages" in result
        assert result["pages"] == [
            {
                "slug": "/students",
                "title": "Students",
                "uuid": "page-1",
                "components": ["StudentsContent", "StudentsHeader"],
            }
        ]

    def test_kind_models(self, fixture_state):
        result = inspect_app_state(kind="models", **fixture_state)
        models = result["models"]
        assert len(models) == 1
        assert models[0]["name"] == "students"
        assert models[0]["columns"] == [
            {"name": "id", "type": "number", "required": True},
            {"name": "grade", "type": "number", "required": False},
        ]

    def test_kind_handlers(self, fixture_state):
        result = inspect_app_state(kind="handlers", **fixture_state)
        handlers = result["handlers"]
        assert len(handlers) == 1
        h = handlers[0]
        assert h["name"] == "get_students"
        assert "limit" in h["signature"]
        assert h["models_used"] == ["students"]

    def test_kind_state_keys(self, fixture_state):
        result = inspect_app_state(kind="state_keys", **fixture_state)
        keys = result["state_keys"]
        assert any(k["key"] == "modalOpen" for k in keys)
        modal_open = next(k for k in keys if k["key"] == "modalOpen")
        assert modal_open["type"] == "boolean"
        assert modal_open["default"] is False

    def test_kind_components(self, fixture_state):
        result = inspect_app_state(kind="components", **fixture_state)
        comps = result["components"]
        assert any(c["name"] == "StudentsContent" for c in comps)
        sc = next(c for c in comps if c["name"] == "StudentsContent")
        assert sc["role"] == "content"
        assert sc["supporting_modules"] == ["DataLib", "Charts"]

    def test_kind_all_aggregates(self, fixture_state):
        result = inspect_app_state(kind="all", **fixture_state)
        assert set(result.keys()) >= {
            "pages",
            "models",
            "handlers",
            "state_keys",
            "components",
        }

    def test_kind_unknown_returns_error(self):
        result = inspect_app_state(kind="bogus")  # type: ignore[arg-type]
        assert "error" in result

    def test_empty_inputs_return_empty_lists(self):
        result = inspect_app_state(
            kind="all",
            backend_config={},
            logic_config={},
            pages=[],
            components={},
        )
        assert result["pages"] == []
        assert result["models"] == []
        assert result["handlers"] == []
        assert result["state_keys"] == []
        assert result["components"] == []

    def test_no_args_returns_empty_lists(self):
        # Defensive default — every call site optionally passes context.
        result = inspect_app_state(kind="all")
        assert result == {
            "pages": [],
            "models": [],
            "handlers": [],
            "state_keys": [],
            "components": [],
        }
