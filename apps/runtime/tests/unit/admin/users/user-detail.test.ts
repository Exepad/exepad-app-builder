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

const MOCK_USER = {
  id: 'user-1',
  email: 'alice@example.com',
  name: 'Alice',
  avatar_url: null,
  roles: 'admin',
  email_verified: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

// ── Tests: GET user detail ───────────────────────────────────────
describe('GET /:appId/users/:userId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('returns user with active session count', async () => {
    // User query + session count run in parallel
    mockExecuteD1Query
      .mockResolvedValueOnce({ results: [MOCK_USER] })
      .mockResolvedValueOnce({ results: [{ count: 3 }] });

    const response = await app.request('/test-app/users/user-1');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('user-1');
    expect(body.data.email).toBe('alice@example.com');
    expect(body.data.sessions).toBe(3);
  });

  it('returns 404 when user does not exist', async () => {
    mockExecuteD1Query
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce({ results: [{ count: 0 }] });

    const response = await app.request('/test-app/users/nonexistent');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe('User not found');
  });

  it('returns 404 when auth tables do not exist', async () => {
    mockExecuteD1Query.mockRejectedValueOnce(
      new Error('D1_ERROR: no such table: _auth_users')
    );

    const response = await app.request('/test-app/users/user-1');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe('User not found');
  });
});

// ── Tests: PUT user detail ───────────────────────────────────────
describe('PUT /:appId/users/:userId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('updates user fields and sets updated_at', async () => {
    // Update query
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [],
      meta: { changes: 1 },
    });

    const response = await app.request('/test-app/users/user-1', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Alice Updated', roles: 'admin' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe('User updated');
    expect(body.data.changes).toBe(1);
  });

  it('rejects duplicate email with 409', async () => {
    // Email uniqueness check — existing user found
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [{ id: 'other-user' }],
    });

    const response = await app.request('/test-app/users/user-1', {
      method: 'PUT',
      body: JSON.stringify({ email: 'taken@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain('already exists');
  });

  it('rejects request with no valid fields with 400', async () => {
    const response = await app.request('/test-app/users/user-1', {
      method: 'PUT',
      body: JSON.stringify({ unknown_field: 'value' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('No valid fields');
  });

  it('converts email_verified boolean to 0/1 integer', async () => {
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [],
      meta: { changes: 1 },
    });

    const response = await app.request('/test-app/users/user-1', {
      method: 'PUT',
      body: JSON.stringify({ email_verified: true }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // Verify the update query params include 1 (not true) for email_verified
    const updateCall = mockExecuteD1Query.mock.calls[0];
    const updateParams = updateCall[3];
    // First param should be 1 (converted from true), then updated_at, then userId
    expect(updateParams[0]).toBe(1);
  });

  it('returns 404 when user does not exist', async () => {
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [],
      meta: { changes: 0 },
    });

    const response = await app.request('/test-app/users/nonexistent', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Updated' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe('User not found');
  });

  it('rejects invalid email format with 400', async () => {
    const response = await app.request('/test-app/users/user-1', {
      method: 'PUT',
      body: JSON.stringify({ email: 'not-an-email' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid email');
  });
});

// ── Tests: DELETE user ───────────────────────────────────────────
describe('DELETE /:appId/users/:userId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('cascades delete through sessions, accounts, and user', async () => {
    // 3 sequential deletes: sessions, accounts, user
    mockExecuteD1Query
      .mockResolvedValueOnce({ results: [], meta: { changes: 2 } })
      .mockResolvedValueOnce({ results: [], meta: { changes: 1 } })
      .mockResolvedValueOnce({ results: [], meta: { changes: 1 } });

    const response = await app.request('/test-app/users/user-1', {
      method: 'DELETE',
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe('User deleted');

    // Verify 3 DELETE queries were executed
    expect(mockExecuteD1Query.mock.calls).toHaveLength(3);

    // Verify order: sessions first, accounts second, user last
    expect(mockExecuteD1Query.mock.calls[0][2]).toContain('_auth_sessions');
    expect(mockExecuteD1Query.mock.calls[1][2]).toContain('_auth_accounts');
    expect(mockExecuteD1Query.mock.calls[2][2]).toContain('_auth_users');
  });

  it('returns 200 even when user does not exist (D1 DELETE is idempotent)', async () => {
    // All deletes affect 0 rows
    mockExecuteD1Query
      .mockResolvedValueOnce({ results: [], meta: { changes: 0 } })
      .mockResolvedValueOnce({ results: [], meta: { changes: 0 } })
      .mockResolvedValueOnce({ results: [], meta: { changes: 0 } });

    const response = await app.request('/test-app/users/nonexistent', {
      method: 'DELETE',
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe('User deleted');
  });

  it('returns 200 when auth tables do not exist', async () => {
    mockExecuteD1Query.mockRejectedValueOnce(
      new Error('D1_ERROR: no such table: _auth_sessions')
    );

    const response = await app.request('/test-app/users/user-1', {
      method: 'DELETE',
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe('User deleted');
  });
});
