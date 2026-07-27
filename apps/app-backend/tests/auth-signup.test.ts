/**
 * Auth Signup Handler Tests
 *
 * Covers: email/password registration, validation, conflict handling,
 * signup disabling, session creation, password hashing.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { authSignup } from '../src/auth/handlers/signup';
import { resolveSelfSignupRole } from '../src/auth/utils';
import type { SecurityProps } from '@exepad/types';
import { verifyPassword } from '../src/auth/utils';
import { ValidationError, ConflictError, ForbiddenError } from '../src/utils/errors';
import { createMockD1 } from './helpers/mock-d1';
import { TEST_SECURITY, TEST_SECURITY_STRICT, TEST_SECURITY_NO_SIGNUP } from './helpers/mock-auth';

describe('authSignup', () => {
  it('creates user and returns user object with session token', async () => {
    const db = createMockD1({ firstReturnsNull: true }); // no existing user
    const result = await authSignup(
      { email: 'new@example.com', password: 'password123' },
      db,
      TEST_SECURITY
    );

    expect(result.user).toBeDefined();
    expect(result.user!.email).toBe('new@example.com');
    expect(result.user!.roles).toEqual(['user']);
    expect(result._sessionToken).toBeDefined();
    expect(result._sessionToken!.length).toBe(64); // 32 bytes hex
  });

  it('stores lowercase trimmed email', async () => {
    const db = createMockD1({ firstReturnsNull: true });
    const result = await authSignup(
      { email: 'Test@Example.COM', password: 'password123' },
      db,
      TEST_SECURITY
    );

    expect(result.user!.email).toBe('test@example.com');

    // Verify the INSERT used lowercase email
    const insertQuery = db._queries.find((q) => q.sql.includes('INSERT INTO _auth_users'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery!.binds).toContain('test@example.com');
  });

  it('creates _auth_accounts record with email provider', async () => {
    const db = createMockD1({ firstReturnsNull: true });
    await authSignup(
      { email: 'user@test.com', password: 'password123' },
      db,
      TEST_SECURITY
    );

    // batch() triggers .all() on each statement — look for _auth_accounts
    const accountQuery = db._queries.find((q) => q.sql.includes('_auth_accounts'));
    expect(accountQuery).toBeDefined();
    expect(accountQuery!.sql).toContain('email');
  });

  it('creates _auth_sessions record', async () => {
    const db = createMockD1({ firstReturnsNull: true });
    await authSignup(
      { email: 'user@test.com', password: 'password123' },
      db,
      TEST_SECURITY
    );

    const sessionQuery = db._queries.find((q) => q.sql.includes('INSERT INTO _auth_sessions'));
    expect(sessionQuery).toBeDefined();
  });

  it('assigns default role user', async () => {
    const db = createMockD1({ firstReturnsNull: true });
    const result = await authSignup(
      { email: 'user@test.com', password: 'password123' },
      db,
      TEST_SECURITY
    );

    expect(result.user!.roles).toEqual(['user']);
  });

  it('hashes password — never stores plaintext', async () => {
    const db = createMockD1({ firstReturnsNull: true });
    const rawPassword = 'mySecretPass123';
    await authSignup(
      { email: 'user@test.com', password: rawPassword },
      db,
      TEST_SECURITY
    );

    // Check all binds across all queries — raw password should never appear
    for (const query of db._queries) {
      for (const bind of query.binds) {
        expect(bind).not.toBe(rawPassword);
      }
    }

    // Verify the stored hash is a valid PBKDF2 hash
    const insertQuery = db._queries.find((q) => q.sql.includes('INSERT INTO _auth_users'));
    const passwordHashBind = insertQuery!.binds[2]; // 3rd bind: password_hash
    expect(typeof passwordHashBind).toBe('string');
    expect((passwordHashBind as string).startsWith('pbkdf2:')).toBe(true);

    // Verify the hash actually validates against the original password
    expect(await verifyPassword(rawPassword, passwordHashBind as string)).toBe(true);
  });

  // ── Validation Errors ──────────────────────────────────────────

  describe('validation errors', () => {
    it('throws ValidationError when email missing', async () => {
      const db = createMockD1();
      await expect(
        authSignup({ password: 'password123' }, db, TEST_SECURITY)
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when password missing', async () => {
      const db = createMockD1();
      await expect(
        authSignup({ email: 'user@test.com' }, db, TEST_SECURITY)
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for invalid email format', async () => {
      const db = createMockD1();
      await expect(
        authSignup({ email: 'not-an-email', password: 'password123' }, db, TEST_SECURITY)
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when password fails policy (too short)', async () => {
      const db = createMockD1();
      await expect(
        authSignup(
          { email: 'user@test.com', password: 'short' },
          db,
          TEST_SECURITY_STRICT
        )
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when password fails requireUppercase', async () => {
      const db = createMockD1();
      await expect(
        authSignup(
          { email: 'user@test.com', password: 'alllowercase1' },
          db,
          TEST_SECURITY_STRICT
        )
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when password fails requireNumber', async () => {
      const db = createMockD1();
      await expect(
        authSignup(
          { email: 'user@test.com', password: 'NoNumbersHere' },
          db,
          TEST_SECURITY_STRICT
        )
      ).rejects.toThrow(ValidationError);
    });
  });

  // ── Conflict Handling ──────────────────────────────────────────

  describe('conflict handling', () => {
    it('throws ConflictError when email already exists', async () => {
      const db = createMockD1({
        results: new Map([['SELECT', [{ id: 'existing-user' }]]]),
      });

      await expect(
        authSignup({ email: 'taken@test.com', password: 'password123' }, db, TEST_SECURITY)
      ).rejects.toThrow(ConflictError);
    });
  });

  // ── Signup Disabled ────────────────────────────────────────────

  describe('signup disabled', () => {
    it('throws ForbiddenError when allowSignup is false', async () => {
      const db = createMockD1();
      await expect(
        authSignup({ email: 'user@test.com', password: 'password123' }, db, TEST_SECURITY_NO_SIGNUP)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ── Session Duration ─────────────────────────────────────────

  describe('session duration', () => {
    it('uses custom sessionDuration from security config', async () => {
      const db = createMockD1({ firstReturnsNull: true });
      const customSecurity = { ...TEST_SECURITY, sessionDuration: 3600 };

      await authSignup(
        { email: 'user@test.com', password: 'password123' },
        db,
        customSecurity
      );

      // The session INSERT should use expiresAt(3600) — verify bind is ~1h from now
      const sessionInsert = db._queries.find((q) => q.sql.includes('INSERT INTO _auth_sessions'));
      const expiresAtBind = sessionInsert!.binds[2] as string;
      const expiresMs = new Date(expiresAtBind).getTime();
      const oneHourFromNow = Date.now() + 3600 * 1000;
      expect(expiresMs).toBeGreaterThan(oneHourFromNow - 5000);
      expect(expiresMs).toBeLessThan(oneHourFromNow + 5000);
    });
  });

  // ── Name Handling ────────────────────────────────────────────

  describe('name handling', () => {
    it('stores name when provided', async () => {
      const db = createMockD1({ firstReturnsNull: true });
      const result = await authSignup(
        { email: 'user@test.com', password: 'password123', name: 'Alice' },
        db,
        TEST_SECURITY
      );

      expect(result.user!.name).toBe('Alice');

      // Verify the INSERT includes the name
      const insertQuery = db._queries.find((q) => q.sql.includes('INSERT INTO _auth_users'));
      expect(insertQuery!.binds).toContain('Alice');
    });

    it('stores null when name not provided', async () => {
      const db = createMockD1({ firstReturnsNull: true });
      const result = await authSignup(
        { email: 'user@test.com', password: 'password123' },
        db,
        TEST_SECURITY
      );

      expect(result.user!.name).toBeNull();
    });

    it('returns email_verified as false for new users', async () => {
      const db = createMockD1({ firstReturnsNull: true });
      const result = await authSignup(
        { email: 'user@test.com', password: 'password123' },
        db,
        TEST_SECURITY
      );

      expect(result.user!.email_verified).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Privilege-escalation guard: public self-signup must never mint a
  // privileged role (regression for defaultRole:'admin' + allowSignup:true).
  // ──────────────────────────────────────────────────────────────────
  describe('self-signup privilege guard', () => {
    const withAdmin = (extra?: Partial<SecurityProps>): SecurityProps => ({
      authProviders: [{ provider: 'email' }],
      allowSignup: true,
      defaultRole: 'admin',
      roles: ['admin'],
      pageAccess: { '/admin': 'role:admin' },
      ...extra,
    } as SecurityProps);

    it('downgrades a privileged defaultRole (admin) to a safe role on self-signup', async () => {
      const db = createMockD1({ firstReturnsNull: true });
      const result = await authSignup(
        { email: 'attacker@example.com', password: 'password123' },
        db,
        withAdmin(),
      );
      // The exploit: without the guard this would be ['admin'].
      expect(result.user!.roles).toEqual(['user']);
      expect(result.user!.roles).not.toContain('admin');
      // The persisted row must also carry the safe role, not admin.
      const insert = db._queries.find((q) => q.sql.includes('INSERT INTO _auth_users'));
      expect(insert!.binds).toContain(JSON.stringify(['user']));
      expect(insert!.binds).not.toContain(JSON.stringify(['admin']));
    });

    it('downgrades to the least-privileged DECLARED role when one exists', async () => {
      const db = createMockD1({ firstReturnsNull: true });
      const result = await authSignup(
        { email: 'x@example.com', password: 'password123' },
        db,
        withAdmin({ roles: ['admin', 'customer'] }),
      );
      expect(result.user!.roles).toEqual(['customer']);
    });

    it('downgrades a custom role that gates a restricted page (role:editor)', async () => {
      const db = createMockD1({ firstReturnsNull: true });
      const result = await authSignup(
        { email: 'x@example.com', password: 'password123' },
        db,
        {
          authProviders: [{ provider: 'email' }],
          allowSignup: true,
          defaultRole: 'editor',
          roles: ['editor', 'viewer'],
          pageAccess: { '/studio': 'role:editor' },
        } as SecurityProps,
      );
      expect(result.user!.roles).toEqual(['viewer']);
    });

    it('leaves a non-privileged defaultRole untouched', async () => {
      const db = createMockD1({ firstReturnsNull: true });
      const result = await authSignup(
        { email: 'ok@example.com', password: 'password123' },
        db,
        {
          authProviders: [{ provider: 'email' }],
          allowSignup: true,
          defaultRole: 'member',
          roles: ['member'],
        } as SecurityProps,
      );
      expect(result.user!.roles).toEqual(['member']);
    });

    it('does NOT pick a HANDLER-gated role as the safe fallback (needs models/handlers)', async () => {
      // The HIGH review finding: 'staff' gates only a HANDLER (no page), so a
      // page-only privilege check would wrongly treat it as "safe" and the
      // downgrade would re-grant handler power. With handlers threaded in via
      // deps, the fallback must skip 'staff' and settle on 'user'.
      const security = {
        authProviders: [{ provider: 'email' }],
        allowSignup: true,
        defaultRole: 'admin', // reserved → triggers downgrade
        roles: ['admin', 'staff', 'user'],
      } as SecurityProps;
      const handlers = [{ name: 'wipeOrders', authLevel: 'role:staff' }] as any;
      const result = await authSignup(
        { email: 'y@example.com', password: 'password123' },
        createMockD1({ firstReturnsNull: true }),
        security,
        undefined as any,
        { handlers } as any,
      );
      expect(result.user!.roles).toEqual(['user']);
      expect(result.user!.roles).not.toContain('staff');
    });

    it('does NOT downgrade a defaultRole that gates only a HANDLER (narrow trigger — "members can create")', () => {
      // Legit pattern: defaultRole is a member role whose only gate is a handler
      // or CRUD op, not a page. That is the intended capability for signups and
      // must be preserved.
      const handlers = [{ name: 'createPost', authLevel: 'role:member' }] as any;
      expect(
        resolveSelfSignupRole(
          {
            defaultRole: 'member',
            roles: ['member'],
          } as SecurityProps,
          { handlers },
        ),
      ).toEqual({ role: 'member' });
    });

    it('resolveSelfSignupRole: matrix (reserved + page gates downgrade; handler/CRUD gates block the fallback)', () => {
      // reserved admin, no safe declared role → 'user'
      expect(resolveSelfSignupRole(withAdmin())).toEqual({ role: 'user', downgradedFrom: 'admin' });
      // reserved admin, safe declared role → that role
      expect(resolveSelfSignupRole(withAdmin({ roles: ['admin', 'shopper'] }))).toEqual({
        role: 'shopper',
        downgradedFrom: 'admin',
      });
      // page-gate role (role:editor) triggers downgrade even though not "admin"
      expect(
        resolveSelfSignupRole({
          defaultRole: 'editor',
          roles: ['editor', 'viewer'],
          pageAccess: { '/x': 'role:editor' },
        } as SecurityProps),
      ).toEqual({ role: 'viewer', downgradedFrom: 'editor' });
      // fallback safety: 'staff' gates a MODEL CRUD op → skipped as a fallback
      expect(
        resolveSelfSignupRole(
          { defaultRole: 'admin', roles: ['admin', 'staff', 'user'] } as SecurityProps,
          { models: [{ name: 'orders', crudPolicy: { delete: 'role:staff' } }] as any },
        ),
      ).toEqual({ role: 'user', downgradedFrom: 'admin' });
      // non-privileged → unchanged, no downgrade
      expect(resolveSelfSignupRole({ defaultRole: 'customer', roles: ['customer'] } as SecurityProps)).toEqual({
        role: 'customer',
      });
      // unset → 'user'
      expect(resolveSelfSignupRole({} as SecurityProps)).toEqual({ role: 'user' });
    });
  });
});
