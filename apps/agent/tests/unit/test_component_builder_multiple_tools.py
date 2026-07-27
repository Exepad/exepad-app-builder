"""Unit tests for the eight ComponentBuilderMultiple FunctionTool wrappers
registered in ``artifact_tools.py``.

Tools covered:
- ``list_artifacts_tool_impl`` (Glob)
- ``search_artifacts_tool_impl`` (Grep)
- ``edit_artifact_tool_impl`` (surgical edit, validated end-to-end)
- ``delete_artifact_tool_impl`` (with importer pre-check)
- ``discover_dependencies_tool_impl``
- ``find_symbol_references_tool_impl``
- ``describe_artifact_tool_impl``
- ``inspect_app_state_tool_impl``

The save tools (`validate_and_save_tsx_*`) and `add_theme_tokens_tool` are
covered by their own pre-existing unit suites.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.artifact_tools import (
    delete_artifact_tool_impl,
    describe_artifact_tool_impl,
    discover_dependencies_tool_impl,
    edit_artifact_tool_impl,
    find_symbol_references_tool_impl,
    inspect_app_state_tool_impl,
    list_artifacts_tool_impl,
    search_artifacts_tool_impl,
)
from main_agent.constants import StateKeys

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


# --------------------------------------------------------------------------- #
# Mock ToolContext that mirrors the surface our impls use:
#   • async list_artifacts() → list[str]
#   • async load_artifact(filename=...) → object with `.inline_data.data`
#   • async save_artifact(filename=..., artifact=...) → version int
#   • async delete_artifact(filename=...) → None
#   • dict-like .state
# --------------------------------------------------------------------------- #


class _InlineData:
    def __init__(self, body: str) -> None:
        self.data = body.encode("utf-8")


class _Artifact:
    def __init__(self, body: str) -> None:
        self.inline_data = _InlineData(body)


class _MockToolContext:
    def __init__(
        self,
        artifacts: dict[str, str] | None = None,
        state: dict | None = None,
    ):
        # Internal artifact store {filename: source_str}
        self._store: dict[str, str] = dict(artifacts or {})
        self.state = state or {}
        self.actions = SimpleNamespace(escalate=False)
        self.agent_name = "ComponentBuilderMultiple"
        # Track delete + save calls for assertions
        self.deleted: list[str] = []
        self.saved: list[tuple[str, str]] = []

    async def list_artifacts(self) -> list[str]:
        return sorted(self._store.keys())

    async def load_artifact(self, filename: str):
        body = self._store.get(filename)
        if body is None:
            return None
        return _Artifact(body)

    async def save_artifact(self, *, filename: str, artifact) -> int:
        body = artifact.inline_data.data.decode("utf-8")
        self._store[filename] = body
        self.saved.append((filename, body))
        return 1

    async def delete_artifact(self, *, filename: str) -> None:
        self._store.pop(filename, None)
        self.deleted.append(filename)


# --------------------------------------------------------------------------- #
# list_artifacts_tool — Glob
# --------------------------------------------------------------------------- #


class TestListArtifactsTool:
    @pytest.fixture
    def ctx(self) -> _MockToolContext:
        return _MockToolContext(
            artifacts={
                "codefocus_component:Hero.tsx": "",
                "codefocus_component:Card.tsx": "",
                "codefocus_module:Charts.tsx": "",
                "codefocus_module:DataLib.tsx": "",
                "codefocus_style:theme.css": "",
                "handler_code:do_thing.tsx": "",
                "backend.json": "",
            }
        )

    async def test_returns_codefocus_glob_sorted(self, ctx):
        result = await list_artifacts_tool_impl(ctx, "codefocus_*")
        assert result["matches"] == [
            "codefocus_component:Card.tsx",
            "codefocus_component:Hero.tsx",
            "codefocus_module:Charts.tsx",
            "codefocus_module:DataLib.tsx",
            "codefocus_style:theme.css",
        ]
        assert result["count"] == 5

    async def test_module_glob(self, ctx):
        result = await list_artifacts_tool_impl(ctx, "codefocus_module:*")
        assert result["count"] == 2
        assert all(m.startswith("codefocus_module:") for m in result["matches"])

    async def test_handler_glob_filtered(self, ctx):
        # Even an explicit handler_code glob returns no rows.
        result = await list_artifacts_tool_impl(ctx, "handler_code:*")
        assert result["matches"] == []

    async def test_backend_artifacts_excluded_from_wildcard(self, ctx):
        result = await list_artifacts_tool_impl(ctx, "*")
        assert "backend.json" not in result["matches"]
        assert "handler_code:do_thing.tsx" not in result["matches"]

    async def test_handles_list_artifacts_failure(self):
        # If the underlying ADK call raises, the tool returns a structured error.
        class _Broken(_MockToolContext):
            async def list_artifacts(self):
                raise RuntimeError("backend down")

        ctx = _Broken()
        result = await list_artifacts_tool_impl(ctx, "codefocus_*")
        assert result["matches"] == []
        assert "backend down" in result["error"]


# --------------------------------------------------------------------------- #
# search_artifacts_tool — Grep
# --------------------------------------------------------------------------- #


class TestSearchArtifactsTool:
    @pytest.fixture
    def ctx(self) -> _MockToolContext:
        return _MockToolContext(
            artifacts={
                "codefocus_component:Hero.tsx": (
                    'import { React, navigate } from "@exepad/sdk";\n'
                    'function Hero() {\n'
                    '  return <button onClick={() => navigate(\'/about\')}>Go</button>;\n'
                    '}\n'
                ),
                "codefocus_module:Card.tsx": "export function Card() {}\n",
                "handler_code:do_thing.tsx": "navigate is referenced here too\n",
            }
        )

    async def test_returns_hits_with_filename_line_offset(self, ctx):
        result = await search_artifacts_tool_impl(ctx, r"navigate\(")
        assert result["count"] == 1
        m = result["matches"][0]
        assert m["filename"] == "codefocus_component:Hero.tsx"
        assert m["line_no"] == 3
        assert "navigate(" in m["line"]
        assert m["byte_offset"] >= 0
        assert result["truncated"] is False

    async def test_excludes_handler_artifacts(self, ctx):
        # The grep MUST NOT cross into handler_code:* even if the regex matches.
        result = await search_artifacts_tool_impl(ctx, "navigate")
        for m in result["matches"]:
            assert not m["filename"].startswith("handler_code:")

    async def test_name_glob_narrows_files(self, ctx):
        result = await search_artifacts_tool_impl(
            ctx, "export", name_glob="codefocus_module:*"
        )
        assert all(m["filename"].startswith("codefocus_module:") for m in result["matches"])

    async def test_invalid_regex_returns_structured_error(self, ctx):
        result = await search_artifacts_tool_impl(ctx, "[unclosed")
        assert result["count"] == 0
        assert "invalid regex" in result["error"]

    async def test_max_results_truncates_and_signals(self):
        ctx = _MockToolContext(
            artifacts={
                f"codefocus_module:m{i}.tsx": "match\nmatch\nmatch\n"
                for i in range(5)
            }
        )
        result = await search_artifacts_tool_impl(ctx, "match", max_results=4)
        assert result["count"] == 4
        assert result["truncated"] is True

    async def test_case_insensitive_flag(self, ctx):
        result = await search_artifacts_tool_impl(ctx, "HERO", flags=["i"])
        assert result["count"] >= 1


# --------------------------------------------------------------------------- #
# discover_dependencies_tool
# --------------------------------------------------------------------------- #


class TestDiscoverDependenciesTool:
    @pytest.fixture
    def ctx(self) -> _MockToolContext:
        return _MockToolContext(
            artifacts={
                "codefocus_module:Card.tsx": (
                    'export function Card({ label }) { return <div>{label}</div>; }\n'
                ),
                "codefocus_component:Hero.tsx": (
                    'import { Card } from "./Card";\n'
                    'export default function Hero() { return <Card />; }\n'
                ),
                "codefocus_component:Dashboard.tsx": (
                    'import { Card } from "./Card";\n'
                    'export default function Dashboard() { return <Card />; }\n'
                ),
            }
        )

    async def test_imports_for_specific_file(self, ctx):
        result = await discover_dependencies_tool_impl(
            ctx,
            file_names=["codefocus_component:Hero.tsx"],
            direction="imports",
        )
        graph = result["graph"]
        assert "imports" in graph["codefocus_component:Hero.tsx"]
        assert graph["codefocus_component:Hero.tsx"]["imports"] == [
            "codefocus_module:Card.tsx"
        ]

    async def test_imported_by_finds_all_callers(self, ctx):
        result = await discover_dependencies_tool_impl(
            ctx,
            file_names=["codefocus_module:Card.tsx"],
            direction="imported_by",
        )
        importers = result["graph"]["codefocus_module:Card.tsx"]["imported_by"]
        assert importers == [
            "codefocus_component:Dashboard.tsx",
            "codefocus_component:Hero.tsx",
        ]

    async def test_invalid_direction_returns_error(self, ctx):
        result = await discover_dependencies_tool_impl(
            ctx, file_names=["codefocus_module:Card.tsx"], direction="upward"
        )
        assert "error" in result

    async def test_transitive_walks_chain(self):
        ctx = _MockToolContext(
            artifacts={
                "codefocus_module:C.tsx": "export const x = 1;\n",
                "codefocus_module:B.tsx": (
                    'import { x } from "./C";\nexport const y = x;\n'
                ),
                "codefocus_module:A.tsx": (
                    'import { y } from "./B";\nexport const z = y;\n'
                ),
            }
        )
        result = await discover_dependencies_tool_impl(
            ctx,
            file_names=["codefocus_module:A.tsx"],
            direction="imports",
            transitive=True,
        )
        imports = result["graph"]["codefocus_module:A.tsx"]["imports"]
        assert "codefocus_module:B.tsx" in imports
        assert "codefocus_module:C.tsx" in imports


# --------------------------------------------------------------------------- #
# find_symbol_references_tool
# --------------------------------------------------------------------------- #


class TestFindSymbolReferencesTool:
    @pytest.fixture
    def ctx(self) -> _MockToolContext:
        return _MockToolContext(
            artifacts={
                "codefocus_module:Card.tsx": (
                    'export function Card({ label }) { return <div>{label}</div>; }\n'
                ),
                "codefocus_component:Hero.tsx": (
                    'import { Card } from "./Card";\n'
                    'export default function Hero() {\n'
                    '  return <Card label="hi" />;\n'
                    '}\n'
                ),
            }
        )

    async def test_returns_classified_hits(self, ctx):
        result = await find_symbol_references_tool_impl(ctx, "Card")
        kinds = {m["kind"] for m in result["matches"]}
        assert "import" in kinds
        assert "jsx_element" in kinds
        assert "declaration" in kinds

    async def test_kind_filter_jsx_element_only(self, ctx):
        result = await find_symbol_references_tool_impl(
            ctx, "Card", kinds=["jsx_element"]
        )
        assert result["count"] >= 1
        assert all(m["kind"] == "jsx_element" for m in result["matches"])

    async def test_empty_symbol_returns_error(self, ctx):
        result = await find_symbol_references_tool_impl(ctx, "")
        assert result["count"] == 0
        assert "error" in result

    async def test_no_match_returns_empty(self, ctx):
        result = await find_symbol_references_tool_impl(ctx, "DoesNotExist")
        assert result["count"] == 0
        assert result["matches"] == []


# --------------------------------------------------------------------------- #
# describe_artifact_tool
# --------------------------------------------------------------------------- #


class TestDescribeArtifactTool:
    @pytest.fixture
    def ctx(self) -> _MockToolContext:
        return _MockToolContext(
            artifacts={
                "codefocus_component:Hero.tsx": (
                    'import { React, useState } from "@exepad/sdk";\n'
                    'import { Card } from "./Card";\n'
                    'export default function Hero({ title }) {\n'
                    '  const [x, setX] = useState(0);\n'
                    '  return <LightDOMContainer><Card /></LightDOMContainer>;\n'
                    '}\n'
                ),
            }
        )

    async def test_returns_full_summary(self, ctx):
        result = await describe_artifact_tool_impl(
            ctx, "codefocus_component:Hero.tsx"
        )
        assert "Hero" in result["exports"]
        assert any(imp["from"] == "@exepad/sdk" for imp in result["imports"])
        assert any(imp["from"] == "./Card" for imp in result["imports"])
        assert "useState" in result["hooks_used"]
        assert result["jsx_root_tag"] == "LightDOMContainer"
        assert result["lines"] >= 5
        assert result["bytes"] > 0

    async def test_rejects_handler_artifact(self, ctx):
        result = await describe_artifact_tool_impl(ctx, "handler_code:foo.tsx")
        assert "error" in result
        assert "frontend" in result["error"]

    async def test_rejects_missing_file(self, ctx):
        result = await describe_artifact_tool_impl(
            ctx, "codefocus_component:DoesNotExist.tsx"
        )
        assert "error" in result
        assert "not found" in result["error"]


# --------------------------------------------------------------------------- #
# inspect_app_state_tool
# --------------------------------------------------------------------------- #


class TestInspectAppStateTool:
    @pytest.fixture
    def ctx(self) -> _MockToolContext:
        state = {
            "_validation_context_models": [
                {
                    "name": "students",
                    "columns": [{"name": "id", "type": "number", "required": True}],
                }
            ],
            "_validation_context_handlers": [
                {"name": "get_students", "inputs": []}
            ],
            "_validation_context_logic": {
                "state": {
                    "modalOpen": {
                        "type": "boolean",
                        "initial_value": False,
                    }
                }
            },
            "_validation_context_page_slugs": ["/", "/students"],
            StateKeys.APP_CONFIG: {
                "repo": {
                    "frontend": {
                        "pages": [
                            {
                                "uuid": "page-1",
                                "slug": "/students",
                                "title": "Students",
                                "content": [{"componentName": "StudentsContent"}],
                            }
                        ],
                        "components": {
                            "StudentsContent": {
                                "role": "content",
                                "supporting_modules": ["DataLib"],
                            }
                        },
                    }
                }
            },
        }
        return _MockToolContext(state=state)

    async def test_kind_models(self, ctx):
        result = await inspect_app_state_tool_impl(ctx, kind="models")
        assert result["models"][0]["name"] == "students"

    async def test_kind_handlers(self, ctx):
        result = await inspect_app_state_tool_impl(ctx, kind="handlers")
        assert result["handlers"][0]["name"] == "get_students"

    async def test_kind_state_keys(self, ctx):
        result = await inspect_app_state_tool_impl(ctx, kind="state_keys")
        keys = result["state_keys"]
        assert any(k["key"] == "modalOpen" for k in keys)

    async def test_kind_pages_uses_app_config(self, ctx):
        result = await inspect_app_state_tool_impl(ctx, kind="pages")
        assert result["pages"][0]["slug"] == "/students"
        assert result["pages"][0]["title"] == "Students"
        assert result["pages"][0]["components"] == ["StudentsContent"]

    async def test_kind_components_uses_app_config(self, ctx):
        result = await inspect_app_state_tool_impl(ctx, kind="components")
        comps = result["components"]
        assert any(c["name"] == "StudentsContent" for c in comps)

    async def test_kind_all_aggregates(self, ctx):
        result = await inspect_app_state_tool_impl(ctx, kind="all")
        assert set(result.keys()) >= {
            "pages",
            "models",
            "handlers",
            "state_keys",
            "components",
        }

    async def test_unknown_kind_returns_error(self, ctx):
        result = await inspect_app_state_tool_impl(ctx, kind="bogus")
        assert "error" in result


# --------------------------------------------------------------------------- #
# edit_artifact_tool
# --------------------------------------------------------------------------- #


_SIMPLE_COMPONENT_TSX = (
    'import { React, LightDOMContainer } from "@exepad/sdk";\n'
    'function Hero() {\n'
    '  return <LightDOMContainer><div className="p-8">Hello</div></LightDOMContainer>;\n'
    '}\n'
    'export default Hero;\n'
)


class TestEditArtifactTool:
    async def test_rejects_handler_prefix(self):
        ctx = _MockToolContext()
        result = await edit_artifact_tool_impl(
            ctx,
            filename="handler_code:foo.tsx",
            old_string="x",
            new_string="y",
        )
        assert result["ok"] is False
        assert "edit_artifact only writes frontend" in result["error"]

    async def test_rejects_theme_css_prefix(self):
        ctx = _MockToolContext()
        result = await edit_artifact_tool_impl(
            ctx,
            filename="codefocus_style:theme.css",
            old_string="x",
            new_string="y",
        )
        assert result["ok"] is False
        assert "add_theme_tokens" in result["error"]

    async def test_rejects_missing_file(self):
        ctx = _MockToolContext()
        result = await edit_artifact_tool_impl(
            ctx,
            filename="codefocus_component:DoesNotExist.tsx",
            old_string="x",
            new_string="y",
        )
        assert result["ok"] is False
        assert "not found" in result["error"]

    async def test_rejects_non_unique_match(self):
        ctx = _MockToolContext(
            artifacts={"codefocus_module:M.tsx": "label, label, label"}
        )
        result = await edit_artifact_tool_impl(
            ctx,
            filename="codefocus_module:M.tsx",
            old_string="label",
            new_string="title",
        )
        assert result["ok"] is False
        assert "matched 3 times" in result["error"]

    async def test_replace_all_succeeds_through_validation(self, monkeypatch):
        # Stub the validation chain so we don't depend on esbuild / tsc being
        # on PATH for a unit test. The tool's job here is the splice +
        # delegation contract.
        from main_agent.agents.orchestrator.app_types.webapp.subagents import (
            artifact_tools,
        )

        async def _fake_save(
            tool_context, code, name, *, artifact_prefix, enforce_default_export
        ):
            # Sanity: we receive the spliced code, not the original.
            assert "newlabel" in code
            return {
                "success": True,
                "artifact_filename": f"{artifact_prefix}{name}.tsx",
                "version": 1,
                "checks_passed": ["syntax"],
            }

        monkeypatch.setattr(
            artifact_tools, "_validate_and_save_tsx_artifact_impl", _fake_save
        )

        ctx = _MockToolContext(
            artifacts={"codefocus_module:M.tsx": "label, label, label"}
        )
        result = await edit_artifact_tool_impl(
            ctx,
            filename="codefocus_module:M.tsx",
            old_string="label",
            new_string="newlabel",
            replace_all=True,
        )
        assert result["ok"] is True
        assert result["edits_applied"] == 3
        assert result["filename"] == "codefocus_module:M.tsx"

    async def test_validation_failure_propagates_error(self, monkeypatch):
        from main_agent.agents.orchestrator.app_types.webapp.subagents import (
            artifact_tools,
        )

        async def _fake_save(*args, **kwargs):
            return {"success": False, "error": "Syntax errors — fix and retry"}

        monkeypatch.setattr(
            artifact_tools, "_validate_and_save_tsx_artifact_impl", _fake_save
        )

        ctx = _MockToolContext(
            artifacts={"codefocus_component:Hero.tsx": _SIMPLE_COMPONENT_TSX}
        )
        result = await edit_artifact_tool_impl(
            ctx,
            filename="codefocus_component:Hero.tsx",
            old_string="Hello",
            new_string="World",
        )
        assert result["ok"] is False
        assert "Syntax errors" in result["error"]
        assert result["edits_applied"] == 0


# --------------------------------------------------------------------------- #
# delete_artifact_tool
# --------------------------------------------------------------------------- #


class TestDeleteArtifactTool:
    async def test_rejects_handler_prefix(self):
        ctx = _MockToolContext()
        result = await delete_artifact_tool_impl(
            ctx, filename="handler_code:do_thing.tsx", reason="dead code"
        )
        assert result["deleted"] is False
        assert "RemoveHandlerAction" in result["error"]

    async def test_rejects_theme_css_prefix(self):
        ctx = _MockToolContext()
        result = await delete_artifact_tool_impl(
            ctx, filename="codefocus_style:theme.css", reason="x"
        )
        assert result["deleted"] is False
        assert "ModifyStylesAction" in result["error"]

    async def test_rejects_missing_artifact(self):
        ctx = _MockToolContext(
            artifacts={"codefocus_module:Other.tsx": "export const x = 1;"}
        )
        result = await delete_artifact_tool_impl(
            ctx,
            filename="codefocus_module:Ghost.tsx",
            reason="cleanup",
        )
        assert result["deleted"] is False
        assert "not found" in result["error"]

    async def test_blocks_when_importer_remains(self):
        ctx = _MockToolContext(
            artifacts={
                "codefocus_module:Card.tsx": "export function Card() {}\n",
                "codefocus_component:Hero.tsx": (
                    'import { Card } from "./Card";\n'
                    'export default function Hero() {}\n'
                ),
            }
        )
        result = await delete_artifact_tool_impl(
            ctx, filename="codefocus_module:Card.tsx", reason="cleanup"
        )
        assert result["deleted"] is False
        assert "still imported" in result["error"]
        assert "codefocus_component:Hero.tsx" in result["importers"]
        # Artifact was NOT deleted from storage.
        assert "codefocus_module:Card.tsx" in ctx._store

    async def test_allows_delete_when_importer_also_in_delete_set(self):
        ctx = _MockToolContext(
            artifacts={
                "codefocus_module:Card.tsx": "export function Card() {}\n",
                "codefocus_component:Hero.tsx": (
                    'import { Card } from "./Card";\n'
                    'export default function Hero() {}\n'
                ),
            },
            state={"_files_deleted_this_turn": ["codefocus_component:Hero.tsx"]},
        )
        result = await delete_artifact_tool_impl(
            ctx, filename="codefocus_module:Card.tsx", reason="cleanup"
        )
        assert result["deleted"] is True
        assert result["filename"] == "codefocus_module:Card.tsx"
        # Storage was actually cleared.
        assert "codefocus_module:Card.tsx" not in ctx._store
        assert "codefocus_module:Card.tsx" in ctx.deleted

    async def test_records_deletion_in_files_deleted_this_turn(self):
        ctx = _MockToolContext(
            artifacts={"codefocus_module:Orphan.tsx": "export const x = 1;\n"}
        )
        result = await delete_artifact_tool_impl(
            ctx, filename="codefocus_module:Orphan.tsx", reason="dead"
        )
        assert result["deleted"] is True
        assert (
            "codefocus_module:Orphan.tsx"
            in ctx.state.get("_files_deleted_this_turn", [])
        )

    async def test_drops_sibling_modules_entry_after_delete(self):
        ctx = _MockToolContext(
            artifacts={"codefocus_module:Tile.tsx": "export const x = 1;\n"},
            state={
                "_codefocus_sibling_modules": {
                    "Tile": "export const x = 1;\n",
                    "Other": "export const y = 2;\n",
                }
            },
        )
        result = await delete_artifact_tool_impl(
            ctx, filename="codefocus_module:Tile.tsx", reason="dead"
        )
        assert result["deleted"] is True
        siblings = ctx.state["_codefocus_sibling_modules"]
        assert "Tile" not in siblings
        # Unrelated entries survive
        assert "Other" in siblings

    async def test_orphan_module_with_no_importers_deletes(self):
        ctx = _MockToolContext(
            artifacts={"codefocus_module:Orphan.tsx": "export const x = 1;\n"}
        )
        result = await delete_artifact_tool_impl(
            ctx, filename="codefocus_module:Orphan.tsx", reason="dead"
        )
        assert result["deleted"] is True
