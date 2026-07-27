// @vitest-environment node
/**
 * meta-db.ts — keyset pagination over an owner's apps, exercised against a REAL
 * temp meta.sqlite.
 *
 * `listAppsAccessibleBy({limit, afterUpdatedAt, afterId, status})` is not a pure
 * function — it is SQL that has to be right against actual sqlite semantics:
 * keyset pagination over the owner's apps, ordered `updated_at DESC, id DESC`. We
 * assert STABLE ordering, NO overlap and NO gap across page boundaries (the whole
 * point of keyset over offset), correct tie-break when many rows share the same
 * `updated_at` millisecond, and that the cursor lands exactly on the boundary row.
 *
 * Harness: a real mkdtemp meta.sqlite pointed at via EXEPAD_META_DB, migrated on
 * first `getMetaDb()`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getMetaDb,
  createUser,
  createApp,
  touchApp,
  listAppsAccessibleBy,
  type MetaApp,
} from '../../../../worker/src/lib/meta-db';
import { hashPassword } from '../../../../worker/src/lib/password';

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-meta-db-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
  process.env.EXEPAD_META_DB = join(dataDir, 'meta.sqlite');
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

let userSeq = 0;
async function makeUser() {
  return createUser(
    `meta-${userSeq++}-${Math.random().toString(36).slice(2)}@x.com`,
    await hashPassword('pw-secret-123'),
  );
}

/**
 * Stamp an app's updated_at directly so pagination tests have a deterministic
 * total order. createApp/touchApp use millisecond-precision nowIso(), which is
 * exactly when ties occur in production — but a test needs control to assert the
 * tie-break path precisely. We also keep `slug` unique (the apps.slug UNIQUE
 * constraint) by leaving createApp's generated slug untouched.
 */
function setUpdatedAt(appId: string, iso: string): void {
  getMetaDb().prepare('UPDATE apps SET updated_at = ? WHERE id = ?').run(iso, appId);
}

/** Newest-first list of ids — the order listAppsAccessibleBy must reproduce. */
function ids(apps: MetaApp[]): string[] {
  return apps.map((a) => a.id);
}

// ─── Keyset pagination ───────────────────────────────────────────────────────

describe('listAppsAccessibleBy — backward-compatible full list', () => {
  it('returns owned apps newest-first with no opts', async () => {
    const owner = await makeUser();
    const a = createApp(owner.id, 'first');
    const b = createApp(owner.id, 'second');
    const c = createApp(owner.id, 'third');
    setUpdatedAt(a.id, '2026-01-01T00:00:00.000Z');
    setUpdatedAt(b.id, '2026-01-02T00:00:00.000Z');
    setUpdatedAt(c.id, '2026-01-03T00:00:00.000Z');

    const list = listAppsAccessibleBy(owner.id);
    expect(ids(list)).toEqual([c.id, b.id, a.id]); // updated_at DESC
  });

  it('isolates apps by owner — a stranger sees none of them', async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const a = createApp(owner.id, 'owner-a');
    const b = createApp(owner.id, 'owner-b');

    const ownerList = ids(listAppsAccessibleBy(owner.id));
    expect(ownerList).toEqual(expect.arrayContaining([a.id, b.id]));
    // A different operator sees neither of the owner's apps.
    const strangerList = ids(listAppsAccessibleBy(stranger.id));
    expect(strangerList).not.toContain(a.id);
    expect(strangerList).not.toContain(b.id);
  });
});

describe('listAppsAccessibleBy — keyset pagination', () => {
  /** Seed N owned apps with strictly-increasing updated_at; returns ids newest-first. */
  async function seedDistinct(n: number) {
    const owner = await makeUser();
    const created: MetaApp[] = [];
    for (let i = 0; i < n; i++) {
      const app = createApp(owner.id, `app-${i}`);
      // i=0 oldest … i=n-1 newest; pad to keep a fixed lexical width.
      setUpdatedAt(app.id, `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`);
      created.push(app);
    }
    const expected = [...created].reverse().map((a) => a.id); // newest-first
    return { owner, expected };
  }

  it('walks every row exactly once across pages — no overlap, no gap', async () => {
    const { owner, expected } = await seedDistinct(10);

    const pageSize = 3;
    const seen: string[] = [];
    let afterUpdatedAt: string | undefined;
    let afterId: string | undefined;
    // Bound the loop so a pagination bug can't spin forever.
    for (let guard = 0; guard < 20; guard++) {
      const page = listAppsAccessibleBy(owner.id, {
        limit: pageSize,
        afterUpdatedAt,
        afterId,
      });
      if (page.length === 0) break;
      seen.push(...ids(page));
      const last = page[page.length - 1];
      afterUpdatedAt = last.updated_at;
      afterId = last.id;
      if (page.length < pageSize) break;
    }

    expect(seen).toEqual(expected); // exact order, every id once
    expect(new Set(seen).size).toBe(expected.length); // no duplicates across pages
  });

  it('keeps a stable total order under updated_at ties (tie-break on id DESC)', async () => {
    const owner = await makeUser();
    const created: MetaApp[] = [];
    for (let i = 0; i < 6; i++) created.push(createApp(owner.id, `tie-${i}`));
    // Force ALL rows onto the same millisecond — the worst case for keyset.
    const SAME = '2026-03-01T12:00:00.000Z';
    for (const a of created) setUpdatedAt(a.id, SAME);

    const full = listAppsAccessibleBy(owner.id);
    const fullIds = ids(full);
    // With equal updated_at, the secondary sort is id DESC.
    const expected = created.map((a) => a.id).sort().reverse();
    expect(fullIds.filter((id) => expected.includes(id))).toEqual(expected);

    // Paginate through the all-ties set: must reproduce `full` with no overlap.
    const seen: string[] = [];
    let afterUpdatedAt: string | undefined;
    let afterId: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const page = listAppsAccessibleBy(owner.id, { limit: 2, afterUpdatedAt, afterId });
      if (page.length === 0) break;
      seen.push(...ids(page));
      const last = page[page.length - 1];
      afterUpdatedAt = last.updated_at;
      afterId = last.id;
      if (page.length < 2) break;
    }
    expect(seen).toEqual(expected); // identical, tie-broken order; no row repeated
  });

  it('cursor lands exactly on the boundary row (strictly after, exclusive)', async () => {
    const { owner, expected } = await seedDistinct(5);
    const firstPage = listAppsAccessibleBy(owner.id, { limit: 2 });
    expect(ids(firstPage)).toEqual(expected.slice(0, 2));

    // Cursor at the 2nd row → next page starts at the 3rd (boundary row excluded).
    const boundary = firstPage[firstPage.length - 1];
    const nextPage = listAppsAccessibleBy(owner.id, {
      limit: 2,
      afterUpdatedAt: boundary.updated_at,
      afterId: boundary.id,
    });
    expect(ids(nextPage)).toEqual(expected.slice(2, 4));
    // The boundary row itself must NOT reappear.
    expect(ids(nextPage)).not.toContain(boundary.id);
  });

  it('honours limit and treats limit<=0 as "no limit"', async () => {
    const { owner, expected } = await seedDistinct(4);
    expect(listAppsAccessibleBy(owner.id, { limit: 1 })).toHaveLength(1);
    // limit:0 falls through the `opts.limit > 0` guard → full list.
    expect(ids(listAppsAccessibleBy(owner.id, { limit: 0 }))).toEqual(expected);
  });

  it('requires BOTH cursor halves — a half cursor is ignored, not a partial filter', async () => {
    const { owner, expected } = await seedDistinct(4);
    // Only afterUpdatedAt (no afterId): the `&&` guard skips the cursor clause.
    const onlyTs = listAppsAccessibleBy(owner.id, { afterUpdatedAt: '2026-02-02T00:00:00.000Z' });
    expect(ids(onlyTs)).toEqual(expected); // full list, unfiltered
    const onlyId = listAppsAccessibleBy(owner.id, { afterId: expected[0] });
    expect(ids(onlyId)).toEqual(expected);
  });

  it('applies a status filter and combines it with the keyset cursor', async () => {
    const owner = await makeUser();
    const draft1 = createApp(owner.id, 'd1');
    const pub1 = createApp(owner.id, 'p1');
    const draft2 = createApp(owner.id, 'd2');
    const pub2 = createApp(owner.id, 'p2');
    setUpdatedAt(draft1.id, '2026-04-01T00:00:00.000Z');
    setUpdatedAt(pub1.id, '2026-04-02T00:00:00.000Z');
    setUpdatedAt(draft2.id, '2026-04-03T00:00:00.000Z');
    setUpdatedAt(pub2.id, '2026-04-04T00:00:00.000Z');
    touchApp(pub1.id, { status: 'published' });
    touchApp(pub2.id, { status: 'published' });
    // touchApp bumps updated_at, so re-pin the order after the status change.
    setUpdatedAt(pub1.id, '2026-04-02T00:00:00.000Z');
    setUpdatedAt(pub2.id, '2026-04-04T00:00:00.000Z');

    const published = listAppsAccessibleBy(owner.id, { status: ['published'] });
    expect(ids(published)).toEqual([pub2.id, pub1.id]);
    expect(ids(published)).not.toContain(draft1.id);

    // status filter + cursor: page after the newest published row (pub2) must
    // return only the older published row (pub1) — the draft rows stay excluded.
    const afterPub2 = listAppsAccessibleBy(owner.id, {
      status: ['published'],
      afterUpdatedAt: '2026-04-04T00:00:00.000Z',
      afterId: pub2.id,
    });
    expect(ids(afterPub2)).toEqual([pub1.id]);
  });

  it('an empty status array degrades to "no status filter"', async () => {
    const { owner, expected } = await seedDistinct(3);
    expect(ids(listAppsAccessibleBy(owner.id, { status: [] }))).toEqual(expected);
  });

  it('returns [] for an owner with no apps', async () => {
    const owner = await makeUser();
    expect(listAppsAccessibleBy(owner.id)).toEqual([]);
    expect(listAppsAccessibleBy(owner.id, { limit: 5 })).toEqual([]);
  });
});

// ─── Concurrent app creation feeding pagination ──────────────────────────────

describe('concurrent createApp + pagination consistency', () => {
  it('many apps created in one tick all appear, each exactly once, no lost rows', async () => {
    const owner = await makeUser();
    // Create a burst "concurrently": createApp generates unique ids + slugs, so
    // the apps.slug UNIQUE constraint must not collide and none may be dropped.
    const created = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        Promise.resolve().then(() => createApp(owner.id, `burst-${i}`)),
      ),
    );
    const createdIds = new Set(created.map((a) => a.id));
    expect(createdIds.size).toBe(30); // all ids distinct (no generateAppId collision)

    // Page through with keyset; the seen set must equal the created set exactly.
    const seen: string[] = [];
    let afterUpdatedAt: string | undefined;
    let afterId: string | undefined;
    for (let guard = 0; guard < 40; guard++) {
      const page = listAppsAccessibleBy(owner.id, { limit: 7, afterUpdatedAt, afterId });
      if (page.length === 0) break;
      seen.push(...ids(page));
      const last = page[page.length - 1];
      afterUpdatedAt = last.updated_at;
      afterId = last.id;
      if (page.length < 7) break;
    }
    expect(new Set(seen)).toEqual(createdIds); // no lost or duplicated row
    expect(seen).toHaveLength(30);
  });
});
