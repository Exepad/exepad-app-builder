# Deployment

The app-backend itself is **never deployed**. It is compiled into the runtime
Node server and dispatched in-process
(`apps/runtime/worker/src/routes/gateway/dispatch-local.ts`). Shipping a new
version of the backend means shipping a new container image.

What *does* get deployed is an **app**: its schema, its config, and its compiled
handlers. That pipeline lives in the runtime worker
(`apps/runtime/worker/src/routes/deploy.ts`) and in `@exepad/deploy-utils`. This
page describes it from the backend's point of view — how the things the backend
reads at request time get there.

For the platform-level picture (what the container is, what runs in it, how to
host it), see [docs/latest/10-deployment.md](../../../../docs/latest/10-deployment.md).

## What a deploy produces

`POST /api/deploy/:appId` runs for a single `{appId, mode}` pair, where mode is
`preview` or `published`. Each app + mode gets its own database file and its own
storage prefix, and that is the entirety of the isolation model.

| Artifact | Where it lands | Who reads it |
|---|---|---|
| `app-config.json` | storage, under `{appId}/…`, pointed at by `deployment-status-{mode}.json` | `src/context/config-loader.ts` on the next request |
| Model tables + indexes | the app's SQLite file, via generated DDL + a planned migration | every `sys_*` CRUD method |
| Auth / files / API-key system tables | the same SQLite file | `src/auth/*`, `src/file/*` |
| Seed rows | the same SQLite file | CRUD reads |
| Compiled handler ES modules | storage, under `{appId}/{mode}/modules/handlers/` | `src/handlers/app-registry.ts` |
| `worker-manifest.json` (module list + content hash) | storage, at `{appId}/{mode}/worker-manifest.json` | `src/handlers/app-registry.ts` |

The runtime holds a per-app deploy lock so two deploys can't interleave, takes a
byte-level database backup before any destructive migration, and writes a
`deployment-status-{mode}.json` pointer last — that pointer is what makes the new
config live.

## How the backend picks the change up

Nothing restarts. Two caches decide when new artifacts take effect, and both are
keyed by content, not by process lifetime:

- **Config** — `loadConfig` compares the stored object's ETag against its cached
  entry for `{appId}:{mode}`. A redeploy changes the ETag, so the next request
  reloads.
- **Handlers** — `app-registry.ts` reads `worker-manifest.json` and caches the
  instantiated modules per `{appId}:{mode}`, invalidating when the manifest's
  hash changes.

## Handler execution model

Compiled handlers are ES modules loaded into a constrained `node:vm` context —
standard intrinsics, a prefixed `console`, and an allowlisted `fetch`
(`EXEPAD_FETCH_ALLOWLIST`, default-deny). No `require`, `process`, or `fs`; the
handler context (including the app's database handle) is passed as a call
argument, not as a global.

> **`node:vm` is not a security boundary.** This enforces the generation-time
> validators' contract under a single-author trust model ("you trust the apps you
> generate"). Hosting apps from multiple untrusted authors on one container is
> unsafe. See the module comment in `src/handlers/app-registry.ts` for the full
> threat model and upgrade path.

## Deploy Utils

`@exepad/deploy-utils` (`packages/deploy-utils/`) provides the pieces:

- **Schema generation** (`generateSchemaSQL`) — DDL from model configs
- **System DDL** (`generateAuthDDL`, `generateApiKeysDDL`, `generateFilesDDL`)
- **Migrations** (`src/schema/migrations.ts`, `src/deploy/migration-orchestrator.ts`) — plan first, then apply, with rollback
- **Handler compilation** (`compileHandlers`) — TypeScript handlers → JS via esbuild
- **Local SQLite execution** (`src/deploy/d1-local.ts`) and filesystem storage paths (`src/deploy/r2-paths.ts`)
- **Two-phase FK-ordered seeding** (`src/seed/r2-seeder.ts` + `seed-order.ts`)

> Several exported names here are Cloudflare-shaped for historical reasons —
> `uploadWorkerScript` writes handler modules to the filesystem, `d1-*` operate on
> a local SQLite file, `r2-*` on a local directory. The names are legacy; the
> behavior is entirely local.

### Two-Phase FK-Ordered Seed

Re-deploys re-seed the app database while preserving foreign-key integrity:

1. **Clear children before parents** — RESTRICT-delete order computed from the FK graph
2. **Insert parents before children** — topologically sorted insert order
3. **Deferred-FK UPDATE pass** for cycles, with a NOT-NULL guard so child rows never pass through a transient FK-null state on NOT-NULL columns
4. **Empty-guard on published deploys** — the first publish into an empty published database still seeds `ownerScope: 'shared'` models so the catalog isn't blank. The guard is non-destructive: it only seeds when the target table is empty.

## Environment the backend receives

The runtime builds the backend's `Env` per request in
`apps/runtime/worker/src/server/build-user-env.ts`. See
[Architecture — Environment & Bindings](architecture.md#environment--bindings)
for the full table, including which surfaces are deliberately left unbound.
