/**
 * Tests for sys_aggregate (0A-3)
 */

import { describe, it, expect } from 'vitest';
import { sysAggregate } from '../src/crud/aggregate';
import { createMockD1 } from './helpers/mock-d1';
import { TEST_MODEL, TEST_MODEL_SOFT_DELETE, TEST_MODEL_SHARED, TEST_USER, TEST_ANON } from './helpers/mock-env';
import type { ModelProps } from '../src/types/env';

const ORDERS_MODEL: ModelProps = {
  uuid: 'orders-uuid',
  name: 'orders',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'amount', type: 'real' },
    { name: 'category', type: 'text' },
    { name: 'status', type: 'text' },
  ],
};

describe('sys_aggregate', () => {
  it('count without groupBy returns single total', async () => {
    const db = createMockD1({
      defaultResult: [{ total: 42 }],
    });

    const result = await sysAggregate(
      ORDERS_MODEL,
      {
        aggregations: [{ function: 'count', alias: 'total' }],
      },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ total: 42 }]);
  });

  it('sum/avg/min/max with field returns correct values', async () => {
    const db = createMockD1({
      defaultResult: [{ revenue: 1000, avgOrder: 50, minOrder: 10, maxOrder: 200 }],
    });

    const result = await sysAggregate(
      ORDERS_MODEL,
      {
        aggregations: [
          { function: 'sum', field: 'amount', alias: 'revenue' },
          { function: 'avg', field: 'amount', alias: 'avgOrder' },
          { function: 'min', field: 'amount', alias: 'minOrder' },
          { function: 'max', field: 'amount', alias: 'maxOrder' },
        ],
      },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);

    // Verify the SQL contains all aggregation functions
    const query = db._queries[0];
    expect(query.sql).toContain('SUM(');
    expect(query.sql).toContain('AVG(');
    expect(query.sql).toContain('MIN(');
    expect(query.sql).toContain('MAX(');
  });

  it('multiple aggregations in one call', async () => {
    const db = createMockD1({
      defaultResult: [{ total: 100, revenue: 5000 }],
    });

    const result = await sysAggregate(
      ORDERS_MODEL,
      {
        aggregations: [
          { function: 'count', alias: 'total' },
          { function: 'sum', field: 'amount', alias: 'revenue' },
        ],
      },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ total: 100, revenue: 5000 }]);
  });

  it('groupBy produces grouped results', async () => {
    const db = createMockD1({
      defaultResult: [
        { category: 'electronics', total: 50 },
        { category: 'clothing', total: 30 },
      ],
    });

    const result = await sysAggregate(
      ORDERS_MODEL,
      {
        aggregations: [{ function: 'count', alias: 'total' }],
        groupBy: ['category'],
      },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);

    const query = db._queries[0];
    expect(query.sql).toContain('GROUP BY');
    expect(query.sql).toContain('"category"');
  });

  it('filters reduce aggregation scope', async () => {
    const db = createMockD1({
      defaultResult: [{ total: 10 }],
    });

    await sysAggregate(
      ORDERS_MODEL,
      {
        aggregations: [{ function: 'count', alias: 'total' }],
        filters: { status: 'completed' },
      },
      TEST_USER,
      db
    );

    const query = db._queries[0];
    expect(query.sql).toContain('"status" = ?');
    expect(query.binds).toContain('completed');
  });

  it('orderBy on alias sorts groups', async () => {
    const db = createMockD1({
      defaultResult: [
        { category: 'electronics', revenue: 5000 },
        { category: 'clothing', revenue: 3000 },
      ],
    });

    await sysAggregate(
      ORDERS_MODEL,
      {
        aggregations: [{ function: 'sum', field: 'amount', alias: 'revenue' }],
        groupBy: ['category'],
        orderBy: { revenue: 'desc' },
      },
      TEST_USER,
      db
    );

    const query = db._queries[0];
    expect(query.sql).toContain('ORDER BY');
    expect(query.sql).toContain('DESC');
  });

  it('invalid function returns error', async () => {
    const db = createMockD1();

    await expect(
      sysAggregate(
        ORDERS_MODEL,
        {
          aggregations: [{ function: 'median', field: 'amount', alias: 'med' }],
        },
        TEST_USER,
        db
      )
    ).rejects.toThrow("Invalid aggregation function 'median'");
  });

  it('missing field for sum/avg/min/max returns error', async () => {
    const db = createMockD1();

    await expect(
      sysAggregate(
        ORDERS_MODEL,
        {
          aggregations: [{ function: 'sum', alias: 'total' }],
        },
        TEST_USER,
        db
      )
    ).rejects.toThrow("requires a \"field\" parameter");
  });

  it('invalid field name returns error', async () => {
    const db = createMockD1();

    await expect(
      sysAggregate(
        ORDERS_MODEL,
        {
          aggregations: [{ function: 'sum', field: 'nonexistent', alias: 'total' }],
        },
        TEST_USER,
        db
      )
    ).rejects.toThrow("Invalid field 'nonexistent'");
  });

  it('invalid alias (SQL injection attempt) returns error', async () => {
    const db = createMockD1();

    await expect(
      sysAggregate(
        ORDERS_MODEL,
        {
          aggregations: [{ function: 'count', alias: 'total; DROP TABLE' }],
        },
        TEST_USER,
        db
      )
    ).rejects.toThrow('Invalid alias');
  });

  it('ownerScope filtering applies', async () => {
    const db = createMockD1({
      defaultResult: [{ total: 5 }],
    });

    await sysAggregate(
      ORDERS_MODEL,
      {
        aggregations: [{ function: 'count', alias: 'total' }],
      },
      TEST_USER,
      db
    );

    const query = db._queries[0];
    expect(query.sql).toContain('owner_id = ?');
    expect(query.binds).toContain(TEST_USER.id);
  });

  it('shared scope omits owner_id filter', async () => {
    const db = createMockD1({
      defaultResult: [{ total: 10 }],
    });

    await sysAggregate(
      TEST_MODEL_SHARED,
      {
        aggregations: [{ function: 'count', alias: 'total' }],
      },
      TEST_USER,
      db
    );

    const query = db._queries[0];
    expect(query.sql).not.toContain('owner_id');
  });

  it('soft-deleted records excluded', async () => {
    const softDeleteModel: ModelProps = {
      ...ORDERS_MODEL,
      softDelete: true,
    };

    const db = createMockD1({
      defaultResult: [{ total: 5 }],
    });

    await sysAggregate(
      softDeleteModel,
      {
        aggregations: [{ function: 'count', alias: 'total' }],
      },
      TEST_USER,
      db
    );

    const query = db._queries[0];
    expect(query.sql).toContain('"deleted_at" IS NULL');
  });

  it('missing aggregations array returns error', async () => {
    const db = createMockD1();

    await expect(
      sysAggregate(ORDERS_MODEL, undefined, TEST_USER, db)
    ).rejects.toThrow('Missing or empty "aggregations" array');
  });

  it('invalid orderBy field returns error', async () => {
    const db = createMockD1();

    await expect(
      sysAggregate(
        ORDERS_MODEL,
        {
          aggregations: [{ function: 'count', alias: 'total' }],
          orderBy: { nonexistent: 'asc' },
        },
        TEST_USER,
        db
      )
    ).rejects.toThrow('Invalid orderBy fields');
  });

  it('invalid groupBy field returns error', async () => {
    const db = createMockD1();

    await expect(
      sysAggregate(
        ORDERS_MODEL,
        {
          aggregations: [{ function: 'count', alias: 'total' }],
          groupBy: ['nonexistent'],
        },
        TEST_USER,
        db
      )
    ).rejects.toThrow("Invalid groupBy field 'nonexistent'");
  });
});
