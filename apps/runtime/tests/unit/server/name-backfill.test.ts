// @vitest-environment node
/**
 * The app-name backfill + its meta-db writers, against a REAL temp meta.sqlite
 * and a REAL FsStorageAdapter — the boot-time reconciliation that copies the
 * agent's real config name into apps.name for apps built before the build pump
 * started syncing it.
 *
 * What's load-bearing here and not a pure function:
 *   - resolveConfigKey indirection: loadAppConfig('preview') resolves the config
 *     key via {appId}/deployment-status-preview.json, so the backfill only works
 *     if that real storage shape is read correctly.
 *   - listBuiltApps must select exactly the deployed (preview/published) apps.
 *   - setAppName must NOT bump updated_at (so existing cards don't all read
 *     "Updated just now" / re-trigger thumbnails), whereas touchApp({name}) — the
 *     build-pump path — does.
 *
 * Harness mirrors meta-db.test.ts (temp EXEPAD_META_DB) + materialize-build.test.ts
 * (real FsStorageAdapter for CONFIG_CACHE).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStorageAdapter } from '@exepad/local-adapters';

import { backfillAppNames } from '../../../worker/src/server/maintenance';
import {
  getMetaDb,
  createUser,
  createApp,
  touchApp,
  getApp,
  setAppName,
  listBuiltApps,
} from '../../../worker/src/lib/meta-db';
import { hashPassword } from '../../../worker/src/lib/password';
import type { Env } from '../../../worker/src/types/env';

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-name-backfill-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
  process.env.EXEPAD_META_DB = join(dataDir, 'meta.sqlite');
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Each test starts from a clean apps table (shared process-wide meta db).
  getMetaDb().prepare('DELETE FROM apps').run();
});

function storageEnv(): Env {
  return { CONFIG_CACHE: new FsStorageAdapter() as unknown as R2Bucket } as unknown as Env;
}

let userSeq = 0;
async function makeUser() {
  return createUser(`nb-${userSeq++}@x.com`, await hashPassword('pw-secret-123'));
}

/** Write a deployed preview config to storage exactly as a real deploy would:
 *  a deployment-status pointer + the config at preview/app-config.json. */
async function writePreviewConfig(env: Env, appId: string, config: unknown): Promise<void> {
  await env.CONFIG_CACHE.put(
    `${appId}/deployment-status-preview.json`,
    JSON.stringify({ status: 'success', configPath: 'preview/app-config.json' }),
  );
  await env.CONFIG_CACHE.put(`${appId}/preview/app-config.json`, JSON.stringify(config));
}

function setUpdatedAt(appId: string, iso: string): void {
  getMetaDb().prepare('UPDATE apps SET updated_at = ? WHERE id = ?').run(iso, appId);
}

describe('listBuiltApps', () => {
  it('returns only preview/published apps (not draft/building/error)', async () => {
    const u = await makeUser();
    const preview = createApp(u.id, 'p');
    touchApp(preview.id, { status: 'preview' });
    const published = createApp(u.id, 'q');
    touchApp(published.id, { status: 'published' });
    const draft = createApp(u.id, 'd'); // stays draft
    const errored = createApp(u.id, 'e');
    touchApp(errored.id, { status: 'error' });

    const ids = listBuiltApps().map((a) => a.id).sort();
    expect(ids).toEqual([preview.id, published.id].sort());
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(errored.id);
  });
});

describe('setAppName', () => {
  it('updates the name WITHOUT bumping updated_at', async () => {
    const u = await makeUser();
    const app = createApp(u.id, 'Old Name');
    setUpdatedAt(app.id, '2020-01-01T00:00:00.000Z');

    setAppName(app.id, 'Lumina');

    const after = getApp(app.id)!;
    expect(after.name).toBe('Lumina');
    expect(after.updated_at).toBe('2020-01-01T00:00:00.000Z'); // preserved
  });

  it('contrasts with touchApp({name}), which DOES bump updated_at', async () => {
    const u = await makeUser();
    const app = createApp(u.id, 'Old Name');
    setUpdatedAt(app.id, '2020-01-01T00:00:00.000Z');

    touchApp(app.id, { name: 'Momentum' });

    const after = getApp(app.id)!;
    expect(after.name).toBe('Momentum');
    expect(after.updated_at).not.toBe('2020-01-01T00:00:00.000Z'); // bumped
  });
});

describe('backfillAppNames', () => {
  it('syncs apps.name from the deployed config name', async () => {
    const env = storageEnv();
    const u = await makeUser();
    const app = createApp(u.id, 'Build a single-page marketing site'); // prompt-derived placeholder
    touchApp(app.id, { status: 'preview' });
    await writePreviewConfig(env, app.id, { name: 'Lumina' });

    await backfillAppNames(env);

    expect(getApp(app.id)!.name).toBe('Lumina');
  });

  it('preserves updated_at while backfilling', async () => {
    const env = storageEnv();
    const u = await makeUser();
    const app = createApp(u.id, 'Build a habit tracker');
    touchApp(app.id, { status: 'preview' });
    setUpdatedAt(app.id, '2021-05-05T00:00:00.000Z');
    await writePreviewConfig(env, app.id, { name: 'Momentum' });

    await backfillAppNames(env);

    const after = getApp(app.id)!;
    expect(after.name).toBe('Momentum');
    expect(after.updated_at).toBe('2021-05-05T00:00:00.000Z');
  });

  it('does NOT overwrite when the config name is generic', async () => {
    const env = storageEnv();
    const u = await makeUser();
    const app = createApp(u.id, 'expense tracker');
    touchApp(app.id, { status: 'preview' });
    await writePreviewConfig(env, app.id, { name: 'New App' });

    await backfillAppNames(env);

    expect(getApp(app.id)!.name).toBe('expense tracker'); // unchanged
  });

  it('uses the frontend title surfaces when the top-level name is generic', async () => {
    const env = storageEnv();
    const u = await makeUser();
    const app = createApp(u.id, 'placeholder');
    touchApp(app.id, { status: 'preview' });
    await writePreviewConfig(env, app.id, {
      name: 'Untitled',
      frontend: { appName: 'Aurora' },
    });

    await backfillAppNames(env);

    expect(getApp(app.id)!.name).toBe('Aurora');
  });

  it('skips draft apps and apps with no deployed config', async () => {
    const env = storageEnv();
    const u = await makeUser();
    const draft = createApp(u.id, 'draft placeholder'); // never deployed
    const built = createApp(u.id, 'built placeholder');
    touchApp(built.id, { status: 'preview' }); // built but no config written

    await backfillAppNames(env); // must not throw on the missing config

    expect(getApp(draft.id)!.name).toBe('draft placeholder');
    expect(getApp(built.id)!.name).toBe('built placeholder');
  });
});
