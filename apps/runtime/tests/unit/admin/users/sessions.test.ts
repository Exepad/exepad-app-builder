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

// ── Tests: GET sessions ──────────────────────────────────────────
describe('GET /:appId/users/:userId/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('returns active sessions for the user', async () => {
    const mockSessions = [
      {
        id: 'sess-1',
        created_at: '2026-01-01T00:00:00.000Z',
        expires_at: '2026-01-08T00:00:00.000Z',
      },
      {
        id: 'sess-2',
        created_at: '2026-01-02T00:00:00.000Z',
        expires_at: '2026-01-09T00:00:00.000Z',
      },
    ];

    mockExecuteD1Query.mockResolvedValueOnce({ results: mockSessions });

    const response = await app.request('/test-app/users/user-1/sessions');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe('sess-1');
    expect(body.data[1].id).toBe('sess-2');
  });

  it('returns empty array when sessions table does not exist', async () => {
    mockExecuteD1Query.mockRejectedValueOnce(
      new Error('D1_ERROR: no such table: _auth_sessions')
    );

    const response = await app.request('/test-app/users/user-1/sessions');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('returns 401 when authentication fails', async () => {
    mockAuthenticateAdmin.mockResolvedValue({
      unauthorized: true,
      status: 401,
      message: 'Unauthorized',
    });

    const response = await app.request('/test-app/users/user-1/sessions');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
  });
});

// ── Tests: DELETE sessions ───────────────────────────────────────
describe('DELETE /:appId/users/:userId/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('revokes all sessions and returns changes count', async () => {
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [],
      meta: { changes: 5 },
    });

    const response = await app.request('/test-app/users/user-1/sessions', {
      method: 'DELETE',
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe('All sessions revoked');
    expect(body.data.changes).toBe(5);
  });

  it('returns 0 changes when sessions table does not exist', async () => {
    mockExecuteD1Query.mockRejectedValueOnce(
      new Error('D1_ERROR: no such table: _auth_sessions')
    );

    const response = await app.request('/test-app/users/user-1/sessions', {
      method: 'DELETE',
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe('All sessions revoked');
    expect(body.data.changes).toBe(0);
  });

  it('returns 401 when authentication fails', async () => {
    mockAuthenticateAdmin.mockResolvedValue({
      unauthorized: true,
      status: 401,
      message: 'Unauthorized',
    });

    const response = await app.request('/test-app/users/user-1/sessions', {
      method: 'DELETE',
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
  });
});
