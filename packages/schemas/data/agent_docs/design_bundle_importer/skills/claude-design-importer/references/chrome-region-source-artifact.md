# Choosing `ChromeRegion.source_artifact` — full case analysis

Reference detail for the Chrome regions section in `SKILL.md`. Read this only when you're emitting a `ChromeRegion` and unsure where its source markup actually lives.

## Why this matters

The runner extracts the chrome from exactly one `source_artifact` using exactly one CSS selector. A wrong `source_artifact` choice — even with a correct selector — aborts the entire workflow with `selector did not match anything: '<sel>'`. The decomposition phase is upstream of every LLM step that actually builds the app; a crash here means burning the DesignImporter cost ($0.05 – $0.20) with zero output.

## Author variance in `bundle:doc:partials.html`

Claude Design has no canonical rule for what `partials.html` contains. Real bundles fall into four buckets:

| Variant | partials.html contains | Per-page bundles contain |
|---|---|---|
| **A. Full chrome partials** | `<nav>` + `<footer>` (canonical) | inline duplicates of both |
| **B. Nav-only partials** | `<nav>` only | inline `<footer>` per page |
| **C. Footer-only partials** | `<footer>` only (rare) | inline `<nav>` per page |
| **D. No partials.html** | (file absent) | inline `<nav>` + `<footer>` per page |

The HappyDoods chick-farm bundle (app `kngnrssf`, 2026-05-17) is variant B. Variants B, C, D will crash the workflow if the LLM blindly emits `source_artifact: "bundle:doc:partials.html"` based on "partials always has both" — an assumption that's wrong as often as right.

## Decision procedure

For each chrome role (header / footer):

1. **Open `bundle:doc:partials.html`** (if present) — grep for the role's tag (`<nav` / `<header` / `<footer`).
2. **If a match exists in partials.html:** use `source_artifact: "bundle:doc:partials.html"` with the selector that matches the actual markup. Example: `selector: "nav.nav"` when partials has `<nav class="nav">`.
3. **If no match in partials.html, but every per-page bundle has identical inline chrome of that role:** use `source_artifact: "bundle:html:<any-page>.html"`. Pick `index.html` by convention; any page works because they're identical. The runner still deduplicates via `delete_from_pages: true`.
4. **If chrome differs per page OR doesn't exist anywhere:** omit the `ChromeRegion` for that role. Per-page inline chrome stays in each page output; no shared component is produced.

## Anti-pattern: the kngnrssf failure

**What the LLM emitted:**
```json
{
  "role": "footer",
  "source_artifact": "bundle:doc:partials.html",
  "selector": "footer.footer",
  "delete_from_pages": true
}
```

**What was true:**
- `partials.html` = 31 lines, contained only `<nav class="nav">`. No `<footer>`.
- Every per-page bundle had identical `<footer class="footer">…</footer>` inlined.

**The CSS selector `footer.footer` was correct** for the markup it described. The `source_artifact` was wrong. The LLM had skipped step 1 of the decision procedure above — it never opened `partials.html` to verify a footer was inside.

**Correct emission would have been:**
```json
{
  "role": "footer",
  "source_artifact": "bundle:html:index.html",
  "selector": "footer.footer",
  "delete_from_pages": true
}
```

## Selector pattern catalog (per role)

When you've identified the right source artifact, the selector usually fits one of these shapes:

| Role | Common selectors |
|---|---|
| `header` | `nav.nav`, `header`, `header.topbar`, `nav[class*='fixed top-0']`, `header.site-header` |
| `footer` | `footer.footer`, `footer`, `div.footer`, `footer[role='contentinfo']` |
| `sidebar` | `aside`, `nav.sidebar`, `aside[class*='sidebar']` |

Pick the most specific selector that uniquely identifies the chrome subtree — over-broad selectors (`header`, `footer` with no class qualifier) can match decorative in-body elements on some bundles and over-strip during the runner's strip pass.

## Recovery: the runner's extract-fallback safety net

The chrome-extract handler (shared by Stitch + Claude Design) applies fallback layers when your `(source_artifact, selector)` choice misses: it retries the same selector against every staged `bundle:html:*` page, then tries per-role semantic fallbacks (`footer`, `footer.footer`, `div[class*='footer']`, etc.). This means a wrong `source_artifact` no longer aborts the workflow — but the fallback fires a structlog warning, and the emitted chrome may not be what you intended.

**The fallback is a safety net, not the primary path.** Always emit a correct `source_artifact` so the LLM teaches itself to choose well on future bundles. If you find yourself relying on the fallback, the underlying decision was wrong.

## Babel-shell bundles: emit `chrome: []`

A Babel-shell bundle is one where every `PageMapping` sets `script_mode: "babel-shell"` (Claude Design's single-`<div id="root">` + `<script type="text/babel">` + sibling JSX files pattern). The chrome (header / sidebar / footer) is rendered from a sibling `.jsx` file — typically `shell.jsx` — that the runtime concatenates with the entry script. The HTML shell itself contains only `<div id="root"></div>`; the sidebar / nav / footer don't appear in any `bundle:html:*` artifact.

CSS selectors cannot match elements that only exist in JSX source. Emitting a chrome region in this case crashes Phase 1.5 decomposition with `selector did not match` and burns the DesignImporter cost with zero output (production app `u0j2m40o`, 2026-05-19).

**The rule**: if every page has `script_mode: "babel-shell"`, emit `chrome: []`. The translated TSX will contain the chrome inline, and the downstream digest + assembly path is fail-soft on missing `content:main:{header,sidebar,footer}.html` artifacts. The runner also has a deterministic guard that silently drops chrome regions for all-Babel-shell bundles, so emitting them by mistake no longer crashes — but the runner logs a `babel_shell_chrome_regions_dropped` warning, so do it right and the warning stays at zero.
