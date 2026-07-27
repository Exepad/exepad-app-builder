/**
 * LocalD1 — a Cloudflare D1 (`D1Database`) compatible adapter over
 * better-sqlite3, for the self-hosted single-container runtime.
 *
 * The public API (`prepare().bind().first()/all()/run()/raw()`, `batch()`,
 * `exec()`, `dump()`) mirrors D1's ASYNC surface so every existing call site in
 * `apps/app-backend/src/crud/*` and `packages/deploy-utils` works unchanged.
 * Internally better-sqlite3 is SYNCHRONOUS — each statement has a sync `_core()`
 * that produces a `D1Result`; the async methods just wrap it in a resolved
 * Promise, and `batch()` runs the sync cores inside one `db.transaction()` so
 * D1's all-or-nothing batch semantics hold.
 *
 * Assign at the binding site as `env.DB = new LocalD1(db) as unknown as D1Database`.
 */
import type BetterSqlite3 from 'better-sqlite3';

// better-sqlite3 does not cache compiled statements internally, so we keep a
// per-DB-handle cache keyed by SQL text. Bounded with FIFO eviction to cap the
// number of live prepared statements per connection.
type StmtCache = Map<string, BetterSqlite3.Statement>;
const STMT_CACHE_MAX = 200;

export interface D1ResultMeta {
  duration: number;
  served_by: string;
  changes: number;
  last_row_id: number;
  changed_db: boolean;
  size_after: number;
  rows_read: number;
  rows_written: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1ResultMeta;
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

function meta(partial: Partial<D1ResultMeta>): D1ResultMeta {
  return {
    duration: 0,
    served_by: 'local-d1',
    changes: 0,
    last_row_id: 0,
    changed_db: false,
    size_after: 0,
    rows_read: 0,
    rows_written: 0,
    ...partial,
  };
}

/**
 * Normalize a bound value to something better-sqlite3 accepts. D1 is permissive
 * (booleans → 0/1, undefined → NULL); better-sqlite3 only accepts
 * number | bigint | string | Buffer | Uint8Array | null.
 */
function normalizeParam(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (
    typeof v === 'number' ||
    typeof v === 'bigint' ||
    typeof v === 'string' ||
    v instanceof Uint8Array ||
    Buffer.isBuffer(v)
  ) {
    return v;
  }
  // Objects/arrays aren't valid SQLite params; the CRUD layer JSON-encodes
  // these before binding, but guard defensively.
  return JSON.stringify(v);
}

class LocalD1Statement {
  constructor(
    private readonly db: BetterSqlite3.Database,
    private readonly sql: string,
    private readonly params: unknown[] = [],
    private readonly cache: StmtCache = new Map(),
  ) {}

  bind(...args: unknown[]): LocalD1Statement {
    return new LocalD1Statement(this.db, this.sql, args, this.cache);
  }

  /** Compile-once lookup of the underlying prepared statement for this SQL. */
  private prepared(): BetterSqlite3.Statement {
    let stmt = this.cache.get(this.sql);
    if (!stmt) {
      stmt = this.db.prepare(this.sql);
      if (this.cache.size >= STMT_CACHE_MAX) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(this.sql, stmt);
    }
    return stmt;
  }

  /** Synchronous core — returns a D1Result. Used by all(), run(), and batch(). */
  _core(): D1Result {
    const stmt = this.prepared();
    const args = this.params.map(normalizeParam);
    if (stmt.reader) {
      const rows = stmt.all(...args) as Record<string, unknown>[];
      return {
        results: rows,
        success: true,
        meta: meta({ changes: 0, rows_read: rows.length, changed_db: false }),
      };
    }
    const info = stmt.run(...args);
    return {
      results: [],
      success: true,
      meta: meta({
        changes: info.changes,
        last_row_id: Number(info.lastInsertRowid),
        rows_written: info.changes,
        changed_db: info.changes > 0,
      }),
    };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const stmt = this.prepared();
    if (!stmt.reader) {
      // first() on a non-reader still executes the statement in D1.
      this._core();
      return null;
    }
    const row = stmt.get(...this.params.map(normalizeParam)) as Record<string, unknown> | undefined;
    if (row == null) return null;
    if (column !== undefined) return (row[column] ?? null) as T;
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this._core() as D1Result<T>;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this._core() as D1Result<T>;
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const stmt = this.prepared();
    if (!stmt.reader) return [] as T[];
    stmt.raw(true);
    try {
      return stmt.all(...this.params.map(normalizeParam)) as T[];
    } finally {
      // The cached statement is shared; restore object-mode so later all()/get()
      // callers on the same SQL are not corrupted into array-returning mode.
      stmt.raw(false);
    }
  }
}

export class LocalD1 {
  // One shared prepared-statement cache per DB handle.
  private readonly stmtCache: StmtCache = new Map();

  constructor(private readonly db: BetterSqlite3.Database) {}

  /** The underlying better-sqlite3 handle (for deploy-time DDL/migrations). */
  get raw(): BetterSqlite3.Database {
    return this.db;
  }

  prepare(sql: string): LocalD1Statement {
    return new LocalD1Statement(this.db, sql, [], this.stmtCache);
  }

  async batch<T = unknown>(statements: LocalD1Statement[]): Promise<D1Result<T>[]> {
    const tx = this.db.transaction((stmts: LocalD1Statement[]) => stmts.map((s) => s._core()));
    return tx(statements) as D1Result<T>[];
  }

  async exec(sql: string): Promise<D1ExecResult> {
    this.db.exec(sql);
    const count = sql.split(';').filter((s) => s.trim().length > 0).length;
    return { count, duration: 0 };
  }

  async dump(): Promise<ArrayBuffer> {
    const buf = this.db.serialize();
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }
}
