/**
 * Deployment Lock (D1-based)
 *
 * Prevents concurrent deployments for the same app from interleaving.
 * Uses the app's D1 `_exepad_meta` table to store a lock with expiry.
 *
 * Lock is best-effort (no true distributed locking), but sufficient
 * to catch common cases like double-clicks or overlapping CI runs.
 */

import type { DeploymentConfig } from './types';
import { executeD1DDL, executeD1Query } from './d1';

/**
 * Lock expires after 15 minutes (in case the deployer crashes). Kept well above
 * worst-case publish duration — a published deploy does snapshot writes, image
 * capture (external HTTP with retries) and full-manifest re-hashing on the sync
 * storage adapter, which can run for several minutes on an image-heavy app on a
 * slow disk. A too-short TTL let a concurrent deploy steal the lock mid-flight.
 */
const LOCK_TTL_MS = 15 * 60 * 1000;

/**
 * Try to acquire a deployment lock for the given app.
 * Returns true if the lock was acquired, false if another deployment is in progress.
 *
 * The lock auto-expires after {@link LOCK_TTL_MS} to prevent stale locks from
 * permanently blocking deployments.
 *
 * `lockToken` (e.g. the deploy's correlationId) is stored alongside the timestamp
 * so {@link releaseDeployLock} can delete ONLY this deploy's lock — a late release
 * from a stale/expired deploy must not delete a second deploy's live lock.
 */
export async function acquireDeployLock(
  config: DeploymentConfig,
  dbId: string,
  appId: string,
  lockToken?: string
): Promise<boolean> {
  const lockKey = `deploy_lock:${appId}`;
  const now = Date.now();
  // Value format: `<ms>` or `<ms>:<token>`. The expiry check CASTs the value to
  // INTEGER, which reads the leading numeric prefix, so the optional token
  // suffix does not affect takeover.
  const lockValue = lockToken ? `${now}:${lockToken}` : String(now);

  try {
    // Ensure meta table exists (DDL — no user input, safe as literal)
    await executeD1DDL(
      config,
      dbId,
      `CREATE TABLE IF NOT EXISTS "_exepad_meta" (
        "key" TEXT PRIMARY KEY,
        "value" TEXT NOT NULL,
        "updated_at" TEXT NOT NULL
      )`
    );

    // Acquire ATOMICALLY in a single statement — the previous check-then-set
    // (SELECT then INSERT) had a race: two concurrent deploys of the same app
    // could both observe "no lock" between the SELECT await and the INSERT
    // await and both proceed, corrupting that app's SQLite. This upsert inserts
    // the lock, and on key conflict only takes it over when the existing lock
    // has EXPIRED (`value` timestamp older than TTL). A live lock makes the
    // DO UPDATE a no-op (WHERE false), so `changes === 0` means "denied".
    const expiryThreshold = now - LOCK_TTL_MS;
    const acquired = await executeD1Query(
      config,
      dbId,
      `INSERT INTO "_exepad_meta" ("key", "value", "updated_at")
       VALUES (?, ?, ?)
       ON CONFLICT("key") DO UPDATE SET
         "value" = excluded."value",
         "updated_at" = excluded."updated_at"
       WHERE CAST("_exepad_meta"."value" AS INTEGER) < ?`,
      [lockKey, lockValue, new Date(now).toISOString(), expiryThreshold]
    );

    const changes = (acquired.meta as { changes?: number } | undefined)?.changes ?? 0;
    if (changes > 0) return true;

    console.warn(`[deploy-lock] Deploy already in progress for ${appId} — denied.`);
    return false;
  } catch (error) {
    // A lock-infrastructure failure (e.g. the meta table can't be created) is
    // treated as "cannot safely deploy" and FAILS CLOSED — proceeding without a
    // lock is exactly what risks concurrent-deploy SQLite corruption.
    console.error(
      `[deploy-lock] Failed to acquire lock (refusing to deploy): ${error instanceof Error ? error.message : error}`
    );
    return false;
  }
}

/**
 * Release the deployment lock.
 *
 * When `lockToken` is provided, only deletes the lock if it still carries that
 * token — so a late release from a stale deploy (whose lock was already expired
 * and TAKEN OVER by a newer deploy) cannot delete the newer deploy's live lock.
 * When omitted, deletes by key (legacy behavior).
 */
export async function releaseDeployLock(
  config: DeploymentConfig,
  dbId: string,
  appId: string,
  lockToken?: string
): Promise<void> {
  const lockKey = `deploy_lock:${appId}`;

  if (lockToken) {
    // Match the token suffix exactly (substr after the first ':'). instr returns
    // 0 when there is no ':', making substr(value, 1) the whole value — which
    // won't equal a token, so a tokenless lock is left untouched.
    await executeD1Query(
      config,
      dbId,
      `DELETE FROM "_exepad_meta"
       WHERE "key" = ? AND substr("value", instr("value", ':') + 1) = ?`,
      [lockKey, lockToken]
    );
    return;
  }

  await executeD1Query(
    config,
    dbId,
    `DELETE FROM "_exepad_meta" WHERE "key" = ?`,
    [lockKey]
  );
}
