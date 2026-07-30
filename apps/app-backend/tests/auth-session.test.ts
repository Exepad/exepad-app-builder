/**
 * Session Validation Tests
 *
 * Covers: validateSession() — token hashing, D1 lookup, expiry, UserContext construction.
 */

import { describe, it, expect } from 'vitest';
import { validateSession } from '../src/auth/session';
import { hashSessionToken } from '../src/auth/utils';
import { createMockD1 } from './helpers/mock-d1';
import { createTestSessionRow } from './helpers/mock-auth';

describe('validateSession', () => {
  it('returns UserContext with authMethod session for valid token', async () => {
    const sessionRow = createTestSessionRow();
    const db = createMockD1({
      results: new Map([['_auth_sessions', [sessionRow]]]),
    });

    const result = await validateSession('raw-token-123', db);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(sessionRow.user_id);
    expect(result!.email).toBe(sessionRow.email);
    expect(result!.isAuthenticated).toBe(true);
    expect(result!.authMethod).toBe('session');
  });

  it('hashes raw token before D1 lookup', async () => {
    const db = createMockD1({ firstReturnsNull: true });
    const rawToken = 'my-raw-token';

    await validateSession(rawToken, db);

    // Verify the query used a hashed token, not the raw token
    const query = db._queries.find((q) => q.sql.includes('_auth_sessions'));
    expect(query).toBeDefined();
    const expectedHash = await hashSessionToken(rawToken);
    expect(query!.binds[0]).toBe(expectedHash);
  });

  it('returns null when no matching session found', async () => {
    const db = createMockD1({ firstReturnsNull: true });

    const result = await validateSession('unknown-token', db);
    expect(result).toBeNull();
  });

  it('returns null when session is expired (D1 filters via datetime)', async () => {
    // The D1 query includes "expires_at > datetime('now')" so expired sessions
    // return no rows. Mock returns null to simulate this.
    const db = createMockD1({ firstReturnsNull: true });

    const result = await validateSession('expired-token', db);
    expect(result).toBeNull();
  });

  it('parses roles from comma-separated string', async () => {
    const sessionRow = createTestSessionRow({ roles: 'admin,editor,user' });
    const db = createMockD1({
      results: new Map([['_auth_sessions', [sessionRow]]]),
    });

    const result = await validateSession('token', db);
    expect(result!.roles).toEqual(['admin', 'editor', 'user']);
  });

  it('returns empty roles array when roles column is empty', async () => {
    const sessionRow = createTestSessionRow({ roles: '' });
    const db = createMockD1({
      results: new Map([['_auth_sessions', [sessionRow]]]),
    });

    const result = await validateSession('token', db);
    expect(result!.roles).toEqual([]);
  });

  it('sets name from user record', async () => {
    const sessionRow = createTestSessionRow({ name: 'Alice' });
    const db = createMockD1({
      results: new Map([['_auth_sessions', [sessionRow]]]),
    });

    const result = await validateSession('token', db);
    expect(result!.name).toBe('Alice');
  });

  it('sets name to undefined when user record has null name', async () => {
    const sessionRow = createTestSessionRow({ name: null });
    const db = createMockD1({
      results: new Map([['_auth_sessions', [sessionRow]]]),
    });

    const result = await validateSession('token', db);
    expect(result!.name).toBeUndefined();
  });

  it('trims whitespace from role names', async () => {
    const sessionRow = createTestSessionRow({ roles: ' admin , editor , user ' });
    const db = createMockD1({
      results: new Map([['_auth_sessions', [sessionRow]]]),
    });

    const result = await validateSession('token', db);
    expect(result!.roles).toEqual(['admin', 'editor', 'user']);
  });

  it('filters empty segments from double commas in roles', async () => {
    const sessionRow = createTestSessionRow({ roles: 'admin,,user' });
    const db = createMockD1({
      results: new Map([['_auth_sessions', [sessionRow]]]),
    });

    const result = await validateSession('token', db);
    expect(result!.roles).toEqual(['admin', 'user']);
  });

  it('preserves empty string name (not coerced to undefined)', async () => {
    const sessionRow = createTestSessionRow({ name: '' });
    const db = createMockD1({
      results: new Map([['_auth_sessions', [sessionRow]]]),
    });

    const result = await validateSession('token', db);
    // Empty string is falsy but not null/undefined — `??` only catches null/undefined
    expect(result!.name).toBe('');
  });
});
