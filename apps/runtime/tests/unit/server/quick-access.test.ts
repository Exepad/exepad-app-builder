// @vitest-environment node
/**
 * Integration test for the Quick Access control plane: a spawned (mock) cloudflared
 * child driven through the actual /api/quick-access route. Proves the start→live→
 * stop lifecycle, the auth guard, idempotent start, and a clean restart after stop.
 * Unlike publish, Quick Access has no per-app listener/guards — it points cloudflared
 * straight at the studio's loopback HTTP port, so this exercises the tunnel lifecycle.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quickAccess, _stopQuickAccessSyncForTests } from '../../../worker/src/routes/quick-access';
import { createUser } from '../../../worker/src/lib/meta-db';
import { mintSessionToken } from '../../../worker/src/routes/gateway/auth';
import type { Env } from '../../../worker/src/types/env';

const SECRET = 'test-quick-access-secret';
const MOCK = fileURLToPath(new URL('../../fixtures/mock-cloudflared.mjs', import.meta.url));

function env(): Env {
  return { PLATFORM_BRIDGE_SECRET: SECRET, ENVIRONMENT: 'selfhost' } as unknown as Env;
}

let dataDir: string;
let cookie: string;

function req(path: string, method: 'POST' | 'GET', withCookie = cookie): Promise<Response> {
  return quickAccess.fetch(
    new Request(`http://127.0.0.1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: withCookie },
    }),
    env(),
  );
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-qa-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
  process.env.EXEPAD_META_DB = join(dataDir, 'meta.sqlite');
  process.env.EXEPAD_CLOUDFLARED_BIN = MOCK;
  process.env.EXEPAD_TUNNEL_READY_TIMEOUT_MS = '4000';
  process.env.EXEPAD_HTTP_ACTIVE_PORT = '8090';
  delete process.env.MOCK_CF_FAIL;

  const user = createUser('op@example.com', 'x', 'admin');
  cookie = `exepad_platform_session=${await mintSessionToken(user.id, user.email, ['admin'], SECRET)}`;
});

afterEach(() => {
  _stopQuickAccessSyncForTests();
  rmSync(dataDir, { recursive: true, force: true });
  for (const k of [
    'EXEPAD_DATA_DIR',
    'EXEPAD_META_DB',
    'EXEPAD_CLOUDFLARED_BIN',
    'EXEPAD_TUNNEL_READY_TIMEOUT_MS',
    'EXEPAD_HTTP_ACTIVE_PORT',
    'MOCK_CF_FAIL',
  ]) {
    delete process.env[k];
  }
});

describe('POST /api/quick-access/start', () => {
  it('401 without an operator session', async () => {
    const res = await req('/start', 'POST', 'exepad_platform_session=garbage');
    expect(res.status).toBe(401);
  });

  it('starts the studio tunnel, returns the live URL, then stops cleanly', async () => {
    const res = await req('/start', 'POST');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; url: string; status: string };
    expect(body.success).toBe(true);
    expect(body.status).toBe('live');
    expect(body.url).toBe('https://test-tunnel-abc.trycloudflare.com');

    // A second start while live is idempotent — same URL, one tunnel.
    const again = await req('/start', 'POST');
    expect(again.status).toBe(200);
    expect(((await again.json()) as { url: string }).url).toBe('https://test-tunnel-abc.trycloudflare.com');

    // Stop tears it down.
    const stop = await req('/stop', 'POST');
    expect(stop.status).toBe(200);

    // After stop, it can be started again.
    const restart = await req('/start', 'POST');
    expect(restart.status).toBe(200);
  });

  it('502 when cloudflared fails to establish the tunnel, and leaves no dangling tunnel', async () => {
    process.env.MOCK_CF_FAIL = '1';
    const res = await req('/start', 'POST');
    expect(res.status).toBe(502);
    expect(((await res.json()) as { success: boolean }).success).toBe(false);

    // The failed start's scoped teardown must clear `active` — a subsequent start
    // succeeds cleanly (a dangling errored singleton would be cleared, not reused).
    delete process.env.MOCK_CF_FAIL;
    const ok = await req('/start', 'POST');
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { url: string }).url).toBe('https://test-tunnel-abc.trycloudflare.com');
  });
});

describe('GET /api/quick-access/status', () => {
  it('401 without an operator session', async () => {
    const res = await req('/status', 'GET', 'exepad_platform_session=garbage');
    expect(res.status).toBe(401);
  });

  it('streams an SSE snapshot (idle before any tunnel)', async () => {
    const res = await req('/status', 'GET');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('data:');
    expect(text).toContain('"status":"idle"');
    await reader.cancel();
  });
});
