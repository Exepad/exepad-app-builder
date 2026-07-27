/**
 * Tests for API key RPC handlers — create, list, revoke, rotate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  authCreateApiKey,
  authListApiKeys,
  authRevokeApiKey,
  authRotateApiKey,
  hashApiKey,
} from '../../src/auth/api-keys';
import { createMockD1 } from '../helpers/mock-d1';
import type { UserContext } from '../../src/rpc/types';

const authenticatedUser: UserContext = {
  id: 'user-123',
  email: 'test@example.com',
  roles: [],
  isAuthenticated: true,
  authMethod: 'session',
};

const unauthenticatedUser: UserContext = {
  id: '',
  email: '',
  roles: [],
  isAuthenticated: false,
  authMethod: 'platform_header',
};

describe('authCreateApiKey', () => {
  it('returns raw key and key info on success', async () => {
    const db = createMockD1();
    const result = await authCreateApiKey(
      { name: 'My Key', scopes: ['*'] },
      db,
      authenticatedUser,
    );

    expect(result.rawKey).toMatch(/^exepad_sk_[0-9a-f]{48}$/);
    expect(result.key.name).toBe('My Key');
    expect(result.key.scopes).toEqual(['*']);
    expect(result.key.id).toBeTruthy();
    expect(result.key.keyPrefix).toHaveLength(14);
    expect(result.key.revokedAt).toBeNull();
    expect(result.key.lastUsedAt).toBeNull();
    expect(result.key.createdAt).toBeTruthy();
  });

  it('stores key hash in DB (not raw key)', async () => {
    const db = createMockD1();
    const result = await authCreateApiKey(
      { name: 'Test', scopes: ['model:contacts:read'] },
      db,
      authenticatedUser,
    );

    // Verify an INSERT was executed
    const insertQuery = db._queries.find((q) => q.sql.includes('INSERT INTO'));
    expect(insertQuery).toBeDefined();

    // The raw key should not appear in any bind values
    const allBinds = db._queries.flatMap((q) => q.binds);
    expect(allBinds).not.toContain(result.rawKey);

    // The hash should appear in bind values
    const expectedHash = await hashApiKey(result.rawKey);
    expect(allBinds).toContain(expectedHash);
  });

  it('trims whitespace from name', async () => {
    const db = createMockD1();
    const result = await authCreateApiKey(
      { name: '  Padded Name  ', scopes: ['*'] },
      db,
      authenticatedUser,
    );

    expect(result.key.name).toBe('Padded Name');
  });

  it('sets expiresAt when expiresInDays is provided', async () => {
    const db = createMockD1();
    const result = await authCreateApiKey(
      { name: 'Expiring Key', scopes: ['*'], expiresInDays: 30 },
      db,
      authenticatedUser,
    );

    expect(result.key.expiresAt).toBeTruthy();
    const expiresDate = new Date(result.key.expiresAt!);
    const now = new Date();
    // Should expire roughly 30 days from now (allow some slack for test execution)
    const diffDays = (expiresDate.getTime() - now.getTime()) / (1000 * 86400);
    expect(diffDays).toBeGreaterThan(29);
    expect(diffDays).toBeLessThan(31);
  });

  it('expiresAt is null when expiresInDays is not provided', async () => {
    const db = createMockD1();
    const result = await authCreateApiKey(
      { name: 'No Expiry', scopes: ['*'] },
      db,
      authenticatedUser,
    );

    expect(result.key.expiresAt).toBeNull();
  });

  it('throws UnauthorizedError for unauthenticated user', async () => {
    const db = createMockD1();
    await expect(
      authCreateApiKey({ name: 'Test', scopes: ['*'] }, db, unauthenticatedUser),
    ).rejects.toThrow('Authentication required');
  });

  it('throws ValidationError for missing name', async () => {
    const db = createMockD1();
    await expect(
      authCreateApiKey({ scopes: ['*'] }, db, authenticatedUser),
    ).rejects.toThrow('API key name is required');
  });

  it('throws ValidationError for empty name', async () => {
    const db = createMockD1();
    await expect(
      authCreateApiKey({ name: '', scopes: ['*'] }, db, authenticatedUser),
    ).rejects.toThrow('API key name is required');
  });

  it('throws ValidationError for missing scopes', async () => {
    const db = createMockD1();
    await expect(
      authCreateApiKey({ name: 'Test' }, db, authenticatedUser),
    ).rejects.toThrow('At least one scope is required');
  });

  it('throws ValidationError for empty scopes array', async () => {
    const db = createMockD1();
    await expect(
      authCreateApiKey({ name: 'Test', scopes: [] }, db, authenticatedUser),
    ).rejects.toThrow('At least one scope is required');
  });

  it('throws ValidationError for invalid scope format', async () => {
    const db = createMockD1();
    await expect(
      authCreateApiKey({ name: 'Test', scopes: ['invalid'] }, db, authenticatedUser),
    ).rejects.toThrow("Invalid scope format: 'invalid'");
  });

  it('throws ValidationError for negative expiresInDays', async () => {
    const db = createMockD1();
    await expect(
      authCreateApiKey(
        { name: 'Test', scopes: ['*'], expiresInDays: -1 },
        db,
        authenticatedUser,
      ),
    ).rejects.toThrow('expiresInDays must be a positive number');
  });

  it('accepts multiple valid scopes', async () => {
    const db = createMockD1();
    const scopes = ['model:contacts:read', 'model:contacts:create', 'handler:getStats'];
    const result = await authCreateApiKey(
      { name: 'Multi-scope', scopes },
      db,
      authenticatedUser,
    );

    expect(result.key.scopes).toEqual(scopes);
  });

  it('throws ValidationError for whitespace-only name', async () => {
    const db = createMockD1();
    await expect(
      authCreateApiKey({ name: '   ', scopes: ['*'] }, db, authenticatedUser),
    ).rejects.toThrow('API key name is required');
  });

  it('throws ValidationError for zero expiresInDays', async () => {
    const db = createMockD1();
    await expect(
      authCreateApiKey(
        { name: 'Test', scopes: ['*'], expiresInDays: 0 },
        db,
        authenticatedUser,
      ),
    ).rejects.toThrow('expiresInDays must be a positive number');
  });

  it('throws ValidationError for non-numeric expiresInDays', async () => {
    const db = createMockD1();
    await expect(
      authCreateApiKey(
        { name: 'Test', scopes: ['*'], expiresInDays: 'thirty' },
        db,
        authenticatedUser,
      ),
    ).rejects.toThrow('expiresInDays must be a positive number');
  });
});

describe('authListApiKeys', () => {
  it('returns empty array when no keys exist', async () => {
    const db = createMockD1();
    const result = await authListApiKeys({}, db, authenticatedUser);
    expect(result).toEqual([]);
  });

  it('returns keys for authenticated user', async () => {
    const db = createMockD1({
      results: new Map([
        [
          '_auth_api_keys',
          [
            {
              id: 'key-1',
              name: 'My Key',
              key_prefix: 'exepad_sk_abc',
              scopes: '["*"]',
              expires_at: null,
              last_used_at: '2024-01-01T00:00:00Z',
              created_at: '2024-01-01T00:00:00Z',
              revoked_at: null,
            },
          ],
        ],
      ]),
    });

    const result = await authListApiKeys({}, db, authenticatedUser);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('key-1');
    expect(result[0].name).toBe('My Key');
    expect(result[0].keyPrefix).toBe('exepad_sk_abc');
    expect(result[0].scopes).toEqual(['*']);
    expect(result[0].lastUsedAt).toBe('2024-01-01T00:00:00Z');
    expect(result[0].revokedAt).toBeNull();
  });

  it('never returns key hash or raw key', async () => {
    const db = createMockD1({
      results: new Map([
        [
          '_auth_api_keys',
          [
            {
              id: 'key-1',
              name: 'Test',
              key_prefix: 'exepad_sk_1234',
              scopes: '[]',
              expires_at: null,
              last_used_at: null,
              created_at: '2024-01-01T00:00:00Z',
              revoked_at: null,
              key_hash: 'should_not_appear',
            },
          ],
        ],
      ]),
    });

    const result = await authListApiKeys({}, db, authenticatedUser);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('should_not_appear');
    expect(serialized).not.toContain('key_hash');
    expect(serialized).not.toContain('rawKey');
  });

  it('throws UnauthorizedError for unauthenticated user', async () => {
    const db = createMockD1();
    await expect(authListApiKeys({}, db, unauthenticatedUser)).rejects.toThrow(
      'Authentication required',
    );
  });

  it('handles corrupted scopes JSON gracefully', async () => {
    const db = createMockD1({
      results: new Map([
        [
          '_auth_api_keys',
          [
            {
              id: 'key-1',
              name: 'Broken',
              key_prefix: 'exepad_sk_1234',
              scopes: '{not valid json',
              expires_at: null,
              last_used_at: null,
              created_at: '2024-01-01T00:00:00Z',
              revoked_at: null,
            },
          ],
        ],
      ]),
    });

    // Should not throw — corrupted scopes default to empty array
    const result = await authListApiKeys({}, db, authenticatedUser);
    expect(result).toHaveLength(1);
    expect(result[0].scopes).toEqual([]);
  });
});

describe('authRevokeApiKey', () => {
  it('revokes an existing key', async () => {
    const db = createMockD1();
    const result = await authRevokeApiKey({ keyId: 'key-1' }, db, authenticatedUser);
    expect(result).toEqual({ revoked: true });

    // Verify UPDATE was executed with correct params
    const updateQuery = db._queries.find((q) => q.sql.includes('UPDATE'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery!.binds).toContain('key-1');
    expect(updateQuery!.binds).toContain(authenticatedUser.id);
  });

  it('throws NotFoundError when key does not exist', async () => {
    const db = createMockD1();
    // Override run to return 0 changes
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = origPrepare(sql);
      if (sql.includes('UPDATE')) {
        const origBind = stmt.bind.bind(stmt);
        stmt.bind = (...args: unknown[]) => {
          const bound = origBind(...args);
          bound.run = async () => ({
            results: [],
            success: true,
            meta: {
              duration: 0,
              served_by: 'mock',
              changes: 0,
              last_row_id: 0,
              changed_db: false,
              size_after: 0,
              rows_read: 0,
              rows_written: 0,
            },
          });
          return bound;
        };
      }
      return stmt;
    };

    await expect(
      authRevokeApiKey({ keyId: 'nonexistent' }, db, authenticatedUser),
    ).rejects.toThrow(/not found/i);
  });

  it('throws ValidationError for missing keyId', async () => {
    const db = createMockD1();
    await expect(authRevokeApiKey({}, db, authenticatedUser)).rejects.toThrow(
      'keyId is required',
    );
  });

  it('throws UnauthorizedError for unauthenticated user', async () => {
    const db = createMockD1();
    await expect(
      authRevokeApiKey({ keyId: 'key-1' }, db, unauthenticatedUser),
    ).rejects.toThrow('Authentication required');
  });
});

describe('authRotateApiKey', () => {
  it('revokes old key and creates new one', async () => {
    const db = createMockD1({
      results: new Map([
        [
          '_auth_api_keys',
          [
            {
              id: 'old-key',
              name: 'My Key',
              scopes: '["model:contacts:read"]',
              user_id: 'user-123',
              expires_at: '2025-12-31T00:00:00Z',
            },
          ],
        ],
      ]),
    });

    const result = await authRotateApiKey({ keyId: 'old-key' }, db, authenticatedUser);

    // New key returned
    expect(result.rawKey).toMatch(/^exepad_sk_[0-9a-f]{48}$/);
    expect(result.key.id).toBeTruthy();
    expect(result.key.id).not.toBe('old-key');
    expect(result.key.name).toBe('My Key');
    expect(result.key.scopes).toEqual(['model:contacts:read']);
    expect(result.key.expiresAt).toBe('2025-12-31T00:00:00Z');
    expect(result.key.revokedAt).toBeNull();
  });

  it('preserves name and scopes from old key', async () => {
    const db = createMockD1({
      results: new Map([
        [
          '_auth_api_keys',
          [
            {
              id: 'old-key',
              name: 'Production',
              scopes: '["*"]',
              user_id: 'user-123',
              expires_at: null,
            },
          ],
        ],
      ]),
    });

    const result = await authRotateApiKey({ keyId: 'old-key' }, db, authenticatedUser);

    expect(result.key.name).toBe('Production');
    expect(result.key.scopes).toEqual(['*']);
    expect(result.key.expiresAt).toBeNull();
  });

  it('throws NotFoundError when old key not found', async () => {
    const db = createMockD1({ firstReturnsNull: true });
    await expect(
      authRotateApiKey({ keyId: 'nonexistent' }, db, authenticatedUser),
    ).rejects.toThrow(/not found/i);
  });

  it('throws ValidationError for missing keyId', async () => {
    const db = createMockD1();
    await expect(authRotateApiKey({}, db, authenticatedUser)).rejects.toThrow(
      'keyId is required',
    );
  });

  it('throws UnauthorizedError for unauthenticated user', async () => {
    const db = createMockD1();
    await expect(
      authRotateApiKey({ keyId: 'key-1' }, db, unauthenticatedUser),
    ).rejects.toThrow('Authentication required');
  });
});
