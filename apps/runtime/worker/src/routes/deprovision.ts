/**
 * App Deprovision Endpoint
 *
 * Permanently removes all Cloudflare resources for a given app:
 * - R2 objects in CONFIG_CACHE under {appId}/ prefix
 * - D1 databases (published + preview)
 * - WfP worker scripts (published + preview)
 * - R2 file-storage bucket
 *
 * Security: X-Deploy-Secret header (same as deploy endpoint),
 * strict appId format validation, rate limited, scoped deletion only.
 */

import { Hono } from 'hono';
import type { Env } from '../types/env';
import {
  getD1Database,
  deleteD1Database,
  deleteWorkerScript,
  deleteR2Bucket,
  listD1Databases,
  listWorkerScripts,
} from '@exepad/deploy-utils';
import type { DeploymentConfig } from '@exepad/deploy-utils';
import { deleteR2ObjectsByPrefix } from '../lib/r2-helpers';
import { constantTimeEqual } from '../lib/crypto-utils';
import { invalidateConfig } from '../lib/app-config';
import { invalidateGatewayConfig } from './gateway/config';

export const deprovision = new Hono<{ Bindings: Env }>();

/** Only allow alphanumeric public IDs (8-16 chars) */
const VALID_APP_ID_RE = /^[a-z0-9]{8,16}$/;

interface DeprovisionResult {
  success: boolean;
  appId: string;
  cleaned: {
    r2Objects: number;
    d1Databases: string[];
    workerScripts: string[];
    r2Buckets: string[];
  };
  errors: string[];
  duration: number;
}

/**
 * Tear down every storage resource an app owns: FS storage under `{appId}/`,
 * its per-mode SQLite databases, and its file-storage bucket. (In self-host the
 * D1/WfP calls resolve to local SQLite-file + no-op branches in deploy-utils.)
 *
 * Does NOT remove the app's `meta.sqlite` rows — callers handle the registry:
 * the route below returns the result to the deploy backend; the maintenance
 * cron pairs this with `deleteApp()`. Never throws — failures are collected in
 * `errors` so a partial teardown is still reported.
 */
export async function deprovisionApp(env: Env, appId: string): Promise<DeprovisionResult> {
  const start = Date.now();
  const errors: string[] = [];
  const cleaned = {
    r2Objects: 0,
    d1Databases: [] as string[],
    workerScripts: [] as string[],
    r2Buckets: [] as string[],
  };

  console.log(`[Deprovision] Starting cleanup for app ${appId}`);

  // Local deprovision config — deletes SQLite files + FS storage; no CF.
  const config: DeploymentConfig = {
    appId,
    appAlias: appId,
    accountId: 'local',
    apiToken: 'local',
    wfpNamespace: 'local',
  };

  // 1. Delete R2 objects from CONFIG_CACHE under {appId}/ prefix
  try {
    const count = await deleteR2ObjectsByPrefix(env.CONFIG_CACHE, `${appId}/`);
    cleaned.r2Objects = count;
    console.log(`[Deprovision] Deleted ${count} R2 objects for ${appId}`);
    // The self-host FsStorageAdapter deletes per-key files but leaves empty
    // directory skeletons behind, so "remove completely" would orphan dirs.
    // deletePrefix() rmSync's the whole `{appId}/` subtree. Feature-detected:
    // a real R2 binding has no such method (CF has no directories), so this is
    // a no-op there.
    const cache = env.CONFIG_CACHE as unknown as {
      deletePrefix?: (prefix: string) => Promise<void>;
    };
    if (typeof cache.deletePrefix === 'function') {
      await cache.deletePrefix(`${appId}/`);
    }
  } catch (e) {
    const msg = `R2 object cleanup failed: ${e instanceof Error ? e.message : String(e)}`;
    errors.push(msg);
    console.error(`[Deprovision] ${msg}`);
  }

  // 2. Delete D1 databases (published + preview)
  const d1Names = [`exepad-${appId}`, `exepad-preview-${appId}`];
  for (const dbName of d1Names) {
    try {
      const db = await getD1Database(config, dbName);
      if (db) {
        await deleteD1Database(config, db.uuid);
        cleaned.d1Databases.push(dbName);
        console.log(`[Deprovision] Deleted D1 database: ${dbName}`);
      }
    } catch (e) {
      const msg = `D1 deletion failed for ${dbName}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(msg);
      console.error(`[Deprovision] ${msg}`);
    }
  }

  // 3. Delete WfP worker scripts (published + preview)
  const scriptNames = [`app-${appId}`, `app-preview-${appId}`];
  for (const scriptName of scriptNames) {
    try {
      const deleted = await deleteWorkerScript(config, scriptName);
      if (deleted) {
        cleaned.workerScripts.push(scriptName);
        console.log(`[Deprovision] Deleted WfP script: ${scriptName}`);
      }
    } catch (e) {
      const msg = `WfP deletion failed for ${scriptName}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(msg);
      console.error(`[Deprovision] ${msg}`);
    }
  }

  // 4. Delete R2 file-storage bucket
  const bucketName = `exepad-files-${appId}`;
  try {
    const deleted = await deleteR2Bucket(config, bucketName);
    if (deleted) {
      cleaned.r2Buckets.push(bucketName);
      console.log(`[Deprovision] Deleted R2 bucket: ${bucketName}`);
    }
  } catch (e) {
    const msg = `R2 bucket deletion failed for ${bucketName}: ${e instanceof Error ? e.message : String(e)}`;
    errors.push(msg);
    console.error(`[Deprovision] ${msg}`);
  }

  // 5. Bust the in-memory + CF-cache config entries for BOTH modes. The storage
  // is gone above, but the meta-injector and the gateway each keep a per-isolate
  // config cache (published TTL 60s, plus a CF Cache API entry up to 5min) keyed
  // `{appId}:{mode}`. Without this, a deleted app's `/a/{id}/` keeps serving the
  // torn-down app's injected <title>/data-app-id/route-mode from cache until the
  // TTL lapses (re-warmed on every hit), instead of the clean not-found shell.
  // `unpublish` already does this for the published mode; deprovision is the
  // shared teardown for delete + the failed-build husk-reaper + the deploy
  // backend, so busting both modes here covers every path that removes an app.
  // Best-effort and last: a cache miss must never fail or mask the real teardown.
  try {
    await Promise.all([
      invalidateConfig(appId, 'published'),
      invalidateConfig(appId, 'preview'),
      invalidateGatewayConfig(appId, 'published'),
      invalidateGatewayConfig(appId, 'preview'),
    ]);
  } catch (e) {
    const msg = `Config cache invalidation failed: ${e instanceof Error ? e.message : String(e)}`;
    errors.push(msg);
    console.error(`[Deprovision] ${msg}`);
  }

  const result: DeprovisionResult = {
    success: errors.length === 0,
    appId,
    cleaned,
    errors,
    duration: Date.now() - start,
  };

  console.log(
    `[Deprovision] Completed for ${appId} in ${result.duration}ms: ` +
    `${cleaned.r2Objects} R2 objects, ${cleaned.d1Databases.length} D1 DBs, ` +
    `${cleaned.workerScripts.length} WfP scripts, ${cleaned.r2Buckets.length} R2 buckets` +
    (errors.length > 0 ? ` (${errors.length} errors)` : ''),
  );

  return result;
}

// ─── DELETE /api/deprovision/:appId ─────────────────────────────────────────

deprovision.delete('/:appId', async (c) => {
  const appId = c.req.param('appId');

  // 1. Auth — same shared secret as deploy endpoint
  const deploySecret = await c.env.DEPLOY_SECRET.get();
  const headerSecret = c.req.header('X-Deploy-Secret') || '';
  if (!deploySecret || !constantTimeEqual(headerSecret, deploySecret)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  // 2. Strict appId format validation
  if (!VALID_APP_ID_RE.test(appId)) {
    return c.json(
      { success: false, error: 'Invalid appId format. Expected 8-16 lowercase alphanumeric characters.' },
      400,
    );
  }

  const result = await deprovisionApp(c.env, appId);

  // 207 Multi-Status if partial failures, 200 if fully clean
  return c.json(result, result.errors.length > 0 ? 207 : 200);
});

// ─── POST /api/deprovision/gc ───────────────────────────────────────────────
//
// Garbage-collect orphaned Cloudflare resources.
// The backend sends a list of live appIds; we diff against what exists in CF
// and clean up anything that doesn't belong to a live app.

interface GCRequest {
  liveAppIds: string[];
  dryRun?: boolean;
}

interface GCResult {
  success: boolean;
  dryRun: boolean;
  discovered: {
    d1Databases: number;
    workerScripts: number;
    r2Prefixes: number;
  };
  orphans: string[];
  cleaned: string[];
  errors: string[];
  duration: number;
}

/** Extract appId from a D1 database name like "exepad-abc123" or "exepad-preview-abc123" */
function appIdFromD1Name(name: string): string | null {
  if (name.startsWith('exepad-preview-')) return name.slice('exepad-preview-'.length);
  if (name.startsWith('exepad-')) return name.slice('exepad-'.length);
  return null;
}

/** Extract appId from a WfP script name like "app-abc123" or "app-preview-abc123" */
function appIdFromScriptName(name: string): string | null {
  if (name.startsWith('app-preview-')) return name.slice('app-preview-'.length);
  if (name.startsWith('app-')) return name.slice('app-'.length);
  return null;
}

deprovision.post('/gc', async (c) => {
  const start = Date.now();

  // Auth
  const env = c.env;
  const deploySecret = await env.DEPLOY_SECRET.get();
  const headerSecret = c.req.header('X-Deploy-Secret') || '';
  if (!deploySecret || !constantTimeEqual(headerSecret, deploySecret)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  let body: GCRequest;
  try {
    body = await c.req.json<GCRequest>();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }
  const { liveAppIds, dryRun = false } = body;

  if (!Array.isArray(liveAppIds)) {
    return c.json({ success: false, error: 'liveAppIds must be an array' }, 400);
  }

  const liveSet = new Set(liveAppIds);
  const errors: string[] = [];
  const orphanAppIds = new Set<string>();

  console.log(`[GC] Starting orphan scan. ${liveSet.size} live apps, dryRun=${dryRun}`);

  const config: DeploymentConfig = {
    appId: '_gc',
    appAlias: '_gc',
    accountId: 'local',
    apiToken: 'local',
    wfpNamespace: 'local',
  };

  let d1Count = 0;
  let wfpCount = 0;
  let r2Count = 0;

  // 1. Scan D1 databases
  try {
    const databases = await listD1Databases(config);
    for (const db of databases) {
      const appId = appIdFromD1Name(db.name);
      if (appId && VALID_APP_ID_RE.test(appId) && !liveSet.has(appId)) {
        orphanAppIds.add(appId);
      }
    }
    d1Count = databases.filter((db: { name: string }) => appIdFromD1Name(db.name) !== null).length;
  } catch (e) {
    errors.push(`D1 scan failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Scan WfP scripts
  try {
    const scripts = await listWorkerScripts(config);
    for (const script of scripts) {
      const appId = appIdFromScriptName(script.id);
      if (appId && VALID_APP_ID_RE.test(appId) && !liveSet.has(appId)) {
        orphanAppIds.add(appId);
      }
    }
    wfpCount = scripts.filter((s) => appIdFromScriptName(s.id) !== null).length;
  } catch (e) {
    errors.push(`WfP scan failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Scan storage prefixes in CONFIG_CACHE.
  // NOTE: the self-host FsStorageAdapter.list() does not implement the R2
  // `delimiter` option (it always returns delimitedPrefixes: []), so a
  // `{ delimiter: '/' }` scan would silently find zero prefixes and never GC
  // storage-only orphans. Derive the top-level prefixes ourselves from the flat
  // key listing instead, paginating via the cursor so the 1000-key default
  // page limit doesn't truncate the scan.
  try {
    const topLevelPrefixes = new Set<string>();
    let cursor: string | undefined;
    // Bound the loop defensively so a pathological listing can't spin forever.
    for (let page = 0; page < 10_000; page++) {
      const listed = await env.CONFIG_CACHE.list({ cursor, limit: 1000 });
      for (const obj of listed.objects) {
        const firstSeg = obj.key.split('/')[0];
        if (firstSeg) topLevelPrefixes.add(firstSeg);
      }
      if (!listed.truncated || !listed.cursor) break;
      cursor = listed.cursor;
    }
    for (const appId of topLevelPrefixes) {
      if (appId.startsWith('_')) continue; // Skip system prefixes like _system/
      if (VALID_APP_ID_RE.test(appId)) {
        r2Count++;
        if (!liveSet.has(appId)) orphanAppIds.add(appId);
      }
    }
  } catch (e) {
    errors.push(`R2 prefix scan failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const orphans = Array.from(orphanAppIds);
  const cleaned: string[] = [];

  console.log(
    `[GC] Scan complete: ${d1Count} D1, ${wfpCount} WfP, ${r2Count} R2 prefixes. ` +
    `Found ${orphans.length} orphan(s).`,
  );

  // 4. Clean up orphans (max 20 per run to avoid overload)
  const MAX_PER_RUN = 20;
  const toClean = orphans.slice(0, MAX_PER_RUN);

  if (!dryRun) {
    for (const appId of toClean) {
      try {
        // Delete R2 objects
        await deleteR2ObjectsByPrefix(env.CONFIG_CACHE, `${appId}/`);

        // Delete D1 databases
        for (const dbName of [`exepad-${appId}`, `exepad-preview-${appId}`]) {
          try {
            const db = await getD1Database(config, dbName);
            if (db) await deleteD1Database(config, db.uuid);
          } catch { /* best-effort */ }
        }

        // Delete WfP scripts
        for (const scriptName of [`app-${appId}`, `app-preview-${appId}`]) {
          try { await deleteWorkerScript(config, scriptName); } catch { /* best-effort */ }
        }

        // Delete R2 file bucket
        try { await deleteR2Bucket(config, `exepad-files-${appId}`); } catch { /* best-effort */ }

        cleaned.push(appId);
        console.log(`[GC] Cleaned orphan: ${appId}`);
      } catch (e) {
        errors.push(`Cleanup failed for ${appId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const result: GCResult = {
    success: errors.length === 0,
    dryRun,
    discovered: { d1Databases: d1Count, workerScripts: wfpCount, r2Prefixes: r2Count },
    orphans,
    cleaned,
    errors,
    duration: Date.now() - start,
  };

  console.log(
    `[GC] Done in ${result.duration}ms. ` +
    `Orphans: ${orphans.length}, Cleaned: ${cleaned.length}` +
    (orphans.length > MAX_PER_RUN ? ` (capped at ${MAX_PER_RUN})` : '') +
    (errors.length > 0 ? `, Errors: ${errors.length}` : ''),
  );

  return c.json(result);
});
