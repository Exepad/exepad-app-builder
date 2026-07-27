"""Real TSX contrast fixtures for semantic validation.

These cases complement the small unit checks with production-shaped TSX
components plus real `theme.css` palettes.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from main_agent.services.validation.fixers import apply_auto_fixes
from main_agent.services.validation.semantic_validator import run_semantic_checks
from main_agent.services.validation.style_coverage import extract_css_theme_color_values

pytestmark = [pytest.mark.unit]

CASE_ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "contrast_cases"
CASE_MANIFEST = json.loads((CASE_ROOT / "cases.json").read_text(encoding="utf-8"))["cases"]


def _join(items: list[str]) -> str:
    return "\n".join(items)


@pytest.mark.parametrize("case", CASE_MANIFEST, ids=lambda case: case["id"])
def test_real_tsx_contrast_examples(case):
    tsx = (CASE_ROOT / case["tsx_path"]).read_text(encoding="utf-8")
    theme_css = (CASE_ROOT / case["theme_path"]).read_text(encoding="utf-8")
    theme_palette = extract_css_theme_color_values(theme_css)

    result = run_semantic_checks(
        tsx,
        [],
        {},
        [],
        theme_palette=theme_palette,
    )

    # Track 2 policy: categorical contrast violations (text-on-X against a
    # mismatched ancestor bg) are ERRORS that block save and trigger a
    # fixer retry.  `measured_color_contrast` stays advisory as a warning
    # because it quantifies arbitrary hex colors that may be intentional
    # design accents.  The fixture suite exercises both tiers, so we
    # treat the combined diagnostic stream (errors + warnings) as the
    # "detector output" for assertion purposes — the old suite predates
    # the promotion and used to look at warnings only.
    #
    # The ``component.colors.arbitrary_hex`` rule (added 2026-05-14 for
    # the r3hfcgx5 status-badge regression) fires on every ``bg-[#hex]``
    # / ``text-[#hex]`` occurrence. Several of THIS suite's fixtures
    # legitimately use arbitrary hex to test the contrast walker against
    # specific RGB pairs — rewriting them to theme tokens would lose the
    # test's specificity. Filter those findings out of the contrast
    # assertion path; the rule has its own dedicated test
    # (``test_arbitrary_hex_color_rule.py``).
    def _drop_arbitrary_hex(msgs: list[str]) -> list[str]:
        return [m for m in msgs if "component.colors.arbitrary_hex" not in m]

    filtered_errors = _drop_arbitrary_hex(result.errors)
    filtered_warnings = _drop_arbitrary_hex(result.warnings)
    joined_errors = _join(filtered_errors)
    joined_warnings = _join(filtered_warnings)
    diagnostics = filtered_errors + filtered_warnings
    joined_diagnostics = _join(diagnostics)

    if case.get("expect_no_warnings"):
        # Correct fixtures: neither errors nor warnings.
        assert filtered_errors == [], joined_errors
        assert filtered_warnings == [], joined_warnings
    else:
        # Broken fixtures: at least one diagnostic (error or warning).
        assert diagnostics, "Expected at least one error or warning"

    for substring in case.get("required_warning_substrings", []):
        assert substring in joined_diagnostics
    for substring in case.get("forbidden_warning_substrings", []):
        assert substring not in joined_diagnostics

    if case.get("fixed_contains") or case.get("fixed_warning_substrings_absent"):
        fixed_tsx, fixes = apply_auto_fixes(
            tsx,
            [],
            {},
            {},
            theme_palette=theme_palette,
        )
        assert fixes, "Expected at least one deterministic fix"

        for substring in case.get("fixed_contains", []):
            assert substring in fixed_tsx

        fixed_result = run_semantic_checks(
            fixed_tsx,
            [],
            {},
            [],
            theme_palette=theme_palette,
        )
        fixed_diagnostics = _join(fixed_result.errors + fixed_result.warnings)
        for substring in case.get("fixed_warning_substrings_absent", []):
            assert substring not in fixed_diagnostics
