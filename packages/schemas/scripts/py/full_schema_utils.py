"""
Utility functions for retrieving schemas from the full_schema_model folder.

This module provides functions to retrieve the complete unified catalog and specific
schemas (apps, pages, components) from the full_schema_model directory.
"""

import json
import os
import re

# Path configuration
current_dir = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.normpath(os.path.join(current_dir, '..', '..', 'data'))
FULL_SCHEMA_BASE_PATH = os.path.join(DATA_DIR, "full_schema_model")
FULL_CATALOG_PATH_ABS = os.path.join(FULL_SCHEMA_BASE_PATH, "full_catalog.json")
FULL_SCHEMA_PATH_ABS = os.path.join(FULL_SCHEMA_BASE_PATH, "full_schema.json")


def _strip_dollar_refs(obj):
    """
    Safety-net: recursively remove any '$ref' keys from a nested dict/list structure.

    The Gemini API interprets '$ref' in function_response payloads as references to
    declared tool names and throws 400 INVALID_ARGUMENT when no match is found.
    This function ensures no '$ref' survives into responses sent back to the model.
    """
    if isinstance(obj, dict):
        cleaned = {}
        for key, value in obj.items():
            if key == "$ref":
                # Replace with a safe description
                ref_val = value if isinstance(value, str) else str(value)
                cleaned["_ref_description"] = f"(reference: {ref_val})"
                continue
            cleaned[key] = _strip_dollar_refs(value)
        return cleaned
    elif isinstance(obj, list):
        return [_strip_dollar_refs(item) for item in obj]
    return obj


def _find_schema_references(schema_obj) -> set:
    """
    Recursively finds all schema type references in a schema object.
    Returns a set of type names that are referenced.

    Args:
        schema_obj: The schema object to search for references

    Returns:
        set: A set of referenced type names
    """
    references = set()

    if isinstance(schema_obj, dict):
        for key, value in schema_obj.items():
            if key == "$ref" and isinstance(value, str):
                # Extract type from reference like "#/definitions/TypeName"
                match = re.search(r"#/definitions/([^/]+)", value)
                if match:
                    references.add(match.group(1))
            else:
                references.update(_find_schema_references(value))
    elif isinstance(schema_obj, list):
        for item in schema_obj:
            references.update(_find_schema_references(item))

    return references


def get_exepad_schema_catalog() -> dict:
    """
    Reads the full schema catalog from the file and returns it as a dictionary.
    The catalog contains apps, pages, and components sections.

    Returns:
        dict: Dictionary with 'status' ('success' or 'error') and 'catalog' (the catalog data)
    """
    try:
        with open(FULL_CATALOG_PATH_ABS, "r", encoding="utf-8") as file:
            catalog = json.load(file)
        return {"status": "success", "catalog": catalog}
    except FileNotFoundError:
        return {
            "status": "error",
            "error_message": f"Catalog file not found at {FULL_CATALOG_PATH_ABS}",
        }
    except Exception as e:
        return {"status": "error", "error_message": f"Error reading catalog: {e}"}


def get_exepad_schema(schema_list: list[str], include_dependencies: bool = True) -> dict:
    """
    Reads specific schemas from the full schema file and returns them as a dictionary.

    Note: This function is also exposed as an LLM tool. The type guard below handles
    cases where the LLM passes a string instead of a list.

    This function retrieves the requested schemas (apps, pages, or components) from the
    full_schema.json file. It can optionally include all dependent schemas that are
    referenced by the requested schemas.

    Args:
        schema_list: list[str]
            A list of schema type names to retrieve. Can include apps (e.g., 'WebAppProps'),
            pages (e.g., 'WebPageProps', 'BlogPostPageProps'), and components
            (e.g., 'CodeComponentProps').

        include_dependencies: bool (default: True)
            If True, automatically includes all schemas that are referenced by the
            requested schemas. This ensures you get a complete, self-contained set of
            schemas. Set to False if you only want the exact schemas requested.

    Returns:
        dict: Dictionary with 'status' ('success' or 'error') and 'schemas' (list of schemas)

    Example:
        # Get CodeComponentProps and all its dependencies
        result = get_exepad_schema(['CodeComponentProps'])
        if result["status"] == "success":
            schemas = result["schemas"]
    """
    # Type guard: Handle case where LLM passes a string instead of a list
    if isinstance(schema_list, str):
        schema_list = [schema_list]

    schema_dict = {}
    visited_types = set()

    try:
        with open(FULL_SCHEMA_PATH_ABS, "r", encoding="utf-8") as file:
            full_schema = json.load(file)

            if "definitions" not in full_schema:
                return {"status": "error", "error_message": "No definitions found in full schema"}

            def resolve_ref(schema_obj, definitions, resolving=None):
                """
                Recursively resolve $ref references in a schema object.
                This replaces $ref with the actual schema definition inline.

                IMPORTANT: The output of this function may be returned to Gemini as a
                function_response. Gemini's API interprets any "$ref" key as a reference
                to a declared function/tool name and will throw 400 INVALID_ARGUMENT if
                the name doesn't match. Therefore, circular references MUST be replaced
                with a plain description — never leave raw "$ref" in the output.

                Args:
                    schema_obj: The schema object to resolve
                    definitions: The definitions dictionary from the full schema
                    resolving: Set of types currently being resolved (to detect circular refs)

                Returns:
                    The schema object with all $ref references resolved inline
                """
                if resolving is None:
                    resolving = set()

                if isinstance(schema_obj, dict):
                    # Check if this is a $ref
                    if "$ref" in schema_obj:
                        ref_path = schema_obj["$ref"]
                        if ref_path.startswith("#/definitions/"):
                            ref_type = ref_path.replace("#/definitions/", "")

                            # Check for circular references — replace with a safe
                            # placeholder instead of leaving $ref intact (which would
                            # cause Gemini API to crash with INVALID_ARGUMENT).
                            if ref_type in resolving:
                                return {
                                    "type": "object",
                                    "description": f"(recursive reference to {ref_type})",
                                }

                            if ref_type in definitions:
                                # Add to resolving set to track circular refs
                                resolving.add(ref_type)

                                # Get the referenced schema and resolve it
                                referenced_schema = definitions[ref_type]
                                resolved = resolve_ref(referenced_schema, definitions, resolving)

                                # Remove from resolving set
                                resolving.discard(ref_type)

                                # Merge any additional properties from the $ref object
                                # (like "default", "description", etc.)
                                result = {**resolved}
                                for key, value in schema_obj.items():
                                    if key != "$ref":
                                        result[key] = value

                                return result

                        # Unknown $ref pattern — strip it to be safe
                        safe = {k: v for k, v in schema_obj.items() if k != "$ref"}
                        safe["description"] = safe.get(
                            "description", f"(unresolved reference: {ref_path})"
                        )
                        return safe
                    else:
                        # Recursively resolve all nested objects
                        return {
                            k: resolve_ref(v, definitions, resolving) for k, v in schema_obj.items()
                        }
                elif isinstance(schema_obj, list):
                    return [resolve_ref(item, definitions, resolving) for item in schema_obj]
                else:
                    return schema_obj

            def collect_schema_and_dependencies(schema_type: str):
                """Recursively collect schema and all its dependencies"""
                if schema_type in visited_types:
                    return

                visited_types.add(schema_type)

                try:
                    if schema_type in full_schema["definitions"]:
                        schema_def = full_schema["definitions"][schema_type]
                        # Resolve all $ref references inline before storing
                        resolved_schema = resolve_ref(schema_def, full_schema["definitions"])
                        schema_with_type = {"schemaTypeName": schema_type, **resolved_schema}
                        schema_dict[schema_type] = schema_with_type

                        if include_dependencies:
                            referenced_types = _find_schema_references(schema_def)
                            for ref_type in referenced_types:
                                collect_schema_and_dependencies(ref_type)
                    else:
                        print(f"Warning: Schema type '{schema_type}' not found in full schema")

                except Exception as e:
                    print(f"Error getting schema for '{schema_type}': {e}")

            # Start with the requested schema types
            for schema_type in schema_list:
                collect_schema_and_dependencies(schema_type)

        schema_list_result = list(schema_dict.values())
        requested_set = set(schema_list)
        schema_list_result.sort(
            key=lambda x: (x["schemaTypeName"] not in requested_set, x["schemaTypeName"])
        )

        # Safety net: strip any surviving $ref keys so the Gemini API never
        # sees them in function_response payloads.
        schema_list_result = _strip_dollar_refs(schema_list_result)

        return {"status": "success", "schemas": schema_list_result}

    except FileNotFoundError:
        return {
            "status": "error",
            "error_message": f"Schema file not found at {FULL_SCHEMA_PATH_ABS}",
        }
    except Exception as e:
        return {"status": "error", "error_message": f"Error reading schema: {e}"}


def get_exepad_theme_schema() -> dict:
    """
    Retrieves the theme schema from the full schema.
    This includes ThemeProps and all related theme types.

    Returns:
        dict: Dictionary with 'status' ('success' or 'error') and 'schema' (the theme schema)
    """
    try:
        return get_exepad_schema(schema_list=["ThemeProps"], include_dependencies=True)
    except Exception as e:
        return {"status": "error", "error_message": f"Error getting theme schema: {e}"}


# Helper functions for prompt generation - return formatted JSON strings
def get_app_schema_str() -> str:
    """Helper function for prompt generation - returns formatted JSON string."""
    result = get_exepad_schema(schema_list=["WebAppProps"], include_dependencies=True)
    if result["status"] == "success":
        return (
            "```json\n"
            + json.dumps(result["schemas"], ensure_ascii=False, separators=(",", ":"))
            + "\n```"
        )
    else:
        return f"Error: {result.get('error_message', 'Unknown error')}"
