/**
 * sql-whitelist.ts — the trust boundary against LLM-emitted SQL.
 *
 * This is the security gate for the Surveyor's Class B `query_db_tool`.
 * Test coverage MUST include every prompt-injection technique we can
 * think of: multi-statement payloads, comment-hidden trailing
 * statements, dialect quirks, case variants. A regression here is a
 * data-leak / data-mutation hole.
 */

import { describe, it, expect } from 'vitest';
import {
  validateReadOnlySql,
  safeIdentifier,
  isDeniedTableName,
  ALLOWED_PRAGMAS,
} from '../../../../worker/src/lib/sql-whitelist';

describe('validateReadOnlySql', () => {
  // ── Allowed shapes ───────────────────────────────────────────────
  describe('accepts read-only statements', () => {
    it('allows a simple SELECT', () => {
      expect(validateReadOnlySql('SELECT 1')).toEqual({ ok: true, isPragma: false });
    });

    it('allows SELECT with WHERE', () => {
      const r = validateReadOnlySql("SELECT * FROM users WHERE id = 'abc'");
      expect(r).toMatchObject({ ok: true, isPragma: false });
    });

    it('allows SELECT with semicolons inside string literals', () => {
      const r = validateReadOnlySql("SELECT * FROM users WHERE name = 'a;b'");
      expect(r).toMatchObject({ ok: true });
    });

    it('allows SELECT with single trailing semicolon', () => {
      expect(validateReadOnlySql('SELECT 1;')).toMatchObject({ ok: true });
    });

    it('allows SELECT with subquery', () => {
      const r = validateReadOnlySql(
        'SELECT id FROM users WHERE owner_id IN (SELECT id FROM tenants)',
      );
      expect(r).toMatchObject({ ok: true });
    });

    it('allows lower-case select', () => {
      expect(validateReadOnlySql('select 1')).toMatchObject({ ok: true });
    });

    it.each([...ALLOWED_PRAGMAS])('allows PRAGMA %s', (name) => {
      const r = validateReadOnlySql(`PRAGMA ${name}(users)`);
      expect(r).toMatchObject({ ok: true, isPragma: true });
    });

    it('allows PRAGMA with case-insensitive name', () => {
      expect(validateReadOnlySql('pragma table_info(users)')).toMatchObject({
        ok: true,
        isPragma: true,
      });
    });
  });

  // ── Multi-statement injection ────────────────────────────────────
  describe('rejects multi-statement payloads', () => {
    it('rejects SELECT;DELETE', () => {
      expect(validateReadOnlySql('SELECT 1; DELETE FROM users')).toEqual({
        ok: false,
        reason: 'multi_statement',
      });
    });

    it('rejects SELECT;DROP TABLE', () => {
      expect(validateReadOnlySql('SELECT 1; DROP TABLE users')).toEqual({
        ok: false,
        reason: 'multi_statement',
      });
    });

    it('rejects two SELECTs separated by ;', () => {
      expect(validateReadOnlySql('SELECT 1; SELECT 2')).toEqual({
        ok: false,
        reason: 'multi_statement',
      });
    });
  });

  // ── Disallowed statement types ───────────────────────────────────
  describe('rejects DML / DDL', () => {
    it.each([
      ['INSERT', "INSERT INTO users (id) VALUES ('x')"],
      ['UPDATE', "UPDATE users SET name = 'x'"],
      ['DELETE', 'DELETE FROM users'],
      ['REPLACE', "REPLACE INTO users (id) VALUES ('x')"],
      ['CREATE TABLE', 'CREATE TABLE foo (id TEXT)'],
      ['DROP TABLE', 'DROP TABLE users'],
      ['ALTER TABLE', 'ALTER TABLE users ADD COLUMN x TEXT'],
      ['ATTACH', "ATTACH DATABASE 'other.db' AS other"],
    ])('rejects %s', (_name, sql) => {
      expect(validateReadOnlySql(sql).ok).toBe(false);
    });
  });

  // ── PRAGMA edges ─────────────────────────────────────────────────
  describe('PRAGMA whitelist', () => {
    it('rejects non-whitelisted PRAGMA (e.g. user_version)', () => {
      expect(validateReadOnlySql('PRAGMA user_version')).toEqual({
        ok: false,
        reason: 'pragma_not_whitelisted',
      });
    });

    it('rejects PRAGMA with write semantics (e.g. journal_mode = OFF)', () => {
      expect(validateReadOnlySql('PRAGMA journal_mode = OFF')).toEqual({
        ok: false,
        reason: 'pragma_not_whitelisted',
      });
    });
  });

  // ── Empty / malformed ────────────────────────────────────────────
  describe('rejects malformed input', () => {
    it('rejects empty string', () => {
      expect(validateReadOnlySql('')).toEqual({ ok: false, reason: 'empty_sql' });
    });

    it('rejects whitespace-only string', () => {
      expect(validateReadOnlySql('   ')).toEqual({ ok: false, reason: 'empty_sql' });
    });

    it('rejects non-string input', () => {
      expect(validateReadOnlySql(123 as unknown as string)).toEqual({
        ok: false,
        reason: 'empty_sql',
      });
    });

    it('rejects bare comments', () => {
      expect(validateReadOnlySql('-- comment only')).toMatchObject({ ok: false });
    });

    it('rejects garbage', () => {
      expect(validateReadOnlySql('NOT_A_SQL_STATEMENT')).toMatchObject({ ok: false });
    });
  });
});

describe('safeIdentifier', () => {
  it('accepts simple identifiers', () => {
    expect(safeIdentifier('users')).toBe('users');
    expect(safeIdentifier('user_settings')).toBe('user_settings');
    expect(safeIdentifier('_auth_users')).toBe('_auth_users');
    expect(safeIdentifier('Table1')).toBe('Table1');
  });

  it('rejects identifiers with special characters', () => {
    expect(safeIdentifier('users; DROP TABLE x')).toBeNull();
    expect(safeIdentifier('users-with-dashes')).toBeNull();
    expect(safeIdentifier('users.column')).toBeNull();
    expect(safeIdentifier('users"')).toBeNull();
    expect(safeIdentifier("users'")).toBeNull();
    expect(safeIdentifier('users space')).toBeNull();
  });

  it('rejects identifiers starting with a digit', () => {
    expect(safeIdentifier('1users')).toBeNull();
  });

  it('rejects empty / non-string input', () => {
    expect(safeIdentifier('')).toBeNull();
    expect(safeIdentifier(null as unknown as string)).toBeNull();
    expect(safeIdentifier(undefined as unknown as string)).toBeNull();
  });
});

// ── System-table denylist (auth credentials / internal platform tables) ──
// A well-formed read-only SELECT must STILL not read `_auth_*` (password_hash,
// key_hash, sessions) or `_exepad_*` internal tables through this delegated
// surface (the apps:data REST scope + the Surveyor probe). Regression guard for
// the credential-exposure hole where any SELECT against any table was allowed.
describe('validateReadOnlySql — system-table denylist', () => {
  it('denies a direct SELECT against an _auth_ table', () => {
    expect(validateReadOnlySql('SELECT email, password_hash FROM _auth_users')).toEqual({
      ok: false,
      reason: 'system_table_denied',
    });
    expect(validateReadOnlySql('SELECT key_hash FROM _auth_api_keys')).toMatchObject({ ok: false });
    expect(validateReadOnlySql('SELECT * FROM _auth_sessions')).toMatchObject({ ok: false });
  });

  it('denies _exepad_ internal tables', () => {
    expect(validateReadOnlySql('SELECT * FROM _exepad_config')).toMatchObject({
      ok: false,
      reason: 'system_table_denied',
    });
  });

  it('catches a denied table smuggled via JOIN, subquery, or CTE', () => {
    expect(
      validateReadOnlySql('SELECT * FROM books b JOIN _auth_users u ON u.id = b.owner_id'),
    ).toMatchObject({ ok: false, reason: 'system_table_denied' });
    expect(
      validateReadOnlySql('SELECT * FROM books WHERE owner_id IN (SELECT id FROM _auth_users)'),
    ).toMatchObject({ ok: false, reason: 'system_table_denied' });
    expect(
      validateReadOnlySql('WITH x AS (SELECT * FROM _auth_api_keys) SELECT * FROM x'),
    ).toMatchObject({ ok: false, reason: 'system_table_denied' });
  });

  it('catches quoted / cased denied table names', () => {
    expect(validateReadOnlySql('SELECT * FROM "_auth_users"')).toMatchObject({ ok: false });
    expect(validateReadOnlySql('SELECT * FROM `_auth_users`')).toMatchObject({ ok: false });
    expect(validateReadOnlySql('select * from _AUTH_USERS')).toMatchObject({ ok: false });
  });

  it('denies PRAGMA table_info against a system table (column-name disclosure)', () => {
    expect(validateReadOnlySql('PRAGMA table_info(_auth_users)')).toMatchObject({
      ok: false,
      reason: 'system_table_denied',
    });
    expect(validateReadOnlySql("PRAGMA table_info('_auth_api_keys')")).toMatchObject({ ok: false });
  });

  // SQLite also accepts the assignment form `PRAGMA name = table`, which has no
  // parentheses — the parenthesis-only denylist check used to let it through and
  // leak _auth_* / sqlite_master schema. Both forms must be denied identically.
  it('denies the PRAGMA assignment form against system tables', () => {
    expect(validateReadOnlySql('PRAGMA table_info = _auth_users')).toMatchObject({
      ok: false,
      reason: 'system_table_denied',
    });
    expect(validateReadOnlySql('PRAGMA table_info = sqlite_master')).toMatchObject({
      ok: false,
      reason: 'system_table_denied',
    });
    expect(validateReadOnlySql("PRAGMA table_info='_auth_users'")).toMatchObject({ ok: false });
    expect(validateReadOnlySql('PRAGMA foreign_key_list = _auth_api_keys')).toMatchObject({
      ok: false,
      reason: 'system_table_denied',
    });
    // trailing semicolon variant
    expect(validateReadOnlySql('PRAGMA table_info = _files;')).toMatchObject({ ok: false });
  });

  it('still allows the PRAGMA assignment form against a normal app table', () => {
    expect(validateReadOnlySql('PRAGMA table_info = books')).toMatchObject({
      ok: true,
      isPragma: true,
    });
  });

  it('still allows normal app tables', () => {
    expect(validateReadOnlySql('SELECT * FROM books')).toMatchObject({ ok: true });
    // a column NAMED like a system table is fine — only TABLE refs are gated
    expect(validateReadOnlySql('SELECT password_hash FROM books')).toMatchObject({ ok: true });
    // a model table that merely shares a prefix substring is not denied
    expect(validateReadOnlySql('SELECT * FROM authors')).toMatchObject({ ok: true });
    expect(validateReadOnlySql('SELECT * FROM author_events')).toMatchObject({ ok: true });
  });

  // Bypass vectors the adversarial review found: node-sql-parser's tableList does
  // NOT enumerate a table named inside a pragma_* table-valued function, and
  // sqlite_master is a schema-dump side channel. Both are now closed.
  it('denies pragma_* table-valued functions (tableList blind spot)', () => {
    expect(validateReadOnlySql("SELECT * FROM pragma_table_info('_auth_users')")).toMatchObject({
      ok: false,
      reason: 'pragma_function_denied',
    });
    expect(validateReadOnlySql("SELECT name FROM pragma_index_list('_auth_users')")).toMatchObject({
      ok: false,
      reason: 'pragma_function_denied',
    });
    // even wrapped in a CTE (the arg is invisible to tableList there too)
    expect(
      validateReadOnlySql(
        "WITH c AS (SELECT name FROM pragma_table_info('_auth_users')) SELECT * FROM c",
      ),
    ).toMatchObject({ ok: false, reason: 'pragma_function_denied' });
    // the whole family is denied — even against a non-system table (no legit use here)
    expect(validateReadOnlySql("SELECT * FROM pragma_table_info('books')")).toMatchObject({
      ok: false,
      reason: 'pragma_function_denied',
    });
  });

  it('denies sqlite_master / sqlite_schema schema-dump reads', () => {
    expect(
      validateReadOnlySql("SELECT name, sql FROM sqlite_master WHERE name LIKE '_auth_%'"),
    ).toMatchObject({ ok: false, reason: 'system_table_denied' });
    expect(validateReadOnlySql('SELECT * FROM sqlite_schema')).toMatchObject({
      ok: false,
      reason: 'system_table_denied',
    });
    expect(validateReadOnlySql('SELECT * FROM sqlite_temp_master')).toMatchObject({ ok: false });
  });

  // The `_files` registry holds every uploader's owner_id, filenames, the
  // internal r2_key, and `private` file metadata. Reading it via this surface
  // bypassed sys_file_list's privacy scoping (cross-user private-metadata leak).
  it('denies reads against the _files registry (cross-user private file metadata)', () => {
    expect(validateReadOnlySql('SELECT * FROM _files')).toMatchObject({
      ok: false,
      reason: 'system_table_denied',
    });
    expect(
      validateReadOnlySql('SELECT owner_id, filename, r2_key, visibility FROM _files'),
    ).toMatchObject({ ok: false, reason: 'system_table_denied' });
    // quoted, JOIN, subquery, CTE, and pragma-TVF forms are all denied too
    expect(validateReadOnlySql('SELECT * FROM "_files"')).toMatchObject({ ok: false });
    expect(
      validateReadOnlySql('SELECT * FROM books b JOIN _files f ON f.record_id = b.id'),
    ).toMatchObject({ ok: false, reason: 'system_table_denied' });
    expect(
      validateReadOnlySql('SELECT * FROM books WHERE id IN (SELECT record_id FROM _files)'),
    ).toMatchObject({ ok: false, reason: 'system_table_denied' });
    expect(validateReadOnlySql("PRAGMA table_info('_files')")).toMatchObject({ ok: false });
    expect(validateReadOnlySql("SELECT * FROM pragma_table_info('_files')")).toMatchObject({
      ok: false,
    });
  });

  it('isDeniedTableName matches prefixes case/quote-insensitively', () => {
    expect(isDeniedTableName('_auth_users')).toBe(true);
    expect(isDeniedTableName('_AUTH_SESSIONS')).toBe(true);
    expect(isDeniedTableName('"_auth_api_keys"')).toBe(true);
    expect(isDeniedTableName('_exepad_config')).toBe(true);
    expect(isDeniedTableName('_files')).toBe(true);
    expect(isDeniedTableName('"_FILES"')).toBe(true);
    expect(isDeniedTableName('books')).toBe(false);
    expect(isDeniedTableName('authors')).toBe(false);
    // a user model whose name merely contains "files" is NOT denied
    expect(isDeniedTableName('user_files')).toBe(false);
    expect(isDeniedTableName('profile_files')).toBe(false);
  });
});
