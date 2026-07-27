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

function mockTableExists() {
  mockExecuteD1Query.mockResolvedValueOnce({ results: [{ name: 'products' }] });
}

function mockColumns(columns = PRODUCTS_COLUMNS) {
  mockExecuteD1DDL.mockResolvedValueOnce({ results: columns });
}

// ── Tests: PUT row ───────────────────────────────────────────────
describe('PUT /tables/:tableName/rows/:rowId — Update row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('updates a row and returns changes count', async () => {
    mockTableExists();
    mockColumns();

    // Update query returns 1 change
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [],
      meta: { changes: 1 },
    });

    const response = await app.request(
      '/test-app/database/tables/products/rows/42',
      {
        method: 'PUT',
        body: JSON.stringify({ data: { name: 'Updated Widget', price: 14.99 } }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe('Row updated');
    expect(body.data.changes).toBe(1);
  });

  it('returns 404 when no rows are affected', async () => {
    mockTableExists();
    mockColumns();

    // Update query returns 0 changes
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [],
      meta: { changes: 0 },
    });

    const response = await app.request(
      '/test-app/database/tables/products/rows/999',
      {
        method: 'PUT',
        body: JSON.stringify({ data: { name: 'Ghost' } }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Row not found');
  });

  it('rejects unknown columns with 400', async () => {
    mockTableExists();
    mockColumns();

    const response = await app.request(
      '/test-app/database/tables/products/rows/1',
      {
        method: 'PUT',
        body: JSON.stringify({ data: { nonexistent: 'value' } }),
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
    // Note: mockColumns() not needed — route returns before getColumns is called

    const response = await app.request(
      '/test-app/database/tables/products/rows/1',
      {
        method: 'PUT',
        body: JSON.stringify({ data: {} }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('non-empty "data" object');
  });

  it('returns 400 when table has no primary key', async () => {
    mockTableExists();
    // Columns with no pk
    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [
        { cid: 0, name: 'col_a', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { cid: 1, name: 'col_b', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      ],
    });

    const response = await app.request(
      '/test-app/database/tables/products/rows/1',
      {
        method: 'PUT',
        body: JSON.stringify({ data: { col_a: 'x' } }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('no primary key');
  });

  it('rejects system tables with 403', async () => {
    const response = await app.request(
      '/test-app/database/tables/_auth_users/rows/1',
      {
        method: 'PUT',
        body: JSON.stringify({ data: { email: 'x@y.com' } }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toContain('system table');
  });
});

// ── Tests: DELETE row ────────────────────────────────────────────
describe('DELETE /tables/:tableName/rows/:rowId — Delete row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('deletes a row and returns changes count', async () => {
    mockTableExists();
    mockColumns();

    // Delete query returns 1 change
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [],
      meta: { changes: 1 },
    });

    const response = await app.request(
      '/test-app/database/tables/products/rows/42',
      { method: 'DELETE' }
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe('Row deleted');
    expect(body.data.changes).toBe(1);
  });

  it('returns 404 when no rows are affected', async () => {
    mockTableExists();
    mockColumns();

    // Delete query returns 0 changes
    mockExecuteD1Query.mockResolvedValueOnce({
      results: [],
      meta: { changes: 0 },
    });

    const response = await app.request(
      '/test-app/database/tables/products/rows/999',
      { method: 'DELETE' }
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Row not found');
  });

  it('returns 400 when table has no primary key', async () => {
    mockTableExists();
    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [
        { cid: 0, name: 'col_a', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      ],
    });

    const response = await app.request(
      '/test-app/database/tables/products/rows/1',
      { method: 'DELETE' }
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('no primary key');
  });

  it('rejects system tables with 403', async () => {
    const response = await app.request(
      '/test-app/database/tables/_auth_users/rows/1',
      { method: 'DELETE' }
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toContain('system table');
  });

  it('returns 401 when authentication fails', async () => {
    mockAuthenticateAdmin.mockResolvedValue({
      unauthorized: true,
      status: 401,
      message: 'Unauthorized',
    });

    const response = await app.request(
      '/test-app/database/tables/products/rows/1',
      { method: 'DELETE' }
    );
    const { body, status } = await parseResponse(response);

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
  });
});
