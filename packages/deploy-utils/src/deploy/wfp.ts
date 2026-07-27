/**
 * Local app-backend "deployment".
 *
 * NOT Workers-for-Platforms — that is the era this module's names come from, not
 * what it does. Self-host has no per-app worker to push: the app-backend is
 * imported and dispatched IN-PROCESS by the runtime gateway. "Deploying" an app
 * means writing its compiled ES modules (template + entry + handlers) to storage
 * and recording a small manifest the runtime reads to know the app is live.
 * The WfP-shaped identifiers (`uploadWorkerScript`, `app-…`/`app-preview-…`
 * script names, `worker-manifest.json`) are kept deliberately: they are the
 * on-disk contract the deploy/deprovision routes and existing /data volumes
 * already speak, so renaming them would break live installs for no gain.
 *
 * Modules land at `{appId}/{mode}/modules/{name}` and the manifest at
 * `{appId}/{mode}/worker-manifest.json` (under the CONFIG_CACHE storage root).
 *
 * `createAppBackendBindings` and the `WorkerBinding` union below are retained for
 * SIGNATURE parity only. Nothing consumes the array they produce:
 * `uploadWorkerScript` ignores its `_bindings` argument, and the env the
 * in-process app-backend actually receives is assembled by
 * `apps/runtime/worker/src/server/build-user-env.ts`.
 */

import { FsStorageAdapter } from '@exepad/local-adapters/storage';
import type { DeploymentConfig } from './types';

/** Worker script info (compat shape; ids/etags are local synthetic values). */
interface WorkerScriptInfo {
  id: string;
  tag: string;
  etag: string;
  created_on: string;
  modified_on: string;
}

/** A named ES module previously uploaded to WfP; now written to storage. */
export interface WorkerModule {
  name: string; // '_entry.js', 'template.js', 'handlers/getStats.js'
  content: string;
  type: 'esm' | 'text' | 'json';
}

/** Deploy manifest persisted per app+mode so the runtime can resolve modules. */
export interface WorkerManifest {
  scriptName: string;
  appId: string;
  mode: 'preview' | 'published';
  mainModule: string;
  modules: string[];
  updatedAt: string;
}

/** Parse a WfP-style script name back into {appId, mode}. */
function parseScriptName(scriptName: string): { appId: string; mode: 'preview' | 'published' } {
  if (scriptName.startsWith('app-preview-')) {
    return { appId: scriptName.slice('app-preview-'.length), mode: 'preview' };
  }
  if (scriptName.startsWith('app-')) {
    return { appId: scriptName.slice('app-'.length), mode: 'published' };
  }
  return { appId: scriptName, mode: 'published' };
}

const MODULES_PREFIX = (appId: string, mode: string) => `${appId}/${mode}/modules`;
const MANIFEST_KEY = (appId: string, mode: string) => `${appId}/${mode}/worker-manifest.json`;

const MIME: Record<WorkerModule['type'], string> = {
  esm: 'application/javascript+module',
  text: 'text/plain',
  json: 'application/json',
};

/**
 * "Upload" a app-backend by writing its modules + manifest to storage.
 *
 * Single-module: pass `scriptContent`. Multi-module: pass `modules[]` +
 * `mainModule`. Returns a synthetic WorkerScriptInfo.
 */
export async function uploadWorkerScript(
  _config: DeploymentConfig,
  scriptName: string,
  _bindings: WorkerBinding[],
  options: {
    scriptContent?: string;
    modules?: WorkerModule[];
    mainModule?: string;
  },
): Promise<WorkerScriptInfo> {
  const { appId, mode } = parseScriptName(scriptName);
  const storage = new FsStorageAdapter();

  let modules: WorkerModule[];
  let mainModule: string;
  if (options.modules && options.mainModule) {
    modules = options.modules;
    mainModule = options.mainModule;
  } else {
    modules = [{ name: 'worker.js', content: options.scriptContent ?? '', type: 'esm' }];
    mainModule = 'worker.js';
  }

  // Write-then-prune (NOT delete-then-write): for `published` mode this mutates
  // the LIVE app's modules. Deleting the whole prefix first left a window where a
  // crash — or an in-flight request — saw an EMPTY module tree while the manifest
  // still advertised the previous deploy, breaking every handler dispatch until a
  // full re-deploy. Instead we (1) write all new modules (overwriting by name so
  // the tree is never empty), (2) flip the manifest to the new module set, then
  // (3) delete only the stale leftovers no longer referenced.
  const prefix = MODULES_PREFIX(appId, mode);
  const newNames = new Set(modules.map((m) => m.name));

  // Snapshot the existing module keys BEFORE writing, to know what to prune.
  let existingKeys: string[] = [];
  try {
    const listed = await storage.list({ prefix: `${prefix}/` });
    existingKeys = listed.objects.map((o) => o.key);
  } catch {
    /* first deploy — nothing to prune */
  }

  // (1) Write/overwrite the new modules. The old files stay in place until each
  // is overwritten, so the tree always has a complete, servable module set.
  for (const mod of modules) {
    await storage.put(`${prefix}/${mod.name}`, mod.content, {
      httpMetadata: { contentType: MIME[mod.type] },
    });
  }

  // (2) Flip the manifest to the new module set (atomic single-object write).
  const now = new Date().toISOString();
  const manifest: WorkerManifest = {
    scriptName,
    appId,
    mode,
    mainModule,
    modules: modules.map((m) => m.name),
    updatedAt: now,
  };
  await storage.put(MANIFEST_KEY(appId, mode), JSON.stringify(manifest), {
    httpMetadata: { contentType: 'application/json' },
  });

  // (3) Prune stale modules from a prior deploy that the new manifest no longer
  // references (e.g. a removed handler). Best-effort — a leftover file is inert
  // once the manifest stops listing it, so a prune failure must not fail the deploy.
  for (const key of existingKeys) {
    const name = key.slice(prefix.length + 1);
    if (!newNames.has(name)) {
      await storage.delete(key).catch(() => {
        /* inert leftover — ignore */
      });
    }
  }

  return { id: scriptName, tag: '', etag: '', created_on: now, modified_on: now };
}

/**
 * "Delete" a app-backend: remove its modules + manifest.
 * Returns false if the app wasn't deployed (no manifest).
 */
export async function deleteWorkerScript(
  _config: DeploymentConfig,
  scriptName: string,
): Promise<boolean> {
  const { appId, mode } = parseScriptName(scriptName);
  const storage = new FsStorageAdapter();
  const existed = (await storage.head(MANIFEST_KEY(appId, mode))) !== null;
  await storage.deletePrefix(MODULES_PREFIX(appId, mode));
  await storage.delete(MANIFEST_KEY(appId, mode));
  return existed;
}

/** List every deployed app-backend by scanning for manifests. */
export async function listWorkerScripts(_config: DeploymentConfig): Promise<WorkerScriptInfo[]> {
  const storage = new FsStorageAdapter();
  const listed = await storage.list({ prefix: '' });
  const out: WorkerScriptInfo[] = [];
  for (const obj of listed.objects) {
    if (!obj.key.endsWith('/worker-manifest.json')) continue;
    const file = await storage.get(obj.key);
    if (!file) continue;
    try {
      const manifest = (await file.json()) as WorkerManifest;
      const ts = obj.uploaded.toISOString();
      out.push({ id: manifest.scriptName, tag: '', etag: obj.etag, created_on: ts, modified_on: ts });
    } catch {
      /* skip malformed manifest */
    }
  }
  return out;
}

/**
 * Worker binding types
 */
export type WorkerBinding =
  | D1Binding
  | KVBinding
  | R2Binding
  | ServiceBinding
  | TextBinding
  | JsonBinding
  | AnalyticsEngineBinding;

export interface D1Binding {
  type: 'd1';
  name: string;
  id: string;
}

export interface KVBinding {
  type: 'kv_namespace';
  name: string;
  namespace_id: string;
}

export interface R2Binding {
  type: 'r2_bucket';
  name: string;
  bucket_name: string;
}

export interface ServiceBinding {
  type: 'service';
  name: string;
  service: string;
  environment?: string;
}

export interface TextBinding {
  type: 'plain_text';
  name: string;
  text: string;
}

export interface JsonBinding {
  type: 'json';
  name: string;
  json: unknown;
}

export interface AnalyticsEngineBinding {
  type: 'analytics_engine';
  name: string;
  dataset: string;
}

/**
 * Create bindings for app backend
 */
export function createAppBackendBindings(options: {
  d1DatabaseId: string;
  appId: string;
  appAlias: string;
  /** R2 bucket name holding app-config.json (read at app-backend cold start) */
  configBucketName: string;
  /** Deploy mode — determines which deployment-status file the app-backend reads */
  deployMode: 'preview' | 'published';
  environment?: string;
  rateLimitKvNamespaceId?: string;
  analyticsDatasetId?: string;
  serviceToken?: string;
  platformInternalSecret?: string;
  r2BucketName?: string;
  /**
   * Name stamped into the inert PLATFORM service binding. Self-host resolves no
   * service bindings, so this value is never read at runtime — see the note at
   * the emit site below. No caller passes it.
   */
  platformService?: string;
}): WorkerBinding[] {
  const bindings: WorkerBinding[] = [
    {
      type: 'd1',
      name: 'DB',
      id: options.d1DatabaseId,
    },
    {
      type: 'r2_bucket',
      name: 'CONFIG_CACHE',
      bucket_name: options.configBucketName,
    },
    {
      type: 'plain_text',
      name: 'DEPLOY_MODE',
      text: options.deployMode,
    },
    {
      type: 'plain_text',
      name: 'APP_ID',
      text: options.appId,
    },
    {
      type: 'plain_text',
      name: 'APP_ALIAS',
      text: options.appAlias,
    },
  ];

  if (options.environment) {
    bindings.push({
      type: 'plain_text',
      name: 'ENVIRONMENT',
      text: options.environment,
    });
  }

  // Rate limiting KV (H3) — opt-in
  if (options.rateLimitKvNamespaceId) {
    bindings.push({
      type: 'kv_namespace',
      name: 'RATE_LIMIT_KV',
      namespace_id: options.rateLimitKvNamespaceId,
    });
  }

  // Analytics Engine (L3) — opt-in
  if (options.analyticsDatasetId) {
    bindings.push({
      type: 'analytics_engine',
      name: 'ANALYTICS',
      dataset: options.analyticsDatasetId,
    });
  }

  // Service token for service-to-service auth
  if (options.serviceToken) {
    bindings.push({
      type: 'plain_text',
      name: 'SERVICE_TOKEN',
      text: options.serviceToken,
    });
  }

  if (options.platformInternalSecret) {
    bindings.push({
      type: 'plain_text',
      name: 'PLATFORM_INTERNAL_SECRET',
      text: options.platformInternalSecret,
    });
  }

  // R2 bucket for file storage
  if (options.r2BucketName) {
    bindings.push({
      type: 'r2_bucket',
      name: 'R2_FILES',
      bucket_name: options.r2BucketName,
    });
  }

  // PLATFORM service binding — INERT on self-host. Nothing resolves service
  // bindings here: `uploadWorkerScript` discards this whole array, and the
  // app-backend reaches the runtime's email proxy over HTTP via `PLATFORM_URL`
  // (build-user-env.ts), because `env.PLATFORM` is never populated — see
  // `buildPlatformFetcher` in apps/app-backend/src/services/email.ts.
  //
  // The name is a label only — nothing resolves it — so it just needs to match
  // the current project naming rather than the retired pre-rename identifier.
  const platformService = options.platformService || 'exepad-runtime';
  bindings.push({
    type: 'service',
    name: 'PLATFORM',
    service: platformService,
  });

  return bindings;
}
