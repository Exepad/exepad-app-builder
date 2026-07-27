<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/exepad-logo-dark.svg" />
    <img src=".github/assets/exepad-logo-light.svg" alt="Exepad" width="96" height="96" />
  </picture>
</p>

<h1 align="center">Exepad — open-source, self-hosted AI app builder</h1>

<p align="center"><strong>The self-hostable, open-source alternative to Lovable, Replit, and Base44.</strong></p>

Exepad turns a prompt into a real, deployed web app. Describe what you want, an
AI agent plans and builds it, and it's compiled, deployed, and served — all
inside **one container** on your own machine. No Cloudflare, no cloud accounts,
no vendor lock-in — just the LLM API key you choose. Your prompts, code, and
data never leave your box.

```
You ──prompt──▶ Agent builds app ──▶ compiled + deployed in-container ──▶ Preview ──▶ Publish ──▶ Live
```

## Quickstart

Build the image and run it — this needs nothing but Docker and a checkout, no
registry and no accounts:

```bash
git clone https://github.com/exepad/exepad-app-builder.git && cd exepad-app-builder
docker build -t exepad-app-builder:local .
docker run -d --name exepad --restart unless-stopped \
  -p 8080:8080 -e EXEPAD_HTTPS_DISABLE=1 \
  -v exepad-data:/data exepad-app-builder:local
```

**Building costs more than running.** The `docker build` step does a full pnpm
workspace install, a serial `turbo run build`, a Python layer and a bundled
Chromium — expect it to take a while and to need noticeably more RAM, CPU and
free disk than the ~2 GB the running container needs; a minimum-spec box is
better used to *run* an image built elsewhere. Passing
`--build-arg EXEPAD_LITE=1` skips Chromium, producing the smaller "lite" image
(**~1.7 GB** vs **~3.1 GB**) whose only loss is dashboard thumbnails, which the
entrypoint then auto-disables.

`EXEPAD_HTTPS_DISABLE=1` turns the in-image Caddy off and serves plain HTTP on
`8080` — the right shape when you publish one port (the installers and the CLI
set it too when no `--domain` is given); put your own TLS proxy in front for
anything public. Want the container to terminate TLS itself instead? That's the
`docker compose up` path — see [HTTPS out of the box](#https-out-of-the-box).

Then open **http://localhost:8080** and create your operator account. First run
asks for a **setup token** — so a network-reachable instance can't be claimed by
whoever reaches it first — and the container prints it at boot:

```bash
docker logs exepad 2>&1 | grep -A2 'SETUP TOKEN'
```

Paste your LLM API key, type a prompt, watch the build stream live, and click
**Publish** to serve the app at `/a/{appId}/`. (Seeding the account headlessly
with `-e EXEPAD_ADMIN_EMAIL=… -e EXEPAD_ADMIN_PASSWORD=…` skips the token
entirely.)

> **Serving it on a LAN IP or a server instead of `localhost`?** Browsing
> straight to `http://192.168.1.10:8080` works as-is — the page and the API share
> an origin, and browsers never apply CORS to same-origin requests.
> `EXEPAD_ALLOWED_ORIGINS` is *optional*, and only needed when a **different**
> origin makes credentialed `/api` calls: a separate front end, a second domain,
> or a proxy serving a different hostname than the browser calls. Only
> `http://localhost` and `http://127.0.0.1` (any port) are auto-allowed for that
> — as is any custom domain you registered and verified in the studio (over
> `https://` on :443). Add your own with
> `-e EXEPAD_ALLOWED_ORIGINS=https://app.example.com`.
> See [Networking & custom domains](#networking--custom-domains-optional).

### HTTPS out of the box

Prefer the container to terminate TLS itself? Drop `EXEPAD_HTTPS_DISABLE=1` and
run the bundled compose file instead (host networking, so it can bind
`:80`/`:443`):

```bash
docker compose up --build      # then open https://localhost
```

`docker compose up` runs Caddy **in-process inside the image** (no sidecar,
nothing extra to install) and it auto-issues certificates — its internal CA for
`localhost`/LAN (a one-time browser warning), and a **browser-trusted** Let's
Encrypt cert for this box's own `https://<your-public-ip-dashed>.sslip.io` when
it's publicly reachable (no domain to buy). `./run.sh local` (from source, no
container) serves an auto-minted self-signed cert on `https://localhost` (:443,
or :8443 without the privileged-port capability), with plain HTTP also on
`:8090`. Turn it all off with `EXEPAD_HTTPS_DISABLE=1`.

### Once the first release is published

One tag publishes the image to GHCR, the `exepad` launcher to npm, and
per-platform installers to GitHub Releases (see [RELEASING.md](RELEASING.md)) —
none of them exist before that tag
([what's gated](docs/install/README.md#once-the-first-release-is-published)).
From then on these are the shortest paths.

**macOS or Linux** (installs Docker for you on Linux if it's missing):

```bash
curl -fsSL https://get.exepad.com | bash
```

**Windows** (guides you through Docker Desktop if needed):

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://get.exepad.com/install.ps1 | iex"
```

**Via npm** (Node 18+) — the same tool manages the install afterwards
(`npx exepad status | stop | start | update | backup | logs | doctor`):

```bash
npx exepad up
```

▸ Prefer a download? Every
[GitHub Release](https://github.com/Exepad/exepad-app-builder/releases/latest)
also ships an installer package for your platform (Windows
MSI/zip, macOS zip, Linux tarball) — steps in [INSTALL.md](INSTALL.md). Full
options (versions, ports, domains, providers):
[install guide](docs/install/README.md).

## What it does

- **Prompt → full-stack app.** A multi-agent builder (Google ADK) plans the app,
  writes the UI, models the data, and wires it together in one streamed run.
- **Real React frontend.** Agent-authored "Code Focus" TSX components rendered as
  a live React app with compiled Tailwind styling and theming — not templates.
- **Auto-CRUD backend + custom logic.** Define data models and get a full
  create/read/list/update/delete API over SQLite automatically, plus custom TSX
  handlers for anything bespoke — with per-user data scoping (`owner_id`).
- **Built-in auth & multi-page apps.** Per-app user accounts, routing, shared
  state (with `$persist`), and file uploads out of the box.
- **Live studio.** Watch the build stream in real time, preview instantly, and
  **Publish** to a stable `/a/{appId}/` URL. Edit any app with a follow-up prompt.
- **One self-hosted container.** Node runtime + Python agent + SQLite in a single
  Docker image (bare Node + local adapters — no Cloudflare/D1/R2/Workers). Run
  it with the bundled `docker compose` (host networking) and it terminates HTTPS
  itself on `:80`/`:443` via an in-image Caddy; the Quickstart, and the
  installers and CLI without `--domain`, instead publish plain HTTP on `8080`
  for you to front (pass `--domain` and they add a Caddy sidecar for HTTPS).
- **Bring your own LLM.** Gemini (default), Anthropic, OpenAI, OpenRouter, or a
  local model (Ollama/vLLM/LM Studio) via LiteLLM.
- **Open source, your data.** AGPL-3.0. Everything runs and stays on your own
  infrastructure.

## Deploy to a server

Once the launcher is published, one command — add a domain and the studio fronts
itself with automatic HTTPS (Let's Encrypt via a Caddy sidecar):

```bash
npx exepad up --domain app.example.com --acme-email you@example.com
```

Before then, build the image on the server with the [Quickstart](#quickstart)
above and put your own TLS proxy in front of `:8080`.

Prefer a managed host? One-click templates for **Render** and **Coolify /
Portainer / Dokploy** (plus a Railway service config you wire up yourself) live
in [deploy/](deploy/README.md).

A server needs **≥ 2 GB RAM** and a persistent, POSIX `/data` disk (no NFS/SMB —
SQLite needs file locks), and runs as a **single instance**. Behind your own
reverse proxy instead, forward `X-Forwarded-Proto`/`X-Forwarded-Host` — see
[Networking & custom domains](#networking--custom-domains-optional) below.

## Choosing an LLM provider

There are **two** defaults, one per path: with no settings saved the build agent
falls back to **Google Gemini** (`EXEPAD_LLM_PROVIDER` unset), while the in-app
**Settings** page (`/settings`) opens on **OpenRouter** — and anything saved
there overrides the env vars. To use any other vendor via LiteLLM, set the
provider (and a base URL for OpenAI-compatible endpoints):

| Provider | Env |
|---|---|
| Gemini (default) | `EXEPAD_LLM_API_KEY` *(or `GEMINI_API_KEY`)* |
| Anthropic | `EXEPAD_LLM_PROVIDER=anthropic` · `EXEPAD_LLM_API_KEY=sk-ant-…` |
| OpenAI | `EXEPAD_LLM_PROVIDER=openai` · `EXEPAD_LLM_API_KEY=sk-…` |
| OpenRouter | `EXEPAD_LLM_PROVIDER=openrouter` · `EXEPAD_LLM_API_KEY=…` |
| Ollama / vLLM / LM Studio | `EXEPAD_LLM_PROVIDER=custom` · `EXEPAD_LLM_BASE_URL=http://host:11434/v1` |

> **On a non-Gemini provider you must also set a model.** The built-in per-agent
> defaults are `gemini-*` ids, and on another vendor they are passed through
> as-is — e.g. OpenRouter is asked for `openrouter/gemini-3-flash-preview`, which
> does not exist, so every build fails with nothing obvious to diagnose. Set
> `EXEPAD_LLM_MODEL_DEFAULT` (or pick a model on the **Settings** page); per-agent
> `{AGENT}_MODEL` overrides still win.

See `apps/agent/env.example` for the full list of knobs.

## Configuration

> **Tip:** once you're logged in, the easiest way to set your LLM key, provider,
> and model is the in-app **Settings** page (`/settings`). It defaults to
> OpenRouter and lets you search the live OpenRouter model catalogue. Settings
> are stored on the instance, override the variables below, and take effect on
> your next build — no restart needed. The env vars are the first-boot seed /
> fallback and remain useful for headless setups.

| Variable | Purpose |
|---|---|
| `EXEPAD_LLM_API_KEY` | LLM key (**required** to build apps) |
| `EXEPAD_LLM_PROVIDER` / `EXEPAD_LLM_BASE_URL` / `EXEPAD_LLM_MODEL_DEFAULT` | Provider selection (above) |
| `EXEPAD_ADMIN_EMAIL` / `EXEPAD_ADMIN_PASSWORD` | Seed the operator account on first boot (else use the in-browser setup) |
| `PEXELS_API_KEY` | Optional stock-image search for generated apps |
| `EXEPAD_FETCH_ALLOWLIST` | Comma-separated host allowlist for handler outbound `fetch` (default deny) |
| `PORT` | Public port inside the container (default `8080`) |

Secrets (`EXEPAD_SESSION_SECRET`, `DEPLOY_SECRET`, …) are generated on first run
and persisted to the data volume — they are never regenerated, so sessions and
preview links survive restarts. You can override any of them with `-e`.

### Networking & custom domains (optional)

With `EXEPAD_HTTPS_DISABLE=1` the in-image Caddy is skipped and the runtime
serves plain HTTP on `8080`. Reaching it on a **LAN IP** or a **custom domain**
(usually behind a TLS-terminating reverse proxy) needs no extra config on its
own — the browser talks to one origin. These tune the edge cases:

| Variable | Purpose |
|---|---|
| `EXEPAD_ALLOWED_ORIGINS` | Comma/pipe-separated allowlist of extra browser origins for credentialed `/api` calls (CORS). Each entry is an exact origin (`https://app.company.com`), a `host:port` (`192.168.1.10:8080`), or a `*.suffix` wildcard (`*.company.com`). `localhost`/`127.0.0.1` are allowed by default (turn that off with `EXEPAD_STRICT_LOCAL_CORS=1`, or "Strict local CORS" in the Server & networking panel). **Optional** — browsing directly to the host is same-origin and needs nothing; set this only for *cross-origin* callers. |
| `EXEPAD_COOKIE_SECURE` | Set to `1` to force the `Secure` flag on session/preview cookies. Also auto-enabled when the request arrives with `X-Forwarded-Proto: https` (so a TLS-terminating proxy "just works" — forward that header). Leave unset for plain-HTTP LAN access. |
| `EXEPAD_EMAIL_FROM` / `EXEPAD_EMAIL_FROM_NAME` | From-address (and display name) for per-app auth email — signup verification and password reset. **Required to actually deliver mail:** the built-in default is an `@exepad.com` address you cannot verify with your own email provider, so sends are rejected without this. Use a domain you control. |
| `EXEPAD_EMAIL_SENDER_DOMAINS` | Comma-separated From-address domains allowed for auth emails (default `exepad.com,exepad.app`). Set this to the domain you used in `EXEPAD_EMAIL_FROM`, or to an empty string to allow any. |
| `EXEPAD_CDN_DOMAIN` / `EXEPAD_APP_DOMAIN` | Advanced CSP overrides. Self-host emits a clean same-origin CSP by default; only set these if you front the SDK/extension assets from a custom CDN or embed the app under a specific parent domain. |

> **Reverse proxy:** terminate TLS at Caddy/Traefik/nginx (or a Cloudflare
> Tunnel) and forward `X-Forwarded-Proto` and `X-Forwarded-Host`. A minimal Caddy
> config: `app.example.com { reverse_proxy localhost:8080 }` (Caddy sets those
> headers and auto-provisions Let's Encrypt certs). Add
> `EXEPAD_ALLOWED_ORIGINS=https://app.example.com` only if the proxy serves a
> hostname other than the one the browser calls, or another origin calls the API.

### Generated-app build knobs (optional, advanced)

These influence what the **agent** allows in generated code (it validates and may
otherwise rewrite to placeholders):

| Variable | Purpose |
|---|---|
| `ALLOWED_FETCH_DOMAINS` | Extra hosts permitted in generated handler/component `fetch()` calls (space/comma-separated). `localhost`/`127.0.0.1`/`.local` are allowed automatically outside production. |
| `ALLOWED_IMAGE_DOMAINS` | Extra image hosts permitted in generated components (space/comma-separated), so self-host image URLs aren't stripped to placeholders. |

> Note: `EXEPAD_FETCH_ALLOWLIST` (above) gates **runtime** outbound `fetch` from
> deployed handlers; `ALLOWED_FETCH_DOMAINS` gates what the agent will **emit** at
> build time — two different layers.

## Data & backup

Everything lives under the `/data` volume: `meta.sqlite` (users/apps/deployments),
per-app SQLite databases, object storage (configs + compiled output + snapshots),
uploads, agent sessions, and generated secrets. Back up by archiving the volume:

```bash
docker run --rm -v exepad-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/exepad-backup.tgz -C /data .
```

> **Consistency:** stop the container (`docker compose stop`) before archiving so
> the SQLite databases are not copied mid-write. Backing up a running instance can
> capture a torn database file that fails to restore. Restart once the archive is
> complete.

## Development

Working on Exepad itself? `./run.sh` is the **dev wrapper** — it rebuilds from
your working tree on every start, so it's for hacking on Exepad, not for
operating a real instance ([Quickstart](#quickstart) is that). It builds and
runs the whole rig:

```bash
git clone https://github.com/exepad/exepad-app-builder.git && cd exepad-app-builder
./run.sh                 # build + run the single container (docker compose)
#   ./run.sh local       # …or run from source, no Docker (Node runtime :8090 + Python
#                          agent :8081; needs `pnpm install` + the agent venv)
#   ./run.sh stop        # stop the container
```

Open **https://localhost** (accept the one-time local-cert warning — HTTPS is on
with zero config, see [HTTPS out of the box](#https-out-of-the-box)). Set the
LLM key in **Settings** after first login, or seed it headlessly with
`echo "EXEPAD_LLM_API_KEY=your-key" > .env` before starting.

First login asks for a **setup token**: `./run.sh local` prints it in its
startup output, and `./run.sh` (container) prints it in the compose log stream.
Set `EXEPAD_ALLOW_OPEN_SETUP=1` to skip the prompt on a purely local box.

Monorepo layout, commands, and per-app details:
[`CLAUDE.md`](CLAUDE.md), the `apps/*/CLAUDE.md` files, and the
[development guide](docs/latest/12-development-guide.md).

## Architecture

One image runs two processes behind a single public port:

```
:8080  Node runtime (Hono on @hono/node-server)
        ├─ /                       builder UI (login / studio / apps)
        ├─ /a/{id} · /a/preview-…  rendered generated apps
        ├─ /api/{id}/…             gateway → in-process app-backend (auto-CRUD + handlers)
        ├─ /api/orchestrate/…      prompt → build → compile → deploy
        ├─ /api/deploy · /auth/…   deploy pipeline + local auth
        └─ /agent/*                reverse-proxy ▼
:8081  Python agent (ADK / FastAPI) — the multi-agent app builder (loopback only)

/data  meta.sqlite · per-app *.sqlite · storage/ · uploads/ · agent sessions · secrets/
```

Cloudflare bindings are replaced by local adapters: R2 → filesystem, D1 →
`better-sqlite3`, Workers-for-Platforms dispatch → an in-process `fetch()` call,
KV/Cache → in-memory shims. The agent compiles component/handler TSX → JS with
esbuild at deploy time.

## Security model

Single-tenant and trusted: the operator runs their own instance and trusts the
apps they generate. Generated handlers run in a constrained `node:vm` scope (own
database only; no `fs`/`process`; outbound `fetch` gated by
`EXEPAD_FETCH_ALLOWLIST`). `node:vm` is a soft boundary that enforces the
generation-time validators, **not** a hard sandbox against deliberately
malicious code — don't expose a shared instance to untrusted prompt authors, and
don't run generated apps you haven't reviewed.

Found a vulnerability? Report it privately — see [`SECURITY.md`](SECURITY.md).
Please don't open a public issue for security reports.

## License

Exepad is licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0) — see [`LICENSE`](LICENSE). You're free to run your own instance,
study, modify, and redistribute it. If you run a modified version as a network
service, the AGPL requires you to offer that service's users the corresponding
source of your modifications.

**The apps you build with Exepad are yours.** Exepad LLC claims no ownership of
and no copyright interest in them, and an explicit AGPL §7 additional permission
lets you license them however you like — including closed and commercial. The
copyleft covers changes to Exepad itself, not what you build with it.
[`LICENSING.md`](LICENSING.md) explains the whole picture, including commercial
licensing for organisations that can't use AGPL.

**The Exepad name and logo are trademarks of Exepad LLC**, and the code licence
doesn't grant rights to them — forks and hosted services are welcome, they just
need their own name. [`TRADEMARK.md`](TRADEMARK.md) spells out what you can use
without asking.

Third-party code included in this repository is attributed in
[`NOTICE`](NOTICE).

Copyright © 2026 Exepad LLC and contributors.
