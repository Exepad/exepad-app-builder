```markdown
# Design System Specification: The Kinetic Luminescence

## 1. Overview & Creative North Star
**Creative North Star: The Digital Alchemist**
This design system moves away from the rigid, "boxed-in" nature of traditional SaaS platforms. Instead, it treats data as a living, breathing liquid held within high-end containers. We reject the "template" look by utilizing **intentional asymmetry**, where heavy headlines are balanced by vast negative space, and **tonal depth**, where elements aren't just placed on a screen, but emerge from the darkness.

The goal is an authoritative, editorial experience. By overlapping glass layers and using "glow" as a functional signifier for SEO performance, we create a UI that feels less like a tool and more like a high-performance command center.

---

1.  ## 2. Colors & Surface Philosophy
The palette is rooted in the "Deep Void" (`#0e0e0e`). We use high-vibrancy accents not just for decoration, but as "light sources" in a dark environment.

### The Palette
- **Primary (Electric Purple):** `primary` (#cc97ff) / `primary_dim` (#9c48ea). Used for the "North Star" metrics and primary actions.
- **Secondary (Cyan Pulse):** `secondary` (#3adffa). Reserved for growth trends, "live" AI states, and secondary hits.
- **Tertiary (Magenta High):** `tertiary` (#ff86c3). Used sparingly for critical alerts or "high-octane" SEO wins.

### The "No-Line" Rule
**Borders are a failure of hierarchy.** Within this system, 1px solid borders for sectioning are strictly prohibited. You must define boundaries through:
- **Background Shifts:** Place a `surface_container_high` card on a `surface` background.
- **Tonal Transitions:** Use a 20% opacity gradient shift between two areas.

### Surface Hierarchy & Nesting
Treat the UI as a series of stacked obsidian sheets. 
1. **Base:** `surface` (#0e0e0e)
2. **Structural Sections:** `surface_container_low` (#131313)
3. **Interactive Cards:** `surface_container` (#1a1919)
4. **Floating Popovers/Modals:** `surface_bright` (#2c2c2c) with 80% opacity and 20px Backdrop Blur.

### Signature Textures
Apply a subtle linear gradient to main CTAs transitioning from `primary` to `primary_container`. For hero sections, use a radial gradient of `primary_dim` at 5% opacity in the background to provide a "soulful" glow that prevents the dark mode from feeling flat or "dead."

---

## 3. Typography
We use a high-contrast scale to create an editorial feel. The tension between the wide, architectural **Manrope** and the functional **Inter** creates a premium, bespoke rhythm.

- **Display & Headlines (Manrope):** These are the "Authority" layers. Use `display-lg` (3.5rem) for hero SEO metrics. Tracking should be set to -2% for a tighter, more professional "locked-in" look.
- **Body & Labels (Inter):** These are the "Insight" layers. Use `body-md` (0.875rem) for most data descriptions.
- **Visual Hierarchy:** Headlines should always be `on_surface` (Pure White), while supporting body text should drop to `on_surface_variant` (#adaaaa) to ensure the headlines "pop" with maximum contrast.

---

## 4. Elevation & Depth
Depth in this system is achieved through **Tonal Layering** and **Luminescence**, never through heavy drop shadows.

### The Layering Principle
To create "lift," move up the surface tier. A card shouldn't have a shadow; it should be one step higher in the `surface_container` scale than its parent.
- **Nested Depth:** If a search bar lives inside a sidebar, the sidebar is `surface_container_low` and the search bar is `surface_container_lowest`.

### Ambient Shadows
If an element must float (e.g., a dropdown), use an **Ambient Glow Shadow**:
- **Color:** `primary` at 8% opacity.
- **Blur:** 40px – 60px.
- **Spread:** 0px.
This creates the illusion of the element being backlit by the purple accent light.

### The "Ghost Border" Fallback
Where accessibility requires a container edge, use a **Ghost Border**: 
- **Token:** `outline_variant` at 15% opacity. It should be felt, not seen.

---

## 5. Components

### Data Cards (The Core Component)
- **Background:** `surface_container` at 90% opacity.
- **Glass Effect:** 16px Backdrop Blur.
- **Border:** Top-left "Glow" using a 1px gradient from `primary` (40% opacity) to transparent.
- **Spacing:** Use `spacing-6` (2rem) for internal padding to give data "room to breathe."

### Buttons
- **Primary:** Gradient from `primary` to `primary_dim`. `rounded-md`. No shadow, but a subtle `primary` outer glow on hover.
- **Secondary:** Transparent background with a `secondary` Ghost Border. 
- **Tertiary:** Pure text with `primary` color and an underline that appears on hover via a smooth 200ms transition.

### Input Fields
- **Idle:** `surface_container_highest` background, no border.
- **Focus:** The background remains, but a 1px "Glow" border appears using `secondary` (Cyan).
- **Typography:** `label-md` for floating labels, transitioning to `label-sm` on focus.

### Chips & Badges
- **SEO Status:** Use `secondary_container` for positive growth and `error_container` for drops.
- **Shape:** `rounded-full`. 
- **Style:** No solid background; use 10% opacity fills of the status color with high-contrast text.

---

## 6. Do’s and Don'ts

### Do:
- **Use "Active" Whitespace:** Use `spacing-16` (5.5rem) between major sections to emphasize high-end minimalism.
- **Leverage Asymmetry:** Offset your data visualizations. A large chart on the left can be balanced by a small, high-density list on the right.
- **Animate Transitions:** Use `cubic-bezier(0.16, 1, 0.3, 1)` for all surface entries. It should feel "snappy yet smooth."

### Don't:
- **Don't use Dividers:** Never use a horizontal line to separate list items. Use a 1-step shift in background color or `spacing-4` of empty space.
- **Don't use Pure Grey:** Always ensure your "blacks" are slightly tinted toward the charcoal/blue spectrum of `#0e0e0e`.
- **Don't Over-Glow:** If everything glows, nothing is important. Reserve `primary` accents for the single most important action or data point on the screen.

---

## 7. Spacing & Rhythm
The system uses a non-linear spacing scale to encourage "Breathing Room."
- **Component Internals:** `spacing-3` (1rem) or `spacing-4` (1.4rem).
- **Section Gaps:** `spacing-12` (4rem) to `spacing-20` (7rem).
- **Grid:** While a 12-column grid is used for alignment, elements should frequently "break" the grid—such as images or charts bleeding off the right edge—to maintain the editorial vibe.```