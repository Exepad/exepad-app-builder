"""Unit tests for AssemblyService.

Tests cover:
- assemble_app_config: navigation types, backend/logic wiring, homepage ordering,
  duplicate component handling, font URLs, component registry, design system
- update_app_config_for_edit: component add/remove, backend/logic updates,
  homepage ordering after edits, timestamp update, deep copy safety
"""

import copy
import time
from unittest.mock import patch

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services.codefocus_assembly_service import (
    AssemblyContext,
    AssemblyService,
    ComponentEntry,
)

pytestmark = [pytest.mark.unit]

FIXED_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def _make_context(**overrides) -> AssemblyContext:
    """Helper to build an AssemblyContext with sensible defaults."""
    defaults = dict(
        app_name="Test App",
        app_alias="test-app",
        app_secondary_type="website",
        navigation_type="HeaderMenuTop",
        font_urls=[],
        components=[],
        backend_config=None,
        logic_config=None,
        favicon_svg="",
    )
    defaults.update(overrides)
    return AssemblyContext(**defaults)


def _make_minimal_config() -> dict:
    """Helper to build a minimal existing config for edit tests."""
    return {
        "uuid": "test-app",
        "alias": "test-app",
        "name": "Test App",
        "lastUpdatedEpoch": 1000000,
        "repo": {
            "frontend": {
                "components": {
                    "HeroContent": {
                        "type": "code_component",
                        "source": "frontend/code/components/HeroContent.tsx",
                        "compiled": "frontend/compiled/components/HeroContent.js",
                        "summary": "Hero section",
                    },
                    "AppHeader": {
                        "type": "code_component",
                        "source": "frontend/code/components/AppHeader.tsx",
                        "compiled": "frontend/compiled/components/AppHeader.js",
                        "summary": "App header",
                    },
                },
                "methods": {},
                "fonts": [],
            },
            "backend": {"handlers": {}},
        },
        "frontend": {
            "menuPosition": "HeaderMenuTop",
            "header": [
                {
                    "uuid": "h1",
                    "componentType": "CodeComponentProps",
                    "component": "AppHeader",
                }
            ],
            "sidebar": [],
            "footer": [],
            "pages": [
                {
                    "uuid": "p1",
                    "pageType": "WebPageProps",
                    "title": "Home",
                    "slug": "/",
                    "summary": "Homepage",
                    "content": [
                        {
                            "uuid": "c1",
                            "componentType": "CodeComponentProps",
                            "component": "HeroContent",
                        }
                    ],
                },
            ],
        },
    }


# =============================================================================
# assemble_app_config TESTS
# =============================================================================


class TestAssembleAppConfig:
    """Tests for AssemblyService.assemble_app_config()."""

    def setup_method(self):
        self.service = AssemblyService()

    @patch("uuid.uuid4", return_value=FIXED_UUID)
    def test_website_header_menu_top(self, mock_uuid):
        """Website with HeaderMenuTop produces header, footer, pages, sticky header."""
        ctx = _make_context(
            navigation_type="HeaderMenuTop",
            app_secondary_type="website",
            components=[
                ComponentEntry(name="AppHeader", role="header", summary="Top nav"),
                ComponentEntry(name="AppFooter", role="footer", summary="Footer"),
                ComponentEntry(
                    name="HomeContent",
                    role="content",
                    page_slug="/",
                    page_title="Home",
                    summary="Homepage content",
                ),
            ],
        )
        config = self.service.assemble_app_config(ctx)

        assert config["frontend"]["menuPosition"] == "HeaderMenuTop"
        assert config["frontend"]["headerScrollBehavior"] == "sticky"
        assert len(config["frontend"]["header"]) == 1
        assert len(config["frontend"]["footer"]) == 1
        assert len(config["frontend"]["pages"]) == 1
        assert config["frontend"]["pages"][0]["slug"] == "/"

    @patch("uuid.uuid4", return_value=FIXED_UUID)
    def test_dataapp_sidebar_menu_left(self, mock_uuid):
        """Dataapp with SidebarMenuLeft produces sidebar, no headerScrollBehavior."""
        ctx = _make_context(
            navigation_type="SidebarMenuLeft",
            app_secondary_type="dataapp",
            components=[
                ComponentEntry(name="AppSidebar", role="sidebar", summary="Side nav"),
                ComponentEntry(
                    name="DashboardContent",
                    role="content",
                    page_slug="/",
                    page_title="Dashboard",
                    summary="Dashboard",
                ),
            ],
        )
        config = self.service.assemble_app_config(ctx)

        assert config["frontend"]["menuPosition"] == "SidebarMenuLeft"
        assert "headerScrollBehavior" not in config["frontend"]
        assert config["appSecondaryType"] == "dataapp"
        assert len(config["frontend"]["sidebar"]) == 1

    def test_backend_config_wiring(self):
        """With backend_config: produces backend.mode + backend.models, repo.backend.handlers."""
        backend = {
            "mode": "dynamic",
            "models": [{"name": "tasks", "fields": []}],
            "handlers": [
                {"name": "completeTask", "summary": "Mark task done"},
            ],
        }
        ctx = _make_context(backend_config=backend)
        config = self.service.assemble_app_config(ctx)

        assert config["backend"]["mode"] == "dynamic"
        assert config["backend"]["models"] == [{"name": "tasks", "fields": []}]
        repo_handlers = config["repo"]["backend"]["handlers"]
        assert "completeTask" in repo_handlers
        assert repo_handlers["completeTask"]["source"] == "code/backend/handlers/completeTask.tsx"

    def test_logic_config_wiring(self):
        """With logic_config: produces frontend.logic."""
        logic = {
            "state": {"count": 0},
            "computed": {
                "doubled": {"method": "doubled", "formula": "count * 2"},
                "tripled": 99,
            },
        }
        ctx = _make_context(logic_config=logic)
        config = self.service.assemble_app_config(ctx)

        assert config["frontend"]["logic"] == logic

    @patch("uuid.uuid4", return_value=FIXED_UUID)
    def test_homepage_always_first(self, mock_uuid):
        """Homepage (slug '/') is always at pages[0] even if created after other pages."""
        ctx = _make_context(
            components=[
                ComponentEntry(
                    name="AboutContent",
                    role="content",
                    page_slug="/about",
                    page_title="About",
                    summary="About page",
                ),
                ComponentEntry(
                    name="ContactContent",
                    role="content",
                    page_slug="/contact",
                    page_title="Contact",
                    summary="Contact page",
                ),
                ComponentEntry(
                    name="HomeContent",
                    role="content",
                    page_slug="/",
                    page_title="Home",
                    summary="Home page",
                ),
            ],
        )
        config = self.service.assemble_app_config(ctx)

        pages = config["frontend"]["pages"]
        assert len(pages) == 3
        assert pages[0]["slug"] == "/"
        assert pages[0]["title"] == "Home"

    @patch("uuid.uuid4", return_value=FIXED_UUID)
    def test_duplicate_component_names_skipped(self, mock_uuid):
        """Duplicate component names are skipped with a warning."""
        ctx = _make_context(
            components=[
                ComponentEntry(
                    name="HomeContent",
                    role="content",
                    page_slug="/",
                    page_title="Home",
                    summary="First",
                ),
                ComponentEntry(
                    name="HomeContent",
                    role="content",
                    page_slug="/dup",
                    page_title="Dup",
                    summary="Duplicate",
                ),
            ],
        )
        config = self.service.assemble_app_config(ctx)

        pages = config["frontend"]["pages"]
        assert len(pages) == 1
        assert pages[0]["slug"] == "/"

    def test_font_urls_wired(self):
        """Font URLs are wired into repo.frontend.fonts."""
        fonts = [
            "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap",
            "https://fonts.googleapis.com/css2?family=Roboto&display=swap",
        ]
        ctx = _make_context(font_urls=fonts)
        config = self.service.assemble_app_config(ctx)

        assert config["repo"]["frontend"]["fonts"] == fonts

    @patch("uuid.uuid4", return_value=FIXED_UUID)
    def test_component_registry_paths(self, mock_uuid):
        """Component registry has correct source/compiled paths."""
        ctx = _make_context(
            components=[
                ComponentEntry(name="MyWidget", role="content", page_slug="/", summary="Widget"),
            ],
        )
        config = self.service.assemble_app_config(ctx)

        reg = config["repo"]["frontend"]["components"]["MyWidget"]
        assert reg["type"] == "code_component"
        assert reg["source"] == "code/frontend/components/MyWidget.tsx"
        assert reg["compiled"] == "compiled/frontend/components/MyWidget.js"
        assert reg["summary"] == "Widget"

    def test_assembly_does_not_emit_design_system_field(self):
        """`frontend.designSystem` was removed — theme.css is the sole source
        of truth for design tokens. The assembly service must not write it."""
        ctx = _make_context()
        config = self.service.assemble_app_config(ctx)

        assert "designSystem" not in config["frontend"]

    def test_basic_metadata(self):
        """Config has correct top-level metadata fields."""
        ctx = _make_context(app_name="My Cool App", app_alias="my-cool-app")
        config = self.service.assemble_app_config(ctx)

        assert config["uuid"] == "my-cool-app"
        assert config["alias"] == "my-cool-app"
        assert config["name"] == "My Cool App"
        assert config["appType"] == "WebAppProps"
        assert config["version"] == "1.0.0"
        assert isinstance(config["lastUpdatedEpoch"], int)

    def test_favicon_svg_injected_into_metadata(self):
        """When favicon_svg is provided, it appears in frontend.metadata.favicon."""
        svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#3b82f6"/></svg>'
        ctx = _make_context(favicon_svg=svg)
        config = self.service.assemble_app_config(ctx)

        assert config["frontend"]["metadata"]["favicon"] == svg

    def test_favicon_svg_empty_no_metadata(self):
        """When favicon_svg is empty, frontend.metadata is not created."""
        ctx = _make_context(favicon_svg="")
        config = self.service.assemble_app_config(ctx)

        assert "metadata" not in config["frontend"]


# =============================================================================
# update_app_config_for_edit TESTS
# =============================================================================


class TestUpdateAppConfigForEdit:
    """Tests for AssemblyService.update_app_config_for_edit()."""

    def setup_method(self):
        self.service = AssemblyService()

    def test_remove_component_from_repo_and_pages(self):
        """Remove component: removed from repo.frontend.components AND from pages."""
        config = _make_minimal_config()
        result = self.service.update_app_config_for_edit(
            config,
            removed_component_names=["HeroContent"],
        )

        assert "HeroContent" not in result["repo"]["frontend"]["components"]
        # The page that contained HeroContent should be gone
        page_slugs = [p["slug"] for p in result["frontend"]["pages"]]
        assert "/" not in page_slugs

    def test_remove_header_component(self):
        """Remove header component: removed from repo AND header slot."""
        config = _make_minimal_config()
        result = self.service.update_app_config_for_edit(
            config,
            removed_component_names=["AppHeader"],
        )

        assert "AppHeader" not in result["repo"]["frontend"]["components"]
        assert len(result["frontend"]["header"]) == 0

    @patch("uuid.uuid4", return_value=FIXED_UUID)
    def test_add_content_component(self, mock_uuid):
        """Add content component: added to repo + new page created."""
        config = _make_minimal_config()
        new_comp = ComponentEntry(
            name="BlogContent",
            role="content",
            page_slug="/blog",
            page_title="Blog",
            summary="Blog page",
        )
        result = self.service.update_app_config_for_edit(
            config,
            added_components=[new_comp],
        )

        assert "BlogContent" in result["repo"]["frontend"]["components"]
        blog_pages = [p for p in result["frontend"]["pages"] if p["slug"] == "/blog"]
        assert len(blog_pages) == 1
        assert blog_pages[0]["title"] == "Blog"
        assert blog_pages[0]["content"][0]["component"] == "BlogContent"

    @patch("uuid.uuid4", return_value=FIXED_UUID)
    def test_add_content_component_upserts_existing_slug(self, mock_uuid):
        """When the slug already exists, replace its content rather than appending.

        Recovery path for the ``xdk89qba`` blue-screen class: the persisted
        config has a page at ``/`` with empty ``content``; the Editor's
        ``FrontendBuildAction(page_creates=[PageCreate(slug="/", ...)])`` is
        the right action and the assembly must upsert the new component
        onto that existing page rather than producing two ``/`` entries.
        """
        config = _make_minimal_config()
        # Drop the existing component so the page sits at slug="/" with empty content
        config["frontend"]["pages"][0]["content"] = []
        config["frontend"]["pages"][0]["title"] = "Old Title"

        new_comp = ComponentEntry(
            name="HomeContent",
            role="content",
            page_slug="/",
            page_title="Play Adventure",
            summary="Game canvas",
        )
        result = self.service.update_app_config_for_edit(
            config,
            added_components=[new_comp],
        )

        # Exactly one page at "/" — the existing entry, not a duplicate.
        root_pages = [p for p in result["frontend"]["pages"] if p["slug"] == "/"]
        assert len(root_pages) == 1
        page = root_pages[0]
        # Existing page UUID is preserved (we mutate in place, no new uuid).
        assert page["uuid"] == "p1"
        # Title was overwritten because the action provided a new one.
        assert page["title"] == "Play Adventure"
        # Content now points at the new component.
        assert len(page["content"]) == 1
        assert page["content"][0]["component"] == "HomeContent"
        # Component registered in repo.
        assert "HomeContent" in result["repo"]["frontend"]["components"]

    @patch("uuid.uuid4", return_value=FIXED_UUID)
    def test_add_header_component_no_page(self, mock_uuid):
        """Add header component: added to repo but no page created."""
        config = _make_minimal_config()
        new_comp = ComponentEntry(
            name="NewHeader",
            role="header",
            summary="New header",
        )
        result = self.service.update_app_config_for_edit(
            config,
            added_components=[new_comp],
        )

        assert "NewHeader" in result["repo"]["frontend"]["components"]
        # Page count unchanged (still just the homepage)
        assert len(result["frontend"]["pages"]) == 1

    def test_backend_config_update(self):
        """With backend_config update: replaces backend section and repo.backend.handlers."""
        config = _make_minimal_config()
        new_backend = {
            "mode": "dynamic",
            "models": [{"name": "orders", "fields": []}],
            "handlers": [{"name": "processOrder", "summary": "Process an order"}],
        }
        result = self.service.update_app_config_for_edit(
            config,
            backend_config=new_backend,
        )

        assert result["backend"]["mode"] == "dynamic"
        assert result["backend"]["models"] == [{"name": "orders", "fields": []}]
        assert "processOrder" in result["repo"]["backend"]["handlers"]

    def test_backend_config_update_preserves_existing_handler_paths(self):
        """Untouched handlers keep their versioned paths from prior turns.

        Bug surfaced 2026-05-07 on app 8wpuopnb: rebuilding repo.backend.handlers
        from scratch every edit replaced versioned paths
        (``handler_<hash>_v1.tsx``) with the unversioned default
        (``handler.tsx``). The platform-v1 deploy validator
        (``readRepoModules``) then failed to find the unversioned compiled
        .js in R2 — the file only ever existed at the hashed path. Result:
        deploy aborted, app showed "App Not Found".

        Fix: when assembling the new repo.backend.handlers, look up the prior
        entry per handler name and carry forward source / compiled /
        source_hash for handlers that already have them. New handlers still
        get the unversioned default.
        """
        config = _make_minimal_config()
        # Seed prior config with TWO handlers — one hash-versioned, one bare.
        config.setdefault("repo", {}).setdefault("backend", {})["handlers"] = {
            "stayingHandler": {
                "source": "code/backend/handlers/stayingHandler_abc123def456_v1.tsx",
                "compiled": "compiled/backend/handlers/stayingHandler_abc123def456_v1.js",
                "summary": "stayingHandler summary",
                "source_hash": "sha256:abc123def456",
            },
            "bareHandler": {
                "source": "code/backend/handlers/bareHandler.tsx",
                "compiled": "compiled/backend/handlers/bareHandler.js",
                "summary": "bareHandler summary",
            },
        }
        # Edit turn arrives with the same two handlers + a new one.
        new_backend = {
            "mode": "dynamic",
            "models": [],
            "handlers": [
                {"name": "stayingHandler", "summary": "stayingHandler summary"},
                {"name": "bareHandler", "summary": "bareHandler summary"},
                {"name": "newHandler", "summary": "fresh handler"},
            ],
        }
        result = self.service.update_app_config_for_edit(
            config,
            backend_config=new_backend,
        )

        repo_handlers = result["repo"]["backend"]["handlers"]

        # Hash-versioned paths preserved.
        assert (
            repo_handlers["stayingHandler"]["source"]
            == "code/backend/handlers/stayingHandler_abc123def456_v1.tsx"
        )
        assert (
            repo_handlers["stayingHandler"]["compiled"]
            == "compiled/backend/handlers/stayingHandler_abc123def456_v1.js"
        )
        assert repo_handlers["stayingHandler"]["source_hash"] == "sha256:abc123def456"

        # Bare-path handler preserved as-is (no source_hash to carry).
        assert (
            repo_handlers["bareHandler"]["source"]
            == "code/backend/handlers/bareHandler.tsx"
        )
        assert "source_hash" not in repo_handlers["bareHandler"]

        # New handler gets the unversioned default path.
        assert (
            repo_handlers["newHandler"]["source"]
            == "code/backend/handlers/newHandler.tsx"
        )
        assert (
            repo_handlers["newHandler"]["compiled"]
            == "compiled/backend/handlers/newHandler.js"
        )
        assert repo_handlers["newHandler"]["summary"] == "fresh handler"
        assert "source_hash" not in repo_handlers["newHandler"]

    def test_logic_config_update(self):
        """With logic_config update: replaces frontend.logic."""
        config = _make_minimal_config()
        new_logic = {
            "state": {"total": 0},
            "computed": {
                "formattedTotal": {"method": "formattedTotal", "formula": "format(total)"},
            },
        }
        result = self.service.update_app_config_for_edit(
            config,
            logic_config=new_logic,
        )

        assert result["frontend"]["logic"] == new_logic

    @patch("uuid.uuid4", return_value=FIXED_UUID)
    def test_homepage_stays_at_index_0_after_edit(self, mock_uuid):
        """Homepage stays at index 0 after adding pages that would push it down."""
        config = _make_minimal_config()
        # Remove the homepage, add new pages, then re-add homepage at the end
        config["frontend"]["pages"] = [
            {
                "uuid": "p2",
                "pageType": "WebPageProps",
                "title": "About",
                "slug": "/about",
                "summary": "About",
                "content": [],
            },
            {
                "uuid": "p1",
                "pageType": "WebPageProps",
                "title": "Home",
                "slug": "/",
                "summary": "Homepage",
                "content": [],
            },
        ]
        result = self.service.update_app_config_for_edit(config)

        assert result["frontend"]["pages"][0]["slug"] == "/"

    def test_last_updated_epoch_updated(self):
        """lastUpdatedEpoch gets updated to current time."""
        config = _make_minimal_config()
        old_epoch = config["lastUpdatedEpoch"]
        before = int(time.time())

        result = self.service.update_app_config_for_edit(config)

        assert result["lastUpdatedEpoch"] >= before
        assert result["lastUpdatedEpoch"] != old_epoch

    def test_deep_copy_original_not_mutated(self):
        """Deep copy: original config is not mutated."""
        config = _make_minimal_config()
        original_snapshot = copy.deepcopy(config)

        self.service.update_app_config_for_edit(
            config,
            removed_component_names=["HeroContent"],
        )

        assert config == original_snapshot
