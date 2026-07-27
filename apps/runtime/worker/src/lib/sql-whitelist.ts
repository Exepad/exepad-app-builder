/**
 * SQL whitelist parser — the trust boundary against LLM-emitted SQL.
 *
 * Surveyor Phase 2 Class B probes accept SQL from the agent for read-only
 * inspection of preview D1 instances. LLMs are prompt-injectable; the
 * runtime worker MUST NOT trust the SQL string. This module is the gate.
 *
 * Allow-list:
 *   - SELECT statements (any shape — JOINs, CTEs, subqueries OK)
 *   - PRAGMA table_info(...), PRAGMA foreign_key_list(...)
 *
 * Deny everything else (INSERT/UPDATE/DELETE/REPLACE, DDL, ATTACH,
 * multi-statement payloads, comment-hidden trailing statements).
 *
 * Strategy: belt-and-suspenders.
 *   1. Cheap regex prefix gate — fast reject for obvious garbage.
 *   2. node-sql-parser AST walk — semantic validation that survives
 *      whitespace/comment/encoding trickery.
 *   3. Multi-statement detection done both before parse (semicolon
 *      counting outside string literals) and after parse (AST array
 *      length).
 */

// node-sql-parser ships a CommonJS bundle whose index.js copies its exports onto
// `module.exports` via a runtime `for…in` loop, which cjs-module-lexer cannot
// statically analyze. Under Node's ESM loader (the `tsx watch` dev path) that
// leaves the named export `Parser` invisible, so `import { Parser }` throws
// "does not provide an export named 'Parser'" at module instantiation. Import the
// default (the whole `module.exports`) and destructure at runtime instead — this
// works under both the dev ESM loader and the esbuild production bundle.
import sqlParser from 'node-sql-parser';
const { Parser } = sqlParser;

export const ALLOWED_AST_TYPES = new Set(['select']);
export const ALLOWED_PRAGMAS = new Set(['table_info', 'foreign_key_list']);

/**
 * System tables whose contents/structure must NEVER be exposed through this
 * read-only SQL surface. The platform reserves the ENTIRE leading-underscore
 * namespace for its own per-app tables — the deploy-utils schema builder rejects
 * any user model name starting with `_` (packages/deploy-utils/src/schema/
 * builder.ts), so a leading-`_` denylist can never hide a legitimate user table.
 * That namespace holds: auth credentials, sessions, API keys and account links
 * (`_auth_*`), internal platform bookkeeping (`_exepad_*`), and the per-end-user
 * file registry (`_files` — every uploader's `owner_id`, filenames, the internal
 * `r2_key` storage path, and `private` file metadata). Plus SQLite's own schema
 * tables (`sqlite_master` / `sqlite_schema` / `sqlite_temp_master`, which expose
 * the CREATE DDL + names of the above).
 *
 * None of these are user app data — they hold `password_hash` / `key_hash` /
 * session material or cross-user private file metadata (or the schema thereof)
 * that an `apps:data`-scoped token (or the Surveyor diagnostic probe) has no
 * business reading. Without the `_` prefix here, `SELECT * FROM _files` bypassed
 * the in-app sys_file_list privacy scoping and leaked every user's private file
 * rows. This mirrors the operator Admin DB browser's `isSystemTable` boundary
 * exactly (apps/runtime/worker/src/routes/admin/database.ts) — but the Admin DB
 * / Files browsers talk to `executeD1Query` directly (not this gate), so they
 * retain full access; this denylist only constrains the delegated REST scope +
 * the agent probe.
 */
export const DENIED_TABLE_PREFIXES = ['_', 'sqlite_'] as const;

/** True when `name` (raw, possibly quoted) refers to a denied system table. */
export function isDeniedTableName(name: string): boolean {
  const t = name
    .trim()
    .replace(/^[["'`]+/, '')
    .replace(/[\]"'`]+$/, '')
    .toLowerCase();
  return DENIED_TABLE_PREFIXES.some((p) => t.startsWith(p));
}

/** Extract a node-sql-parser function name (string | {name:[{value}]} forms). */
function extractFunctionName(fn: Record<string, unknown>): string {
  const n = fn.name as unknown;
  if (typeof n === 'string') return n;
  if (n && typeof n === 'object') {
    const inner = (n as Record<string, unknown>).name;
    if (typeof inner === 'string') return inner;
    if (Array.isArray(inner)) {
      return inner
        .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>).value : ''))
        .join('.');
    }
  }
  return '';
}

/**
 * True if the parsed AST calls a `pragma_*` table-valued function ANYWHERE
 * (FROM clause, CTE body, subquery, SELECT list). These TVFs —
 * `pragma_table_info('_auth_users')` etc. — take the target table as a STRING
 * LITERAL argument, so node-sql-parser's `tableList` never enumerates it and the
 * table-name denylist can't see it. There is no legitimate use of a `pragma_*`
 * function on this read surface (the PRAGMA *statement* form already covers and
 * screens introspection), so deny the whole family. Recurses the plain parse
 * tree (no cycles); depth-guarded defensively.
 */
function astReferencesPragmaFunction(node: unknown, depth = 0): boolean {
  if (depth > 80 || node === null || typeof node !== 'object') return false;
  const obj = node as Record<string, unknown>;
  if (obj.type === 'function' && extractFunctionName(obj).toLowerCase().startsWith('pragma_')) {
    return true;
  }
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (Array.isArray(val)) {
      for (const item of val) if (astReferencesPragmaFunction(item, depth + 1)) return true;
    } else if (val && typeof val === 'object') {
      if (astReferencesPragmaFunction(val, depth + 1)) return true;
    }
  }
  return false;
}

export type ValidationResult =
  | { ok: true; isPragma: boolean }
  | { ok: false; reason: string };

/**
 * Count `;` characters that aren't inside a string literal or a `--` /
 * `/* ... *​/` comment. Used to reject multi-statement payloads before
 * the AST parser even sees them.
 */
function countSemicolonsOutsideStrings(sql: string): number {
  let count = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    // Single-line comment
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // String literal: '...' (double the quote to escape inside)
    if (ch === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // Identifier quoting: "..." or `...` or [...]
    if (ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < n && sql[i] !== quote) i++;
      i++;
      continue;
    }
    if (ch === '[') {
      i++;
      while (i < n && sql[i] !== ']') i++;
      i++;
      continue;
    }
    if (ch === ';') count++;
    i++;
  }
  return count;
}

/**
 * Validate that ``sql`` is a single read-only statement we permit.
 *
 * On a true return, callers may execute the SQL against D1. On false,
 * callers MUST reject with the supplied ``reason`` — the LLM's SQL
 * has tried to do something out of policy.
 */
export function validateReadOnlySql(sql: string): ValidationResult {
  if (typeof sql !== 'string' || sql.trim().length === 0) {
    return { ok: false, reason: 'empty_sql' };
  }
  // The contract is one statement per call. Allow a single trailing `;`
  // (>1 semicolons outside string/comment context = multi-statement).
  if (countSemicolonsOutsideStrings(sql) > 1) {
    return { ok: false, reason: 'multi_statement' };
  }

  const trimmed = sql.trim();

  // Cheap prefix gate.
  if (!/^(SELECT|WITH|PRAGMA)\b/i.test(trimmed)) {
    return { ok: false, reason: 'not_select_or_pragma' };
  }

  // PRAGMA: node-sql-parser doesn't model PRAGMA cleanly; whitelist by
  // statement name. Only the read-only introspection PRAGMAs are allowed.
  if (/^PRAGMA\b/i.test(trimmed)) {
    const m = trimmed.match(/^PRAGMA\s+([A-Za-z_]+)/i);
    if (!m || !ALLOWED_PRAGMAS.has(m[1].toLowerCase())) {
      return { ok: false, reason: 'pragma_not_whitelisted' };
    }
    // Even schema introspection (column names/types) of a system table is
    // denied — `PRAGMA table_info(_auth_users)` reveals the credential columns.
    // SQLite accepts BOTH the call form `PRAGMA table_info(_auth_users)` and the
    // assignment form `PRAGMA table_info = _auth_users` (plus quoted variants),
    // and both return the same schema. Extract the argument from whichever form
    // matched and run the denylist on it so the `=` form can't slip past a
    // parenthesis-only check. isDeniedTableName strips surrounding quotes.
    const arg =
      trimmed.match(/^PRAGMA\s+[A-Za-z_]+\s*\(\s*([^)]*?)\s*\)/i) ||
      trimmed.match(/^PRAGMA\s+[A-Za-z_]+\s*=\s*(.+?)\s*;?\s*$/i);
    if (arg && isDeniedTableName(arg[1])) {
      return { ok: false, reason: 'system_table_denied' };
    }
    return { ok: true, isPragma: true };
  }

  // SELECT (or `WITH ... SELECT`): AST-validate via node-sql-parser.
  try {
    const parser = new Parser();
    const ast = parser.astify(trimmed, { database: 'sqlite' });
    const nodes = Array.isArray(ast) ? ast : [ast];
    if (nodes.length !== 1) {
      return { ok: false, reason: 'multi_statement' };
    }
    const node = nodes[0] as { type?: string };
    if (!node.type || !ALLOWED_AST_TYPES.has(node.type)) {
      return { ok: false, reason: `disallowed_${node.type ?? 'unknown'}` };
    }
    // Pragma table-valued functions (`SELECT * FROM pragma_table_info('_auth_users')`)
    // hide the target table in a string-literal arg that `tableList` never sees —
    // deny the whole `pragma_*` family anywhere in the tree (incl. CTE/subquery).
    if (astReferencesPragmaFunction(nodes[0])) {
      return { ok: false, reason: 'pragma_function_denied' };
    }
    // System-table denylist: a well-formed SELECT must still not read auth /
    // internal platform / sqlite_* schema tables. `tableList` enumerates EVERY
    // referenced REAL table — FROM, JOIN, subquery, and CTE bodies (a CTE
    // wrapping `_auth_users` still lists the inner table) — so aliasing/nesting
    // can't smuggle one past.
    let tables: string[];
    try {
      tables = parser.tableList(trimmed, { database: 'sqlite' });
    } catch {
      // astify succeeded but enumeration didn't — fail closed (trust boundary).
      return { ok: false, reason: 'table_extraction_failed' };
    }
    for (const entry of tables) {
      // Format: "{type}::{db}::{table}". Check every segment (defense against an
      // upstream format change), not just the popped table segment.
      if (entry.split('::').some((seg) => isDeniedTableName(seg))) {
        return { ok: false, reason: 'system_table_denied' };
      }
    }
    return { ok: true, isPragma: false };
  } catch (e) {
    return { ok: false, reason: `parse_failed: ${(e as Error).message}` };
  }
}

/**
 * Sanitize a SQL identifier (table or column name) for inclusion in a
 * dynamically-built statement. Returns the identifier unchanged on
 * success, or null if it doesn't match the safe pattern.
 *
 * Used by ``sample_table`` to splice the user-supplied table name into
 * ``SELECT * FROM <X> LIMIT N``. We reject anything outside
 * ``[A-Za-z_][A-Za-z0-9_]*`` rather than try to escape — too easy to
 * get wrong.
 */
export function safeIdentifier(name: string): string | null {
  if (typeof name !== 'string') return null;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : null;
}
