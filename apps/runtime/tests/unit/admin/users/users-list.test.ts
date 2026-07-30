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

// ── Tests: GET users ─────────────────────────────────────────────
describe('GET /:appId/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('returns paginated users list', async () => {
    const mockUsers = [
      {
        id: 'u1',
        email: 'alice@example.com',
        name: 'Alice',
        avatar_url: null,
        roles: 'admin',
        email_verified: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'u2',
        email: 'bob@example.com',
        name: 'Bob',
        avatar_url: null,
        roles: 'user',
        email_verified: 0,
        created_at: '2026-01-02T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
    ];

    // Count + Select run in parallel via Promise.all
    mockExecuteD1Query
      .mockResolvedValueOnce({ results: [{ total: 2 }] })
      .mockResolvedValueOnce({ results: mockUsers });

    const response = await app.request('/test-app/users?page=1&pageSize=10');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.pagination).toEqual({
      page: 1,
      pageSize: 10,
      total: 2,
      totalPages: 1,
    });
  });

  it('applies search filter on email and name', async () => {
    mockExecuteD1Query
      .mockResolvedValueOnce({ results: [{ total: 1 }] })
      .mockResolvedValueOnce({
        results: [
          {
            id: 'u1',
            email: 'alice@example.com',
            name: 'Alice',
            avatar_url: null,
            roles: 'admin',
            email_verified: 1,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      });

    const response = await app.request('/test-app/users?search=alice');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);

    // Verify the count query used LIKE params
    const countCall = mockExecuteD1Query.mock.calls[0];
    expect(countCall[2]).toContain('LIKE');
    expect(countCall[3]).toEqual(['%alice%', '%alice%']);
  });

  it('returns empty data when _auth_users table does not exist', async () => {
    mockExecuteD1Query.mockRejectedValueOnce(
      new Error('D1_ERROR: no such table: _auth_users')
    );

    const response = await app.request('/test-app/users');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });

  it('returns 401 when authentication fails', async () => {
    mockAuthenticateAdmin.mockResolvedValue({
      unauthorized: true,
      status: 401,
      message: 'Unauthorized',
    });

    const response = await app.request('/test-app/users');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
  });
});

// ── Tests: POST users ────────────────────────────────────────────
describe('POST /:appId/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('creates a user and returns 201', async () => {
    // Email uniqueness check — no existing user
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });
    // Insert user
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });
    // Insert account
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });

    const response = await app.request('/test-app/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'newuser@example.com',
        password: 'securepassword123',
        name: 'New User',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('newuser@example.com');
    expect(body.data.name).toBe('New User');
    expect(body.data.roles).toBe('user');
    expect(body.data.email_verified).toBe(0);
    // ID should be a UUID
    expect(body.data.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('rejects duplicate email with 409', async () => {
    // Email uniqueness check — existing user found
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [{ id: 'existing-id' }],
    });

    const response = await app.request('/test-app/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'existing@example.com',
        password: 'securepassword123',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain('already exists');
  });

  it('rejects invalid email with 400', async () => {
    const response = await app.request('/test-app/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'not-an-email',
        password: 'securepassword123',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid email');
  });

  it('rejects short password with 400', async () => {
    const response = await app.request('/test-app/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'user@example.com',
        password: 'short',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('at least 8 characters');
  });

  it('rejects missing email and password with 400', async () => {
    const response = await app.request('/test-app/users', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('email and password are required');
  });

  it('initializes auth tables when _auth_users does not exist', async () => {
    // Email uniqueness check throws "no such table"
    mockExecuteD1Query.mockRejectedValueOnce(
      new Error('D1_ERROR: no such table: _auth_users')
    );
    // ensureAuthTables DDL
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] });
    // Insert user
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });
    // Insert account
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });

    const response = await app.request('/test-app/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'first@example.com',
        password: 'securepassword123',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    // ensureAuthTables should have been called via executeD1DDL
    expect(mockExecuteD1DDL).toHaveBeenCalled();
  });
});
