/**
 * Tests for the local app-backend "deployment" (formerly Workers for Platforms).
 *
 * `uploadWorkerScript` no longer hits the WfP REST API — it writes the compiled
 * ES modules to `{appId}/{mode}/modules/{name}` and a manifest at
 * `{appId}/{mode}/worker-manifest.json` under `$EXEPAD_DATA_DIR/storage`. We read
 * those back with a real `FsStorageAdapter` rather than inspecting a fetch body.
 * `createAppBackendBindings` is unchanged and keeps its original coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  uploadWorkerScript,
  deleteWorkerScript,
  listWorkerScripts,
  createAppBackendBindings,
  type WorkerModule,
  type WorkerManifest,
} from '../src/deploy/wfp';
import { FsStorageAdapter } from '@exepad/local-adapters/storage';
import { TEST_CONFIG, setupDataDir, teardownDataDir } from './helpers/local-db';

beforeEach(() => {
  setupDataDir();
});
afterEach(() => {
  teardownDataDir();
});

const modulesPrefix = (appId: string, mode: string) => `${appId}/${mode}/modules`;
const manifestKey = (appId: string, mode: string) => `${appId}/${mode}/worker-manifest.json`;

describe('uploadWorkerScript — multi-module', () => {
  it('writes each module file and a manifest listing them with the right mainModule', async () => {
    const modules: WorkerModule[] = [
      { name: '_entry.js', content: 'export default {}', type: 'esm' },
      { name: 'template.js', content: 'export default { fetch() {} }', type: 'esm' },
      { name: 'handlers/foo.js', content: 'export default async () => {}', type: 'esm' },
    ];

    // 'app-{appId}' encodes published mode.
    const info = await uploadWorkerScript(TEST_CONFIG, 'app-myapp', [], {
      modules,
      mainModule: '_entry.js',
    });
    expect(info.id).toBe('app-myapp');

    const storage = new FsStorageAdapter();

    // Each module file was written with its content.
    for (const mod of modules) {
      const obj = await storage.get(`${modulesPrefix('myapp', 'published')}/${mod.name}`);
      expect(obj).not.toBeNull();
      expect(await obj!.text()).toBe(mod.content);
    }

    // The manifest lists every module + the correct mainModule and mode.
    const manifestObj = await storage.get(manifestKey('myapp', 'published'));
    expect(manifestObj).not.toBeNull();
    const manifest = (await manifestObj!.json()) as WorkerManifest;
    expect(manifest.scriptName).toBe('app-myapp');
    expect(manifest.appId).toBe('myapp');
    expect(manifest.mode).toBe('published');
    expect(manifest.mainModule).toBe('_entry.js');
    expect(manifest.modules).toEqual(['_entry.js', 'template.js', 'handlers/foo.js']);
    expect(typeof manifest.updatedAt).toBe('string');
  });

  it('encodes preview mode from the app-preview-{appId} script name', async () => {
    const modules: WorkerModule[] = [
      { name: '_entry.js', content: 'export default {}', type: 'esm' },
    ];
    await uploadWorkerScript(TEST_CONFIG, 'app-preview-myapp', [], {
      modules,
      mainModule: '_entry.js',
    });

    const storage = new FsStorageAdapter();
    const manifestObj = await storage.get(manifestKey('myapp', 'preview'));
    expect(manifestObj).not.toBeNull();
    const manifest = (await manifestObj!.json()) as WorkerManifest;
    expect(manifest.mode).toBe('preview');
    expect(manifest.appId).toBe('myapp');
  });

  it('replaces prior modules so removed handlers do not linger', async () => {
    const storage = new FsStorageAdapter();

    await uploadWorkerScript(TEST_CONFIG, 'app-myapp', [], {
      modules: [
        { name: '_entry.js', content: 'export default {}', type: 'esm' },
        { name: 'handlers/old.js', content: 'export default () => {}', type: 'esm' },
      ],
      mainModule: '_entry.js',
    });
    expect(await storage.head(`${modulesPrefix('myapp', 'published')}/handlers/old.js`)).not.toBeNull();

    // Re-upload without the old handler.
    await uploadWorkerScript(TEST_CONFIG, 'app-myapp', [], {
      modules: [{ name: '_entry.js', content: 'export default {}', type: 'esm' }],
      mainModule: '_entry.js',
    });

    expect(await storage.head(`${modulesPrefix('myapp', 'published')}/handlers/old.js`)).toBeNull();
    expect(await storage.head(`${modulesPrefix('myapp', 'published')}/_entry.js`)).not.toBeNull();

    const manifest = (await (await storage.get(manifestKey('myapp', 'published')))!.json()) as WorkerManifest;
    expect(manifest.modules).toEqual(['_entry.js']);
  });
});

describe('uploadWorkerScript — single-module', () => {
  it("writes 'worker.js' with mainModule 'worker.js' from scriptContent", async () => {
    const scriptContent = 'export default { fetch() { return new Response("ok"); } }';
    await uploadWorkerScript(TEST_CONFIG, 'app-myapp', [], { scriptContent });

    const storage = new FsStorageAdapter();

    const workerObj = await storage.get(`${modulesPrefix('myapp', 'published')}/worker.js`);
    expect(workerObj).not.toBeNull();
    expect(await workerObj!.text()).toBe(scriptContent);

    const manifest = (await (await storage.get(manifestKey('myapp', 'published')))!.json()) as WorkerManifest;
    expect(manifest.mainModule).toBe('worker.js');
    expect(manifest.modules).toEqual(['worker.js']);
  });
});

describe('deleteWorkerScript', () => {
  it('returns true and removes modules + manifest when the worker existed', async () => {
    await uploadWorkerScript(TEST_CONFIG, 'app-myapp', [], {
      modules: [
        { name: '_entry.js', content: 'export default {}', type: 'esm' },
        { name: 'handlers/foo.js', content: 'export default () => {}', type: 'esm' },
      ],
      mainModule: '_entry.js',
    });

    const storage = new FsStorageAdapter();
    expect(await storage.head(manifestKey('myapp', 'published'))).not.toBeNull();

    const removed = await deleteWorkerScript(TEST_CONFIG, 'app-myapp');
    expect(removed).toBe(true);

    // Manifest + modules are gone.
    expect(await storage.head(manifestKey('myapp', 'published'))).toBeNull();
    expect(await storage.head(`${modulesPrefix('myapp', 'published')}/_entry.js`)).toBeNull();
    expect(await storage.head(`${modulesPrefix('myapp', 'published')}/handlers/foo.js`)).toBeNull();
  });

  it('returns false when nothing was deployed', async () => {
    const removed = await deleteWorkerScript(TEST_CONFIG, 'app-ghost');
    expect(removed).toBe(false);
  });
});

describe('listWorkerScripts', () => {
  it('finds the uploaded manifest by its scriptName id', async () => {
    await uploadWorkerScript(TEST_CONFIG, 'app-myapp', [], {
      scriptContent: 'export default {}',
    });
    await uploadWorkerScript(TEST_CONFIG, 'app-preview-otherapp', [], {
      scriptContent: 'export default {}',
    });

    const scripts = await listWorkerScripts(TEST_CONFIG);
    const ids = scripts.map((s) => s.id).sort();
    expect(ids).toEqual(['app-myapp', 'app-preview-otherapp']);
  });

  it('returns an empty list when nothing is deployed', async () => {
    expect(await listWorkerScripts(TEST_CONFIG)).toEqual([]);
  });
});

describe('createAppBackendBindings', () => {
  const baseOpts = {
    d1DatabaseId: 'db-123',
    appId: 'my-app',
    appAlias: 'my',
    configBucketName: 'exepad-published',
    deployMode: 'preview' as const,
  };

  it('includes base bindings (DB, CONFIG_CACHE, DEPLOY_MODE, APP_ID, APP_ALIAS, PLATFORM)', () => {
    const bindings = createAppBackendBindings(baseOpts);

    expect(bindings).toEqual(
      expect.arrayContaining([
        { type: 'd1', name: 'DB', id: 'db-123' },
        { type: 'r2_bucket', name: 'CONFIG_CACHE', bucket_name: 'exepad-published' },
        { type: 'plain_text', name: 'DEPLOY_MODE', text: 'preview' },
        { type: 'plain_text', name: 'APP_ID', text: 'my-app' },
        { type: 'plain_text', name: 'APP_ALIAS', text: 'my' },
        { type: 'service', name: 'PLATFORM', service: 'exepad-runtime' },
      ])
    );
    expect(bindings).toHaveLength(6);
  });

  it('does not emit an INJECTED_CONFIG plain_text binding', () => {
    const bindings = createAppBackendBindings(baseOpts);
    expect(bindings.find((b) => b.name === 'INJECTED_CONFIG')).toBeUndefined();
  });

  it('adds SERVICE_TOKEN binding when serviceToken is provided', () => {
    const bindings = createAppBackendBindings({
      ...baseOpts,
      serviceToken: 'secret-token',
    });

    const stBinding = bindings.find((b) => b.name === 'SERVICE_TOKEN');
    expect(stBinding).toEqual({
      type: 'plain_text',
      name: 'SERVICE_TOKEN',
      text: 'secret-token',
    });
  });

  it('adds ENVIRONMENT and PLATFORM_INTERNAL_SECRET bindings when provided', () => {
    const bindings = createAppBackendBindings({
      ...baseOpts,
      environment: 'production',
      platformInternalSecret: 'platform-secret',
    });

    expect(bindings.find((b) => b.name === 'ENVIRONMENT')).toEqual({
      type: 'plain_text',
      name: 'ENVIRONMENT',
      text: 'production',
    });
    expect(bindings.find((b) => b.name === 'PLATFORM_INTERNAL_SECRET')).toEqual({
      type: 'plain_text',
      name: 'PLATFORM_INTERNAL_SECRET',
      text: 'platform-secret',
    });
  });

  it('adds RATE_LIMIT_KV binding when rateLimitKvNamespaceId is provided', () => {
    const bindings = createAppBackendBindings({
      ...baseOpts,
      rateLimitKvNamespaceId: 'kv-ns-123',
    });

    const kvBinding = bindings.find((b) => b.name === 'RATE_LIMIT_KV');
    expect(kvBinding).toEqual({
      type: 'kv_namespace',
      name: 'RATE_LIMIT_KV',
      namespace_id: 'kv-ns-123',
    });
  });

  it('adds ANALYTICS binding when analyticsDatasetId is provided', () => {
    const bindings = createAppBackendBindings({
      ...baseOpts,
      analyticsDatasetId: 'ds-456',
    });

    const analyticsBinding = bindings.find((b) => b.name === 'ANALYTICS');
    expect(analyticsBinding).toEqual({
      type: 'analytics_engine',
      name: 'ANALYTICS',
      dataset: 'ds-456',
    });
  });
});
