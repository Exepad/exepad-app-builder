import { vi, describe, it, expect, beforeEach } from 'vitest';

/**
 * Read-only admin GET handlers must NOT provision an app database as a
 * write-on-read side effect. authenticateAdmin is called with
 * `{ createIfMissing: false }`; when the app has no DB yet it returns the
 * `dbMissing` sentinel and the handler renders an empty/404 result WITHOUT
 * touching the database (mirrors admin/database.ts). These tests assert both the
 * response shape AND that no D1 query is issued on the dbMissing path.
 */

const mockAuthenticateAdmin = vi.fn();
const mockExecuteD1Query = vi.fn();
const mockExecuteD1DDL = vi.fn();

vi.mock('../../../worker/src/lib/admin-auth', () => ({
  authenticateAdmin: (...args: unknown[]) => mockAuthenticateAdmin(...args),
  isAdminAuthError: (value: { unauthorized?: boolean } | null | undefined) =>
    value?.unauthorized === true,
}));

vi.mock('@exepad/deploy-utils', () => ({
  executeD1DDL: (...args: unknown[]) => mockExecuteD1DDL(...args),
  executeD1Query: (...args: unknown[]) => mockExecuteD1Query(...args),
  generateAuthDDL: () => ['CREATE TABLE IF NOT EXISTS _auth_users (id TEXT)'],
}));

// Keep the files router's app-backend dispatch chain out of the module graph —
// the dbMissing paths under test return before any dispatch happens.
vi.mock('../../../worker/src/routes/gateway/dispatch-local', () => ({
  dispatchRpcInProcess: vi.fn(),
  fetchAppBackendInProcess: vi.fn(),
}));

import { Hono } from 'hono';
import { users } from '../../../worker/src/routes/admin/users';
import { files } from '../../../worker/src/routes/admin/files';

const app = new Hono();
app.route('/:appId/users', users);
app.route('/:appId/files', files);

const DB_MISSING = { appId: 'test-app', config: {}, dbId: '', dbMissing: true } as const;

async function parse(res: Response): Promise<{ status: number; body: any }> {
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateAdmin.mockResolvedValue(DB_MISSING);
});

describe('read-only admin GETs opt out of DB provisioning', () => {
  it('passes createIfMissing:false to authenticateAdmin', async () => {
    await app.request('/test-app/users');
    const opts = mockAuthenticateAdmin.mock.calls[0]?.[4];
    expect(opts).toMatchObject({ createIfMissing: false });
  });

  it('GET users → empty list, no DB query', async () => {
    const { status, body } = await parse(await app.request('/test-app/users?page=2&pageSize=15'));
    expect(status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: [],
      pagination: { page: 2, pageSize: 15, total: 0, totalPages: 0 },
    });
    expect(mockExecuteD1Query).not.toHaveBeenCalled();
    expect(mockExecuteD1DDL).not.toHaveBeenCalled();
  });

  it('GET user detail → 404, no DB query', async () => {
    const { status, body } = await parse(await app.request('/test-app/users/u1'));
    expect(status).toBe(404);
    expect(body).toMatchObject({ success: false, error: 'User not found' });
    expect(mockExecuteD1Query).not.toHaveBeenCalled();
  });

  it('GET user sessions → empty, no DB query', async () => {
    const { status, body } = await parse(await app.request('/test-app/users/u1/sessions'));
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, data: [] });
    expect(mockExecuteD1Query).not.toHaveBeenCalled();
  });

  it('GET files → empty items, no DB query', async () => {
    const { status, body } = await parse(await app.request('/test-app/files?page=3&pageSize=10'));
    expect(status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: { items: [], total: 0, page: 3, limit: 10 },
    });
    expect(mockExecuteD1Query).not.toHaveBeenCalled();
  });

  it('GET file download → 404, no DB query', async () => {
    const { status, body } = await parse(await app.request('/test-app/files/f1/download'));
    expect(status).toBe(404);
    expect(body).toMatchObject({ success: false, error: 'File not found' });
    expect(mockExecuteD1Query).not.toHaveBeenCalled();
  });

  it('still serves a real DB when one exists (createIfMissing:false, dbMissing absent)', async () => {
    mockAuthenticateAdmin.mockResolvedValue({
      appId: 'test-app',
      config: { accountId: 'a', apiToken: 't', wfpNamespace: 'n', appId: 'test-app', appAlias: 'test-app' },
      dbId: 'db-1',
    });
    mockExecuteD1Query
      .mockResolvedValueOnce({ results: [{ total: 0 }] })
      .mockResolvedValueOnce({ results: [] });
    const { status, body } = await parse(await app.request('/test-app/users'));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockExecuteD1Query).toHaveBeenCalled();
  });
});
