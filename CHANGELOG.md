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

### Added

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
- **`NOTICE`** at the repo root — third-party attribution for the vendored
  shadcn/ui component code (MIT). `LICENSE` and `NOTICE` are now also copied
  into the image at `/app/`, so a distributed container carries the AGPL terms
  and the attributions alongside the binaries they cover.

### Changed

- **Quickstart is build-from-source-first again**, reversing the
  one-liner-first quickstart introduced in 0.4.0: README, INSTALL.md,
  `docs/install/README.md`, and the deployment docs now lead with building the
  image from a checkout, which needs no registry and no accounts.
  The `curl | bash` / `irm | iex` one-liners, `npx exepad up`, and the prebuilt
  `ghcr.io/exepad/exepad-app-builder` image are documented behind an explicit
  "once the first release is published" gate — none of them resolve until that
  first `vX.Y.Z` tag is cut (see [RELEASING.md](RELEASING.md) "One-time repo
  setup").

### Fixed

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
  name; the **npm launcher uses the short name `exepad`** (`npx exepad up`).
- **Quickstart is now one-liner-first** (Codex-style) across README,
  INSTALL.md, and release notes: `curl | bash` (macOS/Linux),
  `powershell -c "irm … | iex"` (Windows — never triggers SmartScreen),
  `npx exepad up` (npm). The MSI/zip/tarball packages remain on every
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
  `install.sh`/`install.ps1` delegates to `npx exepad` — a script run straight
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
  `npx exepad` when Node ≥ 18 is present, guides a Docker Desktop
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
  Settings with the exact `npx exepad update` command.
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
  `ghcr.io/exepad/exepad-app-builder:X.Y.Z`, the `exepad@X.Y.Z` npm launcher
  (`npx exepad up`), and a GitHub Release carrying the version-pinned
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

[Unreleased]: https://github.com/exepad/exepad-app-builder/commits/main
