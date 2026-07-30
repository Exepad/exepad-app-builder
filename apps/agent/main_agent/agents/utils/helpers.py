"""
Re-export shim for backwards compatibility.

The functions that lived here have been split into domain modules:
  - state_ops.py      — session state mutations, prompt forwarding, response parsing
  - component_tree.py — find/replace/remove/modify operations on component trees
  - json_repair.py    — JSON extraction, repair, diagnostics

All existing imports from this module continue to work.
"""

# --- state_ops ---
from main_agent.agents.utils.state_ops import (  # noqa: F401
    push_session_state_update,
    push_prompt_to_next_agent,
    parse_result_chat_response,
)

# --- component_tree ---
from main_agent.agents.utils.component_tree import (  # noqa: F401
    find_component_by_uuid,
    find_page_type_with_uuid,
    get_page_slug_by_uuid,
    find_component_with_location,
    replace_component_by_uuid,
    remove_component_by_uuid,
    modify_component_field_by_uuid,
    apply_quick_actions,
)

# --- json_repair ---
from main_agent.agents.utils.json_repair import (  # noqa: F401
    analyze_bracket_balance,
    diagnose_json_error,
    extract_json_from_string,
    repair_json_string,
    safe_app_config_load,
    _parse_json_strings_recursively,
)
