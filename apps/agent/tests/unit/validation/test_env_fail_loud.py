"""Tests for the production-fail-loud guards in the validation pipeline.

Default behavior (dev): validators fail open when their dependencies are
missing — esbuild not on PATH returns ``(True, [])``; sdk-exports.json
missing returns an empty frozenset.

Production behavior (``ENVIRONMENT=production``): the same paths raise
:class:`ProductionDependencyMissing` so the agent fails its health check
at startup rather than serving for hours with disabled validation. This
closes the silent-deploy failure mode that shipped React-#130 crashes in
``ze1ltmf9``.
"""

from __future__ import annotations

from pathlib import Path
from unittest import mock

import pytest

from main_agent.services.validation._env import (
    ProductionDependencyMissing,
    is_production,
    require_in_production,
)
from main_agent.services.validation.syntax_validator import validate_tsx_syntax
from main_agent.services.validation.tsx_ast.catalog import (
    load_lucide_icons,
    load_sdk_exports,
)


pytestmark = [pytest.mark.unit]


# --------------------------------------------------------------------------- #
# is_production / require_in_production
# --------------------------------------------------------------------------- #


def test_is_production_default_is_false(monkeypatch):
    """No env override → development."""
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    assert is_production() is False


def test_is_production_true_when_env_set_to_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert is_production() is True


def test_is_production_false_for_other_env_values(monkeypatch):
    """Only the literal string "production" qualifies — no fuzzy matching."""
    monkeypatch.setenv("ENVIRONMENT", "staging")
    assert is_production() is False


def test_require_in_production_no_op_in_dev(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    require_in_production("xyz", "should not raise")  # no exception


def test_require_in_production_raises_in_prod(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    with pytest.raises(ProductionDependencyMissing) as exc:
        require_in_production("missing-dep", "install it")
    assert "missing-dep" in str(exc.value)
    assert "install it" in str(exc.value)


# --------------------------------------------------------------------------- #
# validate_tsx_syntax — esbuild missing
# --------------------------------------------------------------------------- #


def test_validate_tsx_syntax_dev_fails_open_without_esbuild(monkeypatch):
    """Dev: missing esbuild → return (True, []) so the rest of the pipeline runs."""
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    with mock.patch(
        "main_agent.services.validation.syntax_validator.subprocess.run",
        side_effect=FileNotFoundError("esbuild"),
    ):
        valid, errors = validate_tsx_syntax("const x = 1;")
    assert valid is True
    assert errors == []


def test_validate_tsx_syntax_production_raises_without_esbuild(monkeypatch):
    """Prod: missing esbuild → raise so the container fails health check."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    with mock.patch(
        "main_agent.services.validation.syntax_validator.subprocess.run",
        side_effect=FileNotFoundError("esbuild"),
    ):
        with pytest.raises(ProductionDependencyMissing) as exc:
            validate_tsx_syntax("const x = 1;")
    assert "esbuild" in str(exc.value)


# --------------------------------------------------------------------------- #
# load_sdk_exports — catalog missing
# --------------------------------------------------------------------------- #


@pytest.fixture(autouse=True)
def _clear_catalog_caches():
    """``load_sdk_exports`` and ``load_lucide_icons`` are ``lru_cache``-wrapped.

    Cached results survive across tests, hiding env-dependent behavior.
    Clear before every test in this module so each scenario starts clean.
    """
    load_sdk_exports.cache_clear()
    load_lucide_icons.cache_clear()
    yield
    load_sdk_exports.cache_clear()
    load_lucide_icons.cache_clear()


def test_load_sdk_exports_dev_returns_empty_when_file_missing(monkeypatch):
    """Dev: catalog missing → empty frozenset, agent still boots."""
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    # Point both candidate paths at non-existent files via a stub Path.
    with mock.patch.object(Path, "is_file", return_value=False):
        result = load_sdk_exports()
    assert result == frozenset()


def test_load_sdk_exports_production_raises_when_file_missing(monkeypatch):
    """Prod: catalog missing → raise so the agent refuses to start."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    with mock.patch.object(Path, "is_file", return_value=False):
        with pytest.raises(ProductionDependencyMissing) as exc:
            load_sdk_exports()
    assert "sdk-exports.json" in str(exc.value)


# --------------------------------------------------------------------------- #
# load_lucide_icons — catalog missing
# --------------------------------------------------------------------------- #


def test_load_lucide_icons_production_raises_when_file_missing(monkeypatch):
    """Prod: lucide catalog missing → raise so icon-rescue can't silently no-op."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    # Force the open() to raise FileNotFoundError so the except path runs.
    with mock.patch(
        "main_agent.services.validation.tsx_ast.catalog.open",
        side_effect=FileNotFoundError("valid_lucide_icons.json"),
    ):
        with pytest.raises(ProductionDependencyMissing) as exc:
            load_lucide_icons()
    assert "valid_lucide_icons.json" in str(exc.value)


def test_load_lucide_icons_dev_returns_empty_when_file_missing(monkeypatch):
    """Dev: lucide catalog missing → empty frozenset (icon-rescue is a no-op)."""
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    with mock.patch(
        "main_agent.services.validation.tsx_ast.catalog.open",
        side_effect=FileNotFoundError("valid_lucide_icons.json"),
    ):
        result = load_lucide_icons()
    assert result == frozenset()


# --------------------------------------------------------------------------- #
# Sanity: real catalog load works in this dev tree (regression guard for
# accidental file-tree changes that would break the prod-startup path).
# --------------------------------------------------------------------------- #


def test_real_lucide_catalog_loads_with_thousands_of_icons():
    icons = load_lucide_icons()
    assert len(icons) > 500, "Lucide catalog should contain hundreds of icons"
    # Spot-check a few well-known names.
    assert "Circle" in icons
    assert "Menu" in icons
