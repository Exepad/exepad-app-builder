// @vitest-environment node
/**
 * Keystone tests for WS8+9 (self-host platform: local auth + meta store +
 * build materialization + orchestration wiring).
 *
 * Covers the pieces that replace the external Django backend:
 *   - PBKDF2 password hashing roundtrip
 *   - meta.sqlite user/app/deployment store
 *   - platform session token mint → verify → gateway identity (X-User-*)
 *   - materializeBuild: artifact map → compiled JS + sources + config in storage
 *   - orchestrate route auth guard + owner-scoped app listing
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { FsStorageAdapter } from '@exepad/local-adapters';

import { hashPassword, verifyPassword } from '../../../worker/src/lib/password';
import {
  createUser,
  getUserByEmail,
  countUsers,
  createApp,
  getApp,
  touchApp,
  listAppsByOwner,
  recordDeployment,
  latestDeployment,
} from '../../../worker/src/lib/meta-db';
import {
  mintSessionToken,
  verifyPlatformSession,
  resolveGatewayIdentity,
  PLATFORM_SESSION_COOKIE,
} from '../../../worker/src/routes/gateway/auth';
import { materializeBuild, type ArtifactMap } from '../../../worker/src/server/materialize-build';
import { orchestrate, startBuild } from '../../../worker/src/routes/orchestrate';
import type { Env } from '../../../worker/src/types/env';

const SECRET = 'test-session-secret-1234567890';

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-platform-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
  process.env.EXEPAD_META_DB = join(dataDir, 'meta.sqlite');
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function storageEnv(): Env {
  return {
    CONFIG_CACHE: new FsStorageAdapter() as unknown as R2Bucket,
    PLATFORM_BRIDGE_SECRET: SECRET,
    DEPLOY_SECRET: '',
  } as unknown as Env;
}

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const stored = await hashPassword('hunter2-correct-horse');
    expect(stored.startsWith('pbkdf2$')).toBe(true);
    expect(await verifyPassword('hunter2-correct-horse', stored)).toBe(true);
    expect(await verifyPassword('wrong', stored)).toBe(false);
  });
});

describe('meta.sqlite store', () => {
  it('creates users and apps, scoped per owner', async () => {
    expect(countUsers()).toBe(0);
    const owner = createUser('owner@example.com', await hashPassword('pw'));
    const other = createUser('other@example.com', await hashPassword('pw'));
    expect(countUsers()).toBe(2);
    expect(getUserByEmail('OWNER@example.com')?.id).toBe(owner.id);

    const a1 = createApp(owner.id, 'My First App');
    createApp(owner.id, 'My Second App');
    createApp(other.id, "Other's App");

    const ownerApps = listAppsByOwner(owner.id);
    expect(ownerApps.length).toBe(2);
    expect(ownerApps.every((a) => a.owner_id === owner.id)).toBe(true);
    expect(/^a[a-z0-9]+$/.test(a1.id)).toBe(true);

    recordDeployment({ appId: a1.id, mode: 'preview', status: 'success', correlationId: 'c1' });
    expect(latestDeployment(a1.id, 'preview')?.status).toBe('success');
    expect(latestDeployment(a1.id, 'published')).toBeNull();
  });
});

describe('platform session token', () => {
  it('decodes the operator token into X-User-* identity IN PREVIEW, but NOT on the published surface', async () => {
    const token = await mintSessionToken('user-123', 'me@example.com', ['admin'], SECRET);
    const req = () =>
      new Request('https://host/x', {
        headers: { Cookie: `${PLATFORM_SESSION_COOKIE}=${token}` },
      });

    const payload = await verifyPlatformSession(req(), SECRET);
    expect(payload?.uid).toBe('user-123');
    expect(payload?.email).toBe('me@example.com');

    // PREVIEW: the operator's platform session is decoded into owner identity so
    // they can build/administer their own app.
    const preview = await resolveGatewayIdentity(req(), 'someapp', 'preview', storageEnv());
    expect(preview.isAuthenticated).toBe(true);
    expect(preview.kind).toBe('session');
    expect(preview.headers.get('X-User-Id')).toBe('user-123');
    expect(preview.headers.get('X-User-Email')).toBe('me@example.com');
    expect(preview.headers.get('X-User-Roles')).toContain('admin');

    // PUBLISHED: the published surface is the PUBLIC view of the app. The
    // operator's platform session must NOT bleed in as an admin identity — the
    // owner must see exactly what an anonymous visitor sees. Admin on published
    // requires an explicit app-level login (`exepad_app_session`) or API key.
    const published = await resolveGatewayIdentity(req(), 'someapp', 'published', storageEnv());
    expect(published.isAuthenticated).toBe(false);
    expect(published.kind).toBe('none');
    expect(published.headers.get('X-User-Id')).toBeNull();
    expect(published.headers.get('X-User-Roles')).toBeNull();
  });

  it('ignores an injected X-Platform-Token on the published surface (SPA fetch-interceptor bleed)', async () => {
    // The SPA injects X-Platform-Token on same-origin /api/*; on a published
    // localhost view that must not re-grant the operator identity the cookie
    // branch now withholds. (A bare/opaque token is enough to prove the branch
    // is skipped: in published mode it is never even validated.)
    const req = (mode: 'preview' | 'published') =>
      resolveGatewayIdentity(
        new Request('https://host/api/someapp/orders', {
          headers: { 'X-Platform-Token': 'exepad_bridge_opaque_value' },
        }),
        'someapp',
        mode,
        storageEnv(),
      );
    // Published: the branch is gated off → falls through to anonymous.
    const published = await req('published');
    expect(published.isAuthenticated).toBe(false);
    expect(published.headers.get('X-User-Id')).toBeNull();
  });

  it('rejects a tampered token', async () => {
    const token = await mintSessionToken('user-123', undefined, ['admin'], SECRET);
    const tampered = token.slice(0, -2) + 'xy';
    const req = new Request('https://host/x', {
      headers: { Cookie: `${PLATFORM_SESSION_COOKIE}=${tampered}` },
    });
    expect(await verifyPlatformSession(req, SECRET)).toBeNull();
  });
});

describe('materializeBuild', () => {
  it('compiles component/handler TSX → JS and writes sources + config to storage', async () => {
    const env = storageEnv();
    const appId = 'amaterialztest';

    const appConfig = {
      uuid: appId,
      name: 'Test',
      repo: {
        frontend: {
          components: {
            Hero: {
              type: 'code_component',
              source: 'code/frontend/components/Hero.tsx',
              compiled: 'compiled/frontend/components/Hero.js',
            },
          },
          styles: {
            theme: {
              source: 'code/frontend/styles/theme.css',
              compiled: 'compiled/frontend/styles/theme.css',
            },
            compiled: {
              source: 'code/frontend/styles/theme.css',
              compiled: 'compiled/frontend/styles/compiled.css',
            },
          },
        },
        backend: {
          handlers: {
            doThing: {
              source: 'code/backend/handlers/doThing.tsx',
              compiled: 'compiled/backend/handlers/doThing.js',
            },
          },
        },
      },
    };

    const artifacts: ArtifactMap = {
      'app_config.json': JSON.stringify(appConfig),
      'codefocus_component:Hero.tsx':
        'export default function Hero() { return <div className="x">hello</div>; }',
      'handler_code:doThing.tsx':
        'export default async function doThing(ctx: any) { return { ok: true }; }',
      'codefocus_style:theme.css': ':root { --x: 1; }',
      'codefocus_style:compiled.css': '.x { color: red; }',
    };

    const result = await materializeBuild(env, appId, artifacts);
    expect(result.configPath).toBe('preview/app-config.json');

    const compiledComponent = await env.CONFIG_CACHE.get(
      `${appId}/compiled/frontend/components/Hero.js`,
    );
    expect(compiledComponent).not.toBeNull();
    const componentJs = await compiledComponent!.text();
    // JSX compiled to a createElement call; the .tsx type annotation is gone.
    expect(componentJs).toContain('createElement');

    const compiledHandler = await env.CONFIG_CACHE.get(
      `${appId}/compiled/backend/handlers/doThing.js`,
    );
    expect(compiledHandler).not.toBeNull();
    const handlerJs = await compiledHandler!.text();
    expect(handlerJs).toContain('ok');
    expect(handlerJs).not.toContain(': any'); // type annotation stripped

    // Sources + styles + config all landed.
    expect(await env.CONFIG_CACHE.get(`${appId}/code/frontend/components/Hero.tsx`)).not.toBeNull();
    expect(await env.CONFIG_CACHE.get(`${appId}/compiled/frontend/styles/compiled.css`)).not.toBeNull();
    const cfgObj = await env.CONFIG_CACHE.get(`${appId}/preview/app-config.json`);
    expect(cfgObj).not.toBeNull();
    expect(JSON.parse(await cfgObj!.text()).uuid).toBe(appId);
  });
});

describe('orchestrate routes', () => {
  it('rejects unauthenticated app listing and returns owner apps when authed', async () => {
    const env = storageEnv();
    const user = createUser('studio@example.com', await hashPassword('pw'));
    createApp(user.id, 'Studio App A');
    createApp(user.id, 'Studio App B');

    const noAuth = await orchestrate.fetch(
      new Request('https://host/apps', { method: 'GET' }),
      env,
    );
    expect(noAuth.status).toBe(401);

    const token = await mintSessionToken(user.id, user.email, ['admin'], SECRET);
    const authed = await orchestrate.fetch(
      new Request('https://host/apps', {
        method: 'GET',
        headers: { Cookie: `${PLATFORM_SESSION_COOKIE}=${token}` },
      }),
      env,
    );
    expect(authed.status).toBe(200);
    const body = (await authed.json()) as { success: boolean; apps: Array<{ name: string }> };
    expect(body.success).toBe(true);
    expect(body.apps.map((a) => a.name).sort()).toEqual(['Studio App A', 'Studio App B']);
  });

  it('keyset-paginates the app listing with limit + cursor and no overlap', async () => {
    const env = storageEnv();
    const user = createUser('pager@example.com', await hashPassword('pw'));
    // Five apps; created newest-last, so the listing (updated_at,id DESC) returns
    // App E first. Same-ms timestamps are disambiguated by the id tiebreaker.
    for (const n of ['A', 'B', 'C', 'D', 'E']) createApp(user.id, `App ${n}`);
    const token = await mintSessionToken(user.id, user.email, ['admin'], SECRET);

    const fetchPage = async (cursor?: string) => {
      const qs = `limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await orchestrate.fetch(
        new Request(`https://host/apps?${qs}`, {
          method: 'GET',
          headers: { Cookie: `${PLATFORM_SESSION_COOKIE}=${token}` },
        }),
        env,
      );
      expect(res.status).toBe(200);
      return (await res.json()) as {
        success: boolean;
        apps: Array<{ id: string; name: string }>;
        nextCursor: string | null;
      };
    };

    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const body = await fetchPage(cursor ?? undefined);
      expect(body.apps.length).toBeLessThanOrEqual(2);
      seen.push(...body.apps.map((a) => a.id));
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    // All five apps returned exactly once, across 3 pages (2 + 2 + 1).
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    expect(seen).toHaveLength(5);
  });

  it('rejects a non-string prompt with 400, not a 500 (defensive coercion)', async () => {
    // Regression: `(opts.prompt || '').trim()` threw a TypeError on a numeric
    // prompt → opaque 500. A malformed direct API client must get a clean 400.
    const env = storageEnv();
    const user = createUser('badprompt@example.com', await hashPassword('pw'));
    const token = await mintSessionToken(user.id, user.email, ['admin'], SECRET);

    const res = await orchestrate.fetch(
      new Request('https://host/run', {
        method: 'POST',
        headers: { Cookie: `${PLATFORM_SESSION_COOKIE}=${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 12345 }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('prompt is required');
  });
});

describe('startBuild — failed first build auto-reaps the orphaned app', () => {
  // Point the build pump at an unreachable agent so the build fails fast and the
  // failure path flips the app to 'error'.
  const prevAgent = process.env.EXEPAD_AGENT_URL;
  beforeAll(() => {
    process.env.EXEPAD_AGENT_URL = 'http://127.0.0.1:59999';
  });
  afterAll(() => {
    if (prevAgent === undefined) delete process.env.EXEPAD_AGENT_URL;
    else process.env.EXEPAD_AGENT_URL = prevAgent;
  });

  it('reaps a brand-new app whose first build fails when the caller opts in (Studio)', async () => {
    const env = storageEnv();
    const user = createUser('reap@example.com', await hashPassword('pw'));
    const result = await startBuild(env, user, {
      prompt: 'an app that will fail to build',
      reapHuskOnCreateFailure: true, // the interactive Studio /run path
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const appId = result.app.id;
    await result.run.done; // wait for the pump (incl. the reap in its finally)
    expect(getApp(appId)).toBeNull();
  });

  it('does NOT reap a failed first build for REST/agent callers (job stays pollable)', async () => {
    // Without the opt-in flag (how startBuildJob calls it), a failed create must
    // leave the app so the create→poll-for-outcome contract holds.
    const env = storageEnv();
    const user = createUser('keeprest@example.com', await hashPassword('pw'));
    const result = await startBuild(env, user, { prompt: 'rest build that fails' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.done;
    expect(getApp(result.app.id)).not.toBeNull();
  });

  it('does NOT delete an existing app when an EDIT build fails', async () => {
    const env = storageEnv();
    const user = createUser('keep@example.com', await hashPassword('pw'));
    const existing = createApp(user.id, 'keep me');
    touchApp(existing.id, { status: 'preview' }); // non-draft → edit mode, not createdFresh
    const result = await startBuild(env, user, {
      prompt: 'edit that will fail',
      appId: existing.id,
      operationMode: 'edit',
      reapHuskOnCreateFailure: true, // even opted-in, an EDIT never reaps
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.done;
    expect(getApp(existing.id)).not.toBeNull();
  });
});

describe('startBuild — a HUNG build times out to error (not a draft husk)', () => {
  // An agent that streams ONE event then hangs (keeps the SSE connection open
  // without ending). This puts the build pump MID-STREAM at `reader.read()` —
  // the real hung-build case (the agent streamed component events, then the LLM
  // call wedged). A mid-stream abort returns without a terminal status, so the
  // pump's settle decides the outcome (the path this fix changes). A tiny
  // EXEPAD_BUILD_TIMEOUT_MIN makes the watchdog fire fast.
  let hangingServer: http.Server;
  const prevAgent = process.env.EXEPAD_AGENT_URL;
  const prevTimeout = process.env.EXEPAD_BUILD_TIMEOUT_MIN;

  beforeAll(async () => {
    hangingServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // One parseable agent event, then hang — never res.end().
      res.write('data: {"type":"chat_message","text":"working…"}\n\n');
    });
    await new Promise<void>((resolve) => hangingServer.listen(0, '127.0.0.1', resolve));
    const addr = hangingServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    process.env.EXEPAD_AGENT_URL = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    (hangingServer as { closeAllConnections?: () => void }).closeAllConnections?.();
    await new Promise<void>((resolve) => hangingServer.close(() => resolve()));
    if (prevAgent === undefined) delete process.env.EXEPAD_AGENT_URL;
    else process.env.EXEPAD_AGENT_URL = prevAgent;
    if (prevTimeout === undefined) delete process.env.EXEPAD_BUILD_TIMEOUT_MIN;
    else process.env.EXEPAD_BUILD_TIMEOUT_MIN = prevTimeout;
  });

  it('Studio: a hung first build times out and is REAPED (no draft husk)', async () => {
    process.env.EXEPAD_BUILD_TIMEOUT_MIN = '0.01'; // ~600ms watchdog
    const env = storageEnv();
    const user = createUser('hang-studio@example.com', await hashPassword('pw'));
    const result = await startBuild(env, user, {
      prompt: 'a build that hangs forever',
      reapHuskOnCreateFailure: true, // interactive Studio /run
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const appId = result.app.id;
    await result.run.done; // watchdog → abort → settle('error') → reap
    expect(getApp(appId)).toBeNull();
  }, 15000);

  it('REST: a hung first build times out to error and stays pollable', async () => {
    process.env.EXEPAD_BUILD_TIMEOUT_MIN = '0.01';
    const env = storageEnv();
    const user = createUser('hang-rest@example.com', await hashPassword('pw'));
    const result = await startBuild(env, user, { prompt: 'rest hang' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.done;
    const app = getApp(result.app.id);
    expect(app).not.toBeNull();
    expect(app?.status).toBe('error'); // a timeout is a failure, not a draft
  }, 15000);

  it('a user CANCEL (not a timeout) settles to draft and is NOT reaped', async () => {
    process.env.EXEPAD_BUILD_TIMEOUT_MIN = '5'; // generous — watchdog must NOT fire
    const env = storageEnv();
    const user = createUser('hang-cancel@example.com', await hashPassword('pw'));
    const result = await startBuild(env, user, {
      prompt: 'a build the user cancels',
      reapHuskOnCreateFailure: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const appId = result.app.id;
    // Wait until the pump is MID-STREAM (the agent's first event buffered) so the
    // cancel lands at reader.read(), not the initial fetch. events[0] is the
    // seeded user_prompt; events[1] is the agent's chat_message.
    const deadline = Date.now() + 5000;
    while (result.run.events.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(result.run.events.length).toBeGreaterThanOrEqual(2);
    // Simulate a user cancel: abort WITHOUT the watchdog's `timedOut` flag.
    result.run.abort.abort();
    await result.run.done;
    const app = getApp(appId);
    expect(app).not.toBeNull(); // a cancel is not a failure → not reaped
    expect(app?.status).toBe('draft'); // left for the user to retry
  }, 15000);
});

describe('startBuild — a mid-stream agent SSE RESET settles to error (not a draft husk)', () => {
  // The agent streams ONE event then abruptly RESETS the connection (destroys the
  // socket without res.end()). This is the real-world failure from app aqzpw590t:
  // every component built fine, but the agent tore down its ADK session while an
  // orphaned component retry was still in flight ("Failed to append event … not
  // in sessions"), which reset the SSE mid-build. That makes the worker's
  // reader.read() THROW a transport error while signal is NOT aborted — distinct
  // from the watchdog/cancel cases. The watchdog must NOT fire here, so the only
  // thing that can settle the app is the transport-error path. Before the fix
  // that path silently swallowed the error → the pump saw a clean generator
  // return → settle('draft') → a silent husk with no deploy_status and no reap.
  let resetServer: http.Server;
  const prevAgent = process.env.EXEPAD_AGENT_URL;
  const prevTimeout = process.env.EXEPAD_BUILD_TIMEOUT_MIN;

  beforeAll(async () => {
    resetServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // One parseable agent event so the pump is mid-stream at reader.read(),
      // then forcibly reset the connection (RST) — never res.end().
      res.write('data: {"type":"chat_message","text":"working…"}\n\n');
      setTimeout(() => {
        try {
          res.socket?.destroy();
        } catch {
          /* already gone */
        }
      }, 50);
    });
    await new Promise<void>((resolve) => resetServer.listen(0, '127.0.0.1', resolve));
    const addr = resetServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    process.env.EXEPAD_AGENT_URL = `http://127.0.0.1:${port}`;
    process.env.EXEPAD_BUILD_TIMEOUT_MIN = '5'; // generous — the watchdog must NOT fire
  });

  afterAll(async () => {
    (resetServer as { closeAllConnections?: () => void }).closeAllConnections?.();
    await new Promise<void>((resolve) => resetServer.close(() => resolve()));
    if (prevAgent === undefined) delete process.env.EXEPAD_AGENT_URL;
    else process.env.EXEPAD_AGENT_URL = prevAgent;
    if (prevTimeout === undefined) delete process.env.EXEPAD_BUILD_TIMEOUT_MIN;
    else process.env.EXEPAD_BUILD_TIMEOUT_MIN = prevTimeout;
  });

  it('Studio: a reset mid-build flips to error and is REAPED (no draft husk)', async () => {
    const env = storageEnv();
    const user = createUser('reset-studio@example.com', await hashPassword('pw'));
    const result = await startBuild(env, user, {
      prompt: 'a build whose agent connection drops',
      reapHuskOnCreateFailure: true, // interactive Studio /run
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const appId = result.app.id;
    await result.run.done; // reader throws → catch surfaces error → reap in finally
    expect(getApp(appId)).toBeNull();
  }, 15000);

  it('REST: a reset mid-build settles to error and stays pollable (not draft)', async () => {
    const env = storageEnv();
    const user = createUser('reset-rest@example.com', await hashPassword('pw'));
    const result = await startBuild(env, user, { prompt: 'rest build whose agent drops' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.done;
    const app = getApp(result.app.id);
    expect(app).not.toBeNull();
    expect(app?.status).toBe('error'); // a transport drop is a failure, not a draft
  }, 15000);

  it('surfaces a deploy_status:failed event to the client (not a silent stop)', async () => {
    const env = storageEnv();
    const user = createUser('reset-event@example.com', await hashPassword('pw'));
    const result = await startBuild(env, user, { prompt: 'agent drops, client must be told' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.done;
    const failed = result.run.events.find(
      (e) => e.type === 'deploy_status' && (e as { status?: string }).status === 'failed',
    );
    expect(failed).toBeDefined();
  }, 15000);
});

describe('startBuild — the agent SSE stream has NO idle (body) timeout (undici bodyTimeout fix)', () => {
  // The worker streams the agent build via fetchAgentStream (routes/orchestrate.ts
  // runGenerator), whose dispatcher disables undici's DEFAULT 300s bodyTimeout. A
  // slow off-Gemini phase (DesignSystemBuilder) can stream NO SSE bytes for >5 min
  // without that meaning the build died. Before the fix the idle read threw
  // UND_ERR_BODY_TIMEOUT mid-build → settle('error') → the create-path husk-reaper
  // DELETED the freshly-created app (live: app anxcdt4k9, deprovisioned at ~300s).
  // The 25-min watchdog stays the ONLY time ceiling. These guard the end-to-end
  // wiring (a revert of the call site to global fetch is caught here).
  const prevAgent = process.env.EXEPAD_AGENT_URL;
  const prevBuildTimeout = process.env.EXEPAD_BUILD_TIMEOUT_MIN;
  const prevIdle = process.env.EXEPAD_AGENT_STREAM_BODY_TIMEOUT_MS;
  let server: http.Server | undefined;

  const restore = (key: string, val: string | undefined) => {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  };

  async function startSse(handler: (res: http.ServerResponse) => void): Promise<void> {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      handler(res);
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const addr = server!.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    process.env.EXEPAD_AGENT_URL = `http://127.0.0.1:${port}`;
  }

  afterEach(async () => {
    const s = server;
    server = undefined;
    if (s) {
      (s as { closeAllConnections?: () => void }).closeAllConnections?.();
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  afterAll(() => {
    restore('EXEPAD_AGENT_URL', prevAgent);
    restore('EXEPAD_BUILD_TIMEOUT_MIN', prevBuildTimeout);
    restore('EXEPAD_AGENT_STREAM_BODY_TIMEOUT_MS', prevIdle);
  });

  it('reads across a long QUIET gap without aborting (idle timeout disabled by default)', async () => {
    process.env.EXEPAD_BUILD_TIMEOUT_MIN = '5'; // watchdog must NOT fire
    delete process.env.EXEPAD_AGENT_STREAM_BODY_TIMEOUT_MS; // default = disabled
    await startSse((res) => {
      res.write('data: {"type":"chat_message","text":"before-the-gap"}\n\n');
      setTimeout(() => {
        try {
          res.write('data: {"type":"chat_message","text":"after-the-gap"}\n\n');
          res.end();
        } catch {
          /* socket already gone */
        }
      }, 1500); // a quiet gap a finite idle timeout would abort
    });
    const env = storageEnv();
    const user = createUser('idle-survive@example.com', await hashPassword('pw'));
    const result = await startBuild(env, user, { prompt: 'a build with a quiet phase' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.done;
    const texts = result.run.events
      .map((e) => (e as { text?: string }).text)
      .filter((t): t is string => Boolean(t));
    // BOTH agent events crossed the pump — the quiet gap did NOT abort the read.
    expect(texts).toContain('before-the-gap');
    expect(texts).toContain('after-the-gap');
  }, 15000);

  it('build stream honors EXEPAD_AGENT_STREAM_BODY_TIMEOUT_MS — proving it routes through the no-idle-timeout dispatcher', async () => {
    // Inject a short idle timeout only OUR dispatcher understands, then go quiet
    // forever. The build must settle 'error' from the idle timeout (watchdog is
    // 5 min and must NOT fire). A revert of the call site to the global fetch()
    // would ignore the env, hang the stream, and time this test out.
    process.env.EXEPAD_BUILD_TIMEOUT_MIN = '5';
    process.env.EXEPAD_AGENT_STREAM_BODY_TIMEOUT_MS = '500';
    await startSse((res) => {
      res.write('data: {"type":"chat_message","text":"working…"}\n\n'); // then hang forever
    });
    const env = storageEnv();
    const user = createUser('idle-wired@example.com', await hashPassword('pw'));
    const result = await startBuild(env, user, { prompt: 'a build that goes quiet' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.done; // idle timeout → reader throws → settle('error')
    expect(getApp(result.app.id)?.status).toBe('error');
  }, 15000);
});
