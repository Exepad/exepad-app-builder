/**
 * Auth Signin Handler Tests
 *
 * Covers: email/password login, validation, user enumeration prevention,
 * session creation, edge cases.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { authSignin } from '../src/auth/handlers/signin';
import { hashPassword } from '../src/auth/utils';
import { ValidationError, UnauthorizedError } from '../src/utils/errors';
import { createMockD1 } from './helpers/mock-d1';
import { TEST_SECURITY } from './helpers/mock-auth';

// Pre-hash a known password for mock D1 results
let knownPasswordHash: string;
const KNOWN_PASSWORD = 'correctPassword123';

beforeAll(async () => {
  knownPasswordHash = await hashPassword(KNOWN_PASSWORD);
});

function userRow(overrides?: Record<string, unknown>) {
  return {
    id: 'user-1',
    email: 'user@test.com',
    password_hash: knownPasswordHash,
    name: 'Test User',
    avatar_url: null,
    roles: 'user',
    email_verified: 0,
    ...overrides,
  };
}

describe('authSignin', () => {
  it('returns user object with session token on valid credentials', async () => {
    const db = createMockD1({
      results: new Map([['SELECT', [userRow()]]]),
    });

    const result = await authSignin(
      { email: 'user@test.com', password: KNOWN_PASSWORD },
      db,
      TEST_SECURITY
    );

    expect(result.user).toBeDefined();
    expect(result.user!.id).toBe('user-1');
    expect(result.user!.email).toBe('user@test.com');
    expect(result._sessionToken).toBeDefined();
    expect(result._sessionToken!.length).toBe(64);
  });

  it('creates _auth_sessions record', async () => {
    const db = createMockD1({
      results: new Map([['SELECT', [userRow()]]]),
    });

    await authSignin(
      { email: 'user@test.com', password: KNOWN_PASSWORD },
      db,
      TEST_SECURITY
    );

    const sessionInsert = db._queries.find((q) => q.sql.includes('INSERT INTO _auth_sessions'));
    expect(sessionInsert).toBeDefined();
  });

  it('returns roles parsed from comma-separated string', async () => {
    const db = createMockD1({
      results: new Map([['SELECT', [userRow({ roles: 'admin,editor' })]]]),
    });

    const result = await authSignin(
      { email: 'user@test.com', password: KNOWN_PASSWORD },
      db,
      TEST_SECURITY
    );

    expect(result.user!.roles).toEqual(['admin', 'editor']);
  });

  // ── Validation ──────────────────────────────────────────────────

  describe('validation', () => {
    it('throws ValidationError when email missing', async () => {
      const db = createMockD1();
      await expect(
        authSignin({ password: 'any' }, db, TEST_SECURITY)
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when password missing', async () => {
      const db = createMockD1();
      await expect(
        authSignin({ email: 'user@test.com' }, db, TEST_SECURITY)
      ).rejects.toThrow(ValidationError);
    });
  });

  // ── Security — No User Enumeration ────────────────────────────

  describe('security — no user enumeration', () => {
    it('throws UnauthorizedError with generic message when email not found', async () => {
      const db = createMockD1({ firstReturnsNull: true });

      await expect(
        authSignin({ email: 'unknown@test.com', password: 'any' }, db, TEST_SECURITY)
      ).rejects.toThrow('Invalid email or password');
    });

    it('throws UnauthorizedError with generic message when password wrong', async () => {
      const db = createMockD1({
        results: new Map([['SELECT', [userRow()]]]),
      });

      await expect(
        authSignin({ email: 'user@test.com', password: 'wrongPassword' }, db, TEST_SECURITY)
      ).rejects.toThrow('Invalid email or password');
    });

    it('both error messages are identical', async () => {
      const dbNoUser = createMockD1({ firstReturnsNull: true });
      const dbWrongPass = createMockD1({
        results: new Map([['SELECT', [userRow()]]]),
      });

      let noUserMsg = '';
      let wrongPassMsg = '';

      try {
        await authSignin({ email: 'unknown@test.com', password: 'any' }, dbNoUser, TEST_SECURITY);
      } catch (e) {
        noUserMsg = (e as Error).message;
      }

      try {
        await authSignin({ email: 'user@test.com', password: 'wrong' }, dbWrongPass, TEST_SECURITY);
      } catch (e) {
        wrongPassMsg = (e as Error).message;
      }

      expect(noUserMsg).toBe(wrongPassMsg);
      expect(noUserMsg).toBe('Invalid email or password');
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    it('throws UnauthorizedError when user has no password_hash', async () => {
      const db = createMockD1({
        results: new Map([['SELECT', [userRow({ password_hash: null })]]]),
      });

      await expect(
        authSignin({ email: 'user@test.com', password: 'any' }, db, TEST_SECURITY)
      ).rejects.toThrow(UnauthorizedError);
    });

    it('handles email with different casing', async () => {
      const db = createMockD1({
        results: new Map([['SELECT', [userRow()]]]),
      });

      const result = await authSignin(
        { email: 'USER@Test.COM', password: KNOWN_PASSWORD },
        db,
        TEST_SECURITY
      );

      // Verify lookup used lowercase
      const selectQuery = db._queries.find((q) => q.sql.includes('SELECT'));
      expect(selectQuery!.binds[0]).toBe('user@test.com');
      expect(result.user).toBeDefined();
    });

    it('defaults to empty array when roles column is empty', async () => {
      const db = createMockD1({
        results: new Map([['SELECT', [userRow({ roles: '' })]]]),
      });

      const result = await authSignin(
        { email: 'user@test.com', password: KNOWN_PASSWORD },
        db,
        TEST_SECURITY
      );

      // parseRoles('') returns [] — no default role injection
      expect(result.user!.roles).toEqual([]);
    });

    it('converts email_verified to boolean', async () => {
      const db = createMockD1({
        results: new Map([['SELECT', [userRow({ email_verified: 1 })]]]),
      });

      const result = await authSignin(
        { email: 'user@test.com', password: KNOWN_PASSWORD },
        db,
        TEST_SECURITY
      );

      expect(result.user!.email_verified).toBe(true);
    });

    it('uses custom sessionDuration from security config', async () => {
      const db = createMockD1({
        results: new Map([['SELECT', [userRow()]]]),
      });
      const customSecurity = { ...TEST_SECURITY, sessionDuration: 3600 };

      await authSignin(
        { email: 'user@test.com', password: KNOWN_PASSWORD },
        db,
        customSecurity
      );

      // The session INSERT should use expiresAt(3600) — verify the bind is roughly 1h from now
      const sessionInsert = db._queries.find((q) => q.sql.includes('INSERT INTO _auth_sessions'));
      const expiresAtBind = sessionInsert!.binds[2] as string;
      const expiresMs = new Date(expiresAtBind).getTime();
      const oneHourFromNow = Date.now() + 3600 * 1000;
      expect(expiresMs).toBeGreaterThan(oneHourFromNow - 5000);
      expect(expiresMs).toBeLessThan(oneHourFromNow + 5000);
    });

    it('trims whitespace from role names', async () => {
      const db = createMockD1({
        results: new Map([['SELECT', [userRow({ roles: ' admin , editor ' })]]]),
      });

      const result = await authSignin(
        { email: 'user@test.com', password: KNOWN_PASSWORD },
        db,
        TEST_SECURITY
      );

      expect(result.user!.roles).toEqual(['admin', 'editor']);
    });

    it('filters empty segments from double commas in roles', async () => {
      const db = createMockD1({
        results: new Map([['SELECT', [userRow({ roles: 'admin,,user' })]]]),
      });

      const result = await authSignin(
        { email: 'user@test.com', password: KNOWN_PASSWORD },
        db,
        TEST_SECURITY
      );

      expect(result.user!.roles).toEqual(['admin', 'user']);
    });

    it('returns UnauthorizedError for invalid email format (prevents enumeration)', async () => {
      const db = createMockD1();

      await expect(
        authSignin({ email: 'not-an-email', password: 'any' }, db, TEST_SECURITY)
      ).rejects.toThrow('Invalid email or password');
    });

    it('parses roles from JSON array format', async () => {
      const db = createMockD1({
        results: new Map([['SELECT', [userRow({ roles: '["admin","editor"]' })]]]),
      });

      const result = await authSignin(
        { email: 'user@test.com', password: KNOWN_PASSWORD },
        db,
        TEST_SECURITY
      );

      expect(result.user!.roles).toEqual(['admin', 'editor']);
    });

    it('handles single JSON string role', async () => {
      const db = createMockD1({
        results: new Map([['SELECT', [userRow({ roles: '["user"]' })]]]),
      });

      const result = await authSignin(
        { email: 'user@test.com', password: KNOWN_PASSWORD },
        db,
        TEST_SECURITY
      );

      expect(result.user!.roles).toEqual(['user']);
    });

    it('handles legacy plain string role via parseRoles', async () => {
      const db = createMockD1({
        results: new Map([['SELECT', [userRow({ roles: 'user' })]]]),
      });

      const result = await authSignin(
        { email: 'user@test.com', password: KNOWN_PASSWORD },
        db,
        TEST_SECURITY
      );

      expect(result.user!.roles).toEqual(['user']);
    });
  });
});
