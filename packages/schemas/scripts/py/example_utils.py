"""
Utility functions for retrieving examples from the examples folder.

This module provides functions to retrieve example catalogs and specific examples
by ID for all categories: blocks_website, blocks_header, blocks_footer, blocks_form,
blocks_blog, blocks_dataapp, blocks_scaffold, blocks_common, logic_common, backend,
components, and full.
"""

import json
import os
from typing import Optional
import structlog

logger = structlog.get_logger(__name__)

# Path configuration
current_dir = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.normpath(os.path.join(current_dir, '..', '..', 'data'))
EXAMPLES_BASE_PATH = os.path.join(DATA_DIR, 'examples')


def _read_catalog_file(catalog_name: str) -> dict:
    """
    Helper function to read a catalog file.

    Args:
        catalog_name: Name of the catalog file (e.g., 'catalog_blocks_website.json')

    Returns:
        dict: Dictionary with 'status' and 'catalog' or 'error_message'
    """
    catalog_path = os.path.join(EXAMPLES_BASE_PATH, catalog_name)
    try:
        with open(catalog_path, 'r', encoding='utf-8') as file:
            catalog = json.load(file)
        return {
            "status": "success",
            "catalog": catalog
        }
    except FileNotFoundError:
        return {
            "status": "error",
            "error_message": f"Catalog file not found at {catalog_path}"
        }
    except Exception as e:
        return {
            "status": "error",
            "error_message": f"Error reading catalog: {e}"
        }


def _read_example_file(category: str, example_id: str, subfolder: Optional[str] = None) -> dict:
    """
    Helper function to read an example file by ID.

    Args:
        category: Category name (e.g., 'blocks_website', 'blocks_dataapp', 'logic_common')
        example_id: Example ID (e.g., 'block-hero-1')
        subfolder: Optional subfolder within category (e.g., 'main', 'posts' for blocks_blog)

    Returns:
        dict: Dictionary with 'status' and 'example' or 'error_message'
    """
    logger.info(f"[_read_example_file] Starting to load example",
                category=category, example_id=example_id, subfolder=subfolder)

    if subfolder:
        example_path = os.path.join(EXAMPLES_BASE_PATH, category, subfolder, f"{example_id}.json")
    else:
        example_path = os.path.join(EXAMPLES_BASE_PATH, category, f"{example_id}.json")

    logger.info(f"[_read_example_file] Constructed path", example_path=example_path,
                exists=os.path.exists(example_path))

    try:
        logger.debug(f"[_read_example_file] Opening file: {example_path}")
        with open(example_path, 'r', encoding='utf-8') as file:
            example = json.load(file)

        # Calculate content counts (prefer frontend.* for WebAppProps examples)
        frontend = example.get("frontend", {})
        if not isinstance(frontend, dict):
            frontend = {}
        pages = frontend.get("pages", []) or example.get("pages", [])
        header = frontend.get("header", []) or example.get("header", [])
        footer = frontend.get("footer", []) or example.get("footer", [])
        first_page_content = pages[0].get("content", []) if pages else []

        logger.info(f"[_read_example_file] Successfully loaded example",
                    example_id=example_id,
                    pages_count=len(pages),
                    header_items_count=len(header),
                    footer_items_count=len(footer),
                    first_page_content_count=len(first_page_content),
                    top_level_keys=list(example.keys())[:10])

        return {
            "status": "success",
            "example": example
        }
    except FileNotFoundError:
        logger.error(f"[_read_example_file] FILE NOT FOUND",
                     example_path=example_path,
                     category=category,
                     example_id=example_id,
                     base_path=EXAMPLES_BASE_PATH,
                     base_path_exists=os.path.exists(EXAMPLES_BASE_PATH))
        return {
            "status": "error",
            "error_message": f"Example file not found at {example_path}"
        }
    except json.JSONDecodeError as e:
        logger.error(f"[_read_example_file] JSON DECODE ERROR",
                     example_path=example_path,
                     error=str(e),
                     line=e.lineno if hasattr(e, 'lineno') else None)
        return {
            "status": "error",
            "error_message": f"Invalid JSON in example file {example_path}: {e}"
        }
    except Exception as e:
        logger.error(f"[_read_example_file] UNEXPECTED ERROR",
                     example_path=example_path,
                     error_type=type(e).__name__,
                     error=str(e))
        return {
            "status": "error",
            "error_message": f"Error reading example: {e}"
        }


# ============================================================================
# BLOCKS WEBSITE Category Functions
# ============================================================================

def get_example_catalog_blocks() -> dict:
    """Retrieves the blocks_website catalog (website block examples)."""
    return _read_catalog_file('catalog_blocks_website.json')


def get_example_blocks_by_id(example_id: str) -> dict:
    """Retrieves a specific website block example by its ID."""
    logger.info(f"[get_example_blocks_by_id] Called with example_id={example_id}")
    result = _read_example_file('blocks_website', example_id)
    logger.info(f"[get_example_blocks_by_id] Result status={result.get('status')}")
    return result


# ============================================================================
# BLOCKS DATAAPP Category Functions
# ============================================================================

def get_example_catalog_blocks_dataapp() -> dict:
    """Retrieves the blocks_dataapp catalog (data app block examples)."""
    return _read_catalog_file('catalog_blocks_dataapp.json')


def get_example_blocks_dataapp_by_id(example_id: str) -> dict:
    """Retrieves a specific dataapp block example by its ID."""
    return _read_example_file('blocks_dataapp', example_id)


# ============================================================================
# BLOCKS COMMON Category Functions
# ============================================================================

def get_example_catalog_blocks_common() -> dict:
    """Retrieves the blocks_common catalog (shared blocks for all app types)."""
    return _read_catalog_file('catalog_blocks_common.json')


def get_example_blocks_common_by_id(example_id: str) -> dict:
    """Retrieves a specific common block example by its ID."""
    return _read_example_file('blocks_common', example_id)


# ============================================================================
# BLOCKS HEADER Category Functions
# ============================================================================

def get_example_catalog_header() -> dict:
    """Retrieves the blocks_header catalog."""
    return _read_catalog_file('catalog_blocks_header.json')


def get_example_skeleton_by_id(example_id: str) -> dict:
    """
    Retrieves a header or footer example by its ID.
    Routes to blocks_header or blocks_footer based on prefix.
    """
    logger.info(f"[get_example_skeleton_by_id] Called with example_id={example_id}")
    if example_id.startswith("block-footer-"):
        result = _read_example_file('blocks_footer', example_id)
    else:
        result = _read_example_file('blocks_header', example_id)
    logger.info(f"[get_example_skeleton_by_id] Result status={result.get('status')}")
    return result


# ============================================================================
# BLOCKS FOOTER Category Functions
# ============================================================================

def get_example_catalog_footer() -> dict:
    """Retrieves the blocks_footer catalog."""
    return _read_catalog_file('catalog_blocks_footer.json')


# ============================================================================
# BLOCKS FORM Category Functions
# ============================================================================

def get_example_catalog_forms() -> dict:
    """Retrieves the blocks_form catalog."""
    return _read_catalog_file('catalog_blocks_form.json')


def get_example_forms_by_id(example_id: str) -> dict:
    """Retrieves a specific form block example by its ID."""
    return _read_example_file('blocks_form', example_id)


# ============================================================================
# BLOG Category Functions
# ============================================================================

def get_example_catalog_blog() -> dict:
    """Retrieves the blocks_blog catalog."""
    return _read_catalog_file('catalog_blocks_blog.json')


def get_example_blog_by_id(example_id: str, subfolder: str = 'main') -> dict:
    """
    Retrieves a specific blog example by its ID.

    Args:
        example_id: The blog ID
        subfolder: The subfolder ('main' or 'posts'), defaults to 'main'
    """
    return _read_example_file('blocks_blog', example_id, subfolder)


# ============================================================================
# COMPONENTS Category Functions (legacy location)
# ============================================================================

def get_example_catalog_components() -> dict:
    """Retrieves the components catalog (kitchen-sink examples)."""
    return _read_catalog_file('catalog_components.json')


def get_example_components_by_id(example_id: str) -> dict:
    """Retrieves a specific component example by its ID."""
    return _read_example_file('components', example_id)


# ============================================================================
# FULL Category Functions (legacy location)
# ============================================================================

def get_example_catalog_full() -> dict:
    """Retrieves the full catalog (complete app examples)."""
    return _read_catalog_file('catalog_full.json')


def get_example_full_by_id(example_id: str, subfolder: str = 'websites') -> dict:
    """
    Retrieves a specific full example by its ID.

    Args:
        example_id: The full example ID
        subfolder: The subfolder ('websites', 'forms', 'blog_posts', 'dataapp'), defaults to 'websites'
    """
    return _read_example_file('full', example_id, subfolder)


# ============================================================================
# LOGIC COMMON Category Functions
# ============================================================================

def get_example_catalog_logic_common() -> dict:
    """Retrieves the logic_common catalog (logic pattern examples)."""
    return _read_catalog_file('catalog_logic_common.json')


def get_example_logic_common_by_id(example_id: str) -> dict:
    """Retrieves a specific logic pattern example by its ID."""
    return _read_example_file('logic_common', example_id)


def load_all_logic_examples() -> list:
    """
    Load all logic examples for injection into LogicBuilder instruction.

    Returns:
        List of logic example dicts, each containing id/summary/pattern/logic.
    """
    result = _read_catalog_file('catalog_logic_common.json')
    if result["status"] != "success":
        logger.warning("Failed to load logic catalog", error=result.get("error_message"))
        return []
    examples = []
    for example_id in result["catalog"]:
        ex = _read_example_file('logic_common', example_id)
        if ex["status"] == "success":
            examples.append(ex["example"])
    logger.info(f"Loaded {len(examples)} logic examples")
    return examples


# ============================================================================
# BACKEND Category Functions
# ============================================================================

def get_example_catalog_backend() -> dict:
    """Retrieves the backend catalog (backend config examples)."""
    return _read_catalog_file('catalog_backend.json')


def get_example_backend_by_id(example_id: str) -> dict:
    """Retrieves a specific backend config example by its ID."""
    return _read_example_file('backend', example_id)


def load_all_backend_examples() -> list:
    """
    Load all backend examples for injection into BackendPropsBuilder instruction.

    Returns:
        List of backend example dicts, each containing id/summary/pattern/backend.
    """
    result = _read_catalog_file('catalog_backend.json')
    if result["status"] != "success":
        logger.warning("Failed to load backend catalog", error=result.get("error_message"))
        return []
    examples = []
    for example_id in result["catalog"]:
        ex = _read_example_file('backend', example_id)
        if ex["status"] == "success":
            examples.append(ex["example"])
    logger.info(f"Loaded {len(examples)} backend examples")
    return examples


# ============================================================================
# FOLDER MAP — reverse lookup from example_id to source folder
# ============================================================================

def build_folder_map() -> dict:
    """
    Build a reverse lookup map: example_id -> category folder name.
    Used by load_example_content() to route to the correct folder without
    relying on prefix-based detection.

    Returns:
        dict: Mapping of example_id -> category folder name
    """
    result = _read_catalog_file('catalog_master.json')
    if result["status"] != "success":
        logger.error("Failed to load catalog_master.json for folder map")
        return {}

    folder_map = {}
    catalog = result["catalog"]
    for category_key, entries in catalog.items():
        if isinstance(entries, dict):
            for example_id in entries:
                folder_map[example_id] = category_key

    logger.info(f"Built folder map with {len(folder_map)} entries across {len(catalog)} categories")
    return folder_map


# ============================================================================
# KEYWORD MATCHING Functions
# ============================================================================

def _tokenize_description(description: str) -> set:
    """
    Tokenizes a description string into a set of lowercase words.
    """
    import re
    words = re.split(r'[^a-zA-Z0-9]+', description.lower())
    return {word for word in words if len(word) > 1}


def find_matching_blocks_by_keywords(
    keywords: list,
    max_results: int = 3,
    component_type: str = "block"
) -> list:
    """
    Matches section_keywords against catalog descriptions using keyword overlap scoring.

    Args:
        keywords: List of keywords to match against catalog descriptions
        max_results: Maximum number of example_ids to return (default: 3)
        component_type: Type of component:
            - "header" searches blocks_header catalog
            - "footer" searches blocks_footer catalog
            - "sidebar" searches blocks_sidebar catalog
            - "block" searches blocks_website + blocks_dataapp + blocks_common catalogs

    Returns:
        List of example_ids sorted by relevance (highest score first).
    """
    logger.info("find_matching_blocks_by_keywords called",
                keywords=keywords,
                max_results=max_results,
                component_type=component_type)

    if not keywords:
        logger.warning("Empty keywords list provided")
        return []

    # Load the master catalog
    result = _read_catalog_file('catalog_master.json')
    if result["status"] != "success":
        logger.error("Failed to load catalog_master.json", error=result.get("error_message"))
        return []

    catalog = result["catalog"]

    # Select the appropriate catalog(s) based on component_type
    target_catalog = {}
    if component_type == "header":
        target_catalog.update(catalog.get("blocks_header", {}))
    elif component_type == "footer":
        target_catalog.update(catalog.get("blocks_footer", {}))
    elif component_type == "sidebar":
        target_catalog.update(catalog.get("blocks_sidebar", {}))
    else:
        # For blocks, merge website + dataapp + common catalogs
        target_catalog.update(catalog.get("blocks_website", {}))
        target_catalog.update(catalog.get("blocks_dataapp", {}))
        target_catalog.update(catalog.get("blocks_common", {}))

    logger.info("Selected catalog", component_type=component_type, catalog_size=len(target_catalog))

    if not target_catalog:
        logger.warning("Target catalog is empty", component_type=component_type)
        return []

    # Tokenize and normalize input keywords
    normalized_keywords = set()
    for kw in keywords:
        if kw and isinstance(kw, str) and kw.strip():
            tokens = _tokenize_description(kw.strip())
            normalized_keywords.update(tokens)
            logger.debug("Tokenized keyword", keyword=kw, tokens=tokens)

    logger.info("Normalized keywords", normalized_keywords=list(normalized_keywords), count=len(normalized_keywords))

    if not normalized_keywords:
        logger.warning("No valid keywords after normalization", original_keywords=keywords)
        return []

    # Score each block based on keyword overlap with substring matching
    scored_blocks = []
    for block_id, description in target_catalog.items():
        description_tokens = _tokenize_description(description)

        score = 0
        matched_keywords = []
        for keyword in normalized_keywords:
            for desc_token in description_tokens:
                if keyword in desc_token or desc_token in keyword:
                    score += 1
                    matched_keywords.append(f"{keyword}->{desc_token}")
                    break

        if score > 0:
            scored_blocks.append((block_id, score))
            logger.debug("Matched block", block_id=block_id, score=score, matches=matched_keywords)

    logger.info("Scored blocks", total_matches=len(scored_blocks), top_scores=[s for _, s in scored_blocks[:5]])

    scored_blocks.sort(key=lambda x: x[1], reverse=True)
    result_ids = [block_id for block_id, _ in scored_blocks[:max_results]]
    logger.info("Returning matching IDs", matching_ids=result_ids, count=len(result_ids))
    return result_ids


def _extract_relevant_content(example: dict, component_type: str) -> list:
    """
    Extracts only the relevant section content from an example JSON.

    Args:
        example: The full example JSON dict
        component_type: Type of component - "header", "footer", "sidebar", or "block"

    Returns:
        List of component dicts (the actual content, not the full JSON)
    """
    logger.debug("Extracting content", component_type=component_type,
                example_keys=list(example.keys()) if isinstance(example, dict) else "not_dict")

    frontend = example.get("frontend", {})
    if not isinstance(frontend, dict):
        frontend = {}

    if component_type == "header":
        header_content = frontend.get("header", []) or example.get("header", [])
        logger.debug("Extracted header content", content_length=len(header_content) if isinstance(header_content, list) else 0)
        return header_content
    elif component_type == "footer":
        footer_content = frontend.get("footer", []) or example.get("footer", [])
        logger.debug("Extracted footer content", content_length=len(footer_content) if isinstance(footer_content, list) else 0)
        return footer_content
    elif component_type == "sidebar":
        sidebar_content = frontend.get("sidebar", []) or example.get("sidebar", [])
        logger.debug("Extracted sidebar content", content_length=len(sidebar_content) if isinstance(sidebar_content, list) else 0)
        return sidebar_content
    else:
        pages = frontend.get("pages", []) or example.get("pages", [])
        logger.debug("Extracting block content", pages_count=len(pages) if isinstance(pages, list) else 0)
        if pages and len(pages) > 0:
            content = pages[0].get("content", [])
            logger.debug("Extracted block content", content_length=len(content) if isinstance(content, list) else 0)
            return content
        logger.warning("No pages found in block example")
        return []


def load_examples_for_section(
    keywords: list,
    min_examples: int = 1,
    max_examples: int = 2,
    is_header: bool = False,
    is_footer: bool = False,
    is_sidebar: bool = False
) -> list:
    """
    End-to-end function: finds matching blocks by keywords and loads their relevant content.

    This is the main function to use for injecting examples into the component builder.
    It combines keyword matching with example loading, and extracts only the relevant
    section content (not the full JSON with theme, languages, etc.)

    Args:
        keywords: List of keywords to match against catalog descriptions
        min_examples: Minimum number of examples to attempt to load (default: 1)
        max_examples: Maximum number of examples to load (default: 2)
        is_header: If True, searches blocks_header catalog
        is_footer: If True, searches blocks_footer catalog
        is_sidebar: If True, searches blocks_sidebar catalog

    Returns:
        List of content arrays ready for the component_examples field.
    """
    logger.info("load_examples_for_section called",
                keywords=keywords,
                min_examples=min_examples,
                max_examples=max_examples,
                is_header=is_header,
                is_footer=is_footer,
                is_sidebar=is_sidebar)

    if not keywords:
        logger.warning("Empty keywords list provided to load_examples_for_section")
        return []

    if is_header:
        component_type = "header"
    elif is_footer:
        component_type = "footer"
    elif is_sidebar:
        component_type = "sidebar"
    else:
        component_type = "block"

    logger.info("Component type determined", component_type=component_type)

    matching_ids = find_matching_blocks_by_keywords(
        keywords,
        max_results=max_examples,
        component_type=component_type
    )

    logger.info("Matching IDs found", matching_ids=matching_ids, count=len(matching_ids))

    if not matching_ids:
        logger.warning("No matching IDs found", keywords=keywords, component_type=component_type)
        return []

    # Build folder map for routing
    folder_map = build_folder_map()

    examples = []
    for example_id in matching_ids:
        logger.info("Loading example", example_id=example_id, is_header=is_header, is_footer=is_footer)

        # Use folder_map to determine which category to read from
        category = folder_map.get(example_id)
        if category:
            result = _read_example_file(category, example_id)
        elif is_header or is_footer:
            result = get_example_skeleton_by_id(example_id)
        else:
            result = get_example_blocks_by_id(example_id)

        logger.info("Example loaded", example_id=example_id, status=result.get("status"),
                   has_error=("error_message" in result))

        if result.get("status") != "success":
            logger.warning("Failed to load example", example_id=example_id,
                          error=result.get("error_message"))
            continue

        content = _extract_relevant_content(result["example"], component_type)
        content_length = len(content) if isinstance(content, list) else 0
        logger.info("Content extracted", example_id=example_id, content_length=content_length,
                   component_type=component_type)

        if content:
            examples.append({"components": content})
            logger.info("Example added to results", example_id=example_id,
                       total_examples=len(examples))
        else:
            logger.warning("Extracted content is empty", example_id=example_id,
                          component_type=component_type)

    logger.info("load_examples_for_section returning", examples_count=len(examples))
    return examples


# ============================================================================
# SKELETON Category — backward-compatible aliases
# ============================================================================

def get_example_catalog_skeleton() -> dict:
    """Backward-compatible: returns combined header + footer catalog."""
    header = _read_catalog_file('catalog_blocks_header.json')
    footer = _read_catalog_file('catalog_blocks_footer.json')
    combined = {}
    if header["status"] == "success":
        combined.update(header["catalog"])
    if footer["status"] == "success":
        combined.update(footer["catalog"])
    return {"status": "success", "catalog": combined}


# ============================================================================
# BLOCKS SCAFFOLD Category Functions
# ============================================================================

def get_example_catalog_scaffold() -> dict:
    """Retrieves the blocks_scaffold catalog (scaffold example configs)."""
    return _read_catalog_file('catalog_blocks_scaffold.json')


def get_scaffold_example(scaffold_type: str, example_name: str, file_type: str = "app-config") -> dict:
    """
    Retrieves a specific scaffold example by type and name.

    Args:
        scaffold_type: Scaffold type directory (e.g., 'crud', 'dashboard', 'settings', 'auth', 'chat', 'combined')
        example_name: Example directory name (e.g., 'crud-table-contacts', 'dashboard-stats-basic')
        file_type: File to load ('app-config' or 'seed-data'), defaults to 'app-config'

    Returns:
        dict: Dictionary with 'status' and 'example' or 'error_message'
    """
    # Scaffold examples use nested paths: blocks_scaffold/{type}/{name}/{file}.json
    nested_path = os.path.join(scaffold_type, example_name)
    return _read_example_file('blocks_scaffold', os.path.join(nested_path, file_type))


def load_scaffold_examples_by_type(scaffold_type: str) -> list:
    """
    Load all scaffold examples for a given type (e.g., 'crud', 'dashboard').

    Args:
        scaffold_type: One of 'crud', 'dashboard', 'settings', 'auth', 'chat', 'combined'

    Returns:
        List of (example_name, app_config_dict) tuples
    """
    result = _read_catalog_file('catalog_blocks_scaffold.json')
    if result["status"] != "success":
        logger.warning("Failed to load scaffold catalog", error=result.get("error_message"))
        return []

    prefix = f"{scaffold_type}/"
    examples = []
    seen_names = set()
    for catalog_key, summary in result["catalog"].items():
        if catalog_key.startswith(prefix) and catalog_key.endswith("/app-config"):
            # Extract example name from key like "crud/crud-table-contacts/app-config"
            parts = catalog_key.split("/")
            if len(parts) >= 3:
                example_name = parts[1]
                if example_name in seen_names:
                    continue
                seen_names.add(example_name)
                ex = _read_example_file('blocks_scaffold', os.path.join(scaffold_type, example_name, "app-config"))
                if ex["status"] == "success":
                    examples.append((example_name, ex["example"]))

    logger.info(f"Loaded {len(examples)} scaffold examples for type '{scaffold_type}'")
    return examples


# ============================================================================
# THEME Category Functions
# ============================================================================

def get_example_catalog_theme() -> dict:
    """Retrieves the theme catalog."""
    return _read_catalog_file('catalog_theme.json')


def get_example_theme_by_id(example_id: str) -> dict:
    """Retrieves a specific theme example by its ID."""
    return _read_example_file('theme', example_id)


# ============================================================================
# EXAMPLE SELECTION Functions — keyword-matching selectors for builder agents
# ============================================================================

def _extract_keywords_from_plan(plan: dict) -> list:
    """
    Extract searchable keywords from an AppCreator plan dict.
    Extracts model names, handler names, action names, state variable names.
    """
    if not isinstance(plan, dict):
        return []
    keywords = []
    for key in ["state_variables", "actions", "computed_values"]:
        items = plan.get(key, [])
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    name = item.get("name", "")
                    if name:
                        keywords.append(name)
                    desc = item.get("description", "")
                    if desc:
                        keywords.append(desc)
                elif isinstance(item, str):
                    keywords.append(item)
    for model in plan.get("models", []):
        if isinstance(model, dict):
            name = model.get("name", "")
            if name:
                keywords.append(name)
    for handler in plan.get("handlers", []):
        if isinstance(handler, dict):
            name = handler.get("name", "")
            if name:
                keywords.append(name)
    return [k for k in keywords if k]


def _score_catalog_entries(catalog: dict, keywords: list) -> list:
    """
    Score catalog entries against keywords using token overlap.
    Returns list of (example_id, score) sorted by score descending.
    """
    if not catalog or not keywords:
        return []

    normalized_keywords = set()
    for kw in keywords:
        if kw and isinstance(kw, str) and kw.strip():
            tokens = _tokenize_description(kw.strip())
            normalized_keywords.update(tokens)

    if not normalized_keywords:
        return []

    scored = []
    for example_id, description in catalog.items():
        description_tokens = _tokenize_description(description)
        score = 0
        for keyword in normalized_keywords:
            for desc_token in description_tokens:
                if keyword in desc_token or desc_token in keyword:
                    score += 1
                    break
        if score > 0:
            scored.append((example_id, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored


def select_logic_examples(
    keywords: list,
    max_results: int = 2,
) -> tuple:
    """
    Select most relevant logic examples by keyword matching.

    Args:
        keywords: Keywords from the app logic plan
        max_results: Max examples to return

    Returns:
        (examples, tracking_map) where:
        - examples: list of logic example dicts (with id, summary, pattern, logic)
        - tracking_map: {tracking_key: example_id} for metrics tracking
    """
    result = _read_catalog_file('catalog_logic_common.json')
    if result["status"] != "success":
        logger.warning("Failed to load logic catalog", error=result.get("error_message"))
        return [], {}

    scored = _score_catalog_entries(result["catalog"], keywords)
    if not scored:
        return [], {}

    examples = []
    tracking = {}
    for i, (example_id, _score) in enumerate(scored[:max_results]):
        ex = _read_example_file('logic_common', example_id)
        if ex["status"] == "success":
            examples.append(ex["example"])
            tracking[f"logic_example_{i}"] = example_id

    logger.info(f"Selected {len(examples)} logic examples: {list(tracking.values())}")
    return examples, tracking


def select_backend_examples(
    keywords: list,
    max_results: int = 2,
) -> tuple:
    """
    Select most relevant backend examples by keyword matching.

    Args:
        keywords: Keywords from the app backend plan
        max_results: Max examples to return

    Returns:
        (examples, tracking_map) where:
        - examples: list of backend example dicts
        - tracking_map: {tracking_key: example_id} for metrics tracking
    """
    result = _read_catalog_file('catalog_backend.json')
    if result["status"] != "success":
        logger.warning("Failed to load backend catalog", error=result.get("error_message"))
        return [], {}

    scored = _score_catalog_entries(result["catalog"], keywords)
    if not scored:
        return [], {}

    examples = []
    tracking = {}
    for i, (example_id, _score) in enumerate(scored[:max_results]):
        ex = _read_example_file('backend', example_id)
        if ex["status"] == "success":
            examples.append(ex["example"])
            tracking[f"backend_example_{i}"] = example_id

    logger.info(f"Selected {len(examples)} backend examples: {list(tracking.values())}")
    return examples, tracking


def select_theme_examples(
    keywords: list,
    max_results: int = 1,
) -> tuple:
    """
    Select most relevant theme examples by keyword matching.

    Args:
        keywords: Design style keywords from the app plan
        max_results: Max examples to return

    Returns:
        (examples, tracking_map) where:
        - examples: list of theme example dicts
        - tracking_map: {tracking_key: example_id} for metrics tracking
    """
    result = _read_catalog_file('catalog_theme.json')
    if result["status"] != "success":
        logger.warning("Failed to load theme catalog", error=result.get("error_message"))
        return [], {}

    scored = _score_catalog_entries(result["catalog"], keywords)
    if not scored:
        return [], {}

    examples = []
    tracking = {}
    for i, (example_id, _score) in enumerate(scored[:max_results]):
        ex = _read_example_file('theme', example_id)
        if ex["status"] == "success":
            # Extract just the theme section from the full example
            frontend = ex["example"].get("frontend", {})
            theme = frontend.get("theme", {})
            if theme:
                examples.append(theme)
            else:
                examples.append(ex["example"])
            tracking[f"theme_example_{i}"] = example_id

    logger.info(f"Selected {len(examples)} theme examples: {list(tracking.values())}")
    return examples, tracking


# ============================================================================
# Async versions for compatibility
# ============================================================================

async def async_get_example_catalog_blocks() -> dict:
    """Async version of get_example_catalog_blocks()"""
    return get_example_catalog_blocks()


async def async_get_example_blocks_by_id(example_id: str) -> dict:
    """Async version of get_example_blocks_by_id()"""
    return get_example_blocks_by_id(example_id)


async def async_get_example_catalog_blog() -> dict:
    """Async version of get_example_catalog_blog()"""
    return get_example_catalog_blog()


async def async_get_example_blog_by_id(example_id: str, subfolder: str = 'main') -> dict:
    """Async version of get_example_blog_by_id()"""
    return get_example_blog_by_id(example_id, subfolder)


async def async_get_example_catalog_components() -> dict:
    """Async version of get_example_catalog_components()"""
    return get_example_catalog_components()


async def async_get_example_components_by_id(example_id: str) -> dict:
    """Async version of get_example_components_by_id()"""
    return get_example_components_by_id(example_id)


async def async_get_example_catalog_forms() -> dict:
    """Async version of get_example_catalog_forms()"""
    return get_example_catalog_forms()


async def async_get_example_forms_by_id(example_id: str) -> dict:
    """Async version of get_example_forms_by_id()"""
    return get_example_forms_by_id(example_id)


async def async_get_example_catalog_full() -> dict:
    """Async version of get_example_catalog_full()"""
    return get_example_catalog_full()


async def async_get_example_full_by_id(example_id: str, subfolder: str = 'websites') -> dict:
    """Async version of get_example_full_by_id()"""
    return get_example_full_by_id(example_id, subfolder)


async def async_get_example_catalog_skeleton() -> dict:
    """Async version of get_example_catalog_skeleton()"""
    return get_example_catalog_skeleton()


async def async_get_example_skeleton_by_id(example_id: str) -> dict:
    """Async version of get_example_skeleton_by_id()"""
    return get_example_skeleton_by_id(example_id)
