/**
 * Mock D1 Database for tests
 */

interface QueryRecord {
  sql: string;
  binds: unknown[];
}

interface MockD1Options {
  /** Map of SQL pattern → result rows */
  results?: Map<string, Record<string, unknown>[]>;
  /** Default result for unmatched queries */
  defaultResult?: Record<string, unknown>[];
  /** If true, .first() returns null */
  firstReturnsNull?: boolean;
}

/**
 * Create a mock D1PreparedStatement
 */
function createMockStatement(
  sql: string,
  queries: QueryRecord[],
  opts: MockD1Options
): D1PreparedStatement {
  let boundValues: unknown[] = [];

  const findResult = (): Record<string, unknown>[] => {
    if (opts.results) {
      for (const [pattern, rows] of opts.results) {
        if (sql.includes(pattern)) return rows;
      }
    }
    return opts.defaultResult ?? [];
  };

  const stmt: D1PreparedStatement = {
    bind(...args: unknown[]) {
      boundValues = args;
      queries.push({ sql, binds: args });
      return stmt;
    },
    async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
      if (!queries.some((q) => q.sql === sql)) {
        queries.push({ sql, binds: boundValues });
      }
      if (opts.firstReturnsNull) return null;
      const rows = findResult();
      if (rows.length === 0) return null;
      if (column) return rows[0][column] as T;
      return rows[0] as T;
    },
    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      if (!queries.some((q) => q.sql === sql)) {
        queries.push({ sql, binds: boundValues });
      }
      const rows = findResult();
      return {
        results: rows as T[],
        success: true,
        meta: {
          duration: 0,
          served_by: 'mock',
          changes: rows.length,
          last_row_id: rows.length,
          changed_db: true,
          size_after: 0,
          rows_read: rows.length,
          rows_written: 0,
        },
      };
    },
    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      if (!queries.some((q) => q.sql === sql)) {
        queries.push({ sql, binds: boundValues });
      }
      return {
        results: [] as T[],
        success: true,
        meta: {
          duration: 0,
          served_by: 'mock',
          changes: 1,
          last_row_id: 1,
          changed_db: true,
          size_after: 0,
          rows_read: 0,
          rows_written: 1,
        },
      };
    },
    async raw<T = unknown[]>(): Promise<T[]> {
      return [] as T[];
    },
  };

  return stmt;
}

/**
 * Create a mock D1Database with trackable queries
 */
export function createMockD1(opts: MockD1Options = {}): D1Database & { _queries: QueryRecord[] } {
  const queries: QueryRecord[] = [];

  const db = {
    _queries: queries,
    prepare(sql: string) {
      return createMockStatement(sql, queries, opts);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const results: D1Result<T>[] = [];
      for (const stmt of statements) {
        results.push(await (stmt as D1PreparedStatement).all() as D1Result<T>);
      }
      return results;
    },
    async dump(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0);
    },
    async exec(sql: string): Promise<D1ExecResult> {
      queries.push({ sql, binds: [] });
      return { count: 1, duration: 0 };
    },
  } as D1Database & { _queries: QueryRecord[] };

  return db;
}

/**
 * Get all executed queries from a mock D1
 */
export function getExecutedQueries(db: D1Database & { _queries: QueryRecord[] }): QueryRecord[] {
  return db._queries;
}
