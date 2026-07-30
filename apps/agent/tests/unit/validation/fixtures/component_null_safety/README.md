# `component_null_safety` fixer fixtures

Exercises every branch of
[`apply_component_null_safety_fixes`](../../../../../main_agent/services/validation/fixers/component_null_safety.py).

The fixer reads `ctx.state_keys` to decide which `useApp`/destructured names
are nullable. A key counts as nullable when its initial value is `None`,
`{}`, or `[]` (line 35–37 of the fixer). Strings, numbers, and non-empty
collections are treated as non-nullable and never rewritten.

## Branch grid

| Branch (line range in fixer) | Broken case(s) | Correct case(s) |
|---|---|---|
| `useApp` selector var (40–53) | `broken_useapp_selector_nullable_access`, `broken_useapp_selector_chained_access` | `correct_useapp_selector_already_safe`, `correct_useapp_selector_non_nullable_key` |
| `useApp` destructure (55–66) | `broken_useapp_destructure_nullable_access`, `broken_useapp_destructure_multiple_nullables` | `correct_useapp_destructure_only_non_nullables` |
| `useModel` data null guard (68–96) | `broken_usemodel_data_map`, `broken_usemodel_data_filter`, `broken_usemodel_aliased_data` | `correct_usemodel_already_guarded`, `correct_usemodel_optional_chain_safe` |
| SDK hook destructured (97–116) | `broken_use_current_user_destructured`, `broken_use_current_user_destructured_multiple_fields` | `correct_use_current_user_destructured_already_safe` |
| SDK hook var-bound (118–136) | `broken_use_current_user_var_bound` | `correct_use_current_user_var_bound_no_chain` |
| Broken optional chain (138–143) | `broken_optional_chain_method_call`, `broken_optional_chain_nested_brackets` | `correct_optional_chain_already_safe` |
| Cross-branch | `broken_kitchen_sink_multi_pattern` | `correct_no_state_keys_no_op` |

## Notes

- All fix messages are deterministic strings the fixer appends to
  `fixes_applied`. The manifest pins the exact substrings.
- The fixer is idempotent at both the output and fix-message level on every
  case here — a second pass on the rewritten TSX produces no further
  rewrites because `?.` and `(x ?? [])` patterns are detected and skipped.
- `useModel` only wraps known array methods (`map`, `filter`, `find`,
  `findIndex`, `forEach`, `reduce`, `some`, `every`, `flat`, `flatMap`,
  `includes`, `indexOf`, `slice`, `sort`, `concat`, `length`). Calls like
  `data.toString()` are not wrapped.
- `useCurrentUser` is the only SDK hook in
  [`SDK_HOOK_NULLABLE_FIELDS`](../../../../../main_agent/services/validation/tsx_ast/catalog.py)
  today, with nullable fields `id`, `email`, `name`. New hooks only need
  catalog entries; the fixer picks them up automatically.
