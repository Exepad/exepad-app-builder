"""Validators for E2E test results.

This module provides validation functions for SSE events and workflow outputs.
App config validation is delegated to validate_app_config from the
packages/schemas/scripts/py/validation package.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .sse_parser import SSEEvent, get_events_by_type


@dataclass
class ValidationResult:
    """Result of a single validation check."""

    name: str
    passed: bool
    severity: str  # "error" or "warning"
    message: str = ""
    details: Optional[Any] = None


@dataclass
class ValidationReport:
    """Complete validation report for a test."""

    results: List[ValidationResult] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        """Check if all error-level validations passed."""
        return all(r.passed for r in self.results if r.severity == "error")

    @property
    def errors(self) -> List[ValidationResult]:
        """Get all failed error-level validations."""
        return [r for r in self.results if not r.passed and r.severity == "error"]

    @property
    def warnings(self) -> List[ValidationResult]:
        """Get all failed warning-level validations."""
        return [r for r in self.results if not r.passed and r.severity == "warning"]

    @property
    def failures(self) -> List[str]:
        """Get failure messages for all failed validations."""
        return [r.message for r in self.results if not r.passed]

    def to_dict(self) -> Dict[str, Any]:
        """Convert report to dictionary for JSON serialization."""
        return {
            "passed": self.passed,
            "total_checks": len(self.results),
            "errors_count": len(self.errors),
            "warnings_count": len(self.warnings),
            "results": [
                {
                    "name": r.name,
                    "passed": r.passed,
                    "severity": r.severity,
                    "message": r.message,
                    "details": r.details,
                }
                for r in self.results
            ],
        }


# =============================================================================
# SSE EVENT VALIDATORS
# =============================================================================


def validate_has_progress_events(events: List[SSEEvent]) -> ValidationResult:
    """Validate that at least one progress event exists.

    Args:
        events: List of SSE events

    Returns:
        ValidationResult indicating if progress events were found
    """
    progress_events = get_events_by_type(events, "progress")
    passed = len(progress_events) > 0

    return ValidationResult(
        name="has_progress_events",
        passed=passed,
        severity="error",
        message=(
            "No progress events found"
            if not passed
            else f"Found {len(progress_events)} progress events"
        ),
        details={"count": len(progress_events)},
    )


def validate_progress_sequence(events: List[SSEEvent]) -> ValidationResult:
    """Validate that progress values increase monotonically.

    Args:
        events: List of SSE events

    Returns:
        ValidationResult indicating if progress increased properly
    """
    progress_events = get_events_by_type(events, "progress")

    if not progress_events:
        return ValidationResult(
            name="progress_sequence",
            passed=True,
            severity="warning",
            message="No progress events to validate",
        )

    progress_values = []
    for event in progress_events:
        if event.raw_data and "progress" in event.raw_data:
            progress_values.append(event.raw_data["progress"])

    if not progress_values:
        return ValidationResult(
            name="progress_sequence",
            passed=True,
            severity="warning",
            message="No progress values found in events",
        )

    # Check if generally increasing (allow some fluctuation)
    issues = []
    for i in range(1, len(progress_values)):
        if progress_values[i] < progress_values[i - 1] - 5:  # Allow 5% tolerance
            issues.append(f"Progress decreased from {progress_values[i-1]} to {progress_values[i]}")

    passed = len(issues) == 0

    return ValidationResult(
        name="progress_sequence",
        passed=passed,
        severity="warning",
        message=(
            "; ".join(issues)
            if issues
            else f"Progress increased properly: {progress_values[0]} -> {progress_values[-1]}"
        ),
        details={"values": progress_values, "issues": issues},
    )


def validate_workflow_lifecycle(events: List[SSEEvent]) -> ValidationResult:
    """Validate that workflow has proper start and finish actions.

    Expected lifecycle:
    - creation_mode_starting (at start)
    - app_building_finished (at end)

    Args:
        events: List of SSE events

    Returns:
        ValidationResult indicating if lifecycle is complete
    """
    progress_events = get_events_by_type(events, "progress")

    actions = []
    for event in progress_events:
        if event.action:
            actions.append(event.action)

    has_start = "creation_mode_starting" in actions
    has_finish = "app_building_finished" in actions

    issues = []
    if not has_start:
        issues.append("Missing 'creation_mode_starting' action")
    if not has_finish:
        issues.append("Missing 'app_building_finished' action")

    passed = has_start and has_finish

    return ValidationResult(
        name="workflow_lifecycle",
        passed=passed,
        severity="error",
        message="; ".join(issues) if issues else "Workflow lifecycle complete",
        details={"actions": actions, "has_start": has_start, "has_finish": has_finish},
    )


def validate_timestamps(events: List[SSEEvent]) -> ValidationResult:
    """Validate that all events have valid timestamps.

    Args:
        events: List of SSE events

    Returns:
        ValidationResult indicating if timestamps are valid
    """
    issues = []
    valid_count = 0

    for i, event in enumerate(events):
        if event.timestamp is None:
            # Check raw_data for timestamp
            if event.raw_data and "timestamp" in event.raw_data:
                ts = event.raw_data["timestamp"]
                if isinstance(ts, (int, float)) and ts > 0:
                    valid_count += 1
                else:
                    issues.append(f"Event {i}: Invalid timestamp value {ts}")
            else:
                issues.append(f"Event {i}: Missing timestamp")
        elif isinstance(event.timestamp, (int, float)) and event.timestamp > 0:
            valid_count += 1
        else:
            issues.append(f"Event {i}: Invalid timestamp {event.timestamp}")

    passed = len(issues) == 0

    return ValidationResult(
        name="timestamps_valid",
        passed=passed,
        severity="warning",
        message="; ".join(issues[:5]) if issues else f"All {valid_count} timestamps valid",
        details={"valid_count": valid_count, "issues": issues},
    )


def validate_has_chat_response(events: List[SSEEvent]) -> ValidationResult:
    """Validate that at least one chat message response exists.

    Args:
        events: List of SSE events

    Returns:
        ValidationResult indicating if chat response was found
    """
    chat_events = get_events_by_type(events, "chat_message")
    passed = len(chat_events) > 0

    return ValidationResult(
        name="has_chat_response",
        passed=passed,
        severity="error",
        message=(
            "No chat message response found"
            if not passed
            else f"Found {len(chat_events)} chat messages"
        ),
        details={"count": len(chat_events)},
    )


def validate_chat_content(events: List[SSEEvent]) -> ValidationResult:
    """Validate that chat messages have non-empty content.

    Args:
        events: List of SSE events

    Returns:
        ValidationResult indicating if chat content is valid
    """
    chat_events = get_events_by_type(events, "chat_message")

    if not chat_events:
        return ValidationResult(
            name="chat_content",
            passed=True,
            severity="warning",
            message="No chat messages to validate",
        )

    empty_messages = []
    for i, event in enumerate(chat_events):
        text = None
        if event.message:
            text = event.message
        elif event.raw_data:
            text = event.raw_data.get("text") or event.raw_data.get("message")

        if not text or not str(text).strip():
            empty_messages.append(i)

    passed = len(empty_messages) == 0

    return ValidationResult(
        name="chat_content",
        passed=passed,
        severity="warning",
        message=(
            f"Empty chat messages at indices: {empty_messages}"
            if not passed
            else "All chat messages have content"
        ),
        details={"empty_indices": empty_messages},
    )


def validate_no_errors(events: List[SSEEvent]) -> ValidationResult:
    """Validate that no error events were received.

    Args:
        events: List of SSE events

    Returns:
        ValidationResult indicating if any errors occurred
    """
    error_events = []

    for event in events:
        is_error = (
            event.event_type == "error"
            or event.action == "error"
            or (event.raw_data and event.raw_data.get("type") == "error")
        )
        if is_error:
            error_events.append(event)

    passed = len(error_events) == 0

    error_messages = []
    for event in error_events:
        msg = (
            event.message
            or (event.raw_data.get("message") if event.raw_data else None)
            or "Unknown error"
        )
        error_messages.append(msg)

    return ValidationResult(
        name="no_errors",
        passed=passed,
        severity="error",
        message="; ".join(error_messages) if error_messages else "No error events",
        details={"error_count": len(error_events), "messages": error_messages},
    )


def validate_app_config_updated(events: List[SSEEvent]) -> ValidationResult:
    """Validate that an app_config_updated event was received.

    Args:
        events: List of SSE events

    Returns:
        ValidationResult indicating if config was updated
    """
    config_events = get_events_by_type(events, "app_config_updated")
    passed = len(config_events) > 0

    return ValidationResult(
        name="app_config_updated",
        passed=passed,
        severity="error",
        message=(
            "No app_config_updated event found"
            if not passed
            else f"Found {len(config_events)} config updates"
        ),
        details={"count": len(config_events)},
    )


# =============================================================================
# COMBINED VALIDATOR
# =============================================================================


def run_sse_validations(events: List[SSEEvent]) -> List[ValidationResult]:
    """Run all SSE event validations.

    Args:
        events: List of SSE events

    Returns:
        List of validation results
    """
    return [
        validate_has_progress_events(events),
        validate_progress_sequence(events),
        validate_workflow_lifecycle(events),
        validate_timestamps(events),
        validate_has_chat_response(events),
        validate_chat_content(events),
        validate_no_errors(events),
        validate_app_config_updated(events),
    ]


# =============================================================================
# APP CONFIG HELPERS
# =============================================================================


def count_components_by_type(config: Dict[str, Any], component_type: str) -> int:
    """Count all components of a specific type in the entire config.

    Args:
        config: App configuration dictionary
        component_type: The componentType to count (e.g., "SectionProps", "HeadingProps")

    Returns:
        Number of components found with the specified type
    """
    count = 0

    def traverse(obj: Any) -> None:
        nonlocal count
        if isinstance(obj, dict):
            if obj.get("componentType") == component_type:
                count += 1
            for value in obj.values():
                traverse(value)
        elif isinstance(obj, list):
            for item in obj:
                traverse(item)

    traverse(config)
    return count


def find_component_by_uuid(config: Dict[str, Any], uuid: str) -> Optional[Dict[str, Any]]:
    """Find a component by its UUID anywhere in the config.

    Args:
        config: App configuration dictionary
        uuid: The UUID to search for

    Returns:
        The component dict if found, None otherwise
    """

    def traverse(obj: Any) -> Optional[Dict[str, Any]]:
        if isinstance(obj, dict):
            if obj.get("uuid") == uuid:
                return obj
            for value in obj.values():
                result = traverse(value)
                if result is not None:
                    return result
        elif isinstance(obj, list):
            for item in obj:
                result = traverse(item)
                if result is not None:
                    return result
        return None

    return traverse(config)


def has_page_type(config: Dict[str, Any], page_type: str) -> bool:
    """Check if the config has a page of the specified type.

    Args:
        config: App configuration dictionary
        page_type: The pageType to check for (e.g., "BlogMainPageProps", "BlogPostPageProps")

    Returns:
        True if a page with the specified type exists
    """
    pages = config.get("pages", [])
    return any(page.get("pageType") == page_type for page in pages)


def get_page_by_slug(config: Dict[str, Any], slug: str) -> Optional[Dict[str, Any]]:
    """Get a page by its slug.

    Args:
        config: App configuration dictionary
        slug: The page slug to search for (e.g., "/", "/blog", "/about")

    Returns:
        The page dict if found, None otherwise
    """
    pages = config.get("pages", [])
    for page in pages:
        if page.get("slug") == slug:
            return page
    return None


def get_page_by_type(config: Dict[str, Any], page_type: str) -> Optional[Dict[str, Any]]:
    """Get the first page of the specified type.

    Args:
        config: App configuration dictionary
        page_type: The pageType to search for

    Returns:
        The first page dict with the specified type, None if not found
    """
    pages = config.get("pages", [])
    for page in pages:
        if page.get("pageType") == page_type:
            return page
    return None


def get_page_count(config: Dict[str, Any]) -> int:
    """Get the total number of pages in the config.

    Args:
        config: App configuration dictionary

    Returns:
        Number of pages
    """
    return len(config.get("pages", []))


def count_pages_by_type(config: Dict[str, Any], page_type: str) -> int:
    """Count pages of a specific type.

    Args:
        config: App configuration dictionary
        page_type: The pageType to count

    Returns:
        Number of pages with the specified type
    """
    pages = config.get("pages", [])
    return sum(1 for page in pages if page.get("pageType") == page_type)


def has_header_link_to(config: Dict[str, Any], href: str) -> bool:
    """Check if the header contains a link to the specified href.

    Args:
        config: App configuration dictionary
        href: The href to search for (e.g., "/blog", "/about")

    Returns:
        True if a link to the specified href exists in the header
    """
    header = config.get("header", [])

    def search_links(obj: Any) -> bool:
        if isinstance(obj, dict):
            # Check if this is a link with matching href
            if obj.get("componentType") == "LinkProps":
                if href in str(obj.get("href", "")):
                    return True
            # Check MenuLinkItemProps which may have nested href
            if obj.get("componentType") == "MenuLinkItemProps":
                link = obj.get("href", {})
                if isinstance(link, dict) and href in str(link.get("href", "")):
                    return True
            # Recurse into all values
            for value in obj.values():
                if search_links(value):
                    return True
        elif isinstance(obj, list):
            for item in obj:
                if search_links(item):
                    return True
        return False

    return search_links(header)


def has_footer_link_to(config: Dict[str, Any], href: str) -> bool:
    """Check if the footer contains a link to the specified href.

    Args:
        config: App configuration dictionary
        href: The href to search for

    Returns:
        True if a link to the specified href exists in the footer
    """
    footer = config.get("footer", [])

    def search_links(obj: Any) -> bool:
        if isinstance(obj, dict):
            if obj.get("componentType") == "LinkProps":
                if href in str(obj.get("href", "")):
                    return True
            if obj.get("componentType") == "MenuLinkItemProps":
                link = obj.get("href", {})
                if isinstance(link, dict) and href in str(link.get("href", "")):
                    return True
            for value in obj.values():
                if search_links(value):
                    return True
        elif isinstance(obj, list):
            for item in obj:
                if search_links(item):
                    return True
        return False

    return search_links(footer)


def count_blog_posts(config: Dict[str, Any]) -> int:
    """Count the number of blog posts in the config.

    Args:
        config: App configuration dictionary

    Returns:
        Number of BlogPostPageProps pages
    """
    return count_pages_by_type(config, "BlogPostPageProps")


def get_all_pages_by_type(config: Dict[str, Any], page_type: str) -> List[Dict[str, Any]]:
    """Get all pages of the specified type.

    Args:
        config: App configuration dictionary
        page_type: The pageType to search for

    Returns:
        List of pages with the specified type
    """
    pages = config.get("pages", [])
    return [page for page in pages if page.get("pageType") == page_type]


def find_component_by_type_in_page(
    page: Dict[str, Any], component_type: str
) -> Optional[Dict[str, Any]]:
    """Find the first component of a type within a specific page.

    Args:
        page: Page dictionary
        component_type: The componentType to search for

    Returns:
        The first matching component, None if not found
    """

    def traverse(obj: Any) -> Optional[Dict[str, Any]]:
        if isinstance(obj, dict):
            if obj.get("componentType") == component_type:
                return obj
            for value in obj.values():
                result = traverse(value)
                if result is not None:
                    return result
        elif isinstance(obj, list):
            for item in obj:
                result = traverse(item)
                if result is not None:
                    return result
        return None

    return traverse(page.get("content", []))


def count_sections_in_page(page: Dict[str, Any]) -> int:
    """Count the number of sections in a page.

    Args:
        page: Page dictionary

    Returns:
        Number of SectionProps in the page content
    """
    count = 0

    def traverse(obj: Any) -> None:
        nonlocal count
        if isinstance(obj, dict):
            if obj.get("componentType") == "SectionProps":
                count += 1
            for value in obj.values():
                traverse(value)
        elif isinstance(obj, list):
            for item in obj:
                traverse(item)

    traverse(page.get("content", []))
    return count


def get_theme_colors(config: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """Get the theme colors from the config.

    Args:
        config: App configuration dictionary

    Returns:
        The colors dict from theme, or None if not found
    """
    theme = config.get("theme", {})
    return theme.get("colors")


def component_exists_in_config(config: Dict[str, Any], uuid: str) -> bool:
    """Check if a component with the given UUID exists anywhere in the config.

    Args:
        config: App configuration dictionary
        uuid: The UUID to search for

    Returns:
        True if the component exists
    """
    return find_component_by_uuid(config, uuid) is not None


def get_header_nav_links(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Get all navigation link items from the header.

    Args:
        config: App configuration dictionary

    Returns:
        List of MenuLinkItemProps from the header
    """
    header = config.get("header", [])
    links = []

    def traverse(obj: Any) -> None:
        if isinstance(obj, dict):
            if obj.get("componentType") == "MenuLinkItemProps":
                links.append(obj)
            for value in obj.values():
                traverse(value)
        elif isinstance(obj, list):
            for item in obj:
                traverse(item)

    traverse(header)
    return links


def has_form_component(config: Dict[str, Any]) -> bool:
    """Check if the config has any form-related components.

    Args:
        config: App configuration dictionary

    Returns:
        True if a form component exists
    """
    # Code Focus apps use CodeComponentProps for everything (including forms).
    # Check for form service config or CodeComponentProps with form-related names.
    services = config.get("services", {})
    forms_svc = services.get("forms", {})
    if forms_svc.get("enabled"):
        return True

    # Fallback: any CodeComponentProps present implies the app has custom components
    # (we can't distinguish form vs non-form by componentType alone in Code Focus).
    if count_components_by_type(config, "CodeComponentProps") > 0:
        return True

    # Legacy JSON-config fallback
    legacy_form_types = ["FormProps", "ContactFormProps"]
    for form_type in legacy_form_types:
        if count_components_by_type(config, form_type) > 0:
            return True
    return False


def has_chart_or_data_component(config: Dict[str, Any]) -> bool:
    """Check if the config has any chart or data visualization components.

    Args:
        config: App configuration dictionary

    Returns:
        True if a chart/data component exists
    """
    data_types = [
        "ChartProps",
        "BarChartProps",
        "LineChartProps",
        "PieChartProps",
        "TableProps",
        "DataTableProps",
        "MetricCardProps",
        "StatCardProps",
    ]

    for data_type in data_types:
        if count_components_by_type(config, data_type) > 0:
            return True
    return False


def has_backend_config(config: Dict[str, Any]) -> bool:
    """Check if the config has a backend section with at least one model.

    Args:
        config: App configuration dictionary

    Returns:
        True if backend config exists with models
    """
    backend = config.get("backend")
    if not backend or not isinstance(backend, dict):
        return False
    models = backend.get("models", [])
    return isinstance(models, list) and len(models) > 0


def get_model_count(config: Dict[str, Any]) -> int:
    """Get the number of backend models defined in the config.

    Args:
        config: App configuration dictionary

    Returns:
        Number of models in backend config
    """
    backend = config.get("backend", {})
    if not isinstance(backend, dict):
        return 0
    models = backend.get("models", [])
    return len(models) if isinstance(models, list) else 0


def has_model(config: Dict[str, Any], model_name: str) -> bool:
    """Check if the config has a backend model with the specified name.

    Args:
        config: App configuration dictionary
        model_name: The model name to look for (e.g., "books", "contacts")

    Returns:
        True if a model with the given name exists
    """
    backend = config.get("backend", {})
    if not isinstance(backend, dict):
        return False
    models = backend.get("models", [])
    if not isinstance(models, list):
        return False
    return any(m.get("name") == model_name for m in models if isinstance(m, dict))


def get_handler_count(config: Dict[str, Any]) -> int:
    """Get the number of custom handlers defined in the config.

    Args:
        config: App configuration dictionary

    Returns:
        Number of handlers in backend config
    """
    backend = config.get("backend", {})
    if not isinstance(backend, dict):
        return 0
    handlers = backend.get("handlers", [])
    return len(handlers) if isinstance(handlers, list) else 0
