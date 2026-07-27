# Install Exepad

One self-hosted studio, one Docker container. Every path below ends at
**http://localhost:8080** where you create your operator account and paste your
LLM API key in Settings. (Only the Node-less path prompts for the key during
install — with Node 18+ present the installers hand off to `exepad up --yes`,
which runs unattended and never asks. Either way, Settings is where it lives.)

First run also asks for a **setup token** so a network-reachable instance can't
be claimed by whoever reaches it first. The container prints it at boot —
`docker logs exepad 2>&1 | grep -A2 'SETUP TOKEN'` — or skip the whole prompt by
seeding the account with `EXEPAD_ADMIN_EMAIL` + `EXEPAD_ADMIN_PASSWORD`.

**You need:** a 64-bit machine (x86_64 or arm64), 2 GB+ RAM free (8 GB
recommended), and an LLM API key (Gemini / OpenAI / Anthropic / OpenRouter…).
Those are **run-time** figures — [building the image](#build-from-source)
yourself is the heavier step and wants noticeably more RAM, CPU and free disk
than running it does.

## Install it

Every tagged release publishes the `exepad-app-builder` npm launcher, the
`ghcr.io/exepad/exepad-app-builder` image, and the installer downloads below.
Pick whichever suits the machine:

**macOS or Linux** (installs Docker for you on Linux if it's missing):

```bash
curl -fsSL https://get.exepad.com | bash
```

**Windows** (guides you through Docker Desktop if needed; no SmartScreen —
nothing is downloaded as an executable file):

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://get.exepad.com/install.ps1 | iex"
```

**Via npm** (any OS, Node 18+):

```bash
npx exepad-app-builder up
```

Prefer to verify before running? Download `install.sh` / `install.ps1` from
the release page (checksums alongside), read them, then run them — they are
the same scripts the one-liners fetch.

## Build from source

Prefer not to use a registry? Build the same image a release ships. Needs only
Docker and git, and works from any checkout:
```bash
git clone https://github.com/Exepad/exepad-app-builder.git && cd exepad-app-builder
docker build -t exepad-app-builder:local .
docker run -d --name exepad --restart unless-stopped \
  -p 8080:8080 -e EXEPAD_HTTPS_DISABLE=1 \
  -v exepad-data:/data exepad-app-builder:local
```

The build does a full pnpm workspace install, a serial `turbo run build`, a
Python layer and a bundled Chromium, so it takes a while and is far more
resource-hungry than the running container. Add `--build-arg EXEPAD_LITE=1` to
skip Chromium for the smaller "lite" image (**~1.7 GB** instead of **~3.1 GB**);
the only thing lost is dashboard thumbnails, which the entrypoint auto-disables.

`EXEPAD_HTTPS_DISABLE=1` turns the in-image Caddy off and serves plain HTTP on
`8080` — the right shape when you publish one port, and what the installers and
the CLI set when no `--domain` is given. Front it with your own TLS proxy for
anything public.

Serving it on a LAN IP or a server rather than `localhost`? That needs nothing
extra — browsing to `http://<host>:8080` is same-origin, and browsers never
apply CORS to same-origin requests. `EXEPAD_ALLOWED_ORIGINS` is optional and
only needed when a **different** origin makes credentialed `/api` calls (a
separate front end, a second domain, or a proxy serving a different hostname
than the browser calls); only `http://localhost` and `http://127.0.0.1` (any
port) are auto-allowed for that, as is any custom domain you registered and
verified in the studio (over `https://` on :443).

## Where to download

Everything below is attached to every GitHub Release —
**[Exepad/exepad-app-builder → Releases](https://github.com/Exepad/exepad-app-builder/releases/latest)**
(or `gh release download -R Exepad/exepad-app-builder`).

---

# Installer packages (download instead of a one-liner)

Every release also ships per-platform installer packages for anyone who
prefers a download over a terminal command.

## Windows — `Exepad-Installer-Windows.msi`

1. Download **Exepad-Installer-Windows.msi** and double-click it.
   *SmartScreen may show "Windows protected your PC" → click **More info → Run
   anyway** (expected until the release is code-signed).*
2. The setup console opens by itself and runs everything: Docker Desktop check
   (it opens the download page if missing — install it, start it, then Start
   Menu → **Install or Update Exepad Studio** to resume), image pull, start.
   It does not ask for an LLM key; add that in Settings on first login.
3. The studio opens at http://localhost:8080 when done. The Start Menu now has
   **Exepad Studio** (opens the app) and **Install or Update Exepad Studio**
   (re-runs setup — use it to repair or resume an interrupted install).

   > **That shortcut does not update you to a newer release.** The MSI bakes in
   > its own version, so re-running it always re-applies *that* version and
   > reports "Already at X.Y.Z". To update, download a newer MSI (or use
   > `npx exepad-app-builder update`, which does fetch the latest).

The MSI is per-user (no admin prompt) and installs only the tiny launcher.
Uninstalling it from *Add/Remove Programs* removes the launcher and shortcuts —
your running container and the `exepad-data` volume are never touched.

*Prefer no MSI?* **`Exepad-Installer-Windows.zip`** contains the same
installer: extract → double-click `Install Exepad.bat`.

## macOS — `Exepad-Installer-macOS.zip`

1. Download **Exepad-Installer-macOS.zip**; double-click to extract.
2. Open **`Install Exepad.command`** — the download isn't Apple-notarized yet,
   so approve it once:
   - **macOS 15 (Sequoia) and newer:** double-click it; when macOS says it
     "could not verify" the file, click **Done** (not "Move to Trash"), then
     **System Settings → Privacy & Security** → scroll down → **Open Anyway**
     → confirm.
   - **macOS 13/14:** right-click (Control-click) the file → *Open* → *Open*.

   After that one approval, plain double-click works.
3. **No Docker yet?** The installer opens the Docker Desktop download page
   (OrbStack works too). Install, start it, then run the `.command` again.
4. The studio opens at http://localhost:8080 when done.

## Linux — `Exepad-Installer-Linux.tar.gz`

Download, extract, run:

```bash
tar -xzf Exepad-Installer-Linux.tar.gz && bash install.sh
```

No Docker? It offers to install Docker Engine for you (Docker's official
script; it asks first). Servers/non-interactive: `bash install.sh --yes`.

Or collapse the download step into one line:

```bash
curl -fsSL https://github.com/Exepad/exepad-app-builder/releases/latest/download/install.sh | bash
```

## Node 18+ instead? (any OS)

```bash
npx exepad-app-builder up
```

The same tool then manages the install:

```bash
npx exepad-app-builder status | stop | start | restart | update | backup | restore
```

For a permanent command instead of `npx`: `npm i -g exepad-app-builder`, then `exepad up`.

---

## After installing

- **Update:** re-run the same installer from a newer release (your data is
  kept — it lives in a Docker volume, not the install dir). The CLI's
  `exepad update` additionally snapshots a backup first — prefer it when you
  have the CLI.
- **Your data** lives in the Docker volume `exepad-data` — updates and
  reinstalls never touch it. To back it up, prefer **`exepad backup`**: it stops
  the container first, which is what makes the snapshot trustworthy.

  The raw equivalent is:

  ```bash
  docker compose stop      # or: docker stop exepad
  docker run --rm -v exepad-data:/data:ro -v "$PWD":/b alpine \
    tar czf /b/exepad-backup.tgz -C /data .
  docker compose start     # or: docker start exepad
  ```

  > **Don't skip the stop.** `/data` holds SQLite databases in WAL mode. A live
  > `tar` reads the main file and its `-wal`/`-shm` sidecars at different
  > instants, so a checkpoint racing the copy yields a torn archive that restores
  > **corrupt** — and you find out at restore time, which is exactly when the
  > original is already gone. `exepad backup --no-stop` takes a hot copy on
  > purpose and prints the same warning.
- **HTTPS on a domain** (Linux server):
  `bash install.sh --domain studio.example.com --acme-email you@example.com`.
- **Image variants** (advanced, image: `ghcr.io/exepad/exepad-app-builder`):
  `:X.Y.Z` (full) and `:X.Y.Z-lite` (~1.4 GB smaller, no bundled Chromium —
  dashboard thumbnails auto-disable).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Docker daemon not reachable" | Start Docker Desktop / OrbStack (Mac/Win) or `sudo systemctl start docker` (Linux). |
| Pull fails with "denied" / "manifest unknown" | Check the tag exists: `docker manifest inspect ghcr.io/exepad/exepad-app-builder:X.Y.Z`. If your network filters registries, allowlist `ghcr.io`. Failing that, [build from source](#build-from-source) — it needs no registry. |
| Linux: installed Docker but permission denied | `sudo usermod -aG docker $USER`, log out/in, re-run. |
| Windows: WSL 2 errors from Docker Desktop | Run `wsl --update` in an admin terminal, reboot, start Docker Desktop again. |
| macOS: no "Open" option on right-click | You're on macOS 15+ — use System Settings → Privacy & Security → **Open Anyway** (see above). |
| Port 8080 busy | `bash install.sh --port 9090` (or `-Port 9090` on Windows PowerShell). The wrappers then skip the auto-open — use the URL the installer prints. |

Full option reference: [docs/install/README.md](docs/install/README.md) ·
Release process: [RELEASING.md](RELEASING.md)
