/**
 * Auth Me Handler Tests
 *
 * Covers: authenticated user profile retrieval, role parsing, email_verified,
 * unauthenticated rejection.
 */

import { describe, it, expect } from 'vitest';
import { authMe } from '../src/auth/handlers/me';
import { createMockD1 } from './helpers/mock-d1';
import { TEST_SESSION_USER, TEST_ANON_USER, createTestUserRow } from './helpers/mock-auth';

describe('authMe', () => {
  it('returns user profile from _auth_users table', async () => {
    const row = createTestUserRow({
      name: 'Alice',
      email: 'alice@test.com',
      email_verified: 1,
    });
    const db = createMockD1({
      results: new Map([['SELECT', [row]]]),
    });

    const result = await authMe({}, db, {}, new Request('http://localhost'), TEST_SESSION_USER);

    expect(result.user).toBeDefined();
    expect(result.user!.id).toBe(row.id);
    expect(result.user!.email).toBe('alice@test.com');
    expect(result.user!.name).toBe('Alice');
  });

  it('parses comma-separated roles into array', async () => {
    const row = createTestUserRow({ roles: 'admin,editor,user' });
    const db = createMockD1({
      results: new Map([['SELECT', [row]]]),
    });

    const result = await authMe({}, db, {}, new Request('http://localhost'), TEST_SESSION_USER);

    expect(result.user!.roles).toEqual(['admin', 'editor', 'user']);
  });

  it('defaults to empty array when roles column is empty', async () => {
    const row = createTestUserRow({ roles: '' });
    const db = createMockD1({
      results: new Map([['SELECT', [row]]]),
    });

    const result = await authMe({}, db, {}, new Request('http://localhost'), TEST_SESSION_USER);

    // parseRoles('') returns [] — no default role injection
    expect(result.user!.roles).toEqual([]);
  });

  it('converts email_verified integer to boolean', async () => {
    const verifiedRow = createTestUserRow({ email_verified: 1 });
    const unverifiedRow = createTestUserRow({ email_verified: 0 });

    const dbVerified = createMockD1({
      results: new Map([['SELECT', [verifiedRow]]]),
    });
    const dbUnverified = createMockD1({
      results: new Map([['SELECT', [unverifiedRow]]]),
    });

    const resultVerified = await authMe({}, dbVerified, {}, new Request('http://localhost'), TEST_SESSION_USER);
    const resultUnverified = await authMe({}, dbUnverified, {}, new Request('http://localhost'), TEST_SESSION_USER);

    expect(resultVerified.user!.email_verified).toBe(true);
    expect(resultUnverified.user!.email_verified).toBe(false);
  });

  it('returns null when user is not authenticated', async () => {
    const db = createMockD1();

    // auth_me returns null (not 401) for unauthenticated users — this is the
    // standard session-check endpoint the frontend polls on mount.
    const result = await authMe({}, db, {}, new Request('http://localhost'), TEST_ANON_USER);
    expect(result).toBeNull();
  });

  it('returns _clearSession when user record not found in DB', async () => {
    const db = createMockD1({ firstReturnsNull: true });

    // Session is valid but user was deleted — signal cookie clear
    const result = await authMe({}, db, {}, new Request('http://localhost'), TEST_SESSION_USER);
    expect(result).toBeDefined();
    expect(result!._clearSession).toBe(true);
  });

  it('does NOT include password_hash in SELECT query (security)', async () => {
    const row = createTestUserRow();
    const db = createMockD1({
      results: new Map([['SELECT', [row]]]),
    });

    await authMe({}, db, {}, new Request('http://localhost'), TEST_SESSION_USER);

    const selectQuery = db._queries.find((q: { sql: string }) => q.sql.includes('SELECT'));
    expect(selectQuery!.sql).not.toContain('password_hash');
  });

  it('trims whitespace from role names', async () => {
    const row = createTestUserRow({ roles: ' admin , editor , user ' });
    const db = createMockD1({
      results: new Map([['SELECT', [row]]]),
    });

    const result = await authMe({}, db, {}, new Request('http://localhost'), TEST_SESSION_USER);

    expect(result.user!.roles).toEqual(['admin', 'editor', 'user']);
  });

  it('filters empty segments from double commas in roles', async () => {
    const row = createTestUserRow({ roles: 'admin,,user' });
    const db = createMockD1({
      results: new Map([['SELECT', [row]]]),
    });

    const result = await authMe({}, db, {}, new Request('http://localhost'), TEST_SESSION_USER);

    expect(result.user!.roles).toEqual(['admin', 'user']);
  });

  it('returns null name when DB row name is null', async () => {
    const row = createTestUserRow({ name: null });
    const db = createMockD1({
      results: new Map([['SELECT', [row]]]),
    });

    const result = await authMe({}, db, {}, new Request('http://localhost'), TEST_SESSION_USER);

    expect(result.user!.name).toBeNull();
  });

  it('returns avatar_url from DB row', async () => {
    const row = createTestUserRow({ avatar_url: 'https://example.com/avatar.png' });
    const db = createMockD1({
      results: new Map([['SELECT', [row]]]),
    });

    const result = await authMe({}, db, {}, new Request('http://localhost'), TEST_SESSION_USER);

    expect(result.user!.avatar_url).toBe('https://example.com/avatar.png');
  });
});
