/**
 * Security Config Validator Tests
 *
 * Covers: role hierarchy cycle detection, undefined role references,
 * defaultAccess/page/handler restrictions, missing crudPolicy warnings.
 */

import { describe, it, expect } from 'vitest';
import { validateSecurityConfig } from '@/config/security-validator';

describe('validateSecurityConfig', () => {
  it('returns empty result when no security config', () => {
    const result = validateSecurityConfig({});
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('returns empty result for valid minimal config', () => {
    const result = validateSecurityConfig({
      security: { authProviders: [{ provider: 'email' }] },
    });
    expect(result.errors).toEqual([]);
  });

  // ── Role hierarchy cycles ──────────────────────────────────────

  describe('role hierarchy cycles', () => {
    it('detects direct cycle (A → B → A)', () => {
      const result = validateSecurityConfig({
        security: {
          roles: ['admin', 'editor'],
          roleHierarchy: { admin: ['editor'], editor: ['admin'] },
        },
      });
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('Circular'))).toBe(true);
    });

    it('detects self-referential cycle (A → A)', () => {
      const result = validateSecurityConfig({
        security: {
          roles: ['admin'],
          roleHierarchy: { admin: ['admin'] },
        },
      });
      expect(result.errors.some((e) => e.includes('Circular'))).toBe(true);
    });

    it('detects deep cycle (A → B → C → A)', () => {
      const result = validateSecurityConfig({
        security: {
          roles: ['a', 'b', 'c'],
          roleHierarchy: { a: ['b'], b: ['c'], c: ['a'] },
        },
      });
      expect(result.errors.some((e) => e.includes('Circular'))).toBe(true);
    });

    it('no false positive on valid deep chain', () => {
      const result = validateSecurityConfig({
        security: {
          roles: ['admin', 'editor', 'viewer'],
          roleHierarchy: { admin: ['editor'], editor: ['viewer'] },
        },
      });
      expect(result.errors.filter((e) => e.includes('Circular'))).toEqual([]);
    });
  });

  // ── Undefined role references ──────────────────────────────────

  describe('undefined role references', () => {
    it('warns when hierarchy parent not in roles', () => {
      const result = validateSecurityConfig({
        security: {
          roles: ['editor'],
          roleHierarchy: { admin: ['editor'] },
        },
      });
      expect(result.warnings.some((w) => w.includes("'admin'"))).toBe(true);
    });

    it('warns when hierarchy child not in roles', () => {
      const result = validateSecurityConfig({
        security: {
          roles: ['admin'],
          roleHierarchy: { admin: ['unknown'] },
        },
      });
      expect(result.warnings.some((w) => w.includes("'unknown'"))).toBe(true);
    });

    it('warns when defaultRole not in roles', () => {
      const result = validateSecurityConfig({
        security: {
          roles: ['user'],
          defaultRole: 'admin',
        },
      });
      expect(result.warnings.some((w) => w.includes('defaultRole'))).toBe(true);
    });
  });

  // ── defaultAccess restrictions ─────────────────────────────────

  describe('defaultAccess restrictions', () => {
    it("errors on 'owner'", () => {
      const result = validateSecurityConfig({
        security: { defaultAccess: 'owner' },
      });
      expect(result.errors.some((e) => e.includes('owner'))).toBe(true);
    });

    it("errors on 'none'", () => {
      const result = validateSecurityConfig({
        security: { defaultAccess: 'none' },
      });
      expect(result.errors.some((e) => e.includes('none'))).toBe(true);
    });

    it("allows 'authenticated'", () => {
      const result = validateSecurityConfig({
        security: { defaultAccess: 'authenticated' },
      });
      expect(result.errors.filter((e) => e.includes('defaultAccess'))).toEqual([]);
    });

    it('warns on undefined role reference in defaultAccess', () => {
      const result = validateSecurityConfig({
        security: {
          roles: ['user'],
          defaultAccess: 'role:admin',
        },
      });
      expect(result.warnings.some((w) => w.includes("'admin'"))).toBe(true);
    });
  });

  // ── Page access restrictions ───────────────────────────────────

  describe('page access restrictions', () => {
    it("errors on page.access = 'owner'", () => {
      const result = validateSecurityConfig({
        security: {},
        frontend: { pages: [{ slug: '/test', access: 'owner' }] },
      });
      expect(result.errors.some((e) => e.includes("Page '/test'") && e.includes('owner'))).toBe(true);
    });

    it("errors on page.access = 'none'", () => {
      const result = validateSecurityConfig({
        security: {},
        frontend: { pages: [{ slug: '/test', access: 'none' }] },
      });
      expect(result.errors.some((e) => e.includes("Page '/test'") && e.includes('none'))).toBe(true);
    });

    it('warns on undefined role reference', () => {
      const result = validateSecurityConfig({
        security: { roles: ['user'] },
        frontend: { pages: [{ slug: '/admin', access: 'role:superadmin' }] },
      });
      expect(result.warnings.some((w) => w.includes("'superadmin'"))).toBe(true);
    });

    it("allows valid access values ('authenticated', 'public')", () => {
      const result = validateSecurityConfig({
        security: {},
        frontend: { pages: [
          { slug: '/', access: 'public' },
          { slug: '/dashboard', access: 'authenticated' },
        ] },
      });
      expect(result.errors).toEqual([]);
    });
  });

  // ── Model crudPolicy ───────────────────────────────────────────

  describe('model crudPolicy', () => {
    it('warns when model has no crudPolicy in auth app', () => {
      const result = validateSecurityConfig({
        security: { authProviders: [{ provider: 'email' }] },
        backend: { models: [{ name: 'Post' }] },
      });
      expect(result.warnings.some((w) => w.includes("Model 'Post'") && w.includes('no crudPolicy'))).toBe(true);
    });

    it('warns on undefined role in crudPolicy operation', () => {
      const result = validateSecurityConfig({
        security: { roles: ['user'], authProviders: [{ provider: 'email' }] },
        backend: { models: [{ name: 'Post', crudPolicy: { create: 'role:admin' } }] },
      });
      expect(result.warnings.some((w) => w.includes("'admin'"))).toBe(true);
    });

    it('no warning when app has no authProviders', () => {
      const result = validateSecurityConfig({
        security: {},
        backend: { models: [{ name: 'Post' }] },
      });
      expect(result.warnings.filter((w) => w.includes('no crudPolicy'))).toEqual([]);
    });
  });

  // ── Handler authLevel restrictions ─────────────────────────────

  describe('handler authLevel restrictions', () => {
    it("errors on 'owner'", () => {
      const result = validateSecurityConfig({
        security: {},
        backend: { handlers: [{ name: 'myHandler', authLevel: 'owner' }] },
      });
      expect(result.errors.some((e) => e.includes("Handler 'myHandler'") && e.includes('owner'))).toBe(true);
    });

    it("errors on 'none'", () => {
      const result = validateSecurityConfig({
        security: {},
        backend: { handlers: [{ name: 'myHandler', authLevel: 'none' }] },
      });
      expect(result.errors.some((e) => e.includes("Handler 'myHandler'") && e.includes('none'))).toBe(true);
    });

    it('warns on undefined role reference', () => {
      const result = validateSecurityConfig({
        security: { roles: ['user'] },
        backend: { handlers: [{ name: 'myHandler', authLevel: 'role:superadmin' }] },
      });
      expect(result.warnings.some((w) => w.includes("'superadmin'"))).toBe(true);
    });
  });

  // ── Privileged self-signup guard ───────────────────────────────
  describe('privileged self-signup guard', () => {
    const priv = /privileged but allowSignup is enabled/;

    it('errors when allowSignup + defaultRole is a reserved admin role', () => {
      const result = validateSecurityConfig({
        security: {
          authProviders: [{ provider: 'email' }],
          allowSignup: true,
          defaultRole: 'admin',
          roles: ['admin'],
          pageAccess: { '/admin': 'role:admin' },
        },
      });
      expect(result.errors.some((e) => priv.test(e))).toBe(true);
    });

    it('errors when defaultRole gates a restricted page via security.pageAccess (role:editor)', () => {
      const result = validateSecurityConfig({
        security: {
          authProviders: [{ provider: 'email' }],
          allowSignup: true,
          defaultRole: 'editor',
          roles: ['editor', 'viewer'],
          pageAccess: { '/studio': 'role:editor' },
        },
      });
      expect(result.errors.some((e) => priv.test(e))).toBe(true);
    });

    it('WARNS (not errors) when defaultRole gates only backend CRUD/handlers — the "members can create" pattern', () => {
      const result = validateSecurityConfig({
        security: {
          authProviders: [{ provider: 'email' }],
          allowSignup: true,
          defaultRole: 'member',
          roles: ['member'],
        },
        backend: {
          models: [{ name: 'posts', crudPolicy: { create: 'role:member' } }],
          handlers: [{ name: 'publish', authLevel: 'role:member' }],
        },
      });
      // Not a privilege-escalation error (runtime does not downgrade it)…
      expect(result.errors.some((e) => priv.test(e))).toBe(false);
      // …but surfaced as a warning for operator visibility.
      expect(result.warnings.some((w) => /gates backend CRUD\/handlers/.test(w))).toBe(true);
    });

    it('does NOT error when signup is disabled (allowSignup:false)', () => {
      const result = validateSecurityConfig({
        security: {
          authProviders: [{ provider: 'email' }],
          allowSignup: false,
          defaultRole: 'admin',
          roles: ['admin'],
          pageAccess: { '/admin': 'role:admin' },
        },
      });
      expect(result.errors.some((e) => priv.test(e))).toBe(false);
    });

    it('does NOT error for a non-privileged defaultRole', () => {
      const result = validateSecurityConfig({
        security: {
          authProviders: [{ provider: 'email' }],
          allowSignup: true,
          defaultRole: 'user',
          roles: ['user', 'admin'],
          pageAccess: { '/admin': 'role:admin' },
        },
      });
      expect(result.errors.some((e) => priv.test(e))).toBe(false);
    });
  });
});
