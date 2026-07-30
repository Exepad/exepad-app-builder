/**
 * Mock Env and KV for tests
 */

import type { Env, InjectedProps, ModelProps, HandlerProps } from '../../src/types/env';
import { createMockD1 } from './mock-d1';
import { __resetConfigCacheForTests } from '../../src/context/config-loader';

interface MockKVStore {
  store: Map<string, string>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<{ keys: { name: string }[] }>;
  getWithMetadata<T = unknown>(key: string): Promise<{ value: string | null; metadata: T | null }>;
}

/**
 * Create a mock KV namespace
 */
export function createMockKV(): KVNamespace & { _store: Map<string, string> } {
  const store = new Map<string, string>();

  return {
    _store: store,
    async get(key: string, format?: string) {
      const raw = store.get(key) ?? null;
      if (raw !== null && format === 'json') {
        try { return JSON.parse(raw); } catch { return null; }
      }
      return raw;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return {
        keys: Array.from(store.keys()).map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      };
    },
    async getWithMetadata(key: string) {
      return { value: store.get(key) ?? null, metadata: null, cacheStatus: null };
    },
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

/**
 * Build a minimal `InjectedProps` for passing into `createMockEnv` via
 * the `configProps` key. The mock R2 bucket then serves a WebAppProps
 * envelope containing these props so `loadConfig` → `extractBackendProps`
 * round-trips them back into `InjectedProps` unchanged.
 */
export function createMockConfig(
  models: ModelProps[] = [],
  handlers: HandlerProps[] = []
): InjectedProps {
  return { models, handlers };
}

// Monotonic counter — every R2 object gets a unique ETag so the loader's
// module-scoped cache auto-invalidates across tests.
let mockEtagCounter = 0;

/**
 * Build a mock R2 bucket that serves a status pointer + a full WebAppProps
 * containing the given injected props. `loadConfig` reads
 * `{appId}/deployment-status-{mode}.json` → follows `configPath` →
 * reads `{appId}/{configPath}` → runs `extractBackendProps` → validates.
 */
function createMockConfigCache(
  appId: string,
  mode: 'preview' | 'published',
  props: InjectedProps,
): R2Bucket {
  const etag = `mock-etag-${++mockEtagCounter}`;
  const statusKey = `${appId}/deployment-status-${mode}.json`;
  const configKey = `${appId}/published/app-config.json`;

  const statusBody = JSON.stringify({ configPath: 'published/app-config.json' });
  const appConfigBody = JSON.stringify({
    backend: {
      mode: 'dynamic',
      models: props.models ?? [],
      handlers: props.handlers ?? [],
      storage: props.storage,
    },
    security: props.security,
    // Reverse-derive the `services` map from `enabledServices` + `serviceConfigs`
    // so tests that set either get a faithful round-trip through extractBackendProps.
    services: (() => {
      const out: Record<string, unknown> = {};
      const enabled = props.enabledServices ?? {};
      const cfgs = (props.serviceConfigs ?? {}) as Record<string, unknown>;
      for (const name of new Set([...Object.keys(enabled), ...Object.keys(cfgs)])) {
        const cfg = cfgs[name];
        out[name] = {
          ...(cfg && typeof cfg === 'object' ? cfg : {}),
          enabled: enabled[name] ?? (cfg && (cfg as { enabled?: boolean }).enabled) ?? false,
        };
      }
      return Object.keys(out).length > 0 ? out : undefined;
    })(),
  });

  function makeR2Object(body: string): R2ObjectBody {
    const encoder = new TextEncoder();
    return {
      key: '',
      version: '1',
      size: body.length,
      etag,
      httpEtag: `"${etag}"`,
      checksums: {} as R2Checksums,
      uploaded: new Date(),
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {},
      range: undefined,
      storageClass: 'Standard',
      ssecKeyMd5: undefined,
      async text() { return body; },
      async json<T>() { return JSON.parse(body) as T; },
      async arrayBuffer() { return encoder.encode(body).buffer as ArrayBuffer; },
      async blob() { return new Blob([body]); },
      async bytes() { return encoder.encode(body); },
      body: null as unknown as ReadableStream,
      bodyUsed: false,
      writeHttpMetadata() {},
    } as unknown as R2ObjectBody;
  }

  return {
    async get(key: string) {
      if (key === statusKey) return makeR2Object(statusBody);
      if (key === configKey) return makeR2Object(appConfigBody);
      return null;
    },
    async head() { return null; },
    async put() { return null as unknown as R2Object; },
    async delete() {},
    async list() {
      return { objects: [], truncated: false, delimitedPrefixes: [] } as unknown as R2Objects;
    },
    async createMultipartUpload() { throw new Error('not mocked'); },
    async resumeMultipartUpload() { throw new Error('not mocked'); },
  } as unknown as R2Bucket;
}

/**
 * Create a complete mock Env.
 *
 * `configProps` seeds a mock `CONFIG_CACHE` R2 bucket that serves a
 * WebAppProps envelope around those props. Tests needing full control over
 * the bucket can pass `CONFIG_CACHE` directly in `overrides`.
 *
 * Resets the `config-loader` module-scoped cache on every call so each
 * test starts from a clean slate — a test that calls `loadConfig(envA)`
 * followed by `loadConfig(envB)` will always re-read from R2 for envB.
 */
export function createMockEnv(
  overrides?: Partial<Env> & { configProps?: InjectedProps }
): Env {
  __resetConfigCacheForTests();
  const { configProps, ...envOverrides } = overrides ?? {};

  const appId = envOverrides.APP_ID ?? 'test-app';
  const deployMode = envOverrides.DEPLOY_MODE ?? 'preview';
  const props: InjectedProps = configProps ?? { models: [], handlers: [] };
  const configCache =
    envOverrides.CONFIG_CACHE ?? createMockConfigCache(appId, deployMode, props);

  return {
    DB: createMockD1(),
    APP_ID: appId,
    APP_ALIAS: 'test',
    DEPLOY_MODE: deployMode,
    CONFIG_CACHE: configCache,
    ...envOverrides,
  };
}

/**
 * Standard test model for reuse across tests
 */
export const TEST_MODEL: ModelProps = {
  uuid: 'test-model-uuid',
  name: 'contacts',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'name', type: 'text' },
    { name: 'email', type: 'text', isUnique: true },
    { name: 'phone', type: 'text', isNullable: true },
    { name: 'age', type: 'integer', isNullable: true },
    { name: 'metadata', type: 'json', isNullable: true },
  ],
};

/**
 * Test model with soft delete
 */
export const TEST_MODEL_SOFT_DELETE: ModelProps = {
  ...TEST_MODEL,
  uuid: 'test-model-soft-delete',
  name: 'tasks',
  softDelete: true,
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'title', type: 'text' },
    { name: 'done', type: 'integer', isNullable: true },
    { name: 'deleted_at', type: 'text', isNullable: true },
  ],
};

/**
 * Test model with shared owner scope
 */
export const TEST_MODEL_SHARED: ModelProps = {
  ...TEST_MODEL,
  uuid: 'test-model-shared',
  name: 'announcements',
  ownerScope: 'shared',
};

/**
 * Standard authenticated test user
 */
export const TEST_USER = {
  id: 'user-123',
  email: 'test@example.com',
  roles: [] as string[],
  isAuthenticated: true,
};

/**
 * Admin test user
 */
export const TEST_ADMIN = {
  id: 'admin-1',
  email: 'admin@example.com',
  roles: ['admin'],
  isAuthenticated: true,
};

/**
 * Unauthenticated user
 */
export const TEST_ANON = {
  id: '',
  email: '',
  roles: [] as string[],
  isAuthenticated: false,
};
