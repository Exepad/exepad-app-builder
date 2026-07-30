/**
 * Config Normalizer Tests
 *
 * Covers: legacy 'admin' → 'role:admin' migration in crudPolicy, handlers,
 * defaultAccess, and page access. Immutability guarantee.
 */

import { describe, it, expect } from 'vitest';
import { normalizeConfig } from '@/config/normalizer';

describe('normalizeConfig', () => {
  it('returns null/undefined unchanged', () => {
    expect(normalizeConfig(null)).toBeNull();
    expect(normalizeConfig(undefined)).toBeUndefined();
  });

  it('returns config unchanged when no auth-related fields', () => {
    const config = { frontend: { pages: [{ slug: '/' }] } };
    expect(normalizeConfig(config)).toBe(config); // same reference
  });

  // ── crudPolicy normalization ────────────────────────────────────

  describe('crudPolicy normalization', () => {
    it("converts 'admin' → 'role:admin' for all CRUD operations", () => {
      const config = {
        backend: {
          models: [{
            name: 'Post',
            crudPolicy: { create: 'admin', read: 'admin', update: 'admin', delete: 'admin', list: 'admin' },
          }],
        },
      };

      const result = normalizeConfig(config);
      const policy = result.backend.models[0].crudPolicy;
      expect(policy.create).toBe('role:admin');
      expect(policy.read).toBe('role:admin');
      expect(policy.update).toBe('role:admin');
      expect(policy.delete).toBe('role:admin');
      expect(policy.list).toBe('role:admin');
    });

    it("leaves 'public', 'authenticated', 'role:editor' unchanged", () => {
      const config = {
        backend: {
          models: [{
            name: 'Post',
            crudPolicy: { create: 'authenticated', read: 'public', update: 'role:editor', delete: 'none' },
          }],
        },
      };

      const result = normalizeConfig(config);
      const policy = result.backend.models[0].crudPolicy;
      expect(policy.create).toBe('authenticated');
      expect(policy.read).toBe('public');
      expect(policy.update).toBe('role:editor');
      expect(policy.delete).toBe('none');
    });

    it('handles multiple models', () => {
      const config = {
        backend: {
          models: [
            { name: 'A', crudPolicy: { create: 'admin' } },
            { name: 'B', crudPolicy: { create: 'public' } },
          ],
        },
      };

      const result = normalizeConfig(config);
      expect(result.backend.models[0].crudPolicy.create).toBe('role:admin');
      expect(result.backend.models[1].crudPolicy.create).toBe('public');
    });

    it('handles model with no crudPolicy', () => {
      const config = { backend: { models: [{ name: 'Post' }] } };
      const result = normalizeConfig(config);
      expect(result.backend.models[0].crudPolicy).toBeUndefined();
    });
  });

  // ── handler authLevel normalization ─────────────────────────────

  describe('handler authLevel normalization', () => {
    it("converts 'admin' → 'role:admin'", () => {
      const config = {
        backend: { handlers: [{ name: 'getStats', authLevel: 'admin' }] },
      };

      const result = normalizeConfig(config);
      expect(result.backend.handlers[0].authLevel).toBe('role:admin');
    });

    it('leaves other values unchanged', () => {
      const config = {
        backend: { handlers: [{ name: 'getPublic', authLevel: 'public' }] },
      };

      const result = normalizeConfig(config);
      expect(result.backend.handlers[0].authLevel).toBe('public');
    });

    it('handles handler with no authLevel', () => {
      const config = { backend: { handlers: [{ name: 'test' }] } };
      const result = normalizeConfig(config);
      expect(result.backend.handlers[0].authLevel).toBeUndefined();
    });
  });

  // ── security.defaultAccess normalization ────────────────────────

  describe('security.defaultAccess normalization', () => {
    it("converts 'admin' → 'role:admin'", () => {
      const config = { security: { defaultAccess: 'admin' } };
      const result = normalizeConfig(config);
      expect(result.security.defaultAccess).toBe('role:admin');
    });
  });

  // ── page access normalization ───────────────────────────────────

  describe('page access normalization', () => {
    it("converts 'admin' → 'role:admin'", () => {
      const config = {
        frontend: { pages: [{ slug: '/admin', access: 'admin' }] },
      };

      const result = normalizeConfig(config);
      expect(result.frontend.pages[0].access).toBe('role:admin');
    });

    it('leaves pages without access unchanged', () => {
      const config = {
        frontend: { pages: [{ slug: '/' }] },
      };

      const result = normalizeConfig(config);
      expect(result).toBe(config); // same reference — no change
    });
  });

  // ── immutability ────────────────────────────────────────────────

  it('does NOT mutate the input config', () => {
    const config = {
      backend: {
        models: [{ name: 'Post', crudPolicy: { create: 'admin' } }],
      },
    };
    const originalCreate = config.backend.models[0].crudPolicy.create;

    normalizeConfig(config);

    expect(config.backend.models[0].crudPolicy.create).toBe(originalCreate);
  });
});
