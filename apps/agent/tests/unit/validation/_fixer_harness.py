"""Shared harness for fixture-driven auto-fixer tests.

Each fixer module under ``main_agent.services.validation.fixers`` is
exercised by a fixture directory at ``fixtures/<module_name>/``:

    fixtures/<module>/
      cases.json        # manifest (see schema below)
      examples/
        broken_<scenario>.tsx
        correct_<scenario>.tsx
        ...
      README.md         # scenario grid

The manifest schema is a superset of ``tests/fixtures/contrast_cases``:

    {
      "cases": [
        {
          "id": "<unique slug>",                  # required, used as pytest id
          "kind": "broken" | "correct",          # required
          "tsx_path": "examples/...tsx",         # required
          "context": {                            # optional FixContext kwargs
            "state_keys": {...},
            "source_html": "...",
            "models": [...],
            "handlers": [...],
            "page_slugs": ["/", "/products"],
            "expected_component_name": "Hero",
            "theme_palette": {...}
          },
          "expected_fix_substrings": [...],       # broken: substrings that must
                                                  # appear in fixes_applied
          "forbidden_fix_substrings": [...],      # must NOT appear in fixes
          "expected_output_contains": [...],      # substrings in output TSX
          "expected_output_absent": [...],        # substrings that must be gone
          "expect_no_fixes": false,               # correct: no fixes appended
          "expect_idempotent": true,              # default true: 2nd pass output matches
          "expect_idempotent_fixes": true         # default true; set false for
                                                  # warn-only rules that re-emit
                                                  # the same diagnostic each pass
        },
        ...
      ]
    }

The harness intentionally does NOT compare full output strings — substring
assertions stay readable and resilient to incidental whitespace drift.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from main_agent.services.validation.fixers._context import FixContext

FIXTURES_ROOT = Path(__file__).resolve().parent / "fixtures"


# Fields FixContext actually accepts. Keep in sync with FixContext dataclass.
# `actions` is intentionally absent — the dispatcher accepts it for signature
# stability but no fixer reads it.
_FIX_CONTEXT_FIELDS = {
    "expected_component_name",
    "models",
    "handlers",
    "state_keys",
    "page_slugs",
    "theme_palette",
    "source_html",
    "stock_provider_configured",
}


def make_fix_context(**kwargs: Any) -> FixContext:
    """Build a FixContext, ignoring keys the dataclass does not accept.

    Manifest authors can include extra keys for documentation; only the
    real FixContext fields are forwarded to the dataclass.
    """
    forwarded = {k: v for k, v in kwargs.items() if k in _FIX_CONTEXT_FIELDS}
    return FixContext(**forwarded)


def load_cases(module_name: str) -> list[dict]:
    """Load and resolve cases for ``fixtures/<module_name>/cases.json``.

    Resolves ``tsx_path`` to absolute paths and reads each TSX into a new
    ``tsx`` field so test bodies can stay parameter-driven.

    Optional manifest fields supported here:
      - ``source_html_path``: path to a sidecar HTML file (used by
        translation-parity fixtures). Read into
        ``case["context"]["source_html"]`` so the fixer dispatcher
        receives it via ``FixContext.source_html``. Inline
        ``context.source_html`` overrides the file if both are present.
    """
    module_dir = FIXTURES_ROOT / module_name
    manifest_path = module_dir / "cases.json"
    if not manifest_path.exists():
        raise FileNotFoundError(
            f"No fixture manifest at {manifest_path}. "
            f"Create it before parametrizing tests for {module_name}."
        )
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    cases = raw.get("cases", [])

    resolved: list[dict] = []
    for case in cases:
        if "id" not in case or "kind" not in case or "tsx_path" not in case:
            raise ValueError(f"Malformed case in {manifest_path}: {case!r}")
        if case["kind"] not in ("broken", "correct"):
            raise ValueError(
                f"Case {case['id']} in {manifest_path}: "
                f"kind must be 'broken' or 'correct', got {case['kind']!r}"
            )
        tsx_path = module_dir / case["tsx_path"]
        if not tsx_path.exists():
            raise FileNotFoundError(f"Case {case['id']}: TSX fixture not found at {tsx_path}")

        context = dict(case.get("context", {}))
        source_rel = case.get("source_html_path")
        if source_rel and "source_html" not in context:
            source_path = module_dir / source_rel
            if not source_path.exists():
                raise FileNotFoundError(
                    f"Case {case['id']}: source HTML sidecar not found at {source_path}"
                )
            context["source_html"] = source_path.read_text(encoding="utf-8")

        resolved.append(
            {
                **case,
                "_module_dir": module_dir,
                "context": context,
                "tsx": tsx_path.read_text(encoding="utf-8"),
            }
        )
    return resolved


@dataclass
class FixerResult:
    """Output of running a fixer once (and again for idempotence)."""

    output: str
    fixes: list[str]
    idempotent_output: str
    idempotent_fixes: list[str] = field(default_factory=list)

    @property
    def fixes_joined(self) -> str:
        return "\n".join(self.fixes)


FixerFn = Callable[[str, FixContext, list[str]], str]


def run_fixer(fixer_fn: FixerFn, tsx: str, ctx: FixContext) -> FixerResult:
    """Invoke ``fixer_fn(tsx, ctx, fixes)`` once, then re-run on its own
    output to check idempotence.

    Each fixer in ``main_agent.services.validation.fixers`` follows the
    same signature: ``(tsx, FixContext, fixes_applied) -> str`` with
    ``fixes_applied`` mutated in-place.
    """
    fixes: list[str] = []
    output = fixer_fn(tsx, ctx, fixes)

    second_fixes: list[str] = []
    second_output = fixer_fn(output, ctx, second_fixes)

    return FixerResult(
        output=output,
        fixes=fixes,
        idempotent_output=second_output,
        idempotent_fixes=second_fixes,
    )


def assert_case(result: FixerResult, case: dict) -> None:
    """Run all manifest assertions for a single case.

    Raises AssertionError with a context-rich message on the first failed
    expectation so test output points directly at the offending case.
    """
    case_id = case["id"]
    kind = case["kind"]

    fixes_str = result.fixes_joined

    if kind == "correct":
        if case.get("expect_no_fixes", True):
            assert not result.fixes, f"[{case_id}] expected no fixes but got: {result.fixes}"
        # A correct fixture's output should never differ from input by
        # default (idempotence baseline). Manifest can opt out via
        # expected_output_contains/absent if some normalization is allowed.
        if not case.get("expected_output_contains") and not case.get("expected_output_absent"):
            assert result.output == case["tsx"], (
                f"[{case_id}] correct fixture was rewritten unexpectedly. "
                f"Diff first 200 chars:\n  in:  {case['tsx'][:200]!r}\n  "
                f"out: {result.output[:200]!r}"
            )

    if kind == "broken":
        for sub in case.get("expected_fix_substrings", []):
            assert sub in fixes_str, (
                f"[{case_id}] expected fix substring not found.\n"
                f"  needle: {sub!r}\n  fixes: {result.fixes}"
            )

    for sub in case.get("forbidden_fix_substrings", []):
        assert sub not in fixes_str, (
            f"[{case_id}] forbidden fix substring appeared.\n"
            f"  needle: {sub!r}\n  fixes: {result.fixes}"
        )

    for sub in case.get("expected_output_contains", []):
        assert sub in result.output, (
            f"[{case_id}] expected output substring missing.\n"
            f"  needle: {sub!r}\n  output (first 400):\n{result.output[:400]}"
        )

    for sub in case.get("expected_output_absent", []):
        assert sub not in result.output, (
            f"[{case_id}] forbidden output substring still present.\n"
            f"  needle: {sub!r}\n  output (first 400):\n{result.output[:400]}"
        )

    if case.get("expect_idempotent", True):
        assert result.idempotent_output == result.output, (
            f"[{case_id}] fixer is not idempotent. Second pass changed output.\n"
            f"  diff: {result.output!r} -> {result.idempotent_output!r}"
        )
        # Warn-only rules (e.g., translation-parity PARITY VIOLATION) describe
        # an unfixable state and re-emit on every pass. Such cases opt out of
        # fix-message idempotence via expect_idempotent_fixes: false; output
        # idempotence is still asserted above.
        if case.get("expect_idempotent_fixes", True):
            assert not result.idempotent_fixes, (
                f"[{case_id}] fixer reported new fixes on second pass: "
                f"{result.idempotent_fixes}"
            )
