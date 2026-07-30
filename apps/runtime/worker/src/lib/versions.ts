/**
 * App version snapshots (self-hosted single container).
 *
 * A "version" is a complete, byte-for-byte backup of a successful preview
 * build's working set — NOT just its config. This matters because the compiled
 * component/handler/style assets live at STABLE keys under `{appId}/compiled/…`
 * that every build overwrites in place. Snapshotting the config alone would let
 * a restore serve an old config against the newest compiled code, which is wrong
 * in the common case (an edit rewrites component TSX → new compiled JS at the
 * same key).
 *
 * So each version copies the live working set
 *   - `{appId}/preview/app-config.json`  (the app config)
 *   - `{appId}/compiled/**`              (bundled component/handler/style output)
 *   - `{appId}/code/**`                  (TSX/CSS/CSV sources + seeds)
 * into a version-scoped prefix `{appId}/versions/{deploymentId}/…`.
 *
 * Restore copies that working set back over the live keys; the caller then
 * re-runs the deploy pipeline so the database schema, seeds, and handler bundle
 * are rebuilt to match the restored config + assets.
 */
import type { Env } from '../types/env';

/** Working-set subtrees (relative to `{appId}/`) captured in every snapshot. */
const VERSIONED_SUBTREES = ['compiled/', 'code/'] as const;

/** Default retention: snapshots beyond this (oldest first) are pruned. */
export const KEEP_VERSIONS = 20;

function versionPrefix(appId: string, depId: number): string {
  return `${appId}/versions/${depId}/`;
}

/** The `config_path` marker stored on a deployment row that has a snapshot. */
export function versionMarker(depId: number): string {
  return `versions/${depId}`;
}

/** True when a deployment row's config_path marks it as a retained version. */
export function isVersionMarker(configPath: string | null | undefined): boolean {
  return (configPath ?? '').startsWith('versions/');
}

/** List every object key under a prefix, following cursor pagination. */
async function listKeys(env: Env, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await env.CONFIG_CACHE.list({ prefix, cursor });
    for (const o of res.objects) keys.push(o.key);
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  return keys;
}

/** Copy a single object verbatim, preserving its content type. */
async function copyObject(env: Env, fromKey: string, toKey: string): Promise<void> {
  const src = await env.CONFIG_CACHE.get(fromKey);
  if (!src) return;
  const body = await src.arrayBuffer();
  await env.CONFIG_CACHE.put(toKey, body, {
    httpMetadata: {
      contentType: src.httpMetadata?.contentType ?? 'application/octet-stream',
    },
  });
}

/** Copy every object under `fromPrefix` to `toPrefix`, preserving relative layout. */
async function copyTree(env: Env, fromPrefix: string, toPrefix: string): Promise<number> {
  const keys = await listKeys(env, fromPrefix);
  for (const key of keys) {
    await copyObject(env, key, toPrefix + key.slice(fromPrefix.length));
  }
  return keys.length;
}

/**
 * Snapshot the app's current preview working set into `versions/{depId}/`.
 * Returns true when at least the config was captured (a usable version).
 */
export async function snapshotPreviewVersion(
  env: Env,
  appId: string,
  depId: number,
): Promise<boolean> {
  const config = await env.CONFIG_CACHE.get(`${appId}/preview/app-config.json`);
  if (!config) return false;

  const dest = versionPrefix(appId, depId);
  // Copy the compiled + source trees first, then the config last so a partially
  // copied snapshot never looks complete (restore checks for the config).
  for (const sub of VERSIONED_SUBTREES) {
    await copyTree(env, `${appId}/${sub}`, `${dest}${sub}`);
  }
  await env.CONFIG_CACHE.put(`${dest}app-config.json`, await config.arrayBuffer(), {
    httpMetadata: { contentType: 'application/json' },
  });
  return true;
}

/**
 * Restore a version's working set over the live preview keys. The caller MUST
 * re-run the deploy pipeline afterwards. Returns false when the snapshot config
 * is missing (nothing to restore).
 */
export async function restorePreviewVersionAssets(
  env: Env,
  appId: string,
  depId: number,
): Promise<boolean> {
  const src = versionPrefix(appId, depId);
  const config = await env.CONFIG_CACHE.get(`${src}app-config.json`);
  if (!config) return false;

  for (const sub of VERSIONED_SUBTREES) {
    await copyTree(env, `${src}${sub}`, `${appId}/${sub}`);
  }
  // Config last so the deploy that follows reads a fully-restored working set.
  await env.CONFIG_CACHE.put(`${appId}/preview/app-config.json`, await config.arrayBuffer(), {
    httpMetadata: { contentType: 'application/json' },
  });
  return true;
}

/** Delete a version's snapshot files (used when pruning old versions). */
export async function deleteVersionSnapshot(
  env: Env,
  appId: string,
  depId: number,
): Promise<void> {
  const keys = await listKeys(env, versionPrefix(appId, depId));
  if (keys.length > 0) {
    // R2 delete accepts a batch; chunk to stay well under provider limits.
    for (let i = 0; i < keys.length; i += 500) {
      await env.CONFIG_CACHE.delete(keys.slice(i, i + 500));
    }
  }
}
