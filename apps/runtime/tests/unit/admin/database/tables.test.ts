import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mock functions (module-level) ────────────────────────────────
const mockAuthenticateAdmin = vi.fn();
const mockExecuteD1DDL = vi.fn();
const mockExecuteD1Query = vi.fn();

vi.mock('../../../../worker/src/lib/admin-auth', () => ({
  authenticateAdmin: (...args: unknown[]) => mockAuthenticateAdmin(...args),
  isAdminAuthError: (value: { unauthorized?: boolean } | null | undefined) =>
    value?.unauthorized === true,
}));

vi.mock('@exepad/deploy-utils', () => ({
  executeD1DDL: (...args: unknown[]) => mockExecuteD1DDL(...args),
  executeD1Query: (...args: unknown[]) => mockExecuteD1Query(...args),
}));

// ── Import Hono router (AFTER mocks) ────────────────────────────
import { Hono } from 'hono';
import { database } from '../../../../worker/src/routes/admin/database';

// Mount the sub-router under /:appId/database to match production layout
const app = new Hono();
app.route('/:appId/database', database);

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
describe('GET /tables — List user tables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('returns only user tables, filtering out system tables', async () => {
    // First call: list all tables from sqlite_master
    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [
        { name: '_auth_users' },
        { name: 'products' },
        { name: 'orders' },
        { name: 'sqlite_sequence' },
      ],
    });

    // Count calls for each user table
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ total: 10 }] }); // products
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ total: 5 }] }); // orders

    const response = await app.request('/test-app/database/tables');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data).toEqual([
      { name: 'products', rowCount: 10 },
      { name: 'orders', rowCount: 5 },
    ]);
  });

  it('returns row counts for each user table', async () => {
    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [{ name: 'items' }, { name: 'categories' }, { name: 'tags' }],
    });

    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ total: 42 }] });
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ total: 7 }] });
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ total: 100 }] });

    const response = await app.request('/test-app/database/tables');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([
      { name: 'items', rowCount: 42 },
      { name: 'categories', rowCount: 7 },
      { name: 'tags', rowCount: 100 },
    ]);
  });

  it('returns an empty array when no user tables exist', async () => {
    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [
        { name: '_auth_users' },
        { name: '_auth_sessions' },
        { name: 'sqlite_sequence' },
      ],
    });

    const response = await app.request('/test-app/database/tables');
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

    const response = await app.request('/test-app/database/tables');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
  });

  it('handles count query failures gracefully (rowCount defaults to 0)', async () => {
    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [{ name: 'broken_table' }],
    });

    // Count query throws
    mockExecuteD1DDL.mockRejectedValueOnce(new Error('D1 error'));

    const response = await app.request('/test-app/database/tables');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([{ name: 'broken_table', rowCount: 0 }]);
  });
});
