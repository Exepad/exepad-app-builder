"""
validation — Modular validation library for WebAppProps and BackendProps.

Public API re-exports for backward compatibility.
Existing `from validation import validate_app_config` still works.
"""

# Core orchestrator
from .core import validate_app_config

# Backend validation
from .backend import validate_backend_props, validate_backend_config

# Logic validation
from .logic import validate_logic_config

# Type detection
from .type_detection import detect_target_type

# Component validation
from .components import (
    validate_icon_list,
    validate_single_icon_name,
    SKIP_VALIDATION_COMPONENTS,
    COMPONENT_TYPE_ALIASES,
    SCAFFOLD_COMPONENT_TYPES,
)

# Theme validation
from .theme import (
    validate_hex_color,
    hex_to_rgb,
    get_relative_luminance,
    get_contrast_ratio,
    validate_color_contrast,
    validate_chart_colors,
    validate_hsl_lightness_contrast,
    validate_font_list,
    validate_single_font_family,
    validate_font_variant,
    validate_google_fonts_url,
    validate_webapp_fonts,
    validate_webapp_theme,
)

# Frontend validation
from .frontend import (
    validate_expression_syntax,
    validate_expression_references,
    validate_all_expressions,
    validate_action_references,
    _extract_defined_actions,
)

# Binding & reference validation
from .bindings import validate_all_bindings

# Code Focus component validation — moved to apps/agent/main_agent/services/validation/
# The agent-side pipeline provides richer validation with syntax checking, auto-fix,
# CSS compilation, and LLM regeneration. See semantic_validator.py + code_focus_validator.py.

# Scaffold validation
from .scaffold import (
    validate_scaffold_config,
    auto_fix_scaffold_config,
    SCAFFOLD_TYPES as SCAFFOLD_VALIDATION_TYPES,
)
