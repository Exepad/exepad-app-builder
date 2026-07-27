"""
Component validation — icon names, skip lists.

Validates Lucide icon names against the bundled icon catalog.
"""

import os

# Data paths (relative to this module's parent package)
_current_dir = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR = os.path.normpath(os.path.join(_current_dir, '..', '..', '..', 'data'))
LUCIDE_ICONS_PATH_ABS = os.path.join(_DATA_DIR, 'icons', 'lucide_icons.txt')

# Component types to skip during schema validation
SKIP_VALIDATION_COMPONENTS = [
    "IconProps",
]

# Aliases for component types that map to different schema definitions
COMPONENT_TYPE_ALIASES = {}

# Scaffold component types — scaffolds have been removed
SCAFFOLD_COMPONENT_TYPES = set()

# Component types that are actually registered in the runtime registry.
# Must stay in sync with apps/runtime/client/src/registry/index.ts
RUNTIME_REGISTERED_TYPES = {"BlogMainPage", "BlogPostPage", "CodeComponentProps"}

# Lazy-loaded icon set
_LUCIDE_ICONS_SET = None


def _get_lucide_icons_set():
    """Load Lucide icons into a set for fast lookup."""
    global _LUCIDE_ICONS_SET
    if _LUCIDE_ICONS_SET is None:
        try:
            with open(LUCIDE_ICONS_PATH_ABS, 'r') as f:
                _LUCIDE_ICONS_SET = set(f.read().splitlines())
        except FileNotFoundError:
            print(f"Warning: Lucide icons file not found at {LUCIDE_ICONS_PATH_ABS}")
            _LUCIDE_ICONS_SET = set()
    return _LUCIDE_ICONS_SET


def validate_icon_name(icon_name: str) -> bool:
    """Check if an icon name is valid in the Lucide icon set (case-insensitive)."""
    icons = _get_lucide_icons_set()
    return icon_name.lower() in icons


def validate_icon_list(icon_list: list[str]) -> list[str]:
    """Return a list of error messages for invalid icon names."""
    icons = _get_lucide_icons_set()
    return [f"Invalid icon name: {name}" for name in icon_list if name.lower() not in icons]


def validate_single_icon_name(icon_name: str) -> str | None:
    """Return an error message if the icon name is invalid, or None if valid."""
    if validate_icon_name(icon_name):
        return None
    return f"Invalid icon name: '{icon_name}' is not in the Lucide icon set"
