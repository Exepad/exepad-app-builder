/**
 * Auth Access Utility Tests
 *
 * Covers: checkPageAccess and canAccessPage — all AccessLevel values,
 * role hierarchy, loading state, unknown levels.
 */

import { describe, it, expect } from 'vitest';
import { checkPageAccess, canAccessPage, type AuthState } from '@/utils/authAccess';

// ── Test fixtures ─────────────────────────────────────────────────

const AUTH_LOADING: AuthState = {
  isAuthenticated: false,
  isLoading: true,
  user: null,
  roles: [],
  error: null,
};

const AUTH_ANON: AuthState = {
  isAuthenticated: false,
  isLoading: false,
  user: null,
  roles: [],
  error: null,
};

const AUTH_USER: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  user: { id: 'u1', email: 'user@test.com', roles: ['user'] },
  roles: ['user'],
  error: null,
};

const AUTH_EDITOR: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  user: { id: 'u2', email: 'editor@test.com', roles: ['editor'] },
  roles: ['editor'],
  error: null,
};

const AUTH_ADMIN: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  user: { id: 'u3', email: 'admin@test.com', roles: ['admin'] },
  roles: ['admin'],
  error: null,
};

// ── checkPageAccess ───────────────────────────────────────────────

describe('checkPageAccess', () => {
  describe('public access', () => {
    it('allows unauthenticated user', () => {
      expect(checkPageAccess('public', AUTH_ANON)).toEqual({ allowed: true });
    });

    it('allows authenticated user', () => {
      expect(checkPageAccess('public', AUTH_USER)).toEqual({ allowed: true });
    });
  });

  it('undefined access defaults to public (allowed)', () => {
    expect(checkPageAccess(undefined, AUTH_ANON)).toEqual({ allowed: true });
  });

  it("'none' access always denied", () => {
    const result = checkPageAccess('none', AUTH_ADMIN);
    expect(result.allowed).toBe(false);
    expect(result).toHaveProperty('reason', 'forbidden');
  });

  it("loading state returns { reason: 'loading' }", () => {
    const result = checkPageAccess('authenticated', AUTH_LOADING);
    expect(result.allowed).toBe(false);
    expect(result).toHaveProperty('reason', 'loading');
  });

  describe('authenticated access', () => {
    it('allows authenticated user', () => {
      expect(checkPageAccess('authenticated', AUTH_USER)).toEqual({ allowed: true });
    });

    it('denies unauthenticated user', () => {
      const result = checkPageAccess('authenticated', AUTH_ANON);
      expect(result.allowed).toBe(false);
      expect(result).toHaveProperty('reason', 'unauthenticated');
    });
  });

  it('owner access treated as authenticated', () => {
    expect(checkPageAccess('owner', AUTH_USER)).toEqual({ allowed: true });

    const denied = checkPageAccess('owner', AUTH_ANON);
    expect(denied.allowed).toBe(false);
    expect(denied).toHaveProperty('reason', 'unauthenticated');
  });

  describe('role-based access', () => {
    it('allows user with matching role', () => {
      expect(checkPageAccess('role:editor', AUTH_EDITOR)).toEqual({ allowed: true });
    });

    it('denies user without matching role', () => {
      const result = checkPageAccess('role:admin', AUTH_EDITOR);
      expect(result.allowed).toBe(false);
      expect(result).toHaveProperty('reason', 'forbidden');
      expect(result).toHaveProperty('requiredRole', 'admin');
    });

    it('denies unauthenticated user', () => {
      const result = checkPageAccess('role:editor', AUTH_ANON);
      expect(result.allowed).toBe(false);
      expect(result).toHaveProperty('reason', 'unauthenticated');
    });

    it('allows user via role hierarchy expansion', () => {
      const hierarchyMap = { admin: ['admin', 'editor', 'viewer'] };
      expect(checkPageAccess('role:editor', AUTH_ADMIN, hierarchyMap)).toEqual({ allowed: true });
    });

    it('denies when no hierarchy map and role not direct match', () => {
      const result = checkPageAccess('role:editor', AUTH_ADMIN); // no hierarchy map
      expect(result.allowed).toBe(false);
    });
  });

  describe("legacy 'admin' access", () => {
    it("allows user with 'admin' role", () => {
      expect(checkPageAccess('admin', AUTH_ADMIN)).toEqual({ allowed: true });
    });

    it("denies user without 'admin' role", () => {
      const result = checkPageAccess('admin', AUTH_USER);
      expect(result.allowed).toBe(false);
      expect(result).toHaveProperty('requiredRole', 'admin');
    });
  });

  it('unknown access level denies', () => {
    const result = checkPageAccess('some_unknown_level', AUTH_USER);
    expect(result.allowed).toBe(false);
    expect(result).toHaveProperty('reason', 'forbidden');
  });

  it('unknown access level denies unauthenticated as unauthenticated', () => {
    const result = checkPageAccess('some_unknown_level', AUTH_ANON);
    expect(result.allowed).toBe(false);
    expect(result).toHaveProperty('reason', 'unauthenticated');
  });
});

// ── canAccessPage ─────────────────────────────────────────────────

describe('canAccessPage', () => {
  it('returns true during loading (prevents nav flash)', () => {
    expect(canAccessPage('authenticated', AUTH_LOADING)).toBe(true);
  });

  it('returns true for public access', () => {
    expect(canAccessPage('public', AUTH_ANON)).toBe(true);
  });

  it('returns false for denied authenticated access', () => {
    expect(canAccessPage('authenticated', AUTH_ANON)).toBe(false);
  });

  it('returns true for matching role', () => {
    expect(canAccessPage('role:editor', AUTH_EDITOR)).toBe(true);
  });

  it('returns false for non-matching role', () => {
    expect(canAccessPage('role:admin', AUTH_USER)).toBe(false);
  });
});
