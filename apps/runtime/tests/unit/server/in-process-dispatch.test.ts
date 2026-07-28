// @vitest-environment node
/**
 * Keystone integration test for WS2+5: the runtime gateway dispatches RPC to the
 * app-backend IN-PROCESS (no WfP, no HTTP hop), backed by real local adapters.
 *
 * Proves the full seam end-to-end:
 *   dispatchRpcInProcess → buildUserEnv (LocalD1 + FsStorageAdapter) →
 *   @exepad/app-backend fetch → loadConfig from FS storage → CRUD on real SQLite.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStorageAdapter, getAppD1 } from '@exepad/local-adapters';
import { generateCreateTableSQL, generateIndexSQL } from '@exepad/deploy-utils';
import { dispatchRpcInProcess } from '../../../worker/src/routes/gateway/dispatch-local';
import type { Env } from '../../../worker/src/types/env';

const APP_ID = 'kw7x9q2a';
const MODE = 'published' as const;
const SERVICE_TOKEN = 'test-service-token';

const MODEL = {
  uuid: 'm-contacts',
  name: 'contacts',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'name', type: 'text' },
    { name: 'email', type: 'text', isUnique: true },
  ],
};

let dataDir: string;

/** Minimal runtime Env — dispatch-local only reads these two fields. */
function runtimeEnv(): Env {
  return { USER_WORKER_SERVICE_TOKEN: SERVICE_TOKEN, ENVIRONMENT: 'development' } as unknown as Env;
}

/** Headers as the gateway would stamp them (service token + platform identity). */
function gatewayHeaders(userId: string): Headers {
  return new Headers({
    'Content-Type': 'application/json',
    'X-Service-Token': SERVICE_TOKEN,
    'X-User-Id': userId,
    'X-User-Email': `${userId}@example.com`,
    'X-User-Roles': 'admin,user',
  });
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-rt-'));
  process.env.EXEPAD_DATA_DIR = dataDir;

  // 1. Seed CONFIG_CACHE (FsStorage at <dataDir>/storage) with the deploy-status
  //    pointer + the app config the app-backend's loadConfig will read.
  const storage = new FsStorageAdapter();
  const appConfig = { backend: { mode: 'dynamic', models: [MODEL] } };
  // FsStorageAdapter.put is async but resolves synchronously enough for setup;
  // we await in the test bodies via the helper below.
  return Promise.all([
    storage.put(
      `${APP_ID}/deployment-status-${MODE}.json`,
      JSON.stringify({ configPath: 'published/app-config.json' }),
    ),
    storage.put(`${APP_ID}/published/app-config.json`, JSON.stringify(appConfig)),
  ]).then(() => {
    // 2. Create the app's SQLite table (what the deploy pipeline does).
    const db = getAppD1(APP_ID, MODE).raw;
    db.exec(generateCreateTableSQL(MODEL as never));
    for (const idx of generateIndexSQL(MODEL as never)) db.exec(idx);
  });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.EXEPAD_DATA_DIR;
});

async function rpc(body: Record<string, unknown>, userId = 'u1') {
  const res = await dispatchRpcInProcess(gatewayHeaders(userId), body, APP_ID, MODE, runtimeEnv());
  return { status: res.status, json: (await res.json()) as { success: boolean; data?: unknown; error?: unknown } };
}

describe('in-process gateway → app-backend dispatch', () => {
  it('sys_create reaches the app-backend and writes to real SQLite', async () => {
    const { status, json } = await rpc({
      method: 'sys_create',
      model: 'contacts',
      params: { data: { name: 'Ada', email: 'ada@example.com' } },
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    const row = json.data as Record<string, unknown>;
    expect(row.name).toBe('Ada');
    expect(row.owner_id).toBe('u1');
  });

  it('sys_list returns the owner-scoped row created in-process', async () => {
    await rpc({ method: 'sys_create', model: 'contacts', params: { data: { name: 'A', email: 'a@x.com' } } });
    await rpc({ method: 'sys_create', model: 'contacts', params: { data: { name: 'B', email: 'b@x.com' } } });

    const { status, json } = await rpc({ method: 'sys_list', model: 'contacts', params: {} });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    const records = json.data as Record<string, unknown>[];
    expect(records.map((r) => r.name).sort()).toEqual(['A', 'B']);
  });

  it('rejects a request whose service token does not match', async () => {
    const badHeaders = gatewayHeaders('u1');
    badHeaders.set('X-Service-Token', 'wrong');
    const res = await dispatchRpcInProcess(
      badHeaders,
      { method: 'sys_list', model: 'contacts', params: {} },
      APP_ID,
      MODE,
      runtimeEnv(),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('isolates data between two apps in the same process', async () => {
    // Second app with its own config + DB.
    const APP2 = 'zz1y8w3b';
    const storage = new FsStorageAdapter();
    await storage.put(`${APP2}/deployment-status-${MODE}.json`, JSON.stringify({ configPath: 'published/app-config.json' }));
    await storage.put(`${APP2}/published/app-config.json`, JSON.stringify({ backend: { mode: 'dynamic', models: [MODEL] } }));
    getAppD1(APP2, MODE).raw.exec(generateCreateTableSQL(MODEL as never));

    await rpc({ method: 'sys_create', model: 'contacts', params: { data: { name: 'OnlyApp1', email: 'o@x.com' } } });

    const res = await dispatchRpcInProcess(
      gatewayHeaders('u1'),
      { method: 'sys_list', model: 'contacts', params: {} },
      APP2,
      MODE,
      runtimeEnv(),
    );
    const json = (await res.json()) as { success: boolean; data: Record<string, unknown>[] };
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(0); // app2's DB is empty — no leak from app1
  });
});
