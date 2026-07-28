# `component_imports` fixer fixtures

Exercises every branch of
[`apply_component_imports_fixes`](../../../../../main_agent/services/validation/fixers/component_imports.py).

## Branch grid

| Branch (line range) | Broken case(s) | Correct case(s) |
|---|---|---|
| Export default rename (29–40) | `broken_export_function_renamed` | `correct_export_already_matches` |
| React default → SDK (43–52) | `broken_react_default_only` | — |
| React named → const destructure (54–76) | `broken_react_named_only`, `broken_react_default_and_named` | — |
| React already SDK | — | `correct_react_already_sdk` |
| framer-motion → SDK (79–82) | `broken_framer_motion` | — |
| lucide-react → SDK (84–87) | `broken_lucide_react` | — |
| Missing SDK function-call import (89–140) | `broken_missing_sdk_function_call`, `broken_missing_sdk_jsx_element` | — |
| Unknown SDK imports stripped (116–131) | `broken_unknown_sdk_import_stripped` | — |
| SDK import already complete | — | `correct_complete_sdk_imports` |
| Legacy `useApp` inline-object selector (179–201) — AST handles first | `broken_useapp_inline_object_selector` | — |
| Legacy `useApp` bare destructure (209–218) | `broken_useapp_bare_destructure` | — |
| `useApp` individual selectors | — | `correct_useapp_individual_selectors` |
| Cross-branch | `broken_kitchen_sink_imports` | `correct_no_imports_changes_needed` |

## Notes

- The `useApp` AST rewriter (`fixers/useapp_destructure.py`) runs first
  via [`rewrite_useapp_destructures`](../../../../../main_agent/services/validation/fixers/useapp_destructure.py)
  and emits the same `Rewrote useApp ...` fix message format as the
  legacy regex fallback. Either path satisfies `expected_fix_substrings`.
- Missing-SDK-import detection has two sources: a hardcoded list of 19
  hooks/utilities that triggers via function-call usage (`useNavigation`,
  `useModel`, etc.), and the full SDK catalog (327 exports) that
  triggers via JSX-tag usage (`<Button>`, `<Card>`, etc.).
- Unknown-import stripping requires the SDK catalog to be loaded — names
  not in it (e.g. a misspelled `Buttn`) are removed and reported.
- Each case sets `expected_component_name` only when the case under test
  needs the rename branch; otherwise left empty so the export-rename
  path stays a no-op.
