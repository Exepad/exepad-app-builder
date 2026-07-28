# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions 0.1.0–0.4.0 were tagged and built before this repository was public:
their images were pushed to a private registry, no npm package was published,
and no artifact was distributed publicly. Those entries are kept as the record of
what each release changed, lightly corrected where they described infrastructure
that was never made public — read them as history, not as a description of the
current docs or install paths.

## [Unreleased]

### Fixed

- **The GitHub Release job is now idempotent.** Re-running the release workflow
  is the documented recovery when a later job fails, but `gh release create`
  hard-fails with *"a release with the same tag name already exists"* — so the
  re-run intended to fix npm instead took the release job down and skipped the
  MSI with it, for a release that was already complete. It now updates the notes
  and re-uploads assets when the release exists. That is also how a release which
  shipped without an npm section gets one after a manual publish, since the notes
  are conditional on whether npm published.
- **`install.sh` now says how to get the Compose v2 plugin on macOS.** The check
  itself was right, but *"Docker Compose v2 plugin is required (got
  legacy/none)"* left the user with nothing to act on — and it is a common real
  setup, not an edge case: `brew install docker` ships the CLI alone, Homebrew's
  `docker-compose` is a separate formula, and Homebrew does not register it as a
  CLI plugin. So `docker-compose` works while `docker compose` does not, and the
  installer reads as *"I installed Docker and it still says Docker is missing."*
  Docker Desktop and OrbStack bundle the plugin, which is why this stayed
  invisible. macOS now gets the exact commands including the `cli-plugins`
  symlink; other platforms get the plugin-package hint.

### Added

- **`container-smoke` workflow** — real-container coverage on hosted macOS
  (Colima on the Intel image) and Windows (Docker Engine inside WSL2, driven by
  the Windows `docker` CLI), so the pull-start-serve half of the product is no
  longer proven on Linux alone. This is what surfaced the Compose-plugin message
  above.
- **The image is built on pull requests.** Previously the only workflow that
  built the `Dockerfile` triggered on a tag, so a base-image bump could merge
  unverified and fail mid-release. Dependabot's first batch made that concrete
  with `node 22→26` and `python 3.12→3.14`, both major and both with no checks
  at all. `packaging-ci` now builds amd64 (no push, cached) whenever the image
  actually changes.
- **npm provenance on the launcher.** The images have been cosign-signed since
  1.0.0 but the npm package carried no attestation, which is the wrong way round
  — the launcher is what pulls and runs a container on someone's machine.
  `--provenance` is applied on the trusted-publishing path only, because it is
  generated from the Actions OIDC token and passing it on the `NPM_TOKEN`
  fallback would fail the publish outright.

## [1.0.1] - 2026-07-28

**The release that makes 1.0.0 installable.** `v1.0.0` published its image and
then stopped: the npm job could not authenticate, and because the GitHub Release
was gated on that job, no `install.sh`, no one-click bundles and no MSI were ever
produced for it. Three defects sat behind that, all fixed here. If you are
installing for the first time, start at this version.

### Fixed

- **`curl … | bash` no longer depends on npm.** `install.sh` delegates to the
  `npx exepad-app-builder` launcher when Node ≥18 is present — an optimisation,
  since the embedded bootstrap emits the same `docker-compose.yml`, `.env` and
  version marker and ends at the same image. But a failed delegation called
  `exit`, so npm being down, rate-limiting the box, or simply not having the
  version killed the install outright *for the people who had Node installed*,
  on machines where the fallback two lines below would have worked. Delegation
  is now probed first and falls through to the bootstrap when the launcher is
  unavailable, with a message saying so. Same fix in `install.ps1`, and so in
  the one-click bundles and the MSI, which embed these scripts.
- **The npm launcher can no longer be published without its image.** The
  hand-published `1.0.0-rc.3` was never git-tagged, so no image was ever built
  for it — and because `npm publish` moves the `latest` dist-tag, plain
  `npx exepad-app-builder up` resolved to a launcher that pulled
  `ghcr.io/exepad/exepad-app-builder:1.0.0-rc.3` and failed with `not found`,
  for every user. It went unnoticed because `--dry-run` prints the pull rather
  than performing it. The release workflow now runs `docker manifest inspect`
  on the matching tag and refuses to publish if it is missing.
- **The first-run setup token is now shown by every installer, not just the npm
  launcher.** The container prints it to stderr once at boot, but every install
  path starts it detached — so the banner goes to the logs and nobody sees it.
  Users then met a setup screen demanding a token nothing had shown them, and
  the only way out was `docker logs … | grep`, which a one-click bundle user on
  macOS or Windows has no reason to know. The npm launcher already read it back;
  `install.sh` and `install.ps1` now do too, which covers most server installs,
  all three one-click bundles, the Windows MSI, and any Node install where the
  npm launcher was unreachable. Skipped when `EXEPAD_ADMIN_EMAIL` +
  `EXEPAD_ADMIN_PASSWORD` seeded the operator (no token is minted) or when
  `EXEPAD_ALLOW_OPEN_SETUP` is set.
- **A failed npm publish no longer withholds every other install path.** The
  GitHub Release is gated on the image, which is what `install.sh`,
  `install.ps1`, the bundles and the MSI actually install from. When npm does
  not publish, the release notes omit the npm section instead of pointing
  readers at a version the registry does not have.

### Changed

- The release workflow accepts either credential for npm: trusted publishing
  (OIDC) is attempted first, and an `NPM_TOKEN` secret — which must be a
  granular token with *bypass 2FA* enabled — is used only as a fallback. The
  token is never written to `.npmrc` before the OIDC attempt, because any
  `_authToken` line makes npm skip the exchange entirely.

## [1.0.0] - 2026-07-27

**The first public release.** Versions 0.1.0–0.4.0 were tagged privately, so
nothing below is an upgrade path anyone travelled — read this as the description
of what 1.0.0 *is*, not as a diff you need to act on. This is also the first
release to publish anything: the `ghcr.io/exepad/exepad-app-builder` image, the
`exepad-app-builder` npm launcher, and the per-platform installers on the GitHub Release all
begin existing here.

### Added

- **`LICENSING.md`** — a plain-English licence page, and the **AGPL-3.0 section 7
  additional permission** that goes with it: applications you build with Exepad
  are your own work and may be licensed under any terms, including closed and
  commercial. The permission also covers the **Exported Components** that
  project-export ("eject") emits — an unmodified copy of the SDK, the built
  standalone backend bundle, and the generated scaffolding — and separately
  permits modifying and relicensing that scaffolding, which is emitted for you to
  build on. Exepad LLC claims no ownership of, and no copyright interest in, the
  applications you build, including code the agent generates at your direction.
- **AGPL-3.0 section 13 source offer, served by the software itself.**
  `GET /source` redirects to the source repository, a `<link rel="license">` is
  injected into every served page, and the studio's About page shows the running
  version, commit, and a source link. The first two are deliberately
  unauthenticated: section 13 exists for the anonymous users of *served apps*, and
  an offer reachable only from inside the authenticated studio reaches only the
  person who doesn't need it. All three read one value, so a fork repoints them by
  setting `EXEPAD_SOURCE_URL` — a Docker build arg for the bundled studio and an
  environment variable for the server, both wired through `docker-compose.yml` —
  rather than patching source.
- **`TRADEMARK.md`** — the section 7(e) reservation of the Exepad name and logo.
  Permissive about nominative use and about forks keeping internal identifiers
  (`@exepad/*` workspace names, the CLI command, `EXEPAD_*` variables); firm about
  public registry names and product identity. Forks are welcome and simply ship
  under their own name.
- **`NOTICE`** — third-party attribution for shadcn/ui (MIT; 53 + 17 components
  derived from it) and for the OFL-1.1 webfonts whose `.woff2` files are emitted
  into the client bundle and copied into the image (Geist, Geist Mono, Inter).
  `LICENSE` and `NOTICE` are copied into the image at `/app/`, so a distributed
  container carries the terms alongside the binaries they cover.
- **macOS installer CI.** A new `installer-macos` job on `macos-latest`
  *executes* `install.sh` under the system **bash 3.2** — macOS's `/bin/bash`, and
  therefore the interpreter `curl … | bash` actually runs on a Mac, where a
  bash-4-ism would pass the Ubuntu parse job and then fail on every user's
  machine. It also extracts the one-click bundle with `ditto` (Archive Utility's
  real engine) to prove the `.command` keeps its executable bit through a genuine
  extraction, and checks that both documented Gatekeeper remedies still match what
  `README.txt` tells users. macOS previously had no execution coverage at all.
- **First-run setup token for `./run.sh local`.** The from-source rig now mints
  an `EXEPAD_SETUP_TOKEN` on first start, persists it alongside the other
  per-instance secrets (`<data-dir>/secrets/env.sh`, so a restart doesn't lock
  out a half-finished setup) and prints it at startup — mirroring what
  `docker/entrypoint.sh` already did for the container. `/auth/setup` has always
  required the token *when one is configured*, but the local path never
  configured one, so first-run setup on a rig that binds every interface was
  open to whoever reached it first. Seed `EXEPAD_ADMIN_EMAIL` +
  `EXEPAD_ADMIN_PASSWORD` to skip the browser flow, or set
  `EXEPAD_ALLOW_OPEN_SETUP=1` to keep tokenless setup on a purely local box.

### Changed

- **The npm launcher publishes as `exepad-app-builder`, not `exepad`.** npm
  refuses the name `exepad` outright — its typosquat protection rejects it as
  *"too similar to existing package execa"* — so the short name was never
  obtainable, whatever the account or token. The launcher now matches the repo
  and the image (`ghcr.io/exepad/exepad-app-builder`), which is the name it
  should probably have carried anyway.

  **The command is unchanged.** The package's `bin` is still `exepad`, so
  `npm i -g exepad-app-builder` then `exepad up` works exactly as before; only
  the one-shot form lengthens, to `npx exepad-app-builder up`. `install.sh` and
  `install.ps1` delegate to the new package name automatically.
- **The install docs lead with the one-liners, because as of this release they
  resolve.** README, `INSTALL.md`, `docs/install/README.md` and the deployment
  reference had documented `curl | bash`, `irm | iex`, `npx exepad-app-builder up` and the
  prebuilt image behind an explicit "once the first release is published" gate,
  and led with building from a checkout instead — the only path that worked with
  no registry and no accounts. This tag publishes all of them, so the gate is
  gone and the Quickstart is one command per platform. Building from source
  remains documented, as the alternative for anyone who would rather not pull a
  prebuilt image.
- **Contributions are licensed to Exepad LLC beyond plain inbound=outbound.**
  `CONTRIBUTING.md` now asks contributors for a perpetual, irrevocable copyright
  licence **including under terms other than AGPL-3.0**, plus a matching patent
  licence and a representation that they have the right to grant it. This cannot
  take the project proprietary — the AGPL-3.0 grant to everyone is irrevocable —
  and a contributor may opt out of that clause in their pull request. Without it,
  offering a commercial licence would require every outside contributor's
  individual consent, one at a time, forever.
- **Vendor-origin CORS is cloud-only.** `exepad.com` and `*.exepad.app` origins
  are no longer allowlisted on self-hosted instances, which is every instance
  built from this repository (`ENVIRONMENT` defaults to `selfhost`). The check is
  read live rather than captured at module init, so a runtime change takes effect.

### Fixed

- **An LLM key set on the default (Gemini) provider was silently ignored, and
  every build failed to authenticate.** `EXEPAD_LLM_API_KEY` is the LiteLLM
  path's variable: `create_model()` reads it only *after* the native-Gemini early
  return, and google-genai's client is constructed with no `api_key`, falling
  back to `GEMINI_API_KEY` / `GOOGLE_API_KEY`. Nothing bridged the two. This hit
  the default first-run flow from both directions — a key in `.env` (the
  entrypoint warns only when *both* variables are missing, implying either would
  do) and a key typed into Settings, which stores it as `EXEPAD_LLM_API_KEY`
  whatever provider you picked. `EXEPAD_LLM_API_KEY` is now mirrored into
  `GEMINI_API_KEY` on native-Gemini providers only; an explicit `GEMINI_API_KEY`
  or `GOOGLE_API_KEY` always wins and is never overwritten, and a rotated key
  propagates rather than leaving the first one stranded.
- **`docker compose` put the data volume somewhere backups didn't look.** The
  root and `deploy/` compose files declared `exepad-data` without an explicit
  `name:`, so Compose prefixed the project — `exepad-app-builder_exepad-data` —
  while `install.sh`, `install.ps1`, the CLI's own generated compose, and
  `exepad backup` / `exepad restore` all mount the literal `exepad-data`, as does
  every `docker run -v exepad-data:/data … tar` in the docs. Docker **creates a
  missing volume instead of failing**, so the mismatch never raised an error — it
  produced a valid-looking, completely empty backup archive. Both files now pin
  `name: exepad-data`.

  **Upgrade note (private 0.x only):** if you ran `docker compose up` from a
  checkout before this release, your data is in the prefixed volume. Move it
  once, substituting your checkout directory name:

  ```bash
  docker compose down
  docker run --rm -v <checkout-dir>_exepad-data:/from -v exepad-data:/to \
    alpine sh -c 'cd /from && cp -a . /to'
  docker compose up -d
  ```

  Installs made by `install.sh`, `install.ps1` or `npx exepad-app-builder up` were always on
  the literal name and need no action.
- **Both export paths now carry their licence terms.** Exepad was shipping its
  own object code without them. The run-ready **deployable bundle** packs the
  entire runtime — `app/server.mjs` plus the compiled studio — into a download
  users are told to host, and now writes `LICENSE` and `NOTICE` at its root. The
  **source export** vendors a built copy of the SDK and, when the app has a
  backend, a built standalone server; those now carry the notices inside
  `vendor/exepad-sdk/` and `server/`. Deliberately *not* at the export root:
  GitHub's licence detection would otherwise badge the user's own application
  repository AGPL-3.0, contradicting the section 7 permission shipped in the same
  download. `NOTICE` matters here as much as `LICENSE`, because the bundler marks
  only React external, so the MIT-derived shadcn/ui components are compiled into
  that vendored SDK and MIT requires its notice travel with them.
- **Cold-cache `pnpm build` could fail with `ENOTEMPTY`** — building from a
  checkout is now the primary install path, so it has to work first try.
  `@exepad/sdk` writes its bundle into
  `apps/runtime/client/public/runtime_assets/dist/`, which the client's Vite
  build then copies into `dist/`, but nothing ordered the two: the
  Turbo graph now declares `@exepad/runtime-client#build` after
  `@exepad/sdk#build`, and `apps/runtime`'s `build` script (which re-ran the
  client build a second time, outside that graph) was renamed to `build:client`.

### Removed

- Dead files that shipped in the tree but nothing read: the app-backend's
  `schema.sql` / `seed.sql` (a one-off dump of an example app's tables and rows,
  from a generator that no longer exists) and ten stale pre-compiled component
  bundles under `apps/runtime/client/public/runtime_assets/compiled/`.

### Security

- **`cf-connecting-ip` is no longer trusted for rate-limit bucketing without an
  explicit opt-in.** Forwarded headers were already gated on a trusted proxy
  (`EXEPAD_TLS_FRONTED` / `EXEPAD_TRUST_PROXY`), but the shipped container sets
  `EXEPAD_TLS_FRONTED=1` and its Caddy front does **not** strip
  `cf-connecting-ip` — so a client could rotate that header to mint a fresh
  rate-limit bucket per request and walk past the `/auth/login` and
  `/auth/setup` brute-force throttles. The header is now read only when the new
  `EXEPAD_TRUST_CF=1` is set; otherwise the limiter falls through to the
  **rightmost** `X-Forwarded-For` entry (the one the trusted proxy appended) and
  then to the unspoofable TCP peer address.
  **Upgrade note:** operators genuinely behind Cloudflare should set
  `EXEPAD_TRUST_CF=1` — without it their users are bucketed by the address the
  Cloudflare edge presents to the container rather than by real client IP, so
  auth throttling becomes coarser than intended. Everyone else should leave it
  unset. The optional cloudflared quick tunnel needs no change: it sends a
  single-entry `X-Forwarded-For` carrying the same client IP.

## [0.4.0] - 2026-07-16

### Changed

- **Renamed off `exepad-platform`.** The GitHub repo
  (`Exepad/exepad-app-builder`) and the container image
  (**`ghcr.io/exepad/exepad-app-builder`**) moved to the `exepad-app-builder`
  name; the **npm launcher uses the short name `exepad`** (`npx exepad-app-builder up`).
- **Quickstart is now one-liner-first** (Codex-style) across README,
  INSTALL.md, and release notes: `curl | bash` (macOS/Linux),
  `powershell -c "irm … | iex"` (Windows — never triggers SmartScreen),
  `npx exepad-app-builder up` (npm). The MSI/zip/tarball packages remain on every
  release as the optional download path.

### Fixed

- **CLI compose published a dead HTTPS port**: the generated compose mapped
  `8443:8443` and the success message printed `https://localhost:8443`, but
  nothing listens on container :8443 in the shipped image (the in-image Caddy
  terminates TLS and disables the old in-process listener). The CLI now
  publishes only the HTTP port and prints `http://localhost:<port>` — matching
  install.sh/install.ps1 and every doc.
- **install.sh / install.ps1 composes now include the same log-rotation block
  as the CLI** (json-file, 10 MB × 3) — script-installed studios no longer
  grow unbounded container logs.
- Stale docs swept repo-wide: the "first release pending / build from source"
  era notes replaced with the real install paths, docs/install reordered
  one-liner-first, fictional 1.x version examples replaced with the real 0.x
  series, superseded planning docs banner-marked (no backward-compat text
  retained).

### Added

- **Code-signing wiring (inert)**: the release `msi` job can Authenticode-sign
  the MSI via Azure Trusted Signing once the Azure account exists — enable by
  setting the documented secrets/vars and `EXEPAD_CODESIGN=1` (see
  RELEASING.md "One-time setup").

## [0.3.0] - 2026-07-16

### Added

- **Windows MSI installer** (`Exepad-Installer-Windows.msi`): per-user (no
  UAC), installs the launcher pair + Start Menu shortcuts ("Exepad Studio",
  "Install or Update Exepad Studio") + Add/Remove Programs entry, and
  auto-opens the setup console after an interactive install (silent installs
  via `msiexec /i ... /qn` skip it, for IT deployment). Uninstall removes only
  the launcher — the container and `exepad-data` volume are never touched.
  Built with WiX **5.0.2** (pinned: WiX v6+ requires the Open Source
  Maintenance Fee EULA) on a Windows runner, and every release's MSI passes a
  real `msiexec` install → assert payload/shortcuts/ARP → uninstall → assert
  clean smoke test (`packaging/msi/smoke.ps1`, shared with packaging-ci).
  The zip + `.bat` bundle remains available as the no-MSI fallback.

## [0.2.0] - 2026-07-16

### Added

- **One-click installer bundles for all platforms**, built and attached to
  every release: `Exepad-Installer-Windows.zip` (extract → double-click
  `Install Exepad.bat`), `Exepad-Installer-macOS.zip` (extract → open
  `Install Exepad.command`, one-time unsigned-app approval — steps in
  INSTALL.md, including the macOS 15+ "Open Anyway" flow),
  `Exepad-Installer-Linux.tar.gz` (`bash install.sh`). Assembly lives in
  `packaging/one-click/build-bundles.sh` and is rehearsed by packaging-ci so
  it can't drift from the release job.
- **macOS support in `install.sh`**: detects Docker Desktop/OrbStack,
  opens the download page when no runtime is installed (never attempts
  get.docker.com on Darwin), macOS-specific daemon-down guidance, RAM check
  via `sysctl`.
- **`install.sh` now offers to take the LLM key up front** (TTY only, Enter
  skips — mirrors `install.ps1`), so a one-click install is fully configured
  in one pass.
- **`INSTALL.md`**: step-by-step per-platform install guide, including the
  SmartScreen/Gatekeeper unsigned-download steps.

### Fixed

- **`install.sh` died right after auto-installing Docker** (`ok: command not
  found` under `set -e`) — the success path now completes in one run instead
  of requiring a re-run.
- **npx delegation is now channel-gated**: only a released (`public` channel)
  `install.sh`/`install.ps1` delegates to `npx exepad-app-builder` — a script run straight
  from a source checkout would otherwise 404 or, worse, execute a name-squatted
  npm package. CI stamps the channel at release time.

## [0.1.1] - 2026-07-16

### Fixed

- **`exepad backup`/`restore` hit an empty volume** (critical, caught by
  live-testing the released 0.1.0): the generated compose files declared the
  data volume without an explicit `name:`, so compose created it
  project-prefixed (`<install-dir>_exepad-data`) while backup/restore/docs
  mount the literal `exepad-data`. All three emitters (CLI, install.sh,
  install.ps1) now pin `name: exepad-data` — the volume is stable across
  install dirs and the backup path is live-verified to capture real data.

## [0.1.0] - 2026-07-16

### Added

- **`server-lite` image variant** (`EXEPAD_LITE=1` build-arg; published as
  `:X.Y.Z-lite`): omits the bundled Chromium (~1.4 GB smaller uncompressed —
  1.69 GB vs 3.08 GB); dashboard thumbnails auto-disable when no browser is
  present (detected both at boot and in the maintenance cron itself, so
  Chromium-less local rigs degrade gracefully too).
- **Windows front door `install.ps1`** (`irm … | iex`): delegates to
  `npx exepad-app-builder` when Node ≥ 18 is present, guides a Docker Desktop
  install when Docker is missing, embedded compose bootstrap otherwise.
- **`install.sh` now installs Docker Engine for you** when absent (consent
  prompt — TTY-aware under `curl | bash`; `--yes` /
  `EXEPAD_DOCKER_INSTALL=always` for headless; `--no-docker-install` /
  `EXEPAD_DOCKER_INSTALL=false` to opt out) via Docker's official
  get.docker.com script, with an engine major-version gate and a docker-group
  membership hint.
- **CLI lifecycle verbs**: `exepad stop` (graceful pause — container kept),
  `exepad start`, `exepad restart`. `exepad down` remains the explicit
  teardown (volume always preserved).
- **`exepad restore <backup.tgz> [--to <version>]`** — the rollback path:
  validates the archive *before* wiping, restores the data volume, and
  optionally re-pins the matching older image version.
- **Podman support (runtime-neutral CLI)**: every verb detects docker OR
  podman; the engine used at deploy is recorded in `.exepad-version` and
  preferred thereafter, so installing the other engine later cannot silently
  target the wrong instance.
- **In-app update banner**: `/api/settings/update-check` (operator-only,
  6 h-cached, prerelease-aware semver; `EXEPAD_UPDATE_CHECK=0` or
  `EXEPAD_NO_OUTBOUND=1` disables) surfaces "a newer version is available" in
  Settings with the exact `npx exepad-app-builder update` command.
- **cosign keyless signatures** on both released image variants, and a CI
  import-smoke job that guards the pruned agent dependency set.
- **App-store manifests** (`deploy/appstores/`): Portainer templates.json,
  CasaOS/ZimaOS, Umbrel community store, Runtipi, plus a Dokploy blueprint —
  prepared for the self-published "add store by URL" channel.

### Changed

- **Image size: 4.75 GB → 3.08 GB uncompressed (1.19 GB → 720 MB compressed).**
  Fixed a Dockerfile ordering bug where a post-hoc `chown -R /app` duplicated
  ~800 MB (the entire Chromium bundle) into an extra layer; replaced the
  116 MB tailwind standalone binary with the npm `@tailwindcss/cli`; pruned
  `google-adk[extensions]` (64 transitive packages the agent never imports).
  Layers are now ordered so routine source changes never re-pull Chromium.
- **`exepad update` is backup-first**: it snapshots `/data` before pulling
  (skip with `--no-backup`); a failed snapshot aborts the update.
- **`exepad stop` no longer removes the container** (it previously aliased
  `down`); it now pauses gracefully so `exepad start` resumes in place.

### Security

- **Deploy/migration data-loss fixes (critical):** schema rollback no longer
  drops live per-app system tables (`_auth_users`, `_files`, API keys) or
  removed-model tables; agent-selectable `migrationPolicy: "reset"` no longer
  drops the published table — destructive migrations require explicit operator
  confirmation (`allowDestructive`).
- **Authenticated internal agent proxy:** the worker→agent `/agent/*` proxy now
  requires a shared `EXEPAD_AGENT_INTERNAL_SECRET` (generated on first boot),
  closing an unauthenticated path to the internal LLM agent.
- **Operator session revocation:** logout is now logout-all and password change
  invalidates outstanding/stolen session cookies.
- **SSRF DNS-rebinding pin** on handler `fetch`; **durable, fail-closed auth
  throttle** for account-targeted auth methods; handler sandbox globals frozen.
- **Pre-migration byte-level DB backups** (restored on rollback of destructive
  migrations); `.dockerignore` excludes secrets/DBs/certs from the build context.
- Dependency advisories cleared (hono, lodash, react-router, ajv, fast-uri);
  `pnpm audit --prod` clean.

### Added

- Initial open-source release preparation.
- Community and governance docs: `SECURITY.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, and this `CHANGELOG.md`.
- GitHub issue and pull-request templates under `.github/`.
- **One-command install release pipeline:** a tag-driven
  [`release` workflow](.github/workflows/release.yml) publishes, in lockstep
  from one `vX.Y.Z` tag, the multi-arch (amd64/arm64) image
  `ghcr.io/exepad/exepad-app-builder:X.Y.Z`, the `exepad-app-builder@X.Y.Z` npm launcher
  (`npx exepad-app-builder up`), and a GitHub Release carrying the version-pinned
  `install.sh` (`curl | bash`). A restored
  [`packaging-ci` workflow](.github/workflows/packaging-ci.yml) gates the
  packaging surface on PRs (CLI typecheck/tests/build + thin-launcher size
  gate, shellcheck on `install.sh`, deploy-template parsing, and an image-repo
  lockstep check). Release runbook: `RELEASING.md`.
- Full-spectrum pre-release audit (security, correctness, docs) with every
  finding tracked to remediation — the resulting fixes are listed above.
- Reproducible Python builds via a fully-pinned `apps/agent/requirements.lock`.

### Changed

- Documentation updated to describe the **actually shipped** OSS product: a
  single self-hosted Node + Python container with SQLite and in-process
  dispatch (no Cloudflare / D1 / R2 / Workers-for-Platforms).
- Corrected `./run.sh local` runtime port in the docs (`:8090`, not `:8080`).
- README "Deploy to a server" section now documents only the paths that work
  today (`./run.sh` and `./run.sh local`); not-yet-published hosted artifacts
  are clearly labeled as planned.
- `$persist` app state now survives page reloads (rehydrates from the
  app-scoped key); WebSocket saves report queued (not failed) when offline.
- Client `crud/list` caches `COUNT(*)` for large tables; local adapters use
  atomic writes, prefix-scoped listing, and a prepared-statement cache.
- `exepad` CLI default image repo aligned to the canonical
  `ghcr.io/exepad/exepad-app-builder` (was `ghcr.io/exepad/exepad`), matching
  `install.sh` and the deploy templates.

[Unreleased]: https://github.com/Exepad/exepad-app-builder/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/Exepad/exepad-app-builder/releases/tag/v1.0.1
[1.0.0]: https://github.com/Exepad/exepad-app-builder/releases/tag/v1.0.0
