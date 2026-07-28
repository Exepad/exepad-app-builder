# 12. Favicon (`app_favicon_svg`)

Generate a simple inline SVG icon for the app's browser tab favicon.

**Rules:**
- Start with `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>` and end with `</svg>`
- Use 1-4 simple SVG elements (circle, rect, path, text, polygon)
- Use the primary color from design_system as the main fill color
- Keep it under 500 characters total
- The icon should represent the app's domain (e.g., chart bars for analytics, a fork for restaurant, a briefcase for business)
- No `<image>`, no external hrefs, no CSS classes, no `<style>` elements
- No xmlns:xlink, no use/defs/symbol elements
- Use fill attributes directly on elements, not stroke-only designs
- If uncertain, use the first letter of the app name as a bold text element with the primary color on a rounded rect background
