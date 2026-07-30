"""Test helpers for locating the Tailwind v4 CLI binary and node_modules.

Shared between ``test_nested_bootstrap_lifter`` (validates the bootstrap
lifter compiles real CSS) and ``test_design_import_paste_verbatim_compile``
(validates the multi-page Claude Design paste-verbatim approach produces
compilable theme.css).

These are NOT pytest fixtures — they're plain functions returning paths
so individual tests can ``pytest.skip(...)`` with their own message when a
required binary or package is missing.
"""

from __future__ import annotations

import shutil
from pathlib import Path


def repo_root() -> Path:
    """Return the workspace root.

    ``__file__`` is ``apps/agent/tests/_tailwind.py`` so the repo root is
    4 levels up — ``parents[3]``.
    """
    return Path(__file__).resolve().parents[3]


def find_tailwindcss_binary() -> str | None:
    """Locate a Tailwind v4 CLI binary on the host (None if absent)."""
    cand = shutil.which("tailwindcss")
    if cand:
        return cand
    pnpm_bin = repo_root() / "node_modules" / ".pnpm" / "node_modules" / ".bin" / "tailwindcss"
    if pnpm_bin.exists():
        return str(pnpm_bin)
    return None


def find_tailwind_node_modules() -> Path | None:
    """Locate a node_modules dir with both ``tailwindcss`` and ``tw-animate-css``.

    The compile step symlinks this dir into a tmpdir so the Tailwind CLI
    can resolve both packages. Workspace installs (pnpm strict mode) keep
    direct deps under each package's ``node_modules/`` rather than at the
    workspace root, so we check several candidate locations.
    """
    repo = repo_root()
    for candidate in (
        Path("/app/node_modules"),
        repo / "node_modules",
        repo / "apps" / "runtime" / "client" / "node_modules",
    ):
        if (candidate / "tailwindcss").exists() and (candidate / "tw-animate-css").exists():
            return candidate
    return None
