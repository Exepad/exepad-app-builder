# syntax=docker/dockerfile:1
#
# Self-hosted Exepad — ONE image, HTTPS by default.
#
#   • Node runtime (Hono on @hono/node-server): serves the SPA + builder UI,
#     the /api gateway (in-process app-backend), the deploy pipeline, local auth,
#     and the build orchestration. Reverse-proxies /agent/* to the agent.
#   • Python agent (ADK/FastAPI): the multi-agent app builder, on internal :8081.
#
# HTTPS is built in: the image runs Caddy in-process as the TLS terminator (80/443)
# in front of the Node runtime (8080) — a browser-trusted Let's Encrypt cert for the
# box's own <ip>.sslip.io / verified domains, Caddy's internal CA for localhost/LAN.
# One self-contained image, no sidecar, nothing extra to install. Map 80+443; 8080
# is the internal HTTP port (also published for direct/loopback use). Opt out with
# EXEPAD_HTTPS_DISABLE=1 (serves plain HTTP on 8080 for your own TLS proxy).
#
#   docker run -p 80:80 -p 443:443 -e EXEPAD_LLM_API_KEY=... -v exepad-data:/data exepad
#
# =============================================================================
# Stage 1 — build the Node side (SPA + bundled server)
# =============================================================================
FROM node:22-bookworm-slim AS builder
WORKDIR /repo
RUN corepack enable

# Let V8 grow its heap before aborting so the build completes on small/low-RAM
# hosts (a 1 GB droplet + swap would otherwise hit V8's auto-detected cap and die
# with "exit code 134" during the vite/tsc build). A cap, not a reservation — it
# is harmless on big build machines and keeps the image buildable "standalone"
# anywhere. Tune with --build-arg NODE_BUILD_HEAP_MB.
ARG NODE_BUILD_HEAP_MB=3072
ENV NODE_OPTIONS="--max-old-space-size=${NODE_BUILD_HEAP_MB}"

# Whole repo (a pnpm workspace); .dockerignore keeps build/output cruft out.
COPY . .

# Use the committed lockfile for a REPRODUCIBLE build. --no-frozen-lockfile lets
# pnpm silently re-resolve deps in the clean container (observed: the SDK's vite
# 7→6), which breaks the SDK lib build (postbuild can't find the emitted monolith).
# The lockfile is kept in sync; if this ever fails, fix the lockfile, don't unpin.
#
# The `--syntax=docker/dockerfile:1` directive at the top enables the pnpm-store
# cache mount below, so repeat builds reuse already-downloaded packages instead of
# re-fetching the whole workspace from the registry every time a source file (or,
# before it was dockerignored, a churning .exepad-data/*.sqlite-wal) invalidated
# this layer. Pin the store to a fixed dir so the mount target is deterministic.
RUN --mount=type=cache,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir=/pnpm-store

# AGPL-3.0 section 13 source offer, baked into the SPA bundle at build time.
# Vite only exposes VITE_*-prefixed variables to `import.meta.env`, and it reads
# them from the BUILD PROCESS environment (loadEnv merges every VITE_* key of
# process.env), so an ARG alone is invisible to the build below — it has to be
# re-exported as ENV. ARGs are stage-scoped, which is why the final stage
# re-declares the ones the SERVER reads at runtime.
#
# A fork ships its OWN Corresponding Source URL by passing them at build time:
#   docker build --build-arg EXEPAD_SOURCE_URL=https://github.com/me/my-fork .
# (under `docker compose up --build`, list them in the service's `build.args`;
# release.yml passes all three automatically, derived from the releasing repo).
# The server-side offer can additionally be redirected on an already-built image
# with `-e EXEPAD_SOURCE_URL=…` — see the final stage. Unset, these describe this
# upstream build; EXEPAD_VERSION defaults to `dev` (matching the final stage) so
# an unstamped image never claims a release tag it was not built from.
#
# Placed AFTER `pnpm install` on purpose: bumping the version/commit must not
# invalidate the expensive dependency layer above, only the build below (which
# any source edit invalidates anyway).
ARG EXEPAD_VERSION=dev
ARG EXEPAD_COMMIT
ARG EXEPAD_SOURCE_URL
ENV VITE_EXEPAD_VERSION=${EXEPAD_VERSION} \
    VITE_EXEPAD_COMMIT=${EXEPAD_COMMIT} \
    VITE_EXEPAD_SOURCE_URL=${EXEPAD_SOURCE_URL}

# Build SERIALLY (--concurrency=1). Parallel turbo builds race on the shared
# apps/runtime/client/public/runtime_assets/dist dir: the SDK writes exepad-sdk.js
# there while other vite builds run, so the SDK's postbuild (generate-manifest,
# which imports exepad-sdk.js) intermittently can't find it. Local timing usually
# hides this; the container's timing exposes it and fails the build. Serial build
# is deterministic and keeps the artifact present through postbuild.
RUN pnpm exec turbo run build --concurrency=1

# The eject-built SDK (React-external) is vendored into the downloadable
# "Buildable project" source export. It is NOT part of the default build graph,
# so build it explicitly; the export ships SDK-less (unbuildable) without it.
RUN pnpm --filter @exepad/sdk run build:eject

# A clean production node_modules holding ONLY the native/binary externals the
# bundled server keeps out of the bundle. playwright-core drives Chromium for the
# maintenance cron's thumbnails (the browser itself is installed in stage 2);
# playwright-core has no postinstall browser download, so this stays lean here.
RUN mkdir -p /runtime-deps && cd /runtime-deps \
 && npm init -y >/dev/null 2>&1 \
 && npm install --omit=dev --no-audit --no-fund better-sqlite3@11.8.1 esbuild@0.27.2 playwright-core@1.58.2

# =============================================================================
# Stage 2 — final runtime image (Python base + Node + build binaries)
# =============================================================================
FROM python:3.14-slim AS final
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NODE_ENV=production

# Node 22 (runs the server + the agent's tsc validation gate) + global tsc.
# openssl mints the per-instance self-signed TLS cert for the built-in HTTPS
# listener (server/self-signed-cert.ts) — pinned explicitly so the default HTTPS
# never depends on it arriving only as a transitive ca-certificates dependency.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg bash openssl libcap2-bin \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g typescript@5.9 \
 && apt-get purge -y --auto-remove gnupg \
 && rm -rf /var/lib/apt/lists/*

# Standalone esbuild used by the agent's build pipeline.
# Arch-templated for multi-arch — buildx injects TARGETARCH (amd64 | arm64); the
# :-amd64 fallback keeps plain `docker build` working.
ARG TARGETARCH
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) BIN_ARCH=x64 ;; \
      arm64) BIN_ARCH=arm64 ;; \
      *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://registry.npmjs.org/@esbuild/linux-${BIN_ARCH}/-/linux-${BIN_ARCH}-0.24.2.tgz" \
      | tar xz -C /tmp; \
    cp /tmp/package/bin/esbuild /usr/local/bin/esbuild; \
    chmod +x /usr/local/bin/esbuild; rm -rf /tmp/package

# Tailwind v4 CLI — the agent's final CSS compile gate shells out to `tailwindcss`
# on PATH (final_compile_gate.py, PATH lookup, flags: --input/--output/--cwd/--minify).
# The npm CLI is the SAME program as the previously-baked standalone binary (the
# standalone build is @tailwindcss/cli bundled with Bun) but ~110 MB lighter, and
# npm resolves the right @tailwindcss/oxide native binary per arch — no more
# BIN_ARCH templating for tailwind. Keep the version pinned in lockstep with
# run.sh's standalone download (W0.3: same 4.1.18 everywhere).
RUN npm install -g --no-audit --no-fund @tailwindcss/cli@4.1.18 \
 && command -v tailwindcss \
 && tailwindcss --help >/dev/null

# cloudflared — the single static binary behind the one-click "Share live URL"
# feature (Cloudflare Quick Tunnels, *.trycloudflare.com; no account, no config).
# Spawned ON DEMAND as a child of the Node server (routes/publish.ts), never from
# the entrypoint, so a tunnel crash can't take the container down. cloudflared's
# release assets use amd64/arm64 directly (1:1 with TARGETARCH). Pin via
# --build-arg CLOUDFLARED_VERSION=YYYY.M.D in CI for reproducible images; the
# `latest` default keeps a plain `docker build` working out of the box.
ARG CLOUDFLARED_VERSION=latest
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) CF_ARCH=amd64 ;; \
      arm64) CF_ARCH=arm64 ;; \
      *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    if [ "${CLOUDFLARED_VERSION}" = "latest" ]; then \
      CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"; \
    else \
      CF_URL="https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${CF_ARCH}"; \
    fi; \
    curl -fsSL -o /usr/local/bin/cloudflared "${CF_URL}"; \
    chmod +x /usr/local/bin/cloudflared; \
    cloudflared --version

# Caddy — the single static binary that terminates TLS in front of the Node
# runtime so the ONE image serves HTTPS out of the box (browser-trusted Let's
# Encrypt for the box's own sslip host / verified domains; Caddy's internal CA for
# localhost / LAN / bare IP). Started by the entrypoint, NOT a separate sidecar —
# so `docker run exepad` is fully self-contained with nothing extra to install.
# Pin via --build-arg CADDY_VERSION for reproducible images.
ARG CADDY_VERSION=2.10.0
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) CADDY_ARCH=amd64 ;; \
      arm64) CADDY_ARCH=arm64 ;; \
      *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_${CADDY_ARCH}.tar.gz" \
      | tar xz -C /usr/local/bin caddy; \
    chmod +x /usr/local/bin/caddy; \
    caddy version
COPY docker/Caddyfile /etc/caddy/Caddyfile

# acme.sh — a pure-shell ACME client, baked in so the container can obtain a
# browser-trusted Let's Encrypt certificate for the box's bare PUBLIC IP (the
# 6-day "shortlived" profile with an IP identifier), which Caddy cannot request
# itself yet (caddyserver/caddy#7399). Only used when "direct IP access" is on;
# the entrypoint drives issue + renewal via HTTP-01 through Caddy's :80 webroot,
# and installs the cert for Caddy to serve. Pin for reproducible images; must be
# recent enough to support --certificate-profile (IP/shortlived). State lives on
# the /data volume at runtime (--config-home/--cert-home), so the image copy is RO.
ARG ACME_SH_VERSION=3.1.2
RUN set -eux; \
    curl -fsSL "https://github.com/acmesh-official/acme.sh/archive/refs/tags/${ACME_SH_VERSION}.tar.gz" \
      | tar xz -C /usr/local/lib; \
    mv "/usr/local/lib/acme.sh-${ACME_SH_VERSION}" /usr/local/lib/acme.sh; \
    ln -s /usr/local/lib/acme.sh/acme.sh /usr/local/bin/acme.sh; \
    chmod +x /usr/local/lib/acme.sh/acme.sh; \
    acme.sh --version
COPY docker/caddy-sites.sh /usr/local/bin/exepad-caddy-sites

# ── Runtime user — created BEFORE the heavy payload layers ───────────────────
# Everything below is copied/installed already owned by this uid (COPY --chown /
# USER exepad), so NO post-hoc `chown -R /app` is needed. The old recursive chown
# ran AFTER Chromium + node_modules were in place and overlayfs copied every
# touched file up into a new ~811 MB layer — the entire /app tree (622 MB of it
# Chromium) was stored TWICE on disk (measured). /data is chowned while still
# empty; a FRESH named volume mounted at /data inherits this ownership.
# (Upgrading from an older root-created volume, or using a host bind-mount, may
# need a one-time `chown -R 10001:10001` of the data dir.) Caddy gets JUST
# cap_net_bind_service via file capabilities so the unprivileged user can bind
# 80/443 — works with Docker's default capability set, no --privileged.
RUN groupadd -r exepad \
 && useradd -r -g exepad -u 10001 -m -d /home/exepad exepad \
 && mkdir -p /data \
 && chown exepad:exepad /data \
 && setcap 'cap_net_bind_service=+ep' /usr/local/bin/caddy \
 && install -d -o exepad -g exepad /app/pw-browsers

# Python agent dependencies. Install from the fully-pinned lock (transitives
# included) for reproducible builds; requirements.txt stays the human-edited
# direct-dep list. Regenerate the lock after editing requirements.txt — see the
# header in apps/agent/requirements.lock. (Installs to /usr/local as root —
# read-only at runtime, so it needs no exepad ownership.)
COPY --chown=exepad:exepad apps/agent/requirements.lock /app/agent/requirements.lock
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r /app/agent/requirements.lock

# A clean production node_modules holding ONLY the native/binary externals the
# bundled server keeps out of the bundle (built in stage 1). Copied EARLY — it
# changes only when the pinned externals change, and playwright-core's CLI below
# needs it. Owned by the runtime user at copy time (no post-hoc chown).
COPY --from=builder --chown=exepad:exepad /runtime-deps/node_modules /app/node_modules

# ── Chromium (heavy + stable → BEFORE the app-code layers) ───────────────────
# Driven by the playwright-core copied above; installed into a fixed path so the
# spawned screenshot child finds it deterministically. Split in two so the
# browser bundle is owned by the runtime user AT CREATION (no chown, no dup
# layer): system libs via apt as root, then the browser download as `exepad`.
# EXEPAD_LITE=1 skips BOTH → the "server-lite" image variant (~1.4 GB smaller);
# the entrypoint auto-disables dashboard thumbnails when no browser is baked in
# (docker/entrypoint.sh). Gated at runtime by EXEPAD_THUMBNAILS_ENABLED either way.
ENV PLAYWRIGHT_BROWSERS_PATH=/app/pw-browsers
ARG EXEPAD_LITE=0
RUN if [ "$EXEPAD_LITE" != "1" ]; then \
      node /app/node_modules/playwright-core/cli.js install-deps chromium \
      && rm -rf /var/lib/apt/lists/*; \
    else echo "EXEPAD_LITE=1 — skipping Chromium system deps"; fi
USER exepad
RUN if [ "$EXEPAD_LITE" != "1" ]; then \
      HOME=/home/exepad node /app/node_modules/playwright-core/cli.js install chromium; \
    else echo "EXEPAD_LITE=1 — skipping Chromium browser download"; fi
USER root

# CSS packages the agent's Tailwind v4 compile resolves from node_modules:
#   tw-animate-css — @import "tw-animate-css" (as before)
#   tailwindcss    — @import "tailwindcss". The old STANDALONE binary embedded the
#                    framework; the npm @tailwindcss/cli resolves it from
#                    node_modules like any package (verified: compile fails
#                    without it). Pin in lockstep with the CLI version above.
# Version-pinned inputs → placed ABOVE the schema/SDK/app COPYs so routine
# source edits never re-download these tarballs. (Tiny dirs — the chown
# copy-up cost is a few MB, unlike the old whole-/app chown.)
RUN mkdir -p /app/node_modules/tw-animate-css /app/node_modules/tailwindcss \
 && curl -fsSL https://registry.npmjs.org/tw-animate-css/-/tw-animate-css-1.4.0.tgz \
      | tar xz --strip-components=1 -C /app/node_modules/tw-animate-css \
 && curl -fsSL https://registry.npmjs.org/tailwindcss/-/tailwindcss-4.1.18.tgz \
      | tar xz --strip-components=1 -C /app/node_modules/tailwindcss \
 && chown -R exepad:exepad /app/node_modules/tw-animate-css /app/node_modules/tailwindcss

# Shared schema package (agent PYTHONPATH) + SDK exports. agent_api.py resolves
# these at /packages/schemas (3 dirs up from /app/agent/agent_api.py).
COPY packages/schemas/scripts/py/ /packages/schemas/scripts/py/
COPY packages/schemas/data/        /packages/schemas/data/
COPY packages/exepad-sdk/src/index.ts /packages/exepad-sdk/src/index.ts
COPY --from=builder /repo/packages/exepad-sdk/dist/sdk-exports.json /packages/exepad-sdk/dist/sdk-exports.json
ENV PYTHONPATH="/packages/schemas/scripts/py"

# Agent source.
COPY --chown=exepad:exepad apps/agent/ /app/agent/
RUN find /app/agent -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null || true; \
    rm -f /app/agent/.env /app/agent/.env.local || true

# Built Node runtime: server bundle, the isolated screenshot child the
# maintenance cron spawns, and the SPA dist. (The native/binary externals
# node_modules was copied earlier, before the Chromium layers.)
COPY --from=builder --chown=exepad:exepad /repo/apps/runtime/worker/dist/server.mjs /app/server.mjs
COPY --from=builder --chown=exepad:exepad /repo/apps/runtime/worker/dist/screenshot-worker.mjs /app/screenshot-worker.mjs
COPY --from=builder --chown=exepad:exepad /repo/apps/runtime/client/dist /app/client/dist
# Sibling build artifacts the export builders vendor into downloaded projects
# (resolved relative to server.mjs at /app — see lib/export/artifacts.ts):
#   standalone-backend.mjs → the source export's vendored /rpc backend
#   dist-eject             → the source export's React-external SDK
COPY --from=builder --chown=exepad:exepad /repo/apps/runtime/worker/dist/standalone-backend.mjs /app/standalone-backend.mjs
COPY --from=builder --chown=exepad:exepad /repo/packages/exepad-sdk/dist-eject /app/dist-eject

# Licence + attribution text, so the distributed image carries the AGPL terms and
# the third-party notices alongside the binaries they cover.
COPY --chown=exepad:exepad LICENSE NOTICE /app/

COPY docker/entrypoint.sh /usr/local/bin/exepad-entrypoint
RUN chmod +x /usr/local/bin/exepad-entrypoint

# The studio's own version, baked at release build (release.yml passes the tag).
# Read by /api/settings/update-check to power the in-app "update available"
# banner; 'dev' on local/source builds disables the comparison. (The SPA gets the
# same value through VITE_EXEPAD_VERSION in the builder stage — ARGs do not cross
# stages, so it is declared in both.)
#
# EXEPAD_SOURCE_URL backs the unauthenticated AGPL section 13 source offer the
# server emits (GET /source + the <link rel="license"> on every served page —
# lib/source-offer.ts). Unlike the SPA's baked-in copy it is read at RUNTIME, so
# a fork can also override it on an already-built image with `-e`.
ARG EXEPAD_VERSION=dev
ARG EXEPAD_SOURCE_URL
ENV EXEPAD_VERSION=${EXEPAD_VERSION} \
    EXEPAD_SOURCE_URL=${EXEPAD_SOURCE_URL} \
    EXEPAD_DATA_DIR=/data \
    EXEPAD_CLIENT_DIST=/app/client/dist \
    EXEPAD_AGENT_URL=http://127.0.0.1:8081 \
    PORT=8080

# ── Drop root ──────────────────────────────────────────────────────────────
# Run every runtime process (Caddy, the Python agent, the Node server) as an
# unprivileged user so a compromise inside the shared container is not
# in-container root. The user, /data ownership, the Caddy file capability, and
# per-layer /app ownership were all established EARLY (see the "Runtime user"
# block above) — deliberately NO `chown -R /app` here: that rewrote ~800 MB of
# already-copied files into a duplicate overlay layer.
USER exepad

# 80/443 = Caddy (HTTPS, in-image); 8080 = the Node runtime behind it.
EXPOSE 80 443 8080
VOLUME ["/data"]

# Probe the runtime on its ACTUAL port. PORT is operator-overridable (`-e PORT=…`,
# and PaaS hosts like Render inject their own), so a hardcoded 8080 would report any
# non-default container permanently unhealthy and orchestrators would restart-loop
# it. HEALTHCHECK CMD runs through a shell, so the ${PORT} expansion works.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-8080}/auth/status" >/dev/null || exit 1

ENTRYPOINT ["exepad-entrypoint"]
