"""
Type detection system — priority-based detection of JSON config types.

Uses discriminator fields, field signatures, and schema scoring to
identify whether a JSON object is a WebAppProps, WebPageProps, ThemeProps, etc.
"""


# Type discriminator fields: field_name -> resolver function
TYPE_DISCRIMINATORS = {
    "appType": lambda val: val if isinstance(val, str) else None,
    "pageType": lambda val: val if isinstance(val, str) else None,
    "componentType": lambda val: val if isinstance(val, str) else None,
}

# Known valid types for each discriminator
VALID_DISCRIMINATOR_VALUES = {
    "appType": {"WebAppProps"},
    "pageType": {"WebPageProps", "BlogMainPageProps", "BlogPostPageProps"},
    "componentType": None,  # Any value is valid (checked against schema definitions)
}

# Fallback type signatures: required fields, forbidden fields, optional distinguishing fields
TYPE_FALLBACK_SIGNATURES = {
    "WebAppProps": {
        "required": {"uuid", "name", "alias"},
        "forbidden": {"appType", "pageType", "componentType", "slug"},
        "optional": {"frontend", "backend", "repo", "version", "summary", "shortSummary", "lastUpdatedEpoch", "security", "secrets"},
    },
    "ThemeProps": {
        "required": {"light", "dark"},
        "forbidden": {"appType", "pageType", "componentType", "slug", "title", "uuid", "frontend", "backend"},
        "optional": {"charts", "fonts", "fontSizes", "radius", "defaultTheme"},
    },
    "WebPageProps": {
        "required": {"title", "slug"},
        "forbidden": {"appType", "componentType", "frontend", "backend", "alias"},
        "optional": {"content", "layout", "metadata"},
    },
    "BackendProps": {
        "required": {"models"},
        "forbidden": {"appType", "pageType", "componentType", "uuid", "name", "slug", "title", "frontend"},
        "optional": {"handlers", "modules", "pipelines", "queues", "realtime", "sources", "storage", "tasks"},
    },
}

# Schema-based type scoring: types to try validation against (in priority order)
SCHEMA_VALIDATION_TYPES = [
    "WebAppProps",
    "BlogMainPageProps",
    "BlogPostPageProps",
    "WebPageProps",
    "ThemeProps",
    "BackendProps",
]


def _detect_type_by_discriminator(obj: dict) -> tuple[str | None, str | None]:
    """Detect type using explicit discriminator fields (highest confidence)."""
    for discriminator, resolver in TYPE_DISCRIMINATORS.items():
        if discriminator in obj:
            value = obj[discriminator]
            detected_type = resolver(value)

            if detected_type is None:
                return None, f"Invalid value for '{discriminator}': expected string, got {type(value).__name__}"

            valid_values = VALID_DISCRIMINATOR_VALUES.get(discriminator)
            if valid_values is not None and detected_type not in valid_values:
                return None, f"Invalid {discriminator} value: '{detected_type}'. Must be one of: {', '.join(sorted(valid_values))}"

            return detected_type, None

    return None, None


def _detect_type_by_signature(obj: dict) -> tuple[str | None, list[str]]:
    """Detect type using field signature matching (medium confidence)."""
    warnings = []
    present_fields = set(obj.keys())
    candidates = []

    for type_name, signature in TYPE_FALLBACK_SIGNATURES.items():
        required = signature.get("required", set())
        forbidden = signature.get("forbidden", set())
        optional = signature.get("optional", set())

        missing_required = required - present_fields
        if missing_required:
            continue

        has_forbidden = present_fields & forbidden
        if has_forbidden:
            continue

        optional_matches = len(present_fields & optional)
        total_required = len(required)
        score = total_required * 10 + optional_matches

        candidates.append((type_name, score))

    if not candidates:
        return None, []

    candidates.sort(key=lambda x: -x[1])
    best_type = candidates[0][0]

    warnings.append(f"Type '{best_type}' detected by field signature (no explicit type discriminator field)")

    return best_type, warnings


def _detect_type_by_schema_validation(obj: dict, schema_definitions: dict) -> tuple[str | None, float]:
    """Detect type by trying schema validation against known types (lowest confidence)."""
    present_fields = set(obj.keys())
    candidates = []

    for type_name in SCHEMA_VALIDATION_TYPES:
        if type_name not in schema_definitions:
            continue

        type_def = schema_definitions[type_name]
        required_fields = set(type_def.get("required", []))
        all_properties = set(type_def.get("properties", {}).keys())

        missing_required = required_fields - present_fields
        present_required = required_fields & present_fields
        extra_fields = present_fields - all_properties
        valid_fields = present_fields & all_properties

        if len(missing_required) > len(required_fields) * 0.5:
            continue

        required_score = len(present_required) / max(len(required_fields), 1)
        field_validity = len(valid_fields) / max(len(present_fields), 1)
        penalty = len(extra_fields) * 0.1

        score = (required_score * 0.6 + field_validity * 0.4) - penalty
        score = max(0, min(1, score))

        if score > 0.3:
            candidates.append((type_name, score))

    if not candidates:
        return None, 0.0

    candidates.sort(key=lambda x: -x[1])
    return candidates[0]


def detect_target_type(obj: dict, schema_definitions: dict | None = None) -> dict:
    """
    Detect the target type of a JSON object using a multi-strategy approach.

    Detection priority:
    1. Explicit discriminator fields (appType, pageType, componentType)
    2. Field signature matching (required/forbidden field patterns)
    3. Schema-based validation scoring (if schema provided)

    Returns:
        dict with keys: type, confidence, method, warnings, error.
    """
    result = {
        "type": None,
        "confidence": None,
        "method": None,
        "warnings": [],
        "error": None,
    }

    detected, error = _detect_type_by_discriminator(obj)
    if error:
        result["error"] = error
        return result

    if detected:
        result["type"] = detected
        result["confidence"] = "high"
        result["method"] = "discriminator"
        return result

    detected, warnings = _detect_type_by_signature(obj)
    if detected:
        result["type"] = detected
        result["confidence"] = "medium"
        result["method"] = "signature"
        result["warnings"] = warnings
        return result

    if schema_definitions:
        detected, score = _detect_type_by_schema_validation(obj, schema_definitions)
        if detected and score > 0.3:
            result["type"] = detected
            result["confidence"] = "low"
            result["method"] = "schema"
            result["warnings"] = [
                f"Type '{detected}' detected with {score:.0%} confidence by schema matching. "
                f"Consider adding an explicit type field (appType, pageType, or componentType)."
            ]
            return result

    result["error"] = _get_type_detection_hint(obj)
    return result


def _get_type_detection_hint(obj: dict) -> str:
    """Generate a helpful error message when type detection fails."""
    hints = []
    present_fields = set(obj.keys())

    if "title" in present_fields and "slug" in present_fields:
        if "pageType" not in present_fields:
            hints.append("Looks like a Page object - add 'pageType' field (e.g., 'WebPageProps', 'BlogPostPageProps', 'BlogMainPageProps')")

    if "light" in present_fields or "dark" in present_fields:
        if "light" not in present_fields:
            hints.append("Looks like a Theme object but missing 'light' palette")
        if "dark" not in present_fields:
            hints.append("Looks like a Theme object but missing 'dark' palette")

    if "name" in present_fields and "layout" in present_fields:
        if "appType" not in present_fields:
            hints.append("Looks like an App object - add 'appType' field (e.g., 'WebAppProps')")

    if not hints:
        hints.append(
            "Cannot detect JSON object type. Ensure your object has one of: "
            "'appType' (for apps), 'pageType' (for pages), 'componentType' (for components), "
            "or both 'light' and 'dark' fields (for themes)."
        )
        if present_fields:
            sample_fields = list(present_fields)[:10]
            hints.append(f"Found fields: {', '.join(sorted(sample_fields))}")

    return " | ".join(hints)
