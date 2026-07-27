/**
 * Tests for sysUpsert (sys_upsert) — INSERT ... ON CONFLICT(pk) DO UPDATE.
 *
 * sys_upsert targets models with a NATURAL primary key (a user column with
 * isPrimary, e.g. a `key`/`slug`/`sku`) — the auto `id` is a system column and
 * is rejected by create-level validation, so the caller must supply the natural
 * key inside `data`.
 *
 * The headline coverage is the OWNERSHIP GUARD on the conflict-update path
 * (regression for a real cross-tenant write bug): without it, any caller who
 * supplies an existing primary-key value silently overwrites another tenant's
 * row, because ON CONFLICT DO UPDATE ignores owner_id. The real-LocalD1 suite is
 * the definitive proof (the SQL actually executes against better-sqlite3); the
 * mock-D1 suite pins SQL construction and the null-row error disambiguation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { LocalD1 } from '@exepad/local-adapters/db';
import { generateCreateTableSQL, generateIndexSQL } from '@exepad/deploy-utils';
import { sysUpsert } from '../src/crud/upsert';
import { sysRead } from '../src/crud/read';
import { ValidationError, DatabaseError, ForbiddenError } from '../src/utils/errors';
import { createMockD1 } from './helpers/mock-d1';
import { TEST_USER, TEST_ADMIN } from './helpers/mock-env';
import type { ModelProps } from '../src/types/env';

// A second authenticated tenant, distinct from TEST_USER.
const USER_B = {
  id: 'user-999',
  email: 'mallory@example.com',
  roles: [] as string[],
  isAuthenticated: true,
};

// Natural-key model: `key` is the user-declared primary key (not the auto id).
const KV_MODEL: ModelProps = {
  uuid: 'kv-model',
  name: 'kv_entries',
  columns: [
    { name: 'key', type: 'text', isPrimary: true },
    { name: 'value', type: 'text' },
    { name: 'metadata', type: 'json', isNullable: true },
  ],
};

const KV_MODEL_SHARED: ModelProps = {
  ...KV_MODEL,
  uuid: 'kv-shared',
  name: 'kv_shared',
  ownerScope: 'shared',
};

function row(result: { data: unknown }): Record<string, unknown> {
  return result.data as Record<string, unknown>;
}

// ───────────────────────── real LocalD1 (better-sqlite3) ─────────────────────

describe('sysUpsert — ownership isolation (real LocalD1)', () => {
  let db: D1Database;

  beforeEach(() => {
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    for (const model of [KV_MODEL, KV_MODEL_SHARED]) {
      raw.exec(generateCreateTableSQL(model));
      for (const idx of generateIndexSQL(model)) raw.exec(idx);
    }
    db = new LocalD1(raw) as unknown as D1Database;
  });

  it('inserts a new row when the primary key is free', async () => {
    const res = await sysUpsert(
      KV_MODEL,
      { data: { key: 'theme', value: 'dark' } },
      TEST_USER,
      db,
    );
    expect(res.success).toBe(true);
    expect(row(res).key).toBe('theme');
    expect(row(res).value).toBe('dark');
    expect(row(res).owner_id).toBe(TEST_USER.id);
    expect(row(res).created_at).toBe(row(res).updated_at);
  });

  it('auto-fills a NOT NULL creation-date column the form omits (parity with sysCreate)', async () => {
    // Regression for the sibling-path gap: a NOT NULL "added_on" column whose
    // vocabulary is past-date seed tokens must not 400 the upsert-insert.
    const dated: ModelProps = {
      uuid: 'kv-dated',
      name: 'kv_dated',
      columns: [
        { name: 'key', type: 'text', isPrimary: true },
        { name: 'value', type: 'text' },
        {
          name: 'added_on',
          type: 'text',
          enumValues: ['__TODAY__-14d', '__TODAY__-30d'],
        },
      ],
    };
    const raw = new Database(':memory:');
    raw.exec(generateCreateTableSQL(dated));
    for (const idx of generateIndexSQL(dated)) raw.exec(idx);
    const local = new LocalD1(raw) as unknown as D1Database;

    const res = await sysUpsert(dated, { data: { key: 'k1', value: 'v1' } }, TEST_USER, local);

    expect(res.success).toBe(true);
    expect(row(res).added_on).toBe(new Date().toISOString().slice(0, 10));
  });

  it('updates the caller’s own row on conflict, preserving created_at', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
      const first = await sysUpsert(
        KV_MODEL,
        { data: { key: 'theme', value: 'dark' } },
        TEST_USER,
        db,
      );
      const createdAt = row(first).created_at;

      vi.setSystemTime(new Date('2024-02-02T00:00:00.000Z'));
      const second = await sysUpsert(
        KV_MODEL,
        { data: { key: 'theme', value: 'light' } },
        TEST_USER,
        db,
      );

      expect(second.success).toBe(true);
      expect(row(second).value).toBe('light');
      expect(row(second).created_at).toBe(createdAt); // preserved
      expect(row(second).updated_at).toBe('2024-02-02T00:00:00.000Z'); // bumped
      expect(row(second).owner_id).toBe(TEST_USER.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it('BLOCKS a different tenant from overwriting an existing row (cross-tenant write)', async () => {
    // Tenant A owns key='theme'.
    await sysUpsert(
      KV_MODEL,
      { data: { key: 'theme', value: 'A-dark' } },
      TEST_USER,
      db,
    );

    // Tenant B tries to clobber it by supplying the same primary key.
    await expect(
      sysUpsert(
        KV_MODEL,
        { data: { key: 'theme', value: 'B-HACKED' } },
        USER_B,
        db,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // A's row must be intact: value and owner unchanged.
    const read = await sysRead(KV_MODEL, { id: 'theme' }, TEST_USER, db);
    expect(row(read).value).toBe('A-dark');
    expect(row(read).owner_id).toBe(TEST_USER.id);
  });

  it('lets a brand-new tenant insert a row under a different, free primary key', async () => {
    await sysUpsert(KV_MODEL, { data: { key: 'theme', value: 'A' } }, TEST_USER, db);
    const res = await sysUpsert(
      KV_MODEL,
      { data: { key: 'locale', value: 'B' } },
      USER_B,
      db,
    );
    expect(res.success).toBe(true);
    expect(row(res).owner_id).toBe(USER_B.id);
  });

  it('round-trips JSON columns on both insert and conflict-update', async () => {
    const inserted = await sysUpsert(
      KV_MODEL,
      { data: { key: 'theme', value: 'dark', metadata: { tier: 'gold' } } },
      TEST_USER,
      db,
    );
    expect(row(inserted).metadata).toEqual({ tier: 'gold' });

    const updated = await sysUpsert(
      KV_MODEL,
      { data: { key: 'theme', value: 'dark', metadata: { tier: 'platinum', n: 2 } } },
      TEST_USER,
      db,
    );
    expect(row(updated).metadata).toEqual({ tier: 'platinum', n: 2 });
  });

  it('rejects an upsert missing a required field with ValidationError', async () => {
    await expect(
      sysUpsert(KV_MODEL, { data: { key: 'theme' } }, TEST_USER, db),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  describe('shared owner scope', () => {
    it('lets the owner update their own shared row', async () => {
      await sysUpsert(KV_MODEL_SHARED, { data: { key: 'k', value: 'v1' } }, TEST_USER, db);
      const res = await sysUpsert(
        KV_MODEL_SHARED,
        { data: { key: 'k', value: 'v2' } },
        TEST_USER,
        db,
      );
      expect(res.success).toBe(true);
      expect(row(res).value).toBe('v2');
    });

    it('blocks a non-owner non-admin from overwriting a shared row', async () => {
      await sysUpsert(KV_MODEL_SHARED, { data: { key: 'k', value: 'owned' } }, TEST_USER, db);
      await expect(
        sysUpsert(KV_MODEL_SHARED, { data: { key: 'k', value: 'HACK' } }, USER_B, db),
      ).rejects.toBeInstanceOf(ForbiddenError);

      const read = await sysRead(KV_MODEL_SHARED, { id: 'k' }, TEST_USER, db);
      expect(row(read).value).toBe('owned');
    });

    it('lets an admin update any shared row, preserving the original owner', async () => {
      await sysUpsert(KV_MODEL_SHARED, { data: { key: 'k', value: 'owned' } }, TEST_USER, db);
      const res = await sysUpsert(
        KV_MODEL_SHARED,
        { data: { key: 'k', value: 'admin-edit' } },
        TEST_ADMIN,
        db,
      );
      expect(res.success).toBe(true);
      expect(row(res).value).toBe('admin-edit');
      expect(row(res).owner_id).toBe(TEST_USER.id); // ownership NOT transferred to admin
    });
  });
});

// ───────────────────────── mock D1 (SQL construction + error mapping) ─────────

describe('sysUpsert — SQL construction & error disambiguation (mock D1)', () => {
  const validData = { key: 'theme', value: 'dark' };

  function onConflictSegment(db: ReturnType<typeof createMockD1>): string {
    const q = db._queries.find((q) => q.sql.includes('ON CONFLICT'));
    expect(q).toBeDefined();
    return q!.sql.slice(q!.sql.indexOf('ON CONFLICT'));
  }

  it('emits an ownership guard (WHERE owner_id) on the conflict-update for user scope', async () => {
    const db = createMockD1({
      results: new Map([['INSERT', [{ ...validData, owner_id: TEST_USER.id }]]]),
    });
    await sysUpsert(KV_MODEL, { data: validData }, TEST_USER, db);
    const seg = onConflictSegment(db);
    expect(seg).toMatch(/DO UPDATE SET/i);
    expect(seg).toMatch(/WHERE/i);
    expect(seg).toMatch(/owner_id/);
  });

  it('omits the ownership guard for admins on shared-scope models', async () => {
    const db = createMockD1({
      results: new Map([['INSERT', [{ ...validData, owner_id: TEST_USER.id }]]]),
    });
    await sysUpsert(KV_MODEL_SHARED, { data: validData }, TEST_ADMIN, db);
    const seg = onConflictSegment(db);
    expect(seg).toMatch(/DO UPDATE SET/i);
    expect(seg).not.toMatch(/WHERE/i); // admin override → no ownership restriction
  });

  it('keeps the ownership guard for non-admins on shared-scope models', async () => {
    const db = createMockD1({
      results: new Map([['INSERT', [{ ...validData, owner_id: TEST_USER.id }]]]),
    });
    await sysUpsert(KV_MODEL_SHARED, { data: validData }, TEST_USER, db);
    expect(onConflictSegment(db)).toMatch(/WHERE/i);
  });

  it('maps a blocked conflict-update (existing row owned by another tenant) to ForbiddenError', async () => {
    // Upsert RETURNING yields nothing (guard suppressed the update); the
    // follow-up existence probe finds a row owned by someone else.
    const db = createMockD1({
      results: new Map([
        ['INSERT', []], // ON CONFLICT ... RETURNING * → no row
        ['SELECT owner_id', [{ owner_id: 'someone-else' }]],
      ]),
    });
    await expect(
      sysUpsert(KV_MODEL, { data: validData }, TEST_USER, db),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('maps a genuine no-row failure (no conflicting row) to DatabaseError, not ForbiddenError', async () => {
    const db = createMockD1({
      results: new Map([
        ['INSERT', []], // no row written
        ['SELECT owner_id', []], // ...and nothing exists under that PK
      ]),
    });
    await expect(
      sysUpsert(KV_MODEL, { data: validData }, TEST_USER, db),
    ).rejects.toBeInstanceOf(DatabaseError);
  });
});
