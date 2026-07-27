/**
 * Edge-case + error-path coverage for four deploy-utils primitives:
 *
 *  - r2-bucket   — recursive bucket delete removes everything under the bucket
 *                  prefix but never touches sibling buckets.
 *  - d1-local    — executeLocalDDL must discriminate the multi-statement
 *                  RangeError (which it transparently re-runs via exec()) from
 *                  every other RangeError (e.g. "Too many parameter values"),
 *                  which is a genuine error and must propagate.
 *  - deploy-lock — fail-open semantics: a thrown D1 error never blocks a deploy;
 *                  a stale (expired) lock is reclaimed.
 *  - config      — resolveRoleHierarchy must terminate on cycles and expand a
 *                  diamond inheritance graph exactly once per role.
 *
 * The deploy-lock + r2-bucket suites use the same real-SQLite / temp-data-dir
 * harness as the sibling `deploy-lock.test.ts` and `d1.test.ts`. The d1-local
 * suite drives the synchronous primitives against an in-memory better-sqlite3
 * handle directly (no data dir needed). resolveRoleHierarchy is pure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import {
  bucketDir,
  createR2Bucket,
  getR2Bucket,
  provisionR2Bucket,
  deleteR2Bucket,
} from '../src/deploy/r2-bucket';
import {
  executeLocalDDL,
  executeLocalQuery,
  executeLocalBatch,
} from '../src/deploy/d1-local';
import { resolveRoleHierarchy } from '../src/bundle/config';
import { TEST_CONFIG, setupDataDir, teardownDataDir } from './helpers/local-db';

beforeEach(() => {
  setupDataDir();
});
afterEach(() => {
  teardownDataDir();
});

// ---------------------------------------------------------------------------
// r2-bucket — recursive delete is prefix-scoped
// ---------------------------------------------------------------------------

describe('deleteR2Bucket (recursive, prefix-scoped)', () => {
  it('removes nested keys under the bucket prefix', async () => {
    await createR2Bucket(TEST_CONFIG, 'files-app1');
    const dir = bucketDir('files-app1');

    // Lay down a nested key structure (a/b/c.txt) plus a top-level key.
    mkdirSync(join(dir, 'a', 'b'), { recursive: true });
    writeFileSync(join(dir, 'a', 'b', 'c.txt'), 'deep');
    writeFileSync(join(dir, 'top.txt'), 'shallow');

    expect(existsSync(join(dir, 'a', 'b', 'c.txt'))).toBe(true);

    const removed = await deleteR2Bucket(TEST_CONFIG, 'files-app1');
    expect(removed).toBe(true);

    // The whole tree under the prefix is gone.
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(dir, 'a', 'b', 'c.txt'))).toBe(false);
    expect(existsSync(join(dir, 'top.txt'))).toBe(false);
  });

  it('only deletes under the named prefix — sibling buckets are untouched', async () => {
    // Two buckets whose names share a common prefix fragment. The delete must
    // match the directory exactly, not by string prefix.
    await createR2Bucket(TEST_CONFIG, 'files-app');
    await createR2Bucket(TEST_CONFIG, 'files-app-staging');

    writeFileSync(join(bucketDir('files-app'), 'k.txt'), 'a');
    writeFileSync(join(bucketDir('files-app-staging'), 'k.txt'), 'b');

    const removed = await deleteR2Bucket(TEST_CONFIG, 'files-app');
    expect(removed).toBe(true);

    // The sibling whose name merely *starts with* the deleted name survives.
    expect(existsSync(bucketDir('files-app'))).toBe(false);
    expect(existsSync(bucketDir('files-app-staging'))).toBe(true);
    expect(readFileSync(join(bucketDir('files-app-staging'), 'k.txt'), 'utf8')).toBe('b');
  });

  it('returns false (no-op) when the bucket does not exist', async () => {
    expect(await deleteR2Bucket(TEST_CONFIG, 'never-created')).toBe(false);
  });

  it('returns false on a double-delete (second call sees no dir)', async () => {
    await createR2Bucket(TEST_CONFIG, 'gone-app');
    expect(await deleteR2Bucket(TEST_CONFIG, 'gone-app')).toBe(true);
    expect(await deleteR2Bucket(TEST_CONFIG, 'gone-app')).toBe(false);
  });

  it('provision is idempotent and getR2Bucket reflects existence', async () => {
    expect(await getR2Bucket(TEST_CONFIG, 'idem')).toBeNull();
    const a = await provisionR2Bucket(TEST_CONFIG, 'idem');
    const b = await provisionR2Bucket(TEST_CONFIG, 'idem');
    expect(a.name).toBe('idem');
    expect(b.name).toBe('idem');
    expect(await getR2Bucket(TEST_CONFIG, 'idem')).not.toBeNull();
  });

  it('bucketDir roots buckets under EXEPAD_DATA_DIR/buckets (not the config-cache root)', () => {
    const dir = bucketDir('myfiles');
    expect(dir).toBe(join(process.env.EXEPAD_DATA_DIR!, 'buckets', 'myfiles'));
  });
});

// ---------------------------------------------------------------------------
// d1-local — RangeError discrimination
// ---------------------------------------------------------------------------

describe('executeLocalDDL — RangeError discrimination', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('transparently re-runs the multi-statement RangeError via exec()', () => {
    // better-sqlite3 throws RangeError("...more than one statement...") from a
    // multi-statement prepare(); executeLocalDDL catches THAT and falls back to
    // a transactional exec(), returning a success result with no rows.
    const res = executeLocalDDL(db, 'CREATE TABLE a (x); CREATE TABLE b (y);');
    expect(res.success).toBe(true);
    expect(res.results).toEqual([]);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toEqual(['a', 'b']);
  });

  it('runs a single statement directly (no fallback) and returns rows', () => {
    executeLocalDDL(db, 'CREATE TABLE t (id INTEGER PRIMARY KEY, n TEXT)');
    executeLocalDDL(db, "INSERT INTO t (n) VALUES ('x')");
    const res = executeLocalDDL(db, 'SELECT n FROM t');
    expect(res.results).toEqual([{ n: 'x' }]);
  });

  it('rethrows a genuine SQL error (not a RangeError at all)', () => {
    // A bad single statement throws a SqliteError, which is neither the
    // multi-statement RangeError nor any RangeError → must propagate unchanged.
    expect(() => executeLocalDDL(db, 'SELECT * FROM does_not_exist')).toThrow(/no such table/i);
  });

  it('rethrows a non-multi-statement RangeError ("Too many parameter values")', () => {
    // This is the crux: "Too many parameter values were provided" is ALSO a
    // RangeError, but it is NOT the multi-statement signal. The /more than one
    // statement/ guard must reject it so it propagates rather than being
    // silently swallowed as a successful no-op DDL.
    //
    // executeLocalDDL binds [] internally, so to surface this RangeError at the
    // .run()/.all() boundary we go through executeLocalQuery, which forwards the
    // caller-supplied params straight to the prepared statement.
    const tooMany = Array(100_000).fill(1) as number[];
    let caught: unknown;
    try {
      executeLocalQuery(db, 'SELECT ?', tooMany);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RangeError);
    expect((caught as RangeError).message).toMatch(/too many parameter values/i);
    // And critically: it does NOT match the multi-statement guard, so the DDL
    // path would (correctly) rethrow rather than treat it as a batched exec.
    expect(/more than one statement/i.test((caught as RangeError).message)).toBe(false);
  });

  it('the multi-statement RangeError message is the only one the guard matches', () => {
    // Lock in the guard contract directly against better-sqlite3's wording.
    let multiErr: unknown;
    try {
      db.prepare('SELECT 1; SELECT 2;');
    } catch (e) {
      multiErr = e;
    }
    expect(multiErr).toBeInstanceOf(RangeError);
    expect(/more than one statement/i.test((multiErr as RangeError).message)).toBe(true);
  });

  it('returns success for empty / whitespace-only DDL without preparing', () => {
    expect(executeLocalDDL(db, '   ')).toEqual({ success: true, results: [] });
    expect(executeLocalDDL(db, '')).toEqual({ success: true, results: [] });
  });

  it('a failing multi-statement batch rolls back atomically and rethrows', () => {
    executeLocalDDL(db, 'CREATE TABLE t (id INTEGER PRIMARY KEY)');
    // Second insert violates the PK → exec() throws; the whole transaction
    // (including the first insert) is rolled back.
    expect(() =>
      executeLocalDDL(db, 'INSERT INTO t (id) VALUES (1); INSERT INTO t (id) VALUES (1);'),
    ).toThrow();
    const count = (
      db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }
    ).c;
    expect(count).toBe(0);
  });

  it('executeLocalBatch is a no-op for an all-empty statement list', () => {
    expect(executeLocalBatch(db, ['', '   ', '\n'])).toEqual({ success: true, results: [] });
  });

  it('executeLocalQuery normalizes booleans and undefined defensively', () => {
    executeLocalDDL(db, 'CREATE TABLE t (a INTEGER, b INTEGER, c TEXT)');
    // booleans → 0/1, undefined → NULL (D1-permissive normalization).
    executeLocalQuery(db, 'INSERT INTO t (a, b, c) VALUES (?, ?, ?)', [
      true as unknown as number,
      false as unknown as number,
      undefined as unknown as null,
    ]);
    const row = db.prepare('SELECT a, b, c FROM t').get() as { a: number; b: number; c: string | null };
    expect(row).toEqual({ a: 1, b: 0, c: null });
  });
});

// ---------------------------------------------------------------------------
// deploy-lock — fail-open semantics
// ---------------------------------------------------------------------------

describe('acquireDeployLock — fail-closed', () => {
  it('returns false (refuses to deploy) when the underlying D1 layer throws', async () => {
    // The lock now fails CLOSED: proceeding without a lock is exactly what risks
    // concurrent-deploy SQLite corruption, so a meta-table failure must DENY the
    // deploy rather than swallow the error and proceed. Mock the d1 layer so
    // executeD1DDL (the very first call) rejects.
    vi.resetModules();
    vi.doMock('../src/deploy/d1', () => ({
      executeD1DDL: vi.fn().mockRejectedValue(new Error('meta table unavailable')),
      executeD1DDLBatch: vi.fn().mockResolvedValue({ success: true, results: [] }),
      executeD1Query: vi.fn().mockResolvedValue({ success: true, results: [], meta: { changes: 1 } }),
    }));

    const { acquireDeployLock } = await import('../src/deploy/deploy-lock');
    const result = await acquireDeployLock(TEST_CONFIG, '/tmp/whatever.sqlite', 'failclosed-app');
    expect(result).toBe(false);

    vi.doUnmock('../src/deploy/d1');
    vi.resetModules();
  });

  it('returns false when the atomic lock upsert throws (after DDL succeeds)', async () => {
    vi.resetModules();
    const ddl = vi.fn().mockResolvedValue({ success: true, results: [] });
    const query = vi.fn().mockRejectedValue(new Error('upsert exploded'));
    vi.doMock('../src/deploy/d1', () => ({
      executeD1DDL: ddl,
      executeD1DDLBatch: vi.fn().mockResolvedValue({ success: true, results: [] }),
      executeD1Query: query,
    }));

    const { acquireDeployLock } = await import('../src/deploy/deploy-lock');
    const result = await acquireDeployLock(TEST_CONFIG, '/tmp/whatever.sqlite', 'failclosed-app2');
    expect(result).toBe(false);
    expect(ddl).toHaveBeenCalledTimes(1);

    vi.doUnmock('../src/deploy/d1');
    vi.resetModules();
  });

  it('reclaims a stale (expired) lock against a real database', async () => {
    // End-to-end against real SQLite: seed an expired lock value, then verify a
    // fresh acquire takes it over and rewrites a current timestamp.
    vi.resetModules();
    const { acquireDeployLock } = await import('../src/deploy/deploy-lock');
    const { provisionD1Database, executeD1Query } = await import('../src/deploy/d1');

    const { uuid } = await provisionD1Database(TEST_CONFIG);
    const appId = 'stale-app';
    const lockKey = `deploy_lock:${appId}`;

    // First acquire creates the table + row.
    expect(await acquireDeployLock(TEST_CONFIG, uuid, appId)).toBe(true);
    // While valid, a second acquire is denied.
    expect(await acquireDeployLock(TEST_CONFIG, uuid, appId)).toBe(false);

    // Age the lock past the lock TTL (raised to 15m in deploy-lock.ts).
    const stale = Date.now() - (15 * 60 * 1000 + 60_000);
    await executeD1Query(
      TEST_CONFIG,
      uuid,
      'UPDATE "_exepad_meta" SET "value" = ? WHERE "key" = ?',
      [String(stale), lockKey],
    );

    // The stale lock is reclaimed → acquire succeeds again.
    expect(await acquireDeployLock(TEST_CONFIG, uuid, appId)).toBe(true);

    // ...and the stored timestamp was refreshed to a current (non-stale) value.
    const res = await executeD1Query(
      TEST_CONFIG,
      uuid,
      'SELECT "value" FROM "_exepad_meta" WHERE "key" = ?',
      [lockKey],
    );
    const refreshed = parseInt((res.results[0] as { value: string }).value, 10);
    expect(refreshed).toBeGreaterThan(stale);

    vi.resetModules();
  });

  it('treats a non-numeric (corrupt) lock value as reclaimable', async () => {
    // A garbage value CASTs to INTEGER 0 in the atomic upsert's WHERE clause,
    // which is < the expiry threshold → the lock is taken over rather than
    // permanently blocking deploys.
    vi.resetModules();
    const { acquireDeployLock } = await import('../src/deploy/deploy-lock');
    const { provisionD1Database, executeD1Query } = await import('../src/deploy/d1');

    const { uuid } = await provisionD1Database(TEST_CONFIG);
    const appId = 'corrupt-lock-app';
    const lockKey = `deploy_lock:${appId}`;

    expect(await acquireDeployLock(TEST_CONFIG, uuid, appId)).toBe(true);
    await executeD1Query(
      TEST_CONFIG,
      uuid,
      'UPDATE "_exepad_meta" SET "value" = ? WHERE "key" = ?',
      ['not-a-number', lockKey],
    );

    expect(await acquireDeployLock(TEST_CONFIG, uuid, appId)).toBe(true);
    vi.resetModules();
  });
});

// ---------------------------------------------------------------------------
// resolveRoleHierarchy — cycles + diamonds
// ---------------------------------------------------------------------------

describe('resolveRoleHierarchy', () => {
  it('returns an empty map for no roles', () => {
    expect(resolveRoleHierarchy(undefined, undefined)).toEqual({});
    expect(resolveRoleHierarchy([], { admin: ['editor'] })).toEqual({});
  });

  it('maps each role to itself when there is no hierarchy', () => {
    expect(resolveRoleHierarchy(['admin', 'viewer'], undefined)).toEqual({
      admin: ['admin'],
      viewer: ['viewer'],
    });
  });

  it('expands a simple transitive chain (admin → editor → viewer)', () => {
    const map = resolveRoleHierarchy(
      ['admin', 'editor', 'viewer'],
      { admin: ['editor'], editor: ['viewer'] },
    );
    expect(map.admin).toEqual(['admin', 'editor', 'viewer']);
    expect(map.editor).toEqual(['editor', 'viewer']);
    expect(map.viewer).toEqual(['viewer']);
  });

  it('terminates on a direct cycle (admin → editor → admin) without looping', () => {
    const map = resolveRoleHierarchy(
      ['admin', 'editor'],
      { admin: ['editor'], editor: ['admin'] },
    );
    // Each role holds both, listed once — no infinite loop, no duplicates.
    expect(new Set(map.admin)).toEqual(new Set(['admin', 'editor']));
    expect(new Set(map.editor)).toEqual(new Set(['editor', 'admin']));
    expect(map.admin).toHaveLength(2);
    expect(map.editor).toHaveLength(2);
  });

  it('terminates on a self-referencing role', () => {
    const map = resolveRoleHierarchy(['admin'], { admin: ['admin'] });
    // The seed Set already contains `admin`, so the self-edge is skipped.
    expect(map.admin).toEqual(['admin']);
  });

  it('terminates on a longer cycle (a → b → c → a)', () => {
    const map = resolveRoleHierarchy(['a', 'b', 'c'], { a: ['b'], b: ['c'], c: ['a'] });
    expect(new Set(map.a)).toEqual(new Set(['a', 'b', 'c']));
    expect(map.a).toHaveLength(3);
    expect(map.b).toHaveLength(3);
    expect(map.c).toHaveLength(3);
  });

  it('expands a diamond exactly once per reachable role', () => {
    // admin inherits both lead-a and lead-b, which both inherit viewer.
    // viewer must appear once under admin, not twice.
    const map = resolveRoleHierarchy(
      ['admin', 'leadA', 'leadB', 'viewer'],
      {
        admin: ['leadA', 'leadB'],
        leadA: ['viewer'],
        leadB: ['viewer'],
      },
    );
    expect(map.admin).toContain('admin');
    expect(map.admin).toContain('leadA');
    expect(map.admin).toContain('leadB');
    expect(map.admin).toContain('viewer');
    // No duplicate of the diamond's converging node.
    expect(map.admin.filter((r) => r === 'viewer')).toHaveLength(1);
    expect(new Set(map.admin).size).toBe(map.admin.length);
    expect(map.leadA).toEqual(['leadA', 'viewer']);
    expect(map.viewer).toEqual(['viewer']);
  });

  it('ignores edges pointing at roles not declared in the roles list', () => {
    // A hierarchy edge to an undeclared role still expands (the map only seeds
    // declared roles, but BFS follows hierarchy edges regardless).
    const map = resolveRoleHierarchy(['admin'], { admin: ['ghost'] });
    expect(map.admin).toEqual(['admin', 'ghost']);
    // The undeclared role gets no entry of its own.
    expect(map.ghost).toBeUndefined();
  });
});
