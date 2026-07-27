/**
 * The admin create-user route hashes APP-user passwords with the app-backend's
 * shared helper (`@exepad/app-backend/auth/utils`) and validates emails inline
 * (`worker/src/routes/admin/users.ts`). We test both through the Hono route by
 * exercising the create-user endpoint.
 *
 * This file tests observable behaviour — hash format, work factor, round-trip
 * verification by the app-backend, and email validation rules — via the
 * POST /:appId/users route.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { verifyPassword, needsRehash } from '@exepad/app-backend/auth/utils';

// ── Mock functions (module-level) ────────────────────────────────
const mockAuthenticateAdmin = vi.fn();
const mockExecuteD1Query = vi.fn();
const mockExecuteD1DDL = vi.fn();

vi.mock('../../../../worker/src/lib/admin-auth', () => ({
  authenticateAdmin: (...args: unknown[]) => mockAuthenticateAdmin(...args),
  isAdminAuthError: (value: { unauthorized?: boolean } | null | undefined) =>
    value?.unauthorized === true,
}));

vi.mock('@exepad/deploy-utils', () => ({
  executeD1DDL: (...args: unknown[]) => mockExecuteD1DDL(...args),
  executeD1Query: (...args: unknown[]) => mockExecuteD1Query(...args),
  generateAuthDDL: () => ['CREATE TABLE IF NOT EXISTS _auth_users (id TEXT)'],
}));

// ── Import the Hono router (AFTER mocks) ─────────────────────────
import { Hono } from 'hono';
import { users } from '../../../../worker/src/routes/admin/users';

// Mount under /:appId/users to match production routing
const app = new Hono();
app.route('/:appId/users', users);

// ── Helpers ──────────────────────────────────────────────────────
const AUTH_CONTEXT = {
  appId: 'test-app',
  config: {
    accountId: 'acc',
    apiToken: 'tok',
    wfpNamespace: 'ns',
    appId: 'test-app',
    appAlias: 'test-app',
  },
  dbId: 'db-123',
};

async function parseResponse(response: Response): Promise<{ body: any; status: number }> {
  const body = await response.json();
  return { body, status: response.status };
}

// ── Tests: hashPassword format (observed via create user) ────────
describe('hashPassword (via POST /:appId/users)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('stores password in pbkdf2:<iterations>:<salt-hex>:<hash-hex> format at the 600k work factor', async () => {
    // Email uniqueness check — no existing user
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });
    // INSERT user — capture the SQL params
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });
    // INSERT account
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });

    const response = await app.request('/test-app/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'hash-test@example.com',
        password: 'mypassword123',
        name: 'Hash Test',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { status } = await parseResponse(response);
    expect(status).toBe(201);

    // The INSERT INTO _auth_users call is the second mock call
    const insertCall = mockExecuteD1Query.mock.calls[1];
    const params = insertCall[3]; // [id, email, passwordHash, name, roles, timestamp, timestamp]
    const passwordHash = params[2] as string;

    const parts = passwordHash.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('pbkdf2');
    // OWASP work factor — must match the app-backend constant, not the legacy 100k.
    expect(parts[1]).toBe('600000');
    // salt is 16 bytes = 32 hex chars
    expect(parts[2]).toMatch(/^[0-9a-f]{32}$/);
    // key is 32 bytes = 64 hex chars
    expect(parts[3]).toMatch(/^[0-9a-f]{64}$/);

    // The app-backend (which runs auth_signin) must accept what admin wrote,
    // and must not consider a freshly written hash in need of an upgrade.
    expect(await verifyPassword('mypassword123', passwordHash)).toBe(true);
    expect(await verifyPassword('wrongpassword', passwordHash)).toBe(false);
    expect(needsRehash(passwordHash)).toBe(false);
  });

  it('still verifies a pre-existing 100k hash written by an older build', async () => {
    // Fixture in the legacy on-disk shape: `pbkdf2:100000:<salt_hex>:<hash_hex>`,
    // derived here exactly as the old inline hasher did. verifyPassword reads the
    // iteration count back OUT of the stored string, so raising the write-side
    // work factor to 600k must not lock existing accounts out.
    const legacyIterations = 100_000;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('legacyPassword123'),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations: legacyIterations, hash: 'SHA-256' },
      keyMaterial,
      256,
    );
    const toHex = (bytes: Uint8Array) =>
      Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const legacyHash = `pbkdf2:${legacyIterations}:${toHex(salt)}:${toHex(new Uint8Array(bits))}`;

    expect(await verifyPassword('legacyPassword123', legacyHash)).toBe(true);
    expect(await verifyPassword('notThePassword', legacyHash)).toBe(false);
    // …and it is flagged for transparent upgrade on the next successful login.
    expect(needsRehash(legacyHash)).toBe(true);
  });

  it('produces different hashes for the same password due to random salt', async () => {
    // First creation
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });

    await app.request('/test-app/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'user1@example.com', password: 'samepassword' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const hash1 = (mockExecuteD1Query.mock.calls[1][3] as string[])[2];

    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);

    // Second creation
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });

    await app.request('/test-app/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'user2@example.com', password: 'samepassword' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const hash2 = (mockExecuteD1Query.mock.calls[1][3] as string[])[2];
    expect(hash1).not.toBe(hash2);
  });
});

// ── Tests: isValidEmail (via POST /:appId/users) ─────────────────
describe('isValidEmail (via POST /:appId/users)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('accepts valid email addresses', async () => {
    const validEmails = ['user@example.com', 'a@b.co', 'user+tag@domain.org'];

    for (const email of validEmails) {
      vi.clearAllMocks();
      mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);

      // Email uniqueness check + insert user + insert account
      mockExecuteD1Query.mockResolvedValueOnce({ results: [] });
      mockExecuteD1Query.mockResolvedValueOnce({ results: [] });
      mockExecuteD1Query.mockResolvedValueOnce({ results: [] });

      const response = await app.request('/test-app/users', {
        method: 'POST',
        body: JSON.stringify({ email, password: 'securepassword123' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const { status } = await parseResponse(response);
      expect(status).toBe(201);
    }
  });

  it('rejects email without @ symbol', async () => {
    const response = await app.request('/test-app/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'userexample.com', password: 'securepassword123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);
    expect(status).toBe(400);
    expect(body.error).toContain('Invalid email');
  });

  it('rejects email with spaces', async () => {
    const response = await app.request('/test-app/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'user @example.com', password: 'securepassword123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);
    expect(status).toBe(400);
    expect(body.error).toContain('Invalid email');
  });

  it('rejects email without domain part', async () => {
    const response = await app.request('/test-app/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@', password: 'securepassword123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);
    expect(status).toBe(400);
    expect(body.error).toContain('Invalid email');
  });

  it('rejects email longer than 254 characters', async () => {
    const longLocal = 'a'.repeat(243);
    const longEmail = `${longLocal}@example.com`;
    expect(longEmail.length).toBeGreaterThan(254);

    const response = await app.request('/test-app/users', {
      method: 'POST',
      body: JSON.stringify({ email: longEmail, password: 'securepassword123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);
    expect(status).toBe(400);
    expect(body.error).toContain('Invalid email');
  });

  it('rejects empty string', async () => {
    const response = await app.request('/test-app/users', {
      method: 'POST',
      body: JSON.stringify({ email: '', password: 'securepassword123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);
    expect(status).toBe(400);
    // empty email triggers the "email and password are required" check
    expect(body.success).toBe(false);
  });
});
