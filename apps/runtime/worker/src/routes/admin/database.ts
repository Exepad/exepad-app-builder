/**
 * Admin Database Routes
 *
 * GET    /tables                               — List user tables with row counts
 * GET    /tables/:tableName/schema             — Column and index info
 * GET    /tables/:tableName/rows               — Paginated rows with optional search
 * POST   /tables/:tableName/rows               — Insert a new row
 * PUT    /tables/:tableName/rows/:rowId        — Update a row
 * DELETE /tables/:tableName/rows/:rowId        — Delete a row
 */

import { Hono } from 'hono';
import type { Env } from '../../types/env';
import { authenticateAdmin, isAdminAuthError } from '../../lib/admin-auth';
import { escapeLikePattern } from '../../lib/sql-utils';
import { executeD1DDL, executeD1Query } from '@exepad/deploy-utils';

export const database = new Hono<{ Bindings: Env }>();

// ── SQL helpers (inlined from admin/lib/sql-builders) ────────

function isSystemTable(tableName: string): boolean {
  const lower = tableName.toLowerCase();
  // The platform reserves the ENTIRE leading-underscore namespace for its own
  // tables (_auth_*, _files, _user_settings, _notifications, _bookings, _forms,
  // _blog_*, …). The deploy-utils schema builder forbids user models from
  // starting with '_', so treating any leading-'_' name as a system table can
  // never hide a legitimate user table — and it stops the generic row endpoints
  // from bypassing dedicated handlers (e.g. mutating _files outside the
  // soft-delete + R2-cleanup path). Plus SQLite's own `sqlite_*` tables.
  return lower.startsWith('_') || lower.startsWith('sqlite_');
}

const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function isValidIdentifier(name: string): boolean {
  return SAFE_IDENTIFIER.test(name) && name.length <= 128;
}

function escapeIdentifier(name: string): string {
  if (!isValidIdentifier(name)) throw new Error(`Invalid identifier: ${name}`);
  return `"${name.replace(/"/g, '""')}"`;
}

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: boolean;
  dflt_value: string | null;
  pk: boolean;
}

interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

type DeployConfig = { accountId: string; apiToken: string; wfpNamespace: string; appId: string; appAlias: string };

async function getColumns(config: DeployConfig, dbId: string, tableName: string): Promise<ColumnInfo[]> {
  const result = await executeD1DDL(config, dbId, `PRAGMA table_info(${escapeIdentifier(tableName)})`);
  return (result.results as { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[])
    .map((row) => ({
      cid: row.cid, name: row.name, type: row.type,
      notnull: row.notnull === 1, dflt_value: row.dflt_value, pk: row.pk === 1,
    }));
}

async function validateTable(
  config: DeployConfig, dbId: string, tableName: string
): Promise<Response | null> {
  if (!isValidIdentifier(tableName)) {
    return Response.json({ success: false, error: `Invalid table name: ${tableName}` }, { status: 400 });
  }
  if (isSystemTable(tableName)) {
    return Response.json({ success: false, error: `Access denied: ${tableName} is a system table` }, { status: 403 });
  }
  const exists = await executeD1Query(
    config, dbId,
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [tableName]
  );
  if ((exists.results as unknown[]).length === 0) {
    return Response.json({ success: false, error: `Table not found: ${tableName}` }, { status: 404 });
  }
  return null;
}

function findPrimaryKey(columns: ColumnInfo[]): string | null {
  const pk = columns.find((c) => c.pk);
  return pk ? pk.name : null;
}

/**
 * True when the table has a COMPOSITE primary key (>1 pk column). The row
 * editor keys UPDATE/DELETE on a single `<pk> = ?` clause, which would match
 * (and mutate/delete) every row sharing that one key component on a composite
 * table — silent multi-row data loss. Agent-generated models never produce a
 * composite PK (the schema builder emits at most one inline PRIMARY KEY), but a
 * table imported or created out-of-band by a raw-DDL handler could, so the
 * single-id row endpoints reject it rather than risk it.
 */
function hasCompositePrimaryKey(columns: ColumnInfo[]): boolean {
  return columns.filter((c) => c.pk).length > 1;
}

// ── GET /tables — List tables ───────────────────────────────

database.get('/tables', async (c) => {
  const appId = c.req.param('appId')!;
  const mode = c.req.query('mode') || 'published';
  // Read-only: never provision a DB just to list tables (write-on-read).
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode, { createIfMissing: false });
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);
  if (auth.dbMissing) return c.json({ success: true, data: [] });

  const { config, dbId } = auth;

  try {
    const tablesResult = await executeD1DDL(
      config, dbId,
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    );
    const allTables = tablesResult.results as { name: string }[];
    const userTables = allTables.filter((t) => !isSystemTable(t.name));

    const tables = await Promise.all(
      userTables.map(async (t) => {
        try {
          const countResult = await executeD1DDL(
            config, dbId,
            `SELECT COUNT(*) as total FROM ${escapeIdentifier(t.name)}`
          );
          const row = (countResult.results as { total: number }[])[0];
          return { name: t.name, rowCount: row?.total ?? 0 };
        } catch (err) {
          console.warn(`[Database] Failed to count rows in "${t.name}":`, err instanceof Error ? err.message : err);
          return { name: t.name, rowCount: 0 };
        }
      })
    );

    return c.json({ success: true, data: tables });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

// ── GET /tables/:tableName/schema — Table schema ────────────

database.get('/tables/:tableName/schema', async (c) => {
  const appId = c.req.param('appId')!;
  const tableName = c.req.param('tableName')!;
  const mode = c.req.query('mode') || 'published';
  // Read-only: never provision a DB just to read a table schema.
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode, { createIfMissing: false });
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);
  if (auth.dbMissing) return c.json({ success: false, error: `Table not found: ${tableName}` }, 404);

  const { config, dbId } = auth;

  try {
    const tableError = await validateTable(config, dbId, tableName);
    if (tableError) return tableError;

    const columns = await getColumns(config, dbId, tableName);

    const indexListResult = await executeD1DDL(
      config, dbId,
      `PRAGMA index_list(${escapeIdentifier(tableName)})`
    );
    const rawIndexes = indexListResult.results as { name: string; unique: number }[];

    const indexes: IndexInfo[] = await Promise.all(
      rawIndexes.map(async (idx) => {
        const indexInfoResult = await executeD1DDL(
          config, dbId,
          `PRAGMA index_info(${escapeIdentifier(idx.name)})`
        );
        const indexColumns = (indexInfoResult.results as { name: string }[]).map((col) => col.name);
        return { name: idx.name, unique: idx.unique === 1, columns: indexColumns };
      })
    );

    return c.json({ success: true, data: { name: tableName, columns, indexes } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

// ── GET /tables/:tableName/rows — List rows ─────────────────

database.get('/tables/:tableName/rows', async (c) => {
  const appId = c.req.param('appId')!;
  const tableName = c.req.param('tableName')!;
  const mode = c.req.query('mode') || 'published';
  // Read-only: never provision a DB just to page through rows.
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode, { createIfMissing: false });
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);
  if (auth.dbMissing) {
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20', 10)));
    return c.json({
      success: true,
      data: [],
      pagination: { page, pageSize, total: 0, totalPages: 0 },
      columns: [],
    });
  }

  const { config, dbId } = auth;

  try {
    const tableError = await validateTable(config, dbId, tableName);
    if (tableError) return tableError;

    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20', 10)));
    const search = c.req.query('search') || undefined;

    const columns = await getColumns(config, dbId, tableName);

    const textColumns = columns
      .filter((col) => {
        const upper = col.type.toUpperCase();
        return upper.includes('TEXT') || upper.includes('VARCHAR') || upper.includes('CHAR');
      })
      .map((col) => col.name);

    const searchColumns = search && textColumns.length > 0 ? textColumns : undefined;

    // Build count query
    const countParams: (string | number | null)[] = [];
    let countSql = `SELECT COUNT(*) as total FROM ${escapeIdentifier(tableName)}`;
    const likeTerm = search ? `%${escapeLikePattern(search)}%` : '';
    if (search && searchColumns && searchColumns.length > 0) {
      const whereClauses = searchColumns.map((col) => {
        countParams.push(likeTerm);
        return `${escapeIdentifier(col)} LIKE ? ESCAPE '\\'`;
      });
      countSql += ` WHERE ${whereClauses.join(' OR ')}`;
    }

    const countResult = await executeD1Query(config, dbId, countSql, countParams);
    const total = ((countResult.results as { total: number }[])[0]?.total) ?? 0;

    // Build select query
    const selectParams: (string | number | null)[] = [];
    let selectSql = `SELECT * FROM ${escapeIdentifier(tableName)}`;
    if (search && searchColumns && searchColumns.length > 0) {
      const whereClauses = searchColumns.map((col) => {
        selectParams.push(likeTerm);
        return `${escapeIdentifier(col)} LIKE ? ESCAPE '\\'`;
      });
      selectSql += ` WHERE ${whereClauses.join(' OR ')}`;
    }
    selectSql += ` LIMIT ? OFFSET ?`;
    selectParams.push(pageSize, (page - 1) * pageSize);

    const rowsResult = await executeD1Query(config, dbId, selectSql, selectParams);

    return c.json({
      success: true,
      data: rowsResult.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      columns,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

// ── POST /tables/:tableName/rows — Insert row ──────────────

database.post('/tables/:tableName/rows', async (c) => {
  const appId = c.req.param('appId')!;
  const tableName = c.req.param('tableName')!;
  const mode = c.req.query('mode') || 'published';
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode);
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);

  const { config, dbId } = auth;

  try {
    const tableError = await validateTable(config, dbId, tableName);
    if (tableError) return tableError;

    const body = await c.req.json<{ data?: Record<string, unknown> }>();
    const data = body?.data;

    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      return c.json(
        { success: false, error: 'Request body must include a non-empty "data" object' },
        400
      );
    }

    const columns = await getColumns(config, dbId, tableName);
    const validColumns = new Set(columns.map((col) => col.name));
    const dataColumns = Object.keys(data);

    for (const col of dataColumns) {
      if (!validColumns.has(col)) {
        return c.json({ success: false, error: `Unknown column: ${col}` }, 400);
      }
    }

    const colList = dataColumns.map(escapeIdentifier).join(', ');
    const placeholders = dataColumns.map(() => '?').join(', ');
    const sql = `INSERT INTO ${escapeIdentifier(tableName)} (${colList}) VALUES (${placeholders})`;
    const values = dataColumns.map((col) => data[col] as string | number | null);

    const result = await executeD1Query(config, dbId, sql, values);
    const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;

    return c.json({ success: true, data: { message: 'Row inserted', changes } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith('Unknown column') ? 400 : 500;
    return c.json({ success: false, error: message }, status);
  }
});

// ── PUT /tables/:tableName/rows/:rowId — Update row ────────

database.put('/tables/:tableName/rows/:rowId', async (c) => {
  const appId = c.req.param('appId')!;
  const tableName = c.req.param('tableName')!;
  const rowId = c.req.param('rowId')!;
  const mode = c.req.query('mode') || 'published';
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode);
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);

  const { config, dbId } = auth;

  try {
    const tableError = await validateTable(config, dbId, tableName);
    if (tableError) return tableError;

    const body = await c.req.json<{ data?: Record<string, unknown> }>();
    const data = body?.data;

    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      return c.json(
        { success: false, error: 'Request body must include a non-empty "data" object' },
        400
      );
    }

    const columns = await getColumns(config, dbId, tableName);
    const pkColumn = findPrimaryKey(columns);
    if (!pkColumn) {
      return c.json({ success: false, error: `Table ${tableName} has no primary key column` }, 400);
    }
    if (hasCompositePrimaryKey(columns)) {
      return c.json(
        { success: false, error: `Table ${tableName} has a composite primary key and cannot be edited row-by-row through this endpoint` },
        400,
      );
    }

    const validColumns = new Set(columns.map((col) => col.name));
    const updateColumns = Object.keys(data);

    for (const col of updateColumns) {
      if (!validColumns.has(col)) {
        return c.json({ success: false, error: `Unknown column: ${col}` }, 400);
      }
    }

    const setClauses = updateColumns.map((col) => `${escapeIdentifier(col)} = ?`).join(', ');
    const sql = `UPDATE ${escapeIdentifier(tableName)} SET ${setClauses} WHERE ${escapeIdentifier(pkColumn)} = ?`;
    const values = [
      ...updateColumns.map((col) => data[col] as string | number | null),
      rowId,
    ];

    const result = await executeD1Query(config, dbId, sql, values);
    const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;

    if (changes === 0) {
      return c.json({ success: false, error: `Row not found with ${pkColumn} = ${rowId}` }, 404);
    }

    return c.json({ success: true, data: { message: 'Row updated', changes } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith('Unknown column') ? 400 : 500;
    return c.json({ success: false, error: message }, status);
  }
});

// ── DELETE /tables/:tableName/rows/:rowId — Delete row ──────

database.delete('/tables/:tableName/rows/:rowId', async (c) => {
  const appId = c.req.param('appId')!;
  const tableName = c.req.param('tableName')!;
  const rowId = c.req.param('rowId')!;
  const mode = c.req.query('mode') || 'published';
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode);
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);

  const { config, dbId } = auth;

  try {
    const tableError = await validateTable(config, dbId, tableName);
    if (tableError) return tableError;

    const columns = await getColumns(config, dbId, tableName);
    const pkColumn = findPrimaryKey(columns);
    if (!pkColumn) {
      return c.json({ success: false, error: `Table ${tableName} has no primary key column` }, 400);
    }
    if (hasCompositePrimaryKey(columns)) {
      return c.json(
        { success: false, error: `Table ${tableName} has a composite primary key and cannot be deleted row-by-row through this endpoint` },
        400,
      );
    }

    const sql = `DELETE FROM ${escapeIdentifier(tableName)} WHERE ${escapeIdentifier(pkColumn)} = ?`;
    const result = await executeD1Query(config, dbId, sql, [rowId]);
    const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;

    if (changes === 0) {
      return c.json({ success: false, error: `Row not found with ${pkColumn} = ${rowId}` }, 404);
    }

    return c.json({ success: true, data: { message: 'Row deleted', changes } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});
