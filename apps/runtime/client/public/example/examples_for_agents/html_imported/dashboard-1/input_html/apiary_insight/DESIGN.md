# Design System Strategy: The Golden Hive

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Living Ledger."** This concept moves away from the sterile, "SaaS-standard" dashboard and toward a digital experience that feels as organic and intentional as a well-kept apiary. 

We break the "template" look by rejecting rigid boxes. Instead, we use **Tonal Layering** and **Intentional Asymmetry**. Data isn't just displayed; it is harvested. The layout utilizes generous white space (the "breathing room" of the hive) and sophisticated, editorial typography to ensure that high-density data (hive temperatures, humidity, yield) feels calm and authoritative.

---

## 2. Colors & Surface Philosophy
The palette is a sophisticated blend of sun-drenched ambers (`primary`) and deep, medicinal forest greens (`secondary`). 

### The "No-Line" Rule
**Strict Mandate:** Designers are prohibited from using 1px solid borders to section content. Boundaries must be defined solely through background color shifts. 
- A card (`surface_container_lowest`) sits on a page section (`surface_container_low`), which in turn sits on the global background (`surface`). 
- This creates a soft, tactile feel that mimics the natural transitions found in nature.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—stacked sheets of fine parchment or beeswax.
- **Base Level:** `surface` (#f7f9ff) for the widest layout areas.
- **Sectional Level:** `surface_container_low` (#f1f4fa) for grouping related data widgets.
- **Component Level:** `surface_container_lowest` (#ffffff) for individual data cards to provide a "pop" of clarity.

### The "Glass & Gradient" Rule
To elevate the experience from "clean" to "premium":
- **Signature Gradients:** Use a subtle linear gradient from `primary` (#835400) to `primary_container` (#f9a825) for high-level "Harvest" CTAs.
- **Glassmorphism:** For floating navigation or over-image tooltips, use `surface` at 70% opacity with a `backdrop-blur` of 12px.

---

## 3. Typography: Editorial Authority
We pair **Manrope** (Display/Headline) with **Inter** (Title/Body) to balance character with utility.

- **Display & Headline (Manrope):** These are your "Editorial" voices. Use `display-lg` and `headline-md` for high-level hive statuses (e.g., "Hive Alpha is Thriving"). The slightly wider tracking of Manrope feels modern and expensive.
- **Body & Labels (Inter):** Inter is our "Workhorse." Use `body-md` for data descriptions and `label-sm` (uppercase with 0.05em tracking) for technical metadata like "PH LEVELS" or "SENSORS ACTIVE."
- **Hierarchy:** Use `on_surface_variant` (#524434) for secondary body text to reduce visual noise while maintaining readability against the warm background.

---

## 4. Elevation & Depth: Tonal Stacking
Traditional drop shadows are forbidden. We use environmental light simulation.

- **The Layering Principle:** Depth is achieved by "stacking" the surface-container tiers. Place a `surface_container_lowest` card on a `surface_container_low` section to create a soft, natural lift.
- **Ambient Shadows:** If a card must "float" (e.g., a hover state), use a shadow with a 24px blur, 0px spread, and 6% opacity. The shadow color must be a tinted version of `on_surface` (#181c20), never pure black.
- **The "Ghost Border" Fallback:** If a divider is essential for accessibility, use the `outline_variant` (#d7c3ae) at **15% opacity**. It should be felt, not seen.

---

## 5. Components & Signature Motifs

### Hexagonal Accents
Do not use hexagons as containers for buttons or photos. Instead, use them as **Subtle Textures**. 
- Apply a `primary_fixed` (#ffddb5) hexagonal SVG pattern at 5% opacity to the background of `surface_container_high` sections. It should feel like a watermark on expensive paper.

### Buttons
- **Primary:** `primary` background with `on_primary` text. Use `rounded-md` (0.75rem).
- **Secondary:** `secondary_container` background with `on_secondary_container` text. This is for "Healthy" actions (e.g., "Add Inspection").
- **Tertiary:** No background. Use `primary` text with an icon.

### Data Visualization (The Hive Health Map)
- **Status Indicators:** Use `secondary` (#1b6d24) for optimal health, `tertiary` (#735c00) for warnings (e.g., low nectar flow), and `error` (#ba1a1a) for critical alerts (e.g., Varroa mite detection).
- **Charts:** Forbid grid lines. Use `surface_variant` for axes and `primary` for the data line. Fill the area under the curve with a gradient from `primary_container` to transparent.

### Inputs & Cards
- **Input Fields:** Use `surface_container_highest` for the field background with no border. On focus, transition the background to `surface_container_lowest` and add a 1px "Ghost Border" using `primary`.
- **Cards:** No dividers. Use **Spacing 6** (2rem) to separate content blocks within a card.

---

## 6. Do’s and Don’ts

### Do:
- **Use Intentional Asymmetry:** Align your "Total Honey Yield" display-text to the left, but place the "Trend Micro-chart" to its far right with significant white space between them.
- **Embrace "Nesting":** Put a `surface_container_highest` badge inside a `surface_container_lowest` card.
- **Use Large Spacing:** Default to `Spacing 5` (1.7rem) for internal padding to give the data room to breathe.

### Don’t:
- **Don’t use 100% Black:** Always use `on_surface` (#181c20) for text to keep the "warm" feel.
- **Don’t use heavy borders:** If you feel the need to draw a line, try adding 4px of `Spacing` instead.
- **Don’t clutter the Hexagons:** If the pattern is visible at first glance, it is too dark. It should only be noticed upon a second, closer look.