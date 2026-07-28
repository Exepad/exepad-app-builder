import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { KvShim } from '../src/cache/kv-shim.js';
import { defaultCache, installCacheShim } from '../src/cache/cache-shim.js';
import { LocalD1 } from '../src/db/local-d1.js';
import { envSecret, requireEnv } from '../src/secrets.js';

// ---------------------------------------------------------------------------
// KvShim — TTL expiry semantics (rate-limit backing store for the app-backend)
// ---------------------------------------------------------------------------
describe('KvShim — TTL + expiry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips a value with no expiry', async () => {
    const kv = new KvShim();
    await kv.put('k', 'v');
    expect(await kv.get('k')).toBe('v');
  });

  it('returns null for a key that was never written', async () => {
    const kv = new KvShim();
    expect(await kv.get('missing')).toBeNull();
  });

  it('expirationTtl: a key read past its TTL window reads null', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const kv = new KvShim();
    await kv.put('rl', '1', { expirationTtl: 60 }); // 60s
    // Still inside the window.
    vi.advanceTimersByTime(59_000);
    expect(await kv.get('rl')).toBe('1');
    // Past the window (Date.now() > expiresAt). 60s + 1ms.
    vi.advanceTimersByTime(1_001);
    expect(await kv.get('rl')).toBeNull();
  });

  it('expired read deletes the entry (lazy eviction), so a later put with no TTL persists', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const kv = new KvShim();
    await kv.put('rl', '1', { expirationTtl: 1 });
    vi.advanceTimersByTime(2_000);
    expect(await kv.get('rl')).toBeNull(); // triggers lazy delete
    await kv.put('rl', '2'); // no TTL
    vi.advanceTimersByTime(10_000);
    expect(await kv.get('rl')).toBe('2'); // not re-expired by the stale entry
  });

  it('absolute `expiration` (unix seconds) expires correctly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000); // Date.now() = 10000ms = 10s
    const kv = new KvShim();
    // expiration is in *seconds*; 20s absolute → expiresAt = 20000ms.
    await kv.put('k', 'v', { expiration: 20 });
    expect(await kv.get('k')).toBe('v'); // now=10s < 20s
    vi.setSystemTime(20_001); // now = 20.001s > 20s
    expect(await kv.get('k')).toBeNull();
  });

  it('expirationTtl takes precedence over expiration when both are passed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const kv = new KvShim();
    // TTL 100s (→ 100000ms) wins over an already-past absolute expiration (1s).
    await kv.put('k', 'v', { expirationTtl: 100, expiration: 1 });
    vi.advanceTimersByTime(50_000);
    expect(await kv.get('k')).toBe('v'); // would be dead if `expiration` had won
  });

  it('delete removes a key; re-reading is null', async () => {
    const kv = new KvShim();
    await kv.put('k', 'v');
    await kv.delete('k');
    expect(await kv.get('k')).toBeNull();
  });

  it('put overwrites value and resets expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const kv = new KvShim();
    await kv.put('k', 'old', { expirationTtl: 10 });
    vi.advanceTimersByTime(9_000);
    await kv.put('k', 'new'); // overwrite, no TTL → clears expiry
    vi.advanceTimersByTime(100_000);
    expect(await kv.get('k')).toBe('new');
  });

  it('an empty-string value round-trips (and is NOT treated as absent)', async () => {
    const kv = new KvShim();
    await kv.put('k', '');
    expect(await kv.get('k')).toBe('');
  });

  it('treats a zero / falsy expirationTtl as no expiry (never expires)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const kv = new KvShim();
    // 0 is falsy → the `if (options?.expirationTtl)` branch is skipped.
    await kv.put('k', 'v', { expirationTtl: 0 });
    vi.advanceTimersByTime(10_000_000);
    expect(await kv.get('k')).toBe('v');
  });
});

// ---------------------------------------------------------------------------
// CacheShim — Response reconstruction (caches.default shim)
// ---------------------------------------------------------------------------
// The CacheShim class is not exported; exercise the singleton `defaultCache`
// (the instance the runtime actually wires onto caches.default). Keys are
// namespaced per-test and cleaned up so the shared store stays isolated.
describe('CacheShim (defaultCache) — Response round-trip', () => {
  const cache = defaultCache;

  it('match returns undefined for an unknown request', async () => {
    expect(await cache.match('https://edge/none')).toBeUndefined();
  });

  it('a cached Response round-trips body + status + headers', async () => {
    const url = 'https://edge/config.json';
    const original = new Response('{"a":1}', {
      status: 201,
      headers: { 'content-type': 'application/json', 'x-cache-tag': 'cfg' },
    });
    await cache.put(url, original);

    const hit = await cache.match(url);
    expect(hit).toBeInstanceOf(Response);
    expect(hit!.status).toBe(201);
    expect(hit!.headers.get('content-type')).toBe('application/json');
    expect(hit!.headers.get('x-cache-tag')).toBe('cfg');
    expect(await hit!.text()).toBe('{"a":1}');
    await cache.delete(url);
  });

  it('keys on Request.url, so a Request and its string URL hit the same entry', async () => {
    const url = 'https://edge/page';
    await cache.put(new Request(url), new Response('body', { status: 200 }));
    const hit = await cache.match(url);
    expect(hit).toBeDefined();
    expect(await hit!.text()).toBe('body');
    await cache.delete(url);
  });

  it('put does not consume the caller Response (clone) — original body stays readable', async () => {
    const url = 'https://edge/clone';
    const original = new Response('keepme', { status: 200 });
    await cache.put(url, original);
    // The shim clones internally, so the caller can still read the original.
    expect(original.bodyUsed).toBe(false);
    expect(await original.text()).toBe('keepme');
    await cache.delete(url);
  });

  it('two independent match() calls each yield a fresh, separately-readable body', async () => {
    const url = 'https://edge/twice';
    await cache.put(url, new Response('payload', { status: 200 }));
    const a = await cache.match(url);
    const b = await cache.match(url);
    // Each reconstructed Response owns its own one-shot body.
    expect(await a!.text()).toBe('payload');
    expect(await b!.text()).toBe('payload');
    await cache.delete(url);
  });

  it('caches a binary body byte-for-byte', async () => {
    const url = 'https://edge/bin';
    const bytes = new Uint8Array([0, 255, 16, 128, 7]);
    await cache.put(url, new Response(bytes, { status: 200 }));
    const hit = await cache.match(url);
    const ab = await hit!.arrayBuffer();
    expect([...new Uint8Array(ab)]).toEqual([0, 255, 16, 128, 7]);
    await cache.delete(url);
  });

  it('put overwrites a prior entry for the same key', async () => {
    const url = 'https://edge/overwrite';
    await cache.put(url, new Response('v1', { status: 200 }));
    await cache.put(url, new Response('v2', { status: 200 }));
    expect(await (await cache.match(url))!.text()).toBe('v2');
    await cache.delete(url);
  });

  it('delete returns true when present, false when absent', async () => {
    const url = 'https://edge/del';
    await cache.put(url, new Response('v', { status: 200 }));
    expect(await cache.delete(url)).toBe(true);
    expect(await cache.match(url)).toBeUndefined();
    expect(await cache.delete(url)).toBe(false);
  });

  // Regression: a null-body status (204/304) round-trips correctly. match() now
  // passes null (not the zero-length buffer) for null-body statuses, which the
  // WHATWG Response constructor requires — so a 204 No Content / 304 Not
  // Modified flowing through the PoP cache no longer faults on read.
  it('caches an empty body (status 204) round-trips to empty text', async () => {
    const url = 'https://edge/empty';
    await cache.put(url, new Response(null, { status: 204 }));
    const hit = await cache.match(url);
    expect(hit!.status).toBe(204);
    expect(await hit!.text()).toBe('');
    await cache.delete(url);
  });
});

describe('installCacheShim — global wiring', () => {
  let saved: unknown;
  beforeEach(() => {
    saved = (globalThis as unknown as { caches?: unknown }).caches;
    delete (globalThis as unknown as { caches?: unknown }).caches;
  });
  afterEach(() => {
    (globalThis as unknown as { caches?: unknown }).caches = saved;
  });

  it('installs globalThis.caches with .default and .open() returning the shared cache', async () => {
    installCacheShim();
    const g = globalThis as unknown as {
      caches: { default: typeof defaultCache; open(): Promise<typeof defaultCache> };
    };
    expect(g.caches).toBeDefined();
    expect(g.caches.default).toBe(defaultCache);
    expect(await g.caches.open()).toBe(defaultCache);
  });

  it('is idempotent — does not clobber an already-present global', () => {
    const sentinel = { default: 'preexisting' };
    (globalThis as unknown as { caches?: unknown }).caches = sentinel;
    installCacheShim();
    expect((globalThis as unknown as { caches: unknown }).caches).toBe(sentinel);
  });
});

// ---------------------------------------------------------------------------
// LocalD1 — batch() all-or-nothing + prepare-error surfacing
// ---------------------------------------------------------------------------
function freshDb(): LocalD1 {
  const raw = new Database(':memory:');
  raw.exec(
    'CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, qty INTEGER, active INTEGER)',
  );
  return new LocalD1(raw);
}

describe('LocalD1 — batch() edges', () => {
  it('all-succeed path: every statement runs and results are returned in order', async () => {
    const db = freshDb();
    const results = await db.batch([
      db.prepare('INSERT INTO items (name, qty) VALUES (?, ?)').bind('a', 1),
      db.prepare('INSERT INTO items (name, qty) VALUES (?, ?)').bind('b', 2),
      db.prepare('SELECT name, qty FROM items ORDER BY qty'),
    ]);
    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[0].meta.changes).toBe(1);
    expect(results[1].meta.last_row_id).toBe(2);
    // Third stmt is a reader → results carries the rows.
    expect(results[2].results).toEqual([
      { name: 'a', qty: 1 },
      { name: 'b', qty: 2 },
    ]);
    // And the writes actually committed.
    const count = await db.prepare('SELECT COUNT(*) AS c FROM items').first<{ c: number }>();
    expect(count?.c).toBe(2);
  });

  it('a prepare/SQL error inside the batch surfaces (rejects) and rolls everything back', async () => {
    const db = freshDb();
    await expect(
      db.batch([
        db.prepare('INSERT INTO items (name, qty) VALUES (?, ?)').bind('ok', 1),
        // Bad SQL — prepare() throws when _core() runs inside the transaction.
        db.prepare('INSERT INTO no_such_table (x) VALUES (?)').bind(1),
      ]),
    ).rejects.toThrow();
    // All-or-nothing: the first (valid) insert must NOT persist.
    const count = await db.prepare('SELECT COUNT(*) AS c FROM items').first<{ c: number }>();
    expect(count?.c).toBe(0);
  });

  it('a runtime constraint violation mid-batch rolls the whole batch back', async () => {
    const db = freshDb();
    await db.prepare('INSERT INTO items (id, name) VALUES (?, ?)').bind(5, 'seed').run();
    await expect(
      db.batch([
        db.prepare('INSERT INTO items (id, name) VALUES (?, ?)').bind(6, 'newish'),
        db.prepare('INSERT INTO items (id, name) VALUES (?, ?)').bind(5, 'dup'), // PK clash
      ]),
    ).rejects.toThrow();
    // Only the seed row remains; the batch's first insert rolled back.
    const all = await db.prepare('SELECT id FROM items ORDER BY id').all<{ id: number }>();
    expect(all.results.map((r) => r.id)).toEqual([5]);
  });

  it('an empty batch resolves to an empty result array', async () => {
    const db = freshDb();
    await expect(db.batch([])).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// secrets — envSecret / requireEnv
// ---------------------------------------------------------------------------
describe('secrets — envSecret + requireEnv', () => {
  const KEY = '__EXEPAD_TEST_SECRET__';
  let original: string | undefined;
  beforeEach(() => {
    original = process.env[KEY];
    delete process.env[KEY];
  });
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('envSecret().get() resolves the process.env value', async () => {
    process.env[KEY] = 'super-secret';
    const s = envSecret(KEY);
    expect(typeof s.get).toBe('function');
    await expect(s.get()).resolves.toBe('super-secret');
  });

  it('envSecret().get() falls back to the default when the var is unset', async () => {
    const s = envSecret(KEY, 'fallback-val');
    await expect(s.get()).resolves.toBe('fallback-val');
  });

  it('envSecret() default fallback is the empty string', async () => {
    const s = envSecret(KEY);
    await expect(s.get()).resolves.toBe('');
  });

  it('envSecret reads env lazily at get()-time, not at construction', async () => {
    const s = envSecret(KEY, 'def');
    await expect(s.get()).resolves.toBe('def');
    // Mutate after construction; the next get() must observe the new value.
    process.env[KEY] = 'set-later';
    await expect(s.get()).resolves.toBe('set-later');
  });

  it('requireEnv returns the value when present', () => {
    process.env[KEY] = 'present';
    expect(requireEnv(KEY)).toBe('present');
  });

  it('requireEnv throws a descriptive error when the var is missing', () => {
    expect(() => requireEnv(KEY)).toThrow(`Missing required env var: ${KEY}`);
  });

  it('requireEnv treats an empty-string value as missing (falsy guard)', () => {
    process.env[KEY] = '';
    expect(() => requireEnv(KEY)).toThrow(/Missing required env var/);
  });
});
