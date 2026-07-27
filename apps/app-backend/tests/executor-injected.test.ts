/**
 * Tests for the per-app handler registry (handlers/app-registry.ts).
 *
 * Under the single-container runtime the app-backend serves every app in one
 * Node process, so handlers MUST be resolved per `{appId}:{mode}` — never via a
 * process-global. These tests cover the storage + node:vm load path, per-app
 * isolation, the override seam, content-hash cache invalidation, and the
 * sandbox denials.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { executeHandler } from '../src/handlers/executor';
import {
  getAppHandlers,
  registerHandlers,
  __clearHandlerRegistry,
} from '../src/handlers/app-registry';
import type { HandlerProps, Env } from '../src/types/env';
import { createMockD1 } from './helpers/mock-d1';
import { createMockEnv, TEST_USER } from './helpers/mock-env';

/**
 * Build a mock CONFIG_CACHE (R2 surface) that serves a worker-manifest plus the
 * compiled handler ES modules the app-registry loads + vm-instantiates.
 */
function makeModuleCache(
  appId: string,
  mode: 'preview' | 'published',
  handlerSources: Record<string, string>,
  etag = 'v1',
): R2Bucket {
  const store = new Map<string, string>();
  const manifest = {
    scriptName: mode === 'preview' ? `app-preview-${appId}` : `app-${appId}`,
    appId,
    mode,
    mainModule: '_entry.js',
    modules: [
      '_entry.js',
      'template.js',
      ...Object.keys(handlerSources).map((m) => `handlers/${m}.js`),
    ],
    updatedAt: 't',
  };
  store.set(`${appId}/${mode}/worker-manifest.json`, JSON.stringify(manifest));
  for (const [method, src] of Object.entries(handlerSources)) {
    store.set(`${appId}/${mode}/modules/handlers/${method}.js`, src);
  }

  function makeObj(body: string): R2ObjectBody {
    return {
      etag,
      httpEtag: `"${etag}"`,
      async text() {
        return body;
      },
      async json<T>() {
        return JSON.parse(body) as T;
      },
    } as unknown as R2ObjectBody;
  }

  return {
    async get(key: string) {
      const body = store.get(key);
      return body === undefined ? null : makeObj(body);
    },
    async head() {
      return null;
    },
  } as unknown as R2Bucket;
}

function envWith(appId: string, mode: 'preview' | 'published', cache: R2Bucket): Env {
  return createMockEnv({ APP_ID: appId, DEPLOY_MODE: mode, DB: createMockD1(), CONFIG_CACHE: cache });
}

const noOutputHandler = (method: string): HandlerProps => ({
  uuid: `h-${method}`,
  name: method,
  method,
  authLevel: 'public',
  inputs: [],
  outputs: [],
});

beforeEach(() => {
  __clearHandlerRegistry();
});

describe('app-registry — storage + vm load path', () => {
  it('loads a compiled handler module from storage and executes it', async () => {
    const env = envWith('storeapp', 'preview', makeModuleCache('storeapp', 'preview', {
      op: 'export default async (ctx) => ({ ok: true, who: ctx.config.appId });',
    }));

    const result = await executeHandler(noOutputHandler('op'), {}, TEST_USER, env, []);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ok: true, who: 'storeapp' });
  });

  it('supports the bundled `export default function` form', async () => {
    const env = envWith('fnapp', 'preview', makeModuleCache('fnapp', 'preview', {
      doThing: 'export default async function doThing(ctx) { return { n: ctx.params.n }; }',
    }));
    const handler: HandlerProps = { ...noOutputHandler('doThing'), inputs: [{ name: 'n', type: 'number' }] };
    const result = await executeHandler(handler, { n: 7 }, TEST_USER, env, []);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ n: 7 });
  });

  it('throws HandlerError when the app has no deployed worker (no manifest)', async () => {
    // CONFIG_CACHE that returns null for everything.
    const emptyCache = { async get() { return null; }, async head() { return null; } } as unknown as R2Bucket;
    const env = envWith('bare', 'preview', emptyCache);
    await expect(executeHandler(noOutputHandler('op'), {}, TEST_USER, env, [])).rejects.toThrow(/not found/);
  });
});

describe('app-registry — per-app isolation (the core fix)', () => {
  it('two apps in one process resolve their OWN handlers, never each other\'s', async () => {
    const envA = envWith('appA', 'preview', makeModuleCache('appA', 'preview', {
      shared: "export default async () => ({ from: 'A' });",
    }));
    const envB = envWith('appB', 'preview', makeModuleCache('appB', 'preview', {
      shared: "export default async () => ({ from: 'B' });",
    }));

    const a = await executeHandler(noOutputHandler('shared'), {}, TEST_USER, envA, []);
    const b = await executeHandler(noOutputHandler('shared'), {}, TEST_USER, envB, []);
    expect(a.data).toEqual({ from: 'A' });
    expect(b.data).toEqual({ from: 'B' });
  });

  it('preview and published of the same app are isolated', async () => {
    const prev = envWith('dual', 'preview', makeModuleCache('dual', 'preview', {
      op: "export default async () => ({ mode: 'preview' });",
    }));
    const pub = envWith('dual', 'published', makeModuleCache('dual', 'published', {
      op: "export default async () => ({ mode: 'published' });",
    }));
    expect((await executeHandler(noOutputHandler('op'), {}, TEST_USER, prev, [])).data).toEqual({ mode: 'preview' });
    expect((await executeHandler(noOutputHandler('op'), {}, TEST_USER, pub, [])).data).toEqual({ mode: 'published' });
  });
});

describe('app-registry — override seam', () => {
  it('registerHandlers wins over the storage path', async () => {
    const env = envWith('ovr', 'preview', makeModuleCache('ovr', 'preview', {
      op: "export default async () => ({ source: 'storage' });",
    }));
    registerHandlers('ovr', 'preview', { op: async () => ({ source: 'override' }) });

    const result = await executeHandler(noOutputHandler('op'), {}, TEST_USER, env, []);
    expect(result.data).toEqual({ source: 'override' });
  });
});

describe('app-registry — cache invalidation by manifest etag', () => {
  it('reloads handlers when the deployment content hash changes', async () => {
    const env = envWith('verapp', 'preview', makeModuleCache('verapp', 'preview', {
      op: "export default async () => ({ v: 1 });",
    }, 'etag-1'));

    expect((await executeHandler(noOutputHandler('op'), {}, TEST_USER, env, [])).data).toEqual({ v: 1 });

    // Redeploy: new module + new etag, same app+mode.
    env.CONFIG_CACHE = makeModuleCache('verapp', 'preview', {
      op: "export default async () => ({ v: 2 });",
    }, 'etag-2');

    expect((await executeHandler(noOutputHandler('op'), {}, TEST_USER, env, [])).data).toEqual({ v: 2 });
  });

  it('serves the cached registry when the etag is unchanged', async () => {
    const cache = makeModuleCache('cacheapp', 'preview', {
      op: "export default async () => ({ ok: true });",
    }, 'stable');
    const env = envWith('cacheapp', 'preview', cache);
    const r1 = await getAppHandlers(env);
    const r2 = await getAppHandlers(env);
    expect(r1).toBe(r2); // same cached object reference
  });
});

describe('app-registry — sandbox', () => {
  it('denies process/require/ambient fetch inside the handler', async () => {
    const env = envWith('sbx', 'preview', makeModuleCache('sbx', 'preview', {
      probe:
        'export default async () => ({ ' +
        'hasProcess: typeof process !== "undefined", ' +
        'hasRequire: typeof require !== "undefined", ' +
        'hasFetch: typeof fetch !== "undefined" ' +
        '});',
    }));
    const result = await executeHandler(noOutputHandler('probe'), {}, TEST_USER, env, []);
    expect(result.data).toMatchObject({ hasProcess: false, hasRequire: false });
    // fetch IS present (gated wrapper), but process/require are not.
    expect((result.data as { hasFetch: boolean }).hasFetch).toBe(true);
  });

  it('gated fetch is default-deny without EXEPAD_FETCH_ALLOWLIST', async () => {
    delete process.env.EXEPAD_FETCH_ALLOWLIST;
    const env = envWith('netapp', 'preview', makeModuleCache('netapp', 'preview', {
      call:
        'export default async () => { try { await fetch("https://example.com"); return { ok: true }; } ' +
        'catch (e) { return { blocked: String(e.message) }; } };',
    }));
    const result = await executeHandler(noOutputHandler('call'), {}, TEST_USER, env, []);
    expect((result.data as { blocked?: string }).blocked).toMatch(/disabled|EXEPAD_FETCH_ALLOWLIST/);
  });
});
