# Releasing Exepad

One git tag ships everything, in **lockstep**: the same `vX.Y.Z` tag publishes
the Docker image, the npm launcher, and the versioned `install.sh` — all
carrying the same version number, so `npx exepad-app-builder@X.Y.Z up` always pulls image
`:X.Y.Z`. The pipeline is [.github/workflows/release.yml](.github/workflows/release.yml)
and the tag is the single source of the version — nothing in the repo is bumped
by hand.

## What a release produces

| Artifact | Where | Consumed by |
|---|---|---|
| `ghcr.io/exepad/exepad-app-builder:X.Y.Z` + `:latest` (multi-arch amd64/arm64) | GHCR | everything below + `docker run` + deploy templates |
| `exepad-app-builder@X.Y.Z` on npm (dist-tag `latest`, or `next` for prereleases) | npmjs.com | `npx exepad-app-builder up` |
| GitHub Release `vX.Y.Z` with `install.sh`/`install.ps1` (+ `.sha256`) pinned to `X.Y.Z` | GitHub Releases | `curl -fsSL … \| bash` / `irm … \| iex` |
| One-click bundles `Exepad-Installer-{Windows,macOS}.zip`, `-Linux.tar.gz` (+ `.sha256`; assembled by `packaging/one-click/build-bundles.sh` from the pinned installers) | GitHub Releases | download → extract → double-click ([INSTALL.md](INSTALL.md)) |
| `Exepad-Installer-Windows.msi` (+ `.sha256`; WiX 5.0.2 from `packaging/msi/exepad.wxs`, built + msiexec-smoke-tested on windows-latest, uploaded into the release by the `msi` job) | GitHub Releases | double-click → setup runs itself |

> **Why the launcher is not called `exepad`.** npm refuses that name — its
> typosquat protection rejects it as *"too similar to existing package
> execa"*, a hard 403 at publish time that no token, scope or account can
> get past. The package is named for the repo and image instead. Its `bin`
> is still `exepad`, so the installed command is unchanged; only the
> one-shot `npx exepad-app-builder …` form is longer.

Publish order is enforced: **image → npm → GitHub Release**, so a live launcher
can never reference an image tag that doesn't exist yet.

## Release mode

Public releases are cut on the canonical repo, **`Exepad/exepad-app-builder`** —
that is the current and only published mode. The workflow decides for itself by
comparing `GITHUB_REPOSITORY`; there is nothing to configure.

Tagging a **fork** still runs the pipeline, but deliberately reduced: `npm
publish` is skipped (npm is inherently public — a fork must not take the shared
`exepad-app-builder` name), cosign signing is skipped (keyless signatures land in the public
Rekor transparency log), and the image builds `linux/amd64` only, since the
arm64 leg runs under QEMU for hours (opt back in with the repo variable
`EXEPAD_PRIVATE_MULTIARCH=1`). Note the image repo is fixed in the workflow's
`env.IMAGE_REPO` — a fork that wants its own image must change it.

Tag validation, the image build, and the GitHub Release with the pinned
`install.sh`/`install.ps1` plus the one-click bundles run the same either way.

## One-time repo setup

Done once, by a maintainer with repo-admin rights. Items 1–5 are all
**required**, and most fail *silently*: the release goes green while the install
path, report channel, or review request they unlock stays dead.

1. **npm trusted publishing (OIDC)** — no secret, and nothing that expires.
   At npmjs.com → the `exepad-app-builder` package → *Settings* → *Trusted
   Publisher*, add: organization/user **Exepad**, repository
   **exepad-app-builder**, workflow **release.yml**. The `npm` job already
   requests `id-token: write` and passes no `NODE_AUTH_TOKEN`.

   Why not a token: npm caps write-capable granular tokens at **90 days**, so a
   token-based pipeline fails on a timer — and it fails *after* the image has
   pushed and `:latest` has moved, because npm runs second. This account also
   uses browser 2FA, which no unattended token flow can satisfy without the
   bypass-2FA setting. OIDC removes both problems.

   ⚠️ Do **not** add `registry-url:` to `actions/setup-node` in that job. It
   writes an empty `//registry.npmjs.org/:_authToken=` line into `.npmrc`, and
   npm prefers that empty credential over the OIDC exchange — the publish then
   fails with a 401 that never mentions OIDC
   ([actions/setup-node#1551](https://github.com/actions/setup-node/issues/1551)).

   Note the chicken-and-egg: npm will not let you configure a trusted publisher
   for a package that does not exist ([npm/cli#8544](https://github.com/npm/cli/issues/8544)),
   so the *first* ever publish had to be done by hand from a maintainer's
   machine. That is already done — `exepad-app-builder@1.0.0-rc.3` exists.

2. **GHCR package access + visibility** — if the `exepad-app-builder` package
   already exists, this repo's Actions cannot push to it by default: open org →
   Packages → `exepad-app-builder` → *Manage Actions access* and grant
   `Exepad/exepad-app-builder` **Write** before the first release. Then set the
   package to **public** in the same settings so anonymous `docker pull` works.
   (A package created fresh by the first push only needs the visibility flip.)
3. **`get.exepad.com`** — ✅ **done**, and it needs no per-release maintenance.
   A Cloudflare Worker (`exepad-get`, deployed from `deploy/get-exepad/`) 302s
   `/` and `/install.sh` to
   `…/releases/latest/download/install.sh`, `/install.ps1` to its counterpart,
   and the `.sha256` paths to the matching checksums. Because everything routes
   through `releases/latest`, a new release is picked up automatically.

   Note it is a **Worker with a custom domain**, not a DNS record plus a
   Redirect Rule: DNS alone cannot redirect, and Cloudflare Redirect Rules need
   a `Zone → DNS → Edit` token that `wrangler login` does not grant. The Worker
   route creates and owns its own proxied DNS record.

   Redeploy with `cd deploy/get-exepad && npx wrangler deploy`. Expect a
   minute of HTTP 500 (Cloudflare error 1104) on a freshly created custom
   domain while it propagates — it clears on its own.
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
GitHub — `npx exepad-app-builder up` for regular users is unaffected.

## Verifying a release

```bash
npm view exepad-app-builder version                          # == X.Y.Z
docker manifest inspect ghcr.io/exepad/exepad-app-builder:X.Y.Z | grep -E 'amd64|arm64'
npx exepad-app-builder@X.Y.Z up --dry-run                    # compose pins :X.Y.Z
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
