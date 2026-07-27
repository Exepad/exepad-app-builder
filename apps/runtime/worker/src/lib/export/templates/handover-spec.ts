/**
 * Static reference content for the coding-agent handover kit. Written once and
 * versioned with the SDK — NOT per-app. The per-app `MANIFEST` (generated in
 * handover.ts) tells the agent exactly which of these primitives/models/pages
 * the specific app uses.
 */

export const SDK_PRIMITIVES_MD = `# SDK primitive reference — \`@exepad/sdk\` → idiomatic replacements

The generated components import from \`@exepad/sdk/*\`. That SDK is a thin
re-export of standard npm libraries plus a small platform bridge. To integrate
into a vanilla stack, replace each import with the underlying library and replace
the ~6 platform primitives with your stack's equivalents. The per-app
\`MANIFEST.json\` lists exactly which of these THIS app uses — you only need those.

## Pure re-exports (swap the import, keep the usage)

| \`@exepad/sdk\` import | Real package | Notes |
|---|---|---|
| \`Icons\` (from \`@exepad/sdk/icons\`) | \`lucide-react\` | \`Icons.Foo\` → \`import { Foo } from 'lucide-react'\`. Same prop API. |
| \`motion\` (from \`@exepad/sdk/motion\`) | \`framer-motion\` | \`import { motion } from 'framer-motion'\`. Identical. |
| \`Charts\` (from \`@exepad/sdk/charts\`) | \`recharts\` | \`Charts.X\` maps to recharts \`X\` (LineChart, Bar, …). |
| \`Calendar\` (from \`@exepad/sdk/forms\`) | \`react-day-picker\` | Plus your date lib. |
| \`z\` (core) | \`zod\` | \`import { z } from 'zod'\`. |
| \`useForm\`, \`Controller\` (core) | \`react-hook-form\` | Identical. \`@hookform/resolvers\` for zod. |
| \`format\` (core) | \`date-fns\` | \`import { format } from 'date-fns'\`. |
| \`_\` (core) | \`lodash-es\` | \`import _ from 'lodash-es'\` (or per-fn imports for tree-shaking). |
| \`Toaster\` (core) | \`sonner\` | \`import { Toaster } from 'sonner'\`. Mount once at app root. |
| \`React\`, \`ReactDOM\` (core) | \`react\`, \`react-dom\` | Use your project's React. |

## House components (reimplement — small)

| Primitive | What it is | Replacement |
|---|---|---|
| \`LightDOMContainer\` | A wrapper that hosts content in the light DOM under \`@layer exepad-app\` scoping. | A plain \`<div>\`. In a standalone app the whole page is yours, so the wrapper can be dropped or kept as a styling container. |
| \`ExepadImage\` | Resolved stock/asset image with a skeleton fallback. \`src\` is build-time-injected (absolute stock URL or \`assets/imports/*.webp\` relpath). | \`<img>\` (or your framework's \`<Image>\`). Use the resolved \`src\`. Copy any \`assets/imports/*\` files into your public dir and rewrite the relpaths. |
| \`Link\` | App-internal navigation that prepends the base path and routes via the platform. | Your router's \`<Link>\` (e.g. \`next/link\`, \`react-router\` \`Link\`). |
| \`NoiseBg\`, \`MeshGradient\`, \`GridPattern\`, \`DotPattern\` (core) | Decorative SVG/canvas backgrounds. | Keep as-is if you vendor them, or replace with your own. Self-contained. |

## Platform hooks (replace with your state/data/router)

These are the only genuinely Exepad-specific pieces. Each has a documented behavior:

| Hook | Behavior | Replacement |
|---|---|---|
| \`useApp(selector?)\` | Reads/writes the app's shared state object (seeded from \`frontend.logic.state\`). \`useApp(s => s.x)\` selects; \`useApp().setState(key, val)\` writes. | Any state store: \`useState\`/\`useReducer\` for simple apps, or Zustand/Redux seeded from \`frontend.logic.state\` (see MANIFEST → \`state\`). |
| \`useAppState(key, initial)\` / \`useArrayState(key, initial)\` | Single-key state with array helpers; optional \`$persist\` to localStorage. | A keyed store slice; persist with \`localStorage\` if the key was \`$persist\`. |
| \`useModel(name, opts?)\` | Auto-CRUD over a backend model: returns \`{ data, loading, error, totalCount, refetch, create, update, remove }\`. | Your data layer (TanStack Query + REST/GraphQL, or an ORM). Model schemas are in MANIFEST → \`models\`. See \`data-contract.md\` for the RPC shape. |
| \`useHandler(name, opts?)\` | Calls a server-side handler: returns \`{ data, loading, error, execute, refetch }\`. | A POST to your backend endpoint for that handler. Handler list + I/O in MANIFEST → \`handlers\` and \`data-contract.md\`. |
| \`useCurrentUser()\` | \`{ id, email, name, roles, isAuthenticated }\`. | Your auth/session. Returns anonymous when unauthenticated. |
| \`useNavigation()\` / \`navigate(path)\` | \`{ navigate, currentPath, currentSlug, basePath }\`. | Your router (\`useRouter\`/\`useNavigate\`). Map \`currentSlug\` to the active page. |
| \`useTheme()\` | Reads resolved theme tokens. | Your theme system; tokens are in MANIFEST → \`theme\` and \`theme.md\`. |
| \`toast(...)\` | Fires a toast (dispatches a window event the \`Toaster\` listens for). | \`sonner\`'s \`toast()\` directly. |

> Tip: a fast path is to provide a tiny shim that re-exports the real libs and
> implements the ~6 platform hooks against your stack, so the component bodies
> barely change. But for a clean integration, replace imports inline per the
> tables above.
`;

export const DATA_CONTRACT_MD = `# Backend data contract

The app's backend is Exepad's auto-CRUD + custom handlers over a per-app
database, reached by the platform via RPC. To run the app's data features in
your stack you either (a) point at the deployed Exepad backend, or (b) reimplement
these endpoints against your own DB.

## Models (auto-CRUD)

Each model in MANIFEST → \`models\` is a table with fields. The platform exposes
CRUD via a single RPC endpoint:

\`\`\`
POST /rpc
{ "method": "sys_create" | "sys_read" | "sys_list" | "sys_update" | "sys_delete",
  "model": "<name>",
  "params": { "data": {...} | "id": <id> | filters/pagination } }
\`\`\`

(\`model\` is a TOP-LEVEL field of the request, not nested inside \`params\`.)

\`useModel('x')\` maps to: \`sys_list\` (initial \`data\`), \`create\`→\`sys_create\`,
\`update\`→\`sys_update\`, \`remove\`→\`sys_delete\`. Data is scoped per user via
\`owner_id\`. To reimplement: a REST resource per model (\`GET/POST/PATCH/DELETE
/api/<model>\`) backed by your DB, honoring an owner/tenant column.

## Handlers (custom server logic)

Each handler in MANIFEST → \`handlers\` is a server-side function. \`useHandler('x')\`
calls it with params and returns the result. The original handler source is
included under \`code/backend/handlers/<x>.tsx\` — read it to see the I/O shape and
reimplement it as one endpoint (\`POST /api/handler/<x>\`).

## Auth

Requests carry identity headers: \`X-User-Id\`, \`X-User-Email\`, \`X-User-Roles\`.
\`useCurrentUser()\` reflects the session. In your stack, wire these to your auth
provider; default to anonymous for public pages.

## Contact forms

Some apps post to \`/_forms/submit\` for a built-in contact form. Replace with your
form endpoint or a service (Formspree, a serverless function, etc.).
`;

export const THEME_MD = `# Theme & styling

The app uses Tailwind CSS v4. Two relevant files:

- \`code/frontend/styles/theme.css\` — the Tailwind v4 source: \`@import "tailwindcss"\`,
  an \`@theme { … }\` block defining design tokens (\`--color-primary\`,
  \`--color-on-surface\`, etc.), and custom utilities. Components use these tokens via
  utility classes (\`text-primary\`, \`bg-surface\`, \`text-on-surface-variant\`, …).
- MANIFEST → \`theme\` lists the resolved tokens and fonts.

## Porting

- **Tailwind v4 target:** drop \`theme.css\` in and let \`@tailwindcss/vite\` (or the
  Tailwind v4 PostCSS plugin) compile it. The \`@theme\` tokens become CSS variables
  and the utilities (\`text-primary\`, …) work directly.
- **Tailwind v3 / config-based:** translate the \`@theme\` tokens into
  \`tailwind.config\` \`theme.extend.colors\` (and fonts), then the same utility class
  names resolve.
- **Non-Tailwind:** read the \`@theme\` tokens as a design-token list and map them to
  your CSS-vars / styling system; the components' className strings will need
  translating.
- **Fonts:** MANIFEST → \`fonts\` are Google Fonts URLs — add them as \`<link>\` tags
  (or your framework's font loader) and \`@font-face\` is global.

## Scoping note

The platform scopes app CSS under \`@layer exepad-app\` to avoid clashing with the
builder shell. In a standalone app the app IS the whole page, so that scoping is
unnecessary — you can drop the \`@layer exepad-app { … }\` wrapper if present.
`;

export const RECIPES: Record<string, string> = {
  'nextjs.md': `# Recipe — Next.js (App Router)

1. \`npx create-next-app@latest\` (TypeScript, Tailwind v4, App Router).
2. Copy \`code/frontend/components/*.tsx\` into \`components/\`. Replace \`@exepad/sdk/*\`
   imports per \`spec/sdk-primitives.md\` (Icons→lucide-react, motion→framer-motion, …).
3. Build routes from \`app_config.json\` \`frontend.pages[]\`: one \`app/<slug>/page.tsx\`
   per page rendering that page's \`content[]\` components; put header/footer in
   \`app/layout.tsx\`.
4. State: seed a store from \`frontend.logic.state\` (or \`useState\` for simple apps);
   wire \`useApp\`/\`useAppState\`.
5. Backend: turn each model into a Route Handler (\`app/api/<model>/route.ts\`) and each
   handler in \`code/backend/handlers/\` into \`app/api/handler/<name>/route.ts\` — co-located,
   so the whole app deploys as one Next app (Vercel/Node/Docker). See \`data-contract.md\`.
6. Theme: drop \`theme.css\` into \`app/globals.css\` (or import it); fonts via \`next/font\`
   or \`<link>\`s. Use Server Components for static pages for best performance.
`,
  'vite.md': `# Recipe — Vite + React (SPA)

1. \`npm create vite@latest -- --template react-ts\`; add \`@tailwindcss/vite\`.
2. Copy components into \`src/components/\`; replace \`@exepad/sdk/*\` imports per
   \`spec/sdk-primitives.md\`.
3. Add \`react-router-dom\`; build routes from \`app_config.json\` \`frontend.pages[].slug\`,
   each rendering the page's \`content[]\` via a small mapper.
4. State via Zustand/useState seeded from \`frontend.logic.state\`.
5. Backend: a Vite SPA has no server — point the data layer at a backend
   (\`VITE_API_BASE\`) or add a small Node/Express server reproducing \`data-contract.md\`.
6. \`theme.css\` imported in \`main.tsx\`; fonts as \`<link>\`s in \`index.html\`.

> NOTE: a deterministic version of this exact target is also available as the
> "buildable source" export, which generates the full Vite project + a vendored
> SDK + the backend for you.
`,
  'remix.md': `# Recipe — Remix

1. \`npx create-remix@latest\`.
2. Copy components; replace \`@exepad/sdk/*\` imports per \`spec/sdk-primitives.md\`.
3. One route per \`frontend.pages[].slug\`; header/footer in \`root.tsx\`.
4. Backend co-located: models → \`loader\`/\`action\` (or \`/api\` resource routes), handlers →
   actions. See \`data-contract.md\`.
5. State with \`useState\`/Zustand seeded from \`frontend.logic.state\`.
6. \`theme.css\` via the Remix CSS link; fonts as \`<link>\`s. Deploys full-stack to
   Node/Fly/Vercel/Docker.
`,
  'astro.md': `# Recipe — Astro

1. \`npm create astro@latest\` + the React integration + Tailwind v4.
2. Copy components into \`src/components/\` as React islands; replace \`@exepad/sdk/*\`
   imports per \`spec/sdk-primitives.md\`. Use \`client:load\`/\`client:visible\` for
   interactive components, static render for the rest (great for marketing sites).
3. One \`src/pages/<slug>.astro\` per \`frontend.pages[]\`; shared header/footer in a layout.
4. Backend: Astro endpoints (\`src/pages/api/*\`) per \`data-contract.md\`, or a separate API.
5. \`theme.css\` in the layout; fonts via Astro font handling. Static or SSR adapters
   (Vercel/Netlify/Node).
`,
  'existing-repo.md': `# Recipe — Drop into an existing codebase

1. Read \`MANIFEST.json\` to see exactly what this app uses (primitives, state,
   models, handlers, pages, theme).
2. Decide what to bring in: whole pages, or individual components. Copy the needed
   \`code/frontend/components/*.tsx\` into your project.
3. Replace \`@exepad/sdk/*\` imports per \`spec/sdk-primitives.md\` with your already-present
   libraries (you likely have lucide-react/framer-motion/etc.).
4. Map the platform hooks to your existing state/data/router/theme systems (you
   probably already have these — just adapt the call sites).
5. Wire backend models/handlers to your existing API per \`data-contract.md\`, or stub
   them if you only want the UI.
6. Reconcile theme tokens: merge \`theme.css\` \`@theme\` tokens into your design system,
   or remap the className strings.
`,
};

export const INTEGRATION_CHECKLIST_MD = `# Integration checklist (verify after integrating)

- [ ] Every \`@exepad/sdk/*\` import has been replaced (grep for \`@exepad/sdk\` → 0 hits).
- [ ] The app builds with no missing-module or type errors.
- [ ] A single React instance (no "invalid hook call" at runtime).
- [ ] Each page in \`app_config.json\` \`frontend.pages[]\` renders at its slug.
- [ ] Header / footer / sidebar render on every page.
- [ ] Shared state (\`frontend.logic.state\`) initializes; \`useApp\`-driven interactions work.
- [ ] For each model: list/create/update/delete round-trips through your backend.
- [ ] For each handler: it executes and returns the expected shape.
- [ ] Forms submit to a real endpoint (not the platform's \`/_forms/submit\`).
- [ ] Theme tokens applied (colors/fonts match the original); no unstyled flash.
- [ ] Images load (resolved stock URLs reachable, or \`assets/imports/*\` copied in).
- [ ] No references to platform-only globals remain (\`window.ExepadState\`,
      \`window.ExepadPlatform\`, \`__EXEPAD_BASE_PATH__\`).
`;

/** The agent-facing orchestration entrypoint. Parameterized with app name + a short summary. */
export function buildAgentsMd(appName: string, manifestSummary: string): string {
  return `# Integrate "${appName}" into this project

You are a coding agent integrating an Exepad-generated app into the user's
codebase / framework of choice. This kit contains the app's source plus a precise
spec so you can translate it cleanly into ANY framework.

## Do this, in order

1. **Read \`MANIFEST.json\`** — it tells you EXACTLY what this app uses (SDK
   primitives, shared state, backend models + fields, handlers, pages/routes,
   theme tokens, fonts). Only translate what's listed.
2. **Confirm the target** with the user if unknown (Next.js / Vite / Remix / Astro /
   existing repo), then read the matching \`spec/recipes/<target>.md\`.
3. **Translate imports** using \`spec/sdk-primitives.md\`: replace every
   \`@exepad/sdk/*\` import with the underlying npm package (lucide-react,
   framer-motion, recharts, react-hook-form, zod, date-fns, lodash-es, sonner) and
   replace the platform hooks (\`useApp\`/\`useModel\`/\`useHandler\`/\`useNavigation\`/
   \`useCurrentUser\`/\`useTheme\`) with the target stack's equivalents.
4. **Assemble pages** from \`app_config.json\` \`frontend.pages[]\` (slug → \`content[]\`
   components) with the \`header\`/\`footer\`/\`sidebar\` arrays as the shell.
5. **Wire the backend** per \`spec/data-contract.md\` (auto-CRUD models + handlers).
   Prefer co-locating it in the chosen framework so the result is one deployable app.
6. **Port the theme** per \`spec/theme.md\` (Tailwind v4 \`@theme\` tokens + fonts).
7. **Verify** against \`INTEGRATION_CHECKLIST.md\`.

## This app at a glance

${manifestSummary}

## Contents

- \`code/\` — the app's source components, handlers, theme, seed (verbatim).
- \`app_config.json\` — structure: pages, routing, state, models, theme.
- \`MANIFEST.json\` / \`MANIFEST.md\` — the per-app inventory (start here).
- \`spec/\` — the reference docs (primitives, data contract, theme, recipes).
- \`INTEGRATION_CHECKLIST.md\` — final verification.

> The components are written for React 18 + Tailwind v4. They are NOT runnable as-is
> (they import \`@exepad/sdk\` which isn't vendored here) — your job is to translate
> them per the spec. For a ready-to-run version, the user can instead use the
> "buildable source" export.
`;
}
