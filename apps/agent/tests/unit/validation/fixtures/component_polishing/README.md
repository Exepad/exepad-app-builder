# `component_polishing` fixer fixtures

Exercises every branch of
[`apply_component_polishing_fixes`](../../../../../main_agent/services/validation/fixers/component_polishing.py).

## Branch grid

| Branch (line range) | Broken case(s) | Correct case(s) |
|---|---|---|
| Strip `console.log()` | _moved to `component_forbidden_apis` (paren-balanced scanner)_ | _see `fixtures/component_forbidden_apis/`_ |
| Unwrap `cn()` single string (40–47) | `broken_cn_single_string` | — |
| Unwrap `cn()` template literal (48–51) | `broken_cn_template_literal` | — |
| Unwrap `cn()` multiple string literals (52–63) | `broken_cn_multiple_strings` | — |
| `cn()` complex args (no rewrite) (64–65) | — | `correct_cn_complex_args_unchanged` |
| Cap `hover:bg-{white,black}/N` overlays (69–80) | `broken_hover_overlay_high_opacity` | `correct_hover_overlay_at_threshold` |
| Clamp tiny `text-[Npx]` for accessibility (82–91) | `broken_tiny_font_size` | `correct_text_at_min_size` |
| Low-contrast text-*-300/400 → 600 (93–130) | `broken_low_contrast_gray_text`, `broken_low_contrast_slate_zinc` | `correct_dark_variant_unchanged`, `correct_text_500_unchanged` |
| `animate-in duration-N` rewrite (132–207) | `broken_animate_in_with_duration`, `broken_animate_out_with_arbitrary_duration` | `correct_animate_with_explicit_transition`, `correct_data_state_duration_only` |
| Cross-branch | `broken_kitchen_sink_polishing` | `correct_clean_polished` |

## Notes

- The animation-duration rewrite is the most subtle: it fires only when
  className contains `animate-in`/`animate-out` AND a bare `duration-N`
  AND no `transition-*` class. The `data-[state=...]:duration-N` form
  is preserved (shadcn pattern, only triggers on state change).
- Low-contrast text rewrites are bare-class only — variant-prefixed
  classes (`dark:`, `hover:`, `md:`) are intentionally untouched. The
  README's "Authoring gotchas" note 2 applies here.
- `text-*-500` is considered borderline-passing AA on light backgrounds
  and is NOT rewritten — only 300 and 400.
