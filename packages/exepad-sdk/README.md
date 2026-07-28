# @exepad/sdk

The browser SDK for Exepad's runtime. It is the public surface consumed by the
agent-generated **Code Focus** TSX components that render inside the runtime
client. Components written by the agent import everything they need —
platform hooks, UI primitives, animation helpers — from `@exepad/sdk`, and the
SDK is loaded as a single ES module via the runtime's import map.

## What it provides

The full set of public exports lives in [`src/index.ts`](./src/index.ts). The
main groups are:

### Platform hooks

- **`useModel`** — read/write a backend model (auto-CRUD over RPC).
- **`useHandler`** — invoke a backend custom handler.
- **`useApp`** — access app config and metadata (`AppState`).
- **`useAppState`** — read/write shared runtime state.
- **`useArrayState`** — array helpers over a shared-state key.
- **`useCount`** — count records for a model.
- **`useCurrentUser`** — the signed-in user (`CurrentUser`).
- **`useNavigation`** / **`navigate`** — programmatic routing.
- **`useTheme`** — theme tokens.
- **`useFakeStream`**, **`useBodyScrollLock`** — runtime UX helpers.

### Files

- **`useFileUpload`**, **`useFileUrl`**, plus `extractAppIdFromUrl` and
  `buildFileUrl`.

### UI components (Radix + shadcn/ui pattern)

Re-exported from `src/ui/*`: form controls (`Button`, `Input`, `Select`,
`Checkbox`, `Form`, `Field`, …), layout (`Card`, `Tabs`, `Accordion`,
`Resizable*`, …), display (`Alert`, `Progress`, `Avatar`, `Skeleton`,
**`ExepadImage`**, …), overlays (`Dialog`, `Sheet`, `Drawer`, `Popover`,
`Tooltip`, …), menus & navigation (`DropdownMenu`, `NavigationMenu`,
`Breadcrumb`, `Pagination`, `Command`, …), data display (`Table`, `Calendar`,
`Carousel`, chart helpers), `Sidebar`, and the `Toaster`.

### Visuals & animation

- **`motion`** / **`Motion`** and a motion kit (`FadeIn`, `SlideUp`, `Reveal`,
  `StaggerGrid`, `AnimatedCounter`, `Marquee`, `AnimatedGradient`,
  `AnimatePresence`).
- Decorative SVG backgrounds (`NoiseBg`, `MeshGradient`, `GridPattern`,
  `DotPattern`).
- `Charts`, `Icons`, and `Map` / `MapLink` (OpenStreetMap iframe).

### Game helpers (`src/game/*`)

Pure-browser arcade utilities with no platform dependencies: `clamp`, `lerp`,
`seededRandom`, `aabb`, `useGameLoop`, `useKeys`, `useAudio`, `Sprite`, and
`Joystick`.

### Helpers

- **`toast`** — notifications (via `sonner`).
- `cn` (class merge), `escapeHtml`, `downloadFile`, `downloadCsv`,
  `SDK_VERSION`.
- `Link` and `LightDOMContainer` for Code Focus rendering in the light DOM.
- Utilities: `format`, `_` (lodash-es), `z` (zod), `useForm`, `Controller`.

> Only the exports listed in [`src/index.ts`](./src/index.ts) are public. That
> file is the source of truth — this list is a summary.

## React on `window`

The SDK does **not** bundle its own copy of React. At build time, all `react`
and `react-dom` imports are rewritten to read from `window.React` /
`window.ReactDOM` (see [`vite.config.ts`](./vite.config.ts)). This guarantees
the SDK shares a single React instance with the host runtime and avoids the
"multiple React instances" problem.

The runtime client exposes React on `window` from
`apps/runtime/client/src/expose-react.ts`, which `index.html` loads as a module
**before** the SDK. If `window.React` is missing, the SDK logs an error at load
time.

## Build

```bash
# From the repo root (Turborepo)
pnpm build:sdk            # turbo run build --filter=@exepad/sdk

# Or directly in this package
pnpm build                # tsc -b && vite build
```

Everything lands in the runtime app's public assets:

```
apps/runtime/client/public/runtime_assets/dist/
```

`emptyOutDir` is disabled so the build does not delete sibling files there.
Output is minified with Terser (multiple passes), since these files are loaded by
every generated app.

The build has two stages:

1. **Monolith** (`vite build`) — one ESM artifact named `exepad-sdk`, the
   import-map target that carries the whole public surface.
2. **Split entries** (`build-split.mjs`) — an *additive* set of stable-named
   chunks built by a separate isolated Rollup pass each:
   `exepad-sdk-core.js`, `-charts.js`, `-motion.js`, `-forms.js`, `-overlays.js`,
   `-icons.js`. One pass per entry is deliberate: Vite's lib mode ignores
   `manualChunks`, and a single multi-entry pass leaks recharts/framer into the
   core chunk. Isolating the passes makes that impossible by construction, at
   the cost of duplicating shared Radix/`cn` code across chunks. The monolith is
   never touched by this stage.

A `postbuild` step regenerates the SDK manifest, the agent docs, and the agent
gate, and checks the split chunks (`scripts/generate-manifest.js`,
`scripts/generate-agent-docs.ts`, `scripts/check-split-chunks.mjs`,
`scripts/sync-agent-gate.ts`).
