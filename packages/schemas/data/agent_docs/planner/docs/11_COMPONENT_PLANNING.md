# 7. Component Planning

## Navigation Component
- **HeaderMenuTop**: Name it "MainHeader", role "header"
- **SidebarMenuLeft**: Name it "MainSidebar", role "sidebar"
- Building plan should describe: logo placement, navigation links (matching page slugs), responsive behavior, active state styling
- Navigation is optional for form apps (see Form App Rules below)

### Link Consistency Rule (CRITICAL)
Every internal link in the app — navigation items, footer links, CTA buttons, hero buttons, inline links — MUST point to a page that exists in `component_plans`. If any component references a slug (e.g., /pricing, /contact, /privacy), a content component with that `page_slug` MUST exist. Do NOT plan links to pages that do not exist.

## Footer Component (websites and forms only)
- Name it "MainFooter", role "footer"
- Building plan: branding, navigation links, contact info, copyright, social links
- Omit for dataapps/dashboards

## Content Components (one per page)
- Name using PascalCase: combine page purpose + "Content" (e.g., "HomeContent", "AboutContent", "DashboardContent")
- Set role to "content"
- Set page_slug to the page's URL path (e.g., "/", "/about", "/dashboard")
- Set page_title to a human-readable title
- Set page_summary to 3-5 sentences describing what the page does and its key content
- Set page_short_summary to exactly one sentence summarizing the page
- Building plan should have **4-8 bullet points** describing:
  - Page sections and their layout (hero, features grid, stats bar, etc.)
  - Content specifics (what text, data, or media to show)
  - Visual style notes (card layouts, spacing, color usage)
  - Interactive elements if any (forms, charts, toggles)
- List all interactive elements in the interactive_elements field
- Set content_keywords from: crud, table, data-table, form, modal, chart, graph,
  visualization, analytics, game, canvas, interactive, map, location, dashboard,
  kpi, metrics. Leave empty for generic content (hero, about, footer, header).
- Set complexity_level: "basic" for static/presentational, "intermediate" for
  interactive elements, "complex" for charts/CRUD/games/real-time.

## Building Plan Quality

Each component's building plan (saved via `save_plan_artifact` and
referenced from `building_plan_artifact`) should be:
- **Specific**: describe exact sections, not vague placeholders
- **Actionable**: the builder agent should know exactly what to create
- **Self-contained**: each component is built independently by a separate agent
- **Visual**: mention layout patterns (grid, flex, cards), spacing, and visual hierarchy

Example building plan bullets (website — each example shows a DIFFERENT style):

Example A — editorial/magazine style:
- "Full-bleed hero image with overlaid text in a narrow column, no buttons — just a bold statement and scroll-down indicator."
- "Two-column feature section: large image on left, stacked text cards on right. Asymmetric layout with generous whitespace."
- "Single testimonial spotlight: full-width quote with oversized quotation marks, author photo as a circular crop."

Example B — playful/interactive style:
- "Animated hero with floating illustration elements that respond to scroll. Primary CTA is a large pill-shaped button with hover animation."
- "Icon grid with 6 features in a 3x2 bento layout — two large tiles and four small tiles. No cards — flat colored backgrounds."
- "FAQ as an accordion with playful expand/collapse animations. No separate CTA — the FAQ includes inline conversion prompts."

Example building plan bullets (dashboard — each example shows a DIFFERENT layout):

Example A — bento grid:
- "Bento-style grid with 1 large chart tile spanning 2 columns, 3 compact metric pills, and 1 medium activity feed tile. No traditional card borders — use background tints."

Example B — chart-first:
- "Full-width hero area chart showing the primary KPI trend. Below: a split panel with summary stats on left and recent records on right."

Example C — feed-style:
- "Chronological activity feed as the main content, with a compact sidebar showing key metrics as a vertical stack of labeled values."

Example building plan bullets (game/interactive — each example shows a DIFFERENT genre):

Example A — arcade action (Canvas + SVG sprites):
- "Full-canvas game area (h-screen) with parallax star field background (3 depth layers)"
- "SVG sprite for ship: 48px triangular craft with radial gradient fill and cyan glow filter"
- "SVG sprites for asteroids: 3 size variants (40px, 60px, 80px) as irregular polygons with gradient fill and rocky texture"
- "Particle explosion bursts (15-25 particles, additive blending) on asteroid destruction"
- "Projectiles as SVG bolts with 16px motion trails. Screen shake on ship collision"
- "Respawn invincibility: 2s blinking after losing a life to prevent chain deaths"
- "HUD: glowing score counter top-left, ship-icon lives top-right, high score tracking"

Example B — board/puzzle (DOM-based):
- "8x8 grid board rendered with CSS Grid, each cell 48-64px with clear selected/valid-move visual states"
- "Pieces as large Unicode characters or SVG icons with drop-shadow for depth"
- "Click-to-select highlighting with primary ring outline and valid move indicators as tinted cells"
- "Move animation using Motion.div with spring transitions, shake on invalid move"
- "Turn indicator and captured pieces display in sidebar panel"

Example C — simulation/idle (tick-based):
- "Resource bar at top showing gold, wood, food with production rates (+5/s) and icon badges"
- "Grid-based placement area (CSS Grid) with hover preview of buildings and valid/invalid cell highlighting"
- "Upgrade panel with tiered items, exponential cost scaling, and visual lock/unlock states"
- "Auto-generator system with per-second income displayed on each building"
- "Floating +N popups (Motion.div) on resource gain, progress bars for build timers"
