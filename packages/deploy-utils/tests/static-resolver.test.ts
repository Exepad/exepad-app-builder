/**
 * Tests for the static seed resolver (seed/static-resolver.ts).
 *
 * resolveStaticSeeds reads CSV/JSON seed files from R2 and inlines the parsed
 * records into appConfig.backend.data.datasets (static mode), in place. It
 * routes entries: D1-backed models (present in backendModelNames) are skipped
 * (seedFromR2 owns those); only non-model "static" datasets are inlined.
 *
 * Harness mirrors r2-seeder.test.ts: a hand-rolled mock R2Bucket.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveStaticSeeds } from '../src/seed/static-resolver';
import type { ResolveStaticSeedsOptions } from '../src/seed/static-resolver';
import type { SeedRepoProps } from '@exepad/types';

/**
 * Mock R2Bucket whose .get(key) returns an object with .text() for known keys.
 */
function createMockR2(files: Record<string, string>): R2Bucket {
  return {
    get: vi.fn(async (key: string) => {
      if (!(key in files)) return null;
      const content = files[key];
      return {
        text: async () => content,
        json: async () => JSON.parse(content),
        body: null,
        bodyUsed: false,
        arrayBuffer: async () => new ArrayBuffer(0),
        blob: async () => new Blob(),
      } as unknown as R2ObjectBody;
    }),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    head: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket;
}

function buildOptions(
  overrides: Partial<ResolveStaticSeedsOptions> &
    Pick<ResolveStaticSeedsOptions, 'seedEntries'>,
): ResolveStaticSeedsOptions {
  return {
    r2: createMockR2({}),
    appId: 'test-app',
    appConfig: { backend: { mode: 'static' } },
    backendModelNames: new Set<string>(),
    ...overrides,
  };
}

const seed = (over: Partial<SeedRepoProps>): SeedRepoProps => ({
  source: 'repo/seed/x.csv',
  source_hash: 'abc',
  format: 'csv',
  model: 'x',
  ...over,
});

// ---------------------------------------------------------------------------
// D1-vs-inline routing.
// ---------------------------------------------------------------------------

describe('resolveStaticSeeds — routing', () => {
  it('inlines a non-model dataset as StaticDatasetProps with records + _meta', async () => {
    const csv = 'city,pop\nParis,2000000\nLyon,500000';
    const r2 = createMockR2({ 'test-app/repo/seed/cities.csv': csv });
    const appConfig: Record<string, any> = { backend: { mode: 'static' } };

    const result = await resolveStaticSeeds(
      buildOptions({
        r2,
        appConfig,
        backendModelNames: new Set(), // no D1 models → static route
        seedEntries: {
          cities: seed({ source: 'repo/seed/cities.csv', model: 'cities' }),
        },
      }),
    );

    expect(result.resolved).toEqual(['cities']);
    expect(result.errors).toEqual([]);

    const ds = appConfig.backend.data.datasets.cities;
    expect(ds.type).toBe('static');
    expect(ds.generated).toBe(true);
    expect(ds.records).toHaveLength(2);
    expect(ds.records[0]).toMatchObject({ city: 'Paris' });
    expect(ds._meta).toMatchObject({
      totalCount: 2,
      truncated: false,
      sourceHint: 'Resolved from repo/seed/cities.csv',
    });
  });

  it('skips D1-backed models (left for seedFromR2) and never reads R2 for them', async () => {
    const r2 = createMockR2({}); // intentionally empty — must not be read
    const appConfig: Record<string, any> = { backend: { mode: 'static' } };

    const result = await resolveStaticSeeds(
      buildOptions({
        r2,
        appConfig,
        // 'contacts' IS a backend model → routed to D1, skipped here.
        backendModelNames: new Set(['contacts']),
        seedEntries: {
          contacts: seed({ model: 'contacts' }),
        },
      }),
    );

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([]);
    // No R2 read attempted for a D1-routed entry, no dataset injected.
    expect(r2.get).not.toHaveBeenCalled();
    expect(appConfig.backend.data).toBeUndefined();
  });

  it('routes a mixed batch: D1 model skipped, static dataset inlined', async () => {
    const json = JSON.stringify([{ region: 'EU' }, { region: 'NA' }]);
    const r2 = createMockR2({ 'test-app/repo/seed/regions.json': json });
    const appConfig: Record<string, any> = { backend: { mode: 'static' } };

    const result = await resolveStaticSeeds(
      buildOptions({
        r2,
        appConfig,
        backendModelNames: new Set(['orders']),
        seedEntries: {
          orders: seed({ model: 'orders', format: 'json', source: 'repo/seed/orders.json' }),
          regions: seed({ model: 'regions', format: 'json', source: 'repo/seed/regions.json' }),
        },
      }),
    );

    expect(result.resolved).toEqual(['regions']);
    expect(appConfig.backend.data.datasets.orders).toBeUndefined();
    expect(appConfig.backend.data.datasets.regions.records).toHaveLength(2);
  });

  it('matches backend models case-insensitively (caller lowercases the set)', async () => {
    // The doc-contract: backendModelNames are pre-lowercased; entry.model is
    // lowercased before the membership test. A 'Tasks' entry must be skipped.
    const r2 = createMockR2({});
    const appConfig: Record<string, any> = { backend: { mode: 'static' } };

    const result = await resolveStaticSeeds(
      buildOptions({
        r2,
        appConfig,
        backendModelNames: new Set(['tasks']),
        seedEntries: { tasks: seed({ model: 'Tasks' }) },
      }),
    );

    expect(result.resolved).toEqual([]);
    expect(r2.get).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Dynamic-mode guard + in-place dataset build + error paths.
// ---------------------------------------------------------------------------

describe('resolveStaticSeeds — guards & build', () => {
  it('refuses to inject a static dataset into a dynamic-mode backend', async () => {
    const csv = 'a\n1';
    const r2 = createMockR2({ 'test-app/repo/seed/x.csv': csv });
    const appConfig: Record<string, any> = { backend: { mode: 'dynamic' } };

    const result = await resolveStaticSeeds(
      buildOptions({
        r2,
        appConfig,
        backendModelNames: new Set(),
        seedEntries: { x: seed({ model: 'x' }) },
      }),
    );

    expect(result.resolved).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('dynamic-mode');
    // Guard fires AFTER parse but BEFORE mutation — config is untouched.
    expect(appConfig.backend.data).toBeUndefined();
    expect(appConfig.backend.mode).toBe('dynamic');
  });

  it('builds the backend.data.datasets path in place when missing (static mode)', async () => {
    const csv = 'k\nv';
    const r2 = createMockR2({ 'test-app/repo/seed/x.csv': csv });
    // No backend at all → resolver must create the static-mode scaffold.
    const appConfig: Record<string, any> = {};

    const result = await resolveStaticSeeds(
      buildOptions({
        r2,
        appConfig,
        backendModelNames: new Set(),
        seedEntries: { x: seed({ model: 'x' }) },
      }),
    );

    expect(result.resolved).toEqual(['x']);
    expect(appConfig.backend.mode).toBe('static');
    expect(appConfig.backend.data.datasets.x.records).toHaveLength(1);
  });

  it('preserves pre-existing sibling datasets when adding a new one', async () => {
    const csv = 'k\nv';
    const r2 = createMockR2({ 'test-app/repo/seed/x.csv': csv });
    const appConfig: Record<string, any> = {
      backend: { mode: 'static', data: { datasets: { existing: { type: 'static', records: [] } } } },
    };

    await resolveStaticSeeds(
      buildOptions({
        r2,
        appConfig,
        backendModelNames: new Set(),
        seedEntries: { x: seed({ model: 'x' }) },
      }),
    );

    // The new dataset is added without clobbering the existing one.
    expect(appConfig.backend.data.datasets.existing).toBeDefined();
    expect(appConfig.backend.data.datasets.x).toBeDefined();
  });

  it('reports a not-found error when the seed file is missing from R2', async () => {
    const r2 = createMockR2({}); // empty bucket
    const appConfig: Record<string, any> = { backend: { mode: 'static' } };

    const result = await resolveStaticSeeds(
      buildOptions({
        r2,
        appConfig,
        backendModelNames: new Set(),
        seedEntries: { x: seed({ model: 'x', source: 'repo/seed/x.csv' }) },
      }),
    );

    expect(result.resolved).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('not found in R2');
    expect(result.errors[0]).toContain('test-app/repo/seed/x.csv');
  });

  it('reports an error for malformed JSON and inlines nothing', async () => {
    const r2 = createMockR2({ 'test-app/repo/seed/bad.json': '{ not: valid json' });
    const appConfig: Record<string, any> = { backend: { mode: 'static' } };

    const result = await resolveStaticSeeds(
      buildOptions({
        r2,
        appConfig,
        backendModelNames: new Set(),
        seedEntries: { bad: seed({ model: 'bad', format: 'json', source: 'repo/seed/bad.json' }) },
      }),
    );

    expect(result.resolved).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('[bad]');
    expect(appConfig.backend.data).toBeUndefined();
  });

  it('reports an error for a JSON object that is not an array', async () => {
    const r2 = createMockR2({ 'test-app/repo/seed/obj.json': JSON.stringify({ a: 1 }) });
    const appConfig: Record<string, any> = { backend: { mode: 'static' } };

    const result = await resolveStaticSeeds(
      buildOptions({
        r2,
        appConfig,
        backendModelNames: new Set(),
        seedEntries: { obj: seed({ model: 'obj', format: 'json', source: 'repo/seed/obj.json' }) },
      }),
    );

    expect(result.resolved).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('must be an array');
  });

  it('reports an error when the parsed seed has zero records', async () => {
    // Header-only CSV → no data rows.
    const r2 = createMockR2({ 'test-app/repo/seed/empty.csv': 'col_a,col_b' });
    const appConfig: Record<string, any> = { backend: { mode: 'static' } };

    const result = await resolveStaticSeeds(
      buildOptions({
        r2,
        appConfig,
        backendModelNames: new Set(),
        seedEntries: { empty: seed({ model: 'empty', source: 'repo/seed/empty.csv' }) },
      }),
    );

    expect(result.resolved).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('No records parsed');
    expect(appConfig.backend.data).toBeUndefined();
  });

  it('isolates failures: a bad entry errors while a good entry still resolves', async () => {
    const r2 = createMockR2({
      'test-app/repo/seed/good.csv': 'n\n1',
      // 'missing.csv' deliberately absent
    });
    const appConfig: Record<string, any> = { backend: { mode: 'static' } };

    const result = await resolveStaticSeeds(
      buildOptions({
        r2,
        appConfig,
        backendModelNames: new Set(),
        seedEntries: {
          missing: seed({ model: 'missing', source: 'repo/seed/missing.csv' }),
          good: seed({ model: 'good', source: 'repo/seed/good.csv' }),
        },
      }),
    );

    expect(result.resolved).toEqual(['good']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('[missing]');
    expect(appConfig.backend.data.datasets.good).toBeDefined();
    expect(appConfig.backend.data.datasets.missing).toBeUndefined();
  });

  it('captures an unexpected R2 throw as a per-entry error rather than rejecting', async () => {
    const r2 = {
      get: vi.fn(async () => {
        throw new Error('R2 boom');
      }),
    } as unknown as R2Bucket;
    const appConfig: Record<string, any> = { backend: { mode: 'static' } };

    const result = await resolveStaticSeeds(
      buildOptions({
        r2,
        appConfig,
        backendModelNames: new Set(),
        seedEntries: { x: seed({ model: 'x' }) },
      }),
    );

    expect(result.resolved).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Unexpected error');
    expect(result.errors[0]).toContain('R2 boom');
  });

  it('returns empty result for an empty seedEntries map (no R2 access)', async () => {
    const r2 = createMockR2({});
    const result = await resolveStaticSeeds(
      buildOptions({ r2, seedEntries: {} }),
    );

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(r2.get).not.toHaveBeenCalled();
  });
});
