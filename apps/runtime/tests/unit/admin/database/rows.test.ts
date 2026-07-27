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

const PRODUCTS_COLUMNS = [
  { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
  { cid: 1, name: 'name', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
  { cid: 2, name: 'price', type: 'REAL', notnull: 0, dflt_value: null, pk: 0 },
];

/** Mock validateTable to pass: table exists in sqlite_master. */
function mockTableExists() {
  mockExecuteD1Query.mockResolvedValueOnce({ results: [{ name: 'products' }] });
}

/** Mock getColumns via executeD1DDL (PRAGMA table_info). */
function mockColumns(columns = PRODUCTS_COLUMNS) {
  mockExecuteD1DDL.mockResolvedValueOnce({ results: columns });
}

// ── Tests: GET rows ──────────────────────────────────────────────
describe('GET /tables/:tableName/rows — List rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('returns paginated rows with columns', async () => {
    mockTableExists();
    mockColumns();

    // Count query
    mockExecuteD1Query.mockResolvedValueOnce({ results: [{ total: 2 }] });

    // Select query
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [
        { id: 1, name: 'Widget', price: 9.99 },
        { id: 2, name: 'Gadget', price: 19.99 },
      ],
    });

    const response = await app.request(
      '/test-app/database/tables/products/rows?page=1&pageSize=10'
    );
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
    expect(body.columns).toHaveLength(3);
  });

  it('applies search filter on TEXT columns', async () => {
    mockTableExists();
    mockColumns();

    // Count with search
    mockExecuteD1Query.mockResolvedValueOnce({ results: [{ total: 1 }] });

    // Select with search
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [{ id: 1, name: 'Widget', price: 9.99 }],
    });

    const response = await app.request(
      '/test-app/database/tables/products/rows?search=widget'
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);

    // Verify the count query was called with LIKE params (second executeD1Query call after table exists)
    const countCall = mockExecuteD1Query.mock.calls[1];
    expect(countCall[2]).toContain('LIKE');
  });

  it('defaults to page=1 and pageSize=20', async () => {
    mockTableExists();
    mockColumns();

    mockExecuteD1Query.mockResolvedValueOnce({ results: [{ total: 0 }] });
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });

    const response = await app.request(
      '/test-app/database/tables/products/rows'
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.pageSize).toBe(20);
  });

  it('caps pageSize at 100', async () => {
    mockTableExists();
    mockColumns();

    mockExecuteD1Query.mockResolvedValueOnce({ results: [{ total: 0 }] });
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });

    const response = await app.request(
      '/test-app/database/tables/products/rows?pageSize=500'
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.pagination.pageSize).toBe(100);
  });

  it('returns 401 when authentication fails', async () => {
    mockAuthenticateAdmin.mockResolvedValue({
      unauthorized: true,
      status: 401,
      message: 'Unauthorized',
    });

    const response = await app.request(
      '/test-app/database/tables/products/rows'
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects system tables with 403', async () => {
    const response = await app.request(
      '/test-app/database/tables/_auth_users/rows'
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toContain('system table');
  });
});

// ── Tests: POST rows ─────────────────────────────────────────────
describe('POST /tables/:tableName/rows — Insert row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('inserts a row and returns changes count', async () => {
    mockTableExists();
    mockColumns();

    // Insert query
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [],
      meta: { changes: 1 },
    });

    const response = await app.request(
      '/test-app/database/tables/products/rows',
      {
        method: 'POST',
        body: JSON.stringify({ data: { name: 'New Product', price: 29.99 } }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe('Row inserted');
    expect(body.data.changes).toBe(1);
  });

  it('rejects unknown columns with 400', async () => {
    mockTableExists();
    mockColumns();

    const response = await app.request(
      '/test-app/database/tables/products/rows',
      {
        method: 'POST',
        body: JSON.stringify({ data: { name: 'Product', bogus_col: 'xyz' } }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Unknown column');
  });

  it('rejects empty data with 400', async () => {
    mockTableExists();
    mockColumns();

    const response = await app.request(
      '/test-app/database/tables/products/rows',
      {
        method: 'POST',
        body: JSON.stringify({ data: {} }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('non-empty "data" object');
  });

  it('rejects system tables with 403', async () => {
    const response = await app.request(
      '/test-app/database/tables/_auth_users/rows',
      {
        method: 'POST',
        body: JSON.stringify({ data: { email: 'test@test.com' } }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toContain('system table');
  });
});
