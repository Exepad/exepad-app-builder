/**
 * Tests for API key validation — validateApiKey, buildApiKeyUserContext.
 */

import { describe, it, expect } from 'vitest';
import {
  validateApiKey,
  buildApiKeyUserContext,
  generateApiKey,
  hashApiKey,
} from '../../src/auth/api-keys';
import { createMockD1 } from '../helpers/mock-d1';

describe('validateApiKey', () => {
  it('returns key metadata for a valid key', async () => {
    const rawKey = generateApiKey();
    const keyHash = await hashApiKey(rawKey);

    const db = createMockD1({
      results: new Map([
        [
          '_auth_api_keys',
          [
            {
              id: 'key-1',
              user_id: 'user-123',
              scopes: '["model:contacts:read","handler:getStats"]',
              expires_at: null,
              revoked_at: null,
              email: 'test@example.com',
              name: 'Test User',
              roles: '["admin"]',
            },
          ],
        ],
      ]),
    });

    const result = await validateApiKey(rawKey, db);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('key-1');
    expect(result!.userId).toBe('user-123');
    expect(result!.scopes).toEqual(['model:contacts:read', 'handler:getStats']);
    expect(result!.email).toBe('test@example.com');
    expect(result!.name).toBe('Test User');
    expect(result!.roles).toBe('["admin"]');
  });

  it('returns null for unknown key (no matching hash)', async () => {
    const rawKey = generateApiKey();
    const db = createMockD1({ firstReturnsNull: true });

    const result = await validateApiKey(rawKey, db);
    expect(result).toBeNull();
  });

  it('returns null for revoked key', async () => {
    const rawKey = generateApiKey();

    const db = createMockD1({
      results: new Map([
        [
          '_auth_api_keys',
          [
            {
              id: 'key-1',
              user_id: 'user-123',
              scopes: '["*"]',
              expires_at: null,
              revoked_at: '2024-01-01T00:00:00Z', // revoked
              email: 'test@example.com',
              name: null,
              roles: '',
            },
          ],
        ],
      ]),
    });

    const result = await validateApiKey(rawKey, db);
    expect(result).toBeNull();
  });

  it('returns null for expired key', async () => {
    const rawKey = generateApiKey();

    const db = createMockD1({
      results: new Map([
        [
          '_auth_api_keys',
          [
            {
              id: 'key-1',
              user_id: 'user-123',
              scopes: '["*"]',
              expires_at: '2020-01-01T00:00:00Z', // expired in the past
              revoked_at: null,
              email: 'test@example.com',
              name: null,
              roles: '',
            },
          ],
        ],
      ]),
    });

    const result = await validateApiKey(rawKey, db);
    expect(result).toBeNull();
  });

  it('accepts key with future expiry', async () => {
    const rawKey = generateApiKey();
    const futureDate = new Date(Date.now() + 365 * 86400 * 1000).toISOString();

    const db = createMockD1({
      results: new Map([
        [
          '_auth_api_keys',
          [
            {
              id: 'key-1',
              user_id: 'user-123',
              scopes: '["*"]',
              expires_at: futureDate,
              revoked_at: null,
              email: 'test@example.com',
              name: 'Test',
              roles: '',
            },
          ],
        ],
      ]),
    });

    const result = await validateApiKey(rawKey, db);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('key-1');
  });

  it('fires last_used_at update (does not block on it)', async () => {
    const rawKey = generateApiKey();

    const db = createMockD1({
      results: new Map([
        [
          '_auth_api_keys',
          [
            {
              id: 'key-1',
              user_id: 'user-123',
              scopes: '["*"]',
              expires_at: null,
              revoked_at: null,
              email: 'test@example.com',
              name: null,
              roles: '',
            },
          ],
        ],
      ]),
    });

    await validateApiKey(rawKey, db);

    // Allow microtask to flush the fire-and-forget update
    await new Promise((r) => setTimeout(r, 10));

    const updateQuery = db._queries.find(
      (q) => q.sql.includes('UPDATE') && q.sql.includes('last_used_at'),
    );
    expect(updateQuery).toBeDefined();
  });

  it('returns null for corrupted scopes JSON', async () => {
    const rawKey = generateApiKey();

    const db = createMockD1({
      results: new Map([
        [
          '_auth_api_keys',
          [
            {
              id: 'key-1',
              user_id: 'user-123',
              scopes: '{broken json', // corrupted
              expires_at: null,
              revoked_at: null,
              email: 'test@example.com',
              name: null,
              roles: '',
            },
          ],
        ],
      ]),
    });

    const result = await validateApiKey(rawKey, db);
    expect(result).toBeNull();
  });

  it('returns null for malformed expires_at date', async () => {
    const rawKey = generateApiKey();

    const db = createMockD1({
      results: new Map([
        [
          '_auth_api_keys',
          [
            {
              id: 'key-1',
              user_id: 'user-123',
              scopes: '["*"]',
              expires_at: 'not-a-valid-date', // malformed
              revoked_at: null,
              email: 'test@example.com',
              name: null,
              roles: '',
            },
          ],
        ],
      ]),
    });

    // Malformed dates should be treated as expired (deny access)
    const result = await validateApiKey(rawKey, db);
    expect(result).toBeNull();
  });

  it('parses empty scopes gracefully', async () => {
    const rawKey = generateApiKey();

    const db = createMockD1({
      results: new Map([
        [
          '_auth_api_keys',
          [
            {
              id: 'key-1',
              user_id: 'user-123',
              scopes: '', // empty
              expires_at: null,
              revoked_at: null,
              email: 'test@example.com',
              name: null,
              roles: '',
            },
          ],
        ],
      ]),
    });

    const result = await validateApiKey(rawKey, db);
    expect(result).not.toBeNull();
    expect(result!.scopes).toEqual([]);
  });
});

describe('buildApiKeyUserContext', () => {
  it('builds correct UserContext from validated key', () => {
    const ctx = buildApiKeyUserContext({
      id: 'key-1',
      userId: 'user-123',
      scopes: ['model:contacts:read', 'handler:getStats'],
      email: 'test@example.com',
      name: 'Test User',
      roles: '["admin"]',
    });

    expect(ctx.id).toBe('user-123');
    expect(ctx.email).toBe('test@example.com');
    expect(ctx.name).toBe('Test User');
    expect(ctx.roles).toEqual(['admin']);
    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.authMethod).toBe('api_key');
    expect(ctx.apiKeyScopes).toEqual(['model:contacts:read', 'handler:getStats']);
    expect(ctx.apiKeyId).toBe('key-1');
  });

  it('handles null name', () => {
    const ctx = buildApiKeyUserContext({
      id: 'key-1',
      userId: 'user-123',
      scopes: ['*'],
      email: 'test@example.com',
      name: null,
      roles: '',
    });

    expect(ctx.name).toBeUndefined();
  });

  it('parses comma-separated legacy roles', () => {
    const ctx = buildApiKeyUserContext({
      id: 'key-1',
      userId: 'user-123',
      scopes: ['*'],
      email: 'test@example.com',
      name: null,
      roles: 'admin,editor',
    });

    expect(ctx.roles).toEqual(['admin', 'editor']);
  });

  it('handles empty roles', () => {
    const ctx = buildApiKeyUserContext({
      id: 'key-1',
      userId: 'user-123',
      scopes: ['*'],
      email: 'test@example.com',
      name: null,
      roles: '',
    });

    expect(ctx.roles).toEqual([]);
  });
});
