# One-click deploy templates

Thin wrappers that deploy the **published Exepad image** (`ghcr.io/exepad/exepad-app-builder`)
on common hosts. They all wrap the *same* container — no host forks the
architecture. Each channel only differs in how it declares the persistent
`/data` volume, the health check, and the `EXEPAD_LLM_API_KEY` secret.

> Prefer a one-command install instead? `npx exepad up` (cross-platform) or
> `curl -fsSL https://get.exepad.com | bash` (headless). See the
> [root README](../README.md#deploy-to-a-server).

> **These templates pull a published image**, so they only work once the first
> `vX.Y.Z` tag is cut
> ([what's gated](../docs/install/README.md#once-the-first-release-is-published)).
> Until then, build the image from a checkout — see
> [docs/install/](../docs/install/README.md#quick-start--build-from-source).

## Hard constraints (every channel)

| Constraint | Why |
|---|---|
| **Persistent disk at `/data`** | All state (SQLite, storage, secrets) lives here. Ephemeral filesystems lose everything on restart. **No NFS/network FS** — SQLite needs real file locks. |
| **Single instance** | SQLite is single-writer; no horizontal scaling / rolling deploys. |
| **≥ 2 GB RAM** | Idle ~200-300 MB; builds peak at 2-3 GB. |
| **`EXEPAD_LLM_API_KEY`** | Required, or app builds fail. Set it in the platform's env UI; never commit it. |
| **amd64 / arm64** | Published for both; older/other arches are unsupported. |
| **Pin a version** | Replace `:latest` with a released tag (`:X.Y.Z`) for reproducible redeploys. |
| **`EXEPAD_HTTPS_DISABLE=1`** | Required whenever the container's plain-HTTP `:8080` is the front door — see below. |

## TLS: who terminates it

The image ships its own Caddy and, by default, terminates TLS **inside** the
container. Every template here instead publishes (or proxies to) the studio's
plain-HTTP `:8080`, so they all set **`EXEPAD_HTTPS_DISABLE=1`** — which tells
`docker/entrypoint.sh` to skip the in-image Caddy and serve plain HTTP on `:8080`.

Leave it unset in a proxy-fronted / one-click template and the in-image Caddy
comes up, terminates TLS on a container port the template never publishes, and
forces `EXEPAD_COOKIE_SECURE=1`. The runtime then stamps `Secure` on the platform
session cookie, browsers refuse to store it over `http://<host>:8080`, and **login
silently fails** on everything except `localhost` (which browsers treat as a
secure context anyway).

Cookies go back to `Secure` automatically once a real proxy is in front: the
runtime honours `X-Forwarded-Proto: https` per request (Coolify/Dokploy/Render/
Railway/Traefik/Caddy all send it). So the rule is simply:

| Front door | `EXEPAD_HTTPS_DISABLE` |
|---|---|
| Platform reverse proxy or app-store proxy in front of `:8080` | `1` |
| Raw `:8080` published on a LAN box (`npx exepad up`, `install.sh` without `--domain`, CasaOS/Umbrel/Runtipi) | `1` |
| Caddy **sidecar** on `:80/:443`, studio internal-only (`exepad up --domain …`) | unset (sidecar owns TLS; also set `EXEPAD_COOKIE_SECURE=1`) |
| Container reached directly on `:443` with no proxy at all | unset (in-image Caddy owns TLS) |

Never expose a plain `:8080` straight to the internet — it is cleartext.

## Channels

### Render — `render.yaml` (repo root)
Fully repo-defined Blueprint. Button:
`https://render.com/deploy?repo=https://github.com/Exepad/exepad-app-builder`
Needs a **paid** plan (free web services have ephemeral disks). The blueprint
declares the `/data` disk, the health check, and `EXEPAD_LLM_API_KEY` as a
prompted secret.

### Self-host app stores — [`deploy/docker-compose.yml`](./docker-compose.yml)
Image-based compose for **Coolify, Portainer, Dokploy**, or a plain
`docker compose -f deploy/docker-compose.yml up -d`. Declares the `exepad-data`
volume, port `8080`, the health check, and the LLM key env. (The repo-root
`docker-compose.yml` *builds* from source instead — use this one to *pull*.)

### Self-hosted app stores — [`deploy/appstores/`](./appstores/)
Manifests for Portainer / CasaOS / ZimaOS / Umbrel (community store) / Runtipi
plus a Dokploy blueprint ([`deploy/dokploy/`](./dokploy/)) — the
"add store by URL" channel. See [`appstores/README.md`](./appstores/README.md)
for per-store install/submission steps and caveats.

### Railway — [`deploy/railway.json`](./railway.json) — no one-click button yet
Configures deploy behavior (health check, `ON_FAILURE` restart, single replica)
for a Railway service you create yourself: point it at
`ghcr.io/exepad/exepad-app-builder`, mount a volume at `/data`, and set
`EXEPAD_LLM_API_KEY`. There is **no one-click Deploy button** — that needs a
Railway *template* published on their side (dashboard or `railway` CLI), which
does not exist yet.

## Status / what's verified

These templates are validated for **structure** (YAML/JSON shape, image ref,
`/data` persistence, health check, LLM-key env). They are **not** yet verified by
a live deploy on every listed host — that needs an account on each platform.
Treat the buttons as ready-to-test, not battle-tested; issues and fixes for a
specific host are welcome.
