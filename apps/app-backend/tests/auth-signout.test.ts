/**
 * Auth Signout Handler Tests
 *
 * Covers: session deletion, cookie clear signal, missing token.
 */

import { describe, it, expect } from 'vitest';
import { authSignout } from '../src/auth/handlers/signout';
import { hashSessionToken } from '../src/auth/utils';
import { createMockD1 } from './helpers/mock-d1';

function makeRequest(token?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  return new Request('http://localhost/rpc', { method: 'POST', headers });
}

describe('authSignout', () => {
  it('deletes session and returns _clearSession: true', async () => {
    const db = createMockD1();
    const request = makeRequest('my-raw-token');

    const result = await authSignout({}, db, {}, request);

    expect(result._clearSession).toBe(true);
    const deleteQuery = db._queries.find((q) => q.sql.includes('DELETE'));
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery!.sql).toContain('_auth_sessions');
  });

  it('hashes raw token before querying D1', async () => {
    const db = createMockD1();
    const rawToken = 'raw-token-xyz';
    const request = makeRequest(rawToken);

    await authSignout({}, db, {}, request);

    const deleteQuery = db._queries.find((q) => q.sql.includes('DELETE'));
    const expectedHash = await hashSessionToken(rawToken);
    expect(deleteQuery!.binds[0]).toBe(expectedHash);
    // Raw token should NOT appear in binds
    expect(deleteQuery!.binds).not.toContain(rawToken);
  });

  it('returns _clearSession when X-Session-Token header is missing (already signed out)', async () => {
    const db = createMockD1();
    const request = makeRequest(); // no token

    // No token means already signed out — implementation returns gracefully
    // instead of throwing, so the browser can clear its cookie.
    const result = await authSignout({}, db, {}, request);
    expect(result._clearSession).toBe(true);
  });

  it('does not throw when session does not exist in DB (DELETE is idempotent)', async () => {
    const db = createMockD1();
    const request = makeRequest('nonexistent-token');

    // DELETE WHERE id = ? on a non-existent row succeeds silently in D1
    const result = await authSignout({}, db, {}, request);
    expect(result._clearSession).toBe(true);
  });

  it('does not return user object in result', async () => {
    const db = createMockD1();
    const request = makeRequest('some-token');

    const result = await authSignout({}, db, {}, request);
    expect(result.user).toBeUndefined();
  });
});
