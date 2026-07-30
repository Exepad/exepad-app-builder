/**
 * SQL builder functions are now inlined in the database route handler
 * (`worker/src/routes/admin/database.ts`). They are not exported, so we test
 * them through the Hono route by exercising the database endpoints which call
 * isValidIdentifier, isSystemTable, escapeIdentifier, and the SQL builders
 * internally.
 *
 * This file tests observable behaviour — table validation, system table
 * rejection, SQL injection prevention — via the database routes.
 */

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
}));

// ── Import the Hono router (AFTER mocks) ─────────────────────────
import { Hono } from 'hono';
import { database } from '../../../../worker/src/routes/admin/database';

// Mount under /:appId/database to match production routing
const app = new Hono();
app.route('/:appId/database', database);

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

// ── Tests: isValidIdentifier (via table name validation) ─────────
describe('isValidIdentifier (via database routes)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('accepts valid identifiers', async () => {
    // Table exists in sqlite_master
    mockExecuteD1Query.mockResolvedValue({
      results: [{ name: 'foo' }],
    });
    // PRAGMA table_info
    mockExecuteD1DDL.mockResolvedValue({
      results: [{ cid: 0, name: 'id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 }],
    });

    const response = await app.request('/test-app/database/tables/foo/schema');
    const { status } = await parseResponse(response);
    expect(status).toBe(200);
  });

  it('rejects identifier starting with a digit', async () => {
    const response = await app.request('/test-app/database/tables/1abc/schema');
    const { body, status } = await parseResponse(response);
    expect(status).toBe(400);
    expect(body.error).toContain('Invalid table name');
  });

  it('rejects identifier with special characters (SQL injection attempt)', async () => {
    // URL-encoded semicolons, spaces, etc. in the table name
    const response = await app.request('/test-app/database/tables/DROP%20TABLE/schema');
    const { body, status } = await parseResponse(response);
    expect(status).toBe(400);
    expect(body.error).toContain('Invalid table name');
  });
});

// ── Tests: isSystemTable (via table access control) ──────────────
describe('isSystemTable (via database routes)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('rejects _auth_ prefixed tables', async () => {
    const response = await app.request('/test-app/database/tables/_auth_users/schema');
    const { body, status } = await parseResponse(response);
    expect(status).toBe(403);
    expect(body.error).toContain('system table');
  });

  it('rejects _deploy_ prefixed tables', async () => {
    const response = await app.request('/test-app/database/tables/_deploy_metadata/schema');
    const { body, status } = await parseResponse(response);
    expect(status).toBe(403);
    expect(body.error).toContain('system table');
  });

  it('allows user tables', async () => {
    // Table exists in sqlite_master
    mockExecuteD1Query.mockResolvedValue({
      results: [{ name: 'products' }],
    });
    // PRAGMA table_info
    mockExecuteD1DDL.mockResolvedValue({
      results: [{ cid: 0, name: 'id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 }],
    });

    const response = await app.request('/test-app/database/tables/products/schema');
    const { status } = await parseResponse(response);
    expect(status).toBe(200);
  });
});

// ── Tests: table listing filters system tables ───────────────────
describe('GET /tables (system table filtering)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('filters system tables from listing', async () => {
    // sqlite_master returns mix of user and system tables
    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [
        { name: '_auth_users' },
        { name: '_auth_sessions' },
        { name: 'products' },
        { name: 'orders' },
        { name: '_deploy_lock' },
        { name: 'sqlite_master' },
      ],
    });

    // Row count queries for user tables (products, orders)
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ total: 10 }] });
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ total: 5 }] });

    const response = await app.request('/test-app/database/tables');
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].name).toBe('products');
    expect(body.data[1].name).toBe('orders');
  });
});

// ── Tests: insert validates columns ──────────────────────────────
describe('POST /tables/:tableName/rows (column validation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue(AUTH_CONTEXT);
  });

  it('rejects unknown columns on insert', async () => {
    // Table exists
    mockExecuteD1Query.mockResolvedValueOnce({ results: [{ name: 'products' }] });
    // PRAGMA table_info
    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [
        { cid: 0, name: 'id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 },
        { cid: 1, name: 'name', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      ],
    });

    const response = await app.request('/test-app/database/tables/products/rows', {
      method: 'POST',
      body: JSON.stringify({ data: { name: 'Widget', unknown: 'value' } }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.error).toContain('Unknown column');
  });

  it('inserts valid data successfully', async () => {
    // Table exists
    mockExecuteD1Query.mockResolvedValueOnce({ results: [{ name: 'products' }] });
    // PRAGMA table_info
    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [
        { cid: 0, name: 'id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 },
        { cid: 1, name: 'name', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { cid: 2, name: 'price', type: 'REAL', notnull: 0, dflt_value: null, pk: 0 },
      ],
    });
    // INSERT result
    mockExecuteD1Query.mockResolvedValueOnce({ results: [], meta: { changes: 1 } });

    const response = await app.request('/test-app/database/tables/products/rows', {
      method: 'POST',
      body: JSON.stringify({ data: { name: 'Widget', price: 9.99 } }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { body, status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe('Row inserted');
  });
});
