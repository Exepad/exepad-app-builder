"""
JSON parsing, repair, and diagnostic utilities.

Handles malformed LLM output: markdown code fences, multiply-encoded
strings, invalid escape sequences, bracket imbalance, and more.
"""

import json
import re
import structlog
from typing import Any, Union
import json_repair as _json_repair

logger = structlog.get_logger(__name__)


def analyze_bracket_balance(text: str) -> str:
    """Analyze bracket balance to detect structural issues."""
    open_braces = text.count("{")
    close_braces = text.count("}")
    open_brackets = text.count("[")
    close_brackets = text.count("]")

    issues = []
    if open_braces > close_braces:
        issues.append(f"Missing {open_braces - close_braces} closing brace(s) '}}' ")
    elif close_braces > open_braces:
        issues.append(f"Extra {close_braces - open_braces} closing brace(s) '}}'")

    if open_brackets > close_brackets:
        issues.append(f"Missing {open_brackets - close_brackets} closing bracket(s) ']'")
    elif close_brackets > open_brackets:
        issues.append(f"Extra {close_brackets - open_brackets} closing bracket(s) ']'")

    if not issues:
        return "Brackets appear balanced up to error position"
    return " | ".join(issues)


def diagnose_json_error(parsed_data: str, error: json.JSONDecodeError) -> str:
    """
    Diagnose common JSON errors and provide specific, actionable error messages.

    Returns a detailed error message with:
    - Specific error type detection
    - Line and column numbers
    - Context around the error
    - Suggested fixes
    """
    error_pos = error.pos if hasattr(error, "pos") else None
    error_msg = str(error)

    # Convert character position to line and column
    if error_pos is not None and isinstance(parsed_data, str):
        lines = parsed_data[:error_pos].split("\n")
        line_num = len(lines)
        col_num = len(lines[-1]) + 1

        # Get context
        context_size = 200
        start_pos = max(0, error_pos - context_size)
        end_pos = min(len(parsed_data), error_pos + context_size)

        before = parsed_data[start_pos:error_pos]
        at_error = parsed_data[error_pos : error_pos + 1] if error_pos < len(parsed_data) else ""
        after = parsed_data[error_pos + 1 : end_pos]

        context_snippet = f"{before}<<<ERROR_HERE>>>{at_error}{after}"

        # Detect specific error patterns
        error_type = "Unknown JSON error"
        suggested_fix = ""

        # Pattern 1: Extra data (multiple JSON objects or extra closing brackets)
        if "Extra data" in error_msg:
            # Check if there are extra closing brackets
            if at_error in "}]":
                error_type = "Extra closing bracket detected"
                suggested_fix = "Remove the extra '}' or ']' at this position, or check if you're outputting multiple JSON objects instead of one."
            else:
                error_type = "Multiple JSON objects or trailing content"
                suggested_fix = "Ensure you're outputting only ONE complete JSON object. The JSON appears to be complete but has additional content after it."

        # Pattern 2: Expecting delimiter (missing comma or extra brace)
        elif "Expecting ',' delimiter" in error_msg or "Expecting ','" in error_msg:
            # Check what's at the error position
            context_before_error = parsed_data[max(0, error_pos - 50) : error_pos]

            # Count braces in immediate context
            if context_before_error.count("}") > context_before_error.count(","):
                error_type = "Missing comma or extra closing brace"
                suggested_fix = "There appear to be too many closing braces '}}' before this position. Either:\n  1. Add a comma ',' between object properties\n  2. Remove an extra closing brace '}'"
            else:
                error_type = "Missing comma between JSON elements"
                suggested_fix = "Add a comma ',' between the previous element and the next one."

        # Pattern 3: Expecting property name
        elif "Expecting property name" in error_msg:
            error_type = "Missing property name or extra comma"
            if at_error == ",":
                suggested_fix = "Remove the trailing comma before the closing brace."
            else:
                suggested_fix = "Expected a property name (string in quotes) but found something else. Check for trailing commas or incorrect syntax."

        # Pattern 4: Expecting value
        elif "Expecting value" in error_msg:
            error_type = "Missing or invalid value"
            suggested_fix = "A value is expected here but not found. Check for:\n  1. Missing value after ':'\n  2. Extra comma\n  3. Incomplete string or number"

        # Pattern 5: Invalid escape sequence
        elif "Invalid \\escape" in error_msg or "Invalid escape" in error_msg:
            error_type = "Invalid escape sequence in string"
            # Try to find the problematic escape
            match = re.search(r"\\(.)", before[-20:])
            if match:
                char = match.group(1)
                suggested_fix = f"Invalid escape sequence '\\{char}'. Valid escapes are: \\n \\t \\r \\\" \\\\ \\/. Either:\n  1. Use double backslash: '\\\\{char}'\n  2. Remove the backslash if not needed\n  3. Use a valid escape sequence"
            else:
                suggested_fix = 'Invalid escape sequence found. Valid JSON escapes are: \\n \\t \\r \\" \\\\ \\/'

        # Pattern 6: Unterminated string
        elif "Unterminated string" in error_msg:
            error_type = "Unterminated string"
            suggested_fix = "String is not properly closed. Add closing quote '\"' or check for unescaped quotes within the string."

        # Pattern 7: Control character
        elif "Invalid control character" in error_msg:
            error_type = "Invalid control character in string"
            suggested_fix = "Control characters (newlines, tabs, etc.) must be escaped in JSON strings. Use \\n for newlines, \\t for tabs."

        # Check for common structural issues
        bracket_analysis = analyze_bracket_balance(parsed_data[:error_pos])

        detailed_msg = (
            f"JSON PARSING ERROR at line {line_num}, col {col_num}: {error_type}\n"
            f"Suggested fix: {suggested_fix}\n"
            f"Bracket analysis: {bracket_analysis}\n"
            f"Context: ...{context_snippet[-200:]}..."
        )
        return detailed_msg

    else:
        return f"Failed to decode JSON: {error_msg}"


def extract_json_from_string(ctx: Any, config_key: str, agent_name: str) -> str:
    app_config_raw = ctx.session.state.get(config_key)

    if app_config_raw is None:
        logger.warning(
            f"[{agent_name}] No configuration found for key '{config_key}'. Defaulting to empty."
        )
        # print all session state keys
        for key in ctx.session.state:
            logger.info(f"[{agent_name}] Session state key: {key}")
        return ""

    # Session state may hold an already-parsed dict/list (e.g. when an earlier
    # deterministic step wrote structured data instead of a JSON string).
    # Serialize back to JSON so the rest of this function — which expects a
    # string with possible markdown fences — keeps working.
    if isinstance(app_config_raw, (dict, list)):
        return json.dumps(app_config_raw)

    if not isinstance(app_config_raw, str):
        logger.warning(
            f"[{agent_name}] Unexpected type for '{config_key}': "
            f"{type(app_config_raw).__name__}. Coercing to string."
        )
        app_config_raw = str(app_config_raw)

    app_config_raw = app_config_raw.replace("```json", "").replace("```", "").strip()
    logger.info(f"[{agent_name}] Initial app_config type: {type(app_config_raw)}")

    if not app_config_raw:
        return ""

    # firstly check if the app_config_raw is a valid JSON string
    try:
        json.loads(app_config_raw)
        logger.info(f"[{agent_name}] App_config_raw is a valid JSON string")
        return app_config_raw
    except json.JSONDecodeError:
        logger.error(f"[{agent_name}] JSONDecodeError:: App_config_raw is not a valid JSON string")
        logger.info(f"[{agent_name}] app_config_raw::" + str(app_config_raw))

    parsed_data = app_config_raw
    if isinstance(parsed_data, str):
        # Extract JSON from markdown code fences (handles explanatory text before JSON)
        parsed_data = parsed_data.strip()

        # Pattern 1: Look for ```json ... ``` blocks
        if "```json" in parsed_data or "```" in parsed_data:
            logger.info(f"[{agent_name}] Detected markdown code fences in output")

            # Find the first ```json or ``` marker
            json_start = parsed_data.find("```json")
            generic_start = parsed_data.find("```")

            if json_start != -1:
                # Found ```json, extract content after it
                content_start = json_start + 7  # len("```json")
                # Find the closing ```
                content_end = parsed_data.find("```", content_start)
                if content_end != -1:
                    parsed_data = parsed_data[content_start:content_end].strip()
                    logger.info(f"[{agent_name}] Extracted JSON from ```json code fence")
                else:
                    # No closing fence, take everything after ```json
                    parsed_data = parsed_data[content_start:].strip()
                    logger.warning(
                        f"[{agent_name}] No closing fence found, extracted rest of string"
                    )
            elif generic_start != -1:
                # Found generic ```, extract content after it
                content_start = generic_start + 3  # len("```")
                # Skip any newlines after the opening fence
                while content_start < len(parsed_data) and parsed_data[content_start] in "\n\r":
                    content_start += 1
                # Find the closing ```
                content_end = parsed_data.find("```", content_start)
                if content_end != -1:
                    parsed_data = parsed_data[content_start:content_end].strip()
                    logger.info(f"[{agent_name}] Extracted JSON from generic ``` code fence")
                else:
                    # No closing fence, take everything after ```
                    parsed_data = parsed_data[content_start:].strip()
                    logger.warning(
                        f"[{agent_name}] No closing fence found, extracted rest of string"
                    )

        # Pattern 2: If no code fences but string starts with explanatory text before {
        # Look for the first { which indicates JSON start
        if not parsed_data.startswith("{") and not parsed_data.startswith("["):
            first_brace = parsed_data.find("{")
            first_bracket = parsed_data.find("[")

            # Determine which comes first (or if only one exists)
            json_start_pos = -1
            if first_brace != -1 and first_bracket != -1:
                json_start_pos = min(first_brace, first_bracket)
            elif first_brace != -1:
                json_start_pos = first_brace
            elif first_bracket != -1:
                json_start_pos = first_bracket

            if json_start_pos > 0:
                explanatory_text = parsed_data[:json_start_pos].strip()
                if explanatory_text:
                    logger.info(
                        f"[{agent_name}] Detected explanatory text before JSON: '{explanatory_text[:100]}...'"
                    )
                    parsed_data = parsed_data[json_start_pos:].strip()
                    logger.info(
                        f"[{agent_name}] Extracted JSON starting from position {json_start_pos}"
                    )

        parsed_data = parsed_data.strip()

    return parsed_data


def repair_json_string(
    ctx: Any, config_key: str, agent_name: str = "Agent", output_format: str = "dict"
) -> Union[dict, str, None]:

    parsed_data = extract_json_from_string(ctx, config_key, agent_name)
    if len(parsed_data) == 0:
        logger.error(f"[{agent_name}] No JSON found in the string.")
        return None

    repaired = _json_repair.loads(parsed_data)
    if not isinstance(repaired, (dict, list)) or not repaired:
        logger.error(f"[{agent_name}] json_repair returned empty or scalar result.")
        return None

    return json.dumps(repaired, separators=(",", ":")) if output_format == "string" else repaired


def safe_app_config_load(
    ctx: Any, config_key: str, agent_name: str = "Agent", output_format: str = "dict"
) -> Union[dict, str]:
    """
    Safely loads, repairs, and parses app_config from session state.

    This function handles multiple scenarios:
    - app_config is a valid JSON string (parses it).
    - app_config is a multiply-encoded JSON string (unwraps it).
    - app_config is a JSON string with common errors, like invalid escape
      sequences (attempts to repair and then parse it).
    - app_config is already a parsed dict (returns as-is).
    - app_config is None or an unexpected type (returns an empty representation).
    - app_config contains markdown code fences with explanatory text (extracts JSON).

    Args:
        ctx: The invocation context containing session state.
        config_key: The key to retrieve the configuration from the session state.
        agent_name: Optional agent name for logging purposes.
        output_format: The desired output format, either "dict" (default) or "string".

    Returns:
        Union[dict, str]: The parsed configuration. Returns an empty dictionary
                          or an empty JSON object string based on the output_format.
    """

    parsed_data = extract_json_from_string(ctx, config_key, agent_name)

    # Handle empty string case early - return empty dict/string instead of raising exception
    if not parsed_data or (isinstance(parsed_data, str) and not parsed_data.strip()):
        logger.warning(
            f"[{agent_name}] Empty or missing config for key '{config_key}'. Returning empty config."
        )
        if output_format == "string":
            return "{}"
        return {}

    # Iteratively decode if the data is a string (handles multiple encoding layers)
    max_decodes = 10  # Safety limit to prevent infinite loops
    decode_count = 0
    while isinstance(parsed_data, str) and decode_count < max_decodes:
        try:
            parsed_data = json.loads(parsed_data)
            decode_count += 1
            if isinstance(parsed_data, str):
                logger.warning(
                    f"[{agent_name}] Unwrapped a layer of JSON string. Continuing to parse."
                )
            else:
                logger.info(
                    f"[{agent_name}] Successfully parsed JSON string after {decode_count} layer(s)."
                )

        except json.JSONDecodeError as e:
            error_msg = diagnose_json_error(parsed_data, e)
            logger.warning(
                f"[{agent_name}] JSON decode failed for key '{config_key}': {error_msg}. Returning empty config."
            )
            if output_format == "string":
                return "{}"
            return {}

    # Final check: ensure the result is a dictionary before final formatting
    if not isinstance(parsed_data, dict):
        logger.warning(
            f"[{agent_name}] Parsed data is not a dictionary (type: {type(parsed_data)}). Defaulting to empty config."
        )
        parsed_dict = {}
    else:
        parsed_dict = parsed_data

    # Return in the requested format
    if output_format == "string":
        return json.dumps(parsed_dict, separators=(",", ":"))

    return parsed_dict


def _parse_json_strings_recursively(obj: Any, max_depth: int = 20, _depth: int = 0) -> Any:
    """
    Recursively parse any JSON string values in a dict/list structure.
    This handles cases where LLM outputs nested objects as JSON strings
    instead of proper nested objects.

    Args:
        obj: The object to process
        max_depth: Maximum recursion depth (default 20)
        _depth: Internal depth counter (do not set manually)

    Returns:
        The object with JSON strings parsed into proper dicts/lists
    """
    if _depth > max_depth:
        logger.warning(
            f"[_parse_json_strings_recursively] Max recursion depth ({max_depth}) exceeded, returning object as-is"
        )
        return obj

    if isinstance(obj, str):
        # Check if it looks like a JSON object or array
        stripped = obj.strip()
        if (stripped.startswith("{") and stripped.endswith("}")) or (
            stripped.startswith("[") and stripped.endswith("]")
        ):
            try:
                parsed = json.loads(obj)
                # Recursively process the parsed result
                return _parse_json_strings_recursively(parsed, max_depth, _depth + 1)
            except json.JSONDecodeError:
                return obj
        return obj
    elif isinstance(obj, dict):
        return {
            k: _parse_json_strings_recursively(v, max_depth, _depth + 1) for k, v in obj.items()
        }
    elif isinstance(obj, list):
        return [_parse_json_strings_recursively(item, max_depth, _depth + 1) for item in obj]
    else:
        return obj
