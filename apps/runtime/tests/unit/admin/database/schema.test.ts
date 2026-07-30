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

// ── Tests ────────────────────────────────────────────────────────
describe('GET /tables/:tableName/schema — Table schema', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('returns columns and indexes for a valid table', async () => {
    // Table exists check
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [{ name: 'products' }],
    });

    // PRAGMA table_info
    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [
        { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
        { cid: 1, name: 'name', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
        { cid: 2, name: 'price', type: 'REAL', notnull: 0, dflt_value: '0.0', pk: 0 },
      ],
    });

    // PRAGMA index_list
    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [{ name: 'idx_products_name', unique: 0 }],
    });

    // PRAGMA index_info for the one index
    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [{ name: 'name' }],
    });

    const response = await app.request('/test-app/database/tables/products/schema');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('products');
    expect(body.data.columns).toHaveLength(3);
    expect(body.data.columns[0]).toEqual({
      cid: 0,
      name: 'id',
      type: 'INTEGER',
      notnull: true,
      dflt_value: null,
      pk: true,
    });
    expect(body.data.columns[1]).toEqual({
      cid: 1,
      name: 'name',
      type: 'TEXT',
      notnull: true,
      dflt_value: null,
      pk: false,
    });
    expect(body.data.columns[2]).toEqual({
      cid: 2,
      name: 'price',
      type: 'REAL',
      notnull: false,
      dflt_value: '0.0',
      pk: false,
    });
    expect(body.data.indexes).toHaveLength(1);
    expect(body.data.indexes[0]).toEqual({
      name: 'idx_products_name',
      unique: false,
      columns: ['name'],
    });
  });

  it('returns multiple indexes with correct columns', async () => {
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [{ name: 'orders' }],
    });

    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [
        { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
        { cid: 1, name: 'customer_email', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
        { cid: 2, name: 'status', type: 'TEXT', notnull: 0, dflt_value: "'pending'", pk: 0 },
      ],
    });

    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [
        { name: 'idx_orders_email', unique: 0 },
        { name: 'idx_orders_status_unique', unique: 1 },
      ],
    });

    // index_info for idx_orders_email
    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [{ name: 'customer_email' }],
    });

    // index_info for idx_orders_status_unique
    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [{ name: 'status' }],
    });

    const response = await app.request('/test-app/database/tables/orders/schema');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.data.indexes).toHaveLength(2);
    expect(body.data.indexes[1]).toEqual({
      name: 'idx_orders_status_unique',
      unique: true,
      columns: ['status'],
    });
  });

  it('rejects system tables with 403', async () => {
    const response = await app.request('/test-app/database/tables/_auth_users/schema');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toContain('system table');
  });

  it('rejects invalid table names with 400', async () => {
    const response = await app.request("/test-app/database/tables/'; DROP/schema");
    const { body, status } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid table name');
  });

  it('returns 404 when the table does not exist', async () => {
    mockExecuteD1Query.mockResolvedValueOnce({ results: [] });

    const response = await app.request('/test-app/database/tables/nonexistent/schema');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Table not found');
  });

  it('returns 401 when authentication fails', async () => {
    mockAuthenticateAdmin.mockResolvedValue({
      unauthorized: true,
      status: 401,
      message: 'Unauthorized',
    });

    const response = await app.request('/test-app/database/tables/products/schema');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
  });
});
