# `component_typos` fixer fixtures

Exercises every branch of
[`apply_component_typos_fixes`](../../../../../main_agent/services/validation/fixers/component_typos.py).

The fixer reads `models`, `handlers`, `state_keys`, and `page_slugs` from
`FixContext` and uses fuzzy matching (`difflib.get_close_matches`) to
correct typos at the call site.

## Branch grid

| Branch (line range) | Broken case(s) | Correct case(s) |
|---|---|---|
| Undeclared JSX handler ref (30–49) — cutoff 0.8 | `broken_handler_ref_typo` | `correct_handler_ref_below_cutoff` |
| `useModel('Xs')` arg (52–64) — cutoff 0.8 | `broken_use_model_typo` | `correct_use_model_exact_match`, `correct_use_model_no_models_context` |
| `useHandler('Xs')` arg (66–80) — cutoff 0.8 | `broken_use_handler_typo` | `correct_use_handler_exact_match` |
| `setState('Xs')` arg (82–94) — cutoff 0.8 | `broken_set_state_typo` | `correct_set_state_exact_match` |
| `navigate('/x')` close-match (96–144) — cutoff 0.6 | `broken_navigate_close_match`, `broken_href_attr_close_match` | `correct_navigate_exact_match`, `correct_navigate_external_url`, `correct_navigate_system_route` |
| `navigate('/x')` no-match fallback to first page (146–156) | `broken_navigate_no_match_fallback` | — |
| Cross-branch | `broken_kitchen_sink_typos` | `correct_no_typos` |

## Notes

- Fuzzy-match cutoff is **0.8** for SDK-call args (model/handler/state)
  and **0.6** for navigation paths (slugs are short and noisier).
- The fallback-to-first-page behavior (line 150) protects against ghost
  nav links: when an LLM hallucinates a `/sprints` link in a plan that
  only has `/`, the fixer rewrites the link to `/` rather than letting a
  404 ship.
- Page slugs are normalised both sides (leading `/` stripped) before
  comparison, then the canonical absolute form (`"/" + match`) is
  emitted on rewrite. The bare-slug fixer in
  `component_urls_images` runs earlier in the same pass and prepends
  `/` already; this fixer's emit format keeps subsequent passes
  idempotent.
