import { vi, describe, it, expect, beforeEach } from 'vitest';

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
async function parseResponse(response: Response): Promise<{ body: any; status: number }> {
  const body = await response.json();
  return { body, status: response.status };
}

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

// ── Tests ────────────────────────────────────────────────────────
describe('POST /:appId/users/:userId/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('hashes the new password, updates the user, and revokes sessions', async () => {
    // Update password — 1 change
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [],
      meta: { changes: 1 },
    });
    // Delete sessions
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [],
      meta: { changes: 3 },
    });

    const response = await app.request('/test-app/users/user-1/reset-password', {
      method: 'POST',
      body: JSON.stringify({ newPassword: 'newSecurePass123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe('Password reset successfully');

    // Verify 2 queries were executed: update user + delete sessions
    expect(mockExecuteD1Query.mock.calls).toHaveLength(2);
    expect(mockExecuteD1Query.mock.calls[0][2]).toContain('UPDATE _auth_users');
    expect(mockExecuteD1Query.mock.calls[1][2]).toContain('DELETE FROM _auth_sessions');

    // Verify the password hash format in the UPDATE params
    const updateParams = mockExecuteD1Query.mock.calls[0][3];
    const passwordHash = updateParams[0] as string;
    // Same format + OWASP work factor as the app-backend's own hasher.
    expect(passwordHash).toMatch(/^pbkdf2:600000:[0-9a-f]{32}:[0-9a-f]{64}$/);
  });

  it('rejects password shorter than 8 characters with 400', async () => {
    const response = await app.request('/test-app/users/user-1/reset-password', {
      method: 'POST',
      body: JSON.stringify({ newPassword: 'short' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('at least 8 characters');
  });

  it('rejects request with missing newPassword with 400', async () => {
    const response = await app.request('/test-app/users/user-1/reset-password', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('newPassword is required');
  });

  it('returns 404 when user does not exist', async () => {
    // Update password — 0 changes (user not found)
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [],
      meta: { changes: 0 },
    });

    const response = await app.request('/test-app/users/nonexistent/reset-password', {
      method: 'POST',
      body: JSON.stringify({ newPassword: 'newSecurePass123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe('User not found');
  });

  it('returns 404 when auth tables do not exist', async () => {
    mockExecuteD1Query.mockRejectedValueOnce(
      new Error('D1_ERROR: no such table: _auth_users')
    );

    const response = await app.request('/test-app/users/user-1/reset-password', {
      method: 'POST',
      body: JSON.stringify({ newPassword: 'newSecurePass123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe('User not found');
  });

  it('returns 401 when authentication fails', async () => {
    mockAuthenticateAdmin.mockResolvedValue({
      unauthorized: true,
      status: 401,
      message: 'Unauthorized',
    });

    const response = await app.request('/test-app/users/user-1/reset-password', {
      method: 'POST',
      body: JSON.stringify({ newPassword: 'newSecurePass123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
  });
});
