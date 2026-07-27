# App Type Guide: Custom

<!-- Schema Version: 2.1.0 | Last Updated: 2026-04-04 -->

You are planning a **CUSTOM** app — a specialized application with unique requirements that doesn't fit neatly into website, form, or data app categories.

All UI is built using **Code Components** (CodeComponentProps).

---

## Architecture

- **Navigation:** Choose `HeaderMenuTop` for content-focused apps, `SidebarMenuLeft` for tool/dashboard apps
- **Pages:** Define pages based on the app's domain logic
- **Footer:** Optional — include if the app has informational pages, omit for tool-focused apps
- **Backend:** Depends on requirements — `"none"` for client-only apps, `"dynamic"` for data-driven features

---

## Platform Capabilities & Limits (read before planning a game/visualizer)

The runtime renders **Canvas 2D + DOM**, plus **real WebGL 3D via Three.js**.
Plan within this envelope:

- ✅ **Supported:** HTML5 Canvas 2D (`getContext('2d')`), SVG, CSS/DOM animation, the Web Audio API, `requestAnimationFrame` game loops, keyboard/pointer/touch input (incl. pointer lock).
- ✅ **Real 3D / WebGL IS supported** via **Three.js**, imported as the extension package **`@exepad/ext-three`** (and `@exepad/ext-pixi` for Pixi.js 2D-WebGL). The runtime resolves these through its import map and the build admits these exact specifiers. First-person shooters (Counter-Strike / Doom / Quake style), 3D arenas, walkers, and 3D model viewers are all in scope. For a 3D game, the ComponentBuilder is handed a complete, working Three.js FPS recipe automatically — plan ONE fullscreen game component (role `content`, backend `none`).
- ❌ **Still NOT supported:** WebGPU; **real-time networked multiplayer** (no server/sockets — single-player or local hotseat only); native/installed apps; npm packages other than `@exepad/sdk` and the vetted `@exepad/ext-*` extensions; **Three.js addons/subpaths** (`OrbitControls`, `GLTFLoader`, `.../examples/jsm/...` — the runtime ships the Three.js *core* only, so controls/loaders must be hand-rolled or geometry built procedurally).
- **If the user asks for "3D" (a 3D shooter, 3D scene, WebGL game):** plan it as a real 3D component using `@exepad/ext-three`. Do NOT downgrade it to 2D, and do NOT emit a bare `import ... from "three"` (only `@exepad/ext-three` resolves). For a competitive online match, build the single-player equivalent and state that networked multiplayer isn't available.

---

## Common Custom App Categories

| Category | Navigation | Pages | Backend |
|----------|-----------|-------|---------|
| Arcade/action games | HeaderMenuTop or none | 1-2 (game + menu) | none |
| Board/puzzle games | HeaderMenuTop or none | 1-2 (game + settings) | none |
| Simulation/strategy games | HeaderMenuTop | 2-4 (game + shop + stats) | none or dynamic (save) |
| Calculators/tools | HeaderMenuTop | 1-3 (tool + results + about) | none or static |
| Visualizers | HeaderMenuTop | 1-2 (main + settings) | none |
| Educational/learning | SidebarMenuLeft | 3-6 (lessons/modules) | dynamic (progress tracking) |
| Portfolio builders | HeaderMenuTop | 3-5 (showcase pages) | none or dynamic |

---

## Game Quality Requirements

### Arcade/Action Games (Canvas-based)
- SVG sprites for game entities — ship, enemies, projectiles, power-ups — with gradient fills, glow filters, and detail
- Particle effects for explosions, thrust trails, and ambient atmosphere
- Background star fields, nebulae, or environment layers (not flat color)
- Motion trails for fast-moving objects
- Screen shake on impacts and collisions
- Minimum entity sizes: ships 36-48px, projectiles 6-8px with glow trail
- Frame-rate independent physics, safe array iteration, respawn invincibility
- Fullscreen canvas (h-screen), defaultTheme matching visual design
- **Keyboard input must not fight the page.** A hand-rolled `keydown`
  handler MUST call `e.preventDefault()` for the game's control keys —
  **Space AND the Arrow keys** (and `ArrowUp`/`ArrowDown` especially) —
  or pressing them scrolls the page mid-play. Preferred: use the SDK
  `useKeys` helper, which already suppresses default scrolling. Listen on
  `window` and clean up the listener in the effect's return.
- **Randomness:** `Math.random()` is fine **inside the game loop / level
  setup** (spawn positions, particle jitter, procedural layout) — it is
  not React-render data, so the build allows it for canvas games. For a
  reproducible run, prefer `seededRandom(seed)` from `@exepad/sdk/core`
  (seed with a fresh value like `Date.now()` for per-play variety, or a
  fixed seed for a deterministic level).

### Board/Puzzle Games (DOM-based)
- Clear visual states for cells/tiles: empty, occupied, selected (ring), valid-move (tinted), hover
- Pieces/tiles large enough to read and tap (min 40px touch targets)
- Smooth animations (200-300ms) for moves, flips, and state transitions
- Celebration animation on win (confetti, scale bounce)
- Timer and score displays with clear formatting

### Simulation/Strategy Games (tick-based)
- Resource bars with icons, counts, and production rate indicators (+N/s)
- Grid placement with hover preview and valid/invalid cell highlighting
- Upgrade items with visual lock/unlock states and cost display
- Floating popup animations for resource changes
- Progress bars for build timers and milestones

---

## Content Depth Requirements

| Complexity | Min Pages | Required Content |
|-----------|-----------|-----------------|
| Simple tool | 1-2 | Main interactive area + optional help/about |
| Medium app | 3-4 | Core functionality + settings + supporting pages |
| Complex app | 5-8 | Multi-feature with distinct sections |

---

## Component Approach

Every page section and interactive element is a `CodeComponentProps` code component rendered in Light DOM with compiled Tailwind CSS.

See `05_CODE_COMPONENTS.md` for the SDK reference. For game patterns, see the `game-arcade`, `game-board`, or `game-simulation` skills.

---

## Things to Avoid

- **Forcing website patterns** on tool/game apps (hero sections, testimonials)
- **Over-engineering navigation** for simple 1-2 page apps
- **Adding unnecessary backend** when the app is purely client-side
- **Marketing copy** on functional tool pages — keep UI focused on the core experience
