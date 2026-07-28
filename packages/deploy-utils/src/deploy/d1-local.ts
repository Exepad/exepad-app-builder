/**
 * Local SQLite execution primitives.
 *
 * These replace the Cloudflare D1 REST API as the execution backend for the
 * deploy pipeline (migrations, system tables, seed, versioning, deploy-lock,
 * rollback). They operate directly on a `better-sqlite3` handle — the SAME
 * pooled handle the runtime binds to `env.DB` — so deploy-time writes are
 * immediately visible to the in-process app-backend.
 *
 * better-sqlite3 is synchronous; these helpers are too. The public wrappers in
 * `d1.ts` keep D1's async signatures by returning resolved Promises.
 */
import type BetterSqlite3 from 'better-sqlite3';

export interface LocalExecResult {
  success: boolean;
  results: unknown[];
  meta?: { changes: number; last_row_id: number; rows_read: number };
}

/**
 * D1 is permissive with bound values (booleans → 0/1, undefined → NULL);
 * better-sqlite3 only accepts number | bigint | string | Buffer | Uint8Array |
 * null. The deploy paths bind only scalars, but normalize defensively.
 */
function norm(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

/** Run a single statement (reader → rows, writer → change counts). */
function runSingle(
  db: BetterSqlite3.Database,
  sql: string,
  params: unknown[],
): LocalExecResult {
  const stmt = db.prepare(sql);
  const args = params.map(norm);
  if (stmt.reader) {
    const rows = stmt.all(...args) as unknown[];
    return { success: true, results: rows, meta: { changes: 0, last_row_id: 0, rows_read: rows.length } };
  }
  const info = stmt.run(...args);
  return {
    success: true,
    results: [],
    meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid), rows_read: 0 },
  };
}

/**
 * Execute DDL or DML. Accepts a single statement (returns rows for
 * SELECT/PRAGMA, change counts otherwise) OR a multi-statement string
 * (run atomically in one transaction; no per-row results — matching D1's
 * batched-DDL semantics). Mirrors the old `executeD1DDL` contract.
 */
export function executeLocalDDL(db: BetterSqlite3.Database, sql: string): LocalExecResult {
  const trimmed = sql.trim();
  if (!trimmed) return { success: true, results: [] };
  try {
    return runSingle(db, trimmed, []);
  } catch (err) {
    // better-sqlite3 throws RangeError on a multi-statement prepare(); fall
    // back to a transactional exec() (no result rows). Any other prepare error
    // is a genuine SQL error — rethrow it.
    if (err instanceof RangeError && /more than one statement/i.test(err.message)) {
      db.transaction(() => db.exec(trimmed))();
      return { success: true, results: [], meta: { changes: 0, last_row_id: 0, rows_read: 0 } };
    }
    throw err;
  }
}

/** Execute a single parameterized statement (`?` placeholders). */
export function executeLocalQuery(
  db: BetterSqlite3.Database,
  sql: string,
  params: (string | number | null)[] = [],
): LocalExecResult {
  return runSingle(db, sql, params);
}

/** Execute several DDL statements atomically in one transaction. */
export function executeLocalBatch(
  db: BetterSqlite3.Database,
  statements: string[],
): LocalExecResult {
  const nonEmpty = statements.map((s) => s.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return { success: true, results: [] };
  const joined = nonEmpty.join(';\n');
  db.transaction(() => db.exec(joined))();
  return { success: true, results: [], meta: { changes: 0, last_row_id: 0, rows_read: 0 } };
}
