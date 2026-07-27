"""
Centralized constants for the exepad-agent codebase.

Replaces magic strings throughout the codebase with type-safe constants.
All session state keys and component types are defined here.
"""

from enum import Enum
from typing import Literal


# =============================================================================
# Diagnostic Profile (Surveyor agent)
# =============================================================================

# Profile values match AgentSkills.io spec ([a-z0-9-]+, no underscores) so the
# string doubles as the on-disk skill directory name and SKILL.md frontmatter
# `name`. Imported by both shared/subagents/app_help_desk.py (which classifies
# the profile) and webapp/subagents/surveyor.py (which loads the skill).
ProfileLiteral = Literal[
    "bug-root-cause",
    "integration-context",
    "referent-and-current-state",
    "cascade-enumeration",
    "performance-audit",
    "a11y-audit",
    "none",
]

# =============================================================================
# Session State Keys
# =============================================================================


class StateKeys:
    """All session state key constants. Use these instead of raw strings.

    ADK Note: Keys prefixed with 'temp:' are invocation-scoped and auto-cleared.
    """

    # --- App Configuration ---
    APP_CONFIG = "app_config"
    APP_CONFIG_EDITOR_PROCESSING = "app_config_editor_processing"
    APP_CONFIG_GENERATED = "app_config_generated"
    APP_CONFIG_INTERMEDIATE = "app_config_intermediate"
    APP_CONFIG_POST_PROCESSED = "app_config_post_processed"
    INITIAL_APP_CONFIG_FOR_COMPARISON = "initial_app_config_for_comparison"

    # --- App Identity ---
    APP_UUID = "app_uuid"
    APP_NAME = "app_name"
    APP_TYPE = "app_type"
    APP_LANGUAGE_CODE = "app_language_code"
    APP_BUILDING_PLAN = "app_building_plan"
    APP_NAVIGATION_BUILDING_PLAN = "app_navigation_building_plan"
    APP_PAGES_BUILDING_PLAN_LIST = "app_pages_building_plan_list"
    PROJECT_NAME = "project_name"
    INITIAL_DESCRIPTION = "initial_description"

    # --- Core Control ---
    OPERATION_MODE = "operation_mode"
    BUILD_MODE = "build_mode"
    # DesignBundle handle (Stitch / Claude Design imports). When
    # present, the ImporterDispatcher fetches the bundle manifest from the
    # backend and routes through the DesignImporter before PreCreator.
    DESIGN_BUNDLE_ID = "design_bundle_id"

    # --- Creator / Editor State Keys ---
    CREATOR_PLAN = "creator_plan"
    DESIGN_SYSTEM = "design_system_plan"
    EDIT_PLAN = "edit_plan"
    # Source of the EDIT_PLAN dict. Default semantic when unset is
    # "editor" (Editor LLM produced it). When DesignImportWorkflow
    # synthesizes the plan upstream it sets "design_import" so
    # EditingWorkflow can skip the Editor LLM.
    EDIT_PLAN_SOURCE = "edit_plan_source"
    RESOLVED_THEME_PALETTE = "resolved_theme_palette"
    THEME_SOURCE_HASH = "theme_source_hash"
    THEME_PALETTE_SOURCE = "theme_palette_source"

    ACTION_LABEL = "action_label"
    ACTION_PAYLOAD = "action_payload"
    WORKFLOW_TYPE = "workflow_type"
    CURRENT_PROMPT = "current_prompt"
    USER_PROMPT = "user_prompt"
    CORRELATION_ID = "correlation_id"
    IS_TEST = "is_test"
    IS_APP_CREATED = "is_app_created"
    IS_FIRST_APP_CREATION = "is_first_app_creation"

    # --- Current Context ---
    CURRENT_PAGE_UUID = "current_page_uuid"
    CURRENT_PAGE_TYPE = "current_page_type"
    SELECTED_COMPONENT = "selected_component"
    SELECTED_COMPONENT_CONFIG = "selected_component_config"
    SELECTED_COMPONENT_LOCATION = "selected_component_location"

    # --- Agent Outputs ---
    APP_HELP_DESK_OUTPUT = "app_help_desk_output"
    RESULT_CHAT_RESPONSE = "result_chat_response"
    RESULT_RESPONSE_WRITER_PROMPT = "result_response_writer_prompt"
    LAST_PROMPT_TO_AGENT = "last_prompt_to_agent"

    # --- Surveyor (diagnostic pre-pass) ---
    # Set by core._handle_edit before invoking the Surveyor; consumed by
    # surveyor_instruction_provider to load the right SKILL.md profile.
    DIAGNOSTIC_PROFILE = "diagnostic_profile"
    # Output of the Surveyor agent (DiagnosticReport as dict). Read by
    # editing_workflow._plan_edits and threaded into EditorInput.
    DIAGNOSTIC_REPORT = "diagnostic_report"
    # Edit-turn counter pushed to state by core._run_surveyor before invocation.
    # Used by surveyor_instruction_provider for the "turn N" prompt fact and
    # by the after_agent_callback to name the persisted artifact
    # (diagnostic_report:{N}.json) for prior_turn_diagnosis_tool to find later.
    DIAGNOSTIC_TURN_INDEX = "diagnostic_turn_index"

    # --- Chat & Messages ---
    CHAT_HISTORY = "chat_history"
    CHAT_RESPONSE = "chat_response"
    CONVERSATION_MESSAGE_SUMMARY = "conversation_message_summary"
    USER_LANGUAGE_CODE = "user_language_code"

    # --- Decline / Refusal ---
    # Set by gate agents (PreCreator on create, AppHelpDesk on edit)
    # when a request is refused under the safety/refusal rules. Downstream
    # classifiers use these to send status="declined" to the backend
    # (no credits, no app save) and to skip the build-failure UX.
    DECLINE_REASON = "decline_reason"
    DECLINE_CATEGORY = "decline_category"

    # --- Flags & Control ---
    SAVE_APP_CONFIG = "save_app_config"
    RELOAD_APP = "reload_app"
    GOTO_PAGE_SLUG = "goto_page_slug"
    CHANGED_COMPONENT_UUID = "changed_component_uuid"
    CHANGE_TYPE = "change_type"
    CHANGED_PAGE_UUID = "changed_page_uuid"

    # --- Page Operations ---
    PAGES_TO_ADD = "pages_to_add"
    PAGES_TO_UPDATE = "pages_to_update"
    PAGES_TO_DELETE = "pages_to_delete"
    APP_NEW_PAGE_STUB_FINAL = "app_new_page_stub_final"
    PAGE_ARTIFACTS_GENERATED = "page_artifacts_generated"

    # --- Editing Actions ---
    # Frontend cross-file work flows through FrontendBuildAction + dispatch
    # to ComponentBuilderMultiple. Title-only renames go through
    # RenamePageTitleAction. The legacy AddPageAction / ModifyPageMetadataAction
    # / RemovePageAction / ModifyComponentAction state keys were removed.
    FRONTEND_BUILD_ACTIONS = "frontend_build_actions"
    RENAME_PAGE_TITLE_ACTIONS = "rename_page_title_actions"
    MODIFY_LOGIC_ACTIONS = "modify_logic_actions"
    MODIFY_BACKEND_ACTIONS = "modify_backend_actions"
    MODIFY_THEME_ACTIONS = "modify_theme_actions"
    QUICK_ACTIONS = "quick_actions"

    # --- Assets & Content ---
    IMAGE_CATALOG = "image_catalog"
    DOCUMENT_CATALOG = "document_catalog"
    ASSETS_DIR = "assets_dir"
    APP_CONFIG_PATH = "app_config_path"

    # --- Progress & Metrics ---
    PROGRESS_NUMBER = "progress_number"
    TOTAL_TIME_TO_COMPLETE = "total_time_to_complete"
    WORKFLOW_START_TIME = "workflow_start_time"
    WORKFLOW_START_ISO = "workflow_start_iso"
    AGENT_METRICS = "agent_metrics"
    AGENT_TIMINGS = "agent_timings"
    CURRENT_AGENT = "current_agent"
    CURRENT_AGENT_START_TIME = "current_agent_start_time"
    CURRENT_AGENT_METRICS = "current_agent_metrics"
    CURRENT_AGENT_TOKENS = "current_agent_tokens"

    # --- Seed Data ---
    SEED_DATA_METADATA = "seed_data_metadata"
    # Phase 3.2 — Babel-shell data extractor stashes seed rows here
    # so SeedDataBuilder can short-circuit (use the original literal
    # rows verbatim instead of LLM-generating them). Shape:
    # ``{model_name: list[dict[str, Any]]}``.
    EXTRACTED_SEED_DATA = "extracted_seed_data"
    # Provenance tag per model in EXTRACTED_SEED_DATA. Shape:
    # ``{model_name: "data_ingest" | "design_import" | ...}``.
    # Set by extracted_seed_bridge (DataIngester path) and
    # read by backend_builder telemetry to attribute seeds.
    EXTRACTED_SEED_SOURCE = "extracted_seed_source"

    # --- Data Ingest (DataIngester pre-pass) ---
    # IngestReport (Pydantic dict) produced by Layer 2B. Saved by the
    # workflow as `data_ingest_report:{turn_index}.json` artifact for
    # cross-turn lookup; consumed by Creator (create-mode summary) and
    # Editor (edit-mode summary + target_mode decisions).
    DATA_INGEST_REPORT = "data_ingest_report"
    # Map of {raw_model_name: existing_model_name} for edit-mode append/replace.
    # Set by Layer 2B; read by EditingWorkflow._run_phase_ingest_data.
    INGEST_TARGET_MAPPINGS = "ingest_target_mappings"

    # --- Errors & Internal ---
    AGENT_ERRORS = "agent_errors"
    COMPONENT_FAILURE_DETAILS = "component_failure_details"
    UNRESOLVED_COMPONENTS = "unresolved_components"
    VALIDATION_FAILURE_CLASSES = "validation_failure_classes"
    VALIDATION_FAILURE_DETAILS = "validation_failure_details"
    SYSTEMIC_VALIDATION_ABORT = "systemic_validation_abort"
    TERMINAL_COMPONENT_SAVE_LATCHES = "terminal_component_save_latches"
    BACKEND_SAVE_RESULT = "_backend_save_result"
    # Pattern A: per-component retry history. Stores the auto-fixed
    # TSX, categorised fixes, and categorised errors for each save
    # attempt so the next ComponentBuilder turn anchors on the prior
    # baseline instead of regenerating from scratch.
    COMPONENT_RETRY_CONTEXT = "_component_retry_context"


# =============================================================================
# Component Types
# =============================================================================


class ComponentType(str, Enum):
    """Component type constants for type-safe comparisons."""

    # Page types
    WEB_PAGE = "WebPageProps"

    # App-level types
    WEB_APP = "WebAppProps"
    THEME = "ThemeProps"

    # Navigation components
    NAVBAR = "NavbarProps"
    NAVBAR_V2 = "NavbarV2Props"
    NAVIGATION = "NavigationProps"
    MENU_BAR = "MenuBarProps"
    MENU_BUTTON_ITEM = "MenuButtonItemProps"
    MENU_LINK_ITEM = "MenuLinkItemProps"
    FOOTER = "FooterProps"

    # Layout components
    SECTION = "SectionProps"
    CONTAINER = "BoxProps"
    FLEX = "FlexProps"
    GRID = "GridProps"

    # Interactive components
    BUTTON = "ButtonProps"
    LINK = "LinkProps"
    MODAL = "ModalProps"
    TABS = "TabsProps"
    CONDITIONAL = "ConditionalProps"
    DATA_TABLE = "DataTableProps"

    # Content components
    HEADING = "HeadingProps"
    TEXT = "TextProps"
    MARKDOWN_BLOCK = "MarkdownBlockProps"
    QUOTE_BLOCK = "QuoteBlockProps"
    CODE_SNIPPET = "CodeSnippetProps"
    TIMELINE_BLOCK = "TimelineBlockProps"
    COMPARISON_TABLE = "ComparisonTableProps"
    CALLOUT = "CalloutProps"

    # Media components
    ICON = "IconProps"
    IMAGE = "ImageProps"

    # Data components
    BADGE = "BadgeProps"
    CARD = "CardProps"
    CODE_COMPONENT = "CodeComponentProps"


# Navigation component types
NAV_COMPONENT_TYPES = frozenset(
    {
        ComponentType.NAVBAR,
        ComponentType.NAVBAR_V2,
        ComponentType.NAVIGATION,
        ComponentType.MENU_BAR,
    }
)

# Page-level component types
PAGE_TYPES = frozenset(
    {
        ComponentType.WEB_PAGE,
    }
)
