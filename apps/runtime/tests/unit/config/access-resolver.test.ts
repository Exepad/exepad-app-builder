/**
 * Access Resolver Tests
 *
 * Covers: role hierarchy resolution (BFS expansion),
 * defaultAccess application to pages, diamond/circular handling.
 */

import { describe, it, expect } from 'vitest';
import { resolveRoleHierarchy, resolveAccess } from '@/config/access-resolver';

describe('resolveRoleHierarchy', () => {
  it('returns empty map for undefined roles', () => {
    expect(resolveRoleHierarchy(undefined, undefined)).toEqual({});
  });

  it('returns empty map for empty roles array', () => {
    expect(resolveRoleHierarchy([], {})).toEqual({});
  });

  it('returns identity map when no hierarchy', () => {
    const result = resolveRoleHierarchy(['admin', 'user'], undefined);
    expect(result).toEqual({
      admin: ['admin'],
      user: ['user'],
    });
  });

  it('resolves single-level inheritance', () => {
    const result = resolveRoleHierarchy(
      ['admin', 'editor'],
      { admin: ['editor'] }
    );
    expect(result.admin).toEqual(['admin', 'editor']);
    expect(result.editor).toEqual(['editor']);
  });

  it('resolves multi-level chain (admin → editor → viewer)', () => {
    const result = resolveRoleHierarchy(
      ['admin', 'editor', 'viewer'],
      { admin: ['editor'], editor: ['viewer'] }
    );
    expect(result.admin).toEqual(['admin', 'editor', 'viewer']);
    expect(result.editor).toEqual(['editor', 'viewer']);
    expect(result.viewer).toEqual(['viewer']);
  });

  it('resolves wide inheritance (admin → [editor, viewer, moderator])', () => {
    const result = resolveRoleHierarchy(
      ['admin', 'editor', 'viewer', 'moderator'],
      { admin: ['editor', 'viewer', 'moderator'] }
    );
    expect(result.admin).toContain('editor');
    expect(result.admin).toContain('viewer');
    expect(result.admin).toContain('moderator');
    expect(result.admin.length).toBe(4); // admin + 3 children
  });

  it('handles diamond hierarchy correctly', () => {
    // admin → [editor, reviewer], editor → viewer, reviewer → viewer
    const result = resolveRoleHierarchy(
      ['admin', 'editor', 'reviewer', 'viewer'],
      { admin: ['editor', 'reviewer'], editor: ['viewer'], reviewer: ['viewer'] }
    );
    // admin should have all roles, viewer only once
    expect(result.admin).toContain('admin');
    expect(result.admin).toContain('editor');
    expect(result.admin).toContain('reviewer');
    expect(result.admin).toContain('viewer');
    expect(result.admin.filter((r) => r === 'viewer').length).toBe(1);
  });

  it('handles circular reference gracefully (no infinite loop)', () => {
    const result = resolveRoleHierarchy(
      ['a', 'b'],
      { a: ['b'], b: ['a'] }
    );
    // Should complete without infinite loop
    expect(result.a).toContain('a');
    expect(result.a).toContain('b');
    expect(result.b).toContain('b');
    expect(result.b).toContain('a');
  });

  it('includes each role in its own expansion', () => {
    const result = resolveRoleHierarchy(['viewer'], {});
    expect(result.viewer).toEqual(['viewer']);
  });
});

describe('resolveAccess', () => {
  it('returns unchanged config when no security', () => {
    const config = { frontend: { pages: [] } };
    const result = resolveAccess(config);
    expect(result.config).toBe(config); // same reference
    expect(result.roleExpansionMap).toEqual({});
  });

  it('applies defaultAccess to pages without explicit access', () => {
    const config = {
      security: { defaultAccess: 'authenticated' },
      frontend: {
        pages: [
          { slug: '/', access: 'public' },
          { slug: '/dashboard' }, // no access
        ],
      },
    };

    const result = resolveAccess(config);
    expect(result.config.frontend.pages[0].access).toBe('public');
    expect(result.config.frontend.pages[1].access).toBe('authenticated');
  });

  it('does NOT overwrite pages with explicit access', () => {
    const config = {
      security: { defaultAccess: 'authenticated' },
      frontend: {
        pages: [{ slug: '/admin', access: 'role:admin' }],
      },
    };

    const result = resolveAccess(config);
    expect(result.config.frontend.pages[0].access).toBe('role:admin');
  });

  it('handles config with no pages', () => {
    const config = { security: { defaultAccess: 'authenticated' } };
    const result = resolveAccess(config);
    expect(result.config).toBe(config);
  });

  it('returns roleExpansionMap alongside config', () => {
    const config = {
      security: {
        roles: ['admin', 'editor'],
        roleHierarchy: { admin: ['editor'] },
      },
    };

    const result = resolveAccess(config);
    expect(result.roleExpansionMap.admin).toEqual(['admin', 'editor']);
  });

  it('returns empty roleExpansionMap when no roles', () => {
    const config = { security: {} };
    const result = resolveAccess(config);
    expect(result.roleExpansionMap).toEqual({});
  });
});
