"""
Component tree traversal and mutation utilities.

Provides find/replace/remove/modify operations on the nested
component tree within an app configuration dictionary.
"""

import structlog
from typing import Any

logger = structlog.get_logger(__name__)


def find_component_by_uuid(app_config: dict, target_uuid: str, max_depth: int = 50) -> dict | None:
    """
    Recursively search for a component by UUID in the app configuration.

    Searches through:
    - The root app config itself
    - All pages (the page objects themselves AND their content recursively)
    - Header components (recursively)
    - Footer components (recursively)
    - Nested component properties (text, title, icon, etc.)

    Args:
        app_config: The parsed app configuration dictionary
        target_uuid: The UUID of the component to find
        max_depth: Maximum recursion depth (default 50)

    Returns:
        dict | None: The component configuration if found, None otherwise
    """

    def search_in_component_dict(component: dict, depth: int = 0) -> dict | None:
        """Recursively search within a single component dict."""
        if depth > max_depth:
            logger.warning(
                f"[find_component_by_uuid] Max recursion depth ({max_depth}) exceeded while searching for UUID {target_uuid}"
            )
            return None

        if not isinstance(component, dict):
            return None

        # Check if this component matches
        if component.get("uuid") == target_uuid:
            return component

        # Search in content field if it's a list
        if "content" in component and isinstance(component["content"], list):
            result = search_in_content(component["content"], depth + 1)
            if result:
                return result

        # Search in other list fields
        for field in ["children", "items", "components"]:
            if field in component and isinstance(component[field], list):
                result = search_in_content(component[field], depth + 1)
                if result:
                    return result

        # Search in nested dict properties (like text, title, icon, href, logo, etc.)
        # BUG FIX: Search ALL nested dicts, not just those with componentType
        # This ensures we find components nested in properties like logo.href, button.link, etc.
        for key, value in component.items():
            if key != "uuid" and isinstance(value, dict):
                # First check if this nested dict itself matches
                if value.get("uuid") == target_uuid:
                    return value
                # Then search recursively in this nested dict
                result = search_in_component_dict(value, depth + 1)
                if result:
                    return result

        return None

    def search_in_content(content: list, depth: int = 0) -> dict | None:
        """Recursively search through a list of components."""
        if depth > max_depth:
            logger.warning(
                f"[find_component_by_uuid] Max recursion depth ({max_depth}) exceeded while searching content for UUID {target_uuid}"
            )
            return None

        if not isinstance(content, list):
            return None

        for component in content:
            if not isinstance(component, dict):
                continue

            # Use the component dict search which handles all nested properties
            result = search_in_component_dict(component, depth + 1)
            if result:
                return result

        return None

    # Check if the root app config itself matches
    if app_config.get("uuid") == target_uuid:
        return app_config

    frontend = app_config.get("frontend", {})

    # Search in pages - check BOTH the page object AND its content
    if "pages" in frontend and isinstance(frontend["pages"], list):
        for page in frontend["pages"]:
            if isinstance(page, dict):
                # First check if the page itself matches
                if page.get("uuid") == target_uuid:
                    return page
                # Then search in the page's content
                if "content" in page:
                    result = search_in_content(page["content"])
                    if result:
                        return result

    # Search in header
    if "header" in frontend:
        result = search_in_content(frontend["header"])
        if result:
            return result

    # Search in footer
    if "footer" in frontend:
        result = search_in_content(frontend["footer"])
        if result:
            return result

    return None


def find_unique_slot_for_component_name(
    app_config: dict, component_name: str
) -> tuple[str, str] | None:
    """Locate the single slot that references a Code-Focus component by name.

    Code-Focus pages embed components via ``{component: <Name>, uuid: <slot>}``
    references in their ``content`` arrays (and ``header`` / ``footer``
    sections). For TC-002 hot-reload metadata we want to tell the runtime
    *which* slot to patch — but only when the answer is unambiguous. If a
    component is referenced from more than one slot (rare but legal — e.g.
    the same hero used on two pages), we can't pick one, so the caller
    should fall back to a full reload.

    Args:
        app_config: parsed app config dictionary.
        component_name: the value of ``component`` to match (e.g.
            ``"HeroSection"``).

    Returns:
        ``(slot_uuid, page_uuid)`` if exactly one slot references the
        component name; ``None`` otherwise (zero matches OR multiple).
        ``page_uuid`` is empty string when the slot lives in app-level
        ``header``/``footer`` rather than a page.
    """
    if not component_name or not isinstance(app_config, dict):
        return None

    matches: list[tuple[str, str]] = []

    def scan_content(content: list, page_uuid: str) -> None:
        if not isinstance(content, list):
            return
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("component") == component_name:
                slot_uuid = item.get("uuid")
                if slot_uuid:
                    matches.append((slot_uuid, page_uuid))
            # Don't recurse into nested content — Code-Focus components
            # are leaf references, the recursion would only find
            # synthetic/inline subtrees that aren't reload targets.

    frontend = app_config.get("frontend", {})

    if isinstance(frontend.get("pages"), list):
        for page in frontend["pages"]:
            if not isinstance(page, dict):
                continue
            page_uuid = page.get("uuid", "")
            for slot_key in ("content", "sections", "header", "sidebar", "footer"):
                if slot_key in page:
                    scan_content(page.get(slot_key, []), page_uuid)

    for slot_key in ("header", "footer"):
        if slot_key in frontend:
            scan_content(frontend.get(slot_key, []), "")

    if len(matches) == 1:
        return matches[0]
    return None


def find_page_type_with_uuid(app_config: dict, page_uuid: str) -> str:
    """
    Find a page by UUID and return its pageType.

    Args:
        app_config: The parsed app configuration dictionary
        page_uuid: The UUID of the page to find

    Returns:
        str: The pageType of the page (e.g. "WebPageProps").
             Returns empty string if page not found or page_uuid is None/empty
    """
    if not page_uuid or not isinstance(page_uuid, str):
        # Routine "no component selected" path — not an error.
        logger.debug(
            f"[find_page_type_with_uuid] No page_uuid provided ({page_uuid!r}); "
            f"returning empty pageType"
        )
        return ""

    if not app_config or not isinstance(app_config, dict):
        logger.warning(f"[find_page_type_with_uuid] Invalid app_config")
        return ""

    # Search through pages to find the one with matching UUID
    frontend = app_config.get("frontend", {})
    pages = frontend.get("pages", [])
    if not isinstance(pages, list):
        logger.warning(f"[find_page_type_with_uuid] 'pages' is not a list in app_config")
        return ""

    for page in pages:
        if isinstance(page, dict) and page.get("uuid") == page_uuid:
            page_type = page.get("pageType", "")
            logger.debug(
                f"[find_page_type_with_uuid] Found page with UUID {page_uuid}, "
                f"pageType: {page_type}"
            )
            return page_type

    logger.debug(f"[find_page_type_with_uuid] Page with UUID {page_uuid} not found")
    return ""


def get_page_slug_by_uuid(app_config: dict, page_uuid: str) -> str | None:
    """
    Get the full page slug from app_config by UUID.

    Args:
        app_config: The app configuration dictionary
        page_uuid: The UUID of the page to find

    Returns:
        The page slug or None if not found
    """
    if not page_uuid:
        return None

    frontend = app_config.get("frontend", {})
    pages = frontend.get("pages", [])
    if not isinstance(pages, list):
        return None

    for page in pages:
        if isinstance(page, dict) and page.get("uuid") == page_uuid:
            return page.get("slug", "")

    return None


def find_component_with_location(app_config: dict, target_uuid: str) -> dict | None:
    """
    Find a component by UUID and determine its location in the app config.

    Args:
        app_config: The parsed app configuration dictionary
        target_uuid: The UUID of the component to find

    Returns:
        dict with keys:
            - config: The component configuration dict
            - location_type: One of "header", "footer", "sidebar", "page", "page_content"
            - page_uuid: The page UUID (only if location_type is "page_content")
        or None if not found
    """

    frontend = app_config.get("frontend", {})

    # Helper to search in a section and return with location info
    def search_section(section_name: str, section_data) -> dict | None:
        if not section_data:
            return None

        # Wrap in dict for find_component_by_uuid compatibility (needs frontend wrapper)
        section_dict = {"frontend": {section_name: section_data}}
        found = find_component_by_uuid(section_dict, target_uuid)

        if found:
            return {"config": found, "location_type": section_name, "page_uuid": None}
        return None

    # Check if it's a page itself
    if "pages" in frontend and isinstance(frontend["pages"], list):
        for page in frontend["pages"]:
            if isinstance(page, dict) and page.get("uuid") == target_uuid:
                return {"config": page, "location_type": "page", "page_uuid": target_uuid}

    # Check if component is inside a page's content
    if "pages" in frontend and isinstance(frontend["pages"], list):
        for page in frontend["pages"]:
            if isinstance(page, dict):
                page_uuid = page.get("uuid")
                # Wrap page in structure that find_component_by_uuid expects (needs frontend wrapper)
                page_wrapper = {"frontend": {"pages": [page]}}
                found = find_component_by_uuid(page_wrapper, target_uuid)
                if found:
                    return {
                        "config": found,
                        "location_type": "page_content",
                        "page_uuid": page_uuid,
                    }

    # Check header
    result = search_section("header", frontend.get("header"))
    if result:
        return result

    # Check footer
    result = search_section("footer", frontend.get("footer"))
    if result:
        return result

    # Check sidebar
    result = search_section("sidebar", frontend.get("sidebar"))
    if result:
        return result

    # Not found anywhere
    return None


def replace_component_by_uuid(
    config: dict, component_uuid: str, new_component: dict, max_depth: int = 50, _depth: int = 0
) -> bool:
    """
    Recursively finds and replaces a component by its UUID in the app config.
    Returns True if the component was found and replaced, False otherwise.

    Args:
        config: The app configuration dictionary
        component_uuid: UUID of the component to replace
        new_component: The new component dict to replace with
        max_depth: Maximum recursion depth (default 50)
        _depth: Internal depth counter (do not set manually)
    """
    if _depth > max_depth:
        logger.warning(
            f"[replace_component_by_uuid] Max recursion depth ({max_depth}) exceeded while searching for UUID {component_uuid}"
        )
        return False

    if isinstance(config, dict):
        if config.get("uuid") == component_uuid:
            # This should not happen if we start search from a list or a container dict
            return False  # Cannot replace the root element this way

        for key, value in config.items():
            if isinstance(value, dict):
                if value.get("uuid") == component_uuid:
                    config[key] = new_component
                    return True
                if replace_component_by_uuid(
                    value, component_uuid, new_component, max_depth, _depth + 1
                ):
                    return True
            elif isinstance(value, list):
                for i, item in enumerate(value):
                    if isinstance(item, dict):
                        if item.get("uuid") == component_uuid:
                            value[i] = new_component
                            return True
                        if replace_component_by_uuid(
                            item, component_uuid, new_component, max_depth, _depth + 1
                        ):
                            return True
    elif isinstance(config, list):
        for i, item in enumerate(config):
            if isinstance(item, dict):
                if item.get("uuid") == component_uuid:
                    config[i] = new_component
                    return True
                if replace_component_by_uuid(
                    item, component_uuid, new_component, max_depth, _depth + 1
                ):
                    return True
    return False


def remove_component_by_uuid(
    config: dict, component_uuid: str, max_depth: int = 50, _depth: int = 0
) -> bool:
    """
    Recursively finds and removes a component by its UUID in the app config.
    Returns True if the component was found and removed, False otherwise.

    Args:
        config: The app configuration dictionary
        component_uuid: UUID of the component to remove
        max_depth: Maximum recursion depth (default 50)
        _depth: Internal depth counter (do not set manually)
    """
    if _depth > max_depth:
        logger.warning(
            f"[remove_component_by_uuid] Max recursion depth ({max_depth}) exceeded while searching for UUID {component_uuid}"
        )
        return False

    if isinstance(config, dict):
        for key, value in config.items():
            if isinstance(value, dict):
                if value.get("uuid") == component_uuid:
                    # Cannot remove a dict value from a dict, only from lists
                    return False
                if remove_component_by_uuid(value, component_uuid, max_depth, _depth + 1):
                    return True
            elif isinstance(value, list):
                for i in range(len(value) - 1, -1, -1):  # Iterate backwards to safely remove
                    item = value[i]
                    if isinstance(item, dict):
                        if item.get("uuid") == component_uuid:
                            value.pop(i)
                            return True
                        if remove_component_by_uuid(item, component_uuid, max_depth, _depth + 1):
                            return True
    elif isinstance(config, list):
        for i in range(len(config) - 1, -1, -1):  # Iterate backwards to safely remove
            item = config[i]
            if isinstance(item, dict):
                if item.get("uuid") == component_uuid:
                    config.pop(i)
                    return True
                if remove_component_by_uuid(item, component_uuid, max_depth, _depth + 1):
                    return True
    return False


def modify_component_field_by_uuid(
    config: dict,
    component_uuid: str,
    target_field: str,
    target_value: Any,
    max_depth: int = 50,
    _depth: int = 0,
) -> bool:
    """
    Finds a component by UUID and modifies a specific field.
    Supports dot notation for nested fields (e.g., 'title.text', 'style.color').

    Args:
        config: The app configuration dictionary
        component_uuid: UUID of the component to modify
        target_field: Field to modify (supports dot notation for nested fields)
        target_value: New value to set for the field
        max_depth: Maximum recursion depth for component search (default 50)
        _depth: Internal depth counter (do not set manually)

    Returns:
        True if the component was found and field modified, False otherwise.
    """
    if _depth > max_depth:
        logger.warning(
            f"[modify_component_field_by_uuid] Max recursion depth ({max_depth}) exceeded while searching for UUID {component_uuid}"
        )
        return False

    # Find the component first
    component = find_component_by_uuid(config, component_uuid, max_depth=max_depth)
    if component is None:
        logger.warning(f"[modify_component_field_by_uuid] Component {component_uuid} not found")
        return False

    # Handle nested field paths (e.g., 'style.color' or 'title.text')
    field_parts = target_field.split(".")

    # Navigate to the parent of the target field
    current = component
    for part in field_parts[:-1]:
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            # Path doesn't exist, create nested dicts
            if isinstance(current, dict):
                current[part] = {}
                current = current[part]
            else:
                logger.warning(
                    f"[modify_component_field_by_uuid] Cannot navigate to field path: {target_field}"
                )
                return False

    # Set the final field value
    final_field = field_parts[-1]
    if isinstance(current, dict):
        current[final_field] = target_value
        logger.info(
            f"[modify_component_field_by_uuid] Set {target_field}={target_value} on component {component_uuid}"
        )
        return True

    logger.warning(
        f"[modify_component_field_by_uuid] Cannot set field {target_field} - parent is not a dict"
    )
    return False


def apply_quick_actions(app_config: dict, quick_actions: list[dict]) -> tuple[int, int]:
    """
    Apply a list of quick editor actions to the app config.

    Supports surgical modifications without triggering full component rebuilds:
    - 'modify': Set a specific field to a new value (supports dot notation for nested fields)
    - 'remove': Remove the entire component

    IMPORTANT: Always target the minimum-scope component. For example, to change a menu
    link's label, target the MenuLinkItem's UUID directly, not the parent Navbar's UUID.

    Args:
        app_config: The app configuration dictionary (modified in place)
        quick_actions: List of QuickEditorAction dicts with:
            - component_uuid: UUID of the specific component to modify
            - modification_type: 'modify' or 'remove'
            - target_field: Field to modify (supports dot notation, e.g., 'href.text')
            - target_value: New value for the field

    Returns:
        Tuple of (successful_count, failed_count)
    """
    successful = 0
    failed = 0

    for action in quick_actions:
        component_uuid = action.get("component_uuid", "")
        modification_type = action.get("modification_type", "modify")

        if not component_uuid:
            logger.warning(f"[apply_quick_actions] Action missing component_uuid: {action}")
            failed += 1
            continue

        if modification_type == "remove":
            # Remove the entire component
            if remove_component_by_uuid(app_config, component_uuid):
                logger.info(f"[apply_quick_actions] Removed component {component_uuid}")
                successful += 1
            else:
                logger.warning(f"[apply_quick_actions] Failed to remove component {component_uuid}")
                failed += 1

        elif modification_type == "modify":
            # Modify a single field value (supports dot notation for nested fields)
            target_field = action.get("target_field", "")
            target_value = action.get("target_value")

            if not target_field:
                logger.warning(
                    f"[apply_quick_actions] Modify action missing target_field: {action}"
                )
                failed += 1
                continue

            if modify_component_field_by_uuid(
                app_config, component_uuid, target_field, target_value
            ):
                successful += 1
            else:
                failed += 1

        else:
            logger.warning(
                f"[apply_quick_actions] Unknown modification_type: {modification_type}. Only 'modify' and 'remove' are supported."
            )
            failed += 1

    logger.info(f"[apply_quick_actions] Completed: {successful} successful, {failed} failed")
    return successful, failed
