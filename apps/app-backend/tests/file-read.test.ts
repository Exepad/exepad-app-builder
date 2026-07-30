/**
 * Tests for file metadata RPC methods (sys_file_read, sys_file_list, sys_file_delete)
 */

import { describe, it, expect } from 'vitest';
import { sysFileRead, sysFileList, sysFileDelete } from '../src/file/read';
import { createMockD1, getExecutedQueries } from './helpers/mock-d1';
import { WorkerError, NotFoundError, UnauthorizedError, ForbiddenError } from '../src/utils/errors';
import type { InjectedProps } from '@exepad/types';
import type { UserContext } from '../src/rpc/types';

// ── Fixtures ──

const authUser: UserContext = {
  id: 'user-123',
  email: 'user@test.com',
  roles: [],
  isAuthenticated: true,
  authMethod: 'platform_header',
};

const adminUser: UserContext = {
  id: 'admin-1',
  email: 'admin@test.com',
  roles: ['admin'],
  isAuthenticated: true,
  authMethod: 'platform_header',
};

const anonUser: UserContext = {
  id: '',
  email: '',
  roles: [],
  isAuthenticated: false,
  authMethod: 'platform_header',
};

const config: InjectedProps = {
  models: [],
  handlers: [],
  storage: { enabled: true },
};

const APP_ID = 'test-app';

/** Minimal R2 stub that records deleted keys, for the hard-purge assertions. */
function createMockR2() {
  const deleted: string[] = [];
  return {
    deleted,
    delete: async (key: string) => {
      deleted.push(key);
    },
  };
}

/** Wrap a mock D1 (and optional R2) as the Env shape sysFileDelete expects. */
function envOf(db: unknown, r2?: unknown): any {
  return { DB: db, R2_FILES: r2 };
}

const FILE_ROW = {
  id: 'file-abc',
  owner_id: 'user-123',
  app_id: APP_ID,
  filename: 'photo.jpg',
  content_type: 'image/jpeg',
  size_bytes: 5000,
  r2_key: `${APP_ID}/user-123/file-abc/photo.jpg`,
  visibility: 'private',
  model_name: null,
  record_id: null,
  field_name: null,
  metadata: null,
  thumbnail_r2_key: null,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
  deleted_at: null,
};

// ───────────────────────────────────────────────────────────────────
// sysFileRead
// ───────────────────────────────────────────────────────────────────
describe('sysFileRead', () => {
  it('returns file metadata for owner', async () => {
    const db = createMockD1({ defaultResult: [FILE_ROW] });
    const result = await sysFileRead({ id: 'file-abc' }, authUser, db, config, APP_ID);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      id: 'file-abc',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      size: 5000,
      visibility: 'private',
    });
    // Should include url
    expect((result.data as any).url).toContain('_files/file-abc');
    // Should NOT expose r2_key
    expect((result.data as any).r2_key).toBeUndefined();
  });

  it('throws WorkerError when id is missing', async () => {
    const db = createMockD1();
    await expect(sysFileRead({}, authUser, db, config, APP_ID)).rejects.toThrow(WorkerError);
    await expect(sysFileRead(undefined, authUser, db, config, APP_ID)).rejects.toThrow(WorkerError);
  });

  it('throws NotFoundError when file does not exist', async () => {
    const db = createMockD1({ firstReturnsNull: true });
    await expect(sysFileRead({ id: 'nonexistent' }, authUser, db, config, APP_ID)).rejects.toThrow(NotFoundError);
  });

  it('throws UnauthorizedError for unauthenticated user', async () => {
    const db = createMockD1({ defaultResult: [FILE_ROW] });
    await expect(sysFileRead({ id: 'file-abc' }, anonUser, db, config, APP_ID)).rejects.toThrow(UnauthorizedError);
  });

  it('parses JSON metadata when present', async () => {
    const fileWithMeta = { ...FILE_ROW, metadata: '{"key":"value"}' };
    const db = createMockD1({ defaultResult: [fileWithMeta] });
    const result = await sysFileRead({ id: 'file-abc' }, authUser, db, config, APP_ID);

    expect((result.data as any).metadata).toEqual({ key: 'value' });
  });

  it('returns raw string for invalid JSON metadata', async () => {
    const fileWithBadMeta = { ...FILE_ROW, metadata: 'not json' };
    const db = createMockD1({ defaultResult: [fileWithBadMeta] });
    const result = await sysFileRead({ id: 'file-abc' }, authUser, db, config, APP_ID);

    expect((result.data as any).metadata).toBe('not json');
  });
});

// ───────────────────────────────────────────────────────────────────
// sysFileList
// ───────────────────────────────────────────────────────────────────
describe('sysFileList', () => {
  it('returns paginated file list', async () => {
    const results = new Map<string, Record<string, unknown>[]>();
    results.set('COUNT', [{ total: 2 }]);
    results.set('SELECT id', [FILE_ROW, { ...FILE_ROW, id: 'file-def', filename: 'doc.pdf' }]);
    const db = createMockD1({ results });

    const result = await sysFileList({}, authUser, db, config, APP_ID);

    expect(result.success).toBe(true);
    expect(result.pagination).toBeDefined();
    expect(result.pagination!.total).toBe(2);
    expect(result.pagination!.limit).toBe(50);
    expect(result.pagination!.offset).toBe(0);
  });

  it('clamps limit to 1-100 range', async () => {
    const db = createMockD1({ defaultResult: [] });

    // limit=0 → clamped to 1
    await sysFileList({ limit: 0 }, authUser, db, config, APP_ID);
    const queries = getExecutedQueries(db);
    const lastQuery = queries[queries.length - 1];
    expect(lastQuery.binds).toContain(1); // limit clamped to 1

    // limit=999 → clamped to 100
    const db2 = createMockD1({ defaultResult: [] });
    await sysFileList({ limit: 999 }, authUser, db2, config, APP_ID);
    const queries2 = getExecutedQueries(db2);
    const lastQuery2 = queries2[queries2.length - 1];
    expect(lastQuery2.binds).toContain(100); // limit clamped to 100
  });

  it('clamps offset to non-negative', async () => {
    const db = createMockD1({ defaultResult: [] });
    await sysFileList({ offset: -5 }, authUser, db, config, APP_ID);
    const queries = getExecutedQueries(db);
    const lastQuery = queries[queries.length - 1];
    expect(lastQuery.binds).toContain(0); // offset clamped to 0
  });

  it('adds owner scoping for non-admin users', async () => {
    const db = createMockD1({ defaultResult: [] });
    await sysFileList({}, authUser, db, config, APP_ID);

    const queries = getExecutedQueries(db);
    const selectQuery = queries.find((q) => q.sql.includes('SELECT') && q.sql.includes('LIMIT'));
    // WHERE clause should include owner_id condition
    expect(selectQuery?.sql).toContain('owner_id = ?');
    expect(selectQuery?.binds).toContain('user-123');
  });

  it('skips owner scoping for admin users', async () => {
    const db = createMockD1({ defaultResult: [] });
    await sysFileList({}, adminUser, db, config, APP_ID);

    const queries = getExecutedQueries(db);
    const selectQuery = queries.find((q) => q.sql.includes('SELECT') && q.sql.includes('LIMIT'));
    // WHERE clause should NOT have owner_id filtering condition
    expect(selectQuery?.sql).not.toContain('owner_id = ?');
  });

  it('applies model_name filter', async () => {
    const db = createMockD1({ defaultResult: [] });
    await sysFileList({ model_name: 'products' }, authUser, db, config, APP_ID);

    const queries = getExecutedQueries(db);
    const selectQuery = queries.find((q) => q.sql.includes('model_name'));
    expect(selectQuery).toBeDefined();
    expect(selectQuery?.binds).toContain('products');
  });

  it('applies record_id filter', async () => {
    const db = createMockD1({ defaultResult: [] });
    await sysFileList({ record_id: 'record-1' }, authUser, db, config, APP_ID);

    const queries = getExecutedQueries(db);
    const selectQuery = queries.find((q) => q.sql.includes('record_id'));
    expect(selectQuery?.binds).toContain('record-1');
  });

  it('rejects unauthenticated user', async () => {
    const db = createMockD1();
    await expect(sysFileList({}, anonUser, db, config, APP_ID)).rejects.toThrow(UnauthorizedError);
  });
});

// ───────────────────────────────────────────────────────────────────
// sysFileList — visibility scoping (private-metadata leak hardening)
//
// A non-admin must NEVER receive another user's PRIVATE file via list.
// Regression: the old owner-scope clause was skipped entirely for anonymous
// callers (under public access) and for owner_only=false, leaking every file's
// metadata (ids, filenames, URLs) including private ones.
// ───────────────────────────────────────────────────────────────────
describe('sysFileList — visibility scoping', () => {
  const publicConfig: InjectedProps = {
    models: [],
    handlers: [],
    storage: { enabled: true, publicAccess: true },
  };

  const listSql = (db: ReturnType<typeof createMockD1>) =>
    getExecutedQueries(db).find((q) => q.sql.includes('SELECT') && q.sql.includes('LIMIT'));

  it('default (owner_only) lists strictly the caller’s own files', async () => {
    const db = createMockD1({ defaultResult: [] });
    await sysFileList({}, authUser, db, config, APP_ID);
    const q = listSql(db);
    expect(q?.sql).toContain('owner_id = ?');
    expect(q?.binds).toContain('user-123');
    // Strict own — does not pull in other users' shared/public files by default.
    expect(q?.sql).not.toContain('visibility IN');
  });

  it('owner_only=false widens to own + shared/public, never others’ private', async () => {
    const db = createMockD1({ defaultResult: [] });
    await sysFileList({ owner_only: false }, authUser, db, config, APP_ID);
    const q = listSql(db);
    // Must keep the owner clause AND only broaden to shared/public.
    expect(q?.sql).toContain('owner_id = ?');
    expect(q?.binds).toContain('user-123');
    expect(q?.sql).toContain("visibility IN ('shared', 'public')");
  });

  it('anonymous listing under publicAccess excludes private files', async () => {
    const db = createMockD1({ defaultResult: [] });
    await sysFileList({}, anonUser, db, publicConfig, APP_ID);
    const q = listSql(db);
    // Anon has no identity to match on — the listing is restricted to non-private.
    expect(q?.sql).toContain("visibility IN ('shared', 'public')");
    expect(q?.sql).not.toContain('owner_id = ?');
  });

  it('anonymous listing under list:public excludes private files', async () => {
    const listPublicConfig: InjectedProps = {
      models: [],
      handlers: [],
      storage: { enabled: true, filePolicy: { list: 'public' } },
    };
    const db = createMockD1({ defaultResult: [] });
    await sysFileList({}, anonUser, db, listPublicConfig, APP_ID);
    const q = listSql(db);
    expect(q?.sql).toContain("visibility IN ('shared', 'public')");
  });

  it('admin listing is unscoped (sees all files)', async () => {
    const db = createMockD1({ defaultResult: [] });
    await sysFileList({ owner_only: false }, adminUser, db, config, APP_ID);
    const q = listSql(db);
    expect(q?.sql).not.toContain('owner_id = ?');
    expect(q?.sql).not.toContain('visibility IN');
  });
});

// ───────────────────────────────────────────────────────────────────
// sysFileDelete
// ───────────────────────────────────────────────────────────────────
describe('sysFileDelete', () => {
  it('soft-deletes a file owned by the user and purges its storage bytes', async () => {
    const db = createMockD1({ defaultResult: [FILE_ROW] });
    const r2 = createMockR2();
    const result = await sysFileDelete({ id: 'file-abc' }, authUser, envOf(db, r2), config, APP_ID);

    expect(result.success).toBe(true);
    expect((result.data as any).id).toBe('file-abc');
    expect((result.data as any).deleted).toBe(true);

    // Verify UPDATE query was executed
    const queries = getExecutedQueries(db);
    const updateQuery = queries.find((q) => q.sql.includes('UPDATE _files SET deleted_at'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery?.binds).toContain('file-abc');

    // The backing object must be hard-deleted so real disk is reclaimed
    // (quota counts only live rows, so leaving bytes enables a delete/re-upload
    // storage-exhaustion loop).
    expect(r2.deleted).toContain(FILE_ROW.r2_key);
  });

  it('also purges the thumbnail object when present', async () => {
    const withThumb = { ...FILE_ROW, thumbnail_r2_key: `${APP_ID}/user-123/file-abc/thumb.jpg` };
    const db = createMockD1({ defaultResult: [withThumb] });
    const r2 = createMockR2();
    await sysFileDelete({ id: 'file-abc' }, authUser, envOf(db, r2), config, APP_ID);
    expect(r2.deleted).toContain(withThumb.r2_key);
    expect(r2.deleted).toContain(withThumb.thumbnail_r2_key);
  });

  it('still soft-deletes the row when R2 binding is absent', async () => {
    const db = createMockD1({ defaultResult: [FILE_ROW] });
    const result = await sysFileDelete({ id: 'file-abc' }, authUser, envOf(db), config, APP_ID);
    expect(result.success).toBe(true);
    const ran = getExecutedQueries(db).some((q) => q.sql.includes('UPDATE _files SET deleted_at'));
    expect(ran).toBe(true);
  });

  it('throws WorkerError when id is missing', async () => {
    const db = createMockD1();
    await expect(sysFileDelete({}, authUser, envOf(db), config, APP_ID)).rejects.toThrow(WorkerError);
  });

  it('throws NotFoundError when file does not exist', async () => {
    const db = createMockD1({ firstReturnsNull: true });
    await expect(sysFileDelete({ id: 'nope' }, authUser, envOf(db), config, APP_ID)).rejects.toThrow(NotFoundError);
  });

  it('throws UnauthorizedError for unauthenticated user', async () => {
    const db = createMockD1();
    await expect(sysFileDelete({ id: 'file-abc' }, anonUser, envOf(db), config, APP_ID)).rejects.toThrow(UnauthorizedError);
  });

  it('denies an authenticated non-owner from deleting a SHARED file', async () => {
    // Regression: 'shared' grants read to other users, never delete.
    const sharedFile = { ...FILE_ROW, owner_id: 'user-123', visibility: 'shared' };
    const otherUser: UserContext = { ...authUser, id: 'other-user' };
    const db = createMockD1({ defaultResult: [sharedFile] });
    const r2 = createMockR2();
    await expect(sysFileDelete({ id: 'file-abc' }, otherUser, envOf(db, r2), config, APP_ID)).rejects.toThrow(ForbiddenError);
    // And no soft-delete UPDATE should have run, and no bytes purged.
    const ran = getExecutedQueries(db).some((q) => q.sql.includes('UPDATE _files SET deleted_at'));
    expect(ran).toBe(false);
    expect(r2.deleted).toHaveLength(0);
  });

  it('SELECT query filters by app_id and deleted_at IS NULL', async () => {
    const db = createMockD1({ defaultResult: [FILE_ROW] });
    await sysFileDelete({ id: 'file-abc' }, authUser, envOf(db), config, APP_ID);

    const queries = getExecutedQueries(db);
    const selectQuery = queries.find((q) => q.sql.includes('SELECT') && q.sql.includes('_files'));
    expect(selectQuery?.sql).toContain('app_id = ?');
    expect(selectQuery?.sql).toContain('deleted_at IS NULL');
    expect(selectQuery?.binds).toContain(APP_ID);
  });
});
