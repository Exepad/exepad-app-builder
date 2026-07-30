"""Shared harness for fixture-driven HTML→TSX transformer tests.

Mirrors the structure of ``tests/unit/validation/_fixer_harness.py``,
adapted for the transformer's input/output shape (HTML in, TSX +
sidecars out).

Each suite under ``fixtures/<name>/`` follows this layout::

    fixtures/<name>/
      cases.json       # manifest, schema below
      examples/
        <id>.html      # input HTML
        <id>.expected.tsx   # optional golden full TSX (only for full
                            # transformer cases — sub-module unit
                            # tests usually use substring assertions)
      README.md        # optional scenario doc

Manifest schema::

    {
      "cases": [
        {
          "id": "<unique slug>",                 # required
          "input_path": "examples/<id>.html",    # required
          "context": {                            # optional
            "component_name": "TestComponent"
          },
          "expected_output_path": "...",          # optional: byte-stable
                                                  # match against full
                                                  # transformer output
          "expected_tsx_contains": [...],         # substrings in r.tsx
          "expected_tsx_absent": [...],
          "expected_scripts_contains": [...],
          "expected_scripts_absent": [...],
          "expected_styles_contains": [...],
          "expected_warnings_contains": [...],
          "expected_confidence": "high" | "low",
          "expect_idempotent": true              # default true
        },
        ...
      ]
    }

The harness runs the transformer once and (when ``expect_idempotent``)
re-runs on the emitted output's own HTML representation to detect
non-determinism. Substring-based assertions stay readable; full-byte
matching is opt-in via ``expected_output_path``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from main_agent.agents.orchestrator.importers.tools.html_to_tsx import (
    TransformResult,
    transform_html_to_tsx,
)

FIXTURES_ROOT = Path(__file__).resolve().parent / "fixtures"

DEFAULT_COMPONENT_NAME = "TestComponent"


@dataclass
class TransformCase:
    """A loaded fixture case with file contents resolved."""

    id: str
    suite: str
    input_html: str
    expected_output_tsx: str | None
    raw: dict[str, Any]
    """The verbatim manifest entry — read by ``assert_case`` for the
    optional fields (``expected_tsx_contains`` etc.)."""


def load_cases(suite_name: str) -> list[TransformCase]:
    """Load every case in ``fixtures/<suite_name>/cases.json``."""
    suite_dir = FIXTURES_ROOT / suite_name
    manifest_path = suite_dir / "cases.json"
    if not manifest_path.exists():
        raise FileNotFoundError(
            f"No fixture manifest at {manifest_path}. "
            f"Create it before parametrizing tests for {suite_name}."
        )

    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    cases_raw = raw.get("cases", [])

    resolved: list[TransformCase] = []
    for entry in cases_raw:
        if "id" not in entry or "input_path" not in entry:
            raise ValueError(f"Malformed case in {manifest_path}: {entry!r}")
        input_path = suite_dir / entry["input_path"]
        if not input_path.exists():
            raise FileNotFoundError(f"Case {entry['id']}: input HTML not found at {input_path}")
        expected: str | None = None
        expected_rel = entry.get("expected_output_path")
        if expected_rel:
            expected_path = suite_dir / expected_rel
            if not expected_path.exists():
                raise FileNotFoundError(
                    f"Case {entry['id']}: expected output not found at {expected_path}"
                )
            expected = expected_path.read_text(encoding="utf-8")

        resolved.append(
            TransformCase(
                id=entry["id"],
                suite=suite_name,
                input_html=input_path.read_text(encoding="utf-8"),
                expected_output_tsx=expected,
                raw=entry,
            )
        )
    return resolved


def run_transformer(case: TransformCase) -> TransformResult:
    """Invoke the transformer on a case's input HTML."""
    ctx = case.raw.get("context", {}) or {}
    component_name = ctx.get("component_name", DEFAULT_COMPONENT_NAME)
    page_slugs = tuple(ctx.get("page_slugs", []))
    # page_routes is a list of [slug, title] pairs in the JSON manifest;
    # the transformer expects a tuple of tuples. Empty when chrome-nav
    # fuzzy matching isn't being exercised.
    page_routes = tuple(
        (pair[0], pair[1])
        for pair in (ctx.get("page_routes") or [])
        if isinstance(pair, (list, tuple)) and len(pair) == 2
    )
    form_ids = tuple(ctx.get("form_ids", []))
    component_role = ctx.get("component_role", "content")
    backend_surface = ctx.get("backend_surface")
    building_plan = ctx.get("building_plan")
    return transform_html_to_tsx(
        case.input_html,
        component_name=component_name,
        page_slugs=page_slugs,
        page_routes=page_routes,
        form_ids=form_ids,
        component_role=component_role,
        backend_surface=backend_surface,
        building_plan=building_plan,
    )


def assert_case(case: TransformCase, result: TransformResult) -> None:
    """Run every assertion declared in the case manifest."""
    _check_full_match(case, result)
    _check_substring_assertions(case, result)
    _check_confidence(case, result)
    _check_plan_assertions(case, result)
    _check_idempotency(case, result)


def _check_full_match(case: TransformCase, result: TransformResult) -> None:
    if case.expected_output_tsx is None:
        return
    assert result.tsx == case.expected_output_tsx, (
        f"[{case.id}] full TSX mismatch.\n"
        f"--- expected ---\n{case.expected_output_tsx}\n"
        f"--- actual ---\n{result.tsx}\n"
    )


def _check_substring_assertions(case: TransformCase, result: TransformResult) -> None:
    """Run every {expected,forbidden}_<haystack>_contains assertion pair."""
    pairs: list[tuple[str, str, str]] = [
        ("expected_tsx_contains", "expected_tsx_absent", result.tsx),
        ("expected_scripts_contains", "expected_scripts_absent", result.scripts_js),
        ("expected_styles_contains", "_unused_", result.styles_css),
        ("expected_warnings_contains", "_unused_", "\n".join(result.warnings)),
    ]
    for present_key, absent_key, haystack in pairs:
        _assert_substrings(case, present_key, absent_key, haystack)


def _assert_substrings(
    case: TransformCase,
    present_key: str,
    absent_key: str,
    haystack: str,
) -> None:
    for needle in case.raw.get(present_key, []) or []:
        assert needle in haystack, (
            f"[{case.id}] {present_key} substring missing.\n"
            f"  needle: {needle!r}\n  haystack:\n{haystack}"
        )
    for needle in case.raw.get(absent_key, []) or []:
        assert needle not in haystack, (
            f"[{case.id}] {absent_key} substring still present.\n"
            f"  needle: {needle!r}\n  haystack:\n{haystack}"
        )


def _check_confidence(case: TransformCase, result: TransformResult) -> None:
    expected = case.raw.get("expected_confidence")
    if expected is None:
        return
    assert result.confidence == expected, (
        f"[{case.id}] confidence mismatch: expected {expected!r}, " f"got {result.confidence!r}"
    )


def _check_plan_assertions(case: TransformCase, result: TransformResult) -> None:
    plan_text = "\n".join(result.plan_items)
    _assert_substrings(case, "expected_plan_contains", "expected_plan_absent", plan_text)

    expected_count = case.raw.get("expected_plan_count")
    if expected_count is not None:
        assert len(result.plan_items) == expected_count, (
            f"[{case.id}] plan_items count mismatch: expected "
            f"{expected_count}, got {len(result.plan_items)}.\n"
            f"  plan_items: {result.plan_items}"
        )


def _check_idempotency(case: TransformCase, result: TransformResult) -> None:
    """Re-run the transformer on the same HTML and verify byte-identical output.

    Idempotence here means *deterministic*, not *fixed-point under itself*.
    We don't re-run on emitted TSX (different language); we re-run on the
    same input HTML to catch non-deterministic dict ordering.
    """
    if not case.raw.get("expect_idempotent", True):
        return
    second = run_transformer(case)
    assert second.tsx == result.tsx, (
        f"[{case.id}] transformer is not deterministic. "
        f"Second pass on the same HTML produced different TSX."
    )
    assert (
        second.scripts_js == result.scripts_js
    ), f"[{case.id}] transformer scripts_js is not deterministic."
    assert (
        second.styles_css == result.styles_css
    ), f"[{case.id}] transformer styles_css is not deterministic."
