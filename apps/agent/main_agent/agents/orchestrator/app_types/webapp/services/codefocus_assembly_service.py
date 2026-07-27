"""
Assembly Service — assembles app_config.json from component and style artifacts.

Takes the planner output + generated artifacts and produces the final app_config
with repo.frontend.components, repo.frontend.styles, repo.frontend.fonts,
repo.backend.handlers, frontend pages/header/sidebar/footer configuration,
and backend models/handlers.
"""

import copy
import uuid as uuid_lib
import time
from typing import Optional
from dataclasses import dataclass, field
import structlog

logger = structlog.get_logger(__name__)


def _infer_default_theme(theme_css: str) -> str:
    """Infer ``"light"`` or ``"dark"`` from ``--color-background`` luminance.

    Returns ``"light"`` when the theme CSS is missing or doesn't carry a
    parseable ``--color-background`` — preserves prior behavior. Returns
    ``"dark"`` only when the resolved background hex falls below the
    WCAG-style midpoint luminance of 0.5.
    """
    if not theme_css:
        return "light"
    try:
        from main_agent.services.validation.style_coverage import (
            _relative_luminance,
            extract_css_theme_color_values,
        )
    except Exception:  # pragma: no cover — defensive import guard
        return "light"
    palette = extract_css_theme_color_values(theme_css)
    bg = palette.get("background") or palette.get("surface")
    if not bg:
        return "light"
    try:
        return "dark" if _relative_luminance(bg) < 0.5 else "light"
    except Exception:
        return "light"


@dataclass
class ComponentEntry:
    """A component to register in repo.frontend.components."""

    name: str
    role: str  # "header", "sidebar", "footer", "content"
    page_slug: Optional[str] = None
    page_title: Optional[str] = None
    summary: str = ""
    # Phase 2 per-module Babel-shell: names of supporting modules this
    # entry component imports from via ES imports. Each name has a
    # corresponding `codefocus_module:<Name>.tsx` artifact that the
    # backend bundles in at deploy time. Empty for single-file
    # components.
    supporting_modules: list[str] = field(default_factory=list)


@dataclass
class AssemblyContext:
    """Context for assembling the final app_config."""

    app_name: str
    app_alias: str
    app_secondary_type: str  # "website", "form", "dataapp", or "custom"
    navigation_type: str  # "HeaderMenuTop" or "SidebarMenuLeft"
    font_urls: list = field(default_factory=list)
    components: list = field(default_factory=lambda: [])
    # Backend artifacts (optional — populated when backend_needed is True)
    backend_config: Optional[dict] = None  # Parsed backend.json
    logic_config: Optional[dict] = None  # Parsed logic.json
    # Inline SVG favicon for the browser tab
    favicon_svg: str = ""
    # Final theme.css text; used to infer ``frontend.theme.defaultTheme``
    # from the resolved ``--color-background`` luminance. Optional — defaults
    # to "light" when absent.
    theme_css: str = ""


class AssemblyService:
    """Assembles the final app_config.json from artifacts."""

    def assemble_app_config(
        self,
        context: AssemblyContext,
    ) -> dict:
        """
        Build the complete app_config.json structure.

        Args:
            context: Assembly context with app metadata, components, font URLs,
                     and optional backend/logic artifacts

        Returns:
            Complete app_config dict ready to serialize as JSON
        """
        # Generate alias from app name
        alias = context.app_alias or context.app_name.lower().replace(" ", "-")

        # Build repo.frontend.components registry
        repo_components = {}
        for comp in context.components:
            entry: dict = {
                "type": "code_component",
                "source": f"code/frontend/components/{comp.name}.tsx",
                "compiled": f"compiled/frontend/components/{comp.name}.js",
                "summary": comp.summary,
            }
            if comp.supporting_modules:
                entry["supporting_modules"] = list(comp.supporting_modules)
            repo_components[comp.name] = entry

        # Build repo.backend.handlers from backend.json handlers
        repo_handlers = {}
        if context.backend_config:
            for handler in context.backend_config.get("handlers", []):
                handler_name = handler.get("name", handler.get("method", ""))
                if handler_name:
                    repo_handlers[handler_name] = {
                        "source": f"code/backend/handlers/{handler_name}.tsx",
                        "compiled": f"compiled/backend/handlers/{handler_name}.js",
                        "summary": handler.get("summary", ""),
                    }

        # Build frontend slots
        header = []
        sidebar = []
        footer = []
        pages = []

        seen_names: set[str] = set()
        for comp in context.components:
            if comp.name in seen_names:
                logger.warning(
                    f"Duplicate component name detected: {comp.name}. "
                    "Skipping duplicate — this indicates a bug in the generation pipeline."
                )
                continue
            seen_names.add(comp.name)

            component_ref = {
                "uuid": str(uuid_lib.uuid4()),
                "componentType": "CodeComponentProps",
                "component": comp.name,
            }

            if comp.role == "header":
                header.append(component_ref)
            elif comp.role == "sidebar":
                sidebar.append(component_ref)
            elif comp.role == "footer":
                footer.append(component_ref)
            elif comp.role == "content" and comp.page_slug is not None:
                slug = comp.page_slug.strip()
                page_uuid = str(uuid_lib.uuid4())
                pages.append(
                    {
                        "uuid": page_uuid,
                        "pageType": "WebPageProps",
                        "title": comp.page_title or comp.name.replace("Content", ""),
                        "slug": slug,
                        "summary": comp.summary,
                        "content": [component_ref],
                    }
                )

        # Ensure the homepage (slug "/") is always at index 0 so the runtime
        # renders it as the default page for the root path.
        home_idx = next(
            (i for i, p in enumerate(pages) if p.get("slug") == "/"),
            None,
        )
        if home_idx is not None and home_idx != 0:
            pages.insert(0, pages.pop(home_idx))
            logger.info("Moved homepage (slug '/') to pages[0]")

        font_urls = list(context.font_urls)

        config = {
            "uuid": alias,
            "alias": alias,
            "name": context.app_name,
            "appType": "WebAppProps",
            "appSecondaryType": context.app_secondary_type,
            "version": "1.0.0",
            "summary": f"{context.app_name}",
            "shortSummary": context.app_name,
            "lastUpdatedEpoch": int(time.time()),
            "repo": {
                "frontend": {
                    "components": repo_components,
                    "styles": {
                        "theme": {
                            "source": "code/frontend/styles/theme.css",
                            "compiled": "compiled/frontend/styles/theme.css",
                            "summary": "Tailwind v4 theme: @import, @theme tokens, SDK variables, custom utilities",
                        },
                        "compiled": {
                            "source": "code/frontend/styles/theme.css",
                            "compiled": "compiled/frontend/styles/compiled.css",
                            "summary": "Tailwind CSS compiled from theme.css and all component sources",
                        },
                    },
                    "fonts": font_urls,
                },
                "backend": {"handlers": repo_handlers},
            },
            "frontend": {
                "layout": "full-width",
                "menuPosition": context.navigation_type,
                **(
                    {"headerScrollBehavior": "sticky"}
                    if context.navigation_type == "HeaderMenuTop"
                    else {}
                ),
                # `frontend.designSystem` was removed — theme.css is now the
                # sole source of truth for design tokens. The runtime reads
                # tokens from compiled CSS; the agent reads them via
                # `parse_css_theme` / `extract_css_theme_color_values`.
                # ``defaultTheme`` is inferred from ``--color-background``
                # luminance: dark backgrounds → "dark" so the runtime SPA
                # adds ``.dark`` to <html>, flipping ui-core's HSL --foreground
                # to near-white. Without this, body inherits the light-mode
                # default and every component without an explicit color rule
                # ships invisible on dark themes.
                "theme": {"defaultTheme": _infer_default_theme(context.theme_css)},
                "languages": [
                    {
                        "code": "en",
                        "nameEnglish": "English",
                        "nameNative": "English",
                        "isDefault": True,
                    }
                ],
                "header": header,
                "sidebar": sidebar,
                "footer": footer,
                "pages": pages,
            },
        }

        # Inject metadata with favicon if available
        if context.favicon_svg:
            config["frontend"].setdefault("metadata", {})["favicon"] = context.favicon_svg

        # Wire backend config (models, handlers, logic) into the app_config.
        # NOTE: backend.handlers MUST be preserved — the deploy pipeline reads
        # handler method names from it to generate _entry.js, and the gateway
        # uses it for route resolution.  repo.backend.handlers stores file paths.
        if context.backend_config:
            backend = context.backend_config.copy()
            backend_section: dict = {
                "mode": backend.get("mode", "dynamic"),
                "models": backend.get("models", []),
                "handlers": backend.get("handlers", []),
            }
            if backend.get("storage"):
                backend_section["storage"] = backend["storage"]
            config["backend"] = backend_section

        if context.logic_config:
            config["frontend"]["logic"] = context.logic_config

        # Note: Seed data injection (D1 routing, static datasets)
        # is handled by the workflow after assembly — not here.

        logger.info(
            "Assembled app_config",
            components=len(repo_components),
            pages=len(pages),
            navigation=context.navigation_type,
            handlers=len(repo_handlers),
            has_backend=context.backend_config is not None,
        )

        return config

    @staticmethod
    def _collect_page_components(pages: list) -> set[str]:
        """Return every component name referenced by the given pages' content arrays."""
        names: set[str] = set()
        for p in pages:
            for c in p.get("content", []) or []:
                name = c.get("component")
                if name:
                    names.add(name)
        return names

    @staticmethod
    def _collect_layout_components(frontend: dict) -> set[str]:
        """Return every component name referenced by header/sidebar/footer slots."""
        names: set[str] = set()
        for slot in ("header", "sidebar", "footer"):
            for c in frontend.get(slot, []) or []:
                name = c.get("component")
                if name:
                    names.add(name)
        return names

    @classmethod
    def _remove_pages_by_uuid(
        cls,
        pages: list,
        frontend: dict,
        repo_components: dict,
        removed_page_uuids: list,
    ) -> list:
        """Remove pages matching the given uuids, then GC content components
        that are no longer referenced by any remaining page or layout slot."""
        uuids_to_remove = set(removed_page_uuids)
        kept_pages = [p for p in pages if p.get("uuid") not in uuids_to_remove]
        removed_pages = [p for p in pages if p.get("uuid") in uuids_to_remove]
        for p in removed_pages:
            logger.info(f"Removed page: uuid={p.get('uuid')} slug={p.get('slug')}")

        orphan_candidates = cls._collect_page_components(removed_pages)
        still_referenced = cls._collect_page_components(
            kept_pages
        ) | cls._collect_layout_components(frontend)
        for name in orphan_candidates - still_referenced:
            repo_components.pop(name, None)
            logger.info(f"GC orphaned component: {name}")

        return kept_pages

    def update_app_config_for_edit(
        self,
        current_config: dict,
        added_components: list = None,
        removed_component_names: list = None,
        removed_page_uuids: Optional[list] = None,
        modified_component_names: list = None,
        backend_config: Optional[dict] = None,
        logic_config: Optional[dict] = None,
    ) -> dict:
        """
        Update an existing app_config after editing.

        Args:
            current_config: Current app_config dict
            added_components: New ComponentEntry objects to add
            removed_component_names: Component names to remove (quick_remove path)
            removed_page_uuids: Page UUIDs to remove. For each page, the page entry
                is deleted and its content components are garbage-collected if no
                other page or layout slot still references them.
            modified_component_names: Component names that were modified
            backend_config: Updated backend config (models + handlers) if modified
            logic_config: Updated logic config (state + actions + computed) if modified

        Returns:
            Updated app_config dict
        """
        logger.info(
            "Updating app_config",
            added=len(added_components or []),
            removed=len(removed_component_names or []),
            removed_pages=len(removed_page_uuids or []),
            modified=len(modified_component_names or []),
            has_backend_update=backend_config is not None,
            has_logic_update=logic_config is not None,
        )

        config = copy.deepcopy(current_config)
        config["lastUpdatedEpoch"] = int(time.time())

        repo_components = config.get("repo", {}).get("frontend", {}).get("components", {})
        frontend = config.get("frontend", {})
        pages = frontend.get("pages", [])

        # Remove pages by uuid, GC orphaned components
        if removed_page_uuids:
            pages = self._remove_pages_by_uuid(pages, frontend, repo_components, removed_page_uuids)

        # Remove components by name (quick_remove path — removes from every surface)
        if removed_component_names:
            for name in removed_component_names:
                repo_components.pop(name, None)
                # Remove component from page content arrays (not the page itself)
                for p in pages:
                    p["content"] = [c for c in p.get("content", []) if c.get("component") != name]
                # Remove pages that became empty after component removal
                pages = [p for p in pages if p.get("content")]
                for slot in ["header", "sidebar", "footer"]:
                    frontend[slot] = [
                        c for c in frontend.get(slot, []) if c.get("component") != name
                    ]
                logger.info(f"Removed component: {name}")

        # Add components
        if added_components:
            for comp in added_components:
                repo_components[comp.name] = {
                    "type": "code_component",
                    "source": f"code/frontend/components/{comp.name}.tsx",
                    "compiled": f"compiled/frontend/components/{comp.name}.js",
                    "summary": comp.summary,
                }
                if comp.role == "content" and comp.page_slug:
                    target_slug = comp.page_slug.strip()
                    new_content_entry = {
                        "uuid": str(uuid_lib.uuid4()),
                        "componentType": "CodeComponentProps",
                        "component": comp.name,
                    }
                    # Upsert: if a page with this slug already exists, replace
                    # its content rather than appending a duplicate. This is
                    # the recovery path for "page exists but content is empty"
                    # — the Editor's FrontendBuildAction emits a PageCreate
                    # with the existing slug and we attach the new component
                    # there. Without this, we'd produce two pages at the
                    # same slug → React Router picks one and the other
                    # goes nowhere.
                    existing_page = next(
                        (
                            p for p in pages
                            if isinstance(p, dict) and p.get("slug") == target_slug
                        ),
                        None,
                    )
                    if existing_page is not None:
                        existing_page["content"] = [new_content_entry]
                        if comp.page_title:
                            existing_page["title"] = comp.page_title
                        if comp.summary and not existing_page.get("summary"):
                            existing_page["summary"] = comp.summary
                        logger.info(
                            f"Upserted component into existing page slug={target_slug!r}: "
                            f"{comp.name} (role={comp.role})"
                        )
                    else:
                        pages.append(
                            {
                                "uuid": str(uuid_lib.uuid4()),
                                "pageType": "WebPageProps",
                                "title": comp.page_title or comp.name.replace("Content", ""),
                                "slug": target_slug,
                                "summary": comp.summary,
                                "content": [new_content_entry],
                            }
                        )
                        logger.info(f"Added component: {comp.name} (role={comp.role})")
                else:
                    logger.info(f"Added component: {comp.name} (role={comp.role})")

        # Ensure homepage stays at index 0 after edits
        home_idx = next(
            (i for i, p in enumerate(pages) if p.get("slug") == "/"),
            None,
        )
        if home_idx is not None and home_idx != 0:
            pages.insert(0, pages.pop(home_idx))

        frontend["pages"] = pages
        config["frontend"] = frontend

        # Update backend config if provided
        if backend_config is not None:
            updated_backend: dict = {
                "mode": backend_config.get("mode", "dynamic"),
                "models": backend_config.get("models", []),
                "handlers": backend_config.get("handlers", []),
            }
            # Preserve storage config from existing or updated config
            storage = backend_config.get("storage") or config.get("backend", {}).get("storage")
            if storage:
                updated_backend["storage"] = storage
            config["backend"] = updated_backend
            # Update repo.backend.handlers, preserving existing path entries.
            #
            # A handler's ``source`` path may carry a content-hash/revision
            # stamp from a prior turn. If we rebuild this dict from scratch
            # every edit, untouched handlers fall back to the bare
            # ``{name}.tsx`` path — which may not match what's in storage. The
            # deploy validator (``readRepoModules`` in
            # ``apps/runtime/worker/src/lib/r2-helpers.ts``) is fail-fast: a
            # single missing path aborts the whole deploy and the app drops
            # to "App Not Found". Bug surfaced 2026-05-07 on app 8wpuopnb.
            #
            # Carry forward the prior config's path for handlers that still
            # exist; fall back to the default only for genuinely-new entries.
            existing_repo_handlers = (
                config.get("repo", {}).get("backend", {}).get("handlers", {}) or {}
            )
            repo_handlers = {}
            for handler in backend_config.get("handlers", []):
                handler_name = handler.get("name", handler.get("method", ""))
                if not handler_name:
                    continue
                prior = existing_repo_handlers.get(handler_name) or {}
                entry: dict = {
                    "source": prior.get("source")
                    or f"code/backend/handlers/{handler_name}.tsx",
                    "compiled": prior.get("compiled")
                    or f"compiled/backend/handlers/{handler_name}.js",
                    "summary": handler.get("summary", "") or prior.get("summary", ""),
                }
                if prior.get("source_hash"):
                    entry["source_hash"] = prior["source_hash"]
                repo_handlers[handler_name] = entry
            config.setdefault("repo", {}).setdefault("backend", {})["handlers"] = repo_handlers

        # Update logic config if provided
        if logic_config is not None:
            config.setdefault("frontend", {})["logic"] = logic_config

        logger.info(
            "App_config update complete",
            total_components=len(repo_components),
            total_pages=len(pages),
        )
        return config
