"""File storage must survive a `backend_type: "none"` app (4wsdbbsz, 2026-05-23).

A `form`/`none` app with document uploads (rental application, job application)
has `app_backend_plan.storage.enabled = true` but `backend_type = "none"` (no
models/handlers). The build pipeline must still emit a backend config carrying
the storage block, otherwise the deploy never provisions R2 and every upload
fails at runtime with `STORAGE_DISABLED` ("File storage is not enabled for this
app").

Two layers are pinned here:

* ``_build_storage_config`` — maps StoragePlan (snake_case planning) → StorageProps
  (camelCase runtime), crucially emitting ``enabled: True`` (the exact flag the
  app-backend checks at ``src/index.ts`` before accepting ``/files/upload``).
* ``BackendBuilder.build_create`` non-dynamic branch — for ``backend_type != "dynamic"``
  with storage enabled, returns ``{"mode": "<type>", "storage": {...}}`` instead of
  ``None``. This is the branch ``creation_workflow.py`` now reaches because the
  backend-build gate widened from ``backend_type == "dynamic"`` to also fire when
  ``storage.enabled`` is true.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.backend_builder import (  # noqa: E501
    BackendBuilder,
    _build_storage_config,
)

pytestmark = [pytest.mark.unit]


# ── _build_storage_config (pure) ─────────────────────────────────────


def test_build_storage_config_maps_enabled_plan():
    cfg = _build_storage_config(
        {
            "enabled": True,
            "max_file_size_mb": 10,
            "allowed_mime_types": ["image/*", "application/pdf"],
            "public_access": False,
        }
    )
    assert cfg == {
        "enabled": True,
        "maxFileSize": 10 * 1024 * 1024,
        "allowedMimeTypes": ["image/*", "application/pdf"],
        "publicAccess": False,
    }


def test_build_storage_config_sets_enabled_flag():
    """The app-backend gates `/files/upload` on `config.storage.enabled`.
    The mapped config MUST carry `enabled: True` or uploads 405 with
    STORAGE_DISABLED even though R2 was provisioned."""
    cfg = _build_storage_config({"enabled": True})
    assert cfg is not None
    assert cfg["enabled"] is True


def test_build_storage_config_applies_defaults():
    cfg = _build_storage_config({"enabled": True})
    assert cfg["maxFileSize"] == 10 * 1024 * 1024  # default 10 MB
    assert cfg["allowedMimeTypes"] == ["image/*", "application/pdf"]
    assert cfg["publicAccess"] is False


def test_build_storage_config_disabled_returns_none():
    assert _build_storage_config({"enabled": False}) is None
    assert _build_storage_config({}) is None
    assert _build_storage_config(None) is None


# ── BackendBuilder.build_create — non-dynamic + storage branch ────────


def _drain(agen) -> None:
    """Run an async generator to exhaustion (it yields no events on the
    non-dynamic early-return path)."""
    async def run():
        async for _ in agen:
            pass

    asyncio.run(run())


def test_build_create_none_backend_carries_storage():
    """A `backend_type: "none"` plan with storage.enabled must still produce
    a backend_config containing the storage block (mode "none", no models).
    This is the config that lets the deploy provision R2 + the files table."""
    builder = BackendBuilder(None, None, None)
    plan = {
        "backend_type": "none",
        "storage": {
            "enabled": True,
            "max_file_size_mb": 5,
            "allowed_mime_types": ["image/*", "application/pdf"],
            "public_access": False,
        },
    }
    _drain(builder.build_create(ctx=SimpleNamespace(), backend_plan=plan))

    bc = builder.result.backend_config
    assert bc is not None
    assert bc["mode"] == "none"
    assert bc["storage"]["enabled"] is True
    assert bc["storage"]["maxFileSize"] == 5 * 1024 * 1024


def test_build_create_none_backend_without_storage_has_no_storage_key():
    """Regression guard: a plain `none` app (no storage) must NOT gain a
    storage key — only apps that planned storage get it."""
    builder = BackendBuilder(None, None, None)
    _drain(builder.build_create(ctx=SimpleNamespace(), backend_plan={"backend_type": "none"}))

    bc = builder.result.backend_config
    assert bc == {"mode": "none"}
    assert "storage" not in bc
