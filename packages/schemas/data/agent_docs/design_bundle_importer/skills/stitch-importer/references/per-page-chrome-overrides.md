# Per-page chrome overrides — `ChromeRegion.page_scope`

> **Status: schema only.** The runtime SPA does not yet render per-page chrome overrides — emit only `page_scope: "all"` regions today. This document captures the contract for when the renderer lands.

When (in a future release) a single chrome region (header / sidebar / footer) doesn't fit every page (e.g. the source's products-page footer has a newsletter form while home/about/contact have an address block), emit ADDITIONAL `ChromeRegion` entries with `page_scope` set to the target page slug AND a per-page `output_artifact` path.

Without per-page overrides, every page collapses to whichever footer you picked as canonical. Past regression: chick_farm (RC#7 in app `w4hov6ht`, 2026-05-16) — the source had 4 different footers (home: address+hours; products: newsletter form; about: social icons; contact: description+social icons), but the importer emitted only one canonical `ChromeRegion` for "footer", so products/about/contact all rendered the home-page footer and lost their distinctive content.

## Pattern

When designing the chrome list, ALSO walk every page and compare its `<footer>` (or `<header>` if relevant) to the canonical one. If a page's chrome differs structurally (different children, different forms, different icon rows), emit a per-page override:

```json
{
  "chrome": [
    {
      "role": "footer",
      "output_artifact": "content:main:footer.html",
      "source_artifact": "bundle:html:home_<project>/code.html",
      "selector": "footer",
      "page_scope": "all"
    },
    {
      "role": "footer",
      "output_artifact": "content:products:footer.html",
      "source_artifact": "bundle:html:our_products_<project>/code.html",
      "selector": "footer",
      "page_scope": "products"
    },
    {
      "role": "footer",
      "output_artifact": "content:contact-us:footer.html",
      "source_artifact": "bundle:html:contact_us_<project>/code.html",
      "selector": "footer",
      "page_scope": "contact-us"
    }
  ]
}
```

The runner emits all three artifacts. The runtime renders the canonical (`page_scope: "all"`) chrome by default and an override when present for the current page slug.

## When NOT to emit overrides

If two pages have footers that differ only in cosmetic text (a date stamp, a page-specific copyright year, or a single navigation link variant) and SAME structural shape, prefer the canonical chrome. Per-page overrides add deploy artifacts and runtime work; reserve them for structurally distinct chrome where the user-visible diff is significant (different sections, different interactive components, different icon families).
