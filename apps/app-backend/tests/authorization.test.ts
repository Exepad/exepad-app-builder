/**
 * Authorization & Scope Isolation Tests
 *
 * Covers: owner_id scoping (user vs shared), CRUD policy auth levels,
 * handler auth (handlerType read/write), admin bypass, anon access.
 */

import { describe, it, expect } from 'vitest';
import { sysRead } from '../src/crud/read';
import { sysCreate } from '../src/crud/create';
import { sysUpdate } from '../src/crud/update';
import { sysDelete } from '../src/crud/delete';
import { sysList } from '../src/crud/list';
import { checkAuth, extractUserContext } from '../src/rpc/router';
import { NotFoundError, ForbiddenError, UnauthorizedError } from '../src/utils/errors';
import { createMockD1 } from './helpers/mock-d1';
import { TEST_MODEL, TEST_MODEL_SHARED, TEST_USER, TEST_ADMIN, TEST_ANON } from './helpers/mock-env';

// ── Owner-scoped read isolation ────────────────────────────────────

describe('Owner-scoped read isolation', () => {
  it('user cannot read another user\'s record in user-scoped model', async () => {
    // DB has no row matching owner_id = user-123 (the record belongs to another user)
    const db = createMockD1({ firstReturnsNull: true });

    await expect(
      sysRead(TEST_MODEL, { id: 1 }, TEST_USER, db)
    ).rejects.toThrow(NotFoundError);

    // Verify the query includes owner_id filter
    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT'));
    expect(selectQuery!.sql).toContain('owner_id');
    expect(selectQuery!.binds).toContain('user-123');
  });

  it('user CAN read shared-scope records from other users', async () => {
    const otherOwnerRecord = { id: 1, name: 'Public', email: 'pub@test.com', owner_id: 'other-user' };
    const db = createMockD1({
      results: new Map([['SELECT', [otherOwnerRecord]]]),
    });

    const result = await sysRead(TEST_MODEL_SHARED, { id: 1 }, TEST_USER, db);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(otherOwnerRecord);

    // Verify the query does NOT include owner_id filter
    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT'));
    expect(selectQuery!.sql).not.toContain('owner_id = ?');
  });

  it('admin cannot bypass user-scope isolation on sysRead', async () => {
    // Even admin should not see user-scoped records belonging to other users
    // (no row matches because owner_id filter is applied)
    const db = createMockD1({ firstReturnsNull: true });

    await expect(
      sysRead(TEST_MODEL, { id: 1 }, TEST_ADMIN, db)
    ).rejects.toThrow(NotFoundError);

    // Verify owner_id filter still present for admin on user-scoped model
    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT'));
    expect(selectQuery!.sql).toContain('owner_id');
    expect(selectQuery!.binds).toContain('admin-1');
  });
});

// ── Shared-scope update authorization ──────────────────────────────

describe('Shared-scope update authorization', () => {
  it('user can update own record in shared scope', async () => {
    const ownRecord = { id: 1, name: 'Mine', owner_id: 'user-123' };
    const updated = { ...ownRecord, name: 'Updated' };
    const results = new Map<string, Record<string, unknown>[]>();
    results.set('SELECT', [ownRecord]);
    results.set('UPDATE', [updated]);
    const db = createMockD1({ results });

    const result = await sysUpdate(
      TEST_MODEL_SHARED,
      { id: 1, data: { name: 'Updated' } },
      TEST_USER,
      db
    );
    expect(result.success).toBe(true);
  });

  it('user cannot update another user\'s record in shared scope', async () => {
    const otherRecord = { id: 1, name: 'Theirs', owner_id: 'other-user' };
    const db = createMockD1({
      results: new Map([['SELECT', [otherRecord]]]),
    });

    await expect(
      sysUpdate(TEST_MODEL_SHARED, { id: 1, data: { name: 'Hacked' } }, TEST_USER, db)
    ).rejects.toThrow(ForbiddenError);
  });

  it('admin CAN update any shared-scope record', async () => {
    const otherRecord = { id: 1, name: 'Theirs', owner_id: 'other-user' };
    const updated = { ...otherRecord, name: 'Admin Fix' };
    const results = new Map<string, Record<string, unknown>[]>();
    results.set('SELECT', [otherRecord]);
    results.set('UPDATE', [updated]);
    const db = createMockD1({ results });

    const result = await sysUpdate(
      TEST_MODEL_SHARED,
      { id: 1, data: { name: 'Admin Fix' } },
      TEST_ADMIN,
      db
    );
    expect(result.success).toBe(true);
  });
});

// ── Shared-scope delete authorization ──────────────────────────────

describe('Shared-scope delete authorization', () => {
  it('user cannot delete another user\'s record in shared scope', async () => {
    const otherRecord = { id: 1, owner_id: 'other-user' };
    const db = createMockD1({
      results: new Map([['SELECT', [otherRecord]]]),
    });

    await expect(
      sysDelete(TEST_MODEL_SHARED, { id: 1 }, TEST_USER, db)
    ).rejects.toThrow(ForbiddenError);
  });

  it('admin CAN delete any shared-scope record', async () => {
    const otherRecord = { id: 1, owner_id: 'other-user' };
    const db = createMockD1({
      results: new Map([['SELECT', [otherRecord]]]),
    });

    const result = await sysDelete(TEST_MODEL_SHARED, { id: 1 }, TEST_ADMIN, db);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ deleted: true, id: 1, soft: false });
  });
});

// ── checkAuth function ─────────────────────────────────────────────

describe('checkAuth', () => {
  it('public read allows unauthenticated user', () => {
    expect(() => checkAuth('public', TEST_ANON, 'read')).not.toThrow();
  });

  it('public list allows unauthenticated user', () => {
    expect(() => checkAuth('public', TEST_ANON, 'list')).not.toThrow();
  });

  it('public write blocks unauthenticated user (H8 guard)', () => {
    expect(() => checkAuth('public', TEST_ANON, 'create')).toThrow(UnauthorizedError);
  });

  it('public update blocks unauthenticated user', () => {
    expect(() => checkAuth('public', TEST_ANON, 'update')).toThrow(UnauthorizedError);
  });

  it('public delete blocks unauthenticated user', () => {
    expect(() => checkAuth('public', TEST_ANON, 'delete')).toThrow(UnauthorizedError);
  });

  it('authenticated level requires login', () => {
    expect(() => checkAuth('authenticated', TEST_ANON)).toThrow(UnauthorizedError);
  });

  it('authenticated level allows logged-in user', () => {
    expect(() => checkAuth('authenticated', TEST_USER)).not.toThrow();
  });

  it('admin level blocks non-admin user', () => {
    expect(() => checkAuth('admin', TEST_USER)).toThrow(ForbiddenError);
  });

  it('admin level allows admin user', () => {
    expect(() => checkAuth('admin', TEST_ADMIN)).not.toThrow();
  });

  it('undefined auth level defaults to authenticated', () => {
    expect(() => checkAuth(undefined, TEST_ANON)).toThrow(UnauthorizedError);
    expect(() => checkAuth(undefined, TEST_USER)).not.toThrow();
  });

  // ── Expanded AccessLevel values ────────────────────────────────

  it("'none' always throws ForbiddenError (even for admin)", () => {
    expect(() => checkAuth('none', TEST_ADMIN)).toThrow(ForbiddenError);
    expect(() => checkAuth('none', TEST_USER)).toThrow(ForbiddenError);
    expect(() => checkAuth('none', TEST_ANON)).toThrow(ForbiddenError);
  });

  it("'role:editor' allows user with matching role", () => {
    const editor = { ...TEST_USER, roles: ['editor'] };
    expect(() => checkAuth('role:editor', editor)).not.toThrow();
  });

  it("'role:editor' blocks user without matching role", () => {
    const viewer = { ...TEST_USER, roles: ['viewer'] };
    expect(() => checkAuth('role:editor', viewer)).toThrow(ForbiddenError);
  });

  it("'role:editor' allows user via role hierarchy expansion", () => {
    // admin inherits editor
    const roleMap = { admin: ['admin', 'editor', 'viewer'] };
    expect(() => checkAuth('role:editor', TEST_ADMIN, undefined, roleMap)).not.toThrow();
  });

  it("'role:editor' blocks when no hierarchy and role not direct match", () => {
    // admin without expansion map does NOT inherit editor
    expect(() => checkAuth('role:editor', TEST_ADMIN)).toThrow(ForbiddenError);
  });

  it("'owner' requires authentication", () => {
    expect(() => checkAuth('owner', TEST_ANON)).toThrow(UnauthorizedError);
  });

  it("'owner' allows authenticated user (defers to CRUD layer)", () => {
    expect(() => checkAuth('owner', TEST_USER)).not.toThrow();
  });

  it('roleExpansionMap is respected for multi-level hierarchy', () => {
    const roleMap = {
      superadmin: ['superadmin', 'admin', 'editor', 'viewer'],
      admin: ['admin', 'editor', 'viewer'],
      editor: ['editor', 'viewer'],
    };
    const superadmin = { ...TEST_USER, roles: ['superadmin'] };
    expect(() => checkAuth('role:viewer', superadmin, undefined, roleMap)).not.toThrow();
    expect(() => checkAuth('role:editor', superadmin, undefined, roleMap)).not.toThrow();
    expect(() => checkAuth('role:admin', superadmin, undefined, roleMap)).not.toThrow();
  });
});

// ── extractUserContext ─────────────────────────────────────────────

describe('extractUserContext', () => {
  // extractUserContext is now async (Mode B session validation)
  // These tests use Mode A (platform headers), so db is unused but required
  const db = createMockD1();

  it('trims whitespace from user ID', async () => {
    const req = new Request('http://localhost', {
      headers: { 'X-User-Id': '  user-123  ', 'X-User-Email': 'a@b.com' },
    });
    const ctx = await extractUserContext(req, db);
    expect(ctx.id).toBe('user-123');
    expect(ctx.isAuthenticated).toBe(true);
  });

  it('trims whitespace from roles', async () => {
    const req = new Request('http://localhost', {
      headers: {
        'X-User-Id': 'user-1',
        'X-User-Email': 'a@b.com',
        'X-User-Roles': ' admin , editor , ',
      },
    });
    const ctx = await extractUserContext(req, db);
    expect(ctx.roles).toEqual(['admin', 'editor']);
  });

  it('filters empty role segments after split', async () => {
    const req = new Request('http://localhost', {
      headers: {
        'X-User-Id': 'user-1',
        'X-User-Email': 'a@b.com',
        'X-User-Roles': ',,admin,,',
      },
    });
    const ctx = await extractUserContext(req, db);
    expect(ctx.roles).toEqual(['admin']);
  });

  it('returns unauthenticated for missing X-User-Id', async () => {
    const req = new Request('http://localhost', {
      headers: { 'X-User-Email': 'a@b.com' },
    });
    const ctx = await extractUserContext(req, db);
    expect(ctx.isAuthenticated).toBe(false);
    expect(ctx.id).toBe('');
  });

  it('returns unauthenticated for whitespace-only X-User-Id', async () => {
    const req = new Request('http://localhost', {
      headers: { 'X-User-Id': '   ' },
    });
    const ctx = await extractUserContext(req, db);
    expect(ctx.isAuthenticated).toBe(false);
    expect(ctx.id).toBe('');
  });
});

// ── List isolation ─────────────────────────────────────────────────

describe('List owner isolation', () => {
  it('user-scoped list only returns own records', async () => {
    const ownRecords = [
      { id: 1, name: 'A', owner_id: 'user-123' },
      { id: 2, name: 'B', owner_id: 'user-123' },
    ];
    const results = new Map<string, Record<string, unknown>[]>();
    results.set('SELECT', ownRecords);
    results.set('COUNT', [{ count: 2 }]);
    const db = createMockD1({ results });

    const result = await sysList(TEST_MODEL, {}, TEST_USER, db);
    expect(result.success).toBe(true);

    // Verify the query includes owner_id filter
    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT') && !q.sql.includes('COUNT'));
    expect(selectQuery!.sql).toContain('owner_id');
  });

  it('shared-scope list returns all records regardless of owner', async () => {
    const allRecords = [
      { id: 1, name: 'A', owner_id: 'user-123' },
      { id: 2, name: 'B', owner_id: 'other-user' },
    ];
    const results = new Map<string, Record<string, unknown>[]>();
    results.set('SELECT', allRecords);
    results.set('COUNT', [{ count: 2 }]);
    const db = createMockD1({ results });

    const result = await sysList(TEST_MODEL_SHARED, {}, TEST_USER, db);
    expect(result.success).toBe(true);

    // Verify the query does NOT include owner_id filter
    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT') && !q.sql.includes('COUNT'));
    expect(selectQuery!.sql).not.toContain('owner_id = ?');
  });
});
