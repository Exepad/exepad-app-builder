"""Snapshot-based regression corpus for ``apply_auto_fixes`` (Change G).

Each fixture under ``fixtures/regression_corpus/inputs/`` represents a
real LLM-emitted pattern we've watched corrupt or be silently mangled by
the auto-fix pipeline. The runner pipes every input through
``apply_auto_fixes`` and asserts the output equals the snapshot in
``fixtures/regression_corpus/expected/<same name>.tsx``.

CI fails on any diff. To regenerate snapshots after an intentional
fixer change::

    REWRITE_REGRESSION_CORPUS=1 pytest tests/unit/validation/test_regression_corpus.py

Snapshots are checked-in artifacts. Reviewers should diff
``expected/*.tsx`` in PRs that touch fixers — the diff is the change
manifest.

**What the snapshots actually capture.** The corpus runs the dispatcher
the way dev sees it: with whatever binaries are (or aren't) on
``$PATH``. When ``esbuild`` is missing — typical local dev — Change A's
per-fixer rollback wrapper fails open, so a fixer that produces
malformed JSX has its mutations *kept* in the snapshot rather than
rolled back. That means some snapshots intentionally pin
**known-broken** or **suboptimal** fixer output (see fixture
``22_dialog_content_with_jsdoc_mention`` — the JSDoc mention of
``<DialogDescription>`` makes the fixer's substring check believe a
real DialogDescription element is already present, so the import is
added but the actual JSX never gets the screen-reader description
child). Those snapshots are still valuable as regression tripwires:
any future fixer change that affects them produces a clean diff, and
the reviewer regenerates with ``REWRITE_REGRESSION_CORPUS=1``. The
fixture's provenance comment flags when the snapshot pins
known-broken behaviour.

**Adding a new fixture:**

1. Drop ``inputs/<NN>_<short_slug>.tsx`` with a provenance comment
   header explaining the LLM pattern + which fixer should react.
   If the resulting snapshot pins known-broken behaviour, say so
   explicitly in the header — future readers should not mistake the
   snapshot for "the right answer".
2. Run with ``REWRITE_REGRESSION_CORPUS=1`` to generate the expected
   snapshot.
3. Inspect the snapshot — does it look right? If yes, commit both files.
   If not, the fixer is broken; fix the fixer first.

**When a snapshot diff fires in CI:**

* Intentional behavior change → regenerate snapshots, review the diff,
  commit.
* Unintentional → revert your fixer change; the corpus caught a
  regression.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from main_agent.services.validation.fixers import apply_auto_fixes

pytestmark = [pytest.mark.unit]


CORPUS_ROOT = Path(__file__).resolve().parent / "fixtures" / "regression_corpus"
INPUTS_DIR = CORPUS_ROOT / "inputs"
EXPECTED_DIR = CORPUS_ROOT / "expected"

REWRITE_ENV = "REWRITE_REGRESSION_CORPUS"


def _input_files() -> list[Path]:
    if not INPUTS_DIR.is_dir():
        return []
    return sorted(p for p in INPUTS_DIR.iterdir() if p.suffix == ".tsx")


def _expected_path(input_path: Path) -> Path:
    return EXPECTED_DIR / input_path.name


def _run_pipeline(tsx: str) -> str:
    """Run the production fixer pipeline with neutral context.

    The corpus exercises behaviour observable WITHOUT model/handler
    context wiring. Fixers that read ``ctx.models`` / ``ctx.handlers``
    will simply no-op on names they can't resolve — which is its own
    valid baseline to snapshot.
    """
    fixed, _fixes = apply_auto_fixes(
        tsx=tsx,
        models=[],
        actions={},
        state_keys={},
    )
    return fixed


@pytest.mark.parametrize(
    "input_path",
    _input_files(),
    ids=lambda p: p.stem,
)
def test_regression_corpus_snapshot(input_path: Path) -> None:
    """Each input under inputs/ must produce its checked-in expected output.

    Regenerate via ``REWRITE_REGRESSION_CORPUS=1 pytest <this file>``.
    """
    tsx = input_path.read_text(encoding="utf-8")
    actual = _run_pipeline(tsx)

    expected_path = _expected_path(input_path)
    rewrite = os.environ.get(REWRITE_ENV) == "1"

    if rewrite:
        EXPECTED_DIR.mkdir(parents=True, exist_ok=True)
        expected_path.write_text(actual, encoding="utf-8")
        return

    if not expected_path.exists():
        raise AssertionError(
            f"Missing snapshot for {input_path.name}.\n"
            f"Run with {REWRITE_ENV}=1 to generate it, then inspect the\n"
            f"output before committing."
        )

    expected = expected_path.read_text(encoding="utf-8")
    if actual != expected:
        # Show a compact diff in the error so CI failures are bisectable.
        import difflib

        diff = "\n".join(
            difflib.unified_diff(
                expected.splitlines(),
                actual.splitlines(),
                fromfile=f"expected/{input_path.name}",
                tofile=f"actual/{input_path.name}",
                lineterm="",
            )
        )
        raise AssertionError(
            f"Regression corpus snapshot mismatch for {input_path.name}.\n"
            f"If this change is intentional, regenerate with:\n"
            f"  {REWRITE_ENV}=1 pytest tests/unit/validation/test_regression_corpus.py\n"
            f"and commit the updated expected/. Diff:\n{diff}"
        )


def test_corpus_directory_is_populated() -> None:
    """Sanity guard: corpus shouldn't silently shrink to zero fixtures.

    Catches the foot-gun where a refactor accidentally deletes
    ``inputs/`` and the parametrized test above degenerates to zero
    parametrizations (which pytest treats as no failures).
    """
    files = _input_files()
    assert len(files) >= 10, (
        f"Regression corpus has shrunk to {len(files)} fixtures — "
        "expected at least 10. Did the inputs/ directory get cleared?"
    )


def test_every_input_has_an_expected_snapshot() -> None:
    """Each ``inputs/<name>.tsx`` must have a sibling ``expected/<name>.tsx``.

    Catches stragglers when someone adds a fixture but forgets the
    snapshot regeneration step. CI surface: the parametrized test would
    raise on the missing one anyway; this gives a single readable summary.
    """
    missing: list[str] = []
    for input_path in _input_files():
        if not _expected_path(input_path).is_file():
            missing.append(input_path.name)
    assert not missing, (
        f"Regression corpus inputs without snapshots: {missing}.\n"
        f"Run with {REWRITE_ENV}=1 to generate them, then inspect each "
        f"snapshot before committing."
    )
