"""
Binding & reference validation for WebAppProps.

Validates runtime binding expressions ($state, $computed), data source
references (model.X, handler.X), form submit targets, action set targets,
lookup references, page slug uniqueness, computed data sources, string
action references, and repo/handler consistency.
"""

import re
from typing import Any


# Pattern to match $binding references: $word or $word.word.word
DOLLAR_BINDING_PATTERN = re.compile(r'\$([a-zA-Z]\w*(?:\.\w+)*)')

# Special dollar keywords always valid regardless of context
SPECIAL_DOLLAR_KEYWORDS = {'payload', 'input', 'item'}

# Properties that contain action name strings (validated separately)
ACTION_NAME_PROPERTIES = {
    'action', 'onClose', 'onChange', 'onOpenChange', 'onCheckedChange',
    'onValueChange', 'onSelect', 'onStepClick', 'onStepChange', 'onSubmit',
}

# Computed operator keys whose values reference data sources
COMPUTED_DATA_KEYS = {
    'count', 'filter', 'sum', 'avg', 'min', 'max', 'sort', 'slice',
    'map', 'find', 'some', 'every', 'reduce', 'flatMap', 'groupBy', 'unique',
}

# Keys whose string values should never be treated as $ bindings
BINDING_SKIP_KEYS = {
    'errorMessage', 'successMessage', 'helperText', 'pattern',
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_backend_info(app_config: dict) -> tuple[set, set, set, str | None]:
    """Extract model names, handler names, dataset names, and backend mode from backend."""
    backend = app_config.get('backend', {})
    if not isinstance(backend, dict):
        return set(), set(), set(), None

    backend_mode = backend.get('mode')  # 'static' | 'dynamic' | None

    model_names: set[str] = set()
    for model in (backend.get('models') or []):
        if isinstance(model, dict) and 'name' in model:
            model_names.add(model['name'])

    handler_names: set[str] = set()
    for handler in (backend.get('handlers') or []):
        if isinstance(handler, dict):
            for key in ('name', 'method'):
                if handler.get(key):
                    handler_names.add(handler[key])

    dataset_names: set[str] = set()
    data = backend.get('data', {})
    if isinstance(data, dict):
        datasets = data.get('datasets', {})
        if isinstance(datasets, dict):
            dataset_names = set(datasets.keys())

    return model_names, handler_names, dataset_names, backend_mode


def _extract_defined_actions(app_config: dict) -> set[str]:
    """Extract action names — returns empty set.

    Actions have been removed from frontend.logic. This function is kept
    for backward compatibility with callers but always returns empty.
    """
    return set()


def _iter_frontend_sections(app_config: dict):
    """Yield (section_name, content_nodes) for pages, sidebar, header, footer."""
    frontend = app_config.get('frontend', {})
    if not isinstance(frontend, dict):
        return

    pages = frontend.get('pages', [])
    if isinstance(pages, list):
        for i, page in enumerate(pages):
            if isinstance(page, dict):
                slug = page.get('slug', f'page[{i}]')
                yield f"pages[{slug}]", page.get('content', [])

    for section in ('sidebar', 'header', 'footer'):
        content = frontend.get(section)
        if content:
            yield section, content


# ---------------------------------------------------------------------------
# Individual validators
# ---------------------------------------------------------------------------

def _validate_dollar_bindings(
    app_config: dict, state_fields: set, computed_fields: set,
) -> list[str]:
    """Validate $-prefix bindings in component props against state/computed."""
    errors: list[str] = []

    def scan_node(node: Any, path: str, parent_key: str = ""):
        if isinstance(node, dict):
            for key, val in node.items():
                # Skip sub-trees that aren't component bindings
                if key in ('onSubmitAction', 'onSuccessAction', 'onErrorAction',
                           'validationRules'):
                    continue
                scan_node(val, f"{path}.{key}", key)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                scan_node(item, f"{path}[{i}]", parent_key)
        elif isinstance(node, str):
            if parent_key in BINDING_SKIP_KEYS or parent_key in ACTION_NAME_PROPERTIES:
                return
            for match in DOLLAR_BINDING_PATTERN.finditer(node):
                binding = match.group(1)
                parts = binding.split('.')
                root = parts[0]
                if root in SPECIAL_DOLLAR_KEYWORDS:
                    continue
                if root == 'computed':
                    if len(parts) >= 2 and computed_fields:
                        fname = parts[1]
                        if fname not in computed_fields:
                            errors.append(
                                f"[{path}] Binding '$computed.{fname}' references "
                                f"undefined computed field. "
                                f"Defined: {', '.join(sorted(computed_fields))}"
                            )
                    continue
                if root == 'state':
                    # $state.field.prop — explicit state namespace
                    if len(parts) >= 2 and state_fields:
                        fname = parts[1]
                        if fname not in state_fields:
                            errors.append(
                                f"[{path}] Binding '$state.{fname}' references "
                                f"undefined state field. "
                                f"Defined: {', '.join(sorted(list(state_fields)[:15]))}"
                            )
                    continue
                # $X can reference state or computed fields (shorthand)
                all_valid = state_fields | computed_fields
                if all_valid and root not in all_valid:
                    errors.append(
                        f"[{path}] Binding '${binding}' references undefined "
                        f"state/computed field '{root}'. "
                        f"Defined: {', '.join(sorted(list(all_valid)[:15]))}"
                    )

    for section, content in _iter_frontend_sections(app_config):
        scan_node(content, f"{section}.content")

    return errors


def _validate_data_sources(
    app_config: dict, model_names: set, handler_names: set, dataset_names: set,
    backend_mode: str | None = None,
) -> list[str]:
    """Validate model.X / handler.X / dataset.X data source references."""
    errors: list[str] = []
    valid_models = model_names | dataset_names
    is_dynamic = backend_mode == 'dynamic' or (model_names and not dataset_names and backend_mode is None)

    def check_data_ref(data_val: str, path: str):
        if data_val.startswith('model.'):
            ref = data_val[6:]
            if ref and ref not in valid_models:
                errors.append(
                    f"[{path}] Data source '{data_val}' references undefined "
                    f"model '{ref}'. Defined: {', '.join(sorted(model_names))}"
                )
        elif data_val.startswith('handler.'):
            parts = data_val.split('.')
            if len(parts) >= 2:
                ref = parts[1]
                if ref and ref not in handler_names:
                    errors.append(
                        f"[{path}] Data source '{data_val}' references undefined "
                        f"handler '{ref}'. Defined: {', '.join(sorted(handler_names))}"
                    )
        elif data_val.startswith('dataset.'):
            ref = data_val[8:]
            if is_dynamic and ref in model_names:
                errors.append(
                    f"[{path}] Data source '{data_val}' uses 'dataset.' prefix but "
                    f"backend is dynamic mode — use 'model.{ref}' instead"
                )
            elif ref and ref not in dataset_names:
                errors.append(
                    f"[{path}] Data source '{data_val}' references undefined "
                    f"dataset '{ref}'. "
                    + (f"Did you mean 'model.{ref}'? " if ref in model_names else "")
                    + (f"Defined datasets: {', '.join(sorted(dataset_names))}" if dataset_names else "No datasets defined")
                )

    def scan_node(node: Any, path: str):
        if isinstance(node, dict):
            if 'data' in node and isinstance(node['data'], str):
                check_data_ref(node['data'], f"{path}.data")
            for key, val in node.items():
                scan_node(val, f"{path}.{key}")
        elif isinstance(node, list):
            for i, item in enumerate(node):
                scan_node(item, f"{path}[{i}]")

    for section, content in _iter_frontend_sections(app_config):
        scan_node(content, f"{section}.content")

    return errors


def _validate_submit_model_names(app_config: dict, model_names: set) -> list[str]:
    """Validate onSubmitAction.modelName against backend models."""
    errors: list[str] = []
    # Skip when no models defined (e.g. block fragments without backends)
    if not model_names:
        return errors

    def scan_node(node: Any, path: str):
        if isinstance(node, dict):
            if 'onSubmitAction' in node and isinstance(node['onSubmitAction'], dict):
                submit = node['onSubmitAction']
                if submit.get('type') == 'model':
                    ref = submit.get('modelName')
                    if ref and isinstance(ref, str) and ref not in model_names:
                        errors.append(
                            f"[{path}.onSubmitAction] modelName '{ref}' references "
                            f"undefined model. Defined: {', '.join(sorted(model_names))}"
                        )
            for key, val in node.items():
                if key != 'onSubmitAction':
                    scan_node(val, f"{path}.{key}")
        elif isinstance(node, list):
            for i, item in enumerate(node):
                scan_node(item, f"{path}[{i}]")

    for section, content in _iter_frontend_sections(app_config):
        scan_node(content, f"{section}.content")

    return errors


def _validate_action_set_targets(app_config: dict, state_fields: set) -> list[str]:
    """Validate action 'set' targets reference defined state fields."""
    errors: list[str] = []
    if not state_fields:
        return errors

    frontend = app_config.get('frontend', {})
    if isinstance(frontend, dict):
        logic = frontend.get('logic', {})
        actions = logic.get('actions', {}) if isinstance(logic, dict) else {}
    else:
        actions = app_config.get('actions', {})

    if not isinstance(actions, dict):
        return errors

    def check_step(step, action_name):
        if isinstance(step, dict) and 'set' in step:
            target = step['set']
            if not isinstance(target, str):
                return
            # Skip dynamic paths containing $ (runtime-evaluated)
            if '$' in target:
                return
            # For dot-notation paths like "filter.category", check the base field
            base_field = target.split('.')[0]
            if base_field not in state_fields:
                errors.append(
                    f"[actions.{action_name}] Sets undefined state field '{base_field}' "
                    f"(from '{target}'). "
                    f"Defined: {', '.join(sorted(list(state_fields)[:15]))}"
                )

    for name, defn in actions.items():
        if isinstance(defn, dict):
            check_step(defn, name)
        elif isinstance(defn, list):
            for step in defn:
                check_step(step, name)

    return errors


def _validate_lookup_references(
    app_config: dict, model_names: set, dataset_names: set,
    backend_mode: str | None = None,
) -> list[str]:
    """Validate DataTable column lookup references against backend models/datasets."""
    errors: list[str] = []
    valid_models = model_names | dataset_names
    is_dynamic = backend_mode == 'dynamic' or (model_names and not dataset_names and backend_mode is None)

    def scan_node(node: Any, path: str):
        if isinstance(node, dict):
            if 'lookup' in node and isinstance(node['lookup'], str):
                lookup_val = node['lookup']
                if lookup_val.startswith('model.'):
                    ref = lookup_val[6:]
                    if ref and ref not in valid_models:
                        errors.append(
                            f"[{path}] Lookup '{lookup_val}' references undefined "
                            f"model '{ref}'. Defined: {', '.join(sorted(model_names))}"
                        )
                elif lookup_val.startswith('dataset.'):
                    ref = lookup_val[8:]
                    if is_dynamic and ref in model_names:
                        errors.append(
                            f"[{path}] Lookup '{lookup_val}' uses 'dataset.' prefix but "
                            f"backend is dynamic mode — use 'model.{ref}' instead"
                        )
                    elif ref and ref not in dataset_names:
                        errors.append(
                            f"[{path}] Lookup '{lookup_val}' references undefined "
                            f"dataset '{ref}'. "
                            + (f"Did you mean 'model.{ref}'? " if ref in model_names else "")
                            + (f"Defined datasets: {', '.join(sorted(dataset_names))}" if dataset_names else "No datasets defined")
                        )
            for key, val in node.items():
                scan_node(val, f"{path}.{key}")
        elif isinstance(node, list):
            for i, item in enumerate(node):
                scan_node(item, f"{path}[{i}]")

    for section, content in _iter_frontend_sections(app_config):
        scan_node(content, f"{section}.content")

    return errors


def _validate_page_slugs(app_config: dict) -> list[str]:
    """Validate page slug uniqueness."""
    errors: list[str] = []
    frontend = app_config.get('frontend', {})
    if not isinstance(frontend, dict):
        return errors

    pages = frontend.get('pages', [])
    if not isinstance(pages, list):
        return errors

    seen: dict[str, int] = {}
    for i, page in enumerate(pages):
        if not isinstance(page, dict):
            continue
        slug = page.get('slug')
        if slug and isinstance(slug, str):
            if slug in seen:
                errors.append(
                    f"[pages[{i}]] Duplicate page slug '{slug}' "
                    f"(first defined at page index {seen[slug]})"
                )
            else:
                seen[slug] = i

    return errors


def _validate_repo_handler_consistency(app_config: dict) -> list[str]:
    """Cross-validate repo.backend.handlers against backend.handlers."""
    warnings: list[str] = []
    repo = app_config.get('repo', {})
    backend = app_config.get('backend', {})

    if not isinstance(repo, dict) or not isinstance(backend, dict):
        return warnings

    repo_handlers = repo.get('backend', {}).get('handlers', {})
    if not isinstance(repo_handlers, dict):
        return warnings

    handlers = backend.get('handlers', [])
    if not isinstance(handlers, list):
        return warnings

    handler_methods: set[str] = set()
    for h in handlers:
        if isinstance(h, dict):
            m = h.get('method') or h.get('name')
            if m:
                handler_methods.add(m)

    repo_names = set(repo_handlers.keys())

    for name in sorted(repo_names - handler_methods):
        warnings.append(
            f"[repo.backend.handlers] Handler '{name}' has no corresponding backend handler. "
            f"Defined handlers: {', '.join(sorted(handler_methods))}"
        )

    for name in sorted(handler_methods - repo_names):
        warnings.append(
            f"[backend.handlers] Handler '{name}' has no corresponding repo handler. "
            f"Defined repo handlers: {', '.join(sorted(repo_names))}"
        )

    return warnings


def _validate_computed_references(
    app_config: dict, state_fields: set, computed_fields: set,
    model_names: set, dataset_names: set,
) -> list[str]:
    """Validate computed field data source references (model names, state, $computed)."""
    errors: list[str] = []
    frontend = app_config.get('frontend', {})
    if not isinstance(frontend, dict):
        return errors

    logic = frontend.get('logic', {})
    if not isinstance(logic, dict):
        return errors

    computed = logic.get('computed', {})
    if not isinstance(computed, dict):
        return errors

    # Plain data sources can be model names, dataset names, state fields, or other computed fields
    valid_plain_sources = model_names | dataset_names | state_fields | computed_fields
    # $ references can point to computed fields or state fields
    valid_dollar_sources = computed_fields | state_fields

    for field_name, field_def in computed.items():
        if not isinstance(field_def, dict):
            continue
        for key, val in field_def.items():
            if key not in COMPUTED_DATA_KEYS or not isinstance(val, str):
                continue
            if val.startswith('$'):
                ref = val[1:]
                if ref and valid_dollar_sources and ref not in valid_dollar_sources:
                    errors.append(
                        f"[computed.{field_name}.{key}] Reference '${ref}' points to "
                        f"undefined computed/state field. "
                        f"Defined: {', '.join(sorted(list(valid_dollar_sources)[:15]))}"
                    )
            else:
                if valid_plain_sources and val not in valid_plain_sources:
                    errors.append(
                        f"[computed.{field_name}.{key}] Data source '{val}' references "
                        f"undefined model/dataset/state field. "
                        f"Defined: {', '.join(sorted(list(valid_plain_sources)[:15]))}"
                    )

    return errors


def _validate_string_action_refs(app_config: dict, defined_actions: set) -> list[str]:
    """Validate plain-string action references (action, onClose, etc.).

    Complements the existing validate_action_references() which only handles
    dict-style ActionTrigger objects {name: "actionName"}.
    """
    errors: list[str] = []
    if not defined_actions:
        return errors

    def scan_node(node: Any, path: str):
        if isinstance(node, dict):
            for key, val in node.items():
                child_path = f"{path}.{key}"
                if key in ACTION_NAME_PROPERTIES and isinstance(val, str):
                    if val and val not in defined_actions:
                        sample = ', '.join(sorted(defined_actions)[:8])
                        errors.append(
                            f"[{child_path}] Action '{val}' not found in defined actions. "
                            f"Available: {sample}"
                            f"{'...' if len(defined_actions) > 8 else ''}"
                        )
                else:
                    scan_node(val, child_path)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                scan_node(item, f"{path}[{i}]")

    for section, content in _iter_frontend_sections(app_config):
        scan_node(content, f"{section}.content")

    return errors


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def validate_all_bindings(
    app_config: dict, state_fields: set, computed_fields: set,
) -> tuple[list[str], list[str]]:
    """
    Run all binding and reference validations.

    Returns:
        Tuple of (errors, warnings).
    """
    model_names, handler_names, dataset_names, backend_mode = _extract_backend_info(app_config)
    defined_actions = _extract_defined_actions(app_config)

    errors: list[str] = []
    warnings: list[str] = []

    # 1. $-prefix bindings in component props
    errors.extend(
        _validate_dollar_bindings(app_config, state_fields, computed_fields))

    # 2. model.X / handler.X / dataset.X data sources
    errors.extend(
        _validate_data_sources(app_config, model_names, handler_names, dataset_names, backend_mode))

    # 3. onSubmitAction.modelName
    errors.extend(
        _validate_submit_model_names(app_config, model_names))

    # 4. Action set targets vs state fields
    errors.extend(
        _validate_action_set_targets(app_config, state_fields))

    # 5. DataTable lookup references
    errors.extend(
        _validate_lookup_references(app_config, model_names, dataset_names, backend_mode))

    # 6. Page slug uniqueness
    errors.extend(
        _validate_page_slugs(app_config))

    # 7. repo.backend.handlers ↔ backend.handlers consistency (warnings only)
    warnings.extend(
        _validate_repo_handler_consistency(app_config))

    # 8. Computed field data source references
    errors.extend(
        _validate_computed_references(
            app_config, state_fields, computed_fields, model_names, dataset_names))

    # 9. Plain-string action references (action, onClose, etc.)
    errors.extend(
        _validate_string_action_refs(app_config, defined_actions))

    return errors, warnings
