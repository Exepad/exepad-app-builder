# Deployment

Exepad ships as **one self-hostable Docker container** that runs on your own
machine — bare Node + a local Python agent, with Cloudflare bindings replaced by
local adapters (SQLite, filesystem, in-memory shims). There is **no Cloudflare,
no cloud account, and no external service except the LLM API** you point it at.

> **What you deploy is the platform, not individual apps.** A generated app is a
> *guest* inside the running container — it has no standalone artifact. "Publish"
> compiles and serves the app on the same instance at `/a/{appId}/`; it does not
> emit a downloadable bundle. So "deployment" here means *running one Exepad
> container*. See the [README](../../README.md) for the quickstart.

---

## Deployment Architecture

One image runs **two processes** behind a **single public port (8080)**, backed
by **one persistent volume (`/data`)**.

```
┌──────────────────────────── one container ────────────────────────────┐
│                                                                        │
│  :8080  Node runtime (Hono on @hono/node-server)   ← only public port  │
│          ├─ /                       builder UI (login / studio / apps) │
│          ├─ /a/{id} · /a/preview-…  rendered generated apps            │
│          ├─ /api/{id}/…             gateway → in-process app-backend    │
│          │                          (auto-CRUD + custom handlers)      │
│          ├─ /api/orchestrate/…      prompt → build → compile → deploy   │
│          ├─ /api/deploy · /auth/…   deploy pipeline + local operator auth│
│          └─ /agent/*  ──reverse-proxy──▼                                │
│                                                                        │
│  :8081  Python agent (ADK / FastAPI)  ← loopback only (127.0.0.1)      │
│          the multi-agent app builder                                   │
│                                                                        │
│  /data  (persistent volume)                                            │
│   ├─ meta.sqlite                    users · apps · deployments         │
│   ├─ apps/{appId}/{mode}.sqlite     one preview + one published DB/app │
│   ├─ storage/                       configs · compiled output · snapshots│
│   ├─ buckets/exepad-files-{appId}/  per-app file uploads               │
│   ├─ agent/                         agent build sessions               │
│   └─ secrets/env.sh                 per-instance secrets (generated once)│
└────────────────────────────────────────────────────────────────────────┘
```

If either process exits, the entrypoint tears the other down and the container
exits, so the Docker/Compose restart policy recycles it
([`docker/entrypoint.sh`](../../docker/entrypoint.sh)).

---

## Local adapters (what replaced Cloudflare)

The runtime was originally built on Cloudflare; the self-hosted image swaps every
binding for a local adapter (`packages/local-adapters/`). The deploy-utils still
carry Cloudflare-flavoured names (`provisionD1Database`, `uploadWorkerScript`,
"WfP") for historical reasons, but the implementations are entirely local.

| Cloudflare concept | Local adapter | Notes |
|---|---|---|
| D1 (per-app database) | `better-sqlite3` file under `/data` | One SQLite file per app+mode, WAL mode |
| R2 (object storage) | Filesystem (`CONFIG_CACHE` = `FsStorageAdapter`) | Configs, compiled modules, snapshots, uploads |
| Workers for Platforms dispatch | In-process `fetch()` to the app-backend | `routes/gateway/dispatch-local.ts` |
| KV / Cache | In-memory shims | Config caches invalidated in-process on deploy |
| Browser Rendering | *no equivalent* | Diagnostic `/_diag/inspect` returns `503` |

The deploy pipeline runs with placeholder credentials (`accountId: 'local'`,
`apiToken: 'local'`, `wfpNamespace: 'local'`); the local provisioning functions
ignore those fields and operate on SQLite + the filesystem
([`routes/deploy.ts`](../../apps/runtime/worker/src/routes/deploy.ts)).

---

## Runtime requirements

| Requirement | Detail |
|---|---|
| **Public port** | `8080` (override with `PORT`). The Python agent on `8081` is loopback-only. |
| **Persistent disk** | A real POSIX filesystem mounted at `/data`. SQLite uses WAL + file locks, so a **local block disk on a single instance** is required — network filesystems (NFS, GCS-FUSE, SMB) lack reliable locking and risk corruption. |
| **Single instance** | SQLite is single-writer; disk-backed state can't be horizontally scaled or run with zero-downtime rolling deploys. Run **one** instance per `/data`. |
| **Always-on** | The agent runs multi-minute build jobs; this is not a scale-to-zero workload. |
| **Memory** | ~200–300 MB idle baseline; budget **~1 GB idle / 2–3 GB peak** during a build (LLM contexts + artifact staging). |
| **Image** | Dual Node 22 + Python 3.12 runtime plus `esbuild`/`tsc`/`tailwindcss` build tooling and native `better-sqlite3` — **~3.1 GB uncompressed** (720 MB pull), or **~1.7 GB** as the `:X.Y.Z-lite` variant (built with `EXEPAD_LITE=1`: no bundled Chromium, dashboard thumbnails auto-disable). Published for **`linux/amd64` and `linux/arm64`** (Apple Silicon, Ampere/Graviton, Raspberry Pi). |
| **LLM key** | `EXEPAD_LLM_API_KEY` (or `GEMINI_API_KEY`) is required to build apps; without it, login works but builds fail. |

See [README → Configuration](../../README.md#configuration) for the full env-var
table and provider selection.

---

## Running it

### Build from source

Needs nothing published — this builds the same image a release ships.

```bash
# Build + run the single container locally (host networking; the in-image Caddy
# terminates TLS on :80/:443)
./run.sh                 # thin wrapper over: docker compose up --build
docker compose up --build

# …or build the image and publish only the HTTP port yourself. EXEPAD_HTTPS_DISABLE=1
# is required here: :80/:443 are not published, so the in-image Caddy would be
# unreachable while still defaulting EXEPAD_COOKIE_SECURE to 1 (docker/entrypoint.sh)
# and breaking login off localhost.
docker build -t exepad-app-builder:local .
docker run -d --name exepad --restart unless-stopped \
  -p 8080:8080 -e EXEPAD_HTTPS_DISABLE=1 \
  -e EXEPAD_LLM_API_KEY=your-key -v exepad-data:/data exepad-app-builder:local

# From source, no Docker (HTTPS on :443 — or :8443 without the privileged-port
# capability — plain HTTP also on :8090; Python agent :8081)
./run.sh local
```

Serving that plain-HTTP `:8080` on a LAN IP or a server rather than `localhost`
needs no extra flag: the browser loads the studio and calls `/api` on the *same*
origin, and CORS never applies to same-origin requests. `resolveAllowedOrigin()`
feeds only Hono's `cors()` middleware, which emits or omits response headers —
it never rejects a request. `EXEPAD_ALLOWED_ORIGINS` is therefore **optional**,
and needed only when a *different* origin makes credentialed `/api` calls (a
separate front end, a second domain, or a proxy serving a different hostname
than the browser calls). Only `http://localhost` and `http://127.0.0.1` (any
port) are auto-allowed there, as is any custom domain you registered and
verified in the studio (over `https://` on :443).

Open `http://localhost:8080` (or `https://localhost` on the compose path, which
serves TLS from the in-image Caddy), create the operator account (or seed it on first
boot with `EXEPAD_ADMIN_EMAIL` / `EXEPAD_ADMIN_PASSWORD`), and build an app.
Unless it was seeded, the setup screen asks for the first-run token the container
printed at boot:

```bash
docker compose logs exepad 2>&1 | grep -A2 'SETUP TOKEN'   # or: docker logs exepad …
```

### Install from the published image

Every `vX.Y.Z` tag publishes the image to GHCR
(`ghcr.io/exepad/exepad-app-builder`) and the `exepad-app-builder` launcher to npm in
lockstep, so **one command** installs and starts the studio. npm ships only a
tiny launcher; Docker carries the image. See
[INSTALL.md](../../INSTALL.md) for the per-platform quickstart and
[docs/install/](../install/README.md) for the full reference.

```bash
# Cross-platform (needs Node 18+ and Docker). Also the operator CLI.
npx exepad-app-builder up                  # latest;  npx exepad-app-builder@X.Y.Z up  pins a version

# macOS / Linux, headless servers (needs Docker; Node optional).
curl -fsSL https://get.exepad.com | bash
curl -fsSL https://get.exepad.com | bash -s -- --version X.Y.Z --llm-key sk-...

# Windows (PowerShell).
irm https://get.exepad.com/install.ps1 | iex

# HTTPS on a real domain in one command (adds a Caddy sidecar, auto Let's Encrypt).
npx exepad-app-builder up --domain app.example.com --acme-email you@example.com
```

The launcher writes a **tag-pinned** `docker-compose.yml` + `.env` under `~/.exepad`
(never floats `:latest`) and records the deployed version. Lifecycle:

```bash
npx exepad-app-builder update --to X.Y.Z   # backs up the data volume, then pulls + restarts; refuses a downgrade (--force to override)
npx exepad-app-builder backup              # archive the data volume to a .tgz
npx exepad-app-builder stop | start | restart | down | logs -f | doctor | status
```

Versions are **lockstep** (launcher version == image tag) and upgrades run
migrations forward-only, so the CLI guards against downgrades — see
[RELEASING.md](../../RELEASING.md).

### Secrets & persistence

Per-instance secrets (`EXEPAD_SESSION_SECRET`, `DEPLOY_SECRET`,
`USER_WORKER_SERVICE_TOKEN`, `PLATFORM_INTERNAL_SECRET`) are generated on first
run and persisted to `/data/secrets/env.sh` with `umask 077`. They are **never
regenerated** — rotating `EXEPAD_SESSION_SECRET` would invalidate every live
session and preview token. Any value can be overridden with `-e`, which always
wins over the persisted file.

### Backup

`/data` is the single source of truth **and** the single point of failure.
Archive the volume to back up everything (databases, compiled output, uploads,
secrets):

```bash
docker compose stop      # not optional — see below
docker run --rm -v exepad-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/exepad-backup.tgz -C /data .
docker compose start
```

The stop is what makes the archive trustworthy. `/data` holds `better-sqlite3`
databases in **WAL mode** (`meta.sqlite` plus one per app); a live `tar` reads the
main file and its `-wal`/`-shm` sidecars at different instants, so a checkpoint
racing the copy yields a torn main file with a mismatched WAL — an archive that
restores **corrupt**, which you discover at restore time.

`npx exepad-app-builder backup` wraps this and stops the container itself; `--no-stop` takes a
hot copy deliberately and warns. Always back up before a version change — it's
also the escape hatch the downgrade guard points to.

### TLS, domains, and reverse proxies

> **Self-serve custom domains + automatic HTTPS** (add a domain from the UI, no
> restart) are documented in **[custom-domains.md](../install/custom-domains.md)** —
> the bundled Caddy on-demand-TLS path. The env-var route below is the manual
> alternative for when you front the container with your own reverse proxy.

With `EXEPAD_HTTPS_DISABLE=1` — what the installers, the CLI, and the
single-published-port `docker run` above all set — the container speaks **plain
HTTP on `8080`** and neither terminates TLS nor manages domains itself. For
anything beyond `localhost` — especially so the
*end-users* of a published app can reach it — front it with a reverse proxy that
provides HTTPS (Caddy with automatic Let's Encrypt, Traefik, nginx, or a
Cloudflare Tunnel). App-store wrappers (Coolify, Umbrel, CasaOS) handle certs for
their users automatically.

Serving on a **LAN IP** or **custom domain** works with no extra config as long
as the browser talks to a single origin. These env vars cover the cases where it
does not — forward the standard proxy headers alongside them:

| Variable | Purpose |
|---|---|
| `EXEPAD_ALLOWED_ORIGINS` | **Optional; cross-origin only.** Comma/pipe-separated allowlist of browser origins for credentialed `/api` calls — exact origin (`https://app.company.com`), `host:port` (`192.168.1.10:8080`), or `*.suffix` wildcard. `localhost`/`127.0.0.1` are allowed by default (turn that off with `EXEPAD_STRICT_LOCAL_CORS=1`, or "Strict local CORS" in the Server & networking panel). Same-origin browsing needs none of this. |
| `EXEPAD_COOKIE_SECURE` | `1` forces `Secure` on session/preview cookies; also auto-enabled when the request carries `X-Forwarded-Proto: https`. Leave unset for plain-HTTP LAN. |
| `EXEPAD_EMAIL_SENDER_DOMAINS` | Allowed From-address domains for auth email (default `exepad.com,exepad.app`; empty = any). |
| `EXEPAD_CDN_DOMAIN` / `EXEPAD_APP_DOMAIN` | Advanced CSP overrides; self-host emits a clean same-origin CSP by default. |

The runtime is forwarded-header aware: it trusts `X-Forwarded-Host` and
`X-Forwarded-Proto` (for cookie `Secure` and canonical URLs) under
`ENVIRONMENT=selfhost`. A minimal Caddy front (auto-TLS + sets those
headers):

```caddy
app.example.com {
    reverse_proxy localhost:8080
}
```

…adding `EXEPAD_ALLOWED_ORIGINS=https://app.example.com` only if some *other*
origin also calls the API. Extension SDK assets are
served same-origin from `/runtime_assets/ext/*` in self-host (no `cdn.exepad.com`
dependency); the CDN import map is opt-in only via the `VITE_EXTENSION_REGISTRY=cdn`
**build** flag. See the [README configuration section](../../README.md#configuration)
for the full env table, including the agent build knobs `ALLOWED_FETCH_DOMAINS`
and `ALLOWED_IMAGE_DOMAINS`.

---

## Deploy Utils Package

The [`packages/deploy-utils/`](../../packages/deploy-utils/) package implements the
pipeline used by the runtime worker's deploy route.

| Module | Responsibility |
|--------|---------------|
| `schema/` | Generate SQLite migration SQL from `ModelConfig` definitions |
| `bundle/` | Compile custom handlers (esbuild) + assemble the app-backend module set |
| `deploy/` | **Local** provisioning — create/open the app's SQLite file, apply DDL, write compiled modules to storage |
| `seed/` | Database seeding from CSV/JSON data files |
| `cli/` | CLI entry points for deployment commands |

### Deployment Pipeline

The runtime worker's [`/api/deploy/:appId`](../../apps/runtime/worker/src/routes/deploy.ts)
endpoint is the source of truth. It is idempotent on `correlationId`, holds a
per-app deploy lock, and writes a `currentStep` marker at each stage so failures
can be diagnosed precisely.

```
 1. auth            — verify the deploy secret (X-Deploy-Secret, constant-time)
 2. idempotency     — return the cached result for a repeated correlationId
 3. config          — read app config from storage (preview path vs published snapshot)
 4. validate        — WebAppProps + backend props (+ empty-frontend guard,
                      + storage-requires-dynamic-backend guard)
 5. static-seed     — resolve static seed entries referenced by the config
 6. provision       — in parallel:
                      • read compiled handler .js modules from storage
                      • read the versioned worker template
                      • create/open the app's SQLite file (preview vs published)
                      • create the file-storage prefix (only if storage enabled)
 7. lock            — acquire the per-app deploy lock
 8. schema          — snapshot + diff vs target + apply migrations
                      (safe / destructive / reset per model policy)
 9. system tables   — batched DDL: files (if storage), auth + API keys (if the
                      app has per-app security)
10. seed            — preview: seed every model from fixtures;
                      published: seed only ownerScope:"shared" models,
                      non-destructively (never clobbers live user rows)
11. snapshot        — (published only) stage a content-addressed release
                      snapshot + SEO snapshots, then validate the manifest
12. upload          — write the compiled module set (_entry.js, template.js,
                      handlers/*.js) for the app via the in-process app-backend
13. release + status— release the lock, persist success status, invalidate the
                      in-memory config caches before returning
```

On failure during `upload` / `seed` / `snapshot` (after migrations applied) the
pipeline performs a best-effort schema rollback to the previous snapshot and
records `status: "failed"` with the failing `step`.

**Preview vs Published.** Each app has **two** SQLite databases and two module
sets: `exepad-preview-{appId}` (reseeded fully on every deploy, for iteration)
and `exepad-{appId}` (published — seeds only shared/reference models and never
wipes live data). Preview is served at `/a/preview-{appId}/`, published at
`/a/{appId}/`.

**Asset versioning.** Per-app compiled CSS and other agent-emitted assets are
stored under content-hashed filenames so theme/colour edits invalidate cleanly
through any downstream HTTP cache.

**Cancellation.** The runtime exposes nothing to cancel an in-flight
*generation* — cancellation is owned by the agent (`POST /cancel` on the agent
service writes a marker that a watchdog observes and aborts the in-flight LLM
call). The deploy step itself is too fast to be cancellable in practice.

---

## Development

For local development you run the same stack without Docker:

```bash
# Full rig from source: HTTPS on :443 (or :8443 without the privileged-port
# capability), plain HTTP also on :8090 + Python agent (:8081)
./run.sh local

# Or the runtime alone (SPA + worker via Turbo, tsx watch)
pnpm dev
```

`./run.sh local` builds the SPA + bundled server, bootstraps the same
per-instance secrets under `./.exepad-data`, and starts both processes. It needs
`pnpm install` and the agent venv (`apps/agent/.venv` with `requirements.txt`
installed). See the [Development Guide](12-development-guide.md) for the full
toolchain setup.

---

## Related Documents

- [Architecture](02-architecture.md) — System design overview
- [Backend System](06-backend-system.md) — App-backend internals
- [Development Guide](12-development-guide.md) — Local setup commands
- [RELEASING.md](../../RELEASING.md) — How release artifacts are cut
- [README](../../README.md) — Self-host quickstart
