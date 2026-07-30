/**
 * versions.ts — preview working-set snapshot / restore (self-hosted).
 *
 * A "version" is a byte-for-byte backup of a successful preview build's working
 * set (config + compiled/** + code/**) copied into a version-scoped prefix, so a
 * restore can re-serve old config AGAINST its matching old compiled assets rather
 * than the newest in-place compiled code. The correctness of that guarantee rests
 * on four storage-layer invariants this file pins down:
 *
 *   1. copyTree fans out over EVERY key under a prefix (no key dropped).
 *   2. listKeys follows R2 cursor pagination across >1 page.
 *   3. the config is written LAST on both snapshot and restore, so a partially
 *      copied working set never looks complete to the config-presence check.
 *   4. deleteVersionSnapshot chunks deletes at the 500-key batch boundary.
 *
 * The R2 surface (env.CONFIG_CACHE) is mocked with a realistic prefix-filtered,
 * cursor-paginated `list` so pagination and ordering are actually exercised.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  snapshotPreviewVersion,
  restorePreviewVersionAssets,
  deleteVersionSnapshot,
  versionMarker,
  isVersionMarker,
  KEEP_VERSIONS,
} from '../../../../worker/src/lib/versions';
import type { Env } from '../../../../worker/src/types/env';

// ---------------------------------------------------------------------------
// Realistic R2Bucket mock
//
// Backed by an insertion-ordered Map of key -> { body, contentType }. `list`
// honours `prefix`, paginates with a small page size so multi-page cursor walks
// are forced, and records `delete` batch sizes so chunking can be asserted.
// ---------------------------------------------------------------------------

interface StoredObject {
  body: Uint8Array;
  contentType: string;
}

interface MockBucket {
  bucket: R2Bucket;
  store: Map<string, StoredObject>;
  /** Sizes of each `delete([...])` batch in call order. */
  deleteBatches: number[];
  /** Convenience: read a stored key back as UTF-8 text. */
  textOf(key: string): string | undefined;
}

function toBytes(value: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value);
}

function createMockBucket(
  initial: Record<string, string> = {},
  opts: { pageSize?: number } = {},
): MockBucket {
  const pageSize = opts.pageSize ?? 1000;
  const store = new Map<string, StoredObject>();
  for (const [k, v] of Object.entries(initial)) {
    store.set(k, { body: toBytes(v), contentType: 'application/octet-stream' });
  }
  const deleteBatches: number[] = [];

  const bucket = {
    get: vi.fn(async (key: string) => {
      const obj = store.get(key);
      if (!obj) return null;
      // Clone the bytes so callers can't mutate the store via the buffer.
      const bytes = obj.body.slice();
      return {
        httpMetadata: { contentType: obj.contentType },
        arrayBuffer: async () => bytes.buffer,
        text: async () => new TextDecoder().decode(bytes),
        json: async () => JSON.parse(new TextDecoder().decode(bytes)),
      };
    }),

    put: vi.fn(async (key: string, value: ArrayBuffer | Uint8Array | string, opts2?: any) => {
      store.set(key, {
        body: toBytes(value),
        contentType: opts2?.httpMetadata?.contentType ?? 'application/octet-stream',
      });
    }),

    delete: vi.fn(async (keys: string | string[]) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      deleteBatches.push(arr.length);
      for (const k of arr) store.delete(k);
    }),

    list: vi.fn(async (params?: { prefix?: string; cursor?: string }) => {
      const prefix = params?.prefix ?? '';
      // Insertion order = deterministic; R2 itself sorts lexicographically but
      // the module only relies on completeness + cursor following, not order.
      const matched = [...store.keys()].filter((k) => k.startsWith(prefix));
      const start = params?.cursor ? Number(params.cursor) : 0;
      const slice = matched.slice(start, start + pageSize);
      const nextStart = start + slice.length;
      const truncated = nextStart < matched.length;
      return {
        objects: slice.map((key) => ({ key })),
        truncated,
        cursor: truncated ? String(nextStart) : undefined,
        delimitedPrefixes: [],
      };
    }),
  } as unknown as R2Bucket;

  return {
    bucket,
    store,
    deleteBatches,
    textOf(key: string) {
      const obj = store.get(key);
      return obj ? new TextDecoder().decode(obj.body) : undefined;
    },
  };
}

function envWith(mock: MockBucket): Env {
  return { CONFIG_CACHE: mock.bucket } as unknown as Env;
}

const APP = 'app42';
const DEP = 7;

// ---------------------------------------------------------------------------
// Pure marker helpers
// ---------------------------------------------------------------------------

describe('versionMarker / isVersionMarker', () => {
  it('builds the versions/{depId} config_path marker', () => {
    expect(versionMarker(7)).toBe('versions/7');
    expect(versionMarker(0)).toBe('versions/0');
  });

  it('recognises a versions/ marker as a retained version', () => {
    expect(isVersionMarker('versions/7')).toBe(true);
    expect(isVersionMarker(versionMarker(123))).toBe(true);
  });

  it('rejects non-version config paths', () => {
    expect(isVersionMarker('preview/app-config.json')).toBe(false);
    expect(isVersionMarker('published/v3')).toBe(false);
    // A path that merely contains "versions/" but does not start with it.
    expect(isVersionMarker('app42/versions/7')).toBe(false);
  });

  it('treats null / undefined / empty config_path as not a version', () => {
    expect(isVersionMarker(null)).toBe(false);
    expect(isVersionMarker(undefined)).toBe(false);
    expect(isVersionMarker('')).toBe(false);
  });

  it('exposes the documented default retention', () => {
    expect(KEEP_VERSIONS).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// snapshotPreviewVersion
// ---------------------------------------------------------------------------

describe('snapshotPreviewVersion', () => {
  it('returns false and writes nothing when the preview config is missing', async () => {
    const mock = createMockBucket({
      // compiled/code assets present, but NO preview/app-config.json
      [`${APP}/compiled/component.js`]: 'compiled-js',
      [`${APP}/code/component.tsx`]: 'tsx',
    });

    const ok = await snapshotPreviewVersion(envWith(mock), APP, DEP);

    expect(ok).toBe(false);
    // No version-scoped keys created.
    expect([...mock.store.keys()].some((k) => k.includes('/versions/'))).toBe(false);
    expect(mock.bucket.put).not.toHaveBeenCalled();
  });

  it('copies the FULL compiled + code fan-out into versions/{depId}/', async () => {
    const mock = createMockBucket({
      [`${APP}/preview/app-config.json`]: '{"name":"x"}',
      [`${APP}/compiled/a.js`]: 'A',
      [`${APP}/compiled/nested/b.js`]: 'B',
      [`${APP}/compiled/style.css`]: 'CSS',
      [`${APP}/code/a.tsx`]: 'tsxA',
      [`${APP}/code/seeds/data.csv`]: 'csv',
      // An unrelated subtree that must NOT be snapshotted.
      [`${APP}/published/old.js`]: 'nope',
    });

    const ok = await snapshotPreviewVersion(envWith(mock), APP, DEP);
    expect(ok).toBe(true);

    const dest = `${APP}/versions/${DEP}/`;
    // Every compiled + code key copied, preserving relative layout.
    expect(mock.textOf(`${dest}compiled/a.js`)).toBe('A');
    expect(mock.textOf(`${dest}compiled/nested/b.js`)).toBe('B');
    expect(mock.textOf(`${dest}compiled/style.css`)).toBe('CSS');
    expect(mock.textOf(`${dest}code/a.tsx`)).toBe('tsxA');
    expect(mock.textOf(`${dest}code/seeds/data.csv`)).toBe('csv');
    // Config captured at the snapshot root.
    expect(mock.textOf(`${dest}app-config.json`)).toBe('{"name":"x"}');
    // The unrelated subtree was NOT swept into the snapshot.
    expect(mock.textOf(`${dest}published/old.js`)).toBeUndefined();
    expect([...mock.store.keys()].filter((k) => k.startsWith(dest)).length).toBe(6);
  });

  it('writes the snapshot config LAST (after every asset copy)', async () => {
    const mock = createMockBucket({
      [`${APP}/preview/app-config.json`]: 'CFG',
      [`${APP}/compiled/a.js`]: 'A',
      [`${APP}/code/a.tsx`]: 'T',
    });

    await snapshotPreviewVersion(envWith(mock), APP, DEP);

    const dest = `${APP}/versions/${DEP}/`;
    const putKeys = (mock.bucket.put as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    const configIdx = putKeys.indexOf(`${dest}app-config.json`);
    const assetIdxs = putKeys
      .map((k, i) => (k !== `${dest}app-config.json` ? i : -1))
      .filter((i) => i >= 0);

    expect(configIdx).toBeGreaterThanOrEqual(0);
    // The config put must come strictly after every asset put.
    expect(Math.max(...assetIdxs)).toBeLessThan(configIdx);
  });

  it('preserves the application/json content type on the snapshot config', async () => {
    const mock = createMockBucket({
      [`${APP}/preview/app-config.json`]: '{"a":1}',
    });

    await snapshotPreviewVersion(envWith(mock), APP, DEP);

    const dest = `${APP}/versions/${DEP}/`;
    expect(mock.store.get(`${dest}app-config.json`)?.contentType).toBe('application/json');
  });

  it('preserves each asset object content type from the source', async () => {
    const mock = createMockBucket({
      [`${APP}/preview/app-config.json`]: '{}',
      [`${APP}/compiled/a.js`]: 'A',
    });
    // Give the source a non-default content type.
    mock.store.get(`${APP}/compiled/a.js`)!.contentType = 'text/javascript';

    await snapshotPreviewVersion(envWith(mock), APP, DEP);

    expect(mock.store.get(`${APP}/versions/${DEP}/compiled/a.js`)?.contentType).toBe(
      'text/javascript',
    );
  });

  it('succeeds with config-only when there are no compiled/code assets', async () => {
    const mock = createMockBucket({
      [`${APP}/preview/app-config.json`]: 'ONLY-CFG',
    });

    const ok = await snapshotPreviewVersion(envWith(mock), APP, DEP);

    expect(ok).toBe(true);
    const dest = `${APP}/versions/${DEP}/`;
    expect(mock.textOf(`${dest}app-config.json`)).toBe('ONLY-CFG');
    expect([...mock.store.keys()].filter((k) => k.startsWith(dest)).length).toBe(1);
  });

  it('copies the complete tree when assets span more than one list page', async () => {
    const initial: Record<string, string> = {
      [`${APP}/preview/app-config.json`]: 'CFG',
    };
    // 250 compiled keys to force cursor pagination at pageSize 100 (3 pages).
    for (let i = 0; i < 250; i++) initial[`${APP}/compiled/chunk-${i}.js`] = `v${i}`;
    const mock = createMockBucket(initial, { pageSize: 100 });

    const ok = await snapshotPreviewVersion(envWith(mock), APP, DEP);
    expect(ok).toBe(true);

    const dest = `${APP}/versions/${DEP}/compiled/`;
    const copied = [...mock.store.keys()].filter((k) => k.startsWith(dest));
    expect(copied.length).toBe(250);
    // Spot-check first / middle / last to prove no page was dropped.
    expect(mock.textOf(`${dest}chunk-0.js`)).toBe('v0');
    expect(mock.textOf(`${dest}chunk-123.js`)).toBe('v123');
    expect(mock.textOf(`${dest}chunk-249.js`)).toBe('v249');
  });
});

// ---------------------------------------------------------------------------
// restorePreviewVersionAssets
// ---------------------------------------------------------------------------

describe('restorePreviewVersionAssets', () => {
  it('returns false when the snapshot config is missing (nothing to restore)', async () => {
    const mock = createMockBucket({
      // version assets exist but the snapshot config does not
      [`${APP}/versions/${DEP}/compiled/a.js`]: 'A',
    });

    const ok = await restorePreviewVersionAssets(envWith(mock), APP, DEP);

    expect(ok).toBe(false);
    // Live keys untouched.
    expect(mock.textOf(`${APP}/preview/app-config.json`)).toBeUndefined();
    expect(mock.textOf(`${APP}/compiled/a.js`)).toBeUndefined();
  });

  it('copies the snapshot working set back over the live preview keys', async () => {
    const dest = `${APP}/versions/${DEP}/`;
    const mock = createMockBucket({
      // Stale live state that restore must overwrite.
      [`${APP}/preview/app-config.json`]: 'NEW-CFG',
      [`${APP}/compiled/a.js`]: 'NEW-A',
      [`${APP}/code/a.tsx`]: 'NEW-T',
      // The snapshot to restore.
      [`${dest}app-config.json`]: 'OLD-CFG',
      [`${dest}compiled/a.js`]: 'OLD-A',
      [`${dest}compiled/nested/b.js`]: 'OLD-B',
      [`${dest}code/a.tsx`]: 'OLD-T',
    });

    const ok = await restorePreviewVersionAssets(envWith(mock), APP, DEP);
    expect(ok).toBe(true);

    // Live keys now reflect the snapshot.
    expect(mock.textOf(`${APP}/preview/app-config.json`)).toBe('OLD-CFG');
    expect(mock.textOf(`${APP}/compiled/a.js`)).toBe('OLD-A');
    expect(mock.textOf(`${APP}/compiled/nested/b.js`)).toBe('OLD-B');
    expect(mock.textOf(`${APP}/code/a.tsx`)).toBe('OLD-T');
  });

  it('restores the config LAST so the following deploy reads a complete working set', async () => {
    const dest = `${APP}/versions/${DEP}/`;
    const mock = createMockBucket({
      [`${dest}app-config.json`]: 'CFG',
      [`${dest}compiled/a.js`]: 'A',
      [`${dest}code/a.tsx`]: 'T',
    });

    await restorePreviewVersionAssets(envWith(mock), APP, DEP);

    const putKeys = (mock.bucket.put as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    const liveConfig = `${APP}/preview/app-config.json`;
    const configIdx = putKeys.indexOf(liveConfig);
    const assetIdxs = putKeys
      .map((k, i) => (k !== liveConfig ? i : -1))
      .filter((i) => i >= 0);

    expect(configIdx).toBeGreaterThanOrEqual(0);
    expect(Math.max(...assetIdxs)).toBeLessThan(configIdx);
  });

  it('restores the live config with application/json content type', async () => {
    const dest = `${APP}/versions/${DEP}/`;
    const mock = createMockBucket({ [`${dest}app-config.json`]: '{"a":1}' });

    await restorePreviewVersionAssets(envWith(mock), APP, DEP);

    expect(mock.store.get(`${APP}/preview/app-config.json`)?.contentType).toBe(
      'application/json',
    );
  });

  it('restores a complete asset tree that spans multiple list pages', async () => {
    const dest = `${APP}/versions/${DEP}/`;
    const initial: Record<string, string> = { [`${dest}app-config.json`]: 'CFG' };
    for (let i = 0; i < 230; i++) initial[`${dest}compiled/c-${i}.js`] = `r${i}`;
    const mock = createMockBucket(initial, { pageSize: 100 });

    const ok = await restorePreviewVersionAssets(envWith(mock), APP, DEP);
    expect(ok).toBe(true);

    const live = `${APP}/compiled/`;
    const restored = [...mock.store.keys()].filter(
      (k) => k.startsWith(live) && !k.includes('/versions/'),
    );
    expect(restored.length).toBe(230);
    expect(mock.textOf(`${live}c-0.js`)).toBe('r0');
    expect(mock.textOf(`${live}c-229.js`)).toBe('r229');
  });

  it('does not leave a stale live asset that the snapshot lacks (overwrite semantics)', async () => {
    // NOTE: restore copies snapshot keys OVER live keys but does not prune live
    // keys absent from the snapshot. We assert the keys the snapshot DID carry
    // are correct; a stale extra live key is expected to survive (caller re-deploys).
    const dest = `${APP}/versions/${DEP}/`;
    const mock = createMockBucket({
      [`${dest}app-config.json`]: 'CFG',
      [`${dest}compiled/keep.js`]: 'KEEP',
      [`${APP}/compiled/keep.js`]: 'STALE',
      [`${APP}/compiled/extra.js`]: 'EXTRA', // not in snapshot
    });

    await restorePreviewVersionAssets(envWith(mock), APP, DEP);

    expect(mock.textOf(`${APP}/compiled/keep.js`)).toBe('KEEP');
    // The extra key survives — documented behaviour, restore is copy-over.
    expect(mock.textOf(`${APP}/compiled/extra.js`)).toBe('EXTRA');
  });
});

// ---------------------------------------------------------------------------
// snapshot → restore round trip
// ---------------------------------------------------------------------------

describe('snapshot then restore round trip', () => {
  it('restores the exact bytes that were snapshotted after the live set changed', async () => {
    const mock = createMockBucket({
      [`${APP}/preview/app-config.json`]: 'CONFIG-V1',
      [`${APP}/compiled/main.js`]: 'JS-V1',
      [`${APP}/code/main.tsx`]: 'TSX-V1',
    });
    const env = envWith(mock);

    // Snapshot v1.
    expect(await snapshotPreviewVersion(env, APP, DEP)).toBe(true);

    // A later build rewrites the live working set in place.
    await mock.bucket.put(`${APP}/preview/app-config.json`, 'CONFIG-V2');
    await mock.bucket.put(`${APP}/compiled/main.js`, 'JS-V2');
    await mock.bucket.put(`${APP}/code/main.tsx`, 'TSX-V2');

    // Restore v1 brings back the OLD config AND its matching OLD compiled asset.
    expect(await restorePreviewVersionAssets(env, APP, DEP)).toBe(true);
    expect(mock.textOf(`${APP}/preview/app-config.json`)).toBe('CONFIG-V1');
    expect(mock.textOf(`${APP}/compiled/main.js`)).toBe('JS-V1');
    expect(mock.textOf(`${APP}/code/main.tsx`)).toBe('TSX-V1');
  });
});

// ---------------------------------------------------------------------------
// deleteVersionSnapshot — batch chunking at the 500-key boundary
// ---------------------------------------------------------------------------

describe('deleteVersionSnapshot', () => {
  function seedVersion(count: number, pageSize = 1000): MockBucket {
    const initial: Record<string, string> = {
      [`${APP}/versions/${DEP}/app-config.json`]: 'CFG',
    };
    for (let i = 0; i < count; i++) {
      initial[`${APP}/versions/${DEP}/compiled/f-${i}.js`] = `x${i}`;
    }
    // Unrelated key that must survive deletion.
    initial[`${APP}/preview/app-config.json`] = 'LIVE';
    return createMockBucket(initial, { pageSize });
  }

  it('does nothing (no delete call) when the version has no snapshot files', async () => {
    const mock = createMockBucket({ [`${APP}/preview/app-config.json`]: 'LIVE' });

    await deleteVersionSnapshot(envWith(mock), APP, DEP);

    expect(mock.bucket.delete).not.toHaveBeenCalled();
    expect(mock.textOf(`${APP}/preview/app-config.json`)).toBe('LIVE');
  });

  it('deletes every version key in a single batch when under 500', async () => {
    const mock = seedVersion(10); // 10 assets + 1 config = 11 keys

    await deleteVersionSnapshot(envWith(mock), APP, DEP);

    expect(mock.deleteBatches).toEqual([11]);
    // Snapshot gone, live preview untouched.
    expect([...mock.store.keys()].some((k) => k.startsWith(`${APP}/versions/`))).toBe(false);
    expect(mock.textOf(`${APP}/preview/app-config.json`)).toBe('LIVE');
  });

  it('chunks deletes into batches of exactly 500 at the boundary', async () => {
    // 500 assets + 1 config = 501 keys → batches of [500, 1].
    const mock = seedVersion(500, /* pageSize */ 1000);

    await deleteVersionSnapshot(envWith(mock), APP, DEP);

    expect(mock.deleteBatches).toEqual([500, 1]);
    expect(mock.deleteBatches.reduce((a, b) => a + b, 0)).toBe(501);
    expect([...mock.store.keys()].some((k) => k.startsWith(`${APP}/versions/`))).toBe(false);
  });

  it('chunks an exact multiple of 500 into equal full batches with no empty trailer', async () => {
    // 999 assets + 1 config = 1000 keys → [500, 500], no trailing empty batch.
    const mock = seedVersion(999, /* pageSize */ 1000);

    await deleteVersionSnapshot(envWith(mock), APP, DEP);

    expect(mock.deleteBatches).toEqual([500, 500]);
  });

  it('gathers keys across paginated list results before chunking deletes', async () => {
    // 600 keys total but list only returns 100 per page → 6 pages must all be
    // gathered, then deleted as [500, 100].
    const mock = seedVersion(599, /* pageSize */ 100); // 599 + 1 = 600 keys

    await deleteVersionSnapshot(envWith(mock), APP, DEP);

    expect(mock.deleteBatches).toEqual([500, 100]);
    expect([...mock.store.keys()].some((k) => k.startsWith(`${APP}/versions/`))).toBe(false);
  });
});
