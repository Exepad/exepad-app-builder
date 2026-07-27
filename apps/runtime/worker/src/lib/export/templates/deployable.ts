/**
 * Static scaffolding for the **deployable bundle (D1)** — a run-ready,
 * self-contained copy of ONE published app the user hosts on their own VPS.
 *
 * The bundle ships the prebuilt runtime server (`app/server.mjs`), the slim SPA
 * (`app/client/dist`), and the app's published snapshot + data DB (`data/`),
 * pinned to the app via `EXEPAD_SINGLE_APP_ID`. `docker compose up` → a live,
 * full-stack app. No studio/builder/agent, no platform registry, no operator
 * account (the builder surface is gated off in the runtime; see lib/single-app.ts).
 */

export interface DeployableInputs {
  appId: string;
  appName: string;
  slug: string;
  /** Pinned native/binary externals the bundled server keeps out of its bundle. */
  betterSqlite3Version: string;
  esbuildVersion: string;
  /** Exepad build the shipped runtime came from + where its source lives
   *  (AGPL §6: conveyed object code names its Corresponding Source). */
  exepadVersion: string;
  exepadSourceUrl: string;
}

/** Quote a value for a Dockerfile `ENV k=v` line. The source URL and version
 *  come from the exporting server's environment, so escape rather than trust:
 *  JSON quoting neutralises spaces/quotes/backslashes, and newlines (which no
 *  quoting survives) are stripped first. */
function envValue(v: string): string {
  return JSON.stringify(v.replace(/[\r\n]+/g, ''));
}

/** Slim serve-only Dockerfile (no Python/agent/Chromium/tailwind/tsc). */
export function dockerfile(i: DeployableInputs): string {
  return `# syntax=docker/dockerfile:1
#
# ${i.appName} — self-contained, run-ready Exepad app (ONE public port, 8080).
#
# Built by Exepad's "Deployable package" export. Serves exactly this one app:
# no studio/builder, no agent, no platform registry. The runtime is pinned to
# the app via EXEPAD_SINGLE_APP_ID.
#
#   docker compose up --build        # or: docker build -t ${i.slug} . && docker run -p 8080:8080 ${i.slug}
#
FROM node:22-bookworm-slim
WORKDIR /app

# The bundled server keeps these native/binary packages external; install them
# here. better-sqlite3 + esbuild ship prebuilt binaries for linux-x64/node22, so
# this needs no compiler toolchain.
RUN npm init -y >/dev/null 2>&1 \\
 && npm install --omit=dev --no-audit --no-fund \\
      better-sqlite3@${i.betterSqlite3Version} esbuild@${i.esbuildVersion} \\
 && npm cache clean --force

# Prebuilt runtime: the bundled Hono server + the slim SPA.
COPY app/ /app/

# The app's published snapshot + data DB. Baked as a SEED: the entrypoint copies
# it into the /data volume on first boot only, so app-user data created later
# survives container rebuilds.
COPY data/ /app/seed-data/

COPY entrypoint.sh /usr/local/bin/exepad-app-entrypoint
RUN chmod +x /usr/local/bin/exepad-app-entrypoint

# EXEPAD_SOURCE_URL is the AGPL section 13 source offer this app serves to ITS
# users (\`GET /source\` + the \`<link rel="license">\` on every page). The runtime
# reads it at boot, so it must be baked here — otherwise the running app would
# point at upstream Exepad while the README beside it names ${i.exepadSourceUrl}.
# If you modify the runtime in \`app/\`, change this to where YOUR source lives.
ENV NODE_ENV=production \\
    EXEPAD_DATA_DIR=/data \\
    EXEPAD_CLIENT_DIST=/app/client/dist \\
    EXEPAD_SINGLE_APP_ID=${i.appId} \\
    EXEPAD_SOURCE_URL=${envValue(i.exepadSourceUrl)} \\
    EXEPAD_VERSION=${envValue(i.exepadVersion)} \\
    PORT=8080

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \\
  CMD node -e "fetch('http://127.0.0.1:8080/auth/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["exepad-app-entrypoint"]
`;
}

/** First-boot entrypoint: seed /data once, bootstrap a stable session secret. */
export const ENTRYPOINT_SH = `#!/usr/bin/env bash
#
# Self-contained Exepad app entrypoint.
#   1. Seed /data from the baked snapshot on first run (empty volume only).
#   2. Bootstrap + persist a stable session secret (signs per-app user sessions).
#   3. Exec the runtime server (pinned to the one app via EXEPAD_SINGLE_APP_ID).
#
set -euo pipefail

DATA_DIR="\${EXEPAD_DATA_DIR:-/data}"
SECRETS_FILE="\$DATA_DIR/secrets/env.sh"

mkdir -p "\$DATA_DIR"

# Seed once: if the volume has no app data yet, copy the baked snapshot in. On
# subsequent boots the existing volume (incl. any data app users created) wins.
if [ ! -e "\$DATA_DIR/apps" ] && [ -d /app/seed-data ]; then
  echo "[exepad] first boot — seeding /data from the bundled snapshot…"
  cp -a /app/seed-data/. "\$DATA_DIR/"
fi

mkdir -p "\$DATA_DIR/secrets"
gen() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \\n'; }

# shellcheck disable=SC1090
[ -f "\$SECRETS_FILE" ] && . "\$SECRETS_FILE"
: "\${EXEPAD_SESSION_SECRET:=\$(gen)}"
export EXEPAD_SESSION_SECRET
# The per-app user session cookie is signed with this; alias to the session
# secret so it is stable across restarts.
export PLATFORM_BRIDGE_SECRET="\${PLATFORM_BRIDGE_SECRET:-\$EXEPAD_SESSION_SECRET}"

umask 077
printf "export EXEPAD_SESSION_SECRET='%s'\\n" "\$EXEPAD_SESSION_SECRET" > "\$SECRETS_FILE"

exec node /app/server.mjs
`;

/** docker-compose for a one-command run. */
export function dockerCompose(i: DeployableInputs): string {
  return `# ${i.appName} — one command: \`docker compose up --build\`
services:
  ${i.slug}:
    build: .
    image: ${i.slug}
    ports:
      - "8080:8080"
    volumes:
      # App data persists here (published snapshot + DB + any user-created rows).
      - ${i.slug}-data:/data
    restart: unless-stopped
    environment:
      # AGPL section 13: where this app's \`GET /source\` offer and the
      # \`<link rel="license">\` on its pages point. Baked into the image too;
      # set EXEPAD_SOURCE_URL in your .env to override — do that if you modify
      # the runtime under app/ and serve it to others.
      EXEPAD_SOURCE_URL: "\${EXEPAD_SOURCE_URL:-${i.exepadSourceUrl}}"
      # Uncomment to pin a session secret across rebuilds / multiple replicas:
      # EXEPAD_SESSION_SECRET: "change-me-to-a-long-random-string"
      # EXEPAD_COOKIE_SECURE: "1"   # set when serving over HTTPS

volumes:
  ${i.slug}-data:
`;
}

export const ENV_EXAMPLE = `# Optional runtime configuration for your deployed app.
# Copy to .env and adjust, then: docker compose --env-file .env up --build

# Public port (host side). The container always listens on 8080 internally.
# PORT=8080

# Pin the session secret so per-app user sessions survive container rebuilds and
# stay valid across multiple replicas. If unset, a random one is generated and
# persisted in the /data volume on first boot.
# EXEPAD_SESSION_SECRET=change-me-to-a-long-random-string

# Set to 1 when serving over HTTPS (behind a TLS-terminating reverse proxy) so
# session cookies are marked Secure.
# EXEPAD_COOKIE_SECURE=1

# AGPL section 13 source offer: where this app's \`GET /source\` redirects and
# what its pages advertise as \`<link rel="license">\`. The image already bakes
# the build it was exported from; set this only if you MODIFY the runtime under
# app/ and serve it to others, pointing it at your own source.
# EXEPAD_SOURCE_URL=https://example.org/my-exepad-fork
`;

export const DOCKERIGNORE = `.git
*.md
.env
`;

export function readme(i: DeployableInputs, hasLicense = true, hasNotice = true): string {
  // Optional bullets joined into the list (no trailing newline of their own).
  const structure = [
    'Dockerfile            slim serve-only image (node:22 + better-sqlite3 + esbuild)',
    'docker-compose.yml    one-command run',
    'entrypoint.sh         seeds /data on first boot; bootstraps the session secret',
    '.env.example          optional runtime config (port, session secret, HTTPS)',
    ...(hasLicense ? ['LICENSE               GNU AGPL-3.0 — covers the Exepad runtime in app/'] : []),
    ...(hasNotice ? ['NOTICE                copyright + third-party attributions'] : []),
    'app/',
    '  server.mjs          the bundled Exepad runtime server (Hono on Node)',
    '  client/dist/        the compiled SPA that renders this app',
    "data/                 your app's published snapshot + SQLite data DB (the SEED)",
  ].join('\n');

  // Only ever claim the files that actually shipped (both degrade to absent when
  // the build could not locate them).
  const licenceLine = hasLicense
    ? `The \`LICENSE\` file here is that licence text${hasNotice ? ', and `NOTICE` carries the copyright line plus the bundled third-party attributions' : ''}.
Keep ${hasNotice ? 'them' : 'it'} intact if you redistribute this bundle.`
    : `Its licence text is the GNU AGPL-3.0: https://www.gnu.org/licenses/agpl-3.0.txt
Keep the Exepad copyright notices intact if you redistribute this bundle.`;

  return `# ${i.appName} — deployable package

A **self-contained, run-ready** copy of your Exepad app. It bundles the prebuilt
runtime, the app's compiled frontend, and its backend (auto-CRUD + handlers over
a local SQLite). No external Exepad service is required — you host it yourself.

## Run it

\`\`\`bash
docker compose up --build
# → http://localhost:8080
\`\`\`

Or without Compose:

\`\`\`bash
docker build -t ${i.slug} .
docker run -p 8080:8080 -v ${i.slug}-data:/data ${i.slug}
\`\`\`

That's it — open <http://localhost:8080>. The app serves at the root; all of its
pages, components, theme, and backend work exactly as they did in Exepad.

## What's inside

\`\`\`
${structure}
\`\`\`

The runtime is pinned to this one app via \`EXEPAD_SINGLE_APP_ID=${i.appId}\`. The
studio/builder UI, the AI agent, and the deploy/admin APIs are **gated off** — a
deployed app exposes only itself.

## Your data

\`data/\` contains this app's **live data** (the SQLite database under
\`data/apps/${i.appId}/published.sqlite\`). On the **first** boot it is copied into
the \`/data\` volume; after that the volume is authoritative, so any rows your app's
users create persist across rebuilds. **Treat this bundle as sensitive** — it may
contain real user data.

## Production notes

- **HTTPS**: put a TLS-terminating reverse proxy (Caddy, nginx, Traefik) in front
  and forward to \`:8080\`. Set \`EXEPAD_COOKIE_SECURE=1\` so session cookies are
  marked Secure.
- **Backups**: snapshot the \`/data\` volume to back up app data.
- **Scaling**: the backend is single-node SQLite (single writer). Run one replica
  per app; scale vertically. Pin \`EXEPAD_SESSION_SECRET\` if you run more than one.
- **Updates**: re-export from Exepad after you publish changes, then
  \`docker compose up --build\` again (your \`/data\` volume is preserved).

## Licensing

**Your app is yours.** Everything under \`data/\` — the pages, components, theme
and data of the app you built — is your work. Exepad LLC claims no copyright
interest in it and you may license it however you like.

**The runtime under \`app/\` is Exepad's**, licensed under the GNU Affero General
Public License v3: \`app/server.mjs\` is a built copy of the Exepad runtime server
and \`app/client/dist/\` is its compiled SPA.
${licenceLine}

This runtime was built from Exepad \`${i.exepadVersion}\`; its complete
corresponding source is at ${i.exepadSourceUrl}. The bundle passes that same
offer on to *your* users: it is baked in as \`EXEPAD_SOURCE_URL\`, which the
running app serves at \`/source\` and advertises as \`<link rel="license">\` on
every page.

Because the AGPL covers use over a network, if you MODIFY that runtime and serve
it publicly you must offer your users your modified source (AGPL section 13) —
point \`EXEPAD_SOURCE_URL\` (in the \`Dockerfile\`, or via \`.env\`) at it.
Running it unmodified — what this bundle does — carries no such obligation. The
additional permissions Exepad grants around apps built on it are spelled out in
\`LICENSING.md\` in the source repository above.

---
Generated by Exepad · app \`${i.appId}\`
`;
}
