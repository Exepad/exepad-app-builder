# Local Development

The app-backend has **no standalone dev server**. It is imported and dispatched
in-process by the runtime Node server, so "running the backend" means running the
platform. There are two ways to do that, plus a test suite you can run against
the backend on its own.

## Prerequisites

- **Node.js** 20+
- **pnpm** 9.15+
- Python 3 (only if you also want the app-builder agent)

## Running the platform

```bash
# From the monorepo root
pnpm install

# Vite SPA + runtime worker (tsx watch) via Turbo
pnpm dev
```

Or run the full rig — runtime + Python agent — the way the container does, from
source:

```bash
./run.sh local     # runtime on :8090, agent on :8081
```

Either way, an app's backend is reached through the runtime's API gateway at
`/api/{appId}/…` (or `/api/preview-{appId}/…`), never on a port of its own. See
[API Reference — Where requests go](api-reference.md#where-requests-go).

To exercise the whole thing inside the shipped image instead:

```bash
docker compose up --build     # container on :8080
```

## Where the state lives

Everything the backend reads or writes is under the data directory —
`EXEPAD_DATA_DIR`, which defaults to `/data` in the container and
`<repo>/.exepad-data` under `./run.sh local`:

| Path | Contents |
|---|---|
| `apps/{appId}/preview.sqlite`, `apps/{appId}/published.sqlite` | The app's database, one file per mode |
| `storage/{appId}/…` | `app-config.json`, deployment status pointers, compiled handler modules |
| `buckets/exepad-files-{appId}/` | User file uploads |
| `meta.sqlite` | Platform metadata (operators, apps, deployments) — read by the runtime, not the backend |

Because these are plain files, the fastest way to inspect an app's data is
`sqlite3 .exepad-data/apps/<appId>/preview.sqlite`. Deleting an app's directory
resets it; the next deploy recreates the schema.

## Testing

```bash
# From apps/app-backend
pnpm test          # Vitest, node environment
pnpm test:watch
pnpm typecheck
```

The suite runs on plain Vitest 4 (`environment: 'node'`) — no Workers pool. It
covers:

- Auth — signup, signin, signout, session, `me`, cookies, rate limiting, throttling
- API keys — issuance, scopes, validation, handler integration
- CRUD — create, read, list, update, delete, upsert, batch (+ rollback), aggregate, multi_query, search, cursor pagination, FK expansion, FK ownership
- Files — upload validation, access policy, quotas, key building, rate limiting
- Handlers — executor, sandbox freeze, owner fill, injected execution
- Authorization — CRUD policies and role hierarchy
- MCP — transport, method handler, gateway auth, tool dispatch
- Tools — discovery, executor, model/handler mappers
- Integration flows and the config loader

Test helpers live in `tests/helpers/` (`mock-d1`, `mock-auth`, `mock-env`,
`mock-request`). A few heavier integration files are excluded from the default
run in `vitest.config.ts`.

## Making RPC calls by hand

Address an app through the gateway. Substitute the port your rig is using
(`8080` in the container, `8090` for `./run.sh local`):

```bash
# List records
curl -X POST http://localhost:8080/api/my-app/rpc \
  -H "Content-Type: application/json" \
  -d '{"method": "sys_list", "model": "contacts", "params": {"limit": 10}}'

# Create a record
curl -X POST http://localhost:8080/api/my-app/rpc \
  -H "Content-Type: application/json" \
  -d '{"method": "sys_create", "model": "contacts", "params": {"data": {"name": "John", "email": "john@test.com"}}}'

# Sign in with per-app auth
curl -X POST http://localhost:8080/api/my-app/rpc \
  -H "Content-Type: application/json" \
  -d '{"method": "auth_signin", "params": {"email": "admin@test.com", "password": "Admin123"}}'
```

The gateway resolves the app, stamps the identity headers and the service token,
then dispatches in-process — so you never send `X-Service-Token` or
`X-User-Id` yourself. Preview URLs (`/api/preview-{appId}/…`) additionally
require an authenticated operator session.

## Seed data

Seed rows are resolved by the deploy pipeline (`@exepad/deploy-utils`
`src/seed/`), from either:

1. `{APP_ID}/data/{model}.csv` or `{model}.json` files, or
2. `app_config.repo.seed` entries with hashed filenames.

CSV and JSON are both supported. Seeding is topologically sorted so tables with
foreign-key dependencies are populated in the correct order — see
[Deployment — Two-Phase FK-Ordered Seed](deployment.md#two-phase-fk-ordered-seed).
