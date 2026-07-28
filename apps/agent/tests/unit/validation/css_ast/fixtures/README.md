# theme.css validator fixtures

Golden CSS files consumed by `test_golden_themes.py`, which exercises
`theme_css_rules()` over both correct and broken theme.css files.

## Naming convention

- `correct_theme_<scenario>.css` — a valid theme. Test asserts zero
  error findings. Warnings (HSL hints) are tolerated.
- `broken_theme_<rule_or_cluster>.css` — intentionally bad; test
  asserts the rule set or cluster it was built to exercise fires.

## Current fixtures

| File | Purpose |
|---|---|
| `correct_theme_minimal.css` | Tailwind v4 `@import`, full SDK variable set, high-contrast pure-monochrome pairings. |
| `correct_theme_v3_directives.css` | v3-style `@tailwind components/utilities` inside `@layer exepad-app`. |
| `broken_theme_kitchen_sink.css` | All six forbidden-pattern rules fire plus `sdk_variables`. |
| `broken_theme_missing_structure.css` | No `@layer`, no Tailwind import, no `:root`. |
| `broken_theme_hsl_format.css` | Hex + `hsl()` wrapper in SDK variables (advisory). |
| `broken_theme_contrast_fail.css` | `@theme` M3 and `:root` SDK pair both fail WCAG AA. |
| `broken_theme_missing_sdk_vars.css` | `:root` present but missing most SDK variables. |

## When to add

Only add when the scenario exercises rule interactions that single-rule
unit tests don't cover (e.g. `directive_before_layer` requires a layer
to exist; a missing-layer fixture suppresses the rule entirely — see
`broken_theme_kitchen_sink.css` for the interaction).
