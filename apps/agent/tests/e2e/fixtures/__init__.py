"""Test fixtures for E2E tests.

Contains:
- app_configs/: Sample app configurations for testing
- payloads/: Documentation for payload structure
"""

import json
from pathlib import Path

FIXTURES_DIR = Path(__file__).parent


def load_app_config(name: str) -> dict:
    """Load an app config fixture by name.

    Args:
        name: The config name (without .json extension)

    Returns:
        The loaded JSON config as a dict
    """
    config_path = FIXTURES_DIR / "app_configs" / f"{name}.json"
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


__all__ = ["load_app_config", "FIXTURES_DIR"]
