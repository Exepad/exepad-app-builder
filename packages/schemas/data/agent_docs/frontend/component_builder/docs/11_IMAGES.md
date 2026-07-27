# Image Rules

## ExepadImage Component

Use `<ExepadImage>` from `@exepad/sdk` for ALL images. The platform resolves images
automatically from stock photo APIs using the props you provide.

### ExepadImage Props:
- `keywords` (REQUIRED): Descriptive search query for stock photo API (5+ words, English, unique per image). Follow image keywords from `building_plan`.
- `importance` (REQUIRED): 1-10 score — how critical is this image to the app's design?
  Higher importance loads eagerly (better LCP) and is prioritised; it does NOT
  change which provider is used (all providers are free).
  - 8-10: Hero images, key visuals, primary product photos
  - 5-7: Section illustrations, team photos, feature images
  - 1-4: Decorative backgrounds, minor thumbnails
- `width` / `height` (**REQUIRED**): Display dimensions in pixels. MUST match the rendered box on a mobile viewport (≤ 430px wide). These are rendered as HTML attributes on the `<img>` tag so the browser reserves space BEFORE the image loads — this is how you prevent layout shift (CLS). **There is no default — you must pick a size.**
- `fit` (optional): "cover" (default), "contain", "fill"
- `className`: Tailwind classes for sizing and styling

**Sizing guidance (mobile-first — the browser downscales larger displays):**
- Full-bleed hero image: `width={800} height={600}` (or 4:3, 16:9 as desired)
- Section illustration: `width={600} height={400}`
- Card image (grid item): `width={400} height={500}` (4:5 is a great portrait ratio)
- Circle avatar / team photo: `width={200} height={200}`
- Tiny thumbnail: `width={100} height={100}`

**Never request width > 1200 for mobile-first content.** Over-sized requests waste bandwidth and hurt LCP. Request the display size, not the source resolution.

If `image_urls` provides catalog URLs, use a plain `<img>` tag with that URL instead — but the tag STILL must have `width` and `height` attributes.

### Static images:
```tsx
{/* Full-width hero — picks a size that looks good at the display box */}
<ExepadImage
  keywords="modern office lobby with natural light and glass walls"
  width={800} height={500}
  importance={8}
  className="w-full h-64 object-cover rounded-lg"
/>
{/* Circular portrait — ~200px display, so request ~200px */}
<ExepadImage
  keywords="professional portrait of female architect in bright studio"
  width={200} height={200}
  importance={6}
  className="w-32 h-32 rounded-full object-cover"
/>
```

### Array / .map() Images (CRITICAL)

When rendering multiple images via `.map()`, EVERY array item MUST include an
`image` object with unique `keywords` and `importance`. The `<ExepadImage>` MUST
spread from the array item data.

CORRECT pattern:
```tsx
const teamMembers = [
  { name: "Alice", role: "CEO", image: { keywords: "professional portrait of female CEO in modern office", importance: 7 } },
  { name: "Bob", role: "CTO", image: { keywords: "professional portrait of male CTO with laptop in bright workspace", importance: 7 } },
  { name: "Carol", role: "Designer", image: { keywords: "creative portrait of female designer in colorful studio", importance: 6 } },
];

{teamMembers.map((member) => (
  <ExepadImage
    {...member.image}
    width={200} height={200}
    className="w-32 h-32 rounded-full object-cover"
  />
))}
```

Every `.map()` image must set `width` and `height` explicitly — the render box is the same for every item, so one size works for all.

FORBIDDEN:
- Using raw `<img>` tags without a catalog URL (use `<ExepadImage>` instead)
- Hardcoding the same `keywords` for all items in a `.map()` loop
- Omitting `keywords`, `importance`, `width`, or `height` props on `<ExepadImage>`
- Requesting `width > 1200` or `height > 1200` for mobile-first content — over-sized images murder LCP
- Setting `vendor`, `assetId`, or `src` props on `<ExepadImage>` (these are injected by the platform resolver) — **except** when carrying through a design-import placeholder that was already on the element (see "Design-import images" below).
- Using `<img>` without `width` and `height` attributes (causes layout shift / CLS)
- Putting a raw third-party URL (`pexels.com`, `unsplash.com`, `pixabay.com`, …)
  ANYWHERE in the TSX — including inside JS object literals like
  `image: { src: "https://images.pexels.com/..." }`. The image object should
  carry only `keywords`, `importance`, optional `width`/`height`. The resolver
  fetches the image and injects the right `src` at build time. Hardcoded
  CDN URLs are fragile (rate-limit, hot-link block, takedown) and the
  validator flags them as hallucinated.

## Design-import images (preserved `src` placeholders)

Components imported from a design source ship with `<ExepadImage>` elements
that already carry `src="__ASSET_IMG:assets/imports/<hash>.png__"`. This is
intentional — the design importer materializes the original image bytes to
GCS at `assets/imports/<hash>.<ext>` and the deploy pipeline rewrites the
placeholder to the resolved CDN URL at publish time. **In this case, `src`
is NOT injected by the resolver — it's a stable reference to a specific
imported asset.** Preserve those placeholders byte-for-byte during edits
**unless the building_plan describes a visible image change**, in which
case follow the swap rules below.

## How `src` and `keywords` interact (READ THIS BEFORE EDITING IMAGES)

Two attributes on `<ExepadImage>` look interchangeable but are not:

| If `src` is... | Then `keywords` is used... |
|---|---|
| **empty / unset** | as a stock-photo search query at deploy time → fresh image fetched |
| **`__ASSET_IMG:assets/<path>__`** | **as metadata only** — the placeholder is rewritten to the resolved CDN URL of that specific asset; no fetch happens |

**Consequence:** updating `keywords` without also clearing or replacing
`src` is a **silent no-op for the user**. The same image renders with new
metadata. The most reliable way to actually change the rendered image is
to **delete `src` entirely** and let the platform refetch.

## Image-swap intent detection (CRITICAL)

You receive an `existing_source` (current TSX) and a `building_plan` from
the Editor. The Editor describes intent in natural language; **YOU own the
mechanics** of how to mutate the JSX. Read the plan carefully:

### Plan describes a VISIBLE image change

Phrases like *"change the hero background"*, *"replace the team photo"*,
*"swap the avatar"*, *"update the product image to show X"*, *"new
background featuring Y"*, etc. — anything describing a different rendered
image — require BOTH of these mutations on the target `<ExepadImage>`:

1. **Delete the `src` attribute entirely** so the resolver fetches a fresh
   stock photo at deploy time.
2. **Update `keywords`** to a 5+ word description of what the user
   described (use the plan's wording or paraphrase faithfully).

Optional: also update `alt` to match the new content.

```tsx
// Before (existing_source has):
<ExepadImage src="__ASSET_IMG:assets/imports/abc123.png__"
             keywords="happy chickens grazing in pasture"
             alt="Happy chickens"
             width={1200} height={921} importance={10}
             className="w-full h-full object-cover" />

// After (image swap — DELETE src, UPDATE keywords):
<ExepadImage keywords="sun-drenched organic farm landscape with rolling hills at golden hour"
             alt="Golden hour view of the organic farm landscape"
             width={1200} height={921} importance={10}
             className="w-full h-full object-cover" />
```

### Plan describes a metadata-only change

Phrases like *"update the alt text"*, *"fix the alt for accessibility"*,
*"reword the image caption"* — touch only the named attribute and leave
`src` and `keywords` strictly alone.

### Plan describes pointing at a specific known asset

Rare in edits — happens when the user uploaded a file and `@filename`-
referenced it. The plan will give an explicit `__ASSET_IMG:` path; replace
the existing `src` value with the new placeholder verbatim.

### Anti-pattern (the bug this section exists to prevent)

**Do NOT** apply a plan that describes a visible image change by updating
only `keywords` and/or `alt` while preserving the existing `src`. The
resolver will see a still-pinned placeholder, skip the fetch, and the user
will see the same image with new metadata. If the plan describes a new
image, you MUST delete `src`.

## NO PLACEHOLDER DIVS (CRITICAL)

NEVER generate a gray box with descriptive text as a stand-in for visual content.
Every visual element must be FULLY IMPLEMENTED using CSS, Tailwind classes, SVG,
canvas, or React code. The output must be publish-ready with zero placeholders.

Instead, IMPLEMENT the visual:
- Decorative backgrounds → CSS gradients, patterns, or Tailwind utilities
- Abstract effects → CSS animations, SVG patterns, or canvas
- Illustrations → SVG inline or composed from styled divs
- Game graphics → Canvas API, CSS grid, or styled elements
- Data visualizations → Charts.* components or styled elements
