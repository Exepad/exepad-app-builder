"""Utility modules for E2E tests."""

from .sse_parser import (
    # Async SSE parsing (for httpx with real server)
    parse_sse_stream_async,
    stream_sse_events,
    # Sync SSE parsing (legacy, for TestClient)
    parse_sse_response,
    parse_sse_stream,
    # Event helpers
    get_events_by_type,
    get_events_by_action,
    get_final_app_config,
    get_chat_response,
    get_page_reload_slug,
    get_backend_response,
    extract_app_config_from_backend_response,
    assert_workflow_completed,
    assert_app_config_saved,
    extract_progress_messages,
    SSEEvent,
)

from .result_writer import ResultWriter

from .validators import (
    ValidationResult,
    ValidationReport,
    run_sse_validations,
    validate_has_progress_events,
    validate_progress_sequence,
    validate_workflow_lifecycle,
    validate_timestamps,
    validate_has_chat_response,
    validate_chat_content,
    validate_no_errors,
    validate_app_config_updated,
    # App config helpers
    count_components_by_type,
    find_component_by_uuid,
    has_page_type,
    get_page_by_slug,
    get_page_by_type,
    get_page_count,
    count_pages_by_type,
    has_header_link_to,
    has_footer_link_to,
    count_blog_posts,
    get_all_pages_by_type,
    find_component_by_type_in_page,
    count_sections_in_page,
    get_theme_colors,
    component_exists_in_config,
    get_header_nav_links,
    has_form_component,
    has_chart_or_data_component,
    has_backend_config,
    get_model_count,
    has_model,
    get_handler_count,
)

from .validation_runner import (
    ValidationRunner,
    validate_test_results,
)

__all__ = [
    # SSE Parser - Async (primary for httpx)
    "parse_sse_stream_async",
    "stream_sse_events",
    # SSE Parser - Sync (legacy)
    "parse_sse_response",
    "parse_sse_stream",
    # SSE Parser - Helpers
    "get_events_by_type",
    "get_events_by_action",
    "get_final_app_config",
    "get_chat_response",
    "get_page_reload_slug",
    "get_backend_response",
    "extract_app_config_from_backend_response",
    "assert_workflow_completed",
    "assert_app_config_saved",
    "extract_progress_messages",
    "SSEEvent",
    # Result Writer
    "ResultWriter",
    # Validators - SSE
    "ValidationResult",
    "ValidationReport",
    "run_sse_validations",
    "validate_has_progress_events",
    "validate_progress_sequence",
    "validate_workflow_lifecycle",
    "validate_timestamps",
    "validate_has_chat_response",
    "validate_chat_content",
    "validate_no_errors",
    "validate_app_config_updated",
    # Validators - App Config Helpers
    "count_components_by_type",
    "find_component_by_uuid",
    "has_page_type",
    "get_page_by_slug",
    "get_page_by_type",
    "get_page_count",
    "count_pages_by_type",
    "has_header_link_to",
    "has_footer_link_to",
    "count_blog_posts",
    "get_all_pages_by_type",
    "find_component_by_type_in_page",
    "count_sections_in_page",
    "get_theme_colors",
    "component_exists_in_config",
    "get_header_nav_links",
    "has_form_component",
    "has_chart_or_data_component",
    "has_backend_config",
    "get_model_count",
    "has_model",
    "get_handler_count",
    # Validation Runner
    "ValidationRunner",
    "validate_test_results",
]
