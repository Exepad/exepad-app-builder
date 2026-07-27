import { Hono } from 'hono';
import type { Env } from '../types/env';
import {
  extractBackendProps,
  validateInjectedConfig,
  provisionD1Database,
  provisionR2Bucket,
  createAppBackendBindings,
  uploadWorkerScript,
  generateEntryModule,
  seedFromR2,
  resolveStaticSeeds,
  applyMigrations,
  planMigrations,
  saveDeploymentSnapshot,
  getPreviousSchema,
  backupAppDatabase,
  pruneAppDatabaseBackups,
  restoreAppDatabase,
  rollbackSchema,
  acquireDeployLock,
  releaseDeployLock,
  generateFilesDDL,
  generateAuthDDL,
  generateApiKeysDDL,
  executeD1DDL,
  executeD1DDLBatch,
  executeD1Query,
} from '@exepad/deploy-utils';
import type { DeploymentConfig, SeedFromR2Result } from '@exepad/deploy-utils';
import type { DeployRequest, DeployResponse } from '@exepad/types';
import { resolveSecret } from '../lib/secrets';
import {
  saveDeploymentStatus,
  loadDeploymentStatus,
  readRepoModules,
  readWorkerTemplate,
  writePublishedSnapshot,
  writeSeoSnapshots,
  validatePublishedManifest,
  deleteR2ObjectsByPrefix,
} from '../lib/r2-helpers';

import { constantTimeEqual } from '../lib/crypto-utils';

/**
 * How many published-release snapshots to retain per app for rollback. Every
 * publish writes a full copy of the compiled bundle + assets under
 * `{appId}/published/releases/{suffix}/`; without pruning these accumulate
 * forever and eventually exhaust the /data volume (SQLITE_FULL wedges the whole
 * container). Keep the newest N (which always includes the release just made).
 */
const KEEP_PUBLISHED_RELEASES = 5;

/** List every distinct release suffix under `{appId}/published/releases/`. */
async function listPublishedReleaseSuffixes(env: Env, appId: string): Promise<string[]> {
  const base = `${appId}/published/releases/`;
  const suffixes = new Set<string>();
  let cursor: string | undefined;
  do {
    const res = await env.CONFIG_CACHE.list({ prefix: base, cursor });
    for (const o of res.objects) {
      const seg = o.key.slice(base.length).split('/')[0];
      if (seg) suffixes.add(seg);
    }
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  return [...suffixes];
}

/**
 * Delete published-release snapshots beyond the newest {@link KEEP_PUBLISHED_RELEASES},
 * always retaining `keepSuffix` (the release just written / now live). Release
 * suffixes are `${Date.now()}-...`, so a lexicographic sort is chronological.
 */
async function prunePublishedReleases(env: Env, appId: string, keepSuffix: string): Promise<void> {
  const sorted = (await listPublishedReleaseSuffixes(env, appId)).sort();
  const stale = sorted
    .slice(0, Math.max(0, sorted.length - KEEP_PUBLISHED_RELEASES))
    .filter((s) => s !== keepSuffix);
  for (const s of stale) {
    await deleteR2ObjectsByPrefix(env.CONFIG_CACHE, `${appId}/published/releases/${s}/`);
  }
  if (stale.length > 0) {
    console.log(`[deploy] Pruned ${stale.length} old published-release snapshot(s) for ${appId}`);
  }
}
import { invalidateConfig } from '../lib/app-config';
import { invalidateGatewayConfig } from './gateway/config';

export const deploy = new Hono<{ Bindings: Env }>();

const VALID_ALIAS_RE = /^[a-z0-9][a-z0-9_-]{0,253}[a-z0-9]$/i;

// ─── POST /api/deploy/:appId ────────────────────────────────────────────────

deploy.post('/:appId', async (c) => {
  const appId = c.req.param('appId');
  let body: DeployRequest;
  try {
    body = await c.req.json<DeployRequest>();
  } catch {
    return c.json(
      { success: false, error: 'Invalid JSON body' } satisfies DeployResponse,
      400,
    );
  }
  const { mode, appAlias = appId, correlationId, configPath } = body;

  if (!mode) {
    return c.json(
      { success: false, error: 'mode is required' } satisfies DeployResponse,
      400,
    );
  }

  if (!VALID_ALIAS_RE.test(appAlias)) {
    return c.json(
      { success: false, error: 'appAlias must be alphanumeric with hyphens/underscores, 2-255 characters' } satisfies DeployResponse,
      400,
    );
  }

  const start = Date.now();
  let currentStep = 'auth';

  // 1. Auth
  const env = c.env;
  const deploySecret = await env.DEPLOY_SECRET.get();
  const headerSecret = c.req.header('X-Deploy-Secret') || '';
  if (!deploySecret || !constantTimeEqual(headerSecret, deploySecret)) {
    return c.json(
      { success: false, error: 'Unauthorized' } satisfies DeployResponse,
      401,
    );
  }

  // 2. Idempotency
  if (correlationId) {
    const existing = await loadDeploymentStatus(env.CONFIG_CACHE, appId, mode);
    if (existing?.lastCorrelationId === correlationId && existing.status === 'success') {
      return c.json({ success: true, ...existing, idempotent: true });
    }
  }

  let dbId: string | undefined;
  let lockAcquired = false;
  let rolledBack = false;
  let migrationsApplied = false;
  // Absolute path of the byte-level pre-migration DB backup, once taken. Used to
  // restore row data (not just structure) if a destructive migration must roll
  // back, and surfaced on the deploy status.
  let backupPath: string | undefined;
  let deploymentConfig: DeploymentConfig | undefined;
  let publishedConfigPath: string | undefined;
  // Model table names this deploy owns — used to scope the schema rollback so it
  // never drops tables for models merely removed from the config (see
  // rollbackSchema's createdTableAllowList). Populated once the config is parsed.
  let migrationModelNames: string[] = [];

  try {
    // Self-hosted single-container: no Cloudflare credentials. Local provisioning
    // (SQLite file + FS storage) ignores the CF fields; `mode` selects the app's
    // preview/published SQLite file. Service tokens still flow so the in-process
    // app-backend's service-token verification matches the gateway.
    const serviceToken = await resolveSecret(env.USER_WORKER_SERVICE_TOKEN);
    const platformInternalSecret = await resolveSecret(env.PLATFORM_INTERNAL_SECRET);
    deploymentConfig = {
      accountId: 'local',
      apiToken: 'local',
      wfpNamespace: 'local',
      appId,
      appAlias,
      mode,
      r2BucketName: undefined,
    };

    // 3. Read config from R2
    currentStep = 'config';
    if (mode === 'preview' && !configPath) {
      throw new Error('configPath is required for preview deploys');
    }
    const resolvedConfigPath = mode === 'preview'
      ? `${appId}/${configPath}`
      : `${appId}/published/app-config.json`;
    const configObject = await env.CONFIG_CACHE.get(resolvedConfigPath);
    if (!configObject) {
      const hint = mode === 'published'
        ? 'No published snapshot found. Has this app been published via the publish flow?'
        : `Config not found at ${resolvedConfigPath}. Has the Agent uploaded artifacts to R2?`;
      throw new Error(hint);
    }
    const appConfig = JSON.parse(await configObject.text());

    // 3.5 Reject empty-frontend deploys.
    //
    // If the agent workflow failed silently (e.g. ComponentBuilderMultiple
    // hit its tool-call cap on every action, or source rehydration
    // overwrote translated TSX with stubs) the config can land here with
    // `repo.frontend.components = {}` while `frontend.pages` still
    // declares page entries. Pre-fix this shipped as `status: "success"`
    // with every page rendering "This section isn't available right now."
    // Throwing here lets the existing catch block at the bottom of this
    // handler write `status: "failed"` instead.
    //
    // Skip the guard when pages is empty (admin-only / backend-only apps).
    const repoComponents = (appConfig?.repo?.frontend?.components ?? {}) as Record<string, unknown>;
    const pages = (appConfig?.frontend?.pages ?? []) as Array<unknown>;
    if (Object.keys(repoComponents).length === 0 && pages.length > 0) {
      throw new Error(
        `Deployment validation: repo.frontend.components is empty while frontend.pages has ${pages.length} entries. ` +
        `The agent workflow likely failed silently. Check correlation_id "${correlationId}" for cbm_dispatch_capped errors.`,
      );
    }

    // 4. Validate config
    const backendConfig = extractBackendProps(appConfig);
    migrationModelNames = (backendConfig.models || []).map((m: any) => String(m.name));
    const configErrors = validateInjectedConfig(backendConfig);
    if (configErrors.length > 0) {
      throw new Error(`Config validation: ${configErrors.join('; ')}`);
    }

    // 4.1 Validate storage requires dynamic backend + R2 bucket
    if (backendConfig.storage?.enabled) {
      const backendMode = (appConfig.backend as Record<string, unknown>)?.mode;
      if (backendMode === 'static') {
        throw new Error(
          'Config validation: storage.enabled requires backend.mode = "dynamic". ' +
          'Static backends cannot use file storage.',
        );
      }
    }

    // 4.5. Resolve static seed data
    const seedConfig = appConfig.repo?.seed;
    const backendModelNames = new Set(
      (backendConfig.models || []).map((m: any) => String(m.name).toLowerCase()),
    );
    if (seedConfig && Object.keys(seedConfig).length > 0) {
      currentStep = 'static-seed';
      try {
        const staticResult = await resolveStaticSeeds({
          r2: env.CONFIG_CACHE,
          appId,
          appConfig,
          seedEntries: seedConfig,
          backendModelNames,
        });
        if (staticResult.resolved.length > 0) {
          console.log(`[deploy] Static seeds resolved: ${staticResult.resolved.join(', ')}`);
        }
        if (staticResult.errors.length > 0) {
          console.warn(`[deploy] Static seed warnings: ${staticResult.errors.join('; ')}`);
        }
      } catch (e) {
        // Best-effort: `resolveStaticSeeds` only stages static seed sources — the
        // actual CSV→DB seeding (and its row-level error surfacing) happens later
        // in the seedFromR2 step, so a failure here must NOT abort the deploy.
        console.warn(`[deploy] Static seed resolution failed (non-fatal): ${e}`);
      }
    }

    // 5-8c. Parallelize independent operations: R2 reads + infrastructure provisioning
    // These have no dependencies on each other and can run concurrently.
    currentStep = 'provision';
    const handlerMethods = (backendConfig.handlers || []).map((h) => h.method);
    const repoMethods = appConfig.repo?.backend?.handlers || {};
    const dbName = mode === 'preview' ? `exepad-preview-${appId}` : `exepad-${appId}`;
    const needsR2Bucket = !!backendConfig.storage?.enabled;

    const [handlerModulesRaw, templateResult, dbInfo, r2BucketResult] = await Promise.all([
      // 5. Read handler .js files from repo/
      readRepoModules(
        env.CONFIG_CACHE,
        appId,
        handlerMethods.map((m: string) => repoMethods[m]?.compiled).filter(Boolean),
      ),
      // 6. Read template (versioned)
      readWorkerTemplate(env.CONFIG_CACHE),
      // 8. Provision D1
      provisionD1Database({ ...deploymentConfig, d1NamingPattern: dbName }),
      // 8c. Provision R2 bucket for file storage
      needsR2Bucket
        ? provisionR2Bucket(deploymentConfig, `exepad-files-${appId}`)
        : Promise.resolve(null),
    ]);

    const handlerModules = handlerModulesRaw as Map<string, string>;
    const { content: templateJs, sha: templateSha } = templateResult;
    dbId = dbInfo.uuid;
    const r2BucketName = r2BucketResult?.name;
    if (r2BucketName) {
      console.log(`[deploy]   R2 bucket: ${r2BucketName}`);
    }

    // 7. Generate _entry.js module (depends on handlerModules)
    const entryJs = generateEntryModule(Array.from(handlerModules.keys()));

    // 9. Acquire deploy lock
    currentStep = 'lock';
    lockAcquired = await acquireDeployLock(deploymentConfig, dbId, appId, correlationId);
    if (!lockAcquired) {
      throw new Error('Another deployment is in progress. Try again later.');
    }

    // 10. Schema snapshot + migrations
    currentStep = 'schema';
    try {
      await saveDeploymentSnapshot(deploymentConfig, dbId!, backendConfig.models || []);
    } catch (snapErr) {
      // FATAL: this is the pre-migration restore point. If it can't be written we
      // must NOT proceed to apply migrations — otherwise a later failure would
      // roll back against a STALE previous_schema (captured by an EARLIER deploy),
      // dropping columns that hold live data written since. Abort before any
      // migration runs so there is never a mismatched rollback baseline.
      throw new Error(
        `Failed to save pre-migration schema snapshot: ${snapErr instanceof Error ? snapErr.message : snapErr}`,
      );
    }

    // Plan the migration first (no side effects) so we can decide whether a
    // byte-level backup is warranted BEFORE any statement touches data. A backup
    // is taken whenever the plan is destructive OR runs any statement — i.e. any
    // deploy that could alter data, not just destructive rebuilds.
    const migrationPlan = await planMigrations(deploymentConfig, dbId!, backendConfig.models || []);
    if (migrationPlan.isDestructive || migrationPlan.statements.length > 0) {
      try {
        const backup = await backupAppDatabase(dbId!, correlationId);
        backupPath = backup.path;
        // Prune old backups with the same retention as published releases so a
        // long-lived app can't accumulate snapshots and exhaust /data.
        pruneAppDatabaseBackups(dbId!);
        console.log(
          `[deploy] Pre-migration backup for ${appId} (${mode}): ${backup.path} (${backup.bytes} bytes)`,
        );
      } catch (backupErr) {
        const msg = backupErr instanceof Error ? backupErr.message : String(backupErr);
        // For a DESTRUCTIVE migration the backup is the ONLY recovery path (a
        // rebuild can drop rows reverse-DDL can't restore) — abort rather than
        // run it blind. For a purely additive plan, reverse-DDL rollback still
        // works, so a backup failure is non-fatal.
        if (migrationPlan.isDestructive) {
          throw new Error(`Failed to take pre-migration backup before a destructive migration: ${msg}`);
        }
        console.warn(`[deploy] Pre-migration backup failed (non-fatal, additive plan): ${msg}`);
      }
    }

    // Destructive migrations (table rebuild / column drop) only run when the
    // authenticated operator explicitly opts in per deploy; otherwise the
    // orchestrator downgrades `reset`/`destructive` to safe. The pre-migration
    // backup above is the restore point when they do opt in.
    const migrationResult = await applyMigrations(
      deploymentConfig,
      dbId!,
      backendConfig.models || [],
      'safe',
      { allowDestructive: body.allowDestructive === true },
    );
    migrationsApplied = migrationResult.statements.length > 0;
    if (migrationResult.warnings.length > 0) {
      // Skipped/synthesized columns and type/nullability drift are otherwise
      // invisible (they used to live only in a discarded return value). Log them
      // and persist onto the deploy status/response so operators + agents see a
      // table that diverged from the config, or a destructive plan that ran.
      console.warn(
        `[deploy] Migration warnings for ${appId} (${mode}): ${migrationResult.warnings.join('; ')}`,
      );
    }

    // 10.5-10.6 Apply system tables (files + auth) in batched DDL calls
    // Collect all DDL for the primary D1 and execute in one batch to reduce round-trips.
    const primaryDDL: string[] = [];

    if (backendConfig.storage?.enabled) {
      primaryDDL.push(...generateFilesDDL());
    }

    // Apply auth tables + API key tables when the app has per-app auth.
    if (backendConfig.security) {
      primaryDDL.push(...generateAuthDDL());
      primaryDDL.push(...generateApiKeysDDL());
    }

    if (primaryDDL.length > 0) {
      try {
        await executeD1DDLBatch(deploymentConfig, dbId, primaryDDL);
        console.log(`[deploy]   System tables applied: ${primaryDDL.length} statements (batched)`);
      } catch (error) {
        throw new Error(`System table creation failed: ${error instanceof Error ? error.message : error}`);
      }
    }

    // 11. Seed D1 data
    //
    // Preview: seed EVERY model from realistic fixtures so users can iterate.
    //
    // Published: seed ONLY shared/reference models (those with
    // `ownerScope: "shared"` — catalog/lookup tables that are the app's actual
    // content, e.g. a product catalog). This runs non-destructively: the
    // seeder (Phase A in r2-seeder) never issues the owner-scoped DELETE for
    // published mode and skips any table that already has rows, so a
    // re-publish never clobbers live data and per-user demo fixtures
    // (`ownerScope: "user"`) are never pushed to production.
    //
    // Before this, published deploys seeded nothing (seeded:0), so
    // catalog/recommender/dataapps shipped an empty database — the handler
    // returned [] for every query. Seeding shared models on first publish
    // fixes that while preserving the original "never wipe live rows" intent.
    currentStep = 'seed';
    let seedResult: SeedFromR2Result | undefined;
    const sharedModelNames = new Set(
      (backendConfig.models || [])
        .filter((m: any) => m.ownerScope === 'shared')
        .map((m: any) => String(m.name).toLowerCase()),
    );
    const d1SeedEntries = seedConfig
      ? Object.fromEntries(
          Object.entries(seedConfig).filter(([, entry]) => {
            const model = String((entry as any).model).toLowerCase();
            if (!backendModelNames.has(model)) return false;
            // Preview seeds all models; published seeds only shared/reference.
            return mode === 'preview' || sharedModelNames.has(model);
          }),
        )
      : {};
    if (Object.keys(d1SeedEntries).length > 0) {
      try {
        seedResult = await seedFromR2({
          r2: env.CONFIG_CACHE,
          config: deploymentConfig,
          dbId: dbId!,
          appId,
          mode,
          seedEntries: d1SeedEntries as any,
          models: backendConfig.models as any,
        });
        console.log(`[deploy] Seed result: seeded=[${seedResult.seeded.join(',')}] skipped=[${seedResult.skipped.join(',')}] errors=${seedResult.errors.length}`);
        if (seedResult.errors.length > 0) {
          console.warn(`[deploy] Seed warnings: ${seedResult.errors.join('; ')}`);
        }
      } catch (seedError) {
        console.warn(`[deploy] Seed failed (non-fatal): ${seedError}`);
        seedResult = { seeded: [], skipped: [], errors: [String(seedError)] };
      }
    }

    // 12. Stage published snapshot + SEO content before traffic moves
    if (mode === 'published') {
      currentStep = 'snapshot';
      const releaseSuffix = `${Date.now()}-${(correlationId || crypto.randomUUID())
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .slice(0, 40)}`;
      const snapshotPrefix = `published/releases/${releaseSuffix}`;
      const snapshot = await writePublishedSnapshot(env.CONFIG_CACHE, appId, appConfig, repoMethods, {
        prefix: snapshotPrefix,
      });
      await writeSeoSnapshots(env.CONFIG_CACHE, appId, appConfig, {
        prefix: snapshot.prefix,
      });

      const manifestValid = await validatePublishedManifest(env.CONFIG_CACHE, appId, snapshot.prefix);
      if (!manifestValid) {
        throw new Error(`Published snapshot validation failed for ${snapshot.prefix}`);
      }

      publishedConfigPath = snapshot.configPath;

      // Prune older release snapshots so /data doesn't grow without bound (this
      // release is now live and always retained). Non-fatal — a prune failure
      // must not fail an otherwise-successful publish.
      await prunePublishedReleases(env, appId, releaseSuffix).catch((pruneErr) => {
        console.error(`[deploy] Failed to prune old release snapshots for ${appId}:`, pruneErr);
      });
    }

    // 13. Upload to WfP
    currentStep = 'upload';
    const scriptName = mode === 'preview' ? `app-preview-${appId}` : `app-${appId}`;
    const bindings = createAppBackendBindings({
      d1DatabaseId: dbId!,
      appId,
      appAlias,
      configBucketName: 'exepad-published',
      deployMode: mode,
      environment: env.ENVIRONMENT,
      serviceToken: serviceToken || undefined,
      platformInternalSecret: platformInternalSecret || undefined,
      r2BucketName,
    });

    await uploadWorkerScript(deploymentConfig, scriptName, bindings, {
      modules: [
        { name: '_entry.js', content: entryJs, type: 'esm' },
        { name: 'template.js', content: templateJs, type: 'esm' },
        ...Array.from(handlerModules).map(([method, content]) => ({
          name: `handlers/${method}.js`,
          content,
          type: 'esm' as const,
        })),
      ],
      mainModule: '_entry.js',
    });

    // 14. Release lock
    await releaseDeployLock(deploymentConfig, dbId, appId, correlationId);
    lockAcquired = false;

    // 15. Save success status to R2
    // NOTE: the pre-migration backup path (`backupPath`) is logged above and
    // used for restore-on-rollback and surfaced on the deploy status/response
    // (`backupPath`) so operators/agents can locate the restore point.
    const seedErrors = seedResult?.errors ?? [];
    const relativeConfigPath = mode === 'published'
      ? (publishedConfigPath || 'published/app-config.json')
      : (configPath || resolvedConfigPath);
    const result: Omit<DeployResponse, 'success'> = {
      workerName: scriptName,
      d1Id: dbId,
      duration: Date.now() - start,
      templateSha,
      migrations: migrationResult.statements.length,
      seeded: seedResult?.seeded.length ?? 0,
      configPath: relativeConfigPath,
      ...(seedErrors.length > 0 && { seedErrors }),
      ...(migrationResult.warnings.length > 0 && { migrationWarnings: migrationResult.warnings }),
      ...(migrationResult.isDestructive && { schemaDestructive: true }),
      ...(backupPath && { backupPath }),
    };
    await saveDeploymentStatus(env.CONFIG_CACHE, {
      appId,
      mode,
      status: 'success',
      lastCorrelationId: correlationId,
      workerName: scriptName,
      d1Id: dbId,
      duration: Date.now() - start,
      templateSha,
      migrations: migrationResult.statements.length,
      seeded: seedResult?.seeded.length ?? 0,
      // Surface per-row seed errors so operators can spot partial
      // failures without probing D1. Omitted when empty to keep the
      // happy-path JSON small. Added 2026-05-15 after alo48zsn where
      // `bookings: seeded=0` shipped silently.
      ...(seedErrors.length > 0 && { seedErrors }),
      ...(migrationResult.warnings.length > 0 && { migrationWarnings: migrationResult.warnings }),
      ...(migrationResult.isDestructive && { schemaDestructive: true }),
      ...(backupPath && { backupPath }),
      configPath: relativeConfigPath,
      updatedAt: new Date().toISOString(),
    });

    // Invalidate config caches so the next request gets fresh config. Must
    // complete BEFORE we return success — otherwise a client racing us to
    // /api/{appId}/app-config can hit stale cache or a negative-cached 404.
    // In-memory + cache-shim invalidation only (single-container, no edge).
    await Promise.all([
      invalidateConfig(appId, mode),
      invalidateGatewayConfig(appId, mode),
    ]);

    return c.json({ success: true, ...result } satisfies DeployResponse);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // 'schema' is rollback-eligible too: the system-table DDL batch (auth/api-key
    // tables) runs under currentStep='schema' AFTER the model migrations have
    // already committed, so a failure there must still revert the model schema.
    const rollbackSteps = new Set(['schema', 'upload', 'seed', 'snapshot']);
    if (rollbackSteps.has(currentStep) && migrationsApplied && dbId && deploymentConfig) {
      // Prefer a byte-level restore when a pre-migration backup was captured: it
      // reverts BOTH schema AND row data, so a destructive rebuild's dropped
      // rows are recovered — something reverse-DDL rollback (rollbackSchema)
      // can never do. Fall back to reverse-DDL only if there is no backup or the
      // restore itself fails.
      if (backupPath) {
        try {
          await restoreAppDatabase(dbId, backupPath);
          rolledBack = true;
          console.log(
            `[deploy] Restored ${appId} (${mode}) from pre-migration backup: ${backupPath}`,
          );
        } catch (restoreErr) {
          console.warn(
            `[deploy] Byte-level restore failed, falling back to reverse-DDL: ${restoreErr instanceof Error ? restoreErr.message : restoreErr}`,
          );
        }
      }
      // Reverse-DDL fallback: only when the byte-level restore didn't run or
      // didn't succeed. A successful restore already reverted schema + data.
      if (!rolledBack) {
        try {
          const previousSchema = await getPreviousSchema(deploymentConfig, dbId);
          if (previousSchema) {
            // Scope the "drop newly-created tables" cleanup to THIS deploy's model
            // set so a removed-model table (live user data) is never dropped, and
            // report rolledBack from the ACTUAL result rather than assuming success.
            const rollbackResult = await rollbackSchema(
              deploymentConfig,
              dbId,
              previousSchema,
              migrationModelNames,
            );
            rolledBack = rollbackResult.success;
            if (!rollbackResult.success) {
              console.warn(
                `[deploy] Schema rollback did not fully succeed for ${appId}: ${rollbackResult.details.join('; ')}`,
              );
            }
          }
        } catch (rollbackErr) {
          console.warn(`[deploy] Schema rollback failed (best-effort): ${rollbackErr}`);
        }
      }
    }

    // Preserve the last-good release pointer on failure. A failed deploy must
    // NOT strip `configPath` from the existing status: the serving resolvers
    // (gateway config-paths.ts + app-backend config-loader.ts) fall back to the
    // bare `${appId}/published/app-config.json` key when configPath is absent,
    // and that bare key already holds the *new, un-deployed* config (written by
    // promotePreviewToPublished before the deploy ran). Carrying the prior
    // configPath forward keeps the previously-live release serving instead of
    // silently swapping to a config whose schema/handlers never deployed.
    const priorStatus = await loadDeploymentStatus(env.CONFIG_CACHE, appId, mode).catch(
      () => null,
    );
    await saveDeploymentStatus(env.CONFIG_CACHE, {
      appId,
      mode,
      status: 'failed',
      lastCorrelationId: correlationId,
      error: errorMsg,
      step: currentStep,
      ...(priorStatus?.configPath ? { configPath: priorStatus.configPath } : {}),
      updatedAt: new Date().toISOString(),
    }).catch((statusErr) => {
      console.warn(`[deploy] Failed to save deployment status to R2: ${statusErr}`);
    });

    return c.json(
      { success: false, step: currentStep, error: errorMsg, rolledBack } satisfies DeployResponse,
      500,
    );

  } finally {
    if (lockAcquired && dbId && deploymentConfig) {
      await releaseDeployLock(deploymentConfig, dbId, appId, correlationId).catch((lockErr: unknown) => {
        console.error(`[deploy] Failed to release deploy lock for ${appId}: ${lockErr}`);
      });
    }
  }
});

// ─── GET /api/deploy/:appId ─────────────────────────────────────────────────

deploy.get('/:appId', async (c) => {
  const appId = c.req.param('appId');
  const env = c.env;

  const deploySecret = await env.DEPLOY_SECRET.get();
  const headerSecret = c.req.header('X-Deploy-Secret') || '';
  if (!deploySecret || !constantTimeEqual(headerSecret, deploySecret)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const mode = c.req.query('mode') || 'published';
  const status = await loadDeploymentStatus(env.CONFIG_CACHE, appId, mode);

  if (!status) {
    return c.json({ success: false, error: 'No deployment found' }, 404);
  }
  return c.json({ success: true, data: status });
});
