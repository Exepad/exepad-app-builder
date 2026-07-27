# exepad

Single-command installer and operator CLI for the self-hosted **Exepad studio**.
It is a tiny, dependency-free Node wrapper over the published Docker image — npm
ships only this launcher; Docker carries the studio. The npm package and the
command it provides are both `exepad`.

```bash
npx exepad up            # install + start (pulls the pinned image, writes compose, up -d)
npx exepad@X.Y.Z up      # install a specific studio version (lockstep: launcher ver == image tag)
npx exepad update --to X.Y.Z
npx exepad status | logs -f | stop | start | restart | backup | restore | doctor | down
```

For a persistent command: `npm i -g exepad` then `exepad up`. Run `exepad --help`
for the full flag list.

Common `up` options: `--port <n>`, `--domain <host>` (HTTPS via a Caddy
sidecar, with `--tls letsencrypt|dns|byoc`), `--llm-key` / `--llm-provider` /
`--llm-model` to seed the LLM config, and `--admin-email` / `--admin-password`
to seed the operator account. `--dry-run` prints the plan without touching
anything.

Without `--admin-email` / `--admin-password`, the setup screen asks for the
**first-run setup token** the container prints at boot — read it back with
`docker logs exepad 2>&1 | grep -A2 'SETUP TOKEN'`. Seeding the admin creates the
account at boot instead, which closes setup and skips the token entirely.

## How versioning works

- **Lockstep.** The launcher and the image are published together with the same
  version, so `npx exepad@X.Y.Z` pulls image `:X.Y.Z`. `--to <ver>` overrides the
  target; `--image-tag @sha256:<digest>` pins immutably for production.
- **Pinned, never `:latest`.** The generated `docker-compose.yml` always records an
  exact tag so a stray `docker compose pull` can't jump a major.
- **Downgrade guard.** Studio migrations run forward-only, so an older image on
  newer `/data` can break. `up`/`update` refuse a downgrade unless you pass
  `--force` (and tell you to `exepad backup` first).

## Where state lives

The install dir (`~/.exepad` by default, or `--dir`/`$EXEPAD_HOME`) holds the
managed `docker-compose.yml` and `.env`. All **persistent data** lives in the
named volume `exepad-data` (`/data`) and survives image swaps — back it up with
`exepad backup`. `backup` stops the container first so the SQLite snapshot is
consistent (`--no-stop` for a hot, at-your-own-risk copy); `exepad restore
<backup.tgz>` is the rollback path.

## Two layers (what `npx exepad up` installs)

npm fetches only this KB-sized launcher into the transient npx cache (not a global
install). The launcher then pulls the GHCR image via `compose pull` — that's the
real payload, pulled by the container engine, never through npm.

> Requires a container engine with Compose v2. Docker is the default; **Podman is
> a first-class fallback** (`podman compose` shells out to `docker-compose` or
> `podman-compose`, so one of those must be installed too). Run `exepad doctor`
> to check the host — engine, arch, RAM, and deployed version.
