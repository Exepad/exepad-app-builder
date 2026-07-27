/**
 * Tests for sys_batch (0A-4)
 */

import { describe, it, expect } from 'vitest';
import { sysBatch } from '../src/crud/batch';
import { createMockD1 } from './helpers/mock-d1';
import { TEST_MODEL, TEST_USER, TEST_ANON } from './helpers/mock-env';
import type { ModelProps, InjectedProps } from '../src/types/env';

const ORDERS_MODEL: ModelProps = {
  uuid: 'orders-uuid',
  name: 'orders',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'amount', type: 'real' },
    { name: 'status', type: 'text' },
  ],
};

const TEST_CONFIG: InjectedProps = {
  models: [TEST_MODEL, ORDERS_MODEL],
  handlers: [],
};

describe('sys_batch', () => {
  it('batch of creates succeeds atomically', async () => {
    const db = createMockD1({
      defaultResult: [{ id: 1, name: 'Alice', email: 'alice@test.com', owner_id: 'user-123' }],
    });

    const result = await sysBatch(
      {
        operations: [
          {
            method: 'sys_create',
            model: 'contacts',
            params: { data: { name: 'Alice', email: 'alice@test.com' } },
          },
          {
            method: 'sys_create',
            model: 'contacts',
            params: { data: { name: 'Bob', email: 'bob@test.com' } },
          },
        ],
      },
      TEST_USER,
      TEST_CONFIG,
      db
    );

    expect(result.success).toBe(true);
    expect((result.data as any).results).toHaveLength(2);
    expect((result.data as any).results[0].method).toBe('sys_create');
    expect((result.data as any).results[1].method).toBe('sys_create');
  });

  it('batch of mixed operations succeeds', async () => {
    const db = createMockD1({
      defaultResult: [{ id: 1, name: 'Alice', email: 'alice@test.com', owner_id: 'user-123' }],
    });

    const result = await sysBatch(
      {
        operations: [
          {
            method: 'sys_create',
            model: 'contacts',
            params: { data: { name: 'Alice', email: 'alice@test.com' } },
          },
          {
            method: 'sys_update',
            model: 'contacts',
            params: { id: 1, data: { name: 'Alice Updated' } },
          },
          {
            method: 'sys_delete',
            model: 'contacts',
            params: { id: 2 },
          },
        ],
      },
      TEST_USER,
      TEST_CONFIG,
      db
    );

    expect(result.success).toBe(true);
    expect((result.data as any).results).toHaveLength(3);
    expect((result.data as any).results[0].method).toBe('sys_create');
    expect((result.data as any).results[1].method).toBe('sys_update');
    expect((result.data as any).results[2].method).toBe('sys_delete');
    expect((result.data as any).results[2].data.deleted).toBe(true);
  });

  it('batch with invalid operation fails all (pre-validation)', async () => {
    const db = createMockD1();

    await expect(
      sysBatch(
        {
          operations: [
            {
              method: 'sys_create',
              model: 'contacts',
              params: { data: { name: 'Alice', email: 'alice@test.com' } },
            },
            {
              method: 'sys_create',
              model: 'contacts',
              // Missing required 'email' field
              params: { data: { name: 'Bob' } },
            },
          ],
        },
        TEST_USER,
        TEST_CONFIG,
        db
      )
    ).rejects.toThrow('validation failed');
  });

  it('pre-validation catches errors before any SQL executes', async () => {
    const db = createMockD1();

    await expect(
      sysBatch(
        {
          operations: [
            {
              method: 'sys_create',
              model: 'nonexistent_model',
              params: { data: { name: 'Alice' } },
            },
          ],
        },
        TEST_USER,
        TEST_CONFIG,
        db
      )
    ).rejects.toThrow("model 'nonexistent_model' not found");

    // No queries should have been executed
    expect(db._queries).toHaveLength(0);
  });

  it('read operations rejected in batch', async () => {
    const db = createMockD1();

    await expect(
      sysBatch(
        {
          operations: [
            {
              method: 'sys_read',
              model: 'contacts',
              params: { id: 1 },
            },
          ],
        },
        TEST_USER,
        TEST_CONFIG,
        db
      )
    ).rejects.toThrow('read operations');

    await expect(
      sysBatch(
        {
          operations: [
            {
              method: 'sys_list',
              model: 'contacts',
              params: {},
            },
          ],
        },
        TEST_USER,
        TEST_CONFIG,
        db
      )
    ).rejects.toThrow('read operations');
  });

  it('max 50 operations limit', async () => {
    const db = createMockD1();

    const operations = Array.from({ length: 51 }, (_, i) => ({
      method: 'sys_create' as const,
      model: 'contacts',
      params: { data: { name: `User ${i}`, email: `user${i}@test.com` } },
    }));

    await expect(
      sysBatch({ operations }, TEST_USER, TEST_CONFIG, db)
    ).rejects.toThrow('exceeds maximum of 50');
  });

  it('auth enforced per operation', async () => {
    const db = createMockD1();

    // Unauthenticated user should fail on write operations
    await expect(
      sysBatch(
        {
          operations: [
            {
              method: 'sys_create',
              model: 'contacts',
              params: { data: { name: 'Alice', email: 'alice@test.com' } },
            },
          ],
        },
        TEST_ANON,
        TEST_CONFIG,
        db
      )
    ).rejects.toThrow('Authentication required');
  });

  it('results maintain operation order', async () => {
    const db = createMockD1({
      defaultResult: [{ id: 1, name: 'Test', email: 'test@test.com', owner_id: 'user-123' }],
    });

    const result = await sysBatch(
      {
        operations: [
          {
            method: 'sys_create',
            model: 'contacts',
            params: { data: { name: 'First', email: 'first@test.com' } },
          },
          {
            method: 'sys_delete',
            model: 'contacts',
            params: { id: 99 },
          },
          {
            method: 'sys_create',
            model: 'orders',
            params: { data: { amount: 100, status: 'pending' } },
          },
        ],
      },
      TEST_USER,
      TEST_CONFIG,
      db
    );

    expect(result.success).toBe(true);
    const results = (result.data as any).results;
    expect(results[0].method).toBe('sys_create');
    expect(results[0].model).toBe('contacts');
    expect(results[1].method).toBe('sys_delete');
    expect(results[1].model).toBe('contacts');
    expect(results[2].method).toBe('sys_create');
    expect(results[2].model).toBe('orders');
  });

  it('created records include generated data in results', async () => {
    const db = createMockD1({
      defaultResult: [
        { id: 42, name: 'Alice', email: 'alice@test.com', owner_id: 'user-123', created_at: '2026-01-01' },
      ],
    });

    const result = await sysBatch(
      {
        operations: [
          {
            method: 'sys_create',
            model: 'contacts',
            params: { data: { name: 'Alice', email: 'alice@test.com' } },
          },
        ],
      },
      TEST_USER,
      TEST_CONFIG,
      db
    );

    expect(result.success).toBe(true);
    const createResult = (result.data as any).results[0];
    expect(createResult.data.id).toBe(42);
    expect(createResult.data.name).toBe('Alice');
  });

  it('nested sys_batch is rejected', async () => {
    const db = createMockD1();

    await expect(
      sysBatch(
        {
          operations: [
            {
              method: 'sys_batch',
              model: 'contacts',
              params: { operations: [] },
            },
          ],
        },
        TEST_USER,
        TEST_CONFIG,
        db
      )
    ).rejects.toThrow('nested sys_batch');
  });

  it('missing operations array returns error', async () => {
    const db = createMockD1();

    await expect(
      sysBatch(undefined, TEST_USER, TEST_CONFIG, db)
    ).rejects.toThrow('Missing or empty "operations"');
  });

  it('ownerScope enforced per operation', async () => {
    const db = createMockD1({
      defaultResult: [{ id: 1, name: 'Alice', email: 'alice@test.com', owner_id: 'user-123' }],
    });

    await sysBatch(
      {
        operations: [
          {
            method: 'sys_create',
            model: 'contacts',
            params: { data: { name: 'Alice', email: 'alice@test.com' } },
          },
        ],
      },
      TEST_USER,
      TEST_CONFIG,
      db
    );

    // The INSERT should include owner_id
    const insertQuery = db._queries.find((q) => q.sql.includes('INSERT'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery!.sql).toContain('"owner_id"');
  });
});
