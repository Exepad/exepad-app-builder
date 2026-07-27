import json
import uuid
import os
import re

current_dir             = os.path.dirname(os.path.abspath(__file__))
DATA_DIR                = os.path.normpath(os.path.join(current_dir, '..', '..', 'data'))
CATALOG_PATH_ABS        = os.path.join(DATA_DIR, 'components', 'catalog.json')
LEAPDO_SCHEMA_PATH_ABS  = os.path.join(DATA_DIR, 'components', 'components.json')
APP_SCHEMA_PATH_ABS     = os.path.join(DATA_DIR, 'apps', 'apps.json')
LEAPDO_EXAMPLES_PATH_ABS = os.path.join(DATA_DIR, 'examples', 'examples')
LEAPDO_EXAMPLES_CATALOG_PATH_ABS = os.path.join(DATA_DIR, 'examples', 'examples-catalog.json')
LUCIDE_ICONS_CATALOG_PATH_ABS = os.path.join(DATA_DIR, 'icons', 'lucide_icons.txt')
FONT_CATALOG_PATH_ABS   = os.path.join(DATA_DIR, 'fonts', 'font_catalog.json')
EXAMPLE_THEME_PATH_ABS  = os.path.join(DATA_DIR, 'themes', 'theme-1.json')

def get_config_examples(example_id: str) -> dict:
    """
    Reads the config example from the file and returns it as a dictionary.
    
    Args:
        example_id: str
            The id of the config example to get (e.g. "block-hero-1").
    
    Returns:
        dict: Dictionary with 'status' ('success' or 'error') and 'example' (the example data)
    """
    examples_dir = LEAPDO_EXAMPLES_PATH_ABS
    example_file_path = os.path.join(examples_dir, f"{example_id}.json")
    
    try:
        if not os.path.exists(example_file_path):
            return {
                "status": "error",
                "error_message": f"{example_id} not found. Try another EXAMPLE_ID"
            }
            
        with open(example_file_path, 'r', encoding='utf-8') as file:
            example_data = json.load(file)
        
        return {
            "status": "success",
            "example": example_data
        }
    except Exception as e:
        return {
            "status": "error",
            "error_message": f"{example_id} not found. Try another EXAMPLE_ID"
        }
    
def get_config_examples_catalog() -> dict:
    """
    Reads the config examples catalog from the file and returns it as a dictionary.
    
    Returns:
        dict: Dictionary with 'status' ('success' or 'error') and 'catalog' (the examples catalog data)
    """
    try:
        with open(LEAPDO_EXAMPLES_CATALOG_PATH_ABS, 'r') as file:
            examples_catalog = json.load(file)
        return {
            "status": "success",
            "catalog": examples_catalog
        }
    except FileNotFoundError:
        return {
            "status": "error",
            "error_message": f"Examples catalog file not found at {LEAPDO_EXAMPLES_CATALOG_PATH_ABS}"
        }
    except Exception as e:
        return {
            "status": "error",
            "error_message": f"Error reading examples catalog: {e}"
        }

def get_icons_catalog() -> dict:
    """
    Reads the lucide icons catalog from the file and returns it as a dictionary.
    
    Returns:
        dict: Dictionary with 'status' ('success' or 'error') and 'icons' (list of icon names)
    """
    try:
        with open(LUCIDE_ICONS_CATALOG_PATH_ABS, 'r') as file:
            lucide_icons_catalog = file.read().splitlines()
        
        print("Providing Lucide Icons Catalog")
        
        return {
            "status": "success",
            "icons": lucide_icons_catalog
        }
    except FileNotFoundError:
        return {
            "status": "error",
            "error_message": f"Icons catalog file not found at {LUCIDE_ICONS_CATALOG_PATH_ABS}"
        }
    except Exception as e:
        return {
            "status": "error",
            "error_message": f"Error reading icons catalog: {e}"
        }

def get_font_catalog() -> dict:
    """
    Reads the font catalog from the file and returns it as a dictionary.
    
    Returns:
        dict: Dictionary with 'status' ('success' or 'error') and 'fonts' (the font catalog data)
    """
    try:
        with open(FONT_CATALOG_PATH_ABS, 'r') as file:
            font_catalog = json.load(file)
        return {
            "status": "success",
            "fonts": font_catalog
        }
    except FileNotFoundError:
        return {
            "status": "error",
            "error_message": f"Font catalog file not found at {FONT_CATALOG_PATH_ABS}"
        }
    except Exception as e:
        return {
            "status": "error",
            "error_message": f"Error reading font catalog: {e}"
        }
