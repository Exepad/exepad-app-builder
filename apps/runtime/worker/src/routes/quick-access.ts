/**
 * "Quick Access" — one-click public link to the WHOLE studio via a Cloudflare
 * Quick Tunnel (`*.trycloudflare.com`), for a rig BEHIND A ROUTER (NAT/CGNAT/DSL)
 * where no custom domain / port-forwarding is possible.
 *
 *   POST /api/quick-access/start   → spawn `cloudflared` at the studio's loopback
 *        HTTP port, return the random public URL.
 *   GET  /api/quick-access/status  → SSE, LOCAL operator↔container only, reporting
 *        {status,url,error}.
 *   POST /api/quick-access/stop    → kill cloudflared.
 *
 * DIFFERENCE FROM routes/publish.ts (the per-app "Share live URL"): that one
 * tunnels a SINGLE published app behind a default-deny restricted listener and
 * deliberately never exposes the studio. This one intentionally tunnels the whole
 * studio so the OPERATOR can reach their own rig remotely. That is safe because the
 * OPERATOR CONTROL PLANE is login-gated end-to-end: every operator/admin route
 * (settings/LLM key, orchestrate, admin, network, domains, deploy) requires the
 * platform session, and the gateway rebuilds identity from the validated cookie
 * (spoofed X-User-* headers are ignored), so a tunnel visitor cannot forge auth.
 * The URL is random, unguessable, and ephemeral. What an unauthenticated visitor
 * CAN reach is the public surface the studio already serves on the LAN — the login
 * page, and any app the operator has PUBLISHED in-platform (its config + public
 * data) — so Quick Access widens that from LAN to internet for the tunnel's life.
 * It is for reaching YOUR OWN rig — not for publishing (use "Share live URL").
 * All routes here require an authenticated operator.
 *
 * cloudflared runs on the same host and dials 127.0.0.1 on the plain-HTTP port
 * main.ts always keeps up. That listener's bind scope varies (`httpHost` in
 * server/main.ts): 127.0.0.1 when the runtime terminates TLS in-process, or when
 * EXEPAD_HTTP_BIND pins it (the host-networked composes set
 * EXEPAD_HTTP_BIND=127.0.0.1); 0.0.0.0 otherwise (plain-HTTP mode, or a front
 * proxy terminates TLS). Loopback reaches it either way, so this tunnel works in
 * every mode. TLS terminates at Cloudflare's edge and arrives as plain HTTP with
 * `X-Forwarded-Proto: https`, which the runtime honors (no self-redirect, Secure
 * cookies) — see index.ts + routes/auth.ts.
 */
import { Hono } from 'hono';
import type { ChildProcess } from 'node:child_process';
import type { Env } from '../types/env';
import { requirePlatformUser } from './auth';
import { spawnCloudflared, killChild } from '../lib/cloudflared-tunnel';

type QuickStatus = 'starting' | 'live' | 'stopping' | 'error';

interface StatusEvent {
  status: QuickStatus | 'idle';
  url: string | null;
  error: string | null;
}

interface ActiveTunnel {
  url: string | null;
  status: QuickStatus;
  error: string | null;
  startedAt: number;
  child: ChildProcess;
}

/** Single active studio tunnel — quick tunnels are one-at-a-time by design. */
let active: ActiveTunnel | null = null;

/** SSE subscribers. Global, not per-tunnel, so a stream opened before /start
 *  still receives the live URL when the tunnel comes up. */
const statusWatchers = new Set<(ev: StatusEvent) => void>();

function emit(ev: StatusEvent): void {
  for (const w of statusWatchers) {
    try {
      w(ev);
    } catch {
      /* a dead stream must not break the others */
    }
  }
}

function currentSnapshot(): StatusEvent {
  if (active) return { status: active.status, url: active.url, error: active.error };
  return { status: 'idle', url: null, error: null };
}

/** The studio's loopback HTTP port cloudflared should dial. main.ts stamps the
 *  actually-bound port into EXEPAD_HTTP_ACTIVE_PORT; fall back to the configured
 *  PORT, then the default. */
function studioHttpPort(): number {
  const n = Number(process.env.EXEPAD_HTTP_ACTIVE_PORT || process.env.PORT || 8080);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 8080;
}

async function stopTunnel(): Promise<void> {
  const cur = active;
  if (!cur) return;
  active = null;
  cur.status = 'stopping';
  emit({ status: 'stopping', url: null, error: null });
  await killChild(cur.child);
  // Only announce idle if nothing NEW took over during the (multi-ms) child drain —
  // a stop-then-start would otherwise emit a stale 'idle' after the new 'live'.
  if (active === null) emit({ status: 'idle', url: null, error: null });
}

/** Synchronous teardown for process 'exit' (no async work allowed there). */
function stopTunnelSync(): void {
  if (!active) return;
  const cur = active;
  active = null;
  try {
    cur.child.kill('SIGKILL');
  } catch {
    /* gone */
  }
}

let hooksRegistered = false;
function registerShutdownHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  // Never leave a tunnel pointing at the operator's studio after the process exits.
  process.on('exit', stopTunnelSync);
  if (process.env.VITEST) return; // don't hijack signals under the test runner
  const onSignal = (): void => {
    stopTunnelSync();
    process.exit(0);
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}
registerShutdownHooks();

export type QuickResult =
  | { ok: true; url: string | null; status: QuickStatus }
  | { ok: false; status: 409 | 502; error: string };

/**
 * Stand up (or return the existing) Quick Access tunnel to the studio. The
 * reusable core of POST /start — single tunnel at a time.
 */
export async function startQuickAccess(): Promise<QuickResult> {
  if (active && active.status !== 'error') {
    return { ok: true, url: active.url, status: active.status };
  }
  // A prior errored tunnel lingers only as a dead reference; clear it before retry.
  if (active) active = null;

  const tunnel = spawnCloudflared(studioHttpPort());
  active = {
    url: null,
    status: 'starting',
    error: null,
    startedAt: Date.now(),
    child: tunnel.child,
  };
  emit({ status: 'starting', url: null, error: null });

  // If the child dies after going live, surface an error.
  tunnel.child.on('close', () => {
    if (active && active.child === tunnel.child && active.status === 'live') {
      active.status = 'error';
      active.error = 'Tunnel disconnected';
      emit({ status: 'error', url: null, error: active.error });
    }
  });

  try {
    const url = await tunnel.urlReady;
    if (active && active.child === tunnel.child) {
      active.url = url;
      active.status = 'live';
      emit({ status: 'live', url, error: null });
      return { ok: true, url, status: 'live' };
    }
    // Stopped while we were waiting.
    return { ok: false, status: 409, error: 'Quick Access was cancelled before it became ready' };
  } catch (e) {
    // Scope teardown to THIS tunnel: a concurrent stop→restart may have replaced
    // `active` with a NEWER tunnel that must not be killed by this failure. If we're
    // still the active tunnel, tear it down; otherwise just reap our own dead child.
    if (active && active.child === tunnel.child) {
      await stopTunnel();
    } else {
      await killChild(tunnel.child);
    }
    const msg = e instanceof Error ? e.message : 'tunnel failed';
    return { ok: false, status: 502, error: `Could not establish the tunnel: ${msg}` };
  }
}

export const quickAccess = new Hono<{ Bindings: Env }>();

// ─── POST /api/quick-access/start ─────────────────────────────────────────────
quickAccess.post('/start', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  const result = await startQuickAccess();
  if (!result.ok) return c.json({ success: false, error: result.error }, result.status);
  return c.json({ success: true, url: result.url, status: result.status });
});

// ─── GET /api/quick-access/status (SSE, local operator↔container only) ─────────
quickAccess.get('/status', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (ev: StatusEvent): void => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          /* stream closed */
        }
      };
      send(currentSnapshot());
      statusWatchers.add(send);

      const heartbeat: ReturnType<typeof setInterval> = setInterval(() => {
        try {
          controller.enqueue(enc.encode(': ping\n\n'));
        } catch {
          /* closed */
        }
      }, 25_000);
      heartbeat.unref?.();

      const abort = (): void => {
        clearInterval(heartbeat);
        statusWatchers.delete(send);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      c.req.raw.signal.addEventListener('abort', abort);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
});

// ─── POST /api/quick-access/stop ──────────────────────────────────────────────
quickAccess.post('/stop', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);
  await stopTunnel();
  return c.json({ success: true });
});

/** Test-only: force-teardown any active tunnel (used in afterEach). */
export function _stopQuickAccessSyncForTests(): void {
  stopTunnelSync();
}
