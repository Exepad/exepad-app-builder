import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  saveDeploymentStatus,
  loadDeploymentStatus,
  readAppConfig,
  readRepoModules,
  readWorkerTemplate,
  writePublishedSnapshot,
  validatePublishedManifest,
} from '../../../worker/src/lib/r2-helpers';
import type { DeploymentStatus } from '@exepad/types';

// Mock image-capture to avoid real fetch in r2-helpers tests
vi.mock('../../../worker/src/lib/image-capture', () => ({
  captureAndRewriteImages: vi.fn(async (_r2: any, _appId: string, config: Record<string, unknown>) => ({
    captured: [],
    failed: [],
    rewrittenConfig: config,
  })),
}));

// ---------------------------------------------------------------------------
// Mock R2Bucket
// ---------------------------------------------------------------------------

function createMockR2Bucket(files: Record<string, string> = {}) {
  const stored: Record<string, string> = { ...files };
  return {
    get: vi.fn(async (key: string) => {
      const content = stored[key];
      if (!content) return null;
      return {
        text: async () => content,
        json: async () => JSON.parse(content),
        arrayBuffer: async () => new TextEncoder().encode(content).buffer,
        body: new ReadableStream(),
      };
    }),
    put: vi.fn(async (key: string, value: any) => {
      if (value instanceof ArrayBuffer) {
        stored[key] = new TextDecoder().decode(new Uint8Array(value));
      } else if (typeof value === 'string') {
        stored[key] = value;
      } else {
        stored[key] = 'binary';
      }
    }),
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => ({ objects: [], truncated: false, delimitedPrefixes: [] })),
    head: vi.fn(async (key: string) =>
      stored[key] ? { key, size: stored[key].length } : null,
    ),
  } as unknown as R2Bucket;
}

// ---------------------------------------------------------------------------
// saveDeploymentStatus
// ---------------------------------------------------------------------------

describe('saveDeploymentStatus', () => {
  it('writes correct R2 key with mode and sets updatedAt', async () => {
    const r2 = createMockR2Bucket();
    const status: DeploymentStatus = {
      appId: 'app1',
      mode: 'preview',
      status: 'success',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await saveDeploymentStatus(r2, status);

    expect(r2.put).toHaveBeenCalledTimes(1);
    const [key, body, opts] = (r2.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(key).toBe('app1/deployment-status-preview.json');
    const parsed = JSON.parse(body);
    expect(parsed.appId).toBe('app1');
    expect(parsed.mode).toBe('preview');
    expect(parsed.updatedAt).toBeDefined();
    // updatedAt is overwritten with current time
    expect(parsed.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
    expect(opts.httpMetadata.contentType).toBe('application/json');
  });

  it('writes published mode key correctly', async () => {
    const r2 = createMockR2Bucket();
    const status: DeploymentStatus = {
      appId: 'myapp',
      mode: 'published',
      status: 'in_progress',
      updatedAt: '',
    };

    await saveDeploymentStatus(r2, status);

    const [key] = (r2.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(key).toBe('myapp/deployment-status-published.json');
  });

  it('preserves all status fields in the written JSON', async () => {
    const r2 = createMockR2Bucket();
    const status: DeploymentStatus = {
      appId: 'app1',
      mode: 'preview',
      status: 'failed',
      error: 'Migration error',
      step: 'schema',
      updatedAt: '',
    };

    await saveDeploymentStatus(r2, status);

    const [, body] = (r2.put as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed = JSON.parse(body);
    expect(parsed.error).toBe('Migration error');
    expect(parsed.step).toBe('schema');
  });
});

// ---------------------------------------------------------------------------
// loadDeploymentStatus
// ---------------------------------------------------------------------------

describe('loadDeploymentStatus', () => {
  it('returns parsed status when found', async () => {
    const statusJson = JSON.stringify({
      appId: 'app1',
      mode: 'preview',
      status: 'success',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const r2 = createMockR2Bucket({
      'app1/deployment-status-preview.json': statusJson,
    });

    const result = await loadDeploymentStatus(r2, 'app1', 'preview');
    expect(result).not.toBeNull();
    expect(result!.appId).toBe('app1');
    expect(result!.status).toBe('success');
  });

  it('returns null when missing', async () => {
    const r2 = createMockR2Bucket();
    const result = await loadDeploymentStatus(r2, 'app1', 'preview');
    expect(result).toBeNull();
  });

  it('constructs the correct key from appId and mode', async () => {
    const r2 = createMockR2Bucket();
    await loadDeploymentStatus(r2, 'my-app', 'published');

    expect(r2.get).toHaveBeenCalledWith('my-app/deployment-status-published.json');
  });
});

// ---------------------------------------------------------------------------
// readAppConfig
// ---------------------------------------------------------------------------

describe('readAppConfig', () => {
  it('returns parsed config', async () => {
    const configJson = JSON.stringify({ pages: [{ id: 'home' }] });
    const r2 = createMockR2Bucket({
      'app1/repo/app_configs/config_abc.json': configJson,
    });

    const config = await readAppConfig(r2, 'app1/repo/app_configs/config_abc.json');
    expect(config).toEqual({ pages: [{ id: 'home' }] });
  });

  it('throws on missing config', async () => {
    const r2 = createMockR2Bucket();
    await expect(readAppConfig(r2, 'app1/missing.json')).rejects.toThrow(
      'Config not found in R2: app1/missing.json',
    );
  });
});

// ---------------------------------------------------------------------------
// readRepoModules
// ---------------------------------------------------------------------------

describe('readRepoModules', () => {
  it('reads .js files and extracts method names from paths', async () => {
    const r2 = createMockR2Bucket({
      'app1/repo/handlers/getStats_d41d8cd98f00.js': 'export default function getStats(){}',
      'app1/repo/handlers/createOrder_abcdef123456.js': 'export default function createOrder(){}',
    });

    const result = await readRepoModules(r2, 'app1', [
      'repo/handlers/getStats_d41d8cd98f00.js',
      'repo/handlers/createOrder_abcdef123456.js',
    ]);

    expect(result.size).toBe(2);
    expect(result.get('getStats')).toContain('getStats');
    expect(result.get('createOrder')).toContain('createOrder');
  });

  it('returns empty map for empty paths array', async () => {
    const r2 = createMockR2Bucket();
    const result = await readRepoModules(r2, 'app1', []);
    expect(result.size).toBe(0);
    expect(r2.get).not.toHaveBeenCalled();
  });

  it('throws when a required module is missing (no .tsx fallback either)', async () => {
    const r2 = createMockR2Bucket();
    await expect(
      readRepoModules(r2, 'app1', ['repo/handlers/missing_abc123.js']),
    ).rejects.toThrow('Handler not found in R2');
  });

  it('throws with compile hint when .tsx source exists but .js is missing', async () => {
    const r2 = createMockR2Bucket({
      'app1/repo/handlers/myHandler_abc123.tsx': 'export default async (ctx) => {};',
    });

    await expect(
      readRepoModules(r2, 'app1', ['repo/handlers/myHandler_abc123.js']),
    ).rejects.toThrow('compiled .js is missing');
  });

  it('strips hash suffix from filename to derive method name', async () => {
    const r2 = createMockR2Bucket({
      'app1/repo/handlers/doWork_aabbccddee11.js': 'export default () => {};',
    });

    const result = await readRepoModules(r2, 'app1', [
      'repo/handlers/doWork_aabbccddee11.js',
    ]);

    expect(result.has('doWork')).toBe(true);
  });

  it('derives method names from published files without hashed filenames', async () => {
    const r2 = createMockR2Bucket({
      'app1/published/releases/release-1/handlers/doWork.js': 'export default () => {};',
    });

    const result = await readRepoModules(r2, 'app1', [
      'published/releases/release-1/handlers/doWork.js',
    ]);

    expect(result.has('doWork')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readWorkerTemplate
// ---------------------------------------------------------------------------

describe('readWorkerTemplate', () => {
  it('reads pointer then template, returns content and sha', async () => {
    const pointer = JSON.stringify({
      path: '_system/worker-template-v42.js',
      sha: 'sha256:deadbeef',
      builtAt: '2026-01-01T00:00:00.000Z',
    });
    const templateCode = 'export default { async fetch(req) { return new Response("ok"); } }';

    const r2 = createMockR2Bucket({
      '_system/worker-template-latest.json': pointer,
      '_system/worker-template-v42.js': templateCode,
    });

    const result = await readWorkerTemplate(r2);
    expect(result.content).toBe(templateCode);
    expect(result.sha).toBe('sha256:deadbeef');
  });

  it('returns an empty stub when the pointer is missing (self-host: app-backend is in-process)', async () => {
    const r2 = createMockR2Bucket();
    const result = await readWorkerTemplate(r2);
    expect(result.content).toBe('');
    expect(result.sha).toBe('none');
  });

  it('throws when template file referenced by pointer is missing', async () => {
    const pointer = JSON.stringify({
      path: '_system/worker-template-v99.js',
      sha: 'sha256:abc',
      builtAt: '2026-01-01T00:00:00.000Z',
    });
    const r2 = createMockR2Bucket({
      '_system/worker-template-latest.json': pointer,
    });

    await expect(readWorkerTemplate(r2)).rejects.toThrow(
      'Worker template not found at _system/worker-template-v99.js',
    );
  });
});

// ---------------------------------------------------------------------------
// writePublishedSnapshot
// ---------------------------------------------------------------------------

describe('writePublishedSnapshot', () => {
  it('copies handlers, components, seed, writes config and manifest LAST', async () => {
    const handlerJs = 'export function getStats(ctx){return ctx.params;}';
    const componentJs = 'export default function MyWidget(){return null;}';
    const seedCsv = 'name,value\nfoo,bar';

    const r2 = createMockR2Bucket({
      'app1/repo/handlers/getStats_abc123.js': handlerJs,
      'app1/repo/components/my_widget_def456.js': componentJs,
      'app1/repo/seed/products.csv': seedCsv,
    });

    const appConfig = {
      title: 'Test App',
      repo: {
        components: {
          my_widget: {
            compiled: 'repo/components/my_widget_def456.js',
            type: 'component',
          },
        },
        seed: {
          products: {
            source: 'repo/seed/products.csv',
            format: 'csv',
            model: 'products',
          },
        },
      },
    };

    const repoMethods: Record<string, any> = {
      getStats: {
        compiled: 'repo/handlers/getStats_abc123.js',
        type: 'handler',
      },
    };

    await writePublishedSnapshot(r2, 'app1', appConfig, repoMethods);

    const putCalls = (r2.put as ReturnType<typeof vi.fn>).mock.calls;
    const putKeys = putCalls.map((c: any[]) => c[0]);

    // Handler copied with camelCase name
    expect(putKeys).toContain('app1/published/handlers/getStats.js');
    // Component copied with kebab-case name (snake_case -> kebab-case)
    expect(putKeys).toContain('app1/published/components/my-widget.js');
    // Seed data copied
    expect(putKeys).toContain('app1/published/seed/products.csv');
    // App config written
    expect(putKeys).toContain('app1/published/app-config.json');
    // Manifest written LAST
    expect(putKeys).toContain('app1/published/_manifest.json');
    const manifestIdx = putKeys.indexOf('app1/published/_manifest.json');
    expect(manifestIdx).toBe(putKeys.length - 1);
  });

  it('handles empty repo methods and components', async () => {
    const r2 = createMockR2Bucket();
    const appConfig = { title: 'Empty App' };

    await writePublishedSnapshot(r2, 'app1', appConfig, {});

    const putCalls = (r2.put as ReturnType<typeof vi.fn>).mock.calls;
    const putKeys = putCalls.map((c: any[]) => c[0]);

    // Should still write config and manifest
    expect(putKeys).toContain('app1/published/app-config.json');
    expect(putKeys).toContain('app1/published/_manifest.json');
  });

  it('writes manifest with correct structure', async () => {
    const r2 = createMockR2Bucket({
      'app1/repo/handlers/doWork_abc.js': 'code',
    });

    const repoMethods = {
      doWork: { compiled: 'repo/handlers/doWork_abc.js', type: 'handler' },
    };

    await writePublishedSnapshot(r2, 'app1', { title: 'App' }, repoMethods);

    const putCalls = (r2.put as ReturnType<typeof vi.fn>).mock.calls;
    const manifestCall = putCalls.find((c: any[]) => c[0] === 'app1/published/_manifest.json');
    expect(manifestCall).toBeDefined();

    // Manifest is written as ArrayBuffer, decode it
    const manifestBuf = manifestCall![1];
    let manifestStr: string;
    if (manifestBuf instanceof ArrayBuffer) {
      manifestStr = new TextDecoder().decode(new Uint8Array(manifestBuf));
    } else {
      manifestStr = manifestBuf;
    }
    const manifest = JSON.parse(manifestStr);

    expect(manifest.version).toBe(1);
    expect(manifest.appId).toBe('app1');
    expect(manifest.mode).toBe('published');
    expect(manifest.configSource).toBe('published/app-config.json');
    expect(manifest.createdAt).toBeDefined();
    expect(manifest.files).toBeDefined();
    expect(manifest.files['handlers/doWork.js']).toBeDefined();
    expect(manifest.files['handlers/doWork.js'].hash).toMatch(/^sha256:/);
  });

  it('writes seed data with correct content type', async () => {
    const r2 = createMockR2Bucket({
      'app1/repo/seed/data.json': '{"rows":[]}',
    });

    const appConfig = {
      repo: {
        seed: {
          data: {
            source: 'repo/seed/data.json',
            format: 'json',
            model: 'data',
          },
        },
      },
    };

    await writePublishedSnapshot(r2, 'app1', appConfig, {});

    const putCalls = (r2.put as ReturnType<typeof vi.fn>).mock.calls;
    const seedCall = putCalls.find((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('seed/data.json'),
    );
    expect(seedCall).toBeDefined();
  });

  it('rewrites published config to use published asset paths', async () => {
    const r2 = createMockR2Bucket({
      'app1/repo/handlers/getStats_abc123.js': 'export default async () => {};',
      'app1/repo/components/my_widget_def456.js': 'export default function MyWidget(){return null;}',
      'app1/frontend/compiled/styles/theme.css': '.theme { color: red; }',
      'app1/repo/seed/products.csv': 'name,value\nfoo,bar',
    });

    const appConfig = {
      repo: {
        backend: {
          handlers: {
            getStats: {
              compiled: 'repo/handlers/getStats_abc123.js',
              type: 'handler',
            },
          },
        },
        frontend: {
          components: {
            my_widget: {
              compiled: 'repo/components/my_widget_def456.js',
            },
          },
          styles: {
            theme: {
              compiled: 'frontend/compiled/styles/theme.css',
            },
          },
        },
        seed: {
          products: {
            source: 'repo/seed/products.csv',
            format: 'csv',
            model: 'products',
          },
        },
      },
    };

    const result = await writePublishedSnapshot(r2, 'app1', appConfig, {
      getStats: {
        compiled: 'repo/handlers/getStats_abc123.js',
        type: 'handler',
      },
    }, {
      prefix: 'published/releases/release-1',
    });

    expect(result.configPath).toBe('published/releases/release-1/app-config.json');

    const configPut = (r2.put as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: any[]) => c[0] === 'app1/published/releases/release-1/app-config.json',
    );
    expect(configPut).toBeDefined();

    const configValue = configPut![1];
    const configJson = configValue instanceof ArrayBuffer
      ? new TextDecoder().decode(new Uint8Array(configValue))
      : String(configValue);
    const writtenConfig = JSON.parse(configJson);

    expect(writtenConfig.repo.backend.handlers.getStats.compiled)
      .toBe('published/releases/release-1/handlers/getStats.js');
    expect(writtenConfig.repo.frontend.components.my_widget.compiled)
      .toBe('published/releases/release-1/components/my-widget.js');
    expect(writtenConfig.repo.frontend.styles.theme.compiled)
      .toBe('published/releases/release-1/styles/theme.css');
    expect(writtenConfig.repo.seed.products.source)
      .toBe('published/releases/release-1/seed/products.csv');
  });
});

// ---------------------------------------------------------------------------
// validatePublishedManifest
// ---------------------------------------------------------------------------

describe('validatePublishedManifest', () => {
  it('returns false when manifest is missing', async () => {
    const r2 = createMockR2Bucket();
    const result = await validatePublishedManifest(r2, 'app1');
    expect(result).toBe(false);
  });

  it('returns false when a listed file is missing', async () => {
    const manifest = JSON.stringify({
      version: 1,
      appId: 'app1',
      mode: 'published',
      configSource: 'published/app-config.json',
      createdAt: '2026-01-01T00:00:00.000Z',
      files: {
        'handlers/doWork.js': { hash: 'sha256:aabbccddee11', size: 10 },
      },
    });

    const r2 = createMockR2Bucket({
      'app1/published/_manifest.json': manifest,
      // Note: handlers/doWork.js is NOT in the bucket
    });

    const result = await validatePublishedManifest(r2, 'app1');
    expect(result).toBe(false);
  });

  it('returns false when hash mismatches', async () => {
    const manifest = JSON.stringify({
      version: 1,
      appId: 'app1',
      mode: 'published',
      configSource: 'published/app-config.json',
      createdAt: '2026-01-01T00:00:00.000Z',
      files: {
        'app-config.json': { hash: 'sha256:000000000000', size: 5 },
      },
    });

    const r2 = createMockR2Bucket({
      'app1/published/_manifest.json': manifest,
      'app1/published/app-config.json': '{"title":"App"}',
    });

    const result = await validatePublishedManifest(r2, 'app1');
    expect(result).toBe(false);
  });

  it('returns true when all files exist and hashes match', async () => {
    // Compute the actual hash for the content "hello"
    const content = 'hello';
    const buffer = new TextEncoder().encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 12);

    const manifest = JSON.stringify({
      version: 1,
      appId: 'app1',
      mode: 'published',
      configSource: 'published/app-config.json',
      createdAt: '2026-01-01T00:00:00.000Z',
      files: {
        'test-file.js': { hash: `sha256:${hashHex}`, size: content.length },
      },
    });

    const r2 = createMockR2Bucket({
      'app1/published/_manifest.json': manifest,
      'app1/published/test-file.js': content,
    });

    const result = await validatePublishedManifest(r2, 'app1');
    expect(result).toBe(true);
  });
});
