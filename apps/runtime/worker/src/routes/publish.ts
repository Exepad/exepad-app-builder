/**
 * One-click "Share live URL" — operator-facing control plane (Option A:
 * Cloudflare Quick Tunnel, `*.trycloudflare.com`).
 *
 * Owns the lifecycle for sharing ONE app at a time:
 *   POST /api/publish/start {appId}  → stand up a restricted 127.0.0.1 listener
 *        pinned to app X (lib/publish-profile.ts) + spawn `cloudflared` pointed
 *        at it, return the random public URL.
 *   GET  /api/publish/status         → SSE, LOCAL operator↔container only (never
 *        through the tunnel) reporting {status,url,error,appId}.
 *   POST /api/publish/stop           → close the listener + kill cloudflared.
 *
 * Isolation is by construction: cloudflared only ever reaches the restricted
 * listener, so the :8080 surface (admin / settings / orchestrate / other apps)
 * is unreachable through the link. See lib/publish-profile.ts for the wall.
 *
 * Quick tunnels carry no SLA, a 200 in-flight cap, no SSE through the tunnel, and
 * a random URL that dies when the process stops — so this is a single, ephemeral
 * share with no persistence; on worker restart all state is lost.
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { type ChildProcess } from 'node:child_process';
import type { Env } from '../types/env';
import { requirePlatformUser } from './auth';
import { getApp, latestDeployment, userCanAccessApp } from '../lib/meta-db';
import { buildPublishApp, type InnerFetch } from '../lib/publish-profile';
import { spawnCloudflared, killChild, extractTunnelUrl } from '../lib/cloudflared-tunnel';

/** Back-compat test seam: the URL parser moved to lib/cloudflared-tunnel.ts. */
export const _extractTunnelUrl = extractTunnelUrl;

type ShareStatus = 'starting' | 'live' | 'stopping' | 'error';

interface StatusEvent {
  status: ShareStatus | 'idle';
  url: string | null;
  error: string | null;
  appId: string | null;
}

interface ActiveShare {
  appId: string;
  ownerId: string;
  url: string | null;
  status: ShareStatus;
  error: string | null;
  startedAt: number;
  server: ReturnType<typeof serve>;
  child: ChildProcess;
}

/** Single active share — quick tunnels are one-at-a-time by design. */
let active: ActiveShare | null = null;

/** Status subscribers (the SSE streams). Global, not per-share, so a stream
 *  opened before /start still receives the live URL when sharing begins. */
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
  if (active) {
    return { status: active.status, url: active.url, error: active.error, appId: active.appId };
  }
  return { status: 'idle', url: null, error: null, appId: null };
}

/** Start the loopback restricted listener on an OS-assigned ephemeral port. */
function startRestrictedListener(
  fetchHandler: (req: Request) => Response | Promise<Response>,
): Promise<{ server: ReturnType<typeof serve>; port: number }> {
  return new Promise((resolve, reject) => {
    const server = serve(
      { fetch: fetchHandler, hostname: '127.0.0.1', port: 0 },
      (info) => resolve({ server, port: (info as { port: number }).port }),
    );
    // Bind failures arrive as an async 'error' event, not a throw (cf. main.ts).
    server.on('error', reject);
  });
}

async function stopShare(): Promise<void> {
  const cur = active;
  if (!cur) return;
  active = null;
  cur.status = 'stopping';
  emit({ status: 'stopping', url: null, error: null, appId: cur.appId });
  await killChild(cur.child);
  try {
    cur.server.close();
  } catch {
    /* already closed */
  }
  emit({ status: 'idle', url: null, error: null, appId: null });
}

/**
 * Stop the active share IF it currently targets `appId`. Used by the lifecycle
 * service so deleting or unpublishing an app also tears down any live tunnel
 * pointed at it (the single global share is otherwise decoupled from the app's
 * lifecycle — a deleted app would leave a tunnel serving a gone app). Returns
 * true when a matching share was stopped.
 */
export async function stopShareForApp(appId: string): Promise<boolean> {
  if (!active || active.appId !== appId) return false;
  await stopShare();
  return true;
}

/** Synchronous teardown for process 'exit' (no async work allowed there). */
function stopShareSync(): void {
  if (!active) return;
  const cur = active;
  active = null;
  try {
    cur.child.kill('SIGKILL');
  } catch {
    /* gone */
  }
  try {
    cur.server.close();
  } catch {
    /* gone */
  }
}

let hooksRegistered = false;
function registerShutdownHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  // Belt-and-suspenders: never leave a tunnel pointing at the operator's data
  // after the Node process exits. main.ts has no signal handler, so we own it.
  process.on('exit', stopShareSync);
  // Under the test runner, do NOT hijack signals (it would race vitest teardown).
  if (process.env.VITEST) return;
  const onSignal = (): void => {
    stopShareSync();
    process.exit(0);
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}
registerShutdownHooks();

/** Resolve the real runtime app's fetch lazily (dynamic import avoids the
 *  index → routes/publish → index module cycle). */
let innerFetchPromise: Promise<InnerFetch> | null = null;
function getInnerFetch(): Promise<InnerFetch> {
  if (!innerFetchPromise) {
    innerFetchPromise = import('../index').then((m) => {
      const runtimeApp = m.default as { fetch: (req: Request, env: Env) => Response | Promise<Response> };
      return (req: Request, env: Env) => runtimeApp.fetch(req, env);
    });
  }
  return innerFetchPromise;
}

export type ShareResult =
  | { ok: true; url: string | null; status: ShareStatus }
  | { ok: false; status: 400 | 404 | 409 | 500 | 502; error: string };

/**
 * Stand up a public-internet share (cloudflared quick tunnel) for an
 * already-published app, owner-scoped. The reusable core of POST
 * /api/publish/start. Single tunnel at a time; requires the app to be published
 * in-platform first (the tunnel serves the published surface).
 */
export async function startShareForApp(
  env: Env,
  ownerId: string,
  appId: string,
  accessToken?: string | null,
): Promise<ShareResult> {
  const app = getApp(appId);
  // Owner OR collaborator may share a published app (the active share records the
  // initiating user so unshare/teardown ownership still resolves).
  if (!app || !userCanAccessApp(ownerId, appId)) {
    return { ok: false, status: 404, error: 'App not found' };
  }

  // The link serves the PUBLISHED surface, so the app must be published first.
  const isPublished = Boolean(app.published_at) && latestDeployment(appId, 'published') != null;
  if (!isPublished) {
    return { ok: false, status: 409, error: 'Publish the app to this instance before sharing a live URL.' };
  }

  // Single tunnel at a time.
  if (active) {
    if (active.appId === appId && active.status !== 'error') {
      return { ok: true, url: active.url, status: active.status };
    }
    return {
      ok: false,
      status: 409,
      error: 'Another app is currently shared. Stop it before sharing this one.',
    };
  }

  const inner = await getInnerFetch();
  const publishApp = buildPublishApp(appId, env, {
    inner,
    accessToken: accessToken ? String(accessToken) : null,
    // Read lazily: the public URL is assigned only after cloudflared reports it
    // (below), so at request time `active.url` is populated for this app.
    getPublicOrigin: () => (active && active.appId === appId ? active.url : null),
  });

  let listener: { server: ReturnType<typeof serve>; port: number };
  try {
    listener = await startRestrictedListener((req: Request) => publishApp.fetch(req, env));
  } catch {
    return { ok: false, status: 500, error: 'Failed to start the local share listener' };
  }

  const tunnel = spawnCloudflared(listener.port);
  active = {
    appId,
    ownerId,
    url: null,
    status: 'starting',
    error: null,
    startedAt: Date.now(),
    server: listener.server,
    child: tunnel.child,
  };
  emit({ status: 'starting', url: null, error: null, appId });

  // If the child dies after going live, surface an error and free the listener.
  tunnel.child.on('close', () => {
    if (active && active.child === tunnel.child && active.status === 'live') {
      active.status = 'error';
      active.error = 'Tunnel disconnected';
      try {
        active.server.close();
      } catch {
        /* gone */
      }
      emit({ status: 'error', url: null, error: active.error, appId });
    }
  });

  try {
    const url = await tunnel.urlReady;
    if (active && active.child === tunnel.child) {
      active.url = url;
      active.status = 'live';
      emit({ status: 'live', url, error: null, appId });
      return { ok: true, url, status: 'live' };
    }
    // Stopped while we were waiting.
    return { ok: false, status: 409, error: 'Share was cancelled before it became ready' };
  } catch (e) {
    await stopShare();
    const msg = e instanceof Error ? e.message : 'tunnel failed';
    return { ok: false, status: 502, error: `Could not establish the tunnel: ${msg}` };
  }
}

export const publish = new Hono<{ Bindings: Env }>();

// ─── POST /api/publish/start ──────────────────────────────────────────────────
publish.post('/start', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  let body: { appId?: string; accessToken?: string };
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const appId = (body.appId || '').trim();
  if (!appId) return c.json({ success: false, error: 'appId is required' }, 400);

  const result = await startShareForApp(c.env, authed.user.id, appId, body.accessToken);
  if (!result.ok) return c.json({ success: false, error: result.error }, result.status);
  return c.json({ success: true, url: result.url, status: result.status, ttl: 0 });
});

// ─── GET /api/publish/status (SSE, local operator↔container only) ──────────────
publish.get('/status', async (c) => {
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

// ─── POST /api/publish/stop ───────────────────────────────────────────────────
publish.post('/stop', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);
  // Any owner/collaborator of the shared app may stop it — not only the user who
  // started it (a collaborator-started tunnel must still be stoppable by the owner).
  if (active && !userCanAccessApp(authed.user.id, active.appId)) {
    return c.json({ success: false, error: 'No share to stop' }, 404);
  }
  await stopShare();
  return c.json({ success: true });
});

/** Test-only: force-teardown any active share (used in afterEach). */
export function _stopShareSyncForTests(): void {
  stopShareSync();
}

/** Test-only: inject the inner re-entry so a test need not load the whole
 *  ../index module graph just to exercise the tunnel lifecycle. */
export function _setInnerFetchForTests(fn: InnerFetch | null): void {
  innerFetchPromise = fn ? Promise.resolve(fn) : null;
}

/** Test-only: start a REAL restricted listener (the exact serve() cloudflared
 *  points at) over a stub inner, returning its loopback port. Lets a test prove
 *  isolation over a real socket without importing @hono/node-server directly. */
export async function _startListenerForTests(
  appId: string,
  inner: InnerFetch,
  accessToken: string | null = null,
): Promise<{ port: number; close: () => void }> {
  const app = buildPublishApp(appId, {} as Env, { inner, accessToken });
  const { server, port } = await startRestrictedListener((req) => app.fetch(req, {} as Env));
  return { port, close: () => server.close() };
}
