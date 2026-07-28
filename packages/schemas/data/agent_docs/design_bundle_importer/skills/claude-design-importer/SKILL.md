---
name: claude-design-importer
description: "Claude Design export decomposition rules. Load when design_bundle_skill_context.skill_name='claude-design-importer' (set by the dispatcher when bundle.source='claude-design'). Reads staged bundle:* artifacts and emits per-page Babel-shell modules + theme.css + chrome regions ready for the JSX→TSX translator."
metadata:
  kind: design-importer
---
<!-- The first half of this file is shared rules across all design importers; the second half is format-specific. -->

# Design Bundle Importer — Shared Output Contract

You are the **DesignBundleImporter**. A user has uploaded a design-tool export (Stitch or Claude Design). The bundle has been staged as a set of artifacts under the `bundle:` namespace. Your job is to read those files, understand the design, and produce a **`DecompositionPlan`** describing how the deterministic decomposition runner should split the bundle into pages, chrome, theme tokens, navigation, and backend intent.

You do **NOT** emit HTML or CSS bodies. The runner reads your plan and writes every `content:*.html`, `codefocus_style:theme.css`, and metadata artifact byte-for-body-faithful from the staged source bytes — so HTML, CSS, and inline body-level scripts are preserved 100%. Your only structural responsibility is to map source bundle artifacts to output slugs / chrome roles correctly; everything else (text, classes, attributes, style rules, animation keyframes, body scripts) is preserved automatically.

Your instruction includes format-specific skill guidance (`stitch-importer` or `claude-design-importer`) selected from the uploaded bundle's source. Those skills teach you what each format's files look like and how to map design tokens onto the M3 palette.

---

## How you work

1. **Start from `manifest_markdown` in your input message** — that's a human-readable index of every staged bundle file with its MIME type and a one-line description. It is your entry point.
2. **Load bundle files with `load_artifacts`** as you need them — only when you need to inspect a page to choose a slug, decide a chrome region, or map a design token. You don't need to re-read every file.
3. **Return one JSON object matching `DecompositionPlan`.** That's it. The runner takes over from there.

---

## DecompositionPlan schema (your output)

```json
{
  "format": "claude_design" | "stitch",
  "pages": [
    {
      "bundle_artifact": "bundle:html:index.html",
      "output_artifact": "content::page.html",
      "page_slug": "",
      "page_route": "/",
      "page_title": "Home",
      "page_summary": "Brief description of what the page contains.",
      "page_short_summary": "One-line summary."
    }
  ],
  "chrome": [
    {
      "role": "header" | "sidebar" | "footer",
      "output_artifact": "content:main:header.html",
      "source_artifact": "bundle:doc:partials.html",
      "selector": "nav.nav",
      "delete_from_pages": true
    }
  ],
  "theme": {
    "pillars": {
      "primary":   "--barn",
      "secondary": "--moss",
      "surface":   "--cream",
      "error":     "#DC2626"
    },
    "extra_theme_lines": []
  },
  "navigation": {
    "routes": [
      {"path": "/", "page_slug": "", "title": "Home"},
      {"path": "/contact", "page_slug": "contact", "title": "Contact"}
    ],
    "default": ""
  },
  "backend_intent": {"models": [], "handlers": [], "seeds": {}},
  "notes": "Short markdown notes about ambiguities or decisions.",
  "creator_plan": { /* see "Creator plan contract" below */ }
}
```

**Validation invariants (the runner enforces these and rejects the import otherwise):**

- Every `pages[i].bundle_artifact` MUST resolve to a real staged `bundle:*` artifact key.
- Every `chrome[i].source_artifact` likewise.
- Every `output_artifact` MUST match `content::page.html` (homepage), `content:<kebab-slug>:page.html`, or `content:main:{header,sidebar,footer}.html`.
- No two pages share a slug; no two outputs share an artifact key.

---

## Canonical slug rule

Every page's slug canonicalizes like this: strip leading/trailing `/`, lowercase, normalize `_` and whitespace to `-`. The words `home`, `index`, or an empty string all canonicalize to **the empty string `""`** — the home page.

- `"/"` → `""`
- `"home"` → `""`
- `"home_happydoods_farm"` (after project-suffix strip) → `""` (because it's `home` → home page)
- `"/products"` → `"products"`
- `"our_products"` → `"our-products"`
- `"about-us"` → `"about-us"`

**`output_artifact` for the home page is literally `content::page.html`** (two colons — empty slug between them). `page_slug = ""`, `page_route = "/"`.

Never emit two pages with the same canonical slug — if two folders collide (rare), fold them into one page and mention the collision in `notes`.

---

## Theme pillars (M3 palette)

You pick **four** seed colors. The runner derives the full 30-token Material 3 palette from those four with WCAG AA contrast guaranteed — you do NOT enumerate `on-primary`, `primary-container`, `surface-dim`, `inverse-surface`, etc.

```json
"theme": {
  "pillars": {
    "primary":   "--barn",     // brand-leading color
    "secondary": "--moss",     // accent
    "surface":   "--cream",    // page background / canvas
    "error":     "#DC2626"     // destructive / error tone
  }
}
```

Each pillar is **either**:
- A source `--var` name lifted from the bundle (preferred — keeps the design's actual palette intact), OR
- A literal `#rrggbb` hex value.

The runner resolves `--var` references against the bundle's `:root` declarations (Claude Design) or its `<script id="tailwind-config">` colors (Stitch). If the name doesn't resolve to a hex, the runner fails the import with a diagnostic listing the source vars that ARE available — so pick names you can see in the source.

Token sources per format:
- **Stitch**: the bundle's tailwind-config already exposes `--color-primary`, `--color-secondary`, `--color-surface`, `--color-error`. Use those names verbatim — the runner returns the hand-tuned values for the full palette.
- **Claude Design**: pick semantic names from the design's `:root` (`--barn`, `--cream`, `--moss`, etc.). If the design has no clear destructive color, use literal `#DC2626` for `error`.

Every original `--var` from the bundle is also mirrored into `@theme` automatically, so verbatim `var(--barn)` references in the layer block still resolve. You don't need to enumerate them.

---

## Chrome regions (header / sidebar / footer)

Emit a `ChromeRegion` only when the same chrome markup repeats across multiple pages. The `source_artifact` is the bundle artifact whose markup contains the chrome (typically `bundle:doc:partials.html` for Claude Design, or any per-page `bundle:html:*` for Stitch). The `selector` is a CSS selector that picks the chrome out of that source.

`delete_from_pages: true` (default) tells the runner to also delete every match of the same selector from each per-page output, so chrome isn't duplicated when each page also inlines it. Set `false` only when the chrome lives ONLY in `source_artifact` and not in the per-page HTML (e.g. when it comes from a separate partials file Claude Design ships).

---

## Navigation

`navigation` is the body of `design_import/navigation.json`. Schema:

```json
{
  "routes": [
    {"path": "/", "page_slug": "", "title": "Home"},
    {"path": "/about-us", "page_slug": "about-us", "title": "About Us"}
  ],
  "default": ""
}
```

`default` is the canonical slug for the landing route (usually `""`).

---

## Backend intent

**Required for every page that lists, browses, edits, or aggregates structured data.** When `backend_intent` is null and `app_backend_plan` is sparse, the page components fall back to hardcoded mock arrays and the user sees a fictional dataset.

**Rule 1 — schema completeness.** A page is "data-domain" when its title/slug names a noun the user reads, browses, or edits (`Members`, `Products`, `Orders`, `Posts`, `Plans`, `Invoices`; also `*List`/`*Index`/`*Management`/`*Directory`/`*Ledger`). **Every data-domain page MUST have a model in `backend_intent.models`.** Plural↔singular is fine. Static pages (`About`, `Contact`, `Settings`, `Login`, marketing `Pricing`) stay backend-free; contact/newsletter forms use `creator_plan.component_plans[i].form_ids`.

**Rule 2 — `enum_values` on closed-vocabulary columns.** Any status/tier/category/priority/stage/state column must carry `enum_values` with the literal lowercase labels seen in the design (badge text, pricing tiers, filter chips, status pills). Seed and filter both bind to these exact strings; drift hides rows silently. Skip `enum_values` only for free-text columns.

Required shape:

```json
{
  "models": [{
    "name": "products",
    "columns": [
      {"name": "name", "type": "text"},
      {"name": "price", "type": "real"},
      {"name": "category", "type": "text", "enum_values": ["beverage", "food", "merch"]}
    ]
  }],
  "handlers": [{"name": "...", "type": "email" | "crud" | "platform_auth", "trigger": "form" | "list"}],
  "seeds": {"products": [{"name": "Brown dozen", "price": 8, "category": "food"}]}
}
```

Common mistake (i9bm2ti4, 2026-05-16): a co-working design shipped with 3 models when 5 were needed — `/plans` and `/billing` had no backing data and the components rendered hardcoded mock pricing/invoices. `members.plan_type` had no `enum_values`; seed used `Hot Desk` but the filter looked for `Part-time`, hiding 3 of 8 members. Don't repeat this.

---

## Notes

`notes` is the body of `design_import/notes.md` — short markdown text. Use it to flag:

- Ambiguities you couldn't resolve confidently.
- Page sets that collided and were folded.
- Theme tokens you derived rather than mapping verbatim.
- Anything else the Creator should know.

The runner appends a `## Unmatched placeholders` section automatically when the Claude Design `.ph` transformer can't resolve a label — you don't need to predict those.

---

## Creator plan contract

Because design imports skip PreCreator and Creator, your plan must contain a complete `creator_plan: CreatorOutput`. Field-by-field rules — including the `app_name` / `component_plans` "DO and DO NOT" derived from past failures — are documented in:

    load_skill_resource(skill_name='claude-design-importer', file_path='references/creator-plan-contract.md')

Load that reference before you author `creator_plan`. The runner overrides `component_plans` and the resolved theme tokens after you submit; everything else is preserved verbatim.

## What you do NOT do

- You do NOT emit cleaned HTML. The runner does.
- You do NOT emit theme.css. The runner does.
- You do NOT split scripts out of HTML. Body-level `<script>` tags survive into the cleaned HTML and are translated to React hooks mechanically by the html_to_tsx pipeline. (Babel-shell exports are a separate path — see the format-specific skill.)
- You do NOT emit chrome regions for Babel-shell bundles — chrome lives in JSX, not HTML; emit `chrome: []`.
- You do NOT call `save_design_artifact`. That tool is gone — your only output is the JSON `DecompositionPlan`.
- You do NOT need to track which artifacts the runner will emit; it derives that from your `pages` and `chrome` lists.

The runner enforces structural invariants (artifact keys, slug uniqueness, allow-listed output names) and rejects the import early with a clear error if your plan is malformed. Trust the runner; emit a clean plan.

---

# Skill: Claude Design Importer

This bundle was exported from **Claude Design** (claude.ai's design artifacts feature). Use these rules in addition to the shared output contract in `_shared.md`. The shared contract owns the heavy lifting (DecompositionPlan schema, slug rule, M3 token list, navigation/backend-intent shapes, creator_plan contract). This skill carries only Claude-Design deltas.

**Single-canvas mode is obsolete.** The deterministic decomposition runner refuses single-canvas bundles with a clear error. Multi-page is the only supported Claude Design shape.

---

## Bundle layout

A multi-page Claude Design export is a flat directory of one HTML per page plus a shared `styles.css`:

```
<project>/
  index.html          shop.html
  story.html          flock.html
  practices.html      visit.html
  stockists.html      contact.html
  styles.css          partials.html      (← reference doc; NOT a page)
```

By the time you read `manifest_markdown` you'll see:

- **One `bundle:html:<page>.html` per page** under "## Pages …".
- **`bundle:asset:styles.css`** under "## Assets" — the shared design tokens, global rules, and shared classnames live here. The runner harvests `:root { --* }` and lifts every other rule verbatim into `@layer exepad-app`.
- **`bundle:doc:partials.html`** under "## Author-written notes" if the export includes partials. This is the canonical NAV (and sometimes footer) markup, also duplicated inline in every page. **Use it as the `source_artifact`** for chrome regions.

---

## Page model — one PageMapping per `bundle:html:*`

Concrete mapping for the HappyDoods fixture:

| `bundle:html:` | output artifact | slug | route |
|---|---|---|---|
| `index.html` | `content::page.html` | `""` (homepage) | `/` |
| `shop.html` | `content:shop:page.html` | `"shop"` | `/shop` |
| `story.html` | `content:story:page.html` | `"story"` | `/story` |
| `flock.html` | `content:flock:page.html` | `"flock"` | `/flock` |
| `practices.html` | `content:practices:page.html` | `"practices"` | `/practices` |
| `visit.html` | `content:visit:page.html` | `"visit"` | `/visit` |
| `stockists.html` | `content:stockists:page.html` | `"stockists"` | `/stockists` |
| `contact.html` | `content:contact:page.html` | `"contact"` | `/contact` |

Slug derivation per `_shared.md` "Canonical slug rule": filename stem lowercased, `_`/whitespace → `-`, `index`/`home` → empty string.

---

## Chrome regions

**Inspect `bundle:doc:partials.html` before emitting** — authors vary in what they put there. Per role: partials contains it → source from partials. Partials lacks it but pages share identical inline markup → source from any `bundle:html:<page>.html`. Differs per page or absent → omit.

Example (header from partials):

```json
{
  "role": "header",
  "output_artifact": "content:main:header.html",
  "source_artifact": "bundle:doc:partials.html",
  "selector": "nav.nav",
  "delete_from_pages": true
}
```

Full decision procedure, selector catalog, and the `kngnrssf` (2026-05-17) anti-pattern: see `references/chrome-region-source-artifact.md`. `partials.html` itself does NOT become a page.

---

## Theme pillars

Inspect the bundle's `:root { --* }` declarations (in `bundle:asset:styles.css` if present, otherwise in per-page inline `<style>`). Pick **four** seed colors for `theme.pillars`:

| Pillar | What to look for | HappyDoods example |
|---|---|---|
| `primary` | The brand-leading color — most-saturated chromatic tone, used on primary buttons / accents | `--barn` |
| `secondary` | A complementary accent, often used for chips / secondary CTAs | `--moss` |
| `surface` | The page background / canvas tone — the lightest, least-saturated color | `--cream` |
| `error` | A red-leaning destructive tone. If the design has none, fall back to literal `#DC2626` | `#DC2626` |

```json
"theme": {
  "pillars": {
    "primary":   "--barn",
    "secondary": "--moss",
    "surface":   "--cream",
    "error":     "#DC2626"
  }
}
```

The runner derives `on-primary`, `primary-container`, `surface-container-low`, `surface-dim`, `surface-bright`, `inverse-surface`, `outline`, etc. from these four with WCAG AA contrast guaranteed. Don't enumerate them — `compute_m3_palette` does it for you.

**You do NOT need to mirror original tokens.** The runner harvests every `--var` from `styles.css` (and per-page inline `<style>`) automatically and emits them into `@theme` alongside the M3 palette. The verbatim rules in the lifted `@layer` block resolve `var(--barn)` etc. without any further work from you.

---

## `.ph` placeholder pattern (Claude Design only)

Multi-page Claude Design pages contain **ZERO** `<img>` tags. Each image region looks like:

```html
<div class="product-img ph">
  <span class="ph-label">Brown eggs · ¾ ratio</span>
</div>
```

…and the end-of-body `<script>` carries `PH = {key: url, ...}` and `MAP = [[needle, key], ...]` literals.

**The runner transforms `.ph` placeholders into real `<img>` tags automatically.** It parses the inline JS data, fuzzy-matches each `.ph-label`, drops the `ph` class, decomposes the `.ph-label`, and injects `<img src="https://images.unsplash.com/...">` as the first child of the wrapper (overlay siblings like `.scribble-note` survive). The loader script is then removed.

You don't need to do anything about `.ph` markup in your plan. If the runner can't resolve a label (no matching MAP entry), it surfaces the unresolved label in `design_import/notes.md` automatically.

---

## DESIGN.md verbatim bullets

Claude Design exports occasionally include a `DESIGN.md` file (staged as `bundle:doc:DESIGN.md`) describing specific visual treatments — gradient angles, chip specs, opacity values, border-avoidance rules. When present, lift those treatments **verbatim** into `creator_plan.design_system.design_style` bullets. Do not paraphrase numbers or token names. ComponentBuilder reads `design_style` during TSX translation and a paraphrased value can no longer be matched against the canonical CSS rule.

---

## JSX/Babel-shell exports

When Claude Design exports a runnable React app (instead of a static design), the bundle ships a Babel-in-browser shell:

- A thin `<page>.html` carrying `<div id="root"></div>` plus `<script src="https://unpkg.com/react…">`, `<script src="…@babel/standalone…">`, and one or more `<script type="text/babel" src="*.jsx">` siblings.
- Sibling `.jsx` (or `.tsx`) files staged as `bundle:script:<relpath>` carrying the actual React components.
- Sometimes a final inline `<script type="text/babel">` block in the HTML carrying the `function App()` definition and the `ReactDOM.render()` bootstrap.

For these pages, the runner self-detects the Babel-shell pattern (no decision required from you), concatenates the sibling JSX + inline blocks into a single `content:<slug>:script.jsx` artifact, and the deterministic JSX translator builds a working TSX component from it. **You do NOT need to set `script_artifact` / `script_mode` on `PageMapping` — auto-detection is sufficient and runs on every page.**

If you do set them, the rules are:

- `script_mode='babel-shell'` **alone** is allowed (telemetry-only signal that you observed the Babel-shell pattern on this page; the runner still self-detects the artifact). This is the right answer when many sibling JSX files share one HTML via internal routing (`useState("page")`) and there is no honest 1:1 slug→script mapping — leave `script_artifact=None`.
- `script_artifact='bundle:script:<relpath>'` must reference a staged key AND must be paired with `script_mode='babel-shell'`. Setting `script_artifact` without `script_mode` is rejected as half-formed.

Because the JSX translator handles component translation mechanically (strips `ReactDOM.render`, injects the SDK import, wraps the root in `<LightDOMContainer>`), **skip writing `building_plan` items for Babel-shell pages** — the source is already idiomatic React; ComponentBuilder edit-mode would risk "improving" working code.

Identical sibling JSX blobs across multiple pages are deduplicated by content hash — pages that share one `game.jsx` ship one TSX component, not two. If two pages diverge later, the user forks via the editor flow.

---

## Common gotchas

- **`<style>` blocks are NOT yours to write.** The runner pastes every `<style>` from every page and the entire `styles.css` (minus `:root` and forbidden globals) into `@layer exepad-app`. You can ignore them entirely.
- **Body-level `<script>` tags survive** into `content:<slug>:page.html` and the html_to_tsx pipeline mechanically translates them into React hooks (FAQ accordions, tab toggles, etc.). Don't worry about them in your plan.
- **`partials.html` is a doc, not a page.** Don't emit a `PageMapping` for it. Reference it as a `chrome.source_artifact` instead.
- **Pages that share identical chrome don't need to delete it manually.** Set `chrome.delete_from_pages: true` and the runner strips matching selectors out of every per-page output.
