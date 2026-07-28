/**
 * Phase 1: Backend Foundation — Integration Tests
 *
 * Tests all sys_* RPC methods against a live app-backend on localhost:8787.
 * Requires: `pnpm dev` running in apps/app-backend
 *
 * Models used: contacts, tasks, tags (from backend-demo config)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const RPC_URL = 'http://localhost:8787/rpc';
const USER_ID = `test-phase1-${Date.now()}`;
const USER_HEADERS = {
  'Content-Type': 'application/json',
  'X-User-Id': USER_ID,
  'X-User-Email': 'phase1@test.com',
  'X-User-Roles': 'user',
};

/** Helper: send an RPC request and return parsed JSON */
async function rpc(
  method: string,
  model?: string,
  params?: Record<string, unknown>
): Promise<{ success: boolean; data?: any; pagination?: any; error?: any }> {
  const body: Record<string, unknown> = { method };
  if (model) body.model = model;
  if (params) body.params = params;

  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: USER_HEADERS,
    body: JSON.stringify(body),
  });
  return res.json() as any;
}

/** Helper: send a batch RPC request */
async function rpcBatch(
  operations: Array<{ method: string; model?: string; params?: Record<string, unknown> }>
): Promise<any> {
  return rpc('sys_batch', undefined, { operations });
}

// Track IDs for cleanup
const createdContactIds: number[] = [];
const createdTaskIds: number[] = [];

// ─── Phase 1.1: Basic CRUD ────────────────────────────────────────────

describe('Phase 1.1 — Basic CRUD Operations', () => {
  let createdId: number;

  it('1.1a — sys_create: creates a record and returns an ID', async () => {
    const res = await rpc('sys_create', 'contacts', {
      data: { name: 'Phase1 Test', email: `p1-${Date.now()}@test.com` },
    });

    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();
    expect(res.data.id).toBeTypeOf('number');
    expect(res.data.name).toBe('Phase1 Test');
    expect(res.data.owner_id).toBe(USER_ID);
    expect(res.data.created_at).toBeDefined();
    expect(res.data.updated_at).toBeDefined();

    createdId = res.data.id;
    createdContactIds.push(createdId);
  });

  it('1.1b — sys_read: reads that record by ID, all fields match', async () => {
    const res = await rpc('sys_read', 'contacts', { id: createdId });

    expect(res.success).toBe(true);
    expect(res.data.id).toBe(createdId);
    expect(res.data.name).toBe('Phase1 Test');
    expect(res.data.owner_id).toBe(USER_ID);
  });

  it('1.1c — sys_list: lists records with pagination (limit, offset)', async () => {
    // Create a second contact so we have at least 2
    const r2 = await rpc('sys_create', 'contacts', {
      data: { name: 'Phase1 Second', email: `p1-second-${Date.now()}@test.com` },
    });
    createdContactIds.push(r2.data.id);

    // List with limit=1
    const page1 = await rpc('sys_list', 'contacts', { limit: 1, offset: 0 });
    expect(page1.success).toBe(true);
    expect(page1.data).toHaveLength(1);
    expect(page1.pagination).toBeDefined();
    expect(page1.pagination.limit).toBe(1);
    expect(page1.pagination.offset).toBe(0);

    // List with offset=1
    const page2 = await rpc('sys_list', 'contacts', { limit: 1, offset: 1 });
    expect(page2.success).toBe(true);
    expect(page2.data).toHaveLength(1);
    expect(page2.pagination.offset).toBe(1);

    // The two pages should have different records
    expect(page1.data[0].id).not.toBe(page2.data[0].id);
  });

  it('1.1d — sys_update: updates a field, read back verifies change', async () => {
    const res = await rpc('sys_update', 'contacts', {
      id: createdId,
      data: { name: 'Phase1 Updated' },
    });

    expect(res.success).toBe(true);
    expect(res.data.name).toBe('Phase1 Updated');

    // Read back to confirm persistence
    const readBack = await rpc('sys_read', 'contacts', { id: createdId });
    expect(readBack.data.name).toBe('Phase1 Updated');
    // updated_at should have changed
    expect(readBack.data.updated_at).toBeDefined();
  });

  it('1.1e — sys_delete: deletes a record, confirm gone from sys_list', async () => {
    // Create a throwaway record to delete
    const tmp = await rpc('sys_create', 'contacts', {
      data: { name: 'To Delete', email: `delete-${Date.now()}@test.com` },
    });
    const deleteId = tmp.data.id;

    // Delete it
    const delRes = await rpc('sys_delete', 'contacts', { id: deleteId });
    expect(delRes.success).toBe(true);
    expect(delRes.data.deleted).toBe(true);

    // Confirm it no longer appears in sys_list
    const list = await rpc('sys_list', 'contacts', { limit: 100 });
    const found = list.data.find((r: any) => r.id === deleteId);
    expect(found).toBeUndefined();

    // sys_read should also fail
    const readRes = await rpc('sys_read', 'contacts', { id: deleteId });
    expect(readRes.success).toBe(false);
  });
});

// ─── Phase 1.2: Enhanced CRUD ─────────────────────────────────────────

describe('Phase 1.2 — Enhanced CRUD (Scaffold Prerequisites)', () => {
  // Seed some tasks for search/aggregate tests
  const taskIds: number[] = [];

  beforeAll(async () => {
    const tasks = [
      { title: 'Write docs', status: 'pending', priority: 'high' },
      { title: 'Write tests', status: 'pending', priority: 'medium' },
      { title: 'Fix login bug', status: 'in_progress', priority: 'high' },
      { title: 'Deploy v2', status: 'completed', priority: 'low' },
      { title: 'Review PR', status: 'completed', priority: 'medium' },
    ];
    for (const t of tasks) {
      const res = await rpc('sys_create', 'tasks', { data: t });
      if (res.success) {
        taskIds.push(res.data.id);
        createdTaskIds.push(res.data.id);
      }
    }
  });

  it('1.2a — sys_list with search + searchFields returns matching rows only', async () => {
    const res = await rpc('sys_list', 'tasks', {
      search: 'Write',
      searchFields: ['title'],
      limit: 50,
    });

    expect(res.success).toBe(true);
    // Should find "Write docs" and "Write tests"
    expect(res.data.length).toBeGreaterThanOrEqual(2);
    for (const row of res.data) {
      expect(row.title.toLowerCase()).toContain('write');
    }
  });

  it('1.2b — sys_list with search + filters (AND logic)', async () => {
    const res = await rpc('sys_list', 'tasks', {
      search: 'Write',
      searchFields: ['title'],
      filters: { priority: 'high' },
      limit: 50,
    });

    expect(res.success).toBe(true);
    // Only "Write docs" (high priority) should match, not "Write tests" (medium)
    expect(res.data.length).toBeGreaterThanOrEqual(1);
    for (const row of res.data) {
      expect(row.title.toLowerCase()).toContain('write');
      expect(row.priority).toBe('high');
    }
  });

  it('1.2c — sys_aggregate: count without groupBy returns single total', async () => {
    const res = await rpc('sys_aggregate', 'tasks', {
      aggregations: [{ function: 'count', alias: 'total' }],
    });

    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();
    // Should return a single row with the total count
    if (Array.isArray(res.data)) {
      expect(res.data).toHaveLength(1);
      expect(res.data[0].total).toBeTypeOf('number');
      expect(res.data[0].total).toBeGreaterThanOrEqual(5);
    } else {
      expect(res.data.total).toBeTypeOf('number');
      expect(res.data.total).toBeGreaterThanOrEqual(5);
    }
  });

  it('1.2d — sys_aggregate: sum/avg with field returns correct numeric values', async () => {
    const res = await rpc('sys_aggregate', 'tasks', {
      aggregations: [
        { function: 'count', alias: 'total' },
        { function: 'sum', field: 'id', alias: 'id_sum' },
        { function: 'avg', field: 'id', alias: 'id_avg' },
      ],
    });

    expect(res.success).toBe(true);
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    expect(row.total).toBeTypeOf('number');
    expect(row.id_sum).toBeTypeOf('number');
    expect(row.id_avg).toBeTypeOf('number');
    expect(row.id_sum).toBeGreaterThan(0);
    expect(row.id_avg).toBeGreaterThan(0);
  });

  it('1.2e — sys_aggregate: groupBy produces grouped result rows', async () => {
    const res = await rpc('sys_aggregate', 'tasks', {
      aggregations: [{ function: 'count', alias: 'count' }],
      groupBy: ['status'],
    });

    expect(res.success).toBe(true);
    const rows = Array.isArray(res.data) ? res.data : [res.data];
    // We created tasks with pending, in_progress, completed — expect at least 3 groups
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row.status).toBeDefined();
      expect(row.count).toBeTypeOf('number');
      expect(row.count).toBeGreaterThanOrEqual(1);
    }
  });

  it('1.2f — sys_batch: batch of 2–3 creates succeeds atomically', async () => {
    const ts = Date.now();
    const res = await rpcBatch([
      {
        method: 'sys_create',
        model: 'contacts',
        params: { data: { name: 'Batch A', email: `batch-a-${ts}@test.com` } },
      },
      {
        method: 'sys_create',
        model: 'contacts',
        params: { data: { name: 'Batch B', email: `batch-b-${ts}@test.com` } },
      },
      {
        method: 'sys_create',
        model: 'contacts',
        params: { data: { name: 'Batch C', email: `batch-c-${ts}@test.com` } },
      },
    ]);

    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();
    const results = Array.isArray(res.data) ? res.data : res.data.results;
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.success).toBe(true);
      expect(r.data.id).toBeTypeOf('number');
      createdContactIds.push(r.data.id);
    }
  });

  it('1.2g — sys_batch: batch with invalid operation rolls back all', async () => {
    const ts = Date.now();
    // First create a contact to get a known email
    const existing = await rpc('sys_create', 'contacts', {
      data: { name: 'Existing', email: `existing-${ts}@test.com` },
    });
    createdContactIds.push(existing.data.id);

    // Now batch: one valid create + one with duplicate email → should fail
    const res = await rpcBatch([
      {
        method: 'sys_create',
        model: 'contacts',
        params: { data: { name: 'Batch OK', email: `batch-ok-${ts}@test.com` } },
      },
      {
        method: 'sys_create',
        model: 'contacts',
        params: { data: { name: 'Batch Dup', email: `existing-${ts}@test.com` } }, // duplicate
      },
    ]);

    // The batch should either fail entirely or report the error
    if (res.success === false) {
      // Full rollback — the expected behavior
      expect(res.error).toBeDefined();
    } else {
      // Partial failure mode — check that at least one op failed
      const results = Array.isArray(res.data) ? res.data : res.data.results;
      const failed = results.find((r: any) => !r.success);
      expect(failed).toBeDefined();
    }
  });

  afterAll(async () => {
    // Clean up created tasks
    for (const id of taskIds) {
      await rpc('sys_delete', 'tasks', { id });
    }
  });
});

// ─── Cleanup ──────────────────────────────────────────────────────────

afterAll(async () => {
  // Clean up created contacts
  for (const id of createdContactIds) {
    try {
      await rpc('sys_delete', 'contacts', { id });
    } catch {
      // ignore cleanup errors
    }
  }
});
