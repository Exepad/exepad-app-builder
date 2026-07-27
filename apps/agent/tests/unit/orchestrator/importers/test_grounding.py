"""Tests for design-import metadata grounding (Phase 2.1 + 2.2 + 3.2)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from main_agent.agents.orchestrator.importers.grounding import (
    _first_proper_noun_phrase,
    _is_placeholder_shape,
    _name_appears_in_source,
    _pascal_case,
    _split_into_chunks,
    _strip_generic_title_suffix,
    ground_design_import_metadata,
)
from main_agent.constants import StateKeys

pytestmark = [pytest.mark.unit]


# ── Placeholder detection ────────────────────────────────────────────


def test_placeholder_shape_detects_vid_suffix():
    assert _is_placeholder_shape("InToTheHobby_Main_vId")
    assert _is_placeholder_shape("Foo_vId")
    assert _is_placeholder_shape("App_v3_TBD_x")


def test_placeholder_shape_detects_v_digit_pattern():
    assert _is_placeholder_shape("App_v2_template")
    assert _is_placeholder_shape("Page_v1")


def test_placeholder_shape_detects_main_substring():
    assert _is_placeholder_shape("MyApp_Main_v")


def test_placeholder_shape_detects_many_underscores():
    assert _is_placeholder_shape("a_b_c_d")  # 3+ underscores


def test_placeholder_shape_rejects_normal_names():
    assert not _is_placeholder_shape("Ashford Day School Dashboard")
    assert not _is_placeholder_shape("Taskflow")
    assert not _is_placeholder_shape("Happy Doods Farm")
    assert not _is_placeholder_shape("Onix Studio")


def test_placeholder_shape_rejects_two_word_underscored():
    # Up to 2 underscores is fine — many real names have one.
    assert not _is_placeholder_shape("happy_doods")
    assert not _is_placeholder_shape("foo_bar_baz")  # exactly 2


# ── Name grounding (does it appear in source?) ───────────────────────


def test_name_appears_in_source_via_chunks():
    # "InToTheHobby" splits to ['In','To','The','Hobby']; "Hobby" matches.
    assert _name_appears_in_source(
        "InToTheHobby", "An app for sharing your hobby projects."
    )


def test_name_does_not_appear_in_source():
    # School dashboard content; "InToTheHobby" splits don't match.
    assert not _name_appears_in_source(
        "InToTheHobby", "Ashford Day School administrative hub."
    )


def test_name_appears_in_source_skips_short_chunks():
    # Single-letter and 2-letter chunks ignored.
    assert not _name_appears_in_source("A_To", "to a from at")


# ── Helpers ──────────────────────────────────────────────────────────


def test_split_into_chunks_handles_camel_and_underscore():
    assert _split_into_chunks("InToTheHobby_Main") == [
        "In", "To", "The", "Hobby", "Main",
    ]
    assert _split_into_chunks("DashboardOverview") == ["Dashboard", "Overview"]
    assert _split_into_chunks("foo_bar") == ["foo", "bar"]


def test_strip_generic_title_suffix_drops_overview():
    assert _strip_generic_title_suffix("Dashboard Overview") == "Dashboard"
    assert _strip_generic_title_suffix("Settings Page") == "Settings"
    assert _strip_generic_title_suffix("Main View") == "Main"


def test_strip_generic_title_suffix_keeps_meaningful_titles():
    assert _strip_generic_title_suffix("Ashford Day School") == "Ashford Day School"
    assert _strip_generic_title_suffix("Dashboard") == "Dashboard"  # single word


def test_first_proper_noun_phrase_extracts_brand():
    text = "The main administrative hub for Ashford Day School Dashboard"
    assert _first_proper_noun_phrase(text) == "Ashford Day School Dashboard"


def test_first_proper_noun_phrase_returns_empty_when_none():
    assert _first_proper_noun_phrase("just lowercase text here") == ""


def test_pascal_case_basic():
    assert _pascal_case("Dashboard Overview") == "DashboardOverview"
    assert _pascal_case("ashford day school") == "AshfordDaySchool"


# ── Integration: ground_design_import_metadata ────────────────────────


async def test_app_name_reseeded_when_placeholder():
    creator_plan = {
        "app_name": "InToTheHobby_Main_vId",
        "component_plans": [
            {
                "name": "PostFeed",
                "role": "content",
                "page_slug": "/",
                "page_title": "Dashboard Overview",
                "page_summary": (
                    "The main administrative hub for Ashford Day School, "
                    "providing key performance indicators ..."
                ),
            },
        ],
    }
    bundle_digest = {
        "brand_name": "Ashford Day School",
        "domain_hints": "school dashboard students classes",
    }
    await ground_design_import_metadata(
        None, creator_plan, bundle_digest=bundle_digest
    )
    assert creator_plan["app_name"] == "Ashford Day School"


async def test_app_name_reseeded_from_page_title_when_no_brand():
    creator_plan = {
        "app_name": "App_v3_TBD",
        "component_plans": [
            {
                "name": "Content",
                "role": "content",
                "page_slug": "/",
                "page_title": "Inventory Tracker Overview",
                "page_summary": "",
            },
        ],
    }
    await ground_design_import_metadata(None, creator_plan, bundle_digest=None)
    # "Overview" stripped as generic suffix.
    assert creator_plan["app_name"] == "Inventory Tracker"


async def test_app_name_reseeded_from_summary_proper_noun_when_title_generic():
    creator_plan = {
        "app_name": "Foo_vId",
        "component_plans": [
            {
                "name": "Content",
                "role": "content",
                "page_slug": "/",
                "page_title": "Page",
                "page_summary": (
                    "The main view for Northwind Trading Co.'s order book."
                ),
            },
        ],
    }
    await ground_design_import_metadata(None, creator_plan, bundle_digest=None)
    assert "Northwind Trading" in creator_plan["app_name"]


async def test_app_name_kept_when_already_grounded():
    creator_plan = {
        "app_name": "Ashford Day School Dashboard",
        "component_plans": [
            {
                "name": "OverviewShell",
                "role": "content",
                "page_slug": "/",
                "page_title": "Dashboard Overview",
                "page_summary": "Ashford Day School operations",
            },
        ],
    }
    bundle_digest = {"brand_name": "Ashford Day School"}
    await ground_design_import_metadata(
        None, creator_plan, bundle_digest=bundle_digest
    )
    # Already grounded → unchanged.
    assert creator_plan["app_name"] == "Ashford Day School Dashboard"


async def test_app_name_kept_when_no_better_candidate():
    creator_plan = {
        "app_name": "Foo_vId",  # placeholder
        "component_plans": [],   # no pages to derive from
    }
    await ground_design_import_metadata(None, creator_plan, bundle_digest=None)
    # Nothing better available → keep as-is rather than blank.
    assert creator_plan["app_name"] == "Foo_vId"


async def test_entry_component_renamed_when_generic():
    creator_plan = {
        "app_name": "Ashford Day School",
        "component_plans": [
            {
                "name": "PostFeed",  # generic blog-template name
                "role": "content",
                "page_slug": "/",
                "page_title": "Dashboard Overview",
                "page_summary": "",
            },
        ],
    }
    await ground_design_import_metadata(None, creator_plan, bundle_digest=None)
    # "Dashboard Overview" → strip "Overview" suffix → PascalCase
    assert creator_plan["component_plans"][0]["name"] == "Dashboard"


async def test_entry_component_kept_when_specific():
    creator_plan = {
        "app_name": "Onix Studio",
        "component_plans": [
            {
                "name": "HomeContent",  # not in generic list → keep
                "role": "content",
                "page_slug": "/",
                "page_title": "Home",
                "page_summary": "",
            },
        ],
    }
    await ground_design_import_metadata(None, creator_plan, bundle_digest=None)
    assert creator_plan["component_plans"][0]["name"] == "HomeContent"


async def test_chrome_components_keep_role_names():
    creator_plan = {
        "app_name": "Brand X",
        "component_plans": [
            {
                "name": "Header",  # generic — but role IS header
                "role": "header",
                "page_slug": None,
                "page_title": None,
            },
            {
                "name": "Footer",
                "role": "footer",
                "page_slug": None,
                "page_title": None,
            },
            {
                "name": "Sidebar",
                "role": "sidebar",
                "page_slug": None,
                "page_title": None,
            },
            {
                "name": "PostFeed",
                "role": "content",
                "page_slug": "/",
                "page_title": "Inventory",
                "page_summary": "",
            },
        ],
    }
    await ground_design_import_metadata(None, creator_plan, bundle_digest=None)
    # Chrome roles untouched.
    assert creator_plan["component_plans"][0]["name"] == "Header"
    assert creator_plan["component_plans"][1]["name"] == "Footer"
    assert creator_plan["component_plans"][2]["name"] == "Sidebar"
    # Content component renamed.
    assert creator_plan["component_plans"][3]["name"] == "Inventory"


async def test_entry_component_rename_avoids_collision():
    """If the derived name would collide with another component,
    suffix with 'Shell' as an escape hatch."""
    creator_plan = {
        "app_name": "Brand",
        "component_plans": [
            {"name": "Dashboard", "role": "header"},  # already exists
            {
                "name": "PostFeed",
                "role": "content",
                "page_slug": "/",
                "page_title": "Dashboard",
                "page_summary": "",
            },
        ],
    }
    await ground_design_import_metadata(None, creator_plan, bundle_digest=None)
    assert creator_plan["component_plans"][1]["name"] == "DashboardShell"


async def test_handles_missing_or_empty_creator_plan():
    # Doesn't crash on edge inputs.
    meta_a = await ground_design_import_metadata(None, {}, bundle_digest=None)
    meta_b = await ground_design_import_metadata(
        None, {"app_name": ""}, bundle_digest=None
    )
    expected = {
        "app_name_reseeded": False,
        "extracted_models": [],
        "extracted_wiring": [],
    }
    assert meta_a == expected
    assert meta_b == expected


async def test_returns_app_name_reseeded_flag():
    """The metadata return signals whether the workflow should mark the
    config as ``imported_app_name_hallucinated``."""
    creator_plan = {
        "app_name": "InToTheHobby_Main_vId",
        "component_plans": [
            {
                "name": "PostFeed",
                "role": "content",
                "page_slug": "/",
                "page_title": "Dashboard Overview",
                "page_summary": "",
            },
        ],
    }
    meta = await ground_design_import_metadata(
        None, creator_plan, bundle_digest={"brand_name": "Ashford Day School"}
    )
    assert meta["app_name_reseeded"] is True


async def test_returns_no_reseed_flag_when_app_name_already_grounded():
    creator_plan = {
        "app_name": "Ashford Day School",
        "component_plans": [
            {
                "name": "OverviewShell",
                "role": "content",
                "page_slug": "/",
                "page_title": "Dashboard",
                "page_summary": "",
            },
        ],
    }
    meta = await ground_design_import_metadata(
        None, creator_plan, bundle_digest={"brand_name": "Ashford Day School"}
    )
    assert meta["app_name_reseeded"] is False


# ── Phase 3.2: data extractor integration ─────────────────────────────


def _make_ctx() -> SimpleNamespace:
    """Build a minimal ctx whose only requirement is ``ctx.session.state``
    (a mutable dict) — the grounder reads/writes EXTRACTED_SEED_DATA there
    and passes ctx itself to ArtifactManager.load_artifact_as_string."""
    return SimpleNamespace(session=SimpleNamespace(state={}))


def _patch_artifact_loader(artifacts: dict[str, str]):
    """Patch ArtifactManager.load_artifact_as_string at the grounding-
    module's import site to return strings from a fixture map."""
    async def fake_load(_ctx, key):
        return artifacts.get(key, "")
    return patch(
        "main_agent.agents.utils.artifact_manager."
        "ArtifactManager.load_artifact_as_string",
        side_effect=fake_load,
    )


async def test_extractor_promotes_backend_when_data_array_found():
    """End-to-end: a component plan with sibling JSX modules where one
    sibling defines `STUDENTS = [...]` and another maps it. After
    grounding the creator_plan should carry `app_backend_plan.models`
    with a `students` model and `extracted_models` in the meta return."""
    artifacts = {
        "codefocus_module:Data.tsx": (
            "const STUDENTS = [\n"
            '  { id: 1, name: "Alice", grade: 5 },\n'
            '  { id: 2, name: "Bob", grade: 7 },\n'
            "];\n"
        ),
        "codefocus_module:PageStudents.tsx": (
            "function StudentsTable() {\n"
            "  return STUDENTS.map(s => <tr>{s.name}</tr>);\n"
            "}\n"
        ),
    }
    creator_plan = {
        "app_name": "School",
        "app_backend_plan": {"backend_type": "none", "models": []},
        "component_plans": [
            {
                "name": "DashboardShell",
                "role": "content",
                "page_slug": "/",
                "page_title": "Dashboard Overview",
                "page_summary": "Ashford Day School admin dashboard.",
                "source_jsx_modules": [
                    {"name": "Data", "artifact": "codefocus_module:Data.tsx", "is_entry": False},
                    {"name": "PageStudents", "artifact": "codefocus_module:PageStudents.tsx", "is_entry": False},
                ],
            },
        ],
    }
    ctx = _make_ctx()
    with _patch_artifact_loader(artifacts):
        meta = await ground_design_import_metadata(
            ctx, creator_plan, bundle_digest={"brand_name": "Ashford Day School"}
        )

    # Backend promoted, model surfaced.
    assert creator_plan["app_backend_plan"]["backend_type"] == "dynamic"
    model_names = [m["name"] for m in creator_plan["app_backend_plan"]["models"]]
    assert "students" in model_names

    # Meta return surfaces extraction data + wiring hint.
    assert meta["extracted_models"] == ["students"]
    assert any(
        w["module"] == "PageStudents" and w["model"] == "students"
        for w in meta["extracted_wiring"]
    )

    # Seed rows stashed in session state for SeedDataBuilder.
    seed = ctx.session.state[StateKeys.EXTRACTED_SEED_DATA]
    assert "students" in seed
    assert seed["students"][0]["name"] == "Alice"


async def test_extractor_skips_when_no_consumer():
    """Array referenced ONLY in its own declaration → no consumer.

    Phase 3.5 broadened consumer detection — subscript access etc.
    now qualifies. To get `no_map_consumer` skip the array must have
    no cross-statement reference at all."""
    artifacts = {
        "codefocus_module:Data.tsx": (
            "const ORPHAN = [{ theme: 'light' }];\n"
            # No reference outside the declaration.
        ),
    }
    creator_plan = {
        "app_name": "App",
        "app_backend_plan": {"backend_type": "none", "models": []},
        "component_plans": [
            {
                "name": "Shell",
                "role": "content",
                "page_slug": "/",
                "page_title": "Home",
                "source_jsx_modules": [
                    {"name": "Data", "artifact": "codefocus_module:Data.tsx", "is_entry": False},
                ],
            },
        ],
    }
    ctx = _make_ctx()
    with _patch_artifact_loader(artifacts):
        meta = await ground_design_import_metadata(ctx, creator_plan)

    assert creator_plan["app_backend_plan"]["backend_type"] == "none"
    assert creator_plan["app_backend_plan"]["models"] == []
    assert meta["extracted_models"] == []


async def test_extractor_preserves_existing_dynamic_plan():
    """If the LLM already emitted a richer dynamic backend plan, keep
    the backend_type it set; merge new models without duplicates."""
    artifacts = {
        "codefocus_module:Data.tsx": (
            "const STUDENTS = [{ id: 1, name: 'A' }];\n"
        ),
        "codefocus_module:Page.tsx": (
            "function P() { return STUDENTS.map(s => <li/>); }\n"
        ),
    }
    creator_plan = {
        "app_name": "App",
        "app_backend_plan": {
            "backend_type": "dynamic",
            "models": [
                {"name": "students", "columns": [{"name": "id", "type": "integer"}]},
            ],
        },
        "component_plans": [
            {
                "name": "Shell",
                "role": "content",
                "page_slug": "/",
                "page_title": "Home",
                "source_jsx_modules": [
                    {"name": "Data", "artifact": "codefocus_module:Data.tsx", "is_entry": False},
                    {"name": "Page", "artifact": "codefocus_module:Page.tsx", "is_entry": False},
                ],
            },
        ],
    }
    ctx = _make_ctx()
    with _patch_artifact_loader(artifacts):
        await ground_design_import_metadata(ctx, creator_plan)

    # Existing model untouched (dedupe by name); backend_type kept.
    models = creator_plan["app_backend_plan"]["models"]
    assert [m["name"] for m in models] == ["students"]
    assert creator_plan["app_backend_plan"]["backend_type"] == "dynamic"


async def test_extractor_no_jsx_modules_is_no_op():
    """Component plan without `source_jsx_modules` (e.g. plain HTML
    import) → extractor doesn't fire."""
    creator_plan = {
        "app_name": "App",
        "app_backend_plan": {"backend_type": "none", "models": []},
        "component_plans": [
            {
                "name": "Page",
                "role": "content",
                "page_slug": "/",
                "page_title": "Home",
                "source_html_artifact": "content::page.html",
            },
        ],
    }
    ctx = _make_ctx()
    meta = await ground_design_import_metadata(ctx, creator_plan)
    assert meta["extracted_models"] == []
    assert ctx.session.state.get(StateKeys.EXTRACTED_SEED_DATA) is None


async def test_extractor_handles_artifact_load_failure_gracefully():
    """If ArtifactManager raises (missing artifact, network blip),
    the grounder skips that module and continues with the rest."""
    creator_plan = {
        "app_name": "App",
        "app_backend_plan": {"backend_type": "none", "models": []},
        "component_plans": [
            {
                "name": "Shell",
                "role": "content",
                "page_slug": "/",
                "page_title": "Home",
                "source_jsx_modules": [
                    {"name": "Bad", "artifact": "missing:Bad.tsx", "is_entry": False},
                ],
            },
        ],
    }
    ctx = _make_ctx()
    failing_load = AsyncMock(side_effect=RuntimeError("artifact not found"))
    with patch(
        "main_agent.agents.utils.artifact_manager."
        "ArtifactManager.load_artifact_as_string",
        failing_load,
    ):
        meta = await ground_design_import_metadata(ctx, creator_plan)
    # Doesn't crash; no models surfaced; backend stays inert.
    assert meta["extracted_models"] == []
    assert creator_plan["app_backend_plan"]["backend_type"] == "none"
