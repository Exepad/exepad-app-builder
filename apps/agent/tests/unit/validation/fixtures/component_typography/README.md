# `component_typography` Fixer Fixtures

Scenario grid for `apply_component_typography_fixes`. The fixer rewrites
numeric Tailwind font-weight utilities (`font-NNN`) — which Tailwind v4
does NOT ship as default utilities — to their named equivalents
(`font-bold`, `font-extrabold`, etc.).

| Scenario | Kind | Fixture | Notes |
|---|---|---|---|
| `font-700` rewritten | broken | `examples/broken_font_700.tsx` | Mixed in with `font-headline`; rewrites to `font-bold` |
| `font-800` rewritten | broken | `examples/broken_font_800.tsx` | Inside parent div; rewrites to `font-extrabold` |
| Multiple weights in one component | broken | `examples/broken_font_mixed.tsx` | `font-700`, `font-800`, `font-500` |
| Template-literal className | broken | `examples/broken_font_template_literal.tsx` | Cooked literal with `${...}` interpolation elsewhere |
| Already-named utility | correct | `examples/correct_named_font_bold.tsx` | `font-bold`, `font-extrabold`, `font-normal` |
| Arbitrary form `font-[700]` | correct | `examples/correct_arbitrary_font_700.tsx` | Valid Tailwind arbitrary value — must NOT be touched |
| `font-${weight}` interpolation | correct | `examples/correct_font_dynamic_template.tsx` | Fixer can't statically classify; AST rule surfaces the warning instead |
