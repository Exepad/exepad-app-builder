/**
 * In-process deploy helpers used by the Studio build/publish flow.
 *
 * Extracted from orchestrate.ts so the `/api/orchestrate/*` routes drive
 * deploy/publish through ONE implementation. These re-enter the deploy pipeline
 * (routes/deploy.ts) on the trusted DEPLOY_SECRET path — the same way orchestrate
 * has always called it on the operator's behalf.
 */
import type { Env } from '../types/env';
import type { DeploymentStatus } from '@exepad/types';
import { deploy } from '../routes/deploy';
import { resolveSecret } from './secrets';
import {
  recordDeployment,
  touchApp,
  getDeployment,
  setActivePublishedVersion,
  getActivePublishedVersion,
} from './meta-db';
import { saveDeploymentStatus, loadDeploymentStatus, validatePublishedManifest } from './r2-helpers';
import { invalidateConfig } from './app-config';
import { invalidateGatewayConfig } from '../routes/gateway/config';

/** Re-enter the deploy pipeline in-process (reuses every step in deploy.ts). */
export async function runDeployInProcess(
  env: Env,
  appId: string,
  body: { mode: 'preview' | 'published'; configPath?: string; correlationId?: string },
): Promise<Response> {
  const deploySecret = await resolveSecret(env.DEPLOY_SECRET);
  const req = new Request(`http://internal/${appId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Deploy-Secret': deploySecret,
    },
    body: JSON.stringify({ ...body, appAlias: appId }),
  });
  return deploy.fetch(req, env);
}

export type PromoteResult =
  | { ok: true; url: string; deploy: unknown }
  | { ok: false; status: 400 | 500; error: string };

/**
 * Promote an app's materialized preview config to the published config key and
 * re-run the deploy pipeline in `published` mode. Records the deployment and
 * flips the app to `published` on success. The compiled component/handler/style
 * assets already live under `{appId}/compiled|code/` from the preview
 * materialize, so this only needs the config promotion + a published deploy.
 */
export async function promotePreviewToPublished(env: Env, appId: string): Promise<PromoteResult> {
  const previewObj = await env.CONFIG_CACHE.get(`${appId}/preview/app-config.json`);
  if (!previewObj) {
    return { ok: false, status: 400, error: 'No preview build to publish. Run a build first.' };
  }
  // Whether this app already has a live published release. On a FIRST publish this
  // is null, which matters on the failure path below.
  const hadPublishedRelease = getActivePublishedVersion(appId) != null;
  const configText = await previewObj.text();
  await env.CONFIG_CACHE.put(`${appId}/published/app-config.json`, configText, {
    httpMetadata: { contentType: 'application/json' },
  });

  const correlationId = crypto.randomUUID();
  const res = await runDeployInProcess(env, appId, { mode: 'published', correlationId });
  const resBody = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    configPath?: string;
  };
  if (!res.ok || resBody.success === false) {
    const error = resBody.error ?? `Publish failed (HTTP ${res.status})`;
    recordDeployment({ appId, mode: 'published', status: 'failed', correlationId, error });
    // We wrote the bare `published/app-config.json` above BEFORE deploying. On a
    // FIRST publish there is no prior release, so the failed deployment-status
    // carries no configPath and the resolver falls back to this bare key —
    // publicly serving the un-deployed frontend at /a/{id}/ with no published
    // DB/handlers (backend calls 500), while the dashboard still shows the app as
    // NOT published. Remove it so the resolver finds no published config → a clean
    // "not published" state. Gated on `!hadPublishedRelease`: on a re-publish a
    // prior release exists and IS what the resolver serves, so leaving the bare
    // key alone there avoids taking the previously-live app offline.
    if (!hadPublishedRelease) {
      await env.CONFIG_CACHE.delete(`${appId}/published/app-config.json`).catch(() => {
        /* best-effort — the publish failure already surfaces an error to the operator */
      });
    }
    return { ok: false, status: 500, error };
  }

  // Record the release lineage (its immutable config path) so it is listable +
  // rollback-able, and mark it the active published version.
  const depId = recordDeployment({
    appId,
    mode: 'published',
    status: 'success',
    correlationId,
    configPath: resBody.configPath ?? null,
  });
  setActivePublishedVersion(appId, depId);
  touchApp(appId, { status: 'published', published_at: new Date().toISOString() });
  return { ok: true, url: `/a/${appId}/`, deploy: resBody };
}

export type ActivateResult =
  | { ok: true; url: string; deploymentId: number }
  | { ok: false; status: 404 | 410 | 500; error: string };

/**
 * A deployment row's config_path is a valid published-release pointer.
 * Strict (anchored, single path segment for the release id) so a malformed or
 * crafted config_path can never traverse out of `{appId}/published/releases/`.
 */
const RELEASE_CONFIG_RE = /^published\/releases\/[A-Za-z0-9._-]+\/app-config\.json$/;
export function isReleaseConfigPath(configPath: string | null | undefined): boolean {
  return typeof configPath === 'string' && RELEASE_CONFIG_RE.test(configPath);
}

/**
 * Roll the live published app back to a prior release by flipping the published
 * pointer to that release's immutable config, then busting the gateway + config
 * caches. No re-snapshot and no worker re-upload are needed on self-host: the
 * gateway and app-backend resolve `deployment-status-published.json.configPath`
 * per request, so the next request serves the target release's config + its
 * self-contained assets/handlers. The target's manifest is verified intact first.
 */
export async function activatePublishedRelease(
  env: Env,
  appId: string,
  deploymentId: number,
): Promise<ActivateResult> {
  const dep = getDeployment(deploymentId);
  if (
    !dep ||
    dep.app_id !== appId ||
    dep.mode !== 'published' ||
    dep.status !== 'success' ||
    !isReleaseConfigPath(dep.config_path)
  ) {
    return { ok: false, status: 404, error: 'Published version not found' };
  }

  // Validated above by isReleaseConfigPath → safe to treat as a string.
  const releaseConfigPath = dep.config_path as string;
  // The release prefix is the config path minus the trailing /app-config.json.
  const prefix = releaseConfigPath.replace(/\/app-config\.json$/, '');
  const intact = await validatePublishedManifest(env.CONFIG_CACHE, appId, prefix);
  if (!intact) {
    return { ok: false, status: 410, error: 'Release artifacts are missing or corrupt' };
  }

  // Flip the pointer, preserving the rest of the current published status.
  const cur = await loadDeploymentStatus(env.CONFIG_CACHE, appId, 'published');
  const next: DeploymentStatus = {
    ...(cur ?? ({ appId, mode: 'published', status: 'success' } as DeploymentStatus)),
    appId,
    mode: 'published',
    status: 'success',
    configPath: releaseConfigPath,
  };
  await saveDeploymentStatus(env.CONFIG_CACHE, next);
  await invalidateConfig(appId, 'published');
  await invalidateGatewayConfig(appId, 'published');

  // Record the rollback as its own deployment event + mark the live version.
  const newDepId = recordDeployment({
    appId,
    mode: 'published',
    status: 'success',
    configPath: releaseConfigPath,
    label: `Rollback to #${deploymentId}`,
  });
  setActivePublishedVersion(appId, newDepId);
  touchApp(appId, { status: 'published', published_at: new Date().toISOString() });
  return { ok: true, url: `/a/${appId}/`, deploymentId };
}
