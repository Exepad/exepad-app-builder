/**
 * Tests for R2-aware seed data loader + inserter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { seedFromR2 } from '../src/seed/r2-seeder';
import type { SeedFromR2Options } from '../src/seed/r2-seeder';
import type { DeploymentConfig } from '../src/deploy/types';
import type { SeedRepoProps } from '@exepad/types';

// Mock executeD1DDL
vi.mock('../src/deploy/d1', () => ({
  executeD1DDL: vi.fn(),
}));

import { executeD1DDL } from '../src/deploy/d1';

const mockExecuteD1DDL = vi.mocked(executeD1DDL);

const TEST_CONFIG: DeploymentConfig = {
  appId: 'test-app',
  appAlias: 'test',
  accountId: 'acct-id',
  apiToken: 'token',
  wfpNamespace: 'ns',
};

/**
 * Helper: create a mock R2Bucket
 */
function createMockR2(files: Record<string, string>): R2Bucket {
  return {
    get: vi.fn(async (key: string) => {
      const content = files[key];
      if (!content) return null;
      return {
        text: async () => content,
        body: null,
        bodyUsed: false,
        arrayBuffer: async () => new ArrayBuffer(0),
        blob: async () => new Blob(),
        json: async () => JSON.parse(content),
      } as unknown as R2ObjectBody;
    }),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    head: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket;
}

function buildOptions(
  overrides: Partial<SeedFromR2Options> & { seedEntries: Record<string, SeedRepoProps> }
): SeedFromR2Options {
  return {
    r2: createMockR2({}),
    config: TEST_CONFIG,
    dbId: 'db-123',
    appId: 'test-app',
    mode: 'preview',
    ...overrides,
  };
}

beforeEach(() => {
  mockExecuteD1DDL.mockReset();
});

describe('CSV parsing', () => {
  it('parses headers and data rows', async () => {
    const csv = 'name,email\nAlice,alice@test.com\nBob,bob@test.com';
    const r2 = createMockR2({ 'test-app/repo/seed/contacts_abc.csv': csv });

    // isTableEmpty returns count=0 (empty)
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ count: 0 }] } as never);
    // INSERT succeeds
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);

    const result = await seedFromR2(
      buildOptions({
        r2,
        seedEntries: {
          contacts: {
            source: 'repo/seed/contacts_abc.csv',
            source_hash: 'abc',
            format: 'csv',
            model: 'contacts',
          },
        },
      })
    );

    expect(result.seeded).toEqual(['contacts']);
    expect(result.errors).toHaveLength(0);

    // Verify INSERT SQL was called
    const insertCall = mockExecuteD1DDL.mock.calls.find(
      (c) => typeof c[2] === 'string' && (c[2] as string).includes('INSERT INTO')
    );
    expect(insertCall).toBeTruthy();
    const sql = insertCall![2] as string;
    expect(sql).toContain('"name"');
    expect(sql).toContain('"email"');
    expect(sql).toContain("'Alice'");
    expect(sql).toContain("'Bob'");
  });

  it('auto-casts booleans, numbers, and null', async () => {
    const csv = 'active,count,notes\ntrue,42,null';
    const r2 = createMockR2({ 'test-app/repo/seed/items_abc.csv': csv });

    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ count: 0 }] } as never);
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);

    await seedFromR2(
      buildOptions({
        r2,
        seedEntries: {
          items: {
            source: 'repo/seed/items_abc.csv',
            source_hash: 'abc',
            format: 'csv',
            model: 'items',
          },
        },
      })
    );

    const insertCall = mockExecuteD1DDL.mock.calls.find(
      (c) => typeof c[2] === 'string' && (c[2] as string).includes('INSERT INTO')
    );
    const sql = insertCall![2] as string;
    // true → 1 (boolean), 42 (number), null → NULL
    expect(sql).toContain('1');
    expect(sql).toContain('42');
    expect(sql).toContain('NULL');
  });

  it('handles quoted fields with commas', async () => {
    const csv = 'name,bio\nAlice,"Hello, world"\nBob,"She said ""hi""."';
    const r2 = createMockR2({ 'test-app/repo/seed/people_abc.csv': csv });

    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ count: 0 }] } as never);
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);

    const result = await seedFromR2(
      buildOptions({
        r2,
        seedEntries: {
          people: {
            source: 'repo/seed/people_abc.csv',
            source_hash: 'abc',
            format: 'csv',
            model: 'people',
          },
        },
      })
    );

    expect(result.seeded).toEqual(['people']);
    const insertCall = mockExecuteD1DDL.mock.calls.find(
      (c) => typeof c[2] === 'string' && (c[2] as string).includes('INSERT INTO')
    );
    const sql = insertCall![2] as string;
    expect(sql).toContain('Hello, world');
  });
});

describe('FK-column header reconciliation (seed plan vs materialized schema)', () => {
  // The seed builder names a relation `project`/`assignee` (from the plan), while
  // the model builder materializes it as the `project_id`/`assignee_id` FK column.
  // Without reconciliation every task row fails to insert ("no column named project").
  const TASKS_CSV = 'id,title,status,project,assignee\n1,Design,todo,10,20\n2,Build,done,11,21';
  const MODELS: NonNullable<SeedFromR2Options['models']> = [
    { name: 'projects', columns: [{ name: 'name' }] },
    { name: 'members', columns: [{ name: 'name' }] },
    {
      name: 'tasks',
      columns: [
        { name: 'title' },
        { name: 'status' },
        { name: 'project_id', isNullable: true, references: { model: 'projects' } },
        { name: 'assignee_id', isNullable: true, references: { model: 'members' } },
      ],
    },
  ];

  function seedEntries(): Record<string, SeedRepoProps> {
    return {
      projects: { source: 'repo/seed/projects.csv', source_hash: 'p', format: 'csv', model: 'projects' },
      members: { source: 'repo/seed/members.csv', source_hash: 'm', format: 'csv', model: 'members' },
      tasks: { source: 'repo/seed/tasks.csv', source_hash: 't', format: 'csv', model: 'tasks' },
    };
  }

  it('renames bare relation headers to the `_id` FK column so the rows seed', async () => {
    const r2 = createMockR2({
      'test-app/repo/seed/projects.csv': 'id,name\n10,Website\n11,Mobile',
      'test-app/repo/seed/members.csv': 'id,name\n20,Alice\n21,Bob',
      'test-app/repo/seed/tasks.csv': TASKS_CSV,
    });
    mockExecuteD1DDL.mockResolvedValue({ results: [] } as never);

    const result = await seedFromR2(buildOptions({ r2, seedEntries: seedEntries(), models: MODELS }));

    // tasks seeded (was: dropped entirely with a "no column named project" error).
    expect(result.seeded).toContain('tasks');
    expect(result.errors.join('\n')).not.toMatch(/no column named/i);

    const tasksInsert = mockExecuteD1DDL.mock.calls
      .map((c) => c[2] as string)
      .find((s) => typeof s === 'string' && s.includes('INSERT INTO "tasks"'));
    expect(tasksInsert).toBeTruthy();
    // The insert targets the real FK columns, not the bare relation names.
    expect(tasksInsert).toContain('"project_id"');
    expect(tasksInsert).toContain('"assignee_id"');
    expect(tasksInsert).not.toMatch(/[(,\s]"project"[,)\s]/);
    expect(tasksInsert).not.toMatch(/[(,\s]"assignee"[,)\s]/);
  });

  it('leaves a real declared column untouched (only renames a header with no matching column)', async () => {
    // `status` is a real column and `status_id` is NOT an FK column → never renamed.
    const r2 = createMockR2({
      'test-app/repo/seed/projects.csv': 'id,name\n10,Website',
      'test-app/repo/seed/members.csv': 'id,name\n20,Alice',
      'test-app/repo/seed/tasks.csv': TASKS_CSV,
    });
    mockExecuteD1DDL.mockResolvedValue({ results: [] } as never);

    await seedFromR2(buildOptions({ r2, seedEntries: seedEntries(), models: MODELS }));

    const tasksInsert = mockExecuteD1DDL.mock.calls
      .map((c) => c[2] as string)
      .find((s) => typeof s === 'string' && s.includes('INSERT INTO "tasks"'));
    expect(tasksInsert).toContain('"status"');
    expect(tasksInsert).not.toContain('"status_id"');
  });
});

describe('FK to a parent populated by a PRIOR deploy (edit-adds-child)', () => {
  // An edit adds a `comments` model whose NOT NULL `task_id` FK references the
  // EXISTING `tasks` table. Only the comments seed is re-run this deploy, so
  // `tasks` never enters `seededModels` — but it already holds rows, so the FK
  // is satisfiable and the comments seed must NOT be dropped.
  const MODELS: NonNullable<SeedFromR2Options['models']> = [
    { name: 'tasks', columns: [{ name: 'title' }] },
    {
      name: 'comments',
      columns: [
        { name: 'body' },
        { name: 'task_id', isNullable: false, references: { model: 'tasks' } },
      ],
    },
  ];
  const COMMENTS_CSV = 'id,body,task_id\n1,Looks good,1\n2,Ship it,2';

  it('seeds the child when the referenced parent already has rows', async () => {
    const r2 = createMockR2({ 'test-app/repo/seed/comments.csv': COMMENTS_CSV });
    // Every probe/DDL resolves; isTableEmpty(tasks) sees a non-empty table (count>0).
    mockExecuteD1DDL.mockResolvedValue({ results: [{ count: 12 }] } as never);

    const result = await seedFromR2(
      buildOptions({
        r2,
        models: MODELS,
        seedEntries: {
          comments: { source: 'repo/seed/comments.csv', source_hash: 'c', format: 'csv', model: 'comments' },
        },
      }),
    );

    expect(result.seeded).toContain('comments');
    expect(result.errors.join('\n')).not.toMatch(/cannot defer NOT NULL FK/);
    // The FK value is inserted intact (not NULL-deferred) since the parent exists.
    const insert = mockExecuteD1DDL.mock.calls
      .map((c) => c[2] as string)
      .find((s) => typeof s === 'string' && s.includes('INSERT INTO "comments"'));
    expect(insert).toContain('"task_id"');
  });

  it('still blocks a NOT NULL FK to a genuinely EMPTY, unseeded parent (regression guard)', async () => {
    const r2 = createMockR2({ 'test-app/repo/seed/comments.csv': COMMENTS_CSV });
    // isTableEmpty(tasks) sees an empty table (count=0) → the FK truly cannot resolve.
    mockExecuteD1DDL.mockResolvedValue({ results: [{ count: 0 }] } as never);

    const result = await seedFromR2(
      buildOptions({
        r2,
        models: MODELS,
        seedEntries: {
          comments: { source: 'repo/seed/comments.csv', source_hash: 'c', format: 'csv', model: 'comments' },
        },
      }),
    );

    expect(result.seeded).not.toContain('comments');
    expect(result.errors.join('\n')).toMatch(/cannot defer NOT NULL FK column 'task_id'/);
  });
});

describe('JSON parsing', () => {
  it('parses array of objects', async () => {
    const json = JSON.stringify([
      { name: 'Alice', email: 'a@test.com' },
      { name: 'Bob', email: 'b@test.com' },
    ]);
    const r2 = createMockR2({ 'test-app/repo/seed/users_abc.json': json });

    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ count: 0 }] } as never);
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);

    const result = await seedFromR2(
      buildOptions({
        r2,
        seedEntries: {
          users: {
            source: 'repo/seed/users_abc.json',
            source_hash: 'abc',
            format: 'json',
            model: 'users',
          },
        },
      })
    );

    expect(result.seeded).toEqual(['users']);
    expect(result.errors).toHaveLength(0);
  });

  it('reports error for non-array JSON', async () => {
    const json = JSON.stringify({ not: 'an array' });
    const r2 = createMockR2({ 'test-app/repo/seed/bad_abc.json': json });

    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ count: 0 }] } as never);

    const result = await seedFromR2(
      buildOptions({
        r2,
        seedEntries: {
          bad: {
            source: 'repo/seed/bad_abc.json',
            source_hash: 'abc',
            format: 'json',
            model: 'bad',
          },
        },
      })
    );

    expect(result.seeded).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('must be an array');
  });
});

describe('batch INSERT', () => {
  it('batches records at 500 rows', async () => {
    // Create 1200 records to force 3 batches (500 + 500 + 200)
    const records = Array.from({ length: 1200 }, (_, i) => ({ id: i, name: `row_${i}` }));
    const json = JSON.stringify(records);
    const r2 = createMockR2({ 'test-app/repo/seed/big_abc.json': json });

    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ count: 0 }] } as never);
    // 3 batch INSERTs
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);

    const result = await seedFromR2(
      buildOptions({
        r2,
        seedEntries: {
          big: {
            source: 'repo/seed/big_abc.json',
            source_hash: 'abc',
            format: 'json',
            model: 'big',
          },
        },
      })
    );

    expect(result.seeded).toEqual(['big']);
    // 3 batch INSERTs into the model table (the _exepad_meta signature write is
    // separate bookkeeping and is excluded here).
    const insertCalls = mockExecuteD1DDL.mock.calls.filter(
      (c) =>
        typeof c[2] === 'string' &&
        (c[2] as string).includes('INSERT INTO') &&
        !(c[2] as string).includes('_exepad_meta')
    );
    expect(insertCalls).toHaveLength(3);
  });
});

describe('skipIfNotEmpty', () => {
  it('skips seeding when DELETE-by-owner_id fails AND table has rows', async () => {
    // The seeder always tries an owner_id-scoped DELETE first to clear
    // stale seed rows. If the DELETE throws (e.g. table has no owner_id
    // column, or doesn't exist), it falls back to the legacy
    // "skip if table is non-empty" guard. Drive that fallback path here.
    const csv = 'name\nAlice';
    const r2 = createMockR2({ 'test-app/repo/seed/contacts_abc.csv': csv });

    mockExecuteD1DDL
      // 1st call: preview seed-signature read — no stored signature yet.
      .mockResolvedValueOnce({ results: [] } as never)
      // 2nd call: DELETE — fail (no owner_id column).
      .mockRejectedValueOnce(new Error('no such column: owner_id'))
      // 3rd call: isTableEmpty's SELECT COUNT — table has rows.
      .mockResolvedValueOnce({ results: [{ count: 5 }] } as never);
    // 4th call: preview seed-signature write (uses the default mock).

    const result = await seedFromR2(
      buildOptions({
        r2,
        seedEntries: {
          contacts: {
            source: 'repo/seed/contacts_abc.csv',
            source_hash: 'abc',
            format: 'csv',
            model: 'contacts',
          },
        },
      })
    );

    expect(result.skipped).toEqual(['contacts']);
    expect(result.seeded).toHaveLength(0);
    // 4 calls: sig-read + failed DELETE + isTableEmpty SELECT + sig-write.
    expect(mockExecuteD1DDL).toHaveBeenCalledTimes(4);
  });

  it('treats table check error as empty (seeds anyway)', async () => {
    const csv = 'name\nAlice';
    const r2 = createMockR2({ 'test-app/repo/seed/contacts_abc.csv': csv });

    // isTableEmpty throws (table doesn't exist yet)
    mockExecuteD1DDL.mockRejectedValueOnce(new Error('no such table'));
    // INSERT succeeds
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);

    const result = await seedFromR2(
      buildOptions({
        r2,
        seedEntries: {
          contacts: {
            source: 'repo/seed/contacts_abc.csv',
            source_hash: 'abc',
            format: 'csv',
            model: 'contacts',
          },
        },
      })
    );

    expect(result.seeded).toEqual(['contacts']);
  });

  it('preview re-deploy with UNCHANGED seed content skips re-seed (preserves operator data)', async () => {
    const csv = 'name\nAlice';
    const r2 = createMockR2({ 'test-app/repo/seed/contacts_abc.csv': csv });
    const entries = {
      contacts: {
        source: 'repo/seed/contacts_abc.csv',
        source_hash: 'abc',
        format: 'csv' as const,
        model: 'contacts',
      },
    };

    // Stateful _exepad_meta: the signature WRITE on run 1 is read back on run 2.
    let storedSig: string | null = null;
    mockExecuteD1DDL.mockImplementation((async (_cfg: unknown, _db: unknown, sql: string) => {
      if (sql.includes('_exepad_meta')) {
        if (sql.startsWith('SELECT')) {
          return { results: storedSig == null ? [] : [{ value: storedSig }] };
        }
        const m = /,\s*'([^']+)',\s*'[^']*'\)\s*ON CONFLICT/.exec(sql);
        if (m) storedSig = m[1];
        return { results: [] };
      }
      return { results: [] }; // DELETE / INSERT / isTableEmpty
    }) as never);

    // Run 1 — no stored signature: seeds normally and persists a signature.
    const first = await seedFromR2(buildOptions({ r2, seedEntries: entries }));
    expect(first.seeded).toEqual(['contacts']);
    expect(storedSig).toBeTruthy();

    // Run 2 — stored signature matches the (unchanged) seed content: skip entirely.
    mockExecuteD1DDL.mockClear();
    const second = await seedFromR2(buildOptions({ r2, seedEntries: entries }));

    expect(second.skipped).toEqual(['contacts']);
    expect(second.seeded).toHaveLength(0);
    const sql2 = mockExecuteD1DDL.mock.calls.map((c) => c[2] as string);
    expect(sql2.some((s) => s.includes('DELETE FROM'))).toBe(false); // no destructive wipe
    expect(sql2.some((s) => /INSERT INTO ["']?contacts/.test(s))).toBe(false); // no re-insert
  });
});

describe('missing R2 file', () => {
  it('reports error when seed file is not in R2', async () => {
    const r2 = createMockR2({}); // empty bucket

    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ count: 0 }] } as never);

    const result = await seedFromR2(
      buildOptions({
        r2,
        seedEntries: {
          contacts: {
            source: 'repo/seed/contacts_abc.csv',
            source_hash: 'abc',
            format: 'csv',
            model: 'contacts',
          },
        },
      })
    );

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('not found in R2');
  });
});

describe('owner_id by mode', () => {
  it('uses preview-owner-{appId} in preview mode', async () => {
    const csv = 'name\nAlice';
    const r2 = createMockR2({ 'test-app/repo/seed/contacts_abc.csv': csv });

    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ count: 0 }] } as never);
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);

    await seedFromR2(
      buildOptions({
        r2,
        mode: 'preview',
        seedEntries: {
          contacts: { source: 'repo/seed/contacts_abc.csv', source_hash: 'abc', format: 'csv', model: 'contacts' },
        },
      })
    );

    const insertCall = mockExecuteD1DDL.mock.calls.find(
      (c) => typeof c[2] === 'string' && (c[2] as string).includes('INSERT INTO')
    );
    const sql = insertCall![2] as string;
    expect(sql).toContain("'preview-owner-test-app'");
  });

  it('OVERRIDES a seed-supplied owner_id with the canonical seedOwnerId', async () => {
    // Regression: the agent sometimes hardcodes `owner_id="demo"` into the
    // seed CSV. In preview the gateway remaps the operator's reads to
    // `preview-owner-{appId}`, so a "demo"-owned row matches nobody and the
    // app looks empty on first view. The seeder must force the canonical
    // owner regardless of what the CSV ships.
    const csv = 'name,owner_id\nAlice,demo\nBob,demo';
    const r2 = createMockR2({ 'test-app/repo/seed/contacts_abc.csv': csv });

    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ count: 0 }] } as never);
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);

    await seedFromR2(
      buildOptions({
        r2,
        mode: 'preview',
        seedEntries: {
          contacts: { source: 'repo/seed/contacts_abc.csv', source_hash: 'abc', format: 'csv', model: 'contacts' },
        },
      })
    );

    const insertCall = mockExecuteD1DDL.mock.calls.find(
      (c) => typeof c[2] === 'string' && (c[2] as string).includes('INSERT INTO')
    );
    const sql = insertCall![2] as string;
    expect(sql).toContain("'preview-owner-test-app'");
    // The hardcoded literal must NOT survive into the row.
    expect(sql).not.toContain("'demo'");
  });

  it('uses first auth user ID in published mode', async () => {
    const authCsv = 'id,email,password,name\nuser-123,alice@test.com,pass123,Alice';
    const contactsCsv = 'name\nBob';
    const r2 = createMockR2({
      'test-app/repo/seed/auth_abc.csv': authCsv,
      'test-app/repo/seed/contacts_abc.csv': contactsCsv,
    });

    // isTableEmpty for _auth_users
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ count: 0 }] } as never);
    // INSERT _auth_users
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);
    // INSERT _auth_accounts
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);
    // isTableEmpty for contacts
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ count: 0 }] } as never);
    // INSERT contacts
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);

    await seedFromR2(
      buildOptions({
        r2,
        mode: 'published',
        seedEntries: {
          auth: { source: 'repo/seed/auth_abc.csv', source_hash: 'abc', format: 'csv', model: '_auth_users' },
          contacts: { source: 'repo/seed/contacts_abc.csv', source_hash: 'abc', format: 'csv', model: 'contacts' },
        },
      })
    );

    const contactsInsert = mockExecuteD1DDL.mock.calls.find(
      (c) => typeof c[2] === 'string' && (c[2] as string).includes('INSERT INTO "contacts"')
    );
    const sql = contactsInsert![2] as string;
    // Should use the first auth user's ID, not 'system-seed' or 'preview-owner-...'
    expect(sql).toContain("'user-123'");
    expect(sql).not.toContain('preview-owner');
    expect(sql).not.toContain('system-seed');
  });

  it('falls back to system-seed in published mode without auth users', async () => {
    const csv = 'name\nAlice';
    const r2 = createMockR2({ 'test-app/repo/seed/contacts_abc.csv': csv });

    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ count: 0 }] } as never);
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);

    await seedFromR2(
      buildOptions({
        r2,
        mode: 'published',
        seedEntries: {
          contacts: { source: 'repo/seed/contacts_abc.csv', source_hash: 'abc', format: 'csv', model: 'contacts' },
        },
      })
    );

    const insertCall = mockExecuteD1DDL.mock.calls.find(
      (c) => typeof c[2] === 'string' && (c[2] as string).includes('INSERT INTO')
    );
    const sql = insertCall![2] as string;
    expect(sql).toContain("'system-seed'");
  });
});

describe('FK deferral', () => {
  it('only NULLs FK columns referencing not-yet-seeded tables', async () => {
    // departments.manager_id → employees (not yet seeded → must NULL)
    // employees.department_id → departments (already seeded → keep intact)
    const deptCsv = 'id,name,manager_id\n1,Engineering,10\n2,Sales,20';
    const empCsv = 'id,name,department_id\n10,Alice,1\n20,Bob,2';
    const r2 = createMockR2({
      'test-app/repo/seed/dept_abc.csv': deptCsv,
      'test-app/repo/seed/emp_abc.csv': empCsv,
    });

    mockExecuteD1DDL.mockResolvedValue({ results: [{ count: 0 }] } as never);

    const result = await seedFromR2(
      buildOptions({
        r2,
        seedEntries: {
          departments: { source: 'repo/seed/dept_abc.csv', source_hash: 'abc', format: 'csv', model: 'departments' },
          employees: { source: 'repo/seed/emp_abc.csv', source_hash: 'abc', format: 'csv', model: 'employees' },
        },
        models: [
          { name: 'departments', columns: [
            { name: 'id' },
            { name: 'name' },
            { name: 'manager_id', references: { model: 'employees' } },
          ]},
          { name: 'employees', columns: [
            { name: 'id' },
            { name: 'name' },
            { name: 'department_id', references: { model: 'departments' } },
          ]},
        ],
      })
    );

    expect(result.seeded).toContain('departments');
    expect(result.seeded).toContain('employees');
    expect(result.errors).toHaveLength(0);

    const allSql = mockExecuteD1DDL.mock.calls.map((c) => c[2] as string);

    // INSERT for departments should have NULL for manager_id (employees not yet seeded)
    const deptInsert = allSql.find((s) => s.includes('INSERT INTO "departments"'));
    expect(deptInsert).toBeTruthy();
    expect(deptInsert).toContain('NULL'); // manager_id is NULLed

    // INSERT for employees should keep department_id intact (departments already seeded)
    const empInsert = allSql.find((s) => s.includes('INSERT INTO "employees"'));
    expect(empInsert).toBeTruthy();
    expect(empInsert).not.toContain('NULL'); // department_id is NOT NULLed

    // Batched UPDATE only for departments (the only table with deferred FKs)
    const deptUpdate = allSql.find((s) => s.includes('UPDATE "departments"'));
    expect(deptUpdate).toBeTruthy();
    expect(deptUpdate).toContain('"manager_id" = 10');
    expect(deptUpdate).toContain('"manager_id" = 20');

    // No UPDATE for employees (its FK was not deferred)
    const empUpdate = allSql.find((s) => s.includes('UPDATE "employees"'));
    expect(empUpdate).toBeUndefined();
  });

  it('works without models (no FK deferral)', async () => {
    const csv = 'name\nAlice';
    const r2 = createMockR2({ 'test-app/repo/seed/contacts_abc.csv': csv });

    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ count: 0 }] } as never);
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);

    const result = await seedFromR2(
      buildOptions({
        r2,
        seedEntries: {
          contacts: { source: 'repo/seed/contacts_abc.csv', source_hash: 'abc', format: 'csv', model: 'contacts' },
        },
        // no models passed — FK deferral is skipped
      })
    );

    expect(result.seeded).toEqual(['contacts']);
    // No UPDATE calls on data tables — only SELECT + INSERT. (The _exepad_meta
    // signature write is an upsert that contains "UPDATE"; exclude it.)
    const allSql = mockExecuteD1DDL.mock.calls.map((c) => c[2] as string);
    expect(
      allSql.filter((s) => s.includes('UPDATE') && !s.includes('_exepad_meta'))
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PR 3 — append-mode support for DataIngester edit-mode uploads
// ---------------------------------------------------------------------------

describe('append-mode seeds', () => {
  it('replace mode (default, unchanged) deletes prior seed and uses platform owner_id', async () => {
    const csv = 'name\nAlice';
    const r2 = createMockR2({ 'test-app/repo/seed/contacts_abc.csv': csv });

    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never); // DELETE
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never); // INSERT

    await seedFromR2(
      buildOptions({
        r2,
        mode: 'preview',
        seedEntries: {
          contacts: {
            source: 'repo/seed/contacts_abc.csv',
            source_hash: 'abc',
            format: 'csv',
            model: 'contacts',
            // mode omitted → defaults to replace
          },
        },
      })
    );

    const allSql = mockExecuteD1DDL.mock.calls.map((c) => c[2] as string);
    const deleteCall = allSql.find((s) => s.startsWith('DELETE FROM'));
    const insertCall = allSql.find((s) => s.startsWith('INSERT INTO'));

    // DELETE wipes the platform seed rows under the preview owner_id.
    expect(deleteCall).toContain("'preview-owner-test-app'");
    expect(deleteCall).not.toContain('data-ingest-');
    // INSERT places new rows under the same platform owner_id.
    expect(insertCall).toContain("'preview-owner-test-app'");
    expect(insertCall).not.toContain('data-ingest-');
  });

  it('append mode skips DELETE and reuses the platform seedOwnerId so rows are user-visible', async () => {
    const csv = 'name\nAlice';
    const r2 = createMockR2({ 'test-app/repo/seed/contacts_v2.csv': csv });

    // Only the INSERT runs — no DELETE in append mode.
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);

    await seedFromR2(
      buildOptions({
        r2,
        mode: 'preview',
        seedEntries: {
          contacts: {
            source: 'repo/seed/contacts_v2.csv',
            source_hash: 'v2hash',
            format: 'csv',
            model: 'contacts',
            mode: 'append',
            batch_id: '5-abc12345',
          },
        },
      })
    );

    const allSql = mockExecuteD1DDL.mock.calls.map((c) => c[2] as string);
    const deleteCall = allSql.find((s) => s.startsWith('DELETE FROM'));
    const insertCall = allSql.find((s) => s.startsWith('INSERT INTO'));

    // No DELETE — append mode preserves prior batches under the same
    // owner_id (replace mode would have wiped them).
    expect(deleteCall).toBeUndefined();

    // INSERT uses the platform seedOwnerId so the logged-in user sees
    // the imported rows. Using a 'data-ingest-*' owner_id would render
    // them invisible to every account.
    expect(insertCall).toContain("'preview-owner-test-app'");
    expect(insertCall).not.toContain('data-ingest-');
  });

  it('append without batch_id falls back to replace semantics', async () => {
    // Misconfiguration guard — mode='append' but no batch_id. We treat it
    // as if mode were not set, since "data-ingest-" owner_id with empty
    // batch is degenerate.
    const csv = 'name\nAlice';
    const r2 = createMockR2({ 'test-app/repo/seed/contacts_abc.csv': csv });

    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);

    await seedFromR2(
      buildOptions({
        r2,
        mode: 'preview',
        seedEntries: {
          contacts: {
            source: 'repo/seed/contacts_abc.csv',
            source_hash: 'abc',
            format: 'csv',
            model: 'contacts',
            mode: 'append', // but no batch_id
          },
        },
      })
    );

    const allSql = mockExecuteD1DDL.mock.calls.map((c) => c[2] as string);
    const deleteCall = allSql.find((s) => s.startsWith('DELETE FROM'));
    const insertCall = allSql.find((s) => s.startsWith('INSERT INTO'));

    // Falls back to platform owner_id rather than emitting a malformed
    // 'data-ingest-undefined' or 'data-ingest-' identifier.
    expect(deleteCall).toContain("'preview-owner-test-app'");
    expect(insertCall).toContain("'preview-owner-test-app'");
    expect(deleteCall).not.toContain('data-ingest-');
  });

  it('append-batch INSERT preserves the prior replace baseline (no DELETE wipes baseline rows)', async () => {
    // Two seed entries for the same model — one is the original seed
    // (replace), one is an append batch from the DataIngester. The
    // append entry must NOT wipe the baseline.
    const baselineCsv = 'name\nAlice';
    const appendCsv = 'name\nBob';
    const r2 = createMockR2({
      'test-app/repo/seed/contacts_a.csv': baselineCsv,
      'test-app/repo/seed/contacts_b.csv': appendCsv,
    });

    mockExecuteD1DDL.mockResolvedValue({ results: [] } as never);

    await seedFromR2(
      buildOptions({
        r2,
        mode: 'preview',
        seedEntries: {
          contacts_baseline: {
            source: 'repo/seed/contacts_a.csv',
            source_hash: 'a',
            format: 'csv',
            model: 'contacts',
          },
          contacts_batch_5: {
            source: 'repo/seed/contacts_b.csv',
            source_hash: 'b',
            format: 'csv',
            model: 'contacts',
            mode: 'append',
            batch_id: '5-xyz',
          },
        },
      })
    );

    const allSql = mockExecuteD1DDL.mock.calls.map((c) => c[2] as string);

    // Baseline DELETEs + INSERTs the seed under the preview owner_id.
    expect(
      allSql.some(
        (s) =>
          s.startsWith('DELETE FROM "contacts"') &&
          s.includes('preview-owner-test-app')
      )
    ).toBe(true);
    expect(
      allSql.some(
        (s) =>
          s.startsWith('INSERT INTO "contacts"') &&
          s.includes("'Alice'") &&
          s.includes('preview-owner-test-app')
      )
    ).toBe(true);

    // The append batch INSERTs Bob (also under preview-owner so the user
    // sees both) WITHOUT issuing a second DELETE — Alice survives.
    const contactsDeletes = allSql.filter((s) =>
      s.startsWith('DELETE FROM "contacts"')
    );
    expect(contactsDeletes).toHaveLength(1); // only the baseline DELETE
    expect(
      allSql.some(
        (s) =>
          s.startsWith('INSERT INTO "contacts"') &&
          s.includes("'Bob'") &&
          s.includes('preview-owner-test-app')
      )
    ).toBe(true);
    // The deprecated data-ingest-* owner_id is gone.
    expect(allSql.some((s) => s.includes('data-ingest-'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FK-aware reseed — DELETE children before parents, INSERT parents before
// children, so a NOT NULL FK child (e.g. loans → books/members ON DELETE
// RESTRICT) is never wiped on a re-deploy. Regression for the mw4h37zf
// "loans table emptied on every other deploy" bug.
// ---------------------------------------------------------------------------

describe('FK-aware reseed', () => {
  const idxOf = (calls: unknown[][], needle: string) =>
    calls.findIndex((c) => typeof c[2] === 'string' && (c[2] as string).includes(needle));

  it('deletes children first and inserts parents first; NOT NULL FK never NULLed', async () => {
    const booksCsv = 'id,title\n1,B1\n2,B2';
    const membersCsv = 'id,name\n1,M1\n2,M2';
    const loansCsv = 'id,book_id,member_id\n1,1,1\n2,2,2';
    const r2 = createMockR2({
      'test-app/repo/seed/books.csv': booksCsv,
      'test-app/repo/seed/members.csv': membersCsv,
      'test-app/repo/seed/loans.csv': loansCsv,
    });

    // No real FK enforcement in the mock — every call resolves. We assert ORDER.
    mockExecuteD1DDL.mockResolvedValue({ results: [] } as never);

    const result = await seedFromR2(
      buildOptions({
        r2,
        seedEntries: {
          books: { source: 'repo/seed/books.csv', source_hash: 'a', format: 'csv', model: 'books' },
          members: { source: 'repo/seed/members.csv', source_hash: 'b', format: 'csv', model: 'members' },
          loans: { source: 'repo/seed/loans.csv', source_hash: 'c', format: 'csv', model: 'loans' },
        },
        models: [
          { name: 'books', columns: [{ name: 'id' }, { name: 'title' }] },
          { name: 'members', columns: [{ name: 'id' }, { name: 'name' }] },
          { name: 'loans', columns: [
            { name: 'id' },
            { name: 'book_id', isNullable: false, references: { model: 'books' } },
            { name: 'member_id', isNullable: false, references: { model: 'members' } },
          ]},
        ],
      })
    );

    expect(result.seeded).toContain('loans');
    expect(result.errors).toHaveLength(0);

    const calls = mockExecuteD1DDL.mock.calls as unknown[][];

    // DELETE order: loans (child) before books/members (parents).
    const delLoans = idxOf(calls, 'DELETE FROM "loans"');
    const delBooks = idxOf(calls, 'DELETE FROM "books"');
    const delMembers = idxOf(calls, 'DELETE FROM "members"');
    expect(delLoans).toBeGreaterThanOrEqual(0);
    expect(delLoans).toBeLessThan(delBooks);
    expect(delLoans).toBeLessThan(delMembers);

    // INSERT order: books/members (parents) before loans (child).
    const insBooks = idxOf(calls, 'INSERT INTO "books"');
    const insMembers = idxOf(calls, 'INSERT INTO "members"');
    const insLoans = idxOf(calls, 'INSERT INTO "loans"');
    expect(insBooks).toBeLessThan(insLoans);
    expect(insMembers).toBeLessThan(insLoans);

    // The loans INSERT carries real FK values — no NULL, no deferred UPDATE.
    const loansInsert = calls[insLoans][2] as string;
    expect(loansInsert).not.toContain('NULL');
    const loansUpdate = calls.find(
      (c) => typeof c[2] === 'string' && (c[2] as string).includes('UPDATE "loans"')
    );
    expect(loansUpdate).toBeUndefined();
  });

  it('refuses to NULL a NOT NULL FK to an unseeded parent (surfaces error, no wipe)', async () => {
    // loans.book_id is NOT NULL → books, but books has no seed entry.
    const loansCsv = 'id,book_id\n1,1\n2,2';
    const r2 = createMockR2({ 'test-app/repo/seed/loans.csv': loansCsv });
    mockExecuteD1DDL.mockResolvedValue({ results: [] } as never);

    const result = await seedFromR2(
      buildOptions({
        r2,
        seedEntries: {
          loans: { source: 'repo/seed/loans.csv', source_hash: 'c', format: 'csv', model: 'loans' },
        },
        models: [
          { name: 'loans', columns: [
            { name: 'id' },
            { name: 'book_id', isNullable: false, references: { model: 'books' } },
          ]},
        ],
      })
    );

    expect(result.seeded).not.toContain('loans');
    expect(result.errors.some((e) => e.includes('book_id') && e.includes('NOT NULL'))).toBe(true);
    // No loans INSERT was emitted (would have failed the NOT NULL constraint).
    const loansInsert = mockExecuteD1DDL.mock.calls.find(
      (c) => typeof c[2] === 'string' && (c[2] as string).includes('INSERT INTO "loans"')
    );
    expect(loansInsert).toBeUndefined();
  });

  it('surfaces an error for a NOT NULL FK cycle instead of silently emptying tables', async () => {
    const deptCsv = 'id,name,manager_id\n1,Eng,10';
    const empCsv = 'id,name,department_id\n10,Alice,1';
    const r2 = createMockR2({
      'test-app/repo/seed/dept.csv': deptCsv,
      'test-app/repo/seed/emp.csv': empCsv,
    });
    mockExecuteD1DDL.mockResolvedValue({ results: [] } as never);

    const result = await seedFromR2(
      buildOptions({
        r2,
        seedEntries: {
          departments: { source: 'repo/seed/dept.csv', source_hash: 'a', format: 'csv', model: 'departments' },
          employees: { source: 'repo/seed/emp.csv', source_hash: 'b', format: 'csv', model: 'employees' },
        },
        models: [
          { name: 'departments', columns: [
            { name: 'id' }, { name: 'name' },
            { name: 'manager_id', isNullable: false, references: { model: 'employees' } },
          ]},
          { name: 'employees', columns: [
            { name: 'id' }, { name: 'name' },
            { name: 'department_id', isNullable: false, references: { model: 'departments' } },
          ]},
        ],
      })
    );

    // True unsatisfiable cycle → both guarded, nothing seeded, clear errors (no wipe-and-pray).
    expect(result.seeded).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    const noInserts = mockExecuteD1DDL.mock.calls.every(
      (c) => typeof c[2] !== 'string' || !(c[2] as string).startsWith('INSERT INTO "departments"')
    );
    expect(noInserts).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P-1 — published-mode seeding is strictly non-destructive (empty-guard).
// Published deploys only ever seed shared/reference models into an EMPTY
// table; they never DELETE live rows and never reseed a populated catalog.
// (deploy.ts restricts which models reach the seeder on publish; the seeder
// enforces the never-clobber invariant regardless of what it's handed.)
// ---------------------------------------------------------------------------

describe('published non-destructive empty-guard (P-1)', () => {
  it('published mode skips a NON-EMPTY table without DELETE or INSERT', async () => {
    const csv = 'name,price\nWidget,9.99';
    const r2 = createMockR2({ 'test-app/repo/seed/products_abc.csv': csv });

    // isTableEmpty → table already has rows.
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ count: 15 }] } as never);

    const result = await seedFromR2(
      buildOptions({
        r2,
        mode: 'published',
        seedEntries: {
          products: { source: 'repo/seed/products_abc.csv', source_hash: 'abc', format: 'csv', model: 'products' },
        },
      })
    );

    expect(result.skipped).toEqual(['products']);
    expect(result.seeded).toHaveLength(0);

    const allSql = mockExecuteD1DDL.mock.calls.map((c) => c[2] as string);
    // Never wipes live data and never inserts into a populated catalog.
    expect(allSql.some((s) => s.startsWith('DELETE FROM'))).toBe(false);
    expect(allSql.some((s) => s.includes('INSERT INTO'))).toBe(false);
    // Only the isTableEmpty probe ran.
    expect(mockExecuteD1DDL).toHaveBeenCalledTimes(1);
  });

  it('published mode seeds an EMPTY table WITHOUT issuing a DELETE', async () => {
    const csv = 'name,price\nWidget,9.99\nGadget,19.99';
    const r2 = createMockR2({ 'test-app/repo/seed/products_abc.csv': csv });

    // isTableEmpty → empty (first publish), then INSERT succeeds.
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [{ count: 0 }] } as never);
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never);

    const result = await seedFromR2(
      buildOptions({
        r2,
        mode: 'published',
        seedEntries: {
          products: { source: 'repo/seed/products_abc.csv', source_hash: 'abc', format: 'csv', model: 'products' },
        },
      })
    );

    expect(result.seeded).toEqual(['products']);
    expect(result.skipped).toHaveLength(0);

    const allSql = mockExecuteD1DDL.mock.calls.map((c) => c[2] as string);
    // Empty-guard path: populate the catalog, but still NEVER issue a DELETE.
    expect(allSql.some((s) => s.startsWith('DELETE FROM'))).toBe(false);
    const insert = allSql.find((s) => s.includes('INSERT INTO "products"'));
    expect(insert).toBeTruthy();
    expect(insert).toContain("'Widget'");
    expect(insert).toContain("'Gadget'");
  });

  it('preview mode still issues the owner-scoped DELETE (regression guard)', async () => {
    const csv = 'name\nAlice';
    const r2 = createMockR2({ 'test-app/repo/seed/products_abc.csv': csv });

    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never); // DELETE
    mockExecuteD1DDL.mockResolvedValueOnce({ results: [] } as never); // INSERT

    await seedFromR2(
      buildOptions({
        r2,
        mode: 'preview',
        seedEntries: {
          products: { source: 'repo/seed/products_abc.csv', source_hash: 'abc', format: 'csv', model: 'products' },
        },
      })
    );

    const allSql = mockExecuteD1DDL.mock.calls.map((c) => c[2] as string);
    // Preview behavior is unchanged: owner-scoped DELETE then INSERT.
    expect(allSql.some((s) => s.startsWith('DELETE FROM "products"'))).toBe(true);
    expect(allSql.some((s) => s.includes('INSERT INTO "products"'))).toBe(true);
  });
});
