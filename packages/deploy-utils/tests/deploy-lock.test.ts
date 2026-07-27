/**
 * Tests for the deployment lock.
 *
 * The lock runs against a real `better-sqlite3` `_exepad_meta` table under
 * `$EXEPAD_DATA_DIR/apps/{appId}/{mode}.sqlite` — no Cloudflare D1 REST API.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { acquireDeployLock, releaseDeployLock } from '../src/deploy/deploy-lock';
import { provisionD1Database, executeD1Query } from '../src/deploy/d1';
import { TEST_CONFIG, setupDataDir, teardownDataDir } from './helpers/local-db';

beforeEach(() => {
  setupDataDir();
});
afterEach(() => {
  teardownDataDir();
});

// Mirrors LOCK_TTL_MS in src/deploy/deploy-lock.ts (raised to 15m so a long
// image-heavy publish can't have its lock stolen mid-flight).
const LOCK_TTL_MS = 15 * 60 * 1000;
const APP_ID = 'test-app';
const lockKey = (appId: string) => `deploy_lock:${appId}`;

/** Overwrite the stored lock timestamp to simulate an aged lock. */
async function setLockTimestamp(dbId: string, appId: string, ms: number): Promise<void> {
  await executeD1Query(
    TEST_CONFIG,
    dbId,
    'UPDATE "_exepad_meta" SET "value" = ? WHERE "key" = ?',
    [String(ms), lockKey(appId)],
  );
}

/** Read back the raw stored lock value (or null when absent). */
async function getLockValue(dbId: string, appId: string): Promise<string | null> {
  const res = await executeD1Query(
    TEST_CONFIG,
    dbId,
    'SELECT "value" FROM "_exepad_meta" WHERE "key" = ?',
    [lockKey(appId)],
  );
  if (!res.results || res.results.length === 0) return null;
  return (res.results[0] as Record<string, unknown>).value as string;
}

describe('acquireDeployLock', () => {
  it('acquires the lock on a fresh database', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);

    const result = await acquireDeployLock(TEST_CONFIG, uuid, APP_ID);
    expect(result).toBe(true);

    // The lock row was actually written.
    const value = await getLockValue(uuid, APP_ID);
    expect(value).not.toBeNull();
    expect(Number.isNaN(parseInt(value!, 10))).toBe(false);
  });

  it('denies a second acquire while the lock is held', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);

    const first = await acquireDeployLock(TEST_CONFIG, uuid, APP_ID);
    expect(first).toBe(true);

    const second = await acquireDeployLock(TEST_CONFIG, uuid, APP_ID);
    expect(second).toBe(false);
  });

  it('allows re-acquiring after release', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);

    expect(await acquireDeployLock(TEST_CONFIG, uuid, APP_ID)).toBe(true);
    expect(await acquireDeployLock(TEST_CONFIG, uuid, APP_ID)).toBe(false);

    await releaseDeployLock(TEST_CONFIG, uuid, APP_ID);

    // The row is gone after release.
    expect(await getLockValue(uuid, APP_ID)).toBeNull();

    expect(await acquireDeployLock(TEST_CONFIG, uuid, APP_ID)).toBe(true);
  });

  it('takes over an expired lock', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);

    expect(await acquireDeployLock(TEST_CONFIG, uuid, APP_ID)).toBe(true);

    // Age the stored timestamp past the 5-minute TTL so it counts as expired.
    const stale = Date.now() - (LOCK_TTL_MS + 60_000);
    await setLockTimestamp(uuid, APP_ID, stale);

    const result = await acquireDeployLock(TEST_CONFIG, uuid, APP_ID);
    expect(result).toBe(true);

    // The lock value was refreshed to a fresh (non-stale) timestamp.
    const value = await getLockValue(uuid, APP_ID);
    expect(parseInt(value!, 10)).toBeGreaterThan(stale);
  });

  it('keeps a recently-held lock denied even just under the TTL', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);

    expect(await acquireDeployLock(TEST_CONFIG, uuid, APP_ID)).toBe(true);

    // 30s ago is well within the 5-minute TTL → still held.
    await setLockTimestamp(uuid, APP_ID, Date.now() - 30_000);

    expect(await acquireDeployLock(TEST_CONFIG, uuid, APP_ID)).toBe(false);
  });

  it('scopes locks per app id', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);

    expect(await acquireDeployLock(TEST_CONFIG, uuid, 'app-one')).toBe(true);
    // A different app id is a different lock key → independent acquire succeeds.
    expect(await acquireDeployLock(TEST_CONFIG, uuid, 'app-two')).toBe(true);
    // ...while the first app's lock remains held.
    expect(await acquireDeployLock(TEST_CONFIG, uuid, 'app-one')).toBe(false);
  });
});

describe('releaseDeployLock', () => {
  it('removes the lock entry', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);

    await acquireDeployLock(TEST_CONFIG, uuid, APP_ID);
    expect(await getLockValue(uuid, APP_ID)).not.toBeNull();

    await releaseDeployLock(TEST_CONFIG, uuid, APP_ID);
    expect(await getLockValue(uuid, APP_ID)).toBeNull();
  });

  it('with a token, does NOT delete a lock that was taken over by a different deploy', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);

    // Deploy A takes the lock, then its lock ages out.
    expect(await acquireDeployLock(TEST_CONFIG, uuid, APP_ID, 'corr-A')).toBe(true);
    await setLockTimestamp(uuid, APP_ID, Date.now() - (LOCK_TTL_MS + 60_000));

    // Deploy B takes over the expired lock with its own token.
    expect(await acquireDeployLock(TEST_CONFIG, uuid, APP_ID, 'corr-B')).toBe(true);
    expect(await getLockValue(uuid, APP_ID)).toContain(':corr-B');

    // A late release from stale deploy A must NOT delete B's live lock.
    await releaseDeployLock(TEST_CONFIG, uuid, APP_ID, 'corr-A');
    expect(await getLockValue(uuid, APP_ID)).toContain(':corr-B');

    // B releasing its own lock clears it.
    await releaseDeployLock(TEST_CONFIG, uuid, APP_ID, 'corr-B');
    expect(await getLockValue(uuid, APP_ID)).toBeNull();
  });

  it('is a no-op when no lock is held (table created by acquire elsewhere)', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);

    // Create the meta table via an acquire on another app so the DELETE has a
    // table to target, then release an app that never held a lock.
    await acquireDeployLock(TEST_CONFIG, uuid, 'other-app');

    await expect(releaseDeployLock(TEST_CONFIG, uuid, 'never-locked')).resolves.toBeUndefined();
    // The unrelated lock is untouched.
    expect(await getLockValue(uuid, 'other-app')).not.toBeNull();
  });
});
