/**
 * Tests for RPC router functions:
 * parseRpcRequest, extractUserContext, checkAuth, routeRpcRequest, successResponse
 */

import { describe, it, expect } from 'vitest';
import { createMockD1 } from './helpers/mock-d1';
import {
  parseRpcRequest,
  extractUserContext,
  checkAuth,
  enforceSharedScopeReadGate,
  successResponse,
} from '../src/rpc/router';
import {
  InvalidRequestError,
  UnauthorizedError,
  ForbiddenError,
} from '../src/utils/errors';
import { TEST_USER, TEST_ADMIN, TEST_ANON } from './helpers/mock-env';
import type { ModelProps } from '../src/types/env';

describe('parseRpcRequest', () => {
  it('parses valid POST request', async () => {
    const req = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'sys_list', params: { limit: 10 }, model: 'tasks' }),
    });
    const rpc = await parseRpcRequest(req);
    expect(rpc.method).toBe('sys_list');
    expect(rpc.params).toEqual({ limit: 10 });
    expect(rpc.model).toBe('tasks');
  });

  it('throws for non-POST method', async () => {
    const req = new Request('http://localhost/rpc', { method: 'GET' });
    await expect(parseRpcRequest(req)).rejects.toThrow(InvalidRequestError);
  });

  it('throws for wrong content type', async () => {
    const req = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    });
    await expect(parseRpcRequest(req)).rejects.toThrow('Content-Type must be application/json');
  });

  it('throws for invalid JSON', async () => {
    const req = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    await expect(parseRpcRequest(req)).rejects.toThrow('Invalid JSON body');
  });

  it('throws for non-object body', async () => {
    const req = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify('string'),
    });
    await expect(parseRpcRequest(req)).rejects.toThrow('must be an object');
  });

  it('throws for missing method field', async () => {
    const req = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: {} }),
    });
    await expect(parseRpcRequest(req)).rejects.toThrow('Missing or invalid "method"');
  });

  it('allows missing params and model', async () => {
    const req = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'custom_handler' }),
    });
    const rpc = await parseRpcRequest(req);
    expect(rpc.method).toBe('custom_handler');
    expect(rpc.params).toBeUndefined();
    expect(rpc.model).toBeUndefined();
  });
});

describe('extractUserContext', () => {
  const db = createMockD1();

  it('extracts user from headers', async () => {
    const req = new Request('http://localhost/rpc', {
      headers: {
        'X-User-Id': 'user-123',
        'X-User-Email': 'test@example.com',
        'X-User-Roles': 'admin,editor',
      },
    });
    const ctx = await extractUserContext(req, db);
    expect(ctx.id).toBe('user-123');
    expect(ctx.email).toBe('test@example.com');
    expect(ctx.roles).toEqual(['admin', 'editor']);
    expect(ctx.isAuthenticated).toBe(true);
  });

  it('returns unauthenticated user when no X-User-Id', async () => {
    const req = new Request('http://localhost/rpc');
    const ctx = await extractUserContext(req, db);
    expect(ctx.id).toBe('');
    expect(ctx.isAuthenticated).toBe(false);
    expect(ctx.roles).toEqual([]);
  });

  it('handles missing email and roles', async () => {
    const req = new Request('http://localhost/rpc', {
      headers: { 'X-User-Id': 'user-1' },
    });
    const ctx = await extractUserContext(req, db);
    expect(ctx.email).toBe('');
    expect(ctx.roles).toEqual([]);
    expect(ctx.isAuthenticated).toBe(true);
  });
});

describe('checkAuth', () => {
  it('allows public reads for anyone', () => {
    expect(() => checkAuth('public', TEST_ANON, 'read')).not.toThrow();
    expect(() => checkAuth('public', TEST_USER, 'read')).not.toThrow();
  });

  it('requires auth for write ops even if policy is public (H8)', () => {
    expect(() => checkAuth('public', TEST_ANON, 'create')).toThrow(UnauthorizedError);
    expect(() => checkAuth('public', TEST_ANON, 'update')).toThrow(UnauthorizedError);
    expect(() => checkAuth('public', TEST_ANON, 'delete')).toThrow(UnauthorizedError);
  });

  it('allows authenticated write ops with public policy', () => {
    expect(() => checkAuth('public', TEST_USER, 'create')).not.toThrow();
    expect(() => checkAuth('public', TEST_USER, 'update')).not.toThrow();
  });

  it('blocks unauthenticated users for authenticated level', () => {
    expect(() => checkAuth('authenticated', TEST_ANON, 'read')).toThrow(UnauthorizedError);
  });

  it('allows authenticated users for authenticated level', () => {
    expect(() => checkAuth('authenticated', TEST_USER, 'read')).not.toThrow();
  });

  it('blocks non-admin for admin level', () => {
    expect(() => checkAuth('admin', TEST_USER, 'read')).toThrow(ForbiddenError);
  });

  it('allows admin users for admin level', () => {
    expect(() => checkAuth('admin', TEST_ADMIN, 'read')).not.toThrow();
  });

  it('defaults to authenticated when level is undefined', () => {
    expect(() => checkAuth(undefined, TEST_ANON, 'read')).toThrow(UnauthorizedError);
    expect(() => checkAuth(undefined, TEST_USER, 'read')).not.toThrow();
  });
});

describe('successResponse', () => {
  it('returns 200 JSON response', async () => {
    const res = successResponse({ items: [1, 2, 3] });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');

    const body = await res.json() as { success: boolean; data: { items: number[] } };
    expect(body.success).toBe(true);
    expect(body.data.items).toEqual([1, 2, 3]);
  });

  it('includes pagination when provided', async () => {
    const res = successResponse([], { total: 100, limit: 10, offset: 0, hasMore: true });

    const body = await res.json() as { pagination: { total: number; hasMore: boolean } };
    expect(body.pagination.total).toBe(100);
    expect(body.pagination.hasMore).toBe(true);
  });

  it('omits pagination when not provided', async () => {
    const res = successResponse('ok');
    const body = await res.json() as { pagination?: unknown };
    expect(body.pagination).toBeUndefined();
  });
});

// Shared-scope read gate — the standalone /rpc path (router) and multi-query
// both call this exact helper, so it's the single source of truth for "you
// can't list/aggregate columns you can't read on a shared model".
describe('enforceSharedScopeReadGate', () => {
  const sharedStrict = (): ModelProps => ({
    uuid: 'm', name: 'm', ownerScope: 'shared',
    columns: [{ name: 'id', type: 'integer', isPrimary: true }],
    crudPolicy: { read: 'role:admin', list: 'authenticated' },
  });
  const ownerStrict = (): ModelProps => ({
    uuid: 'm', name: 'm', ownerScope: 'user',
    columns: [{ name: 'id', type: 'integer', isPrimary: true }],
    crudPolicy: { read: 'role:admin', list: 'authenticated' },
  });

  it('blocks non-admin sys_list / sys_aggregate on a shared model with stricter read', () => {
    expect(() => enforceSharedScopeReadGate(sharedStrict(), 'sys_list', TEST_USER, false)).toThrow(
      ForbiddenError,
    );
    expect(() =>
      enforceSharedScopeReadGate(sharedStrict(), 'sys_aggregate', TEST_USER, false),
    ).toThrow(ForbiddenError);
  });

  it('allows an admin', () => {
    expect(() =>
      enforceSharedScopeReadGate(sharedStrict(), 'sys_list', TEST_ADMIN, false),
    ).not.toThrow();
  });

  it('is a no-op for sys_read (already read-gated upstream) and for writes', () => {
    expect(() => enforceSharedScopeReadGate(sharedStrict(), 'sys_read', TEST_USER, false)).not.toThrow();
    expect(() => enforceSharedScopeReadGate(sharedStrict(), 'sys_create', TEST_USER, false)).not.toThrow();
  });

  it('is a no-op for OWNER-scoped models (owner filter protects them)', () => {
    expect(() => enforceSharedScopeReadGate(ownerStrict(), 'sys_list', TEST_USER, false)).not.toThrow();
  });

  it('is a no-op when read is unset or auth is disabled', () => {
    const noRead: ModelProps = {
      uuid: 'm', name: 'm', ownerScope: 'shared',
      columns: [{ name: 'id', type: 'integer', isPrimary: true }],
      crudPolicy: { list: 'authenticated' },
    };
    expect(() => enforceSharedScopeReadGate(noRead, 'sys_list', TEST_ANON, false)).not.toThrow();
    // auth disabled (kill-switch) → never gates
    expect(() => enforceSharedScopeReadGate(sharedStrict(), 'sys_list', TEST_ANON, true)).not.toThrow();
  });
});
