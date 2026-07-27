# Development Guide

This guide covers local setup, development workflows, testing, and conventions for working on the Exepad platform.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | 22 | JavaScript runtime — matches the Dockerfile and CI (only the published `npx exepad` launcher runs on 18+) |
| **pnpm** | 9.15+ | Package manager |
| **Git** | Latest | Version control |
| **Python** | 3.12 | Only for the builder agent (`apps/agent`) — the image pins `python:3.12-slim` |

---

## Local Setup

```bash
# Clone the repository
git clone https://github.com/Exepad/exepad-app-builder.git
cd exepad-app-builder

# Install dependencies
pnpm install

# Start the runtime dev servers
pnpm dev
```

This starts:
- **Runtime SPA** (Vite) on `http://localhost:3001`
- **Runtime worker** (Hono on `@hono/node-server`, `tsx watch`) on
  `http://localhost:8080` and `https://localhost:8443` (self-signed cert)

Vite proxies `/api`, `/auth`, and `/published` to the worker's TLS port, so
day-to-day work happens on `http://localhost:3001` with no cert prompt.

`pnpm dev` does **not** start the Python builder agent. To run the whole
product from source — Node runtime plus the agent — use the wrapper script:

```bash
./run.sh local     # Node runtime (HTTPS :443, plain HTTP :8090) + Python agent on :8081
```

It generates and persists the instance secrets under `.exepad-data/secrets/` on
first run. Put your LLM key in a `.env` next to the script
(`EXEPAD_LLM_API_KEY=…`) or builds will fail.

Or run the shipped container:

```bash
docker compose up --build     # single container — open https://localhost
```

The compose file uses `network_mode: host` and the in-image Caddy terminates TLS
on the host's `:80`/`:443`; the runtime's plain-HTTP `:8080` stays pinned to
loopback behind it (`EXEPAD_HTTP_BIND=127.0.0.1`).

---

## Key Commands

### Development

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the dev servers via Turborepo (SPA :3001 + runtime worker) |
| `pnpm dev:runtime` | Same, scoped to `@exepad/runtime-client` + `@exepad/runtime-worker` |
| `./run.sh local` | Full stack from source, including the Python agent |

### Building

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages (including the bundled Node server) |
| `pnpm build:sdk` | Build SDK → `runtime/client/public/runtime_assets/dist/` |
| `pnpm --filter @exepad/runtime build:worker` | Bundle the runtime worker → `worker/dist/server.mjs` |

### Testing

| Command | Description |
|---------|-------------|
| `pnpm test` | Run all tests (Vitest) |
| `pnpm --filter @exepad/runtime test` | Run runtime unit tests (`apps/runtime/tests`) |
| `pnpm --filter @exepad/app-backend test` | Run app-backend tests |
| `pnpm --filter @exepad/sdk test` | Run SDK tests |

### Type checking

| Command | Description |
|---------|-------------|
| `pnpm --filter @exepad/runtime check` | `tsc --noEmit` across client + worker |
| `pnpm --filter @exepad/app-backend typecheck` | `tsc --noEmit` for the app-backend |

### Schemas & examples

| Command | Description |
|---------|-------------|
| `pnpm gen:schemas:full` | Regenerate `full_schema.json` from `WebAppProps` |
| `pnpm validate:examples` | Validate `packages/schemas/data/examples/` against the schema. Its walker skips the `backend/` subtree and `catalog_*.json`, which is everything that directory currently holds — so this walks 0 files today. |
| `pnpm validate:examples:public` | Validate `apps/runtime/client/public/example/` against the schema. **Currently red** (88 errors): the shipped block fixtures still carry `repo.components` / `repo.methods`, which the generated schema no longer allows. |

---

## Path Aliases

The runtime uses TypeScript path aliases:

| Alias | Maps To |
|-------|---------|
| `@/*` | `client/src/*` |
| `@/components/*` | `client/src/components/*` |
| `@/app_runtime/*` | `client/src/app_runtime/*` |
| `@/interfaces/*` | `client/src/app_runtime/interfaces/*` |
| `@/runtime/*` | `client/src/app_runtime/runtime/*` |

---

## Project Structure Quick Reference

```
apps/runtime/client/src/
├── pages/                  # React Router page components
├── app_runtime/
│   ├── interfaces/         # Type definitions (components, apps, state, backend)
│   └── runtime/
│       ├── components/
│       │   ├── custom/     # Code Component runtime
│       │   └── ui/         # Toast primitives (toast, toaster)
│       └── hooks/          # Runtime data hooks (useModelData, useHandlerData, use-toast)
├── components/             # DynamicRenderer, theme, layout, editable
├── hooks/                  # Custom hooks (useAppStateHooks, useRuntimeStore, useLifecycle, etc.)
├── stores/                 # Zustand stores (appStore, appStateStore)
├── services/               # Core services (config, persistence, websocket, studio stream)
├── lib/                    # Security, auth, utilities
├── context/                # React contexts (edit mode, config update)
└── registry/index.ts       # Component type → React component mapping

apps/runtime/worker/src/
├── index.ts                # Hono app (routes, middleware)
├── server/main.ts          # Node entry point (HTTP/HTTPS listeners, env wiring)
├── routes/                 # gateway/, deploy, orchestrate, auth, admin/, settings, email
└── lib/                    # Meta injector, security headers, net config, secrets

apps/app-backend/src/
├── index.ts                # Entry point + middleware stack
├── rpc/                    # RPC routing + parsing
├── crud/                   # CRUD handlers (create, read, list, update, delete)
├── handlers/               # Custom handler execution + per-app registry
├── auth/                   # Per-app auth (sessions, API keys, password hashing)
├── mcp/                    # MCP Streamable HTTP endpoint
├── tools/                  # Tool discovery + execution (shared by RPC and MCP)
├── file/                   # Upload + serve
├── context/                # Config loading, HandlerContext builder
├── middleware/             # Rate limiting
├── utils/                  # SQL, validation, errors, cursor, constants
└── types/                  # Env bindings

apps/agent/                 # Python AI builder agent (internal :8081)
└── main_agent/             # FastAPI + Google ADK
    ├── agents/             # Planning, building, editing agents
    └── services/           # Config generation, validation, postprocessing

packages/
├── types/                  # Shared types (WebAppProps, ModelProps, etc.)
├── schemas/                # JSON schema validation (Ajv) + agent prompt docs
├── ui-core/                # Shared Tailwind styles
├── exepad-sdk/             # Browser SDK
├── exepad-cli/             # Operator CLI (npm package `exepad`)
├── local-adapters/         # SQLite / filesystem / in-memory shims
└── deploy-utils/           # Schema generation, bundling, deployment
```

---

## Code Conventions

### Naming

| Context | Convention | Example |
|---------|-----------|---------|
| React components | PascalCase | `DynamicRenderer`, `DataTable` |
| Functions/variables | camelCase | `evaluateExpression`, `handleClick` |
| Component props interfaces | PascalCase + "Props" suffix | `ButtonProps`, `DataTableProps` |
| Component type identifiers | PascalCase + "Props" suffix | `"componentType": "ButtonProps"` |
| Files | PascalCase for components, camelCase for utilities | `Button.tsx`, `service-call.ts` |
| Database models | snake_case | `books`, `loan_records` |
| Database columns | snake_case | `owner_id`, `created_at` |

### TypeScript

- Strict mode everywhere
- Zod for runtime validation, TypeScript for compile-time safety
- Workspace dependencies use `workspace:*` protocol

### Styling

- Radix UI as unstyled base + Tailwind for styling (shadcn/ui pattern)
- All component styling via Tailwind CSS utility classes
- Theme tokens mapped to CSS custom properties

---

## Adding a Component the Agent Can Use

There is no JSON component registry any more. `client/src/registry/index.ts`
holds a single entry — `CodeComponentProps` — and every page is rendered from
agent-emitted **Code Focus TSX** loaded via dynamic `import()`. Making a new
building block available to the agent therefore means adding it to the **browser
SDK**, which is the import surface generated components are allowed to use.

### 1. Implement and export it

Add the component under `packages/exepad-sdk/src/` and export it from
`packages/exepad-sdk/src/index.ts` under the appropriate category comment — the
comments (`// --- UI: Form Controls ---` etc.) are parsed, so put it in the
right group:

```typescript
// packages/exepad-sdk/src/index.ts
// --- UI: Layout ---
export { MyPanel } from './ui/my-panel';
export type { MyPanelProps } from './ui/my-panel';
```

### 2. Regenerate the agent-facing catalog

The SDK's export list is the agent's contract. Rebuilding the SDK regenerates
both the machine-readable catalog and the prompt doc:

```bash
pnpm build:sdk
# → packages/exepad-sdk/dist/sdk-exports.json
# → packages/schemas/data/agent_docs/05_CODE_COMPONENTS.md
```

(`pnpm --filter @exepad/sdk generate:agent-docs` runs just the generator.)

### 3. Check the validator rules

Generated components are checked at save time against the rule catalog in
`apps/agent/docs/validation/rules.md`. If the new export needs a usage
constraint — required props, forbidden nesting — add the rule there rather than
relying on the prompt alone.

---

## Custom Backend Handlers

To add a custom handler that the AI builder agent can wire up:

### 1. Write the Handler

Create a `.tsx` file in the app's `repo/backend/handlers/` directory:

```typescript
// repo/backend/handlers/getDashboardStats.tsx
interface HandlerContext {
  db: any;
  user: { id: string; email: string; roles: string[] };
  params: Record<string, unknown>;
  log: { info: (msg: string, data?: any) => void };
  models: Record<string, any>;
}

export default async function getDashboardStats(ctx: HandlerContext) {
  const { db, user, log } = ctx;
  log.info('Getting dashboard stats');

  const books = await db.prepare(
    'SELECT COUNT(*) as total FROM books WHERE owner_id = ?'
  ).bind(user.id).first();

  return { totalBooks: books?.total || 0 };
}
```

### 2. Add to Config

Add the handler definition to `backend.handlers` in the app config:

```json
{
  "uuid": "handler-001",
  "name": "getDashboardStats",
  "summary": "Dashboard statistics",
  "authLevel": "authenticated",
  "handlerType": "read",
  "inputs": [],
  "outputs": [
    { "name": "totalBooks", "type": "number" }
  ],
  "method": "getDashboardStats"
}
```

### 3. Compile

There is no standalone compile command — TSX→JS compilation happens inside the
deploy pipeline. `worker/src/server/materialize-build.ts` esbuild-compiles each
handler's `.tsx` source and stores the result; the deploy step then writes the
modules under `{appId}/{mode}/modules/handlers/`, lists them in
`worker-manifest.json`, and the app-backend resolves them per app+mode at first
call — there is no checked-in registry file to update.

**Important:** Custom handler INSERTs must include system columns (`owner_id`, `created_at`, `updated_at`).

---

## Testing

### Unit Tests (Vitest)

```bash
pnpm test                              # All tests
pnpm --filter @exepad/runtime test     # Runtime only (suites in apps/runtime/tests)
```

Tests are located alongside source files or in `tests/` directories.

### App Backend Tests

```bash
pnpm --filter @exepad/app-backend test
```

App backend tests verify CRUD operations, handlers, MCP, auth, rate limiting, and file operations.

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| ESLint/TS errors in build | Currently suppressed in places (TODO: enforce strict builds) |
| Port 3001 in use | Kill the existing Vite dev server or change the port in `client/package.json` |
| Browser warns about the dev certificate | The worker serves a self-signed cert; use `http://localhost:3001` (Vite proxies for you) or run `./run.sh trust` |
| App data looks stale or corrupt | Each app+mode is one SQLite file under the data dir (`/data/apps/…` in the container, `.exepad-data/apps/…` for `./run.sh local`) — delete it and redeploy |
| Builds fail with no LLM key | Set `EXEPAD_LLM_API_KEY` in `.env` before starting the agent |

---

## Related Documents

- [Architecture](02-architecture.md) — System design and monorepo structure
- [Backend System](06-backend-system.md) — App-backend internals
- [Deployment](10-deployment.md) — Deploy pipeline and self-hosted container
