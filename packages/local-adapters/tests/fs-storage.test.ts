import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStorageAdapter } from '../src/storage/fs-storage.js';

let root: string;
let store: FsStorageAdapter;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exepad-storage-'));
  store = new FsStorageAdapter(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('FsStorageAdapter — R2Bucket surface', () => {
  it('put/get round-trips text + json with the existing key scheme', async () => {
    const key = 'lxc5yfm7/published/app-config.json';
    const cfg = { name: 'Stratos', frontend: { pages: [{ slug: '/' }] } };
    await store.put(key, JSON.stringify(cfg), { httpMetadata: { contentType: 'application/json' } });

    const obj = await store.get(key);
    expect(obj).not.toBeNull();
    expect(await obj!.text()).toBe(JSON.stringify(cfg));
    expect(await obj!.json()).toEqual(cfg);
    expect(obj!.httpMetadata?.contentType).toBe('application/json');
    expect(obj!.httpEtag).toBe(`"${obj!.etag}"`);
  });

  it('get returns null for a missing key', async () => {
    expect(await store.get('nope/missing.json')).toBeNull();
    expect(await store.head('nope/missing.json')).toBeNull();
  });

  it('etag is a stable content hash (changes when content changes)', async () => {
    await store.put('a/x.txt', 'one');
    const e1 = (await store.head('a/x.txt'))!.etag;
    await store.put('a/x.txt', 'one');
    const e2 = (await store.head('a/x.txt'))!.etag;
    await store.put('a/x.txt', 'two');
    const e3 = (await store.head('a/x.txt'))!.etag;
    expect(e1).toBe(e2);
    expect(e1).not.toBe(e3);
  });

  it('body exposes a web ReadableStream', async () => {
    await store.put('a/bin', new Uint8Array([1, 2, 3]));
    const obj = await store.get('a/bin');
    const ab = await obj!.arrayBuffer();
    expect([...new Uint8Array(ab)]).toEqual([1, 2, 3]);
    expect(typeof obj!.body.getReader).toBe('function');
  });

  it('list filters by prefix and excludes metadata sidecars', async () => {
    await store.put('app1/published/a.js', 'a');
    await store.put('app1/published/b.js', 'b');
    await store.put('app2/published/c.js', 'c');
    await store.put('_system/worker-template-latest.json', '{}');

    const r = await store.list({ prefix: 'app1/' });
    const keys = r.objects.map((o) => o.key).sort();
    expect(keys).toEqual(['app1/published/a.js', 'app1/published/b.js']);
    // No .exemeta sidecars leak into listings.
    expect(r.objects.some((o) => o.key.endsWith('.exemeta'))).toBe(false);
  });

  it('list paginates via cursor', async () => {
    for (let i = 0; i < 5; i++) await store.put(`p/k${i}.txt`, String(i));
    const first = await store.list({ prefix: 'p/', limit: 2 });
    expect(first.objects.length).toBe(2);
    expect(first.truncated).toBe(true);
    const second = await store.list({ prefix: 'p/', limit: 2, cursor: first.cursor });
    expect(second.objects.length).toBe(2);
    // No overlap between pages.
    const a = first.objects.map((o) => o.key);
    const b = second.objects.map((o) => o.key);
    expect(a.some((k) => b.includes(k))).toBe(false);
  });

  it('delete removes the object and its sidecar; deletePrefix nukes a subtree', async () => {
    await store.put('app1/published/a.js', 'a');
    await store.put('app1/published/b.js', 'b');
    await store.delete('app1/published/a.js');
    expect(await store.get('app1/published/a.js')).toBeNull();
    expect(existsSync(join(root, 'app1/published/a.js.exemeta'))).toBe(false);

    await store.deletePrefix('app1');
    expect(await store.get('app1/published/b.js')).toBeNull();
    expect(readdirSync(root)).not.toContain('app1');
  });

  it('rejects path traversal keys', async () => {
    await expect(store.put('../escape.txt', 'x')).rejects.toThrow(/Invalid storage key/);
  });
});
