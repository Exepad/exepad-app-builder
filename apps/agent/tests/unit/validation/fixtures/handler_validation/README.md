# `handler_dispatcher` fixer fixtures

Exercises every branch of
[`apply_handler_auto_fixes`](../../../../../main_agent/services/validation/fixers/handler_dispatcher.py).

Handler TSX is narrower than component TSX — only import-source rewrites
matter (react / framer-motion / lucide-react → `@exepad/sdk`) plus the
stripping of hallucinated `import { X } from "X"` statements where `X`
is a declared model name.

## Branch grid

| Branch (line range) | Broken case(s) | Correct case(s) |
|---|---|---|
| Hallucinated model-name import (35–44) | `broken_model_name_self_import`, `broken_multiple_model_imports` | `correct_model_name_unrelated_import` |
| react default + named → SDK (46–57) | `broken_react_imports` | — |
| framer-motion → SDK (59–63) | `broken_framer_motion_import` | — |
| lucide-react → SDK (59–63) | `broken_lucide_react_import` | — |
| Multiple branches | `broken_kitchen_sink_handler` | `correct_clean_handler` |

## Notes

- The fixer signature is `(tsx, model_names: list[str] | None) -> (tsx, fixes)`
  — different from the `FixContext` shape used by all the component
  fixers. The test file uses an adapter to bridge the two signatures.
- Model-name stripping is case-insensitive. `import X from "Order"`
  is stripped if `model_names` contains `"order"`.
- The fixer does NOT add missing imports or rewrite handler-specific
  patterns (no SDK auto-import like component_imports does). Handler
  TSX is treated as already-correct except for the import-source
  rewrites listed above.
