# 6. Design System

## `design_system.design_style`
6-12 short bullets (each as its own string). These are the PRIMARY visual identity — downstream agents follow them closely.

CRITICAL: You MUST produce a DISTINCTIVE design for each app. The following phrases are BANNED — using them causes all apps to look identical:
- "Professional and data-dense" / "Clean and modern" / "Professional and functional"
- "Dark sidebar and light content area" (this is the default — describe something different)
- "Subtle borders" / "Rounded corners with 8px radius" / "Consistent 24px padding"
These are non-descriptions that every app defaults to. Instead, be SPECIFIC and CREATIVE:

GOOD examples of unique design_style bullets:
- "Warm terracotta sidebar with cream content area and handwritten-feel accent elements"
- "Brutalist layout with sharp 0px corners, heavy black borders, and oversized typography"
- "Soft pastel cards with large 24px rounded corners, no shadows, gentle gradient backgrounds"
- "Dense dark-mode interface with neon accent highlights and monospace typography throughout"
- "Editorial magazine layout with serif headlines, generous whitespace, and thin 1px gold dividers"
- "Retro computing aesthetic with pixelated borders, console green accents, and terminal-style fonts"

Each bullet should describe ONE specific visual decision:
- Overall mood and metaphor (what real-world object or era does this design evoke?)
- Color temperature and atmosphere (warm, cool, neutral, vibrant, muted)
- Border and edge treatment (sharp, rounded, pill-shaped, none, thick, thin)
- Shadow and depth approach (flat, elevated, inset, layered, dramatic)
- Spacing personality (compact and dense, or generous and airy)
- Sidebar/navigation appearance (colored, light, dark, transparent, gradient)
- Typography character (bold, delicate, monospace, serif, playful)
Plain English; no quotes. These guidelines are used by the theme builder and component builder agents.

## Colors & Fonts
- Choose colors that match the domain and emotional tone:
  - Warm earth tones (terracotta, olive, amber) for food, agriculture, hospitality
  - Jewel tones (emerald, sapphire, burgundy) for luxury, fashion, premium services
  - Pastels (lavender, mint, peach) for healthcare, wellness, children
  - Vivid warm primaries (coral, tangerine, crimson) for education, entertainment,startups
  - Muted naturals (sage, clay, charcoal) for finance, legal, architecture
  - Bold contrasts (black + neon accent) for tech, gaming, creative agencies
- The surface color should have personality — use warm cream, cool mint, rose tint, sand, slate, or dark backgrounds. Pure white is lazy.
- Ensure sufficient contrast between primary, surface, and text colors
- Remember that semantic foreground tokens are palette-derived. A valid theme can use a light primary with dark `on-primary`, or a dark primary with light `on-primary`.
- When describing color intent, prefer pair-based language such as "soft sky primary with deep ink foreground" instead of assuming white text on every brand color.

## Font Guidelines
- Use Google Fonts only
- Pick fonts that match the brand personality — playful, corporate, editorial, technical, luxury, minimalist, etc.
- Avoid defaulting to Manrope/Inter or Space Grotesk/Inter for every app — explore the full range of Google Fonts
- Examples of distinctive pairings: Fraunces + Nunito, Bricolage Grotesque + Karla, Libre Baskerville + Albert Sans, Instrument Serif + Figtree, Outfit + Lora
- IMPORTANT: Only use fonts that exist on Google Fonts (fonts.google.com). Do NOT use fonts from other foundries (Fontshare, commercial fonts, etc.)
- Pair fonts with good contrast (geometric + humanist, serif + sans-serif, slab + grotesque, etc.)
- For dashboards consider monospace-influenced or geometric fonts. For marketing sites consider serif or display fonts. For medical apps consider clean humanist sans-serifs. Each app should feel unique.

## Icon System
All components use **Lucide icons**. Reference icons by PascalCase name in building plans (e.g. `ArrowRight`, `LayoutDashboard`, `ShoppingCart`, `Home`, `Menu`). Do NOT reference Material Symbols.
