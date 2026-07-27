# Installing Exepad

Exepad is a self-hosted AI app builder that ships as **one container** — a Node
runtime + a Python build agent + SQLite, with no cloud accounts beyond the LLM
API you choose. This guide covers every way to install and run it.

> **Just want it installed?** The short per-platform quickstart (one-liner
> installs + optional MSI/zip/tarball packages) is
> [INSTALL.md](../../INSTALL.md) at the repo root.

> **Where releases live.** Installers are attached to every
> [Exepad/exepad-app-builder release](https://github.com/Exepad/exepad-app-builder/releases/latest),
> the launcher is the `exepad-app-builder` npm package, and the image is
> `ghcr.io/exepad/exepad-app-builder`. How they are cut:
> [RELEASING.md](../../RELEASING.md). Rather not use a registry at all? See
> [Build from source](#quick-start--build-from-source) — it needs nothing
> published.

---

## Requirements

| | Requirement |
|---|---|
| **Docker** | Docker Engine + the **Compose v2** plugin (`docker compose`). Needed by every install path, including [build from source](#quick-start--build-from-source). (Only the `./run.sh local` dev path runs without it.) |
| **Node / Python** | Only for the no-Docker dev path (`./run.sh local`): **Node 22** + **Python 3.12**. |
| **CPU** | `amd64` or `arm64`. |
| **Memory** | **≥ 2 GB RAM** — idle ~200–300 MB; app builds peak at **2–3 GB**. |
| **Disk** | A real **POSIX** volume for `/data` (SQLite needs file locks). **No NFS/SMB.** Single instance per `/data`. |
| **LLM key** | An API key for your provider (Google **Gemini** by default). The studio *starts* without one, but app builds fail until it's set. |

`npx exepad-app-builder doctor` checks a host for you; see also
[Troubleshooting](#troubleshooting).

---

## Quick start — build from source

Build the same image a release ships and run it exactly like the released one.
Needs only Docker and git — no registry, no npm package, no accounts (set the
LLM key afterwards in the in-app **Settings**):

```bash
git clone https://github.com/Exepad/exepad-app-builder.git && cd exepad-app-builder
docker build -t exepad-app-builder:local .
docker run -d --name exepad --restart unless-stopped \
  -p 8080:8080 -e EXEPAD_HTTPS_DISABLE=1 \
  -v exepad-data:/data exepad-app-builder:local
```

`EXEPAD_HTTPS_DISABLE=1` turns the in-image Caddy off and serves plain HTTP on
`8080`, which is what publishing a single port needs (it is also what the
installers and the CLI set when no `--domain` is given — with `--domain` they
generate a Caddy sidecar instead). Leave it out only if the container can publish
`:80`/`:443` too — otherwise Caddy starts, is unreachable, and the session
cookie is stamped `Secure`, so login silently fails on everything but
`http://localhost`.

Serving it on a LAN IP or a server rather than `localhost` needs nothing extra:
the browser loads the studio from `http://<host>:8080` and its `/api` calls go
back to that same origin, and CORS never applies to same-origin requests.
`EXEPAD_ALLOWED_ORIGINS` is **optional** — set it only when a *different* origin
makes credentialed `/api` calls (a separate front end, a second domain, or a
proxy serving a different hostname than the browser calls). Only
`http://localhost` and `http://127.0.0.1` (any port) are auto-allowed there, as
is any custom domain you registered and verified in the studio (over `https://`
on :443).

**Working on Exepad itself?** Use the dev wrapper instead: `./run.sh` (wraps
`docker compose up --build`) or `./run.sh local` (from source, no Docker —
HTTPS on **https://localhost** (:443, or :8443 without the privileged-port
capability), plain HTTP also on `:8090`; Python agent `:8081`; needs
`pnpm install` and the agent venv). See the
[development guide](../latest/12-development-guide.md).

---

## Install from a published release

Every `vX.Y.Z` tag publishes the `exepad-app-builder` npm package, the
`ghcr.io/exepad/exepad-app-builder` image, and the GitHub Release assets the
one-liners fetch. Three ways in — they all end at the same container.

### Option A · one-liner install

macOS or Linux — on Linux it offers to install Docker Engine if missing; on
macOS it detects Docker Desktop/OrbStack and walks you through installing one:

```bash
curl -fsSL https://get.exepad.com | bash
# pin a version + seed the key non-interactively:
curl -fsSL https://get.exepad.com | bash -s -- --version X.Y.Z --llm-key sk-...
```

Windows (guides you through Docker Desktop if needed):

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://get.exepad.com/install.ps1 | iex"
```

A released script carries the `public` channel: with Node ≥ 18 present it
delegates to `npx exepad-app-builder`, otherwise it runs a self-contained bootstrap that
produces the same compose/`.env`. Running `install.sh` straight out of a source
checkout (channel `dev`) always takes the bootstrap path — it never delegates to
an npm package the checkout can't vouch for.

### Option B · `npx` (any OS, Node 18+)

```bash
npx exepad-app-builder up
```

npm fetches a tiny launcher; Docker pulls the actual image. The launcher writes a
tag-pinned `docker-compose.yml` + `.env` under `~/.exepad` (override with
`--dir` / `$EXEPAD_HOME`) and starts the studio.
It doubles as the operator CLI:

```bash
npx exepad-app-builder update --to X.Y.Z   # backs up the data volume, then pulls + restarts (guards downgrades)
npx exepad-app-builder backup              # archive the data volume to a .tgz
npx exepad-app-builder stop | start | restart | down | logs -f | doctor | status
```

For a persistent command: `npm i -g exepad-app-builder`, then `exepad up`.

> **Ubuntu / snap Docker:** the default install dir would be the *hidden* `~/.exepad`,
> which snap Docker's sandbox can't read. Use a non-hidden dir:
> `EXEPAD_HOME=~/exepad npx exepad-app-builder up` (see [Troubleshooting](#snap-docker)).

### Option C · direct `docker run` (no CLI)

```bash
# Pin an exact released version — never :latest. (A -lite variant exists: :X.Y.Z-lite.)
docker run -d --name exepad -p 8080:8080 \
  -e EXEPAD_HTTPS_DISABLE=1 \
  -e EXEPAD_LLM_API_KEY="your-llm-key" \
  -v exepad-data:/data \
  ghcr.io/exepad/exepad-app-builder:X.Y.Z
```

Same flags as the [build-from-source quickstart](#quick-start--build-from-source):
`EXEPAD_HTTPS_DISABLE=1` because only `8080` is published, plus the optional
`-e EXEPAD_ALLOWED_ORIGINS=…` if something on a *different* origin calls the API.

---

## First run

1. Open **http://localhost:8080**.
2. Create the operator account (or pre-seed it with `EXEPAD_ADMIN_EMAIL` /
   `EXEPAD_ADMIN_PASSWORD`). Unless it was pre-seeded, the setup screen asks for
   the **setup token** the container printed at boot — read it back with
   `docker logs exepad 2>&1 | grep -A2 'SETUP TOKEN'`.
3. Make sure an LLM key is set (env var, or the in-app **/settings** page).
4. Type a prompt — watch the build stream, preview it, then **Publish** to serve
   it at `/a/{appId}/`.

`GET /auth/status` returns `200 {"needsSetup":true}` before the first account
exists — a quick health probe.

---

## HTTPS on a real domain

`--domain` fronts the studio with a **Caddy sidecar** that terminates TLS and
reverse-proxies to the (now internal-only) container. It sets
`EXEPAD_COOKIE_SECURE=1` + `EXEPAD_ALLOWED_ORIGINS` for you. Pick **how Caddy gets
the certificate** with `--tls`:

| `--tls` | When to use | Requirements | Renewal |
|---|---|---|---|
| `letsencrypt` *(default)* | Public host with a real domain | Public DNS → host, inbound **:80/:443** open | Automatic (~60d) |
| `dns` | Behind NAT / firewall / split-horizon | A DNS provider with an **API token** | Automatic (~60d) |
| `byoc` | Internal/corporate LAN with your own CA | An IT-issued **cert + key** | Manual (your CA) |

### A — Public, automatic (Let's Encrypt HTTP-01)

```bash
npx exepad-app-builder up --domain app.example.com --acme-email you@example.com
```

Point the domain's DNS at the host and open ports 80/443 so the cert can be issued.

### B — Behind NAT (Let's Encrypt DNS-01)

No inbound ports are needed for issuance — Caddy proves domain control through your
DNS provider's API. The sidecar is **rebuilt** with the matching `caddy-dns` plugin
on first `up` (an `xcaddy` build, a few minutes):

```bash
npx exepad-app-builder up --domain app.example.com --acme-email you@example.com \
  --tls dns --dns-provider cloudflare --dns-token "$CF_API_TOKEN"
```

The token is written to a Caddy-only `caddy.env` (mode `0600`) — deliberately **not**
the studio's shared `.env`, so a domain-controlling credential never reaches the app
container. You can also create `caddy.env` by hand (`EXEPAD_DNS_TOKEN=…`) and omit
`--dns-token`. Supported single-token providers: **cloudflare, digitalocean, gandi,
hetzner, linode, vultr, duckdns, desec**. Multi-credential providers (route53, azure,
googleclouddns, …) need a hand-edited `Caddyfile` — use `--tls byoc` or edit the
generated file.

> Secrets in the install dir (`.env`, `caddy.env`) are written `0600`. Keep them
> that way — `.env` holds your LLM key + admin password, and `caddy.env` holds a
> DNS token that can edit your zone.

### C — Internal CA / bring-your-own-cert

For air-gapped or corporate LANs where there's no public domain but your org's CA
root is already trusted on every machine (e.g. via group policy):

```bash
npx exepad-app-builder up --domain app.internal.company --tls byoc
# then drop your cert in the install dir and restart:
#   <install-dir>/certs/cert.pem   (full chain)
#   <install-dir>/certs/key.pem    (private key)
```

Caddy serves that cert with **no ACME** at all (the generated `Caddyfile` uses
`auto_https off` + a static `tls <cert> <key>`). To instead auto-renew internal
certs from a private ACME server (e.g. [step-ca](https://smallstep.com/docs/step-ca/)),
edit the generated `Caddyfile`: remove the global `auto_https off` block, and
replace the site's static `tls /etc/caddy/certs/cert.pem /etc/caddy/certs/key.pem`
line with `tls { ca https://step-ca.internal/acme/acme/directory }` (you can then
drop the `./certs` mount too).

> **Already have a reverse proxy?** If you run nginx/Traefik/Cloudflare yourself,
> skip `--domain` entirely: keep the studio on its HTTP port and forward
> `X-Forwarded-Proto` / `X-Forwarded-Host`. Add
> `EXEPAD_ALLOWED_ORIGINS=https://your-domain` only if the proxy serves a
> hostname other than the one the browser calls. The same `byoc` cert layout also
> works for a raw `docker compose up` against the repo (mount your cert at
> `./certs`).

---

## Choosing an LLM provider

Defaults to Google Gemini. For any other vendor (via LiteLLM), set the provider:

| Provider | Env |
|---|---|
| Gemini *(default)* | `EXEPAD_LLM_API_KEY` *(or `GEMINI_API_KEY`)* |
| Anthropic | `EXEPAD_LLM_PROVIDER=anthropic` · `EXEPAD_LLM_API_KEY=sk-ant-…` |
| OpenAI | `EXEPAD_LLM_PROVIDER=openai` · `EXEPAD_LLM_API_KEY=sk-…` |
| OpenRouter | `EXEPAD_LLM_PROVIDER=openrouter` · `EXEPAD_LLM_API_KEY=…` |
| Ollama / vLLM / LM Studio | `EXEPAD_LLM_PROVIDER=custom` · `EXEPAD_LLM_BASE_URL=http://host:11434/v1` |

You can also change the provider/key at runtime in the **/settings** UI — that
picker opens on **OpenRouter**, and what you save there overrides the env vars.

> **On a non-Gemini provider, set a model too.** The built-in per-agent defaults
> are `gemini-*` ids and are passed through as-is on another vendor (OpenRouter
> would be asked for `openrouter/gemini-3-flash-preview`, which does not exist),
> so builds fail with nothing obvious to diagnose. Set
> `EXEPAD_LLM_MODEL_DEFAULT`, or pick a model on the **/settings** page.

---

## Versions & updates

- **Lockstep.** `npx exepad-app-builder@X.Y.Z up` installs studio **X.Y.Z** (launcher version ==
  image tag). `--to X.Y.Z` targets a version; `--image-tag @sha256:…` pins a digest.
- **Pinned, never `:latest`.** The generated compose records an exact tag, so a
  stray pull can't jump a major.
- **Variants.** Every version also ships `ghcr.io/exepad/exepad-app-builder:X.Y.Z-lite` —
  no bundled Chromium (~1.4 GB smaller uncompressed; full ≈3.1 GB vs lite ≈1.7 GB);
  dashboard thumbnails auto-disable.
- **Forward-only migrations → downgrade guard.** `update` **refuses a downgrade**
  unless you pass `--force`. Upgrade is **backup-then-pull-and-restart** —
  `update` snapshots the data volume automatically before applying (skip with
  `--no-backup`); downgrade means restore that backup.

```bash
npx exepad-app-builder update --to X.Y.Z     # backs up, then upgrades
npx exepad-app-builder restore <backup.tgz> --to <older-version>   # the rollback path
```

---

## One-click deploy (managed hosts)

Each template declares the `/data` volume + LLM key (see [deploy/README.md](../../deploy/README.md)):

- **Render** — [Deploy to Render](https://render.com/deploy?repo=https://github.com/Exepad/exepad-app-builder) (`render.yaml`, repo root)
- **Coolify / generic Docker host** — [`deploy/docker-compose.yml`](../../deploy/docker-compose.yml)
- **Dokploy** — [`deploy/dokploy/`](../../deploy/dokploy/)
- **Self-host app stores** — [`deploy/appstores/`](../../deploy/appstores/): Portainer, CasaOS, Umbrel, Runtipi
- **Railway** — [`deploy/railway.json`](../../deploy/railway.json) (service config; no one-click button yet)

---

## Configuration (common env vars)

| Variable | Purpose |
|---|---|
| `EXEPAD_LLM_API_KEY` | LLM key (required for builds). |
| `EXEPAD_LLM_PROVIDER` | `gemini` (default) · `anthropic` · `openai` · `openrouter` · `custom`. |
| `EXEPAD_LLM_BASE_URL` | OpenAI-compatible base URL (Ollama/vLLM/etc.). |
| `EXEPAD_ADMIN_EMAIL` / `_PASSWORD` | Seed the operator account (skip browser setup). |
| `PORT` | The runtime's internal listener (default 8080). Only meaningful with `EXEPAD_HTTPS_DISABLE=1` — the in-image Caddy proxies to `127.0.0.1:8080` and ignores this, so changing it on the default HTTPS path breaks access. Move the *public* port in Settings → Server & network instead. |
| `EXEPAD_ALLOWED_ORIGINS` | **Optional** — extra allowlist of *cross-origin* browsers for credentialed `/api` calls. Same-origin access needs nothing. |
| `EXEPAD_COOKIE_SECURE` | `1` forces Secure cookies (auto-on behind a TLS proxy). |
| `RESEND_API_KEY` | Gates **all** auth email (your apps' signup verification + password reset) via a Resend proxy. Unset by default, so those flows can't send; signup and login are unaffected. |
| `EXEPAD_EMAIL_FROM` / `_NAME` | From-address for that mail. Needed alongside the key — the default `@exepad.com` sender can't be verified with your Resend account, so sends with it are rejected. |
| `EXEPAD_DATA_DIR` | State dir inside the container (default `/data`). |
| `EXEPAD_THUMBNAILS_ENABLED` | `0` disables the Chromium dashboard-thumbnail cron. |

Full reference: [docs/latest/10-deployment.md](../latest/10-deployment.md) and the
[README](../../README.md#configuration).

---

## Backup & restore

All state lives in the `exepad-data` volume (`/data`): databases, compiled apps,
uploads, secrets. **Back up before any version change.**

```bash
npx exepad-app-builder backup        # → ~/.exepad/backups/exepad-data-<stamp>.tgz

# raw equivalent — note the stop/start, which is NOT optional:
# /data holds SQLite in WAL mode, and tar reads the main file and its
# -wal/-shm sidecars at different instants. Archiving a running instance can
# produce a torn copy that restores corrupt, discovered only at restore time.
# `exepad backup` stops the container for you (--no-stop opts out, with a warning).
docker compose stop
docker run --rm -v exepad-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/exepad-backup.tgz -C /data .
docker compose start

# restore into a fresh volume:
docker run --rm -v exepad-data:/data -v "$PWD":/backup alpine \
  sh -c "cd /data && tar xzf /backup/exepad-backup.tgz"
```

---

## Troubleshooting

Run **`npx exepad-app-builder doctor`** first — it checks Docker, the daemon, architecture,
RAM, and the deployed version.

**"Docker daemon not reachable" / permission denied on `/var/run/docker.sock`.**
You're not in the `docker` group. `sudo usermod -aG docker "$USER"`, then log out
and back in. *On snap Docker the group may not exist yet* — create it first:
`sudo addgroup --system docker && sudo adduser "$USER" docker && sudo snap disable docker && sudo snap enable docker`, then `newgrp docker`.

<a id="snap-docker"></a>**snap Docker: `permission denied` reading `.env`.**
Snap Docker's sandbox can't read **hidden** paths, so the default `~/.exepad`
install dir fails. Use a non-hidden dir: `EXEPAD_HOME=~/exepad npx exepad-app-builder up`.

**"unsupported architecture."** The image targets amd64 + arm64; other arches are
unsupported (`--force` to try anyway).

**Builds fail / nothing happens after a prompt.** No (or invalid)
`EXEPAD_LLM_API_KEY`. Set it via env or the **/settings** page.

**`< 2 GB RAM`.** App builds need 2–3 GB; the installer warns below 2 GB.

**Can't reach it from another machine.** Check the port is actually published
(`-p 8080:8080`) and not firewalled — CORS is not the cause, since a browser
pointed at the host is making same-origin requests. Front it with TLS for
anything public (see [HTTPS](#https-on-a-real-domain)).

---

## Uninstall

```bash
npx exepad-app-builder down                       # stop + remove the container (keeps data)
docker volume rm exepad-data          # delete ALL data (irreversible)
rm -rf ~/.exepad                      # remove the install dir
```

---

## See also

- [Deployment reference](../latest/10-deployment.md) — architecture, env vars, the deploy pipeline.
- [Deploy templates](../../deploy/README.md) — Render / Coolify / Dokploy / app stores / Railway.
- [RELEASING.md](../../RELEASING.md) — how a release is cut: one tag publishes the image, the npm launcher, and the GitHub Release in lockstep.
