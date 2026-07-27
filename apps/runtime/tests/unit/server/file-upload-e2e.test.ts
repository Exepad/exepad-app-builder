// @vitest-environment node
/**
 * End-to-end integration test for the file-upload path — the gap the
 * direct-handler unit tests (which call the sysFile / handleFile handlers with
 * a MOCK D1) never cover. Exercises the real seam:
 *
 *   dispatchFiles → buildDispatchHeaders → fetchAppBackendInProcess →
 *   buildUserEnv (LocalD1 + FsStorageAdapter over a temp dir) →
 *   @exepad/app-backend /files/* → handleFileUpload / handleFileServe →
 *   FsStorageAdapter bytes on disk + a real `_files` row in real SQLite.
 *
 * Also guards the Content-Length forwarding fix in dispatchFiles: without it
 * the app-backend's early-413 size precheck can't fire (an oversized upload
 * falls through to the post-buffer file.size check → 400, not 413).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStorageAdapter, getAppD1 } from '@exepad/local-adapters';
import { generateFilesDDL } from '@exepad/deploy-utils';
import { dispatchFiles } from '../../../worker/src/routes/gateway/services';
import { type GatewayIdentity } from '../../../worker/src/routes/gateway/auth';
import type { Env } from '../../../worker/src/types/env';
import type { AppConfig } from '@exepad/types';

const APP_ID = 'fu7x2m9q';
const MODE = 'published' as const;
const SERVICE_TOKEN = 'test-service-token';
const USER = 'u1';

let dataDir: string;

function runtimeEnv(): Env {
  return { USER_WORKER_SERVICE_TOKEN: SERVICE_TOKEN, ENVIRONMENT: 'development' } as unknown as Env;
}

/** A published-mode authenticated identity (no preview-owner rewrite). */
function identity(userId = USER): GatewayIdentity {
  return {
    headers: new Headers({
      'X-User-Id': userId,
      'X-User-Email': `${userId}@example.com`,
      'X-User-Roles': 'user',
    }),
    isAuthenticated: true,
    kind: 'session',
    stateKey: null,
    userRoles: ['user'],
    userId,
    userEmail: `${userId}@example.com`,
  };
}

/** Write the app config the app-backend re-loads from CONFIG_CACHE. */
async function seedConfig(storage: Record<string, unknown> | undefined): Promise<AppConfig> {
  const fs = new FsStorageAdapter();
  const appConfig = { backend: { mode: 'dynamic', ...(storage ? { storage } : {}) } };
  await fs.put(
    `${APP_ID}/deployment-status-${MODE}.json`,
    JSON.stringify({ configPath: 'published/app-config.json' }),
  );
  await fs.put(`${APP_ID}/published/app-config.json`, JSON.stringify(appConfig));
  return appConfig as unknown as AppConfig;
}

function createFilesTable() {
  const db = getAppD1(APP_ID, MODE).raw;
  for (const stmt of generateFilesDDL()) db.exec(stmt);
}

async function upload(
  config: AppConfig,
  bytes: Uint8Array,
  filename: string,
  type: string,
): Promise<{ status: number; json: any; headers: Headers }> {
  const fd = new FormData();
  fd.append('file', new File([bytes], filename, { type }));
  const req = new Request('http://gateway/api/app/_files/upload', { method: 'POST', body: fd });
  const res = await dispatchFiles(req, APP_ID, 'upload', runtimeEnv(), MODE, config, identity());
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

async function serve(
  config: AppConfig,
  fileId: string,
  filename: string,
): Promise<{ status: number; res: Response }> {
  const req = new Request(`http://gateway/api/app/_files/${fileId}/${filename}`, { method: 'GET' });
  const res = await dispatchFiles(req, APP_ID, `${fileId}/${filename}`, runtimeEnv(), MODE, config, identity());
  return { status: res.status, res };
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-fu-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.EXEPAD_DATA_DIR;
});

describe('file-upload E2E (dispatchFiles → app-backend → FsStorage → _files)', () => {
  it('round-trips bytes: multipart upload → _files row → serve returns the same bytes', async () => {
    const config = await seedConfig({ enabled: true });
    createFilesTable();
    const bytes = new TextEncoder().encode('hello exepad file storage');

    const up = await upload(config, bytes, 'note.txt', 'text/plain');
    expect(up.status).toBe(201);
    expect(up.json.success).toBe(true);
    const { id, filename, size, contentType } = up.json.data;
    expect(size).toBe(bytes.byteLength);
    expect(contentType).toBe('text/plain');
    expect(filename).toBe('note.txt');

    // _files row written to real SQLite.
    const row = getAppD1(APP_ID, MODE).raw
      .prepare('SELECT * FROM _files WHERE id = ?')
      .get(id) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.owner_id).toBe(USER);
    expect(row.r2_key).toBe(`${USER}/${id}/note.txt`);
    expect(row.content_type).toBe('text/plain');
    expect(Number(row.size_bytes)).toBe(bytes.byteLength);
    expect(row.deleted_at).toBeNull();

    // Bytes actually landed on disk in the app's bucket.
    const onDisk = join(dataDir, 'buckets', `exepad-files-${APP_ID}`, USER, id, 'note.txt');
    expect(existsSync(onDisk)).toBe(true);
    expect(readFileSync(onDisk)).toEqual(Buffer.from(bytes));

    // Serve streams the same bytes back, with the nosniff hardening header.
    const served = await serve(config, id, 'note.txt');
    expect(served.status).toBe(200);
    expect(served.res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const back = new Uint8Array(await served.res.arrayBuffer());
    expect(back).toEqual(bytes);
  });

  it('serves the Content-Type from stored metadata, not the URL', async () => {
    const config = await seedConfig({ enabled: true });
    createFilesTable();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    const up = await upload(config, png, 'pixel.png', 'image/png');
    expect(up.status).toBe(201);
    const served = await serve(config, up.json.data.id, 'pixel.png');
    expect(served.status).toBe(200);
    expect(served.res.headers.get('Content-Type')).toContain('image/png');
  });

  it('rejects an oversized upload with 413 (post-buffer file.size check)', async () => {
    // NOTE: a FormData-bodied Request carries NO Content-Length in this Node
    // runtime, so this exercises the app-backend's post-buffer `file.size`
    // check (upload.ts) — NOT the early Content-Length precheck. The
    // Content-Length forwarding fix is guarded separately, over-the-wire, in
    // dispatch-files-content-length.test.ts (a browser DOES send Content-Length).
    const config = await seedConfig({ enabled: true, maxFileSize: 16 });
    createFilesTable();
    const big = new TextEncoder().encode('this body is definitely larger than sixteen bytes');
    const up = await upload(config, big, 'big.txt', 'text/plain');
    expect(up.status).toBe(413);
    expect(String(up.json.error?.message || up.json)).toMatch(/too large/i);
  });

  it('returns 405 STORAGE_DISABLED when storage is not enabled', async () => {
    const config = await seedConfig(undefined); // no storage block at all
    // (no _files table; must be rejected before any DB access)
    const up = await upload(config, new TextEncoder().encode('x'), 'x.txt', 'text/plain');
    expect(up.status).toBe(405);
    expect(up.json.error?.code).toBe('STORAGE_DISABLED');
  });

  it('serving a non-existent file id returns 404', async () => {
    const config = await seedConfig({ enabled: true });
    createFilesTable();
    const served = await serve(config, 'does-not-exist', 'ghost.txt');
    expect(served.status).toBe(404);
  });
});
