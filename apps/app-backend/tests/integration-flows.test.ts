/**
 * Multi-step integration flow tests
 *
 * Tests end-to-end CRUD workflows through the full worker pipeline,
 * verifying that operations compose correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';
import { createMockD1 } from './helpers/mock-d1';
import {
  createMockEnv,
  createMockConfig,
  TEST_MODEL,
  TEST_MODEL_SHARED,
  TEST_MODEL_SOFT_DELETE,
} from './helpers/mock-env';
import { createMockUserHeaders } from './helpers/mock-request';
import type { Env } from '../src/types/env';

/**
 * Create an RPC POST request with explicit Content-Length.
 */
function rpcRequest(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  model?: string
): Request {
  const bodyObj: Record<string, unknown> = { method, params };
  if (model) bodyObj.model = model;
  const bodyStr = JSON.stringify(bodyObj);
  return new Request('http://localhost/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(bodyStr, 'utf-8')),
      ...headers,
    },
    body: bodyStr,
  });
}

// ── Create → Read roundtrip ────────────────────────────────────────

describe('Create → Read roundtrip', () => {
  it('created record can be read back with matching data', async () => {
    const record = {
      id: 1,
      name: 'Alice',
      email: 'alice@test.com',
      owner_id: 'user-123',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const results = new Map<string, Record<string, unknown>[]>();
    results.set('PRAGMA', []);
    results.set('INSERT INTO', [record]);
    results.set('SELECT', [record]);

    const env = createMockEnv({
      DB: createMockD1({ results }),
      configProps: createMockConfig([TEST_MODEL]),
    });

    const headers = createMockUserHeaders();

    // Create
    const createRes = await worker.fetch(
      rpcRequest('sys_create', { data: { name: 'Alice', email: 'alice@test.com' } }, headers, 'contacts'),
      env
    );
    expect(createRes.status).toBe(200);
    const createBody = await createRes.json() as Record<string, unknown>;
    expect(createBody.success).toBe(true);

    // Read
    const readRes = await worker.fetch(
      rpcRequest('sys_read', { id: 1 }, headers, 'contacts'),
      env
    );
    expect(readRes.status).toBe(200);
    const readBody = await readRes.json() as Record<string, unknown>;
    expect(readBody.success).toBe(true);
    expect((readBody.data as Record<string, unknown>).name).toBe('Alice');
  });
});

// ── Create → List roundtrip ────────────────────────────────────────

describe('Create → List roundtrip', () => {
  it('created record appears in list results', async () => {
    const records = [
      { id: 1, name: 'Alice', email: 'alice@test.com', owner_id: 'user-123' },
      { id: 2, name: 'Bob', email: 'bob@test.com', owner_id: 'user-123' },
    ];

    const results = new Map<string, Record<string, unknown>[]>();
    results.set('PRAGMA', []);
    results.set('INSERT INTO', [records[1]]);
    results.set('SELECT', records);
    results.set('COUNT', [{ count: 2 }]);

    const env = createMockEnv({
      DB: createMockD1({ results }),
      configProps: createMockConfig([TEST_MODEL]),
    });

    const headers = createMockUserHeaders();

    // Create
    const createRes = await worker.fetch(
      rpcRequest('sys_create', { data: { name: 'Bob', email: 'bob@test.com' } }, headers, 'contacts'),
      env
    );
    expect(createRes.status).toBe(200);

    // List
    const listRes = await worker.fetch(
      rpcRequest('sys_list', {}, headers, 'contacts'),
      env
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as Record<string, unknown>;
    expect(listBody.success).toBe(true);
    expect(Array.isArray(listBody.data)).toBe(true);
    expect((listBody.data as unknown[]).length).toBe(2);
  });
});

// ── Two users see only own records ─────────────────────────────────

describe('Owner isolation across users', () => {
  it('each user only sees their own records in user-scoped model', async () => {
    // User A's records
    const userARecords = [
      { id: 1, name: 'A1', email: 'a1@test.com', owner_id: 'user-A' },
    ];

    const resultsA = new Map<string, Record<string, unknown>[]>();
    resultsA.set('PRAGMA', []);
    resultsA.set('SELECT', userARecords);
    resultsA.set('COUNT', [{ count: 1 }]);

    const envA = createMockEnv({
      DB: createMockD1({ results: resultsA }),
      configProps: createMockConfig([TEST_MODEL]),
    });

    // User B's records (empty — they have no records)
    const resultsB = new Map<string, Record<string, unknown>[]>();
    resultsB.set('PRAGMA', []);
    resultsB.set('SELECT', []);
    resultsB.set('COUNT', [{ count: 0 }]);

    const envB = createMockEnv({
      DB: createMockD1({ results: resultsB }),
      configProps: createMockConfig([TEST_MODEL]),
    });

    // User A lists
    const resA = await worker.fetch(
      rpcRequest('sys_list', {}, createMockUserHeaders('user-A', 'a@test.com'), 'contacts'),
      envA
    );
    const bodyA = await resA.json() as Record<string, unknown>;
    expect((bodyA.data as unknown[]).length).toBe(1);

    // User B lists
    const resB = await worker.fetch(
      rpcRequest('sys_list', {}, createMockUserHeaders('user-B', 'b@test.com'), 'contacts'),
      envB
    );
    const bodyB = await resB.json() as Record<string, unknown>;
    expect((bodyB.data as unknown[]).length).toBe(0);
  });
});

// ── Shared model: cross-user read ──────────────────────────────────

describe('Shared model access', () => {
  it('user-B can read user-A\'s record in shared-scope model', async () => {
    const sharedRecord = {
      id: 1,
      name: 'Public Post',
      email: 'public@test.com',
      owner_id: 'user-A',
    };

    const results = new Map<string, Record<string, unknown>[]>();
    results.set('PRAGMA', []);
    results.set('SELECT', [sharedRecord]);

    const env = createMockEnv({
      DB: createMockD1({ results }),
      configProps: createMockConfig([TEST_MODEL_SHARED]),
    });

    // User B reads user A's record
    const res = await worker.fetch(
      rpcRequest('sys_read', { id: 1 }, createMockUserHeaders('user-B', 'b@test.com'), 'announcements'),
      env
    );

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect((body.data as Record<string, unknown>).owner_id).toBe('user-A');
  });
});

// ── Unauthenticated access blocked for writes ──────────────────────

describe('Unauthenticated write protection', () => {
  it('anon cannot create records', async () => {
    const results = new Map<string, Record<string, unknown>[]>();
    results.set('PRAGMA', []);

    const env = createMockEnv({
      DB: createMockD1({ results }),
      configProps: createMockConfig([TEST_MODEL]),
    });

    const res = await worker.fetch(
      rpcRequest('sys_create', { data: { name: 'Evil', email: 'e@v.com' } }, {}, 'contacts'),
      env
    );

    expect(res.status).toBe(401);
  });

  it('anon cannot delete records', async () => {
    const results = new Map<string, Record<string, unknown>[]>();
    results.set('PRAGMA', []);

    const env = createMockEnv({
      DB: createMockD1({ results }),
      configProps: createMockConfig([TEST_MODEL]),
    });

    const res = await worker.fetch(
      rpcRequest('sys_delete', { id: 1 }, {}, 'contacts'),
      env
    );

    expect(res.status).toBe(401);
  });
});
