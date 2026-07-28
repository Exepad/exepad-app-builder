import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appDbPath,
  openDbCached,
  openAppDb,
  getAppD1,
  closeDbAt,
  closeAppDb,
  openDb,
} from '../src/db/registry.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exepad-registry-'));
});

afterEach(() => {
  // Close any pooled handles rooted under this temp dir before removing it, so
  // the SQLite files (and their -wal/-shm siblings) are not held open.
  closeAppDb('app-a', 'preview', root);
  closeAppDb('app-a', 'published', root);
  closeAppDb('app-b', 'preview', root);
  closeAppDb('app-b', 'published', root);
  closeDbAt(join(root, 'misc.sqlite'));
  closeDbAt(join(root, 'unpooled.sqlite'));
  rmSync(root, { recursive: true, force: true });
});

describe('registry — pragmas', () => {
  it('openDbCached applies WAL journal_mode + foreign_keys=ON', () => {
    const path = join(root, 'misc.sqlite');
    const db = openDbCached(path);

    // journal_mode is a connection/file property; better-sqlite3 returns the
    // active mode (lowercased) as the single column of the pragma row.
    const mode = db.pragma('journal_mode', { simple: true });
    expect(mode).toBe('wal');

    const fk = db.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);
  });

  it('openDb (unpooled) applies WAL + foreign_keys=ON too', () => {
    const path = join(root, 'unpooled.sqlite');
    const db = openDb(path);
    try {
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      db.close();
    }
  });

  it('foreign_keys=ON is actually enforced (FK violation rejected)', () => {
    const db = openDbCached(join(root, 'misc.sqlite'));
    db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
    db.exec(
      'CREATE TABLE child (id INTEGER PRIMARY KEY, pid INTEGER REFERENCES parent(id))',
    );
    // Inserting a child pointing at a non-existent parent must throw because
    // the FK pragma is on for this connection.
    expect(() =>
      db.prepare('INSERT INTO child (id, pid) VALUES (1, 999)').run(),
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe('registry — path resolution', () => {
  it('appDbPath builds <dbDir>/<appId>/<mode>.sqlite', () => {
    expect(appDbPath('app-a', 'preview', root)).toBe(
      join(root, 'app-a', 'preview.sqlite'),
    );
    expect(appDbPath('app-a', 'published', root)).toBe(
      join(root, 'app-a', 'published.sqlite'),
    );
  });

  it('appDbPath defaults dbDir to $EXEPAD_DATA_DIR/apps', () => {
    const prev = process.env.EXEPAD_DATA_DIR;
    try {
      process.env.EXEPAD_DATA_DIR = '/tmp/exepad-data-test';
      expect(appDbPath('zz', 'published')).toBe(
        join('/tmp/exepad-data-test', 'apps', 'zz', 'published.sqlite'),
      );
    } finally {
      if (prev === undefined) delete process.env.EXEPAD_DATA_DIR;
      else process.env.EXEPAD_DATA_DIR = prev;
    }
  });

  it('openAppDb creates the parent directory + file on first open', () => {
    const path = appDbPath('app-a', 'preview', root);
    expect(existsSync(path)).toBe(false);
    const db = openAppDb('app-a', 'preview', root);
    expect(db.open).toBe(true);
    expect(existsSync(path)).toBe(true);
  });
});

describe('registry — handle pooling + lifecycle', () => {
  it('repeated open returns the SAME pooled handle and a usable one', () => {
    const path = join(root, 'misc.sqlite');
    const a = openDbCached(path);
    const b = openDbCached(path);
    expect(b).toBe(a);
    expect(b.open).toBe(true);

    // The reused handle can still run queries.
    a.exec('CREATE TABLE t (x INTEGER)');
    b.prepare('INSERT INTO t (x) VALUES (?)').run(5);
    const row = a.prepare('SELECT x FROM t').get() as { x: number };
    expect(row.x).toBe(5);
  });

  it('openAppDb pools per app+mode (same handle across calls)', () => {
    const first = openAppDb('app-a', 'preview', root);
    const second = openAppDb('app-a', 'preview', root);
    expect(second).toBe(first);
  });

  it('writes through one cached handle are visible through another lookup', () => {
    // Two getAppD1 adapters for the same app+mode wrap the SAME underlying
    // connection, so a committed write through one is seen by the other.
    const d1a = getAppD1('app-a', 'published', root);
    const d1b = getAppD1('app-a', 'published', root);

    openAppDb('app-a', 'published', root).exec(
      'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)',
    );
    return d1a
      .prepare('INSERT INTO notes (body) VALUES (?)')
      .bind('hi')
      .run()
      .then(() => d1b.prepare('SELECT body FROM notes').first<{ body: string }>())
      .then((row) => {
        expect(row).toEqual({ body: 'hi' });
      });
  });

  it('re-open after close returns a fresh, usable handle', () => {
    const path = join(root, 'misc.sqlite');
    const first = openDbCached(path);
    first.exec('CREATE TABLE persist (x INTEGER)');
    first.prepare('INSERT INTO persist (x) VALUES (?)').run(42);

    closeDbAt(path);
    expect(first.open).toBe(false);

    const second = openDbCached(path);
    // A new connection object, open, and the on-disk data persisted.
    expect(second).not.toBe(first);
    expect(second.open).toBe(true);
    const row = second.prepare('SELECT x FROM persist').get() as { x: number };
    expect(row.x).toBe(42);
  });

  it('openDbCached re-opens transparently if a previously cached handle was closed out-of-band', () => {
    const path = join(root, 'misc.sqlite');
    const first = openDbCached(path);
    // Close the underlying connection WITHOUT going through closeDbAt, leaving a
    // stale (closed) entry in the pool. The guard `existing && existing.open`
    // must detect this and hand back a fresh handle.
    first.close();
    const second = openDbCached(path);
    expect(second).not.toBe(first);
    expect(second.open).toBe(true);
    second.exec('CREATE TABLE ok (x)'); // proves it is actually usable
  });

  it('closeDbAt on an unknown path is a no-op (does not throw)', () => {
    expect(() => closeDbAt(join(root, 'never-opened.sqlite'))).not.toThrow();
  });

  it('closeDbAt is idempotent (double-close does not throw)', () => {
    const path = join(root, 'misc.sqlite');
    openDbCached(path);
    closeDbAt(path);
    expect(() => closeDbAt(path)).not.toThrow();
  });

  it('closeAppDb closes the app+mode handle and a subsequent open is fresh', () => {
    const first = openAppDb('app-a', 'preview', root);
    closeAppDb('app-a', 'preview', root);
    expect(first.open).toBe(false);
    const second = openAppDb('app-a', 'preview', root);
    expect(second).not.toBe(first);
    expect(second.open).toBe(true);
  });
});

describe('registry — isolation between distinct ids', () => {
  it('distinct app ids get distinct handles and separate storage', () => {
    const a = openAppDb('app-a', 'preview', root);
    const b = openAppDb('app-b', 'preview', root);
    expect(a).not.toBe(b);

    a.exec('CREATE TABLE only_a (x INTEGER)');
    // The table created in app-a must NOT exist in app-b's database.
    const tbl = b
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='only_a'")
      .get();
    expect(tbl).toBeUndefined();
  });

  it('preview and published modes of the same app are isolated', () => {
    const preview = openAppDb('app-a', 'preview', root);
    const published = openAppDb('app-a', 'published', root);
    expect(preview).not.toBe(published);
    expect(appDbPath('app-a', 'preview', root)).not.toBe(
      appDbPath('app-a', 'published', root),
    );

    preview.exec('CREATE TABLE draft (x INTEGER)');
    const inPublished = published
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='draft'")
      .get();
    expect(inPublished).toBeUndefined();
  });

  it('closing one app id does not affect another open handle', () => {
    const a = openAppDb('app-a', 'preview', root);
    const b = openAppDb('app-b', 'preview', root);
    closeAppDb('app-a', 'preview', root);
    expect(a.open).toBe(false);
    expect(b.open).toBe(true);
    b.exec('CREATE TABLE still_here (x)'); // b remains usable
  });
});

describe('registry — unpooled openDb', () => {
  it('openDb returns independent handles NOT shared with the pool', () => {
    const path = join(root, 'unpooled.sqlite');
    const one = openDb(path);
    const two = openDb(path);
    try {
      // Each call is a brand-new connection; not deduplicated.
      expect(two).not.toBe(one);
      // And it is not the pooled handle either.
      const pooled = openDbCached(join(root, 'misc.sqlite'));
      expect(one).not.toBe(pooled);
    } finally {
      one.close();
      two.close();
    }
  });
});
