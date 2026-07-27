# Releasing Exepad

One git tag ships everything, in **lockstep**: the same `vX.Y.Z` tag publishes
the Docker image, the npm launcher, and the versioned `install.sh` — all
carrying the same version number, so `npx exepad@X.Y.Z up` always pulls image
`:X.Y.Z`. The pipeline is [.github/workflows/release.yml](.github/workflows/release.yml)
and the tag is the single source of the version — nothing in the repo is bumped
by hand.

## What a release produces

| Artifact | Where | Consumed by |
|---|---|---|
| `ghcr.io/exepad/exepad-app-builder:X.Y.Z` + `:latest` (multi-arch amd64/arm64) | GHCR | everything below + `docker run` + deploy templates |
| `exepad@X.Y.Z` on npm (dist-tag `latest`, or `next` for prereleases) | npmjs.com | `npx exepad up` |
| GitHub Release `vX.Y.Z` with `install.sh`/`install.ps1` (+ `.sha256`) pinned to `X.Y.Z` | GitHub Releases | `curl -fsSL … \| bash` / `irm … \| iex` |
| One-click bundles `Exepad-Installer-{Windows,macOS}.zip`, `-Linux.tar.gz` (+ `.sha256`; assembled by `packaging/one-click/build-bundles.sh` from the pinned installers) | GitHub Releases | download → extract → double-click ([INSTALL.md](INSTALL.md)) |
| `Exepad-Installer-Windows.msi` (+ `.sha256`; WiX 5.0.2 from `packaging/msi/exepad.wxs`, built + msiexec-smoke-tested on windows-latest, uploaded into the release by the `msi` job) | GitHub Releases | double-click → setup runs itself |

Publish order is enforced: **image → npm → GitHub Release**, so a live launcher
can never reference an image tag that doesn't exist yet.

## Release mode

Public releases are cut on the canonical repo, **`Exepad/exepad-app-builder`** —
that is the current and only published mode. The workflow decides for itself by
comparing `GITHUB_REPOSITORY`; there is nothing to configure.

Tagging a **fork** still runs the pipeline, but deliberately reduced: `npm
publish` is skipped (npm is inherently public — a fork must not take the shared
`exepad` name), cosign signing is skipped (keyless signatures land in the public
Rekor transparency log), and the image builds `linux/amd64` only, since the
arm64 leg runs under QEMU for hours (opt back in with the repo variable
`EXEPAD_PRIVATE_MULTIARCH=1`). Note the image repo is fixed in the workflow's
`env.IMAGE_REPO` — a fork that wants its own image must change it.

Tag validation, the image build, and the GitHub Release with the pinned
`install.sh`/`install.ps1` plus the one-click bundles run the same either way.

## One-time repo setup

Done once, by a maintainer with repo-admin rights. Items 1–5 are all
**required**, and most fail *silently*: the release goes green while the install
path, report channel, or review request they unlock stays dead
([what's gated](docs/install/README.md#once-the-first-release-is-published)).

1. **`NPM_TOKEN` repo secret** — a **granular access token** with *Read and
   write* on packages and **"Bypass 2FA" explicitly enabled** (Settings →
   Secrets and variables → Actions).

   Not a classic "Automation" token: npm is retiring classic tokens, and the
   publish now fails with `E403 — Two-factor authentication or granular access
   token with bypass 2fa enabled is required`. Bypass-2FA defaults to **off** at
   token creation, so it must be ticked deliberately; this is the failure mode
   that killed the first `v1.0.0-rc.1` run. Before `exepad` exists on the
   registry it cannot be selected by name, so scope the token to *All packages*
   for the first publish and narrow it afterwards.

   ⚠️ **This token expires.** npm caps write-capable granular tokens at **90
   days**. The release pipeline will start failing at `Publish to npm` when it
   lapses — with the image already pushed and `:latest` already moved, since npm
   runs after the image job. Put the expiry date in a calendar; rotating the
   secret is the whole fix.
2. **GHCR package access + visibility** — if the `exepad-app-builder` package
   already exists, this repo's Actions cannot push to it by default: open org →
   Packages → `exepad-app-builder` → *Manage Actions access* and grant
   `Exepad/exepad-app-builder` **Write** before the first release. Then set the
   package to **public** in the same settings so anonymous `docker pull` works.
   (A package created fresh by the first push only needs the visibility flip.)
3. **`get.exepad.com`** — the DNS/redirect front door both `curl … | bash` and
   `irm … | iex` resolve; without it those one-liners fail with "could not
   resolve host". Point it at the latest release asset:
   `https://github.com/Exepad/exepad-app-builder/releases/latest/download/install.sh`
   (an HTTPS 302 redirect is enough; keep it HTTPS-only). Also serve
   `/install.ps1` the same way for the Windows one-liner.
4. **Private vulnerability reporting** — turn on Settings → Code security →
   *Private vulnerability reporting*. Until it is enabled the "Report a security
   vulnerability" advisory link in `.github/ISSUE_TEMPLATE/config.yml` and the
   Security-tab flow SECURITY.md describes both 404 for outside reporters,
   leaving only the email address as a private channel.
5. **CODEOWNERS handle is a collaborator** — `.github/CODEOWNERS` assigns every
   path to `@ucinar`. GitHub **silently ignores** an owner who lacks write
   access on `Exepad/exepad-app-builder`: no error, no warning, just no review
   request — so PRs merge without the maintainer review CONTRIBUTING.md
   promises. Confirm the handle is a collaborator with write access (or switch
   the file to an org team handle the org owns).
6. **Add `.github/dependabot.yml`** — deliberately held out of the launch
   snapshot. Dependabot runs as soon as the config lands on the default branch:
   on the first cut it opened **20 PRs within a minute** of the repository being
   created, which would have burned PR numbers 1–20 on bot traffic before a
   single human contribution. Copy it from the canonical repo once someone is
   ready to triage the first batch (it is tuned to monthly + grouped, so expect
   roughly 4–10 PRs on that first run). Security *advisories* do not depend on
   this file and arrive regardless.
7. **Windows code signing** (optional, still pending — it removes the
   SmartScreen warning on the MSI; the `irm | iex` one-liner never triggers
   SmartScreen either way). Authenticode signing needs a certificate from
   **Azure Trusted Signing** (an org-validated Trusted Signing account +
   certificate profile) or an EV Authenticode CA. The release workflow is
   already wired for it: set repo secrets `AZURE_TENANT_ID` /
   `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`, repo vars
   `EXEPAD_SIGNING_ENDPOINT` / `EXEPAD_SIGNING_ACCOUNT` /
   `EXEPAD_SIGNING_PROFILE`, then flip var `EXEPAD_CODESIGN=1` — the next
   release's MSI is signed and smoke-tested post-signature.

## Cutting a release

```bash
# 1. Make sure main is green and the CHANGELOG has an entry for this version:
#    move the relevant "Unreleased" items under a new "## [X.Y.Z] - YYYY-MM-DD".

# 2. Tag and push (the tag is the single source of the version — package.json
#    is stamped in CI; you do NOT bump it in the repo):
git tag vX.Y.Z
git push origin vX.Y.Z
```

The workflow then: validates the tag → builds/pushes the multi-arch image →
stamps `packages/exepad-cli` to `X.Y.Z`, runs typecheck/tests/build + a smoke
test and a <256 KB tarball gate, publishes to npm → creates the GitHub Release
with the pinned `install.sh`.

**Prereleases:** tag `vX.Y.Z-rc.1`-style. They publish under npm dist-tag
`next`, do **not** move the image `:latest` tag, and are marked prerelease on
GitHub — `npx exepad up` for regular users is unaffected.

## Verifying a release

```bash
npm view exepad version                          # == X.Y.Z
docker manifest inspect ghcr.io/exepad/exepad-app-builder:X.Y.Z | grep -E 'amd64|arm64'
npx exepad@X.Y.Z up --dry-run                    # compose pins :X.Y.Z
curl -fsSLI https://get.exepad.com | head -1     # front door resolves + redirects
```

Run the `docker manifest inspect` from a logged-out shell (`docker logout ghcr.io`)
— it is the only check that catches a package left private.

## Rules baked into the pipeline (don't undo them)

- **Lockstep** — launcher version == image tag, published from one tag in one
  run. The packaging CI gate ([packaging-ci.yml](.github/workflows/packaging-ci.yml))
  asserts every front door uses the single image repo `ghcr.io/exepad/exepad-app-builder`.
- **Pinned, never `:latest`** — generated compose files record the exact tag.
- **Forward-only migrations** — never re-tag or delete a published version;
  users may already have its `/data`. A bad release is fixed by shipping
  `X.Y.(Z+1)`, not by mutating `X.Y.Z`.
- **Thin launcher** — the npm tarball must stay KB-sized (CI fails >256 KB);
  all real weight ships in the image.
