"""
Core validation orchestrator — schema loading, base infrastructure, validate_app_config().

Delegates domain-specific validation to sibling modules:
  - type_detection: auto-detect JSON config type
  - components: icon name validation
  - theme: color/font/contrast validation
  - frontend: expression syntax, action references
  - backend: BackendProps schema validation
"""

import json
import logging
import os
from typing import Any

from jsonschema import validators, RefResolver, FormatChecker

logger = logging.getLogger(__name__)

from .type_detection import detect_target_type
from .components import (
    validate_single_icon_name,
    SKIP_VALIDATION_COMPONENTS,
    COMPONENT_TYPE_ALIASES,
    SCAFFOLD_COMPONENT_TYPES,
    RUNTIME_REGISTERED_TYPES,
)
from .theme import validate_webapp_fonts, validate_webapp_theme
from .frontend import (
    validate_all_expressions,
    validate_action_references,
    validate_data_bindings,
    _extract_defined_actions,
)
from .bindings import validate_all_bindings


# Schema paths
_current_dir = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR = os.path.normpath(os.path.join(_current_dir, '..', '..', '..', 'data'))
CATALOG_PATH_ABS = os.path.join(_DATA_DIR, 'full_schema_model', 'full_catalog.json')
LEAPDO_SCHEMA_PATH_ABS = os.path.join(_DATA_DIR, 'full_schema_model', 'full_schema.json')
APP_SCHEMA_PATH_ABS = os.path.join(_DATA_DIR, 'full_schema_model', 'full_schema.json')


def validate_app_config(app_config_str: str, target_type: str | None = None) -> dict:
    """
    Validates a complete JSON configuration against app and component schemas.

    This tool strips markdown fences, parses the JSON string, auto-detects the root
    component type, and validates the entire JSON configuration (including all nested
    components) against the combined component and app schemas. It will attempt to
    repair broken JSON using json_repair if initial parsing fails.

    Supported target types:
    - WebAppProps: Full web application configuration
    - WebPageProps: Individual web page configuration
    - BlogMainPageProps: Blog listing page configuration
    - BlogPostPageProps: Individual blog post page configuration
    - ComponentProps: Generic component (auto-detects specific type)
    - None (default): Auto-detect the type from the JSON structure

    Args:
        app_config_str (str): JSON string to validate. May include markdown code fences.
        target_type (str | None): The expected root type of the JSON configuration
                          (e.g., "WebPageProps", "WebAppProps", "BlogMainPageProps").
                          If None or not provided, the type will be auto-detected.

    Returns:
        dict: Dictionary with "valid" (bool) and "errors" (list[str]) keys.
              {"valid": True, "errors": []} if valid, otherwise {"valid": False, "errors": [...]}
              with error messages indicating location and nature of validation failures.

    Example:
        >>> # Auto-detect type
        >>> result = validate_app_config('{"uuid": "123", ...}')
        >>> # Or specify expected type
        >>> result = validate_app_config('{"uuid": "123", ...}', "WebPageProps")
        >>> if result["valid"]:
        >>>     print("Valid!")
        >>> else:
        >>>     print(f"Errors: {result['errors']}")

    Note:
        - This function automatically detects the root component type if not specified
        - Validates ALL nested components recursively
        - Attempts JSON repair if initial parsing fails
        - Returns detailed error messages for debugging
    """
    if target_type is None:
        logger.debug("Auto-detecting target type...")
    else:
        logger.debug("Validating with target type: %s", target_type)

    # 1) Strip markdown fences and whitespace
    clean_str = app_config_str.replace('```json', '').replace('```', '').strip()
    errors: list[str] = []
    app_config = ""
    is_valid_json = False

    # 2) Parse JSON
    try:
        app_config = json.loads(clean_str)
        is_valid_json = True
    except json.JSONDecodeError as e:
        errors.append(f"Invalid JSON: {e.msg} at line {e.lineno}, column {e.colno}'")
        errors.append(
            f"- The JSON you provided cannot be decoded. "
            f"- Rebuild the JSON from scratch. "
            f"- Forget about the previous response and generate a new response for the last request again.\n"
            f"### Validation Errors:\n"
            f"{e.msg} at line {e.lineno}, column {e.colno}'"
        )
        return {"valid": False, "errors": errors}
    except Exception as e:
        errors.append(f"Invalid JSON: {e}")

    if not is_valid_json:
        return {"valid": False, "errors": errors}

    if not isinstance(app_config, dict):
        errors.append("Root JSON must be an object. Detected type: " + str(type(app_config)))
        return {"valid": False, "errors": errors}

    # 3) Auto-detect target_type using the multi-strategy detection system
    try:
        with open(APP_SCHEMA_PATH_ABS) as f:
            schema_for_detection = json.load(f)
        schema_definitions = schema_for_detection.get("definitions", {})
    except (FileNotFoundError, json.JSONDecodeError):
        schema_definitions = None

    detection_result = detect_target_type(app_config, schema_definitions)

    if detection_result["warnings"]:
        for warning in detection_result["warnings"]:
            logger.debug("Detection warning: %s", warning)

    if detection_result["error"]:
        errors.append(detection_result["error"])
        return {"valid": False, "errors": errors}

    target_type_detected = detection_result["type"]

    if target_type_detected is None:
        errors.append("Cannot detect JSON object type. Check the JSON structure and try again.")
        return {"valid": False, "errors": errors}

    logger.debug(
        "Type detected: %s (method: %s, confidence: %s)",
        target_type_detected, detection_result['method'], detection_result['confidence'],
    )

    if target_type is not None and target_type_detected != target_type:
        errors.append(
            f"Invalid object type detected: ({target_type_detected}) does not match "
            f"expected type ({target_type}). You must generate a {target_type} object."
        )

    validation_type = target_type if target_type is not None else target_type_detected
    logger.debug("Using type for validation: %s", validation_type)

    # 4) Load schemas
    try:
        with open(LEAPDO_SCHEMA_PATH_ABS) as f:
            comp_schema = json.load(f)
        with open(APP_SCHEMA_PATH_ABS) as f:
            app_schema = json.load(f)
    except FileNotFoundError as e:
        return {"valid": False, "errors": [f"Schema file not found: {e.filename}"]}

    comp_id = comp_schema.get("$id", "leapdo_schema.json")
    app_id = app_schema.get("$id", "app_schema.json")
    schema_store = {comp_id: comp_schema, app_id: app_schema}
    resolver = RefResolver.from_schema(app_schema, store=schema_store)

    validator_cls = validators.validator_for(app_schema)
    validator_cls.check_schema(app_schema)

    app_defs = app_schema.get("definitions", {})
    comp_defs = comp_schema.get("definitions", {})

    # Helper: validate one dict against its definition and collect all errors
    def _validate_inst(inst: Any, comp_type: str, loc: str):
        # Resolve aliases (e.g. CalloutProps -> AlertItemProps)
        resolved = COMPONENT_TYPE_ALIASES.get(comp_type, comp_type)

        # Skip scaffold types (valid at runtime, no JSON schema)
        if resolved in SCAFFOLD_COMPONENT_TYPES:
            return

        if resolved in app_defs:
            ref = f"{app_id}#/definitions/{resolved}"
        elif resolved in comp_defs:
            ref = f"{comp_id}#/definitions/{resolved}"
        else:
            errors.append(f"[{loc}] Unknown componentType '{comp_type}'")
            return

        v = validator_cls(
            schema={"$ref": ref},
            resolver=resolver,
            format_checker=FormatChecker()
        )
        for e in sorted(v.iter_errors(inst), key=lambda e: e.path):
            path = " -> ".join(str(p) for p in e.path) or "<self>"
            errors.append(
                f"[{loc}:{comp_type}] error at '{path}': {e.message} (value={e.instance!r})"
            )

        # Special validation for IconProps — validate icon name against Lucide icons
        if comp_type == "IconProps" and isinstance(inst, dict):
            icon_name = inst.get("name")
            if icon_name and isinstance(icon_name, str):
                icon_error = validate_single_icon_name(icon_name)
                if icon_error:
                    errors.append(f"[{loc}:IconProps] {icon_error}")

    # 5) Recursively traverse and validate every component, including root
    found_component_types: dict[str, str] = {}  # componentType -> first location

    def _recurse(node: Any, loc: str, parent_key: str = ""):
        # Skip form fields, actions, and fieldOverrides (partial override objects
        # that are auto-completed at runtime with name/uuid/bindTo)
        if parent_key in ["fields", "actions", "fieldOverrides"]:
            return

        if loc == "root":
            if validation_type not in SKIP_VALIDATION_COMPONENTS:
                _validate_inst(node, validation_type, loc)
            # Special handling for WebAppProps fonts and theme
            if validation_type == "WebAppProps" and isinstance(node, dict):
                validate_webapp_fonts(node, loc, errors)
                validate_webapp_theme(node, loc, errors)
        elif isinstance(node, dict) and "componentType" in node:
            component_type = node["componentType"]
            if component_type not in found_component_types:
                found_component_types[component_type] = loc
            if component_type not in SKIP_VALIDATION_COMPONENTS:
                _validate_inst(node, component_type, loc)

        if isinstance(node, dict):
            for key, val in node.items():
                child_loc = f"{loc}.{key}" if loc != "root" else key
                _recurse(val, child_loc, key)
        elif isinstance(node, list):
            for idx, item in enumerate(node):
                _recurse(item, f"{loc}[{idx}]", parent_key)

    _recurse(app_config, "root")

    # 5b) Validate component types against runtime registry
    for comp_type, first_loc in found_component_types.items():
        if comp_type not in RUNTIME_REGISTERED_TYPES:
            errors.append(
                f"[{first_loc}:registry] componentType '{comp_type}' is not registered "
                f"in the runtime (apps/runtime/client/src/registry/index.ts)"
            )

    # 6) Validate expressions ({{state.xxx}}, {{computed.xxx}}, etc.)
    state_fields: set = set()
    computed_fields: set = set()

    if isinstance(app_config, dict):
        # Try new nested format first: frontend.logic.state/computed
        frontend = app_config.get('frontend', {})
        if isinstance(frontend, dict):
            logic = frontend.get('logic', {})
            if isinstance(logic, dict):
                state_def = logic.get('state', {})
                if isinstance(state_def, dict):
                    if 'fields' in state_def:
                        fields_def = state_def.get('fields', {})
                        if isinstance(fields_def, dict):
                            state_fields = set(fields_def.keys())
                    else:
                        state_fields = set(state_def.keys())

                computed_def = logic.get('computed', {})
                if isinstance(computed_def, dict):
                    computed_fields = set(computed_def.keys())

        # Fallback to legacy flat format
        if not state_fields:
            state_def = app_config.get('state', {})
            if isinstance(state_def, dict):
                if 'fields' in state_def:
                    fields_def = state_def.get('fields', {})
                    if isinstance(fields_def, dict):
                        state_fields = set(fields_def.keys())
                else:
                    state_fields = set(state_def.keys())

        if not computed_fields:
            computed_def = app_config.get('computed', {})
            if isinstance(computed_def, dict):
                computed_fields = set(computed_def.keys())

    expr_errors, expr_warnings = validate_all_expressions(
        app_config,
        state_fields if state_fields else None,
        computed_fields if computed_fields else None
    )

    errors.extend(expr_errors)

    for warning in expr_warnings:
        logger.debug("Expression warning: %s", warning)

    # 7) Validate action references (ActionTrigger objects in components)
    if validation_type == "WebAppProps" and isinstance(app_config, dict):
        defined_actions = _extract_defined_actions(app_config)
        action_ref_errors = validate_action_references(app_config, defined_actions)
        errors.extend(action_ref_errors)

        if action_ref_errors:
            logger.debug("Found %d undefined action reference(s)", len(action_ref_errors))

    # 8) Cross-validate data bindings (DataTable columns, actionIds, unused computed/handlers)
    binding_warnings = []
    if validation_type == "WebAppProps" and isinstance(app_config, dict):
        binding_errors, binding_warnings = validate_data_bindings(app_config)
        errors.extend(binding_errors)

        if binding_errors:
            logger.debug("Found %d data binding error(s)", len(binding_errors))
        for warning in binding_warnings:
            logger.debug("Data binding warning: %s", warning)

    # 9) Validate bindings and references ($, model.X, handler.X, slugs, etc.)
    ref_warnings: list[str] = []
    if validation_type == "WebAppProps" and isinstance(app_config, dict):
        ref_errors, ref_warnings = validate_all_bindings(
            app_config, state_fields, computed_fields
        )
        errors.extend(ref_errors)

        if ref_errors:
            logger.debug("Found %d binding/reference error(s)", len(ref_errors))
        for warning in ref_warnings:
            logger.debug("Binding warning: %s", warning)

    # Return result
    is_valid = len(errors) == 0
    errors_str = "\n".join(errors) if errors else ""

    # Collect all warnings (expression reference warnings + detection warnings + binding warnings)
    all_warnings = list(expr_warnings)
    all_warnings.extend(binding_warnings)
    all_warnings.extend(ref_warnings)
    if detection_result.get("warnings"):
        all_warnings.extend(detection_result["warnings"])

    logger.debug("is_valid: %s", is_valid)
    if errors_str:
        logger.debug("errors_str: %s", errors_str)

    return {"valid": is_valid, "errors": errors, "warnings": all_warnings}
