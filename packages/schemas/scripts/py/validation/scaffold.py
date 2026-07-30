"""
Scaffold config validation — DEPRECATED.

Scaffolds have been removed from the platform.
This module is kept as a stub for backward compatibility.
"""

SCAFFOLD_TYPES = set()


def validate_scaffold_config(config, models=None, security=None, agents=None):
    """No-op: scaffolds removed."""
    return {"errors": [], "warnings": []}


def auto_fix_scaffold_config(config, models=None):
    """No-op: scaffolds removed."""
    return config, []
