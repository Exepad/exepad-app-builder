# Validation rule catalog

Quick reference for every AST and regex rule the agent runs against
generated artifacts. Use this when writing error messages, prompt hints,
or debugging why a component / handler / theme failed validation.

## How to read this page

- **Rule ID** — the exact string emitted in `Finding.rule_id`. Use it in
  LLM error messages so the fixer knows which rule to target.
- **Engine** — `tsx_ast` (tree-sitter TSX), `css_ast` (tinycss2), or
  `regex` (legacy string-level patterns still living in
  `semantic_validator.py`).
- **Artifact** — which builder's output this rule runs against: `H` =
  handler TSX (BackendHandlerBuilder), `C` = component TSX
  (ComponentBuilder), `T` = theme.css (DesignSystemBuilder).

## Shared TSX rules (handler + component)

| Rule ID | Engine | Artifact | Severity | What it catches |
|---|---|---|---|---|
| `handler.imports.non_sdk` | tsx_ast | H, C | error | Imports from anything other than `@exepad/sdk` (plus relative/absolute paths). |
| `handler.forbidden.api` | tsx_ast | H, C | error | `eval`, `new Function`, `new XMLHttpRequest`, `localStorage`, `sessionStorage`, `console.log`, direct DOM access, `addEventListener` (with keyboard/scroll/resize exemptions), raw `fetch` (with whitelist), `.innerHTML =`, `cn()`. |

## Handler-only rules

| Rule ID | Engine | Severity | What it catches |
|---|---|---|---|
| `handler.forbidden.browser_api` | tsx_ast | error | Direct use of `document`, `window`, `alert`, `confirm`, `prompt`, `setTimeout`, `setInterval`. Handler-only because components render in the browser where these APIs are legitimate; `handler.forbidden.api` still gates imperative-DOM anti-patterns in components. |
| `handler.export.missing_default` | tsx_ast | error | No `export default` — handler contract requires one. |
| `handler.signature.missing_ctx` | tsx_ast | warning | First parameter doesn't contain `ctx`. |
| `handler.plan.fail_loudly` | tsx_ast | error | `throw new Error("handler_plan references undeclared ...")` escalation from Hard Rule #5. |
| `handler.return.hardcoded_literal` | tsx_ast | error | Return object pairs with a bare numeric literal where the plan expects a computed metric. |
| `handler.return.missing_field` | tsx_ast | error | Return object missing a key declared in `handler_plan.expected_outputs` (close-match hint). |
| `handler.sql.param_injection` | tsx_ast | error | `.prepare()` called with a template-literal that interpolates `${}` — SQL injection risk. |
| `handler.sql.undeclared_table` | tsx_ast | error | SQL references a table not declared in the backend models and not in the platform reserved list. |
| `handler.sql.dynamic_query` | tsx_ast | warning | `.prepare()` called with a non-literal argument — can't statically validate. |
| `handler.sql.undeclared_column` | tsx_ast | warning | Qualified `table.column` reference where `column` isn't declared on the model. |

## Component-only rules

| Rule ID | Engine | Severity | What it catches |
|---|---|---|---|
| `component.export.name_match` | tsx_ast | error | Default export function name differs from the expected component name. |
| `component.hooks.conditional` | tsx_ast | error | React hooks nested inside ternary / `&&` / `\|\|` — breaks Rules of Hooks. |
| `component.hooks.useapp_selector` | tsx_ast | error | `useApp()` with no selector or inline object selector — causes infinite re-render. |
| `component.imports.missing_sdk_export` | tsx_ast | error | JSX references a PascalCase SDK symbol that isn't in the `@exepad/sdk` import list. |
| `component.jsx.raw_img_tag` | tsx_ast | warning | Raw `<img>` with empty / `__PLACEHOLDER__` / `data:` src — prefer `<ExepadImage>`. |
| `component.jsx.static_src_in_map` | tsx_ast | warning | Static `src="…"` inside `.map()` — should be dynamic `src={item.image}`. |
| `component.jsx.button_missing_action` | tsx_ast | warning | Action-verb `<button>` (Save / Submit / Update …) with no `onClick` / `type=submit`. |
| `component.nav.raw_internal_anchor` | tsx_ast | warning | In-app navigation as a raw `<a href="/path">`. The app is served under a basePath (`/a/preview-<id>/`), so the href resolves against the ORIGIN and points outside the app — a `navigate()` onClick only rescues plain left-click, while middle/Cmd-click "Open in new tab", "Copy link address" and crawlers all break. Use the SDK `<Link to="…">` (it renders `href={resolveAppPath(to)}`). Skips external/scheme/`#`/relative hrefs, `target="_blank"`, and dynamic hrefs with no `navigate()` handler. |
| `component.handlers.orphan_form_input` | tsx_ast | warning | Named input inside a `<form onSubmit>` that no `formData.get("name")` reads — the field renders but its value is dropped. CONTROLLED inputs (bound `value`/`checked` **plus** an `onChange`-family handler) are exempt: they submit through React state, not the FormData API. |
| `component.a11y.heading_order` | tsx_ast | warning (error on ≥2-level skip) | Non-sequential heading levels (h1 → h3 warning, h1 → h4 error). |
| `component.a11y.button_aria_label` | tsx_ast | warning | Icon-only `<button>` / `<Button>` / `<IconButton>` / `<a>` without an accessible name (`aria-label` / `aria-labelledby` / `title`, or — for links — visible/sr-only text). Anchors wrapping an `<img alt="…">` or a descendant carrying an aria label are exempt (logo links). Auto-fixer injects a label when inferable from a child icon (`<Github/>` → "Github") or an `on*` handler. |
| `component.a11y.dialog_description` | tsx_ast | warning | `<DialogContent>` without a `<DialogDescription>` anywhere in the tree or `aria-describedby`. |
| `component.refs.unknown_icon` | tsx_ast | **error** | `<Icons.Name>` where `Name` isn't in the Lucide icon set — renders as `undefined` and crashes the page with React #130. **Crash-class severity** per [severity-policy.md](severity-policy.md); rescued unconditionally by `apply_icon_fallback_only` in `artifact_tools._apply_unconditional_icon_rescue` and the Tier B path, so the error severity only fires on edge cases the regex doesn't reach. |

## Cross-reference checks (tsc Stage-1.5)

The save tool runs `tsc --noEmit` against a per-app `app.d.ts` (generated
from the backend / logic / pages manifest) plus a curated SDK declaration
(`tsc_validator/agent_sdk_gate.d.ts`). Findings surface as
`tsc.<error-code>` and are always severity `error`. The rules below were
all deleted from the AST layer once tsc demonstrated equivalent coverage.

| tsc code | What it catches | Replaces |
|---|---|---|
| `tsc.2345` | `useModel('UnknownModel')` — argument not assignable to `keyof AppModels`. | `component.refs.unknown_model` |
| `tsc.2345` | `useHandler('unknown_handler')`. | `component.refs.unknown_handler` |
| `tsc.2345` | `setState('unknown_key', ...)`. | `component.refs.unknown_state` |
| `tsc.2345` | `navigate('/unknown')` — argument not assignable to `keyof AppRoutes`. | `component.refs.unknown_navigate` |
| `tsc.2304` | JSX expression references an identifier not in scope. | `component.jsx.undeclared_reference` |
| `tsc.2339` | Property access on a typed payload (model row, handler output, `AppState`) for a name that wasn't declared. | `component.refs.model_payload_fields`, `component.refs.handler_output_fields`, `component.refs.useapp_unsafe_access` |
| `tsc.18047` | Array method called on `useModel().data` (typed `T[] \| null`) without `?.` / `?? []`. | `component.refs.usemodel_null_access` |

The gate fails open when `tsc` isn't on PATH (local dev without
Node.js) — it returns no findings rather than crashing. The agent
container has Node + TypeScript installed so the gate runs in
production.

## theme.css rules

| Rule ID | Severity | What it catches |
|---|---|---|
| `style.forbidden.host_selector` | error | `:host { … }` — components render in Light DOM. |
| `style.forbidden.v3_tailwind_directive` | error | `@tailwind base` — the runtime provides its own reset. |
| `style.forbidden.global_reset` | error | `* , *::before , *::after { margin: 0 }` — strips platform layout margins. |
| `style.forbidden.font_face` | error | `@font-face` — fonts go through DynamicFontLoader. |
| `style.forbidden.directive_before_layer` | error | `@tailwind components/utilities` or `@import "tailwindcss"` outside the `@layer exepad-app` block. |
| `style.required.layer_exepad_app` | error | Missing `@layer exepad-app { … }` wrapper. |
| `style.required.tailwind_import` | error | Neither `@import "tailwindcss"` nor `@tailwind components/utilities` present. |
| `style.required.root_block` | error | Missing `:root { … }` block for SDK CSS variables. |
| `style.required.sdk_variables` | error | `:root` missing one or more of the required SDK variables (`--background`, `--primary`, etc.). |
| `style.hsl.hex_instead_of_hsl` | warning | SDK variable declared as `#ffffff` — Tailwind's opacity modifier won't apply. |
| `style.hsl.hsl_fn_wrapper` | warning | SDK variable declared with `hsl(h, s%, l%)` — use space-separated `h s% l%`. |
| `style.contrast.m3_pairs` | error | `@theme` M3 token pair (e.g. `on-primary` / `primary`) fails WCAG AA. |
| `style.contrast.sdk_pairs` | error | `:root` SDK pair (e.g. `primary-foreground` / `primary`) fails WCAG AA. |

## Regex-only checks (still in `semantic_validator.py`)

These stay regex because tree-sitter would either duplicate the pattern
matching (hardcoded URLs, className substrings) or buy no accuracy
(cross-file duplicate detection).

- `check_hallucinated_image_urls`, `check_hallucinated_style_urls`,
  `check_duplicate_image_urls` (warning)
- `check_layout_offsets`, `check_overflow_hidden_on_root`,
  `check_low_opacity_text`, `check_low_opacity_bg` (warning / error)
- `check_status_style_map_case` (warning)
- `check_broken_optional_chain` (warning)
- `check_exepad_image_props`, `check_exepad_image_dimensions`,
  `check_exepad_image_duplicate_keywords` (warning)
- `check_placeholder_divs` (error)
- `check_inline_font_family` (warning)
- `check_animate_in_with_bare_duration` (warning)
- `check_enum_coverage` (warning)

M3 color pairing checks run in the AST rule engine (see
`tsx_ast/rules/component_m3_colors.py`): `InverseSurfaceTextPairingRule`
(warning), plus four Track-2 ancestor-aware rules —
`LightSurfaceInverseTextRule`, `DarkSurfaceLightTextRule`,
`DarkBgTextPairingRule`, `LightTextOnLightBgRule`.

## Severity contract (Phase 3)

- **`error`** = hard-blocks save. Reserved for: syntax (esbuild),
  forbidden security APIs, SQL injection, hooks-of-rules, missing SDK
  imports, conditional hooks, useApp inline-object selector,
  design-import parity, all CSS rules, handler structural rules.
- **`warning`** = ships with the artifact. Surfaced in SSE
  `backend_response.validation_warnings`. The runtime degrades the
  underlying issue (`useModel('unknown')` returns empty data,
  `Icons.Foo` renders nothing, `ComponentErrorBoundary` catches
  ReferenceError) so visible-but-broken UI reaches the user instead of
  an aborted workflow. The user iterates via the editor flow.

## Single-attempt validation (Phase 1)

ComponentBuilder's save tool runs validation ONCE. There is no LLM
"Fixer" agent rewriting your output — that path was removed. If
deterministic auto-fixers can patch the output (forbidden console.log,
inline-style camelCase, M3 token pairing, optional chaining, …), they
do. Otherwise the artifact ships with the warnings, or as a stub on
hard ERRORs. The post-build "ValidatorBatch" step is gone too —
replaced by a single ~1-second deterministic Tailwind compile gate
against the final theme + components, with no LLM in the loop.

## Adding a new rule

1. Write the rule class in `tsx_ast/rules/` or `css_ast/rules/` with
   `id`, `severity`, and `check(ctx) -> Iterator[Finding]`.
2. Add it to the matching factory in `rules/default_set.py` —
   `shared_tsx_rules`, `handler_rules`, `component_rules`, or
   `theme_css_rules`.
3. Drop a unit-test file in `tests/unit/validation/<engine>/` with a
   happy path, each violation path, and any documented edge case.
4. If the violation pattern is common enough to warrant a golden
   fixture, add a `correct_*` or `broken_*` file alongside the existing
   ones and wire it into `test_golden_handlers.py` /
   `test_golden_components.py` / `test_golden_themes.py`.
5. Update this catalog.
