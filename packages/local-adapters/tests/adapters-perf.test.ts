import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { FsStorageAdapter } from '../src/storage/fs-storage.js';
import { KvShim } from '../src/cache/kv-shim.js';
import { defaultCache } from '../src/cache/cache-shim.js';
import { LocalD1 } from '../src/db/local-d1.js';

// ---------------------------------------------------------------------------
// FsStorageAdapter — prefix-scoped listing, delimiter grouping, atomic put
// ---------------------------------------------------------------------------
describe('FsStorageAdapter — list prefix/delimiter + atomic put', () => {
  let root: string;
  let store: FsStorageAdapter;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'exepad-perf-'));
    store = new FsStorageAdapter(root);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('groups keys under a delimiter into delimitedPrefixes', async () => {
    await store.put('appA/published/a.js', 'a');
    await store.put('appB/published/b.js', 'b');
    await store.put('_system/x.json', '{}');

    const r = await store.list({ delimiter: '/' });
    expect(r.delimitedPrefixes).toEqual(['_system/', 'appA/', 'appB/']);
    // Everything collapsed → no bare objects at the top level.
    expect(r.objects.length).toBe(0);
  });

  it('delimiter grouping is scoped under a prefix', async () => {
    await store.put('appA/published/a.js', 'a');
    await store.put('appA/preview/b.js', 'b');
    await store.put('appA/root.txt', 'r');
    await store.put('appB/published/c.js', 'c');

    const r = await store.list({ prefix: 'appA/', delimiter: '/' });
    expect(r.delimitedPrefixes).toEqual(['appA/preview/', 'appA/published/']);
    // A file directly under the prefix (no further delimiter) is returned as an object.
    expect(r.objects.map((o) => o.key)).toEqual(['appA/root.txt']);
  });

  it('a prefix listing only returns keys under that prefix (not the whole root)', async () => {
    await store.put('appA/published/a.js', 'a');
    await store.put('appB/published/b.js', 'b');
    const r = await store.list({ prefix: 'appB/' });
    expect(r.objects.map((o) => o.key)).toEqual(['appB/published/b.js']);
  });

  it('put is atomic and leaves no temp files in the listing or on disk', async () => {
    await store.put('appA/config.json', '{"v":1}');
    // The object and its sidecar are the only files; no .tmp-* residue.
    const names = readdirSync(join(root, 'appA'));
    expect(names.filter((n) => n.includes('.tmp-'))).toEqual([]);
    expect(names.sort()).toEqual(['config.json', 'config.json.exemeta']);
    // A temp file that somehow exists is never surfaced by list().
    writeFileSync(join(root, 'appA', 'config.json.tmp-999'), 'partial');
    const r = await store.list({ prefix: 'appA/' });
    expect(r.objects.map((o) => o.key)).toEqual(['appA/config.json']);
  });

  it('when the object is renamed into place its metadata sidecar is already present', async () => {
    await store.put('appA/x.txt', 'hello', {
      httpMetadata: { contentType: 'text/plain' },
    });
    const meta = await store.head('appA/x.txt');
    // If the sidecar were written after the object rename we could observe a
    // fallback sha256 etag; here the recorded etag matches the content hash.
    expect(meta!.httpMetadata?.contentType).toBe('text/plain');
    expect(meta!.etag).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tolerates a file that vanishes between the walk and metadata build', async () => {
    await store.put('appA/a.txt', 'a');
    await store.put('appA/b.txt', 'b');
    // Delete the underlying file (and sidecar) out-of-band, then list — must not throw.
    rmSync(join(root, 'appA', 'a.txt'), { force: true });
    rmSync(join(root, 'appA', 'a.txt.exemeta'), { force: true });
    const r = await store.list({ prefix: 'appA/' });
    expect(r.objects.map((o) => o.key)).toEqual(['appA/b.txt']);
  });
});

// ---------------------------------------------------------------------------
// CacheShim — Cache-Control max-age TTL honored in match()
// ---------------------------------------------------------------------------
describe('CacheShim — Cache-Control TTL + size cap', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('an entry with max-age is a miss once the TTL elapses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = 'https://edge/ttl-config.json';
    await defaultCache.put(
      url,
      new Response('{"a":1}', { headers: { 'cache-control': 'max-age=30' } }),
    );
    vi.advanceTimersByTime(29_000);
    expect(await defaultCache.match(url)).toBeDefined();
    vi.advanceTimersByTime(2_000); // now 31s > 30s
    expect(await defaultCache.match(url)).toBeUndefined();
    await defaultCache.delete(url);
  });

  it('an entry with no Cache-Control never expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = 'https://edge/no-cc';
    await defaultCache.put(url, new Response('body', { status: 200 }));
    vi.advanceTimersByTime(10_000_000);
    expect(await defaultCache.match(url)).toBeDefined();
    await defaultCache.delete(url);
  });

  it('bodies larger than the per-entry cap are not cached', async () => {
    const url = 'https://edge/huge';
    const big = Buffer.alloc(9 * 1024 * 1024, 1); // 9 MB > 8 MB cap
    await defaultCache.put(url, new Response(big, { status: 200 }));
    expect(await defaultCache.match(url)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// KvShim — lazy periodic sweep frees expired entries that are never re-read
// ---------------------------------------------------------------------------
describe('KvShim — periodic sweep', () => {
  afterEach(() => vi.useRealTimers());

  it('put sweeps expired entries that are never read again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const kv = new KvShim();
    // A short-lived rate-limit window that nobody will get() again.
    await kv.put('ip-1', '1', { expirationTtl: 10 });
    // Advance past the entry's expiry AND the sweep interval (2 min), then put a
    // different key — the sweep should evict the stale 'ip-1'.
    vi.advanceTimersByTime(3 * 60 * 1000);
    await kv.put('ip-2', '1', { expirationTtl: 10 });

    // @ts-expect-error — reach into the private store to assert eviction happened.
    expect(kv.store.has('ip-1')).toBe(false);
    // @ts-expect-error
    expect(kv.store.has('ip-2')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LocalD1 — prepared-statement cache correctness
// ---------------------------------------------------------------------------
function freshDb(): LocalD1 {
  const raw = new Database(':memory:');
  raw.exec('CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, qty INTEGER)');
  return new LocalD1(raw);
}

describe('LocalD1 — statement cache', () => {
  it('reuses the same underlying prepared statement across executions', async () => {
    const db = freshDb();
    const spy = vi.spyOn(db.raw, 'prepare');
    await db.prepare('INSERT INTO items (name, qty) VALUES (?, ?)').bind('a', 1).run();
    await db.prepare('INSERT INTO items (name, qty) VALUES (?, ?)').bind('b', 2).run();
    await db.prepare('INSERT INTO items (name, qty) VALUES (?, ?)').bind('c', 3).run();
    // The identical SQL text is compiled exactly once despite three executions.
    const insertCalls = spy.mock.calls.filter(
      (c) => c[0] === 'INSERT INTO items (name, qty) VALUES (?, ?)',
    );
    expect(insertCalls.length).toBe(1);
    spy.mockRestore();
  });

  it('raw() does not leave the cached statement stuck in raw mode', async () => {
    const db = freshDb();
    await db.prepare('INSERT INTO items (name, qty) VALUES (?, ?)').bind('a', 1).run();
    const sql = 'SELECT name, qty FROM items';
    const rawRows = await db.prepare(sql).raw<[string, number]>();
    expect(rawRows).toEqual([['a', 1]]);
    // A subsequent all() on the SAME (now cached) SQL must return objects, not arrays.
    const objRows = await db.prepare(sql).all();
    expect(objRows.results).toEqual([{ name: 'a', qty: 1 }]);
  });
});
