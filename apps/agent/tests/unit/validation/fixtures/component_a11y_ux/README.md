# `component_a11y_ux` fixer fixtures

Exercises every branch of
[`apply_component_a11y_ux_fixes`](../../../../../main_agent/services/validation/fixers/component_a11y_ux.py).

## Branch grid

| Branch (line range in fixer) | Broken case(s) | Correct case(s) |
|---|---|---|
| Status map keys lowercase (34–72) — fires only on ≥2 title-case hits | `broken_status_map_three_hits`, `broken_status_map_exact_two_hits` | `correct_status_map_single_hit_below_threshold`, `correct_status_map_no_status_words` |
| DialogDescription injection — Case 1 (DialogContent without Description) (83–93) | `broken_dialog_content_missing_description` | — |
| DialogDescription import-only — Case 2 (used but not imported) (94–97) | `broken_dialog_description_used_no_import` | — |
| DialogDescription skip rules | — | `correct_dialog_with_aria_describedby`, `correct_dialog_already_has_description_imported` |
| Mixed icon+text Button under `*Trigger asChild` (99–106, helper in semantic_validator) | `broken_dialog_trigger_mixed_button`, `broken_alert_dialog_trigger_mixed_button` | `correct_trigger_already_wrapped_in_span`, `correct_trigger_text_only_button`, `correct_trigger_icon_only_button` |
| Status literal in object property (108–118) | `broken_status_property_sent` | — |
| Status literal in function arg (119–132) | `broken_status_arg_save_draft`, `broken_status_arg_mark_approved` | `correct_status_arg_non_status_word_unchanged` |
| Cross-branch | `broken_kitchen_sink_multi_a11y` | `correct_no_a11y_issues` |

## Notes

- The status-map lowercasing fires only on `{...}` blocks of 20–500
  characters with at least 2 title-case status words. Single-hit blocks
  are intentionally left alone to avoid false positives on user-defined
  `Pascal` keys that happen to match.
- DialogDescription auto-injection skips when
  `<DialogContent aria-describedby="...">` is present — the developer
  has already opted into a custom description target.
- Mixed-button wrapping is gated on the trigger appearing in
  [`TRIGGER_ASCHILD_COMPONENTS`](../../../../../main_agent/services/validation/tsx_ast/catalog.py)
  (`DialogTrigger`, `AlertDialogTrigger`, `PopoverTrigger`,
  `SheetTrigger`, etc.). Plain `<Button>` outside a Trigger is not
  wrapped — only the Slot crash path matters.
- Status literal lowercasing covers both object-property form and
  function-call argument form. Function name must match
  `(save|update|set|handle|mark)\w*` to qualify.
