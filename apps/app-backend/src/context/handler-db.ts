/**
 * Handler DB wrapper — auto-fill system columns on raw INSERTs.
 *
 * Every model table declares `owner_id`, `created_at`, `updated_at` as
 * `NOT NULL` with **no SQL default** (see `SYSTEM_COLUMNS` in
 * `@exepad/deploy-utils`). The auto-CRUD create path fills them from the
 * caller + clock (`crud/create.ts`), but a custom handler that writes with
 * raw SQL — `ctx.db.prepare('INSERT INTO orders (...) VALUES (...)')` — does
 * not, so SQLite rejects the row with `NOT NULL constraint failed:
 * orders.owner_id`. That broke checkout on any app whose handler inserts into
 * an owned model.
 *
 * This wrapper extends the same auto-fill contract to handler `ctx.db`
 * INSERTs: for an INSERT (single- or multi-row `VALUES`) into a *known model*
 * table that omits any of the auto-managed system columns, it appends those
 * columns (and their trusted values) so the write succeeds. It is intentionally
 * conservative — anything it doesn't positively recognise (unknown table,
 * INSERT…SELECT, no column list) is passed through untouched, so it can only
 * make a failing INSERT succeed, never corrupt a valid one.
 *
 * A handler that sets a system column explicitly (e.g. an admin creating a row
 * on another user's behalf with an explicit `owner_id`) is respected — present
 * columns are never overwritten.
 *
 * Scope: only `ctx.db.prepare(...)` is intercepted. A handler that writes via
 * `ctx.db.exec(...)` (no bind params; used for DDL/scripts) is not rewritten —
 * such a write must set the system columns itself.
 */

import type { ModelProps } from '../types/env';

/**
 * System columns that are `NOT NULL` with no SQL default and therefore MUST be
 * present in every INSERT. Kept in sync with `@exepad/deploy-utils`'
 * `SYSTEM_COLUMNS`. `id` is excluded — it is `INTEGER PRIMARY KEY` (auto).
 */
const AUTO_FILLED_SYSTEM_COLUMNS = ['owner_id', 'created_at', 'updated_at'] as const;
type AutoFilledColumn = (typeof AUTO_FILLED_SYSTEM_COLUMNS)[number];

type AutoFillValues = Record<AutoFilledColumn, string>;

/** Single-quote-escape a trusted string value for inline SQL. */
function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Split a parenthesised INSERT column list into bare, unquoted names. */
function parseColumnList(raw: string): string[] {
  return raw
    .split(',')
    .map((c) => c.trim().replace(/^["'`]|["'`]$/g, '').trim())
    .filter(Boolean);
}

// INSERT [OR ...] INTO <table> ( … (or REPLACE INTO …) — captures the prefix
// through the '(' that opens the column list. The table name may be bare or
// "double"/`back`-quoted.
const INSERT_HEAD_RE =
  /^\s*(?:INSERT(?:\s+OR\s+\w+)?|REPLACE)\s+INTO\s+(["'`]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*\(/i;

/**
 * Index of the ')' that closes the parenthesised group whose opening '(' is at
 * `openParenIdx`. Quote- and depth-aware (handles `')'` inside string
 * literals and nested `func(?)` calls). Returns -1 if unbalanced.
 */
function findGroupClose(sql: string, openParenIdx: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = openParenIdx; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          i++; // skip the escaped quote
          continue;
        }
        inStr = false;
      }
      continue;
    }
    if (ch === "'") inStr = true;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Rewrite an INSERT into a known model table so it also sets the auto-managed
 * system columns it omitted. Handles both single-row and multi-row
 * `VALUES (…),(…)` — the same literals are spliced into every tuple, so all
 * rows stay column-consistent. Returns the rewritten SQL, or `null` when the
 * statement should be left untouched.
 *
 * `modelNames` is matched case-insensitively (SQLite identifiers are), so pass
 * a lowercased set.
 */
export function injectSystemColumnsIntoInsert(
  sql: string,
  modelNames: ReadonlySet<string>,
  values: AutoFillValues,
): string | null {
  const head = INSERT_HEAD_RE.exec(sql);
  if (!head) return null;

  const table = head[2];
  if (!modelNames.has(table.toLowerCase())) return null;

  // Column list spans from the '(' ending the head match to its matching ')'.
  const colOpen = head[0].length - 1;
  const colClose = findGroupClose(sql, colOpen);
  if (colClose === -1) return null;

  const colListRaw = sql.slice(colOpen + 1, colClose);
  const existing = new Set(parseColumnList(colListRaw).map((c) => c.toLowerCase()));
  const missing = AUTO_FILLED_SYSTEM_COLUMNS.filter((c) => !existing.has(c));
  if (missing.length === 0) return null;

  // Expect `VALUES (` immediately after the column list. INSERT…SELECT and
  // INSERT…DEFAULT VALUES have no tuple to extend — skip them.
  const afterCol = sql.slice(colClose + 1);
  const valuesMatch = /^\s*VALUES\s*\(/i.exec(afterCol);
  if (!valuesMatch) return null;

  // Collect the close-paren index of every VALUES tuple, walking `),(` joins.
  const tupleCloses: number[] = [];
  let tupleOpen = colClose + 1 + valuesMatch[0].length - 1;
  for (;;) {
    const tupleClose = findGroupClose(sql, tupleOpen);
    if (tupleClose === -1) return null;
    tupleCloses.push(tupleClose);
    // Another tuple only if the next non-whitespace is a ',' opening a '('.
    const nextTuple = /^\s*,\s*\(/.exec(sql.slice(tupleClose + 1));
    if (!nextTuple) break;
    tupleOpen = tupleClose + 1 + nextTuple[0].length - 1;
  }

  const literalSplice = ', ' + missing.map((c) => sqlStringLiteral(values[c])).join(', ');

  // Splice tuples right-to-left so earlier indices stay valid, then the column
  // list (which precedes every tuple).
  let out = sql;
  for (let i = tupleCloses.length - 1; i >= 0; i--) {
    const close = tupleCloses[i];
    out = out.slice(0, close) + literalSplice + out.slice(close);
  }
  out = out.slice(0, colClose) + ', ' + missing.join(', ') + out.slice(colClose);
  return out;
}

/**
 * Wrap a D1 handle for handler use so raw INSERTs into model tables auto-fill
 * the system columns. Non-INSERT statements and unrecognised INSERT shapes are
 * passed straight through to the underlying handle.
 *
 * The returned proxy re-binds every other method to the real handle, so
 * `batch`, `exec`, `dump`, etc. behave exactly as before.
 */
export function wrapHandlerDb(
  db: D1Database,
  models: ModelProps[],
  ownerId: string,
): D1Database {
  // Lowercased — SQLite identifiers are case-insensitive, so a handler that
  // writes `INSERT INTO Orders` must still match the `orders` model.
  const modelNames = new Set(models.map((m) => m.name.toLowerCase()));
  // Nothing to protect (no models, or no owner to attribute rows to).
  if (modelNames.size === 0 || !ownerId) return db;

  const now = new Date().toISOString();
  const values: AutoFillValues = { owner_id: ownerId, created_at: now, updated_at: now };

  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'prepare') {
        return (sql: string) => {
          const rewritten = injectSystemColumnsIntoInsert(sql, modelNames, values);
          return target.prepare(rewritten ?? sql);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
