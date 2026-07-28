/**
 * Self-hosted single-container entrypoint.
 *
 * Boots the runtime Hono app on bare Node via `@hono/node-server`:
 *   1. install the in-memory Cache API shim (so `app-config`'s Layer-2 cache works)
 *   2. ensure the `/data` tree exists
 *   3. build the runtime Env from process.env + local adapters
 *   4. serve the SPA + API gateway on one port
 *
 * The app-backend is invoked in-process by the gateway (see dispatch-local.ts);
 * the Python agent runs separately on :8081 and is reached via the `/agent/*`
 * reverse-proxy in index.ts.
 */
import { installCacheShim, closeAllDbs } from '@exepad/local-adapters';
import { serve } from '@hono/node-server';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import app, { rewriteFriendlySlug } from '../index';
import { buildRuntimeEnv } from './build-runtime-env';
import { seedAdminFromEnv } from '../routes/auth';
import { startMaintenanceCron } from './maintenance';
import { isSingleAppMode } from '../lib/single-app';
import { ensureSelfSignedCert } from './self-signed-cert';
import { resolveInstanceTarget } from '../lib/public-address';
import {
  effectiveHttpPort,
  effectiveHttpsPort,
  effectiveHttpsDisable,
  effectiveNet,
  NET_KEYS,
  DEFAULT_HTTP_PORT,
} from '../lib/net-config';

installCacheShim();

// This process is the container's ONLY public listener, and entrypoint.sh exits
// the whole container if `node` dies (`wait -n`). A stray rejection (e.g. from
// the maintenance cron's async work) would crash Node by default on Node 22, so
// log instead of letting the container recycle on a non-fatal error.
process.on('unhandledRejection', (reason) => {
  console.error('[exepad] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[exepad] uncaughtException:', err);
});

// Data root. The shipped container sets EXEPAD_DATA_DIR=/data explicitly
// (Dockerfile) and `run.sh local` exports <repo>/.exepad-data — only a bare
// `pnpm dev` with no launcher leaves it unset. Rather than fail on a
// non-writable `/data`, fall back to a workspace-local `.exepad-data`
// (gitignored, the same spot run.sh uses) so dev works with zero setup.
function resolveDataDir(): string {
  const fromEnv = process.env.EXEPAD_DATA_DIR;
  if (fromEnv && fromEnv.trim()) return fromEnv;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return join(dir, '.exepad-data');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(process.cwd(), '.exepad-data');
}

const DATA_DIR = resolveDataDir();
// Make the resolved dir authoritative for every downstream reader — meta-db,
// build-runtime-env, and the local storage adapters each read
// `process.env.EXEPAD_DATA_DIR` and independently default to '/data'. Writing it
// back here (before any of them run) keeps a bare `pnpm dev` on one dev dir.
process.env.EXEPAD_DATA_DIR = DATA_DIR;
for (const sub of ['apps', 'storage', 'buckets', 'uploads']) {
  mkdirSync(join(DATA_DIR, sub), { recursive: true });
}

// First-run convenience: create the operator account from env if none exists.
// Skipped in single-app serve mode — a deployable bundle has no studio/operator
// surface (the builder routes are gated off in index.ts), so there is no
// operator account to seed and no platform registry to back it.
if (!isSingleAppMode()) {
  seedAdminFromEnv().catch((e) => console.error('[exepad] admin seed failed:', e));
}

// Cookie-secure: a persisted override (Server & networking panel) wins over the
// env seed. Applied to process.env at boot so the per-request session-cookie mint
// (routes/auth.ts) picks it up without touching the request path.
{
  const c = effectiveNet(NET_KEYS.cookieSecure);
  if (c.source === 'store') process.env.EXEPAD_COOKIE_SECURE = c.value;
}

const env = buildRuntimeEnv();

// Whether the runtime terminates TLS itself (the self-host default). Computed here
// so BOTH the HTTP-listener bind scope (below) and the HTTPS block (further down)
// share one decision. A persisted override wins over EXEPAD_HTTPS_DISABLE.
const httpsDisabled = effectiveHttpsDisable();
const tlsFronted = /^(1|true|yes|on)$/i.test(process.env.EXEPAD_TLS_FRONTED ?? '');
const httpsInProcess = !httpsDisabled && !tlsFronted;

// The ONE externally-reachable port must be the studio (HTTPS) port. So when the
// runtime serves HTTPS in-process, the plain-HTTP listener exists ONLY for loopback
// callers (the thumbnail cron + Docker healthcheck curl 127.0.0.1) — bind it to
// 127.0.0.1 so it is NOT reachable from any external interface, and no LAN client can
// bypass TLS to send session cookies in cleartext. HTTP binds all interfaces only
// when it is itself the reachable port: HTTPS disabled (plain-HTTP mode), or a front
// proxy terminates TLS (in-image Caddy on 127.0.0.1, or a sidecar reaching us over
// the container network — Docker's published `ports:` then controls exposure).
//
// EXEPAD_HTTP_BIND overrides that choice, and exists for HOST-NETWORKED deployments
// (`network_mode: host`), where there is no Docker port mapping to hide behind: a
// TLS-fronted runtime would otherwise bind 0.0.0.0:8080 straight onto the host's
// interfaces, serving the studio in cleartext beside Caddy's HTTPS front. Those
// compose files set EXEPAD_HTTP_BIND=127.0.0.1 — safe because every legitimate
// caller already targets loopback (in-image Caddy `reverse_proxy 127.0.0.1:8080`,
// the sidecar Caddyfiles, the Docker healthcheck, the quick tunnel).
//
// The override is IGNORED when HTTPS is disabled, because then this listener is
// the only way in and a loopback pin would make the instance unreachable. That
// keeps the two knobs independent: an operator fronting their own TLS proxy sets
// EXEPAD_HTTPS_DISABLE=1 and stays reachable without having to know that the
// shipped compose also pins a bind address.
const httpBindOverride = httpsDisabled ? '' : (process.env.EXEPAD_HTTP_BIND?.trim() ?? '');
if (httpsDisabled && process.env.EXEPAD_HTTP_BIND?.trim()) {
  console.log(
    '[exepad] EXEPAD_HTTPS_DISABLE is set, so plain HTTP is the public port — ' +
      `ignoring EXEPAD_HTTP_BIND=${process.env.EXEPAD_HTTP_BIND.trim()} and binding all interfaces.`,
  );
}
const httpHost = httpBindOverride || (httpsInProcess ? '127.0.0.1' : '0.0.0.0');

// HTTP listener. The port is the CONFIGURED value — a persisted override wins over
// the PORT env seed. If it can't bind (typo'd, occupied, or privileged <1024),
// fall back to the default port so a bad setting can never lock the operator out
// of the instance. The actually-bound port is stashed for the panel's readout.
let httpServer!: ReturnType<typeof serve>;
function startHttp(p: number): void {
  httpServer = serve(
    { fetch: (request: Request) => app.fetch(rewriteFriendlySlug(request), env), port: p, hostname: httpHost },
    (info) => {
      console.log(
        `[exepad] runtime listening on http://${httpHost}:${info.port}` +
          (httpHost === '127.0.0.1' ? ' (loopback only — not reachable from other hosts)' : ''),
      );
      process.env.EXEPAD_HTTP_ACTIVE_PORT = String(info.port);
    },
  );
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if ((err.code === 'EADDRINUSE' || err.code === 'EACCES') && p !== DEFAULT_HTTP_PORT) {
      console.error(
        `[exepad] cannot bind HTTP port ${p} (${err.code}) — falling back to ${DEFAULT_HTTP_PORT}. ` +
          `Check the configured port in Settings → Access & Domains → Server.`,
      );
      startHttp(DEFAULT_HTTP_PORT);
    } else {
      console.error(`[exepad] HTTP listener error on port ${p}:`, err);
    }
  });
}
startHttp(effectiveHttpPort());

// Graceful shutdown: entrypoint.sh sends SIGTERM on container stop. Stop taking
// new connections, then TRUNCATE-checkpoint every SQLite WAL and close the
// pooled handles so a restart opens clean files (no oversized `-wal` sidecar to
// recover). A short backstop force-exits if connection draining stalls.
let shuttingDown = false;
function gracefulShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[exepad] ${signal} received — checkpointing databases and shutting down.`);
  const finish = (): never => {
    try {
      closeAllDbs();
    } catch (e) {
      console.error('[exepad] error during DB checkpoint/close:', e);
    }
    process.exit(0);
  };
  const backstop = setTimeout(finish, 4000);
  backstop.unref?.();
  try {
    httpServer.close(() => finish());
  } catch {
    finish();
  }
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// HTTPS by default (self-hosted). The runtime serves TLS in-process so a fresh
// install is encrypted out of the box with ZERO config — no reverse proxy, no
// manually-generated cert. The cert is a per-instance self-signed pair
// auto-minted into the data volume (server/self-signed-cert.ts); a publicly
// reachable box additionally gets a browser-trusted Let's Encrypt cert via the
// Caddy sidecar the default compose fronts (it sets EXEPAD_HTTPS_DISABLE=1 here
// so we don't double-terminate TLS). The plain HTTP listener above STAYS UP for
// loopback callers ONLY (bound to 127.0.0.1 in this mode) — the thumbnail cron hits
// http://127.0.0.1:PORT (server/maintenance.ts) and the Docker healthcheck curls
// http://127.0.0.1:8080. Externally, this HTTPS port is the only reachable one. Opt
// out entirely with EXEPAD_HTTPS_DISABLE=1 (e.g. behind your own TLS-terminating
// proxy). Skipped too when EXEPAD_TLS_FRONTED=1 — the container's in-image Caddy
// already terminates TLS and reverse-proxies to us, so a second in-process listener
// would be redundant (the runtime then serves plain HTTP for Caddy to proxy).
// httpsDisabled / tlsFronted / httpsInProcess were resolved above (they also decide
// the HTTP listener's bind scope). A persisted override wins over EXEPAD_HTTPS_DISABLE.
if (httpsInProcess) {
  const certFile = process.env.EXEPAD_TLS_CERT_FILE || join(DATA_DIR, 'certs', 'cert.pem');
  const keyFile = process.env.EXEPAD_TLS_KEY_FILE || join(DATA_DIR, 'certs', 'key.pem');
  // Idempotent: reuses an existing valid pair (incl. an operator-supplied cert at
  // these paths); only mints when absent/expired. Returns null if openssl is
  // unavailable, in which case we degrade to HTTP-only rather than crash.
  const ensured = ensureSelfSignedCert({
    certFile,
    keyFile,
    publicIp: process.env.EXEPAD_PUBLIC_IP,
    publicHost: process.env.EXEPAD_PUBLIC_HOST,
  });
  if (ensured) {
    try {
      const cert = readFileSync(ensured.certFile);
      const key = readFileSync(ensured.keyFile);
      const desiredHttpsPort = effectiveHttpsPort();
      const FALLBACK_HTTPS_PORT = 8443;

      // TLS terminates in-process (no upstream X-Forwarded-Proto to infer from),
      // so the platform-session/preview cookies must be marked Secure and plain
      // HTTP browser visitors redirected up to HTTPS. Since the HTTPS port is now
      // operator-editable, a bad bind must NOT leave the status readouts claiming
      // HTTPS is up — so EXEPAD_TLS_ACTIVE, the cookie-Secure default, and the
      // redirect port are ALL set inside the listen SUCCESS callback (only when a
      // listener actually binds), never optimistically before the async bind.
      const redirectPortPinned = process.env.EXEPAD_HTTPS_REDIRECT_PORT != null;

      const startHttps = (httpsPort: number): void => {
        const httpsServer = serve(
          {
            fetch: (request: Request) => app.fetch(rewriteFriendlySlug(request), env),
            port: httpsPort,
            createServer: createHttpsServer,
            serverOptions: { key, cert },
          },
          (info) => {
            console.log(`[exepad] runtime listening on https://0.0.0.0:${info.port} (TLS)`);
            // TLS is genuinely up now: mark it active, default cookies to Secure,
            // and point the HTTP->HTTPS redirect at the port we actually bound.
            process.env.EXEPAD_TLS_ACTIVE = '1';
            if (process.env.EXEPAD_COOKIE_SECURE == null) process.env.EXEPAD_COOKIE_SECURE = '1';
            if (!redirectPortPinned) process.env.EXEPAD_HTTPS_REDIRECT_PORT = String(info.port);
          },
        );
        // listen() failures (EACCES on a privileged port <1024, EADDRINUSE) arrive
        // as an async 'error' event, NOT a throw. Fall back to the default HTTPS
        // port on a privileged-port denial OR an occupied configured port (an
        // operator can now set the port, so a collision must degrade, not leave TLS
        // down) — mirroring startHttp. The `!== FALLBACK` guard prevents a loop.
        httpsServer.on('error', (err: NodeJS.ErrnoException) => {
          const recoverable = (err.code === 'EACCES' && httpsPort < 1024) || err.code === 'EADDRINUSE';
          if (recoverable && httpsPort !== FALLBACK_HTTPS_PORT) {
            console.error(
              `[exepad] cannot bind HTTPS port ${httpsPort} (${err.code}) — falling back to ${FALLBACK_HTTPS_PORT}. ` +
                `(For a privileged port grant it once: setcap cap_net_bind_service=+ep <node binary>.)`,
            );
            startHttps(FALLBACK_HTTPS_PORT);
          } else {
            console.error(`[exepad] HTTPS listener error on port ${httpsPort}:`, err);
          }
        });
      };

      if (ensured.generated) {
        console.log(`[exepad] minted a self-signed TLS certificate at ${ensured.certFile}`);
      }
      startHttps(desiredHttpsPort);
    } catch (e) {
      console.error('[exepad] HTTPS listener disabled — failed to load cert:', e);
    }
  }
}

// Warm the public-IP cache at boot (best-effort, non-blocking) so the on-demand
// TLS authorize endpoint can green-light this box's own <ip>.sslip.io hostname
// for a browser-trusted Let's Encrypt cert WITHOUT waiting for the first Studio
// visit. Inside the container the NIC carries a private docker-network address,
// so the public IP is learned via the outbound echo — pre-warm it now. Skipped
// in single-app serve mode (no custom-domain surface).
if (!isSingleAppMode()) {
  resolveInstanceTarget(Date.now()).catch((e) =>
    console.error('[exepad] public-IP warm-up skipped:', e),
  );
}

// Background maintenance: dashboard thumbnails + stuck/errored-app cleanup.
// Self-rescheduling timer; never throws out (see server/maintenance.ts). Off in
// single-app serve mode — thumbnails feed the studio dashboard, which a
// deployable bundle does not ship.
if (!isSingleAppMode()) {
  startMaintenanceCron(env);
}
