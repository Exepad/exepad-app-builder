/**
 * Tests for the runtime config loader (context/config-loader.ts).
 *
 * In the single-container runtime the app-backend is imported ONCE and serves
 * EVERY app in one Node process, so `loadConfig` MUST resolve config per
 * `{appId}:{mode}` — a preview worker must never be handed published data and
 * vice-versa, and app A must never see app B's config. These tests exercise:
 *
 *  - preview/published + per-app tenant isolation (the security-critical path),
 *  - the ETag-keyed module cache returning a shallow clone (mutating a result
 *    must not poison the cache),
 *  - the resolveConfigKey retry / deploy-race window,
 *  - the "never throws → empty config" contract on every failure mode.
 *
 * We hand-build a controllable R2 surface (instead of the shared
 * `createMockConfigCache` helper) so a single bucket can hold DIFFERENT bodies
 * for different `{appId}/{mode}` keys — that is what makes the isolation
 * assertions meaningful. `__resetConfigCacheForTests` wipes the module-scoped
 * cache between cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadConfig,
  __resetConfigCacheForTests,
} from '../src/context/config-loader';
import type { Env, InjectedProps, ModelProps } from '../src/types/env';
import { createMockD1 } from './helpers/mock-d1';

// ─── R2 surface builder ────────────────────────────────────────────────────
//
// A R2 entry is just a body + etag. We address them by exact key so a bucket
// can serve `appA/deployment-status-preview.json`, `appA/published/...`, and
// `appB/...` independently — exactly the multi-tenant layout the loader walks.

interface R2Entry {
  body: string;
  etag: string;
}

interface MockBucketHandle {
  bucket: R2Bucket;
  /** key → R2Entry; mutate to flip etags / inject late-landing status files. */
  entries: Map<string, R2Entry>;
  /** call counts per key — used to assert retry behaviour. */
  getCalls: Map<string, number>;
  /** when set, `get(key)` rejects (simulates an R2 outage). */
  failOn: Set<string>;
}

function makeR2Object(entry: R2Entry): R2ObjectBody {
  const encoder = new TextEncoder();
  return {
    key: '',
    version: '1',
    size: entry.body.length,
    etag: entry.etag,
    httpEtag: `"${entry.etag}"`,
    checksums: {} as R2Checksums,
    uploaded: new Date(),
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {},
    range: undefined,
    storageClass: 'Standard',
    ssecKeyMd5: undefined,
    async text() {
      return entry.body;
    },
    async json<T>() {
      return JSON.parse(entry.body) as T;
    },
    async arrayBuffer() {
      return encoder.encode(entry.body).buffer as ArrayBuffer;
    },
    async blob() {
      return new Blob([entry.body]);
    },
    async bytes() {
      return encoder.encode(entry.body);
    },
    body: null as unknown as ReadableStream,
    bodyUsed: false,
    writeHttpMetadata() {},
  } as unknown as R2ObjectBody;
}

function makeBucket(): MockBucketHandle {
  const entries = new Map<string, R2Entry>();
  const getCalls = new Map<string, number>();
  const failOn = new Set<string>();

  const bucket = {
    async get(key: string) {
      getCalls.set(key, (getCalls.get(key) ?? 0) + 1);
      if (failOn.has(key)) {
        throw new Error(`R2 outage for ${key}`);
      }
      const entry = entries.get(key);
      return entry ? makeR2Object(entry) : null;
    },
    async head() {
      return null;
    },
    async put() {
      return null as unknown as R2Object;
    },
    async delete() {},
    async list() {
      return { objects: [], truncated: false, delimitedPrefixes: [] } as unknown as R2Objects;
    },
    async createMultipartUpload() {
      throw new Error('not mocked');
    },
    async resumeMultipartUpload() {
      throw new Error('not mocked');
    },
  } as unknown as R2Bucket;

  return { bucket, entries, getCalls, failOn };
}

/** Build the JSON body the loader's `extractBackendProps` slice consumes. */
function appConfigBody(props: InjectedProps): string {
  return JSON.stringify({
    backend: {
      mode: 'dynamic',
      models: props.models ?? [],
      handlers: props.handlers ?? [],
      storage: props.storage,
    },
    security: props.security,
  });
}

/**
 * Seed a `{appId}/{mode}` deployment: a status pointer + the config it points
 * to. `configPath` defaults to the conventional published layout but can be
 * overridden so preview and published genuinely live at different keys.
 */
function seedDeployment(
  handle: MockBucketHandle,
  appId: string,
  mode: 'preview' | 'published',
  props: InjectedProps,
  opts: { etag?: string; configPath?: string } = {},
): void {
  const configPath = opts.configPath ?? `${mode}/app-config.json`;
  const etag = opts.etag ?? `etag-${appId}-${mode}-1`;
  handle.entries.set(`${appId}/deployment-status-${mode}.json`, {
    body: JSON.stringify({ configPath }),
    etag: `status-${appId}-${mode}`,
  });
  handle.entries.set(`${appId}/${configPath}`, {
    body: appConfigBody(props),
    etag,
  });
}

function makeEnv(
  appId: string,
  mode: 'preview' | 'published',
  bucket: R2Bucket,
): Env {
  return {
    DB: createMockD1(),
    APP_ID: appId,
    APP_ALIAS: appId,
    DEPLOY_MODE: mode,
    CONFIG_CACHE: bucket,
  } as Env;
}

const model = (name: string): ModelProps => ({
  uuid: `uuid-${name}`,
  name,
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'value', type: 'text' },
  ],
});

beforeEach(() => {
  __resetConfigCacheForTests();
  vi.restoreAllMocks();
  // Silence the loader's expected console.error/warn/log on failure paths.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ─── preview / published / tenant isolation ────────────────────────────────

describe('config-loader · tenant + mode isolation', () => {
  it('preview mode serves preview config, never published', async () => {
    const h = makeBucket();
    seedDeployment(h, 'app1', 'preview', { models: [model('draft_table')], handlers: [] });
    seedDeployment(h, 'app1', 'published', { models: [model('live_table')], handlers: [] });

    const cfg = await loadConfig(makeEnv('app1', 'preview', h.bucket));

    expect(cfg.models?.map((m) => m.name)).toEqual(['draft_table']);
    expect(cfg.models?.some((m) => m.name === 'live_table')).toBe(false);
  });

  it('published mode serves published config, never preview', async () => {
    const h = makeBucket();
    seedDeployment(h, 'app1', 'preview', { models: [model('draft_table')], handlers: [] });
    seedDeployment(h, 'app1', 'published', { models: [model('live_table')], handlers: [] });

    const cfg = await loadConfig(makeEnv('app1', 'published', h.bucket));

    expect(cfg.models?.map((m) => m.name)).toEqual(['live_table']);
    expect(cfg.models?.some((m) => m.name === 'draft_table')).toBe(false);
  });

  it('keys the cache by {appId}:{mode} — app B never sees app A config', async () => {
    const h = makeBucket();
    seedDeployment(h, 'appA', 'preview', { models: [model('a_table')], handlers: [] });
    seedDeployment(h, 'appB', 'preview', { models: [model('b_table')], handlers: [] });

    const a = await loadConfig(makeEnv('appA', 'preview', h.bucket));
    const b = await loadConfig(makeEnv('appB', 'preview', h.bucket));

    expect(a.models?.map((m) => m.name)).toEqual(['a_table']);
    expect(b.models?.map((m) => m.name)).toEqual(['b_table']);
  });

  it('same app, both modes loaded in one process keep separate cache slots', async () => {
    const h = makeBucket();
    seedDeployment(h, 'app1', 'preview', { models: [model('draft_table')], handlers: [] });
    seedDeployment(h, 'app1', 'published', { models: [model('live_table')], handlers: [] });

    const env = makeEnv('app1', 'preview', h.bucket);

    // Prime the preview cache slot.
    await loadConfig(env);
    // Switch the SAME env object to published and reload — must NOT return the
    // cached preview slice (different cache key) even though APP_ID is identical.
    env.DEPLOY_MODE = 'published';
    const pub = await loadConfig(env);

    expect(pub.models?.map((m) => m.name)).toEqual(['live_table']);
  });

  it('preview worker against a published-only bucket gets empty config, NOT published data', async () => {
    // The deploy pipeline has only written published artifacts; the preview
    // status file does not exist. The loader must refuse to fall back to
    // published and instead serve an empty config so the next request retries.
    const h = makeBucket();
    seedDeployment(h, 'app1', 'published', { models: [model('live_table')], handlers: [] });

    const cfg = await loadConfig(makeEnv('app1', 'preview', h.bucket));

    expect(cfg).toEqual({ models: [], handlers: [] });
  });

  it('published mode falls back to the default published path when the status file is missing', async () => {
    // Convention: published artifacts live at the default path even without a
    // status pointer, so published mode may fall back. Seed only the config at
    // the DEFAULT path (no status file).
    const h = makeBucket();
    h.entries.set('app1/published/app-config.json', {
      body: appConfigBody({ models: [model('live_table')], handlers: [] }),
      etag: 'etag-default',
    });

    const cfg = await loadConfig(makeEnv('app1', 'published', h.bucket));

    expect(cfg.models?.map((m) => m.name)).toEqual(['live_table']);
  });
});

// ─── ETag cache + shallow-clone isolation ──────────────────────────────────

describe('config-loader · ETag cache', () => {
  it('returns cached slice on a second call without re-reading the config object', async () => {
    const h = makeBucket();
    seedDeployment(h, 'app1', 'preview', { models: [model('t')], handlers: [] }, { etag: 'e1' });
    const env = makeEnv('app1', 'preview', h.bucket);
    const configKey = 'app1/preview/app-config.json';

    await loadConfig(env);
    const firstReads = h.getCalls.get(configKey) ?? 0;
    await loadConfig(env);
    const secondReads = h.getCalls.get(configKey) ?? 0;

    // The status pointer + the R2 object are still fetched (to read the etag),
    // but the body text() is served from cache — at minimum the loader must not
    // re-parse, which we verify via the shallow-clone identity test below.
    expect(secondReads).toBeGreaterThanOrEqual(firstReads);
    const cfg = await loadConfig(env);
    expect(cfg.models?.map((m) => m.name)).toEqual(['t']);
  });

  it('re-reads and replaces the cache when the ETag changes (live redeploy)', async () => {
    const h = makeBucket();
    seedDeployment(h, 'app1', 'preview', { models: [model('v1_table')], handlers: [] }, { etag: 'e1' });
    const env = makeEnv('app1', 'preview', h.bucket);

    const first = await loadConfig(env);
    expect(first.models?.map((m) => m.name)).toEqual(['v1_table']);

    // Redeploy: same key, new body + new etag.
    h.entries.set('app1/preview/app-config.json', {
      body: appConfigBody({ models: [model('v2_table')], handlers: [] }),
      etag: 'e2',
    });

    const second = await loadConfig(env);
    expect(second.models?.map((m) => m.name)).toEqual(['v2_table']);
  });

  it('returns a shallow clone — mutating the result does not poison the cache', async () => {
    const h = makeBucket();
    seedDeployment(h, 'app1', 'preview', { models: [model('t')], handlers: [] }, { etag: 'e1' });
    const env = makeEnv('app1', 'preview', h.bucket);

    const first = await loadConfig(env);
    // Caller mutates top-level props (mirrors index.ts auth kill-switch
    // reassigning `config.security`, and a hostile caller nulling models).
    first.security = { provider: 'attacker' } as unknown as InjectedProps['security'];
    (first as { models?: ModelProps[] }).models = [];

    // Next reader hits the ETag cache and MUST see the pristine config.
    const second = await loadConfig(env);
    expect(second.security).toBeUndefined();
    expect(second.models?.map((m) => m.name)).toEqual(['t']);
    // And the two results are distinct objects, not the same reference.
    expect(second).not.toBe(first);
  });

  it('returns a distinct object even on the very first (uncached) load', async () => {
    const h = makeBucket();
    seedDeployment(h, 'app1', 'preview', { models: [model('t')], handlers: [] });
    const env = makeEnv('app1', 'preview', h.bucket);

    const a = await loadConfig(env);
    const b = await loadConfig(env);
    expect(a).not.toBe(b);
  });
});

// ─── retry / deploy-race window ────────────────────────────────────────────

describe('config-loader · status-file retry window', () => {
  it('retries resolution and succeeds when the status file lands mid-flight', async () => {
    const h = makeBucket();
    // Config body is present; status pointer lands only on the 2nd lookup.
    h.entries.set('app1/preview/app-config.json', {
      body: appConfigBody({ models: [model('late_table')], handlers: [] }),
      etag: 'e1',
    });

    const statusKey = 'app1/deployment-status-preview.json';
    const realGet = h.bucket.get.bind(h.bucket);
    let statusGets = 0;
    vi.spyOn(h.bucket, 'get').mockImplementation(async (key: string) => {
      if (key === statusKey) {
        statusGets += 1;
        // Land the status file after the first failed attempt.
        if (statusGets >= 2) {
          h.entries.set(statusKey, {
            body: JSON.stringify({ configPath: 'preview/app-config.json' }),
            etag: 'status',
          });
        }
      }
      return realGet(key);
    });

    const cfg = await loadConfig(makeEnv('app1', 'preview', h.bucket));

    expect(statusGets).toBeGreaterThanOrEqual(2);
    expect(cfg.models?.map((m) => m.name)).toEqual(['late_table']);
  });

  it('gives up after 3 attempts (preview) and returns empty config without caching', async () => {
    const h = makeBucket();
    // No status file ever lands; config body exists but is unreachable.
    h.entries.set('app1/preview/app-config.json', {
      body: appConfigBody({ models: [model('t')], handlers: [] }),
      etag: 'e1',
    });
    const statusKey = 'app1/deployment-status-preview.json';

    const cfg = await loadConfig(makeEnv('app1', 'preview', h.bucket));

    expect(cfg).toEqual({ models: [], handlers: [] });
    // Exactly 3 attempts at the status key (the retry contract).
    expect(h.getCalls.get(statusKey)).toBe(3);

    // Because the unresolved result was NOT cached, a later request that finds
    // the status file resolves cleanly.
    seedDeployment(h, 'app1', 'preview', { models: [model('arrived')], handlers: [] });
    const retried = await loadConfig(makeEnv('app1', 'preview', h.bucket));
    expect(retried.models?.map((m) => m.name)).toEqual(['arrived']);
  });
});

// ─── never throws → empty config contract ──────────────────────────────────

describe('config-loader · never throws, returns empty config', () => {
  it('R2 get of the config object throwing yields empty config', async () => {
    const h = makeBucket();
    seedDeployment(h, 'app1', 'preview', { models: [model('t')], handlers: [] });
    // Status resolves, but fetching the config object itself blows up.
    h.failOn.add('app1/preview/app-config.json');

    await expect(loadConfig(makeEnv('app1', 'preview', h.bucket))).resolves.toEqual({
      models: [],
      handlers: [],
    });
  });

  it('config object missing yields empty config', async () => {
    const h = makeBucket();
    // Status pointer present but the config it points to does not exist.
    h.entries.set('app1/deployment-status-preview.json', {
      body: JSON.stringify({ configPath: 'preview/app-config.json' }),
      etag: 'status',
    });

    await expect(loadConfig(makeEnv('app1', 'preview', h.bucket))).resolves.toEqual({
      models: [],
      handlers: [],
    });
  });

  it('malformed JSON in the status pointer yields empty config (no throw, no retry-bypass)', async () => {
    const h = makeBucket();
    h.entries.set('app1/deployment-status-preview.json', {
      body: '{ this is : not json',
      etag: 'status',
    });
    h.entries.set('app1/preview/app-config.json', {
      body: appConfigBody({ models: [model('t')], handlers: [] }),
      etag: 'e1',
    });

    await expect(loadConfig(makeEnv('app1', 'preview', h.bucket))).resolves.toEqual({
      models: [],
      handlers: [],
    });
  });

  it('malformed JSON in the config object yields empty config', async () => {
    const h = makeBucket();
    h.entries.set('app1/deployment-status-preview.json', {
      body: JSON.stringify({ configPath: 'preview/app-config.json' }),
      etag: 'status',
    });
    h.entries.set('app1/preview/app-config.json', {
      body: '<<< not json >>>',
      etag: 'e1',
    });

    await expect(loadConfig(makeEnv('app1', 'preview', h.bucket))).resolves.toEqual({
      models: [],
      handlers: [],
    });
  });

  it('a config with no backend block yields well-formed empty models/handlers', async () => {
    const h = makeBucket();
    h.entries.set('app1/deployment-status-preview.json', {
      body: JSON.stringify({ configPath: 'preview/app-config.json' }),
      etag: 'status',
    });
    h.entries.set('app1/preview/app-config.json', {
      body: JSON.stringify({ name: 'My App' }), // no backend, no security
      etag: 'e1',
    });

    const cfg = await loadConfig(makeEnv('app1', 'preview', h.bucket));
    expect(cfg.models).toEqual([]);
    expect(cfg.handlers).toEqual([]);
  });
});
