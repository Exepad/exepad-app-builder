---
name: a11y-audit
description: "Accessibility audit profile for the Surveyor — keyboard reachability, focus management, ARIA mismatches, missing labels, image alt text, dialog title/description, contrast violations beyond what the deterministic CSS-AST validator catches, screen-reader heading hierarchy. Use when the user says the app is hard to use with keyboard, hard for someone with a disability, fails accessibility audits, or asks for WCAG compliance review. Output is evidence-bound findings citing specific TSX locations. Keywords: accessibility, a11y, wcag, keyboard, screen-reader, aria, focus, alt-text, contrast, voiceover, jaws, axe, lighthouse-a11y."
metadata:
  kind: diagnostic-profile
  applies_to: surveyor
  tool_budget: '6'
  intent_keywords: "accessibility a11y wcag aria keyboard screen_reader voiceover focus alt_text inaccessible"
---
# Accessibility Audit Investigation

The user wants the app to be more accessible (or has been told it's
not). Your job is to identify the specific WCAG-AA violations and
proactive accessibility gaps, cite evidence from component sources,
and tell the Editor what to fix.

The CSS-AST validator already catches mechanical issues (M3 contrast
pairs, buttons without `aria-label` on icon-only). Your job is the
proactive design issues the validator can't catch:

- Keyboard reachability (every interactive element via Tab)
- Focus order (logical, not visual)
- Heading hierarchy (h1 → h2 → h3, no skipped levels)
- Form labels (every input has a `<Label htmlFor>`)
- Error association (`aria-describedby`, `aria-invalid`)
- Image alt text quality (not just presence)
- Dialog title + description
- Skip links on multi-page layouts

## Step 1 — Restate the symptom concretely

- "Hard with keyboard" → "Tab order in the dashboard skips the filter
  panel; users can only reach it via mouse."
- "Screen reader confused" → "h1 → h3 jump on the pricing page (no h2);
  rotor navigation is broken."
- "Failed Lighthouse a11y" → "Three image elements lack alt text on the
  marketing landing page."

## Step 2 — Targeted scans (tool-driven)

1. **`list_artifacts_tool`** — list components.
2. **`search_artifacts_tool`** for high-signal antipatterns:
   - `<img\s+(?!.*alt=)` — image with no alt attribute
   - `<input\s+(?!.*(?:aria-label|<Label))` — input without label
   - `<button[^>]*>(?!\s*<Icons|[A-Z])` — button with empty / unclear children
   - `onClick.*=>.*<div` — `<div onClick>` (should be `<button>`)
   - `tabIndex={[1-9]` — positive tabindex (anti-pattern)
   - `role="button"` on non-button — semantic mismatch
   - `<h1.*<h1` — multiple h1 in same component
3. **`describe_artifact_tool`** on the suspect component to read its
   structure.
4. **`find_symbol_references_tool`** for `<Dialog`, `<AlertDialog`,
   `<Sheet`, `<Popover>` to verify each has a `Title` + `Description`.

## Step 3 — Common antipatterns and severity

### Critical (blocks WCAG-AA)

| Antipattern | Detection | Fix recipe |
|-------------|-----------|-----------|
| `<div onClick>` | grep | Replace with `<button onClick>`; inherits keyboard focus + activation. |
| Image with no alt | grep `<img\s+(?!.*alt=)` | Add `alt="…"` (descriptive) or `alt=""` (decorative). |
| Form input without label | grep `<input` near no `<Label htmlFor>` | Add `<Label htmlFor="id">…</Label>`; placeholder is NOT a label. |
| Dialog without `DialogTitle` | grep `<DialogContent` near no `DialogTitle` | Add `<DialogTitle>…</DialogTitle>`. Required for `aria-labelledby`. |
| Positive `tabIndex={1+}` | grep | Remove; rely on DOM order for tab sequence. |
| `outline: none` without focus replacement | grep CSS / className | Restore via `focus-visible:ring-2 focus-visible:ring-ring`. |
| Missing form-error association | error text near input but no `aria-describedby` | Add `aria-describedby="email-error"` on input + `id="email-error"` on the error `<p>`. |

### High (degrades a11y but not absolute fail)

| Antipattern | Detection | Fix |
|-------------|-----------|-----|
| Empty / unclear button children | grep `<button[^>]*></button>`, or `<button> <Icons.X /> </button>` without aria-label | Add `<span className="sr-only">Close</span>` or `aria-label="Close"`. |
| Heading skip (h1 → h3) | inspect heading levels in component | Renumber to h1 → h2 → h3. |
| `aria-label` redundant with visible text | grep `<button aria-label="X">X</button>` | Remove the label; it's already announced via children. |
| Color-only signaling (red text for error, no icon) | grep `text-destructive` on plain text not paired with icon | Add `<Icons.AlertCircle>` or paragraph prefix. |
| Multiple `h1` per page | grep | Demote duplicates to `h2`+. |

### Medium (proactive polish)

- Skip-to-main link missing on multi-page apps
- Icon buttons sized < 44 px (also a touch-target issue)
- Live region for async status (`role="status" aria-live="polite"`)

## Step 4 — Output structure

```jsonc
{
  "symptom": "Marketing landing fails Lighthouse a11y at 71/100",
  "findings": [
    {
      "severity": "critical",
      "antipattern": "img_missing_alt",
      "file": "codefocus_component:HeroSection.tsx",
      "line_range": "32-45",
      "evidence": "<img src={heroImage} className='w-full' /> — no alt attribute",
      "fix_hint": "Use <ExepadImage src={heroImage} alt='Modern office workspace with developer at desk' /> for descriptive alt; or alt='' if purely decorative."
    },
    {
      "severity": "critical",
      "antipattern": "div_onclick",
      "file": "codefocus_component:FeatureCard.tsx",
      "line_range": "17",
      "evidence": "<div className='cursor-pointer' onClick={onClick}>",
      "fix_hint": "Replace outer <div> with <button type='button' className='text-left ...' onClick={onClick}> so it gets keyboard activation, focus ring, and role=button for free."
    },
    {
      "severity": "high",
      "antipattern": "heading_skip",
      "file": "codefocus_component:PricingPage.tsx",
      "line_range": "21-89",
      "evidence": "Page renders <h1>Pricing</h1> followed by <h3>Most popular</h3> per tier — no h2 between.",
      "fix_hint": "Either demote tier names to <h3> with a section <h2>Plans</h2> wrapper, or promote tier names to <h2>."
    }
  ]
}
```

## Tool budget

`tool_budget: 6` — same as performance-audit. Prioritise:
1. `list_artifacts_tool` (1 call)
2. `search_artifacts_tool` for the high-signal regexes (3 calls)
3. `describe_artifact_tool` on top-2 worst components (2 calls)

## Output guidance for Editor

The Editor can fix mechanical issues (alt text, label, ARIA) directly.
Structural issues (heading hierarchy, focus order, semantic markup)
need component-level rewrites — flag the file path + line range and let
ComponentBuilderMultiple handle the change.

## Anti-patterns in YOUR diagnosis

- ✗ "Add aria-labels everywhere." Wrong; ARIA is last resort, semantic HTML first.
- ✗ "Use a11y libraries." Already covered by Radix-backed SDK primitives.
- ✗ Reporting WCAG contrast violations on tokens (validator already catches these — don't duplicate).
- ✗ Listing every interactive element as a finding. Cite only what fails — Tab-reachable elements with proper labels are not findings.

## Compatibility

Reuses the existing Surveyor toolset. The deterministic CSS-AST
validator already enforces M3 contrast pairs at theme-build time —
this profile complements it by catching the structural/proactive
issues that contrast checks can't see.
