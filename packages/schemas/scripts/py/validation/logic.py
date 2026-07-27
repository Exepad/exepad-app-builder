"""
Logic validation — schema-driven validation of LogicProps (frontend.logic).

Validates state against the LogicProps JSON schema definition,
with enriched error messages for common LLM mistakes.
"""

import json
import os
import re

from jsonschema import validators, RefResolver, FormatChecker


_current_dir = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR = os.path.normpath(os.path.join(_current_dir, '..', '..', '..', 'data'))
_SCHEMA_PATH = os.path.join(_DATA_DIR, 'full_schema_model', 'full_schema.json')

# Known extra properties that LLMs commonly hallucinate on LogicConfig
_LOGIC_FIELD_HINTS = {
    "actions": (
        "'actions' is not a valid LogicConfig field — remove it. "
        "Code components handle logic directly via SDK hooks (useModel, useHandler, navigate, toast). "
        "LogicConfig only allows: state."
    ),
    "computed": (
        "'computed' is not a valid LogicConfig field — remove it. "
        "Code components compute derived values inline in JavaScript. "
        "LogicConfig only allows: state."
    ),
    "onMount": (
        "'onMount' is not a valid LogicConfig field — remove it. "
        "Code components load their own data on mount via useModel/useHandler hooks. "
        "LogicConfig only allows: state."
    ),
    "initActions": (
        "'initActions' is not a valid LogicConfig field — remove it. "
        "LogicConfig only allows: state."
    ),
    "init": "'init' is not a valid LogicConfig field — remove it. LogicConfig only allows: state.",
    "onInit": "'onInit' is not a valid LogicConfig field — remove it. LogicConfig only allows: state.",
    "listeners": "'listeners' is not a valid LogicConfig field — remove it. LogicConfig only allows: state.",
    "watchers": "'watchers' is not a valid LogicConfig field — remove it. LogicConfig only allows: state.",
    "effects": "'effects' is not a valid LogicConfig field — remove it. LogicConfig only allows: state.",
}


def _enrich_logic_error(error) -> str:
    """
    Translate a jsonschema ValidationError into an LLM-actionable message.
    """
    path_parts = list(error.path)
    path_str = " -> ".join(str(p) for p in path_parts) or "<root>"
    msg = error.message

    in_state = any(str(p) == "state" for p in path_parts)

    if error.validator == "additionalProperties":
        unexpected_match = re.search(r"'(\w+)' was unexpected", msg)
        if unexpected_match:
            wrong_field = unexpected_match.group(1)

            if not path_parts:
                if wrong_field in _LOGIC_FIELD_HINTS:
                    return _LOGIC_FIELD_HINTS[wrong_field]
                return (
                    f"'{wrong_field}' is not a valid LogicConfig field. "
                    f"LogicConfig only allows: state"
                )

    return f"[{path_str}] {msg}"


def validate_logic_config(logic_config_str: str) -> dict:
    """
    Validate a LogicConfig JSON string against the schema.

    Performs:
    1. JSON parsing
    2. Schema validation against LogicConfig definition
    3. Error enrichment for LLM-actionable messages

    Args:
        logic_config_str: JSON string of the logic config.

    Returns:
        {"valid": bool, "errors": list[str]}
    """
    errors: list[str] = []

    clean_str = logic_config_str.replace('```json', '').replace('```', '').strip()
    try:
        config = json.loads(clean_str)
    except json.JSONDecodeError as e:
        return {"valid": False, "errors": [
            f"Invalid JSON: {e.msg} at line {e.lineno}, column {e.colno}"
        ]}

    if not isinstance(config, dict):
        return {"valid": False, "errors": ["LogicConfig must be a JSON object"]}

    try:
        with open(_SCHEMA_PATH) as f:
            schema = json.load(f)
    except FileNotFoundError:
        return {"valid": False, "errors": [f"Schema file not found: {_SCHEMA_PATH}"]}

    schema_id = schema.get("$id", "full_schema.json")
    schema_store = {schema_id: schema}
    resolver = RefResolver.from_schema(schema, store=schema_store)
    validator_cls = validators.validator_for(schema)

    defs = schema.get("definitions", {})
    # Schema defines the type as "LogicProps"
    if "LogicProps" not in defs:
        return {"valid": False, "errors": ["LogicProps definition not found in schema"]}

    ref = f"{schema_id}#/definitions/LogicProps"
    v = validator_cls(
        schema={"$ref": ref},
        resolver=resolver,
        format_checker=FormatChecker()
    )

    for error in sorted(v.iter_errors(config), key=lambda e: list(e.path)):
        enriched = _enrich_logic_error(error)
        errors.append(enriched)

    return {"valid": len(errors) == 0, "errors": errors}
