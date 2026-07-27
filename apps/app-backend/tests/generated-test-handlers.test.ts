import { describe, it, expect } from 'vitest';
import getTaskStats from '../src/handlers/compiled/getTaskStats.js';
import completeTask from '../src/handlers/compiled/completeTask.js';
import { createMockD1, getExecutedQueries } from './helpers/mock-d1';

describe('generated _test handlers', () => {
  it('getTaskStats returns normalized aggregates for the current user', async () => {
    const db = createMockD1({
      results: new Map([
        [
          'COUNT(*) AS total_tasks',
          [
            {
              total_tasks: '5',
              completed_tasks: '2',
              overdue_tasks: '1',
              in_progress_tasks: '1',
            },
          ],
        ],
        [
          'GROUP BY priority',
          [
            { priority: 'high', count: '3' },
            { priority: 'low', count: '2' },
          ],
        ],
        [
          'GROUP BY status',
          [
            { status: 'todo', count: '2' },
            { status: 'done', count: '2' },
            { status: 'in_progress', count: '1' },
          ],
        ],
      ]),
    });

    const result = await getTaskStats({
      db,
      user: { id: 'user-123', email: 'test@example.com', roles: [] },
      params: {},
      log: console,
      config: { appId: '_test', appAlias: '_test' },
      models: {},
      services: {},
      batch: async () => [],
    });

    expect(result).toEqual({
      total_tasks: 5,
      completed_tasks: 2,
      overdue_tasks: 1,
      in_progress_tasks: 1,
      by_priority: [
        { priority: 'high', count: 3 },
        { priority: 'low', count: 2 },
      ],
      by_status: [
        { status: 'todo', count: 2 },
        { status: 'done', count: 2 },
        { status: 'in_progress', count: 1 },
      ],
    });

    const queries = getExecutedQueries(db);
    expect(queries).toHaveLength(3);
    expect(queries.every((query) => query.binds[0] === 'user-123')).toBe(true);
  });

  it('completeTask updates and returns the task for the current user', async () => {
    const db = createMockD1({
      results: new Map([
        [
          'RETURNING *',
          [
            {
              id: 7,
              title: 'Finish report',
              status: 'done',
              owner_id: 'user-123',
            },
          ],
        ],
      ]),
    });

    const result = await completeTask({
      db,
      user: { id: 'user-123', email: 'test@example.com', roles: [] },
      params: { task_id: 7 },
      log: console,
      config: { appId: '_test', appAlias: '_test' },
      models: {},
      services: {},
      batch: async () => [],
    });

    expect(result.success).toBe(true);
    expect(result.task).toMatchObject({
      id: 7,
      status: 'done',
      owner_id: 'user-123',
    });

    const [query] = getExecutedQueries(db);
    expect(query.sql).toContain('UPDATE tasks');
    expect(query.binds[2]).toBe(7);
    expect(query.binds[3]).toBe('user-123');
  });
});
