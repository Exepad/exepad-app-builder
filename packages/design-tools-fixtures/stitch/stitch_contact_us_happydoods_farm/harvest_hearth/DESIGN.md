# Design System Strategy: The Organic Editorial

## 1. Overview & Creative North Star
**Creative North Star: "The Modern Homestead"**

This design system rejects the sterile, "tech-first" aesthetic of modern SaaS in favor of a high-end editorial experience that feels as grounded as a farm at sunrise. We are moving away from rigid grids and 1px borders. Instead, we embrace **Organic Asymmetry** and **Tonal Layering**. 

The goal is to make the digital interface feel like a premium lifestyle magazine. We achieve this by using "The Breathable Layout"—utilizing expansive white space (`spacing.20` and `spacing.24`) to let high-quality photography and bold typography do the heavy lifting. Elements should feel "placed" rather than "slotted," using overlapping components and subtle shifts in surface color to define sections.

## 2. Colors & Surface Architecture
The palette is rooted in the earth. It uses a high-contrast relationship between deep forest greens and sunny yellows to evoke growth and warmth.

*   **Primary (`#7a5900`) & Primary Container (`#f4b400`):** These are our "Sunlight" tokens. Use them for high-intent actions and to draw the eye to core value propositions.
*   **Secondary (`#47664b`):** The "Forest" anchor. This provides the trustworthiness and organic foundation of the brand.
*   **Tertiary (`#a03f29`):** The "Terracotta" accent. Use sparingly for notifications, seasonal highlights, or unique callouts.

### The "No-Line" Rule
**Strict Mandate:** Designers are prohibited from using 1px solid borders to section content. 
Structure must be defined by **Color Blocking**. To separate a testimonial section from a product grid, transition from `surface` (`#fcf9f3`) to `surface-container-low` (`#f6f3ed`). The eye should perceive the change in "ground," not a stroke.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of fine, recycled paper. 
1.  **Base Layer:** `surface` (`#fcf9f3`).
2.  **Raised Elements:** Use `surface-container-lowest` (`#ffffff`) for cards to create a subtle "pop" against the cream base.
3.  **Recessed Areas:** Use `surface-container-high` (`#ebe8e2`) for sidebars or footer areas to ground the layout.

### The "Glass & Gradient" Rule
To prevent the design from feeling "flat" or "dated-country," use Glassmorphism for floating navigation bars or overlay modals. 
*   **Formula:** `surface` color at 80% opacity + `backdrop-blur: 12px`.
*   **Signature Textures:** Apply a subtle linear gradient to Hero CTAs transitioning from `primary` to `primary_container` at a 135-degree angle. This adds "soul" and a sun-drenched glow that flat hex codes lack.

## 3. Typography
The typographic pairing is a conversation between heritage and clarity.

*   **Display & Headlines (Noto Serif):** This is our "Editorial Voice." Large scales (`display-lg` at 3.5rem) should be used with generous leading. Headlines should feel authoritative yet warm. Use `on_surface` (`#1c1c18`) for maximum readability.
*   **Body & Titles (Plus Jakarta Sans):** A clean, contemporary sans-serif that ensures the "Rustic" vibe doesn't become "Old-Fashioned." It provides the "Trustworthy" technical balance.
*   **Hierarchy Note:** Use `title-md` for sub-headers but set them in `secondary` (`#47664b`) to maintain the earthy tone throughout the copy.

## 4. Elevation & Depth
We define "up" and "down" through light and tone, never through heavy dropshadows.

*   **The Layering Principle:** Depth is achieved by stacking. A `surface-container-lowest` card sitting on a `surface-container` section creates a natural lift.
*   **Ambient Shadows:** If a floating element (like a FAB) requires a shadow, use the `on_surface` color at 6% opacity with a blur of `32px`. It should feel like a soft glow of ambient light, not a hard shadow.
*   **The Ghost Border Fallback:** If a UI element (like a search input) risks disappearing, use the `outline_variant` (`#d4c4ac`) at **15% opacity**. This creates a "suggestion" of a boundary. 100% opaque borders are strictly forbidden.

## 5. Components

### Buttons & CTAs
*   **Primary:** Roundedness `full`. Background `primary`. No border. Text `on_primary`.
*   **Secondary:** Roundedness `full`. Background `secondary_container`. Text `on_secondary_container`.
*   **Interaction:** On hover, shift background to the `_fixed_dim` variant of the color.

### Cards & Collections
*   **Card Style:** No borders. Background `surface_container_lowest`. Corner radius `lg` (`1rem`). 
*   **The "No-Divider" Rule:** In lists, never use a horizontal line. Use `spacing.4` of white space or an alternating `surface-container-low` background to distinguish items.

### Inputs & Forms
*   **Fields:** Use `surface_container_low` as the fill. Corner radius `md` (`0.75rem`).
*   **States:** On focus, the "Ghost Border" becomes 100% opaque `primary`.

### Specialized Components: "The Harvest Badge"
For product origins or "organic" certifications, use a custom Chip:
*   **Style:** `tertiary_fixed` background with `on_tertiary_fixed_variant` text. 
*   **Shape:** `rounded-full`.
*   **Usage:** Overlap the top-right corner of product images to break the "square box" feel.

## 6. Do’s and Don’ts

### Do:
*   **Do** use asymmetrical margins. If the left margin is `spacing.10`, try a right margin of `spacing.16` for editorial layouts.
*   **Do** lean into `surface_variant` for subtle background textures or "paper-like" feels.
*   **Do** use `notoSerif` for large pull-quotes to build brand authority.

### Don’t:
*   **Don’t** use pure black (`#000000`). Always use `on_surface` (`#1c1c18`) to keep the "warmth."
*   **Don’t** use standard `0.5rem` spacing for everything. Use the larger scale (`spacing.12+`) to create a "High-End" luxury feel.
*   **Don’t** use 1px dividers. If you feel the need to separate, use a background color shift or more empty space.