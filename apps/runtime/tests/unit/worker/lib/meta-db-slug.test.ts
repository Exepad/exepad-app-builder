// @vitest-environment node
/**
 * meta-db.ts — friendly-slug ↔ app-id resolution, against a REAL temp
 * meta.sqlite.
 *
 * Published apps are shared at `/a/<slug>/` but everything durable is keyed on
 * the immutable `app.id`. `resolveAppIdForSegment` is the slug-then-id resolver
 * the request edge uses; `isReservedSlug` + the setAppSlug/ensureUniqueSlug
 * guards keep a slug from shadowing the `/a/preview-<id>/` draft route.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getMetaDb,
  createUser,
  createApp,
  setAppSlug,
  resolveAppIdForSegment,
  isReservedSlug,
} from '../../../../worker/src/lib/meta-db';
import { hashPassword } from '../../../../worker/src/lib/password';

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-meta-slug-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
  process.env.EXEPAD_META_DB = join(dataDir, 'meta.sqlite');
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

let seq = 0;
async function makeUser() {
  return createUser(
    `slug-${seq++}-${Math.random().toString(36).slice(2)}@x.com`,
    await hashPassword('pw-secret-123'),
  );
}

describe('resolveAppIdForSegment', () => {
  it('resolves a friendly slug to the canonical app id', async () => {
    const user = await makeUser();
    const app = createApp(user.id, 'Tide List');
    // createApp derives a name-based slug distinct from the random id.
    expect(app.slug).not.toBe(app.id);
    expect(app.slug).toBe('tide-list');

    expect(resolveAppIdForSegment(app.slug)).toBe(app.id);
  });

  it('passes a raw app id through unchanged', async () => {
    const user = await makeUser();
    const app = createApp(user.id, 'Reef Tracker');
    expect(resolveAppIdForSegment(app.id)).toBe(app.id);
  });

  it('returns an unknown segment unchanged (preserves 404 behavior)', () => {
    expect(resolveAppIdForSegment('does-not-exist')).toBe('does-not-exist');
  });

  it('follows a renamed slug to the same id', async () => {
    const user = await makeUser();
    const app = createApp(user.id, 'Old Name');
    const renamed = setAppSlug(app.id, 'brand-new-alias');
    expect(renamed.ok).toBe(true);
    expect(resolveAppIdForSegment('brand-new-alias')).toBe(app.id);
  });
});

describe('reserved preview- prefix', () => {
  it('flags preview- slugs as reserved', () => {
    expect(isReservedSlug('preview-foo')).toBe(true);
    expect(isReservedSlug('tidelist')).toBe(false);
  });

  it('setAppSlug rejects a preview- alias', async () => {
    const user = await makeUser();
    const app = createApp(user.id, 'Some App');
    const res = setAppSlug(app.id, 'preview-sneaky');
    expect(res.ok).toBe(false);
  });

  it('createApp never mints a preview- slug from a preview- name', async () => {
    const user = await makeUser();
    const app = createApp(user.id, 'Preview Mode');
    expect(isReservedSlug(app.slug)).toBe(false);
  });
});
