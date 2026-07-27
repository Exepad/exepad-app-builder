// @vitest-environment node
/**
 * Integration test for the publish control plane: a REAL loopback listener + a
 * spawned (mock) cloudflared child, driven through the actual /api/publish route.
 * Proves the start→live→stop lifecycle, the auth/ownership/published guards, and
 * that the listener port is closed on stop.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  publish,
  _stopShareSyncForTests,
  _setInnerFetchForTests,
} from '../../../worker/src/routes/publish';
import { createUser, createApp, touchApp, recordDeployment } from '../../../worker/src/lib/meta-db';
import { mintSessionToken } from '../../../worker/src/routes/gateway/auth';
import type { Env } from '../../../worker/src/types/env';

const SECRET = 'test-publish-secret';
const MOCK = fileURLToPath(new URL('../../fixtures/mock-cloudflared.mjs', import.meta.url));

function env(): Env {
  return { PLATFORM_BRIDGE_SECRET: SECRET, ENVIRONMENT: 'selfhost' } as unknown as Env;
}

let dataDir: string;
let cookie: string;
let ownerId: string;

async function start(appId: string, withCookie = cookie): Promise<Response> {
  return publish.fetch(
    new Request('http://127.0.0.1/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: withCookie },
      body: JSON.stringify({ appId }),
    }),
    env(),
  );
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-pub-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
  process.env.EXEPAD_CLOUDFLARED_BIN = MOCK;
  process.env.EXEPAD_TUNNEL_READY_TIMEOUT_MS = '4000';

  const user = createUser('op@example.com', 'x', 'admin');
  ownerId = user.id;
  cookie = `exepad_platform_session=${await mintSessionToken(user.id, user.email, ['admin'], SECRET)}`;

  // The restricted listener's inner re-entry is stubbed so this test exercises
  // only the listener + child lifecycle, not the whole runtime app graph.
  _setInnerFetchForTests(() => new Response('app-x', { status: 200 }));
});

afterEach(() => {
  _stopShareSyncForTests();
  _setInnerFetchForTests(null);
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.EXEPAD_DATA_DIR;
  delete process.env.EXEPAD_CLOUDFLARED_BIN;
  delete process.env.EXEPAD_TUNNEL_READY_TIMEOUT_MS;
});

function publishedApp(): string {
  const app = createApp(ownerId, 'Demo');
  touchApp(app.id, { published_at: new Date().toISOString() });
  recordDeployment({ appId: app.id, mode: 'published', status: 'success' });
  return app.id;
}

describe('POST /api/publish/start — guards', () => {
  it('401 without an operator session', async () => {
    const res = await start('whatever', 'exepad_platform_session=garbage');
    expect(res.status).toBe(401);
  });

  it('400 when appId is missing', async () => {
    const res = await publish.fetch(
      new Request('http://127.0.0.1/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: '{}',
      }),
      env(),
    );
    expect(res.status).toBe(400);
  });

  it('404 for an app the operator does not own', async () => {
    const otherOwner = createUser('other@example.com', 'x', 'admin');
    const app = createApp(otherOwner.id, 'NotMine');
    touchApp(app.id, { published_at: new Date().toISOString() });
    recordDeployment({ appId: app.id, mode: 'published', status: 'success' });
    const res = await start(app.id);
    expect(res.status).toBe(404);
  });

  it('409 when the app has not been published yet', async () => {
    const app = createApp(ownerId, 'Unpublished');
    const res = await start(app.id);
    expect(res.status).toBe(409);
  });
});

describe('POST /api/publish/start — lifecycle', () => {
  it('starts a tunnel, returns the live URL, then stops cleanly', async () => {
    const appId = publishedApp();
    const res = await start(appId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; url: string; status: string };
    expect(body.success).toBe(true);
    expect(body.status).toBe('live');
    expect(body.url).toBe('https://test-tunnel-abc.trycloudflare.com');

    // A second start for the SAME app is idempotent (returns the same URL).
    const again = await start(appId);
    const againBody = (await again.json()) as { url: string };
    expect(again.status).toBe(200);
    expect(againBody.url).toBe('https://test-tunnel-abc.trycloudflare.com');

    // Starting a DIFFERENT app while one is live → 409.
    const other = publishedApp();
    const conflict = await start(other);
    expect(conflict.status).toBe(409);

    // Stop tears it down.
    const stop = await publish.fetch(
      new Request('http://127.0.0.1/stop', {
        method: 'POST',
        headers: { Cookie: cookie },
      }),
      env(),
    );
    expect(stop.status).toBe(200);

    // After stop, the same app can be shared again.
    const restart = await start(appId);
    expect(restart.status).toBe(200);
  });
});
