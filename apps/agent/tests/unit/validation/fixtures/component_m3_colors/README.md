# `component_m3_colors` fixer fixtures

Exercises every branch of
[`apply_component_m3_colors_fixes`](../../../../../main_agent/services/validation/fixers/component_m3_colors.py)
— the thin dispatcher that runs three regex passes plus the AST-based
pairing walker (`rewrite_m3_color_pairings`).

Deep AST-walker coverage lives in
[`tests/unit/test_semantic_validator_m3_pairing.py`](../../../test_semantic_validator_m3_pairing.py)
(already 579 LOC). The fixtures here cover the dispatcher's regex
branches end-to-end and pin two integration scenarios with the AST
walker so the wiring is validated.

## Branch grid

| Branch (line range) | Broken case(s) | Correct case(s) |
|---|---|---|
| Text opacity strip (34–43) | `broken_text_opacity_stripped`, `broken_text_opacity_multiple` | `correct_text_no_opacity` |
| Bare `outline-variant` rewrite (45–51) | `broken_bare_outline_variant` | `correct_border_outline_variant_already` |
| Low-opacity bg clamp (53–62) | `broken_bg_opacity_below_30` | `correct_bg_opacity_at_threshold`, `correct_bg_opacity_above_threshold` |
| AST pairing walker integration (64–66) | `broken_orphan_inverse_text` | `correct_inverse_text_paired_correctly` |
| Header `bg-transparent` rewrite (68–74) | `broken_header_bg_transparent_replaced`, `broken_nav_bg_transparent_replaced` | `correct_header_bg_transparent_with_backdrop_blur`, `correct_div_bg_transparent_unchanged` |
| Cross-branch | `broken_kitchen_sink_m3` | `correct_clean_m3` |

## Notes

- The bg-opacity clamp fires only on `bg-{color}/N` with `N < 30`. At-or-
  above-threshold values pass through unchanged.
- Header rewrite is scoped to `<header>` and `<nav>` ancestors — a
  `<div className="bg-transparent">` outside those containers is not
  rewritten (would reveal the page background and is intentional in
  many designs).
- The AST walker fires on orphan `text-inverse-on-surface` (or
  `text-inverse-*` more generally) without the matching `bg-inverse-*`
  ancestor. Detailed coverage of the four AST phases stays in the
  semantic-validator-m3-pairing test file.
