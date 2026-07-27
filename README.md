<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/exepad-logo-dark.svg" />
    <img src=".github/assets/exepad-logo-light.svg" alt="Exepad" width="88" height="88" />
  </picture>
</p>

<h1 align="center">Exepad</h1>

<p align="center">
  <strong>Describe an app. Get a real one — running on your own machine.</strong>
</p>

<p align="center">
  The open-source, self-hosted alternative to Lovable, Replit&nbsp;Agent and Base44.
</p>

<p align="center">
  <a href="https://github.com/Exepad/exepad-app-builder/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Exepad/exepad-app-builder?color=4f46e5&label=release"></a>
  <a href="LICENSE"><img alt="License AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-4f46e5"></a>
  <a href="https://github.com/Exepad/exepad-app-builder/pkgs/container/exepad-app-builder"><img alt="Container image" src="https://img.shields.io/badge/image-ghcr.io-4f46e5"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-4f46e5">
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="#what-you-can-build">What you can build</a> ·
  <a href="#setting-it-up">Setting it up</a> ·
  <a href="#put-it-on-a-server">Put it on a server</a> ·
  <a href="INSTALL.md">Install guide</a>
</p>

---

Describe what you want, **in your own language**. An AI agent plans it, builds
the interface, designs the database, sets up logins, and puts it online — all
inside **one container on a machine you control**.

It writes the app in the language you wrote to it in, so a Turkish prompt gives
you a Turkish interface. No cloud account, no subscription, no lock-in — and your
apps and their data never leave your machine.

```
  describe it  ──▶  the agent builds it  ──▶  preview  ──▶  publish  ──▶  live app
```

---

## Get started

One command. It downloads Exepad and starts it — and if Docker is missing it
installs it for you on Linux, or points you to Docker Desktop on macOS and
Windows.

**macOS and Linux**

```bash
curl -fsSL https://get.exepad.com | bash
```

**Windows** — paste into PowerShell

```powershell
irm https://get.exepad.com/install.ps1 | iex
```

**Any system with Node 18 or newer** — the same command manages the install afterwards

```bash
npx exepad-app-builder up
```

> [!TIP]
> Prefer downloading to typing? Every [release](https://github.com/Exepad/exepad-app-builder/releases/latest)
> ships a Windows installer (`.msi`), a macOS package, and a Linux archive —
> download, double-click, done. Steps in [INSTALL.md](INSTALL.md).

### Your first app, in three steps

**1. Open [http://localhost:8080](http://localhost:8080) and create your account.**

The installer shows you a **setup token** — copy it into the first screen. It is
there so that if your machine is reachable on a network, nobody else can claim
your studio before you do.

**2. Open Settings and add your AI key.**

Exepad does not include AI credits — you bring your own key, so you pay the
provider directly and nobody sits in between. Pick your provider from the list,
paste the key, save. [More on setup](#setting-it-up)

**3. Describe your app, and watch it get built.**

Each step happens in front of you. Preview the result, ask for changes the same
way you asked for the app, then publish it.

---

## What you can build

Working software with a real database and user accounts — not mockups or static
pages. The kind of thing it is built for:

- *"A client tracker where I can add companies, log calls against them, and see which deals are stuck."*
- *"An inventory list for my shop, with low-stock warnings and a photo for each item."*
- *"A booking page where customers pick a time slot, and a dashboard showing my week."*
- *"An internal wiki with sign-in, so only my team can read it."*

Each of those produces a multi-page application with a database behind it,
logins, file uploads, and a link you can share.

---

## What you get

| | |
|---|---|
| **A complete application** | A multi-agent builder plans the app, writes the interface, models the data, and connects it — in a single run you can watch. |
| **A genuine React front end** | Real components with proper styling and theming, not filled-in templates. |
| **A database, automatically** | Describe your data and get a full create, read, update and delete API over SQLite — plus custom logic where you need something specific. |
| **Accounts built in** | Per-app user sign-in, multiple pages, saved state and file uploads, out of the box. |
| **Changes by conversation** | Follow-up prompts edit the running app. No starting over. |
| **Works in your language** | Write to it in any language. It detects which one and writes the app's entire interface to match — or you can pick a different language for the app than the one you're writing in. |
| **A single container** | Interface, backend, database and AI agent in one image. Nothing else to install or wire together. |
| **Any AI provider** | Gemini, Anthropic, OpenAI, OpenRouter, or a model running on your own hardware. |
| **Genuinely yours** | AGPL-3.0 — and the apps you build are entirely your own. See [LICENSING.md](LICENSING.md). |

---

## Your data stays on your machine

Your prompts go to the AI provider you chose. Everything else — the applications,
their databases, uploaded files, and the accounts that sign into them — stays in
a folder on your own computer or server.

Three things reach the internet by default, none of them carrying your data: a
public-IP lookup at startup so HTTPS can name your machine, a Let's Encrypt
certificate request, and a version check when you open Settings. Set
`EXEPAD_NO_OUTBOUND=1` to switch all three off.

---

## Setting it up

**Everything is configured in the studio, not in config files.** After you sign
in, open **Settings**:

| In Settings | What you set there |
|---|---|
| **AI engine** | Your provider and API key — Google Gemini, OpenAI, Anthropic, OpenRouter, or any OpenAI-compatible endpoint (Ollama, vLLM, LM Studio). Includes a searchable model list. |
| **Access & Domains** | Your own domain and HTTPS, without touching a server config. |
| **Stock images** | Pexels, Unsplash, Pixabay or Openverse for photos in generated apps. |

Changes apply to your next build. No restart, no file editing, no redeploy.

Each app also gets its own **Admin** panel — users, database contents, uploaded
files, and sign-in rules — all from the same interface.

> [!IMPORTANT]
> **If you pick anything other than Gemini, choose a model too.** The built-in
> defaults are Gemini model names; on another provider they are sent unchanged,
> so the provider is asked for a model it does not have and every build fails
> without saying why. The Settings page lists the available models — pick one.

<details>
<summary><b>Setting up without the interface (unattended installs)</b></summary>

<br>

If you are scripting a deployment and want the instance configured before anyone
logs in, these environment variables seed the same settings on first boot.
Anything later saved in Settings overrides them.

| Provider | Variables |
|---|---|
| Google Gemini *(default)* | `EXEPAD_LLM_API_KEY` *(or `GEMINI_API_KEY`)* |
| Anthropic | `EXEPAD_LLM_PROVIDER=anthropic` · `EXEPAD_LLM_API_KEY=sk-ant-…` |
| OpenAI | `EXEPAD_LLM_PROVIDER=openai` · `EXEPAD_LLM_API_KEY=sk-…` |
| OpenRouter | `EXEPAD_LLM_PROVIDER=openrouter` · `EXEPAD_LLM_API_KEY=…` |
| Ollama, vLLM, LM Studio | `EXEPAD_LLM_PROVIDER=custom` · `EXEPAD_LLM_BASE_URL=http://host:11434/v1` |

On any non-Gemini provider also set `EXEPAD_LLM_MODEL_DEFAULT`, for the reason
above. `EXEPAD_ADMIN_EMAIL` and `EXEPAD_ADMIN_PASSWORD` create the operator
account so there is no browser setup step at all.

</details>

---

## Put it on a server

Already running? Add your domain under **Settings → Access & Domains** and the
certificate is handled for you.

Setting a server up from scratch, one command does the whole thing:

```bash
npx exepad-app-builder up --domain app.example.com --acme-email you@example.com
```

Prefer a hosting provider? One-click templates for **Render** and **Coolify,
Portainer and Dokploy** live in [deploy/](deploy/README.md).

A server needs **2 GB of RAM or more** and an ordinary disk — not network
storage, because the database needs real file locking. Run one instance per data
folder.

<details>
<summary><b>HTTPS, in more detail</b></summary>

<br>

The installers and `npx exepad-app-builder up` serve plain HTTP on port `8080`
unless you pass `--domain`, which is the right shape if you already run your own
HTTPS proxy. Pass a domain and they add automatic Let's Encrypt certificates.

From a checkout, `docker compose up` runs Caddy **inside the image** with no
extra sidecar, and issues certificates itself: an internal certificate for
`localhost` and LAN addresses (one browser warning the first time), and a fully
trusted Let's Encrypt certificate for your machine's own
`https://<your-public-ip-dashed>.sslip.io` if it is reachable from the internet —
with no domain to buy.

`./run.sh local` (from source, without Docker) serves a self-signed certificate
on `https://localhost` — port `443`, or `8443` without the privileged-port
capability — with plain HTTP also on `8090`. Turn all of it off with
`EXEPAD_HTTPS_DISABLE=1`.

Behind your own reverse proxy, forward `X-Forwarded-Proto` and
`X-Forwarded-Host`. A minimal Caddy configuration is
`app.example.com { reverse_proxy localhost:8080 }`.

</details>

---

## Backing up

Everything lives in one place: a Docker volume named `exepad-data`. Updating or
reinstalling never touches it.

```bash
npx exepad-app-builder backup
```

> [!WARNING]
> Use the command above rather than copying the folder while Exepad is running.
> The databases are written to continuously, so copying a live instance can
> produce an archive that looks fine and fails to restore — which you would
> discover at exactly the wrong moment. `backup` stops the container for you
> first.

<details>
<summary><b>The equivalent without the command-line tool</b></summary>

<br>

```bash
docker compose stop      # or: docker stop exepad
docker run --rm -v exepad-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/exepad-backup.tgz -C /data .
docker compose start     # or: docker start exepad
```

Check the archive actually contains something —
`tar tzf exepad-backup.tgz | head` should list `meta.sqlite`, `apps/`,
`storage/` and `secrets/`.

</details>

---

## Advanced configuration

> [!NOTE]
> You should not need any of this. Everything in normal use is in
> **[Settings](#setting-it-up)**. The variables below are for unattended
> installs and unusual network setups — anything saved in Settings overrides
> them.

<details>
<summary><b>Core settings</b></summary>

<br>

| Variable | Purpose |
|---|---|
| `EXEPAD_LLM_API_KEY` | AI key — required to build apps |
| `EXEPAD_LLM_PROVIDER` · `EXEPAD_LLM_BASE_URL` · `EXEPAD_LLM_MODEL_DEFAULT` | Provider selection (see above) |
| `EXEPAD_ADMIN_EMAIL` · `EXEPAD_ADMIN_PASSWORD` | Create the operator account on first boot instead of using the browser setup |
| `PEXELS_API_KEY` | Optional stock-image search for generated apps |
| `EXEPAD_FETCH_ALLOWLIST` | Hosts that deployed app logic may call out to (default: none) |
| `PORT` | The runtime's internal listener (default `8080`). Only meaningful with `EXEPAD_HTTPS_DISABLE=1` — the in-image Caddy proxies to `127.0.0.1:8080` and ignores this, so changing it on the default HTTPS path takes the studio offline. Move the public port in Settings → Server & network instead. |

Secrets (`EXEPAD_SESSION_SECRET`, `DEPLOY_SECRET`, and others) are generated on
first run and kept in the data volume. They are never regenerated, so logins and
preview links survive restarts.

</details>

<details>
<summary><b>Networking and custom domains</b></summary>

<br>

Reaching the studio on a LAN address or a custom domain needs no extra
configuration on its own — the browser talks to a single origin. These cover the
edge cases:

| Variable | Purpose |
|---|---|
| `EXEPAD_ALLOWED_ORIGINS` | Extra browser origins allowed to make signed-in `/api` calls. An exact origin (`https://app.company.com`), a `host:port`, or a `*.suffix` wildcard. `localhost` and `127.0.0.1` are allowed by default. **Optional** — browsing straight to the machine is same-origin and needs nothing. Set this only for a *different* origin, such as a separate front end. |
| `EXEPAD_COOKIE_SECURE` | `1` forces `Secure` cookies. Also automatic behind a proxy that forwards `X-Forwarded-Proto: https`. |
| `RESEND_API_KEY` | **Gates all account email** in your generated apps — address verification and password reset — through a [Resend](https://resend.com) relay. Unset by default, so those flows cannot send. Sign-up and sign-in work regardless. |
| `EXEPAD_EMAIL_FROM` · `EXEPAD_EMAIL_FROM_NAME` | The From address for that email. Needed alongside the key: the built-in default is an `@exepad.com` address you cannot verify with your own Resend account, so sends using it are rejected. |
| `EXEPAD_EMAIL_SENDER_DOMAINS` | From-address domains allowed for that email (default `exepad.com,exepad.app`). |
| `EXEPAD_CDN_DOMAIN` · `EXEPAD_APP_DOMAIN` | Advanced content-security-policy overrides, only needed when serving assets from a custom CDN. |

</details>

<details>
<summary><b>What the agent is allowed to generate (advanced)</b></summary>

<br>

| Variable | Purpose |
|---|---|
| `ALLOWED_FETCH_DOMAINS` | Extra hosts the agent may call from generated code; anything else is rewritten to a placeholder |
| `ALLOWED_IMAGE_DOMAINS` | Extra image hosts allowed in generated components |

These are a different layer from `EXEPAD_FETCH_ALLOWLIST`: that one governs what
a **deployed** app may call at runtime, while these govern what the agent will
**write** at build time.

</details>

---

## How it works

<details>
<summary><b>Architecture</b></summary>

<br>

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

Cloudflare bindings are replaced by local adapters: R2 becomes the filesystem, D1
becomes `better-sqlite3`, Workers-for-Platforms dispatch becomes an in-process
`fetch()` call, and KV and Cache become in-memory shims. The agent compiles
component and handler TSX to JavaScript with esbuild at deploy time.

</details>

<details>
<summary><b>Build it from source</b></summary>

<br>

No registry and no accounts — only Docker and a checkout. This produces the same
image the installers download:

```bash
git clone https://github.com/Exepad/exepad-app-builder.git && cd exepad-app-builder
docker build -t exepad-app-builder:local .
docker run -d --name exepad --restart unless-stopped \
  -p 8080:8080 -e EXEPAD_HTTPS_DISABLE=1 \
  -v exepad-data:/data exepad-app-builder:local
```

Building costs considerably more than running: a full workspace install, a serial
compile, a Python layer and a bundled Chromium. It takes a while and wants far
more memory, CPU and disk than the roughly 2 GB the running container needs — a
small machine is better used to *run* an image built elsewhere.
`--build-arg EXEPAD_LITE=1` skips Chromium for a smaller image (**~1.7 GB**
rather than **~3.1 GB**); the only loss is dashboard thumbnails, which then
switch themselves off.

To have the container handle HTTPS itself, drop `EXEPAD_HTTPS_DISABLE=1` and use
the bundled compose file, which uses host networking so it can bind `:80` and
`:443`:

```bash
docker compose up --build      # then open https://localhost
```

</details>

<details>
<summary><b>Working on Exepad itself</b></summary>

<br>

`./run.sh` is the development wrapper — it rebuilds from your working tree on
every start, so it is for working on Exepad rather than running a real instance.

```bash
git clone https://github.com/Exepad/exepad-app-builder.git && cd exepad-app-builder
./run.sh                 # build and run the single container (docker compose)
#   ./run.sh local       # …or from source, without Docker (runtime :8090, agent :8081;
#                          needs `pnpm install` and the agent venv)
#   ./run.sh stop        # stop the container
```

Open **https://localhost** and accept the one-time local-certificate warning. Set
the AI key in Settings after the first login, or seed it beforehand with
`echo "EXEPAD_LLM_API_KEY=your-key" > .env`.

The first login asks for a setup token: `./run.sh local` prints it at startup,
and `./run.sh` prints it in the compose logs. `EXEPAD_ALLOW_OPEN_SETUP=1` skips
the prompt on a purely local machine.

Layout and commands: [`CLAUDE.md`](CLAUDE.md), the `apps/*/CLAUDE.md` files, and
the [development guide](docs/latest/12-development-guide.md).

</details>

---

## Security

Exepad is **single-tenant and trusting by design**: you run your own instance and
you trust the applications you generate on it. Generated logic runs in a
restricted scope — its own database only, no filesystem or process access, and
outbound calls gated by `EXEPAD_FETCH_ALLOWLIST` — but that boundary enforces the
build-time validators rather than defending against deliberately hostile code.

In practice: do not hand a shared instance to people you do not trust, and do not
run generated applications you have not reviewed.

Found a vulnerability? Please report it privately — see
[`SECURITY.md`](SECURITY.md) — rather than opening a public issue.

---

## License

Exepad is licensed under the **GNU Affero General Public License v3.0** — see
[`LICENSE`](LICENSE). You are free to run, study, modify and share it. If you run
a *modified* version as a service for other people, the AGPL asks you to offer
those users your modifications.

**The applications you build with Exepad are entirely your own.** Exepad LLC
claims no ownership of and no copyright interest in them, and an explicit AGPL
section 7 permission lets you license them however you like, including closed and
commercial. The details in plain English: [`LICENSING.md`](LICENSING.md).

Forks are welcome. They simply ship under their own name — see
[`TRADEMARK.md`](TRADEMARK.md).

---

<p align="center">
  <a href="INSTALL.md">Install guide</a> ·
  <a href="docs/install/README.md">Full reference</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="https://github.com/Exepad/exepad-app-builder/issues">Issues</a>
</p>

<p align="center"><sub>Built by Exepad LLC and contributors.</sub></p>
