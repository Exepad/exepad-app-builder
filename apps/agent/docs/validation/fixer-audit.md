# Fixer audit (Change I + Change J)

This document captures the per-fixer audit done as part of P2 stability
work. For each fixer, it lists the regex-on-raw-TSX patterns, classifies
each pattern by risk, and records the disposition (migrated / kept with
justification / candidate for prompt-side fix / candidate for deletion).

Companion to [`severity-policy.md`](severity-policy.md) and the
regression corpus at
[`tests/unit/validation/fixtures/regression_corpus/`](../../tests/unit/validation/fixtures/regression_corpus/).

## Risk classification

A regex-on-raw-TSX pattern is **high risk** if any of:
- It can match across JSX boundaries (e.g., `<X>...</X>` with `.*?`).
- It targets a JSX-shaped pattern (`<Tag>`, `className="..."`,
  `attr={...}`) without bounding to a single line.
- Its replacement could produce malformed JSX when the input has
  structural variation (nested JSX expression bodies, fragments,
  templates with `${...}`).

A pattern is **medium risk** if:
- It matches inside comments / strings spuriously, but the replacement
  keeps the source structurally valid (cosmetic-only corruption).
- Its scope is bounded but relies on regex anchors that could miss
  variations (e.g., assumes `;` line endings).

A pattern is **low risk** if:
- It targets token-shaped patterns that can't span JSX boundaries
  (e.g., `Icons.PascalCase`, identifier-shaped keywords).
- It matches only inside an already-AST-bounded slice (e.g., post-
  `rewrite_classname_text`).
- It's detection-only and doesn't mutate the source.

## Per-fixer status (Change J)

### `component_polishing.py` — **AST-migrated (H.2)**
- ✅ Fix 7 (animate-in duration) — `JsxAstMutator.iter_classnames`.
- ✅ Fix 9 (overflow-hidden on root) — AST traversal of LightDOMContainer.
- ✅ Fix 6 (contrast 300/400 → 600) — already used `rewrite_classname_text`.
- ✅ Fix 8 (typed empty array) — already AST.

### `component_a11y_ux.py` — **AST-migrated (Change J)**
- ✅ Status-key lowercaser — walks `object` literals.
- ✅ DialogDescription injection — walks `jsx_opening_element` by tag
  name. Fixes the **fixture-22 captured bug** where JSDoc mentions
  triggered the wrong code path.
- ✅ Status-literal rewriter (`status: "Sent"`) — walks `pair` nodes.
- ✅ Status-arg rewriter (`handleSave("Draft")`) — walks
  `call_expression` nodes.
- ✅ Aria-label injection — already AST.
- ✅ Heading-order demoter — already AST.
- 🟡 Mixed-trigger button-children wrap — lives in
  `semantic_validator.py:_wrap_mixed_trigger_button_children`. Uses
  `re.DOTALL` over raw TSX with `.*?` between trigger tags. Medium
  risk. Out of scope for this round (not in `fixers/`); flagged for a
  future migration.

### `component_m3_colors.py` — **AST-migrated (Change J)**
- ✅ Hand-rolled `_classname_inner_span` + `_find_tag_end` parser
  deleted; phases now read `JsxBgScope.class_inner_span`.
- ✅ Phases 1-4 (text-opacity, outline-variant, bg-opacity,
  header-bg-transparent) all use `rewrite_classname_text` —
  className-bounded.
- 🟡 Phase 4 gate `re.search(r"<(?:header|nav)\b", tsx)` over raw TSX.
  False-positive on `<header>` mention in comments enables the
  bg-transparent rewrite, but the rewrite itself is className-bounded.
  Cosmetic. **Acceptable.**

### `component_urls_images.py` — **AST-migrated (Change J)**
- ✅ Hallucinated `<img src>` URL replacement — walks JSX img elements.
- ✅ Hallucinated array-image URLs — walks `pair` nodes by image-key
  allowlist.
- 🟡 `apply_icon_fallback_only` (`Icons.PascalCase` rescue) —
  deliberately stays as `re.sub` over raw TSX. Runs from Tier B
  fallback path on possibly-corrupted JSX. Comment-rewriting of
  `Icons.X` references is a documented trade-off. **Acceptable.**
- 🟡 Static-img-in-map rewriter — paren-balanced AST-aware (per
  prior `project_scope_blind_map_img_fixer` fix). **Acceptable.**
- 🟡 CSS `url(...)` URL replacement — `re.sub` over raw TSX. URL
  syntax is constrained; can match in JSDoc but the replacement
  preserves structure. Cosmetic risk. **Acceptable.**
- 🟡 Baked `/a/.../repo/` URL rewrite — `re.sub` over raw TSX. Pattern
  is constrained to `src="/a/<id>/repo/assets/..."` — token-shaped.
  **Acceptable.**
- 🟡 `<ExepadImage vendor="design_import"/>` strip — `re.sub` matches
  `<ExepadImage>` self-closing. Could match in comments but the inner
  guard (`__ASSET_IMG:` substring required) makes false positives
  effectively impossible. **Acceptable.**
- 🟡 `<ExepadImage>` prop normalisation — operates on already-matched
  `<ExepadImage>` tags. Bounded. **Acceptable.**

### `component_imports.py` — **kept with justification**
- 🟡 React/SDK import detection — single-line `import { ... } from
  '...'` patterns. Bounded by quote characters; can't span. **Acceptable.**
- 🟡 SDK usage scan (`useModel(`, `useHandler(`, etc.) — token-shaped,
  bounded. **Acceptable.**
- 🟡 useApp inline-object-selector + bare-destructure regex fallbacks
  — kept as documented fallbacks for cases the AST `rewrite_useapp_destructures`
  intentionally declines to rewrite (computed selectors, nested
  patterns). The AST pass runs first; these regex fallbacks only fire
  on what the AST left behind. **Acceptable.**

### `component_typos.py` — **kept with justification**
- 🟡 Symbol-set builders (`re.finditer(r"(?:const|let|var)\s+(\w+)")`,
  `re.finditer(r"function\s+(\w+)")`) — detection-only, builds
  identifier set. **Acceptable.**
- 🟡 `useModel("X")` / `useHandler("X")` / `setState("X")` regexes —
  use negative lookbehind `(?<![\w$.])` to prevent matching inside
  method chains. Argument is a quoted string literal — bounded.
  Comment matches are cosmetic. **Acceptable.**
- 🟡 Handler-ref `on*={X}` regex — JSX-shape-aware. **Acceptable.**

### `component_null_safety.py` — **kept with justification**
- 🟡 useApp anchor + post-anchor unsafe-pattern rewrite — operates
  inside a localized slice (`tsx[m.end():]`) after a useApp destructure
  match. Risk is bounded by the anchor; if the anchor matches inside a
  comment, the post-anchor rewrite may also operate on commented-out
  code. Cosmetic risk. **Acceptable.**
- 🟡 Other `_pat` regexes (`alias_pat`, `array_method_pat`, `destr_pat`,
  `var_pat`, `broken_chain_pat`) — all token-shaped or anchor-relative.
  **Acceptable.**

### `component_forbidden_apis.py` — **kept with justification**
- 🟡 `_ASSIGNMENT_RE` — detection regex for `window.location.href = ...`
  shapes. The actual rewrite uses a paren-balanced scanner.
  **Acceptable.**
- 🟡 `_METHOD_CALL_RE` / `_CONSOLE_CALLEE_RE` — detection regexes;
  paren-balanced rewrite. **Acceptable.**

### `component_inline_styles.py` — **kept with justification**
- 🟡 `_STYLE_OBJECT_RE = r"style=\{\{"` — detection regex for inline
  style objects. JSX-shape-bounded. **Acceptable.**
- 🟡 `_STYLE_STRING_RE = r"style=("[^"]*"|'[^']*')"` — detection regex
  for string-shaped style attributes. JSX-shape-bounded. **Acceptable.**
- 🟡 `_KEBAB_KEY_RE` — token-shaped detection. **Acceptable.**
- 🟡 Three internal `re.sub` calls inside `body = ...` — operate on
  already-extracted style-object body strings. AST-bounded by extraction.
  **Acceptable.**

## Foundational fixes shipped this P2 push

1. **`iter_jsx_opening_elements` source-order fix** — eliminated the
   walker bug that caused out-of-order span splicing whenever a
   self-closing JSX element with a className was nested inside an
   opening element with a className. This was the dominant Tier-B-
   triggering JSX corruption class (ze1ltmf9 GameContent corruption).
2. **`JsxBgScope.class_inner_span` field** — populated by tree-sitter
   directly. Replaced m3_colors's brittle hand-rolled
   `_classname_inner_span` + `_find_tag_end` + `_char_span_to_byte_span`
   helpers (~75 LOC, mixed char/byte offsets, char-by-char JSX parser).
3. **`JsxAstMutator` harness** — at
   [`tsx_ast/mutator.py`](../../main_agent/services/validation/tsx_ast/mutator.py).
   Provides `iter_classnames` / `iter_jsx_attributes` /
   `queue_replace` / `build` for fixers that want a uniform mutation
   API. Used by component_polishing (Fix 7).

## Change I — prompt-side audit

**Scope blocker:** real prioritisation for prompt-side fixes needs
production telemetry — which fixers fire how often, on what content.
Without that, classification is heuristic. The list below is what's
heuristically obvious from inspection.

**Candidates for prompt-side fix (the LLM should just not emit this):**

1. **`window.location.href = "/path"` programmatic navigation** —
   `component_forbidden_apis` rewrites to `navigate("/path")`. This is
   prompt-fixable: ensure the SDK navigation example is canonical in
   the component-builder skill docs.
2. **Bare `useApp()` destructure** — `useapp_destructure` rewrites to
   per-key selectors. Prompt-fixable: emphasise the per-key selector
   pattern in the SDK-usage skill doc.
3. **Inline-object `useApp(s => ({a, b}))` selector** — same as above.
4. **`text-gray-300/400` on light backgrounds** — `component_polishing`
   rewrites to `-600`. Prompt-fixable: the design-system skill doc
   should specify the muted-text token (`text-on-surface-variant`)
   instead of borderline grays.
5. **Bare `overflow-hidden` on canvas/sprite roots** — rewrites to
   `overflow-x-clip`. Prompt-fixable: canvas-root example should use
   `overflow-x-clip` directly.
6. **Status-word casing** — fixers lowercase title-case status
   literals. Prompt-fixable: skill doc examples should consistently
   use lowercase status strings.
7. **Untyped `useRef([])` / `useState([])`** — fixers add `<any[]>`.
   Prompt-fixable: examples should use the typed form.
8. **`animate-in ... duration-N` causing transition: all** —
   `component_polishing` rewrites to `[animation-duration:Nms]`.
   Prompt-fixable: animation skill doc should specify the
   arbitrary-value form.
9. **Hardcoded `https://via.placeholder.com/...` URLs** — fixers
   rewrite to `<ExepadImage>`. Prompt-fixable: skill doc should specify
   `<ExepadImage>` for stock images, never raw placeholder URLs.
10. **Hallucinated `Icons.X` names** — fuzzy-matched to closest valid.
    Prompt-fixable in part: ship a curated subset of common lucide
    icons in the system instruction so the LLM doesn't have to guess.

**Candidates for deletion (after prompt fix lands):**

Reduce the fixer pile by deleting passes whose root cause is now
addressed via prompt. Suggested phasing:
- Phase 1: deletes 3, 5, 7, 8 from the list above (all are simple
  pattern fixes with clear canonical examples).
- Phase 2: deletes 1, 2, 4, 6, 9 once skill docs land and the
  regression corpus shows the LLM no longer emits these patterns.
- Phase 3: 10 (icon hallucination) stays as a defensive backstop —
  the LLM will always invent novel icon names occasionally; the
  fuzzy-match fallback to `Circle` is a runtime safety net.

**Policy proposal:** any new fixer added to `fixers/` must justify
itself against this audit document. The author either (a) explains why
the pattern can't be moved prompt-side, or (b) adds the corresponding
skill-doc edit in the same PR and demonstrates equivalent or better LLM
output via the regression corpus.

## Change J — remaining work

After this push, no fixer in `fixers/` has an *unjustified* regex-on-
raw-TSX pattern. The remaining regex patterns each have a documented
rationale (single-line bounded, token-shaped, paren-balanced, etc.).

Future migrations are optional cleanups, not stability work:
- `_wrap_mixed_trigger_button_children` in `semantic_validator.py` —
  the only `re.DOTALL` + `.*?` cross-tag regex remaining. Migration
  would need to walk JSX `*Trigger asChild` elements and check their
  `<Button>` children.
- The cosmetic comment-rewriting in `apply_icon_fallback_only`
  (`Icons.PascalCase` regex) — could migrate to AST `member_expression`
  walking, but loses the "works on possibly-corrupted JSX" property.
  Defer until production logs show the comment-rewrite causing user
  confusion.
