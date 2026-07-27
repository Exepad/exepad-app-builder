"""Regression: the per-component esbuild/tsc subprocesses must run OFF the
asyncio event loop.

The validators (``validate_tsx_syntax`` → esbuild, ``run_tsc_check`` → tsc)
are blocking ``subprocess.run`` calls. Their async callers must invoke them
through ``asyncio.to_thread`` so a validation pass can't freeze concurrent
builds, the ``/cancel`` watchdog, or ``/health``. These tests assert the
work lands on a worker thread, not the loop thread.
"""

import threading

from main_agent.services.validation import dirty_file_sweeper
from main_agent.services.validation import syntax_validator


async def test_sweep_dirty_files_offloads_esbuild_off_the_loop(monkeypatch):
    """``sweep_dirty_files`` (async) must run esbuild in a worker thread."""
    loop_thread_ident = threading.get_ident()
    seen: dict[str, int] = {}

    def fake_validate(src: str):
        seen["ident"] = threading.get_ident()
        # Return invalid so the sweep short-circuits after the syntax stage
        # (keeps the test independent of the heavier downstream pipeline).
        return False, ["boom"]

    # The sweeper imports the symbol from this module at call time, so
    # patching the module attribute is picked up.
    monkeypatch.setattr(syntax_validator, "validate_tsx_syntax", fake_validate)

    fname = "codefocus_component:Hero.tsx"
    out = await dirty_file_sweeper.sweep_dirty_files(
        [fname],
        {fname: "export default function Hero() { return null; }"},
        expand_to_importers=False,
    )

    assert fname in out
    assert "ident" in seen, "validate_tsx_syntax was never called"
    assert seen["ident"] != loop_thread_ident, (
        "esbuild ran on the event-loop thread — validation would block "
        "concurrent builds / the /cancel watchdog / /health"
    )


async def test_sweep_dirty_files_offloads_auto_fixes_off_the_loop(monkeypatch):
    """The fixer pipeline (esbuild per-fixer rollback) must also be offloaded."""
    loop_thread_ident = threading.get_ident()
    seen: dict[str, int] = {}

    monkeypatch.setattr(
        syntax_validator, "validate_tsx_syntax", lambda src: (True, [])
    )

    from main_agent.services.validation import fixers

    def fake_apply_auto_fixes(*args, **kwargs):
        seen["ident"] = threading.get_ident()
        return args[0], []

    monkeypatch.setattr(fixers, "apply_auto_fixes", fake_apply_auto_fixes)

    # Neutralize the remaining downstream stages so the test stays focused.
    from main_agent.services.validation import semantic_validator

    class _Result:
        errors: list[str] = []
        warnings: list[str] = []

    monkeypatch.setattr(
        semantic_validator, "run_semantic_checks", lambda *a, **k: _Result()
    )

    fname = "codefocus_component:Hero.tsx"
    await dirty_file_sweeper.sweep_dirty_files(
        [fname],
        {fname: "export default function Hero() { return null; }"},
        expand_to_importers=False,
    )

    assert "ident" in seen, "apply_auto_fixes was never called"
    assert seen["ident"] != loop_thread_ident, (
        "the fixer pipeline ran on the event-loop thread"
    )
