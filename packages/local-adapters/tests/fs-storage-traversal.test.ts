/**
 * Path-traversal + root-wipe hardening for FsStorageAdapter.
 *
 * fs-storage.test.ts only exercises traversal on put(). This file covers the
 * read/delete surface (get / head / delete / deletePrefix) plus the two
 * destructive root-wipe vectors deletePrefix('') and deletePrefix('/'), and
 * proves that nothing OUTSIDE the storage root is ever touched.
 *
 * Harness mirrors fs-storage.test.ts: a real temp dir per test, real adapter.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStorageAdapter } from '../src/storage/fs-storage.js';

let parent: string; // sandbox containing both the storage root AND an outside sibling
let root: string; // the adapter's storage root
let outsideDir: string; // a sibling dir that MUST never be touched
let outsideFile: string; // a canary file inside outsideDir
let store: FsStorageAdapter;

beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), 'exepad-storage-trav-'));
  root = join(parent, 'storage-root');
  outsideDir = join(parent, 'outside');
  outsideFile = join(outsideDir, 'secret.txt');
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(outsideFile, 'TOP-SECRET');
  store = new FsStorageAdapter(root);
});
afterEach(() => {
  rmSync(parent, { recursive: true, force: true });
});

describe('FsStorageAdapter — traversal on get/head/delete', () => {
  it('get rejects "../" traversal keys', async () => {
    await expect(store.get('../escape.txt')).rejects.toThrow(/Invalid storage key/);
    await expect(store.get('app1/../../escape.txt')).rejects.toThrow(/Invalid storage key/);
    // The canary outside the root is untouched and still readable on disk.
    expect(existsSync(outsideFile)).toBe(true);
  });

  it('head rejects "../" traversal keys', async () => {
    await expect(store.head('../../secret.txt')).rejects.toThrow(/Invalid storage key/);
    expect(existsSync(outsideFile)).toBe(true);
  });

  it('delete rejects "../" traversal keys and removes nothing outside root', async () => {
    // A relative climb that would resolve to the sibling canary if joined naively.
    await expect(store.delete('../outside/secret.txt')).rejects.toThrow(/Invalid storage key/);
    expect(existsSync(outsideFile)).toBe(true);
  });

  it('delete rejects a traversal key even when batched with a valid key', async () => {
    await store.put('app1/keep.txt', 'keep');
    // Array form: a single poisoned entry must abort via sanitizeKey throwing.
    await expect(store.delete(['app1/keep.txt', '../outside/secret.txt'])).rejects.toThrow(
      /Invalid storage key/,
    );
    expect(existsSync(outsideFile)).toBe(true);
  });

  it('get treats an absolute-path key as contained under the root (leading slashes stripped)', async () => {
    // Absolute-looking key has no ".." so it is NOT rejected; it must be
    // contained, i.e. mapped to <root>/etc/passwd, never the real /etc/passwd.
    await store.put('/etc/passwd', 'contained-payload');
    const obj = await store.get('/etc/passwd');
    expect(obj).not.toBeNull();
    expect(await obj!.text()).toBe('contained-payload');
    // It landed inside the root, not at the filesystem root.
    expect(existsSync(join(root, 'etc/passwd'))).toBe(true);
  });

  it('encoded traversal is treated as a literal contained filename, not decoded into ".."', async () => {
    // %2e%2e is NOT decoded by the adapter, so it contains no literal "..".
    // It must therefore be stored/looked-up as a literal segment under root.
    const key = '%2e%2e/%2e%2e/escape.txt';
    await store.put(key, 'literal');
    const obj = await store.get(key);
    expect(obj).not.toBeNull();
    expect(await obj!.text()).toBe('literal');
    // Nothing escaped: the canary sibling is untouched.
    expect(existsSync(outsideFile)).toBe(true);
    expect(readdirSync(parent).sort()).toEqual(['outside', 'storage-root']);
  });
});

describe('FsStorageAdapter — traversal + root-wipe on deletePrefix', () => {
  it('deletePrefix rejects "../" traversal prefixes', async () => {
    await expect(store.deletePrefix('../outside')).rejects.toThrow(/Invalid storage key/);
    await expect(store.deletePrefix('app1/../../outside')).rejects.toThrow(/Invalid storage key/);
    expect(existsSync(outsideDir)).toBe(true);
    expect(existsSync(outsideFile)).toBe(true);
  });

  it('deletePrefix only removes the targeted contained subtree', async () => {
    await store.put('app1/published/a.js', 'a');
    await store.put('app2/published/b.js', 'b');
    await store.deletePrefix('app1');
    expect(await store.get('app1/published/a.js')).toBeNull();
    // Sibling subtree and the outside canary survive.
    expect(await store.get('app2/published/b.js')).not.toBeNull();
    expect(existsSync(outsideFile)).toBe(true);
  });

  it('deletePrefix with an absolute-style prefix stays contained under the root', async () => {
    await store.put('app1/x.js', 'x');
    // Leading slash is stripped → targets <root>/app1, never the real /app1.
    await store.deletePrefix('/app1');
    expect(await store.get('app1/x.js')).toBeNull();
    expect(existsSync(root)).toBe(true);
    expect(existsSync(outsideFile)).toBe(true);
  });

  // --- Root-wipe guard ---------------------------------------------------
  // deletePrefix('') and deletePrefix('/') both sanitize to '' and join() to
  // the storage root itself, then rmSync(root, { recursive: true }). That
  // destroys the entire store. The intended/secure behavior is a no-op (or a
  // rejection) that leaves the root — and the seeded objects — intact.

  it('deletePrefix("") must NOT wipe the storage root', async () => {
    await store.put('app1/keep.txt', 'keep');
    await store.deletePrefix('');
    // Secure expectation: the seeded object survives and the root still exists.
    expect(existsSync(root)).toBe(true);
    expect(await store.get('app1/keep.txt')).not.toBeNull();
  });

  it('deletePrefix("/") must NOT wipe the storage root', async () => {
    await store.put('app1/keep.txt', 'keep');
    await store.deletePrefix('/');
    expect(existsSync(root)).toBe(true);
    expect(await store.get('app1/keep.txt')).not.toBeNull();
  });

  it('deletePrefix never reaches outside the root even on the root-wipe vector', async () => {
    // Regardless of whether the root itself is (buggily) removed, deletePrefix
    // must NEVER touch anything outside the root. This is the containment
    // invariant and must hold even while the root-wipe bug above is open.
    await store.put('app1/keep.txt', 'keep');
    await store.deletePrefix('').catch(() => {});
    await store.deletePrefix('/').catch(() => {});
    expect(existsSync(outsideDir)).toBe(true);
    expect(existsSync(outsideFile)).toBe(true);
  });
});
