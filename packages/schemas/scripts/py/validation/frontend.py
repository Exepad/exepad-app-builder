"""
Frontend validation — expressions, action references.

Validates {{state.xxx}} / {{computed.xxx}} expression syntax and
verifies that action triggers reference defined actions.
"""

import json
import re


# =============================================================================
# EXPRESSION VALIDATION
# =============================================================================

# Pattern to match expression blocks {{...}}
EXPRESSION_PATTERN = re.compile(r'\{\{([^}]*)\}\}')

# Pattern to detect invalid characters immediately before {{
INVALID_PREFIX_PATTERN = re.compile(r'([^\s\w"\'\[\],:{}.])\{\{')

# Characters problematic as standalone prefix before {{
PROBLEMATIC_PREFIX_CHARS = set(['$', '@', '#', '`'])


def validate_expression_syntax(value: str, path: str) -> list[str]:
    """
    Validate expression syntax in a string value.

    Checks for:
    1. Invalid characters before {{ (like ${{ which breaks the lexer)
    2. Unbalanced braces within expressions
    3. Unbalanced quotes within expressions

    Args:
        value: The string value potentially containing expressions.
        path: The JSON path for error reporting.

    Returns:
        List of error messages (empty if valid).
    """
    errors = []

    # Check for invalid prefix characters before {{
    prefix_matches = INVALID_PREFIX_PATTERN.finditer(value)
    for match in prefix_matches:
        invalid_char = match.group(1)
        position = match.start()
        errors.append(
            f"[{path}] Invalid character '{invalid_char}' before '{{{{' at position {position}. "
            f"Move the character inside the expression or escape it. Value: {value[:60]}..."
        )

    # Find and validate each expression
    for match in EXPRESSION_PATTERN.finditer(value):
        expr_content = match.group(1)
        expr_start = match.start()

        if not expr_content.strip():
            errors.append(f"[{path}] Empty expression '{{{{}}}}' at position {expr_start}")
            continue

        paren_count = 0
        bracket_count = 0
        in_single_quote = False
        in_double_quote = False

        for i, char in enumerate(expr_content):
            if char == "'" and not in_double_quote:
                in_single_quote = not in_single_quote
            elif char == '"' and not in_single_quote:
                in_double_quote = not in_double_quote
            elif not in_single_quote and not in_double_quote:
                if char == '(':
                    paren_count += 1
                elif char == ')':
                    paren_count -= 1
                elif char == '[':
                    bracket_count += 1
                elif char == ']':
                    bracket_count -= 1

                if paren_count < 0:
                    errors.append(f"[{path}] Unbalanced ')' in expression at position {expr_start + i}")
                    break
                if bracket_count < 0:
                    errors.append(f"[{path}] Unbalanced ']' in expression at position {expr_start + i}")
                    break

        if paren_count > 0:
            errors.append(f"[{path}] Unclosed '(' in expression: {expr_content[:40]}...")
        if bracket_count > 0:
            errors.append(f"[{path}] Unclosed '[' in expression: {expr_content[:40]}...")
        if in_single_quote:
            errors.append(f"[{path}] Unclosed single quote in expression: {expr_content[:40]}...")
        if in_double_quote:
            errors.append(f"[{path}] Unclosed double quote in expression: {expr_content[:40]}...")

    return errors


def validate_expression_references(
    value: str, path: str, state_fields: set, computed_fields: set
) -> list[str]:
    """
    Validate that expression references point to defined state/computed fields.

    Args:
        value: The string value containing expressions.
        path: The JSON path for error reporting.
        state_fields: Set of defined state field names.
        computed_fields: Set of defined computed field names.

    Returns:
        List of warning messages for undefined references.
    """
    warnings = []
    state_ref_pattern = re.compile(r'\bstate\.(\w+)')
    computed_ref_pattern = re.compile(r'\bcomputed\.(\w+)')

    for match in EXPRESSION_PATTERN.finditer(value):
        expr_content = match.group(1)

        for state_match in state_ref_pattern.finditer(expr_content):
            field_name = state_match.group(1)
            base_field = field_name.split('.')[0] if '.' in field_name else field_name
            if state_fields and base_field not in state_fields:
                warnings.append(
                    f"[{path}] Expression references undefined state field 'state.{field_name}'. "
                    f"Defined fields: {', '.join(sorted(state_fields)[:10])}..."
                )

        for computed_match in computed_ref_pattern.finditer(expr_content):
            field_name = computed_match.group(1)
            if computed_fields and field_name not in computed_fields:
                warnings.append(
                    f"[{path}] Expression references undefined computed field 'computed.{field_name}'. "
                    f"Defined fields: {', '.join(sorted(computed_fields)[:10])}..."
                )

    return warnings


def _validate_dollar_expression(value: str, path: str) -> list[str]:
    """
    Validate $variable expression patterns and warn about common mistakes
    that the runtime parser may struggle with.

    Returns a list of warnings (not errors — the runtime now handles some of
    these via template string interpolation, but concatenation syntax is preferred).
    """
    warnings = []

    # Pattern: $var immediately followed by % at end-of-string or before
    # whitespace — almost certainly a "percentage display" template, not modulo
    if re.search(r'\$\w+%(?:\s|$)', value) or value.endswith('%'):
        if re.search(r'\$[a-zA-Z_]\w*%', value):
            warnings.append(
                f"[{path}] Expression '{value[:80]}' contains '$var%' which is "
                f"ambiguous (modulo vs percentage). Prefer: $var + '%'"
            )

    # Pattern: literal text before the first $ (not starting with operator/paren)
    # e.g. "Age: $state.ageDays days" or "Total: $computed.total"
    stripped = value.strip()
    first_dollar = stripped.find('$')
    if first_dollar > 0:
        prefix = stripped[:first_dollar].strip()
        # If prefix contains alphabetic chars, it's likely template-style text
        if prefix and re.search(r'[a-zA-Z]', prefix):
            warnings.append(
                f"[{path}] Expression '{value[:80]}' mixes literal text with "
                f"$variable references. Prefer string concatenation: "
                f"\"'prefix' + $var\""
            )

    # Pattern: bare alphabetic text after a $variable reference
    # e.g. "$count items", "$hunger points"
    after_var = re.search(
        r'\$[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*\s+([a-zA-Z]+)', value
    )
    if after_var and after_var.group(1) not in ('true', 'false', 'null'):
        warnings.append(
            f"[{path}] Expression '{value[:80]}' has bare text "
            f"'{after_var.group(1)}' after a $variable. "
            f"Prefer: $var + ' text'"
        )

    return warnings


def validate_all_expressions(
    json_data: dict,
    state_fields: set = None,
    computed_fields: set = None,
) -> tuple[list[str], list[str]]:
    """
    Recursively validate all expressions in a JSON object.

    Args:
        json_data: The parsed JSON object.
        state_fields: Optional set of defined state field names.
        computed_fields: Optional set of defined computed field names.

    Returns:
        Tuple of (errors, warnings).
    """
    errors = []
    warnings = []

    def scan_value(value, current_path):
        if isinstance(value, str):
            if '{{' in value:
                syntax_errors = validate_expression_syntax(value, current_path)
                errors.extend(syntax_errors)

                if state_fields is not None or computed_fields is not None:
                    ref_warnings = validate_expression_references(
                        value, current_path,
                        state_fields or set(),
                        computed_fields or set(),
                    )
                    warnings.extend(ref_warnings)

            # Validate $variable expression patterns for common mistakes
            elif re.search(r'\$[a-zA-Z_]', value):
                dollar_warnings = _validate_dollar_expression(value, current_path)
                warnings.extend(dollar_warnings)

        elif isinstance(value, dict):
            for k, v in value.items():
                scan_value(v, f"{current_path}.{k}")
        elif isinstance(value, list):
            for i, item in enumerate(value):
                scan_value(item, f"{current_path}[{i}]")

    scan_value(json_data, "root")
    return errors, warnings


# =============================================================================
# ACTION REFERENCE VALIDATION
# =============================================================================

# Properties that can contain ActionTrigger objects { "name": "actionName" }
ACTION_TRIGGER_PROPERTIES = {
    'action',
    'onChange',
    'onOpenChange',
    'onStepClick',
    'onStepChange',
    'onValueChange',
    'onSelect',
    'onCheckedChange',
    'onSubmit',
}


def _extract_defined_actions(app_config: dict) -> set:
    """
    Extract all action names defined in the app's actions object.

    Supports both:
    - New nested format: frontend.logic.actions
    - Legacy flat format: actions (at root level)
    """
    frontend = app_config.get('frontend', {})
    if isinstance(frontend, dict):
        logic = frontend.get('logic', {})
        if isinstance(logic, dict):
            actions_def = logic.get('actions', {})
            if isinstance(actions_def, dict) and actions_def:
                return set(actions_def.keys())

    actions_def = app_config.get('actions', {})
    if isinstance(actions_def, dict):
        return set(actions_def.keys())

    return set()


def validate_action_references(json_data: dict, defined_actions: set) -> list[str]:
    """
    Validate that all action references in components point to defined actions.

    Scans the entire JSON tree for ActionTrigger objects and verifies
    that the referenced action name exists in the app's actions object.

    Args:
        json_data: The parsed JSON object (WebAppProps).
        defined_actions: Set of action names defined in the app.

    Returns:
        List of error messages for undefined action references.
    """
    errors = []

    def scan_for_action_triggers(node, path):
        if isinstance(node, dict):
            for key, value in node.items():
                child_path = f"{path}.{key}" if path else key

                if key in ACTION_TRIGGER_PROPERTIES:
                    if isinstance(value, dict) and 'name' in value:
                        action_name = value.get('name')
                        if action_name and isinstance(action_name, str):
                            if action_name not in defined_actions:
                                if defined_actions:
                                    sample_actions = ', '.join(sorted(defined_actions)[:8])
                                    errors.append(
                                        f"[{child_path}] Action reference '{action_name}' not found in defined actions. "
                                        f"Available actions: {sample_actions}"
                                        f"{'...' if len(defined_actions) > 8 else ''}"
                                    )
                                else:
                                    errors.append(
                                        f"[{child_path}] Action reference '{action_name}' used but no actions are defined in the app. "
                                        f"Add an 'actions' object to the WebAppProps with the '{action_name}' action defined."
                                    )
                    scan_for_action_triggers(value, child_path)
                else:
                    scan_for_action_triggers(value, child_path)

        elif isinstance(node, list):
            for i, item in enumerate(node):
                scan_for_action_triggers(item, f"{path}[{i}]")

    if isinstance(json_data, dict):
        for key, value in json_data.items():
            if key != 'actions':
                scan_for_action_triggers(value, key)

    return errors


# =============================================================================
# CROSS-VALIDATION (data bindings, action syntax, unused properties)
# =============================================================================


def _walk_components(node, component_type: str, results: list, path: str = "root"):
    """Recursively find all components of a given componentType."""
    if isinstance(node, dict):
        if node.get("componentType") == component_type:
            results.append((path, node))
        for key, val in node.items():
            child_path = f"{path}.{key}" if path != "root" else key
            _walk_components(val, component_type, results, child_path)
    elif isinstance(node, list):
        for i, item in enumerate(node):
            _walk_components(item, component_type, results, f"{path}[{i}]")


def _get_backend_model_columns(app_config: dict, model_name: str) -> set:
    """Get column names for a backend model."""
    backend = app_config.get("backend", {})
    if not isinstance(backend, dict):
        return set()
    models = backend.get("models", [])
    if not isinstance(models, list):
        return set()
    for model in models:
        if isinstance(model, dict) and model.get("name") == model_name:
            columns = model.get("columns", [])
            if isinstance(columns, list):
                return {c.get("name") for c in columns if isinstance(c, dict) and c.get("name")}
    return set()


def validate_data_bindings(app_config: dict) -> tuple[list[str], list[str]]:
    """
    Cross-validate frontend data bindings against backend model columns
    and dataset structures.

    Returns:
        Tuple of (errors, warnings).
    """
    errors = []
    warnings = []

    if not isinstance(app_config, dict):
        return errors, warnings

    # 1. Unused computed properties
    frontend = app_config.get("frontend", {})
    if isinstance(frontend, dict):
        logic = frontend.get("logic", {})
        if isinstance(logic, dict):
            computed = logic.get("computed", {})
            if isinstance(computed, dict) and computed:
                # Serialize pages + header + sidebar + footer + actions to search for references
                scan_parts = [
                    frontend.get("pages"),
                    frontend.get("header"),
                    frontend.get("sidebar"),
                    frontend.get("footer"),
                    logic.get("actions"),
                ]
                scan_parts = [p for p in scan_parts if p]
                frontend_str = json.dumps(scan_parts) if scan_parts else ""
                for comp_name in computed:
                    ref_pattern = f"$computed.{comp_name}"
                    if ref_pattern not in frontend_str:
                        warnings.append(
                            f"[frontend.logic.computed] Computed property '{comp_name}' "
                            f"is defined but never referenced in any page content."
                        )

    # 4. Unused backend handlers
    backend = app_config.get("backend", {})
    if isinstance(backend, dict):
        handlers = backend.get("handlers", [])
        if isinstance(handlers, list) and handlers:
            # Serialize actions + component tree to search for handler references.
            # Handlers can be referenced in actions (api steps) and in components
            # (onSubmitAction.handler, data bindings like "handler.X.method").
            scan_parts = []
            if isinstance(frontend, dict):
                logic_obj = frontend.get("logic", {})
                if isinstance(logic_obj, dict):
                    actions = logic_obj.get("actions", {})
                    if actions:
                        scan_parts.append(actions)
                for key in ("pages", "header", "sidebar", "footer"):
                    part = frontend.get(key)
                    if part:
                        scan_parts.append(part)
            search_str = json.dumps(scan_parts) if scan_parts else ""

            for handler in handlers:
                if isinstance(handler, dict):
                    handler_name = handler.get("name", "")
                    if handler_name and isinstance(handler_name, str):
                        if handler_name not in search_str:
                            warnings.append(
                                f"[backend.handlers] Handler '{handler_name}' is defined "
                                f"but not referenced in any frontend action."
                            )

    return errors, warnings
