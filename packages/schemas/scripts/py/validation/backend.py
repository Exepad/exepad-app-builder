"""
Backend validation — schema-driven validation of BackendProps.

Validates models[], handlers[], and their nested structures against the
JSON schema, with enriched error messages for common LLM mistakes.
"""

import json
import os
import re

from jsonschema import validators, RefResolver, FormatChecker


# Schema path
_current_dir = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR = os.path.normpath(os.path.join(_current_dir, '..', '..', '..', 'data'))
_SCHEMA_PATH = os.path.join(_DATA_DIR, 'full_schema_model', 'full_schema.json')

# System columns that are auto-added — must NOT be declared in models
SYSTEM_COLUMNS = {"id", "owner_id", "created_at", "updated_at"}

# Valid SQL identifier pattern
MODEL_NAME_PATTERN = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')


def _enrich_backend_error(error) -> str:
    """
    Translate a generic jsonschema ValidationError into an LLM-actionable message.

    Uses the error's path, validator type, and message to provide contextual suggestions.
    """
    path_parts = list(error.path)
    path_str = " -> ".join(str(p) for p in path_parts) or "<root>"
    msg = error.message

    # Build context from path
    in_references = any(str(p) == "references" for p in path_parts)
    in_columns = any(str(p) == "columns" for p in path_parts)
    in_inputs = any(str(p) == "inputs" for p in path_parts)
    in_outputs = any(str(p) == "outputs" for p in path_parts)
    in_models = any(str(p) == "models" for p in path_parts)
    in_handlers = any(str(p) == "handlers" for p in path_parts)

    # --- additionalProperties errors: suggest the correct field name ---
    if error.validator == "additionalProperties":
        unexpected_match = re.search(r"'(\w+)' was unexpected", msg)
        if unexpected_match:
            wrong_field = unexpected_match.group(1)

            if in_references:
                if wrong_field == "table":
                    return (
                        f"[{path_str}] references: '{wrong_field}' is not valid — "
                        f"use 'model' (the name of the referenced model)"
                    )
                if wrong_field in ("ondelete", "on_delete"):
                    return f"[{path_str}] references: '{wrong_field}' is not valid — use 'onDelete'"
                return (
                    f"[{path_str}] references: '{wrong_field}' is not a valid ForeignKeyRef field. "
                    f"Valid fields: model, column, onDelete"
                )

            # description -> summary (models, handlers, columns, inputs, outputs)
            if wrong_field == "description":
                return f"[{path_str}] '{wrong_field}' is not valid — use 'summary' (canonical field name)"

            # Column-level field name mistakes
            if in_columns:
                column_fixes = {
                    "unique": "isUnique",
                    "nullable": "isNullable",
                    "primary": "isPrimary",
                    "primaryKey": "isPrimary",
                    "notNull": "isNullable (inverted — set isNullable: false)",
                    "default": "defaultValue",
                    "ref": "references",
                    "foreignKey": "references",
                    "fk": "references",
                }
                if wrong_field == "required":
                    return (
                        f"[{path_str}] '{wrong_field}' is not a valid ColumnConfig field. "
                        f"Use 'isNullable' to control whether the column accepts NULL"
                    )
                if wrong_field in column_fixes:
                    return f"[{path_str}] '{wrong_field}' is not valid — use '{column_fixes[wrong_field]}'"
                return (
                    f"[{path_str}] '{wrong_field}' is not a valid ColumnConfig field. "
                    f"Valid fields: name, type, summary, isPrimary, isUnique, isNullable, defaultValue, references"
                )

            if in_handlers and not in_inputs and not in_outputs:
                return f"[{path_str}] '{wrong_field}' is not a valid HandlerConfig field"

            if in_models and not in_columns:
                return f"[{path_str}] '{wrong_field}' is not a valid ModelConfig field"

    # --- enum errors: wrong type values ---
    if error.validator == "enum" or "is not one of" in msg:
        if in_inputs or in_outputs:
            column_to_io = {
                "text": "string",
                "integer": "number",
                "real": "number",
                "blob": "json",
            }
            wrong_val = str(error.instance) if error.instance else ""
            if wrong_val in column_to_io:
                return (
                    f"[{path_str}] type '{wrong_val}' is a column type — "
                    f"use '{column_to_io[wrong_val]}' for input/output types"
                )

    # --- required property errors ---
    if error.validator == "required":
        missing_match = re.search(r"'(\w+)' is a required property", msg)
        if missing_match:
            missing_field = missing_match.group(1)
            if in_references:
                if missing_field == "model":
                    return (
                        f"[{path_str}] references: missing required field 'model' — "
                        f"the name of the referenced model"
                    )
                if missing_field == "column":
                    return (
                        f"[{path_str}] references: missing required field 'column' — "
                        f"the column in the referenced model (typically 'id')"
                    )

    # Default: return formatted generic error
    return f"[{path_str}] {msg}"


def validate_backend_props(backend_config_str: str) -> dict:
    """
    Validate a BackendProps JSON string against the schema.

    Performs:
    1. JSON parsing
    2. Schema validation against BackendProps definition
    3. Error enrichment for LLM-actionable messages
    4. Semantic checks (system columns, model name patterns)

    Args:
        backend_config_str: JSON string of the backend config.

    Returns:
        {"valid": bool, "errors": list[str]}
    """
    errors: list[str] = []

    # 1) Parse JSON
    clean_str = backend_config_str.replace('```json', '').replace('```', '').strip()
    try:
        config = json.loads(clean_str)
    except json.JSONDecodeError as e:
        return {"valid": False, "errors": [
            f"Invalid JSON: {e.msg} at line {e.lineno}, column {e.colno}"
        ]}

    if not isinstance(config, dict):
        return {"valid": False, "errors": ["BackendProps must be a JSON object"]}

    # 2) Load schema
    try:
        with open(_SCHEMA_PATH) as f:
            schema = json.load(f)
    except FileNotFoundError:
        return {"valid": False, "errors": [f"Schema file not found: {_SCHEMA_PATH}"]}

    schema_id = schema.get("$id", "full_schema.json")
    schema_store = {schema_id: schema}
    resolver = RefResolver.from_schema(schema, store=schema_store)
    validator_cls = validators.validator_for(schema)

    # Ensure mode: "dynamic" is present (agent always generates dynamic backend)
    if "mode" not in config:
        config["mode"] = "dynamic"

    # Security config belongs at root-level WebAppProps.security, NOT inside backend.
    # If the LLM erroneously outputs security here, strip it before schema validation so
    # the schema check catches any other issues. The assembly pipeline generates security
    # deterministically from app_security_plan — it is never part of backend.json.
    # We save the value for semantic validation below (step 5).
    security_config = config.pop("security", None)

    # 3) Validate against DynamicBackend definition (agent only produces dynamic configs)
    defs = schema.get("definitions", {})
    target_def = "DynamicBackend" if "DynamicBackend" in defs else "BackendProps"
    if target_def not in defs:
        return {"valid": False, "errors": [f"{target_def} definition not found in schema"]}

    ref = f"{schema_id}#/definitions/{target_def}"
    v = validator_cls(
        schema={"$ref": ref},
        resolver=resolver,
        format_checker=FormatChecker()
    )

    for error in sorted(v.iter_errors(config), key=lambda e: list(e.path)):
        enriched = _enrich_backend_error(error)
        errors.append(enriched)

    # 4) Semantic checks (beyond what the schema can express)
    for i, model in enumerate(config.get("models", [])):
        if not isinstance(model, dict):
            continue
        prefix = f"models[{i}]"

        # Model name must be valid SQL identifier
        name = model.get("name", "")
        if name and not MODEL_NAME_PATTERN.match(name):
            errors.append(
                f"[{prefix}] name '{name}' is not a valid SQL identifier — "
                f"use lowercase_snake_case (letters, digits, underscores, starting with a letter)"
            )

        # System columns must NOT be declared
        for j, col in enumerate(model.get("columns", [])):
            if not isinstance(col, dict):
                continue
            col_name = col.get("name", "")
            if col_name in SYSTEM_COLUMNS:
                errors.append(
                    f"[{prefix}.columns[{j}]] '{col_name}' is a system column — "
                    f"never declare it. The platform auto-creates: {', '.join(sorted(SYSTEM_COLUMNS))}"
                )

    # 5) SecurityConfig semantic checks
    if security_config is not None:
        errors.extend(_validate_security_config(security_config))

    return {"valid": len(errors) == 0, "errors": errors}


# Valid auth providers
_VALID_AUTH_PROVIDERS = {"email", "google", "exepad"}

# AccessLevel pattern: public, authenticated, role:X, owner, none
_ACCESS_LEVEL_PATTERN = re.compile(r'^(public|authenticated|owner|none|role:[a-zA-Z_][a-zA-Z0-9_]*)$')


def _validate_security_config(security: dict) -> list[str]:
    """
    Validate a SecurityConfig object for structural and semantic correctness.

    Checks:
    - authProviders[].provider in valid set
    - roleHierarchy references only defined roles
    - defaultRole in roles
    - defaultAccess is valid and not owner/none
    - sessionDuration is a positive number
    """
    errors: list[str] = []

    if not isinstance(security, dict):
        return ["[security] must be a JSON object"]

    # authProviders — required, at least one
    providers = security.get("authProviders", [])
    if not isinstance(providers, list) or len(providers) == 0:
        errors.append("[security] authProviders is required and must contain at least one provider")
    else:
        for i, prov in enumerate(providers):
            if not isinstance(prov, dict):
                errors.append(f"[security.authProviders[{i}]] must be an object")
                continue
            provider_type = prov.get("provider", "")
            if provider_type not in _VALID_AUTH_PROVIDERS:
                errors.append(
                    f"[security.authProviders[{i}]] provider '{provider_type}' is not valid — "
                    f"use one of: {', '.join(sorted(_VALID_AUTH_PROVIDERS))}"
                )

    # roles and roleHierarchy
    roles = security.get("roles", [])
    role_set = set(roles) if isinstance(roles, list) else set()

    role_hierarchy = security.get("roleHierarchy", {})
    if isinstance(role_hierarchy, dict):
        for parent, children in role_hierarchy.items():
            if parent not in role_set:
                errors.append(
                    f"[security.roleHierarchy] parent role '{parent}' is not defined in roles[]"
                )
            if isinstance(children, list):
                for child in children:
                    if child not in role_set:
                        errors.append(
                            f"[security.roleHierarchy] child role '{child}' "
                            f"(under '{parent}') is not defined in roles[]"
                        )

    # defaultRole
    default_role = security.get("defaultRole", "")
    if default_role and default_role not in role_set:
        errors.append(
            f"[security] defaultRole '{default_role}' is not in roles[] — "
            f"defined roles: {', '.join(sorted(role_set)) if role_set else '(none)'}"
        )

    # defaultAccess
    default_access = security.get("defaultAccess", "")
    if default_access:
        if not _ACCESS_LEVEL_PATTERN.match(default_access):
            errors.append(
                f"[security] defaultAccess '{default_access}' is not a valid AccessLevel — "
                f"use 'public', 'authenticated', or 'role:X'"
            )
        elif default_access in ("owner", "none"):
            errors.append(
                f"[security] defaultAccess cannot be '{default_access}' — "
                f"use 'public', 'authenticated', or 'role:X' for page defaults"
            )

    # sessionDuration
    session_duration = security.get("sessionDuration")
    if session_duration is not None:
        if not isinstance(session_duration, (int, float)) or session_duration <= 0:
            errors.append(
                f"[security] sessionDuration must be a positive number (seconds), "
                f"got: {session_duration}"
            )

    return errors


# Deprecated alias
validate_backend_config = validate_backend_props
