import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { LocalD1 } from '../src/db/local-d1.js';

function freshDb(): LocalD1 {
  const raw = new Database(':memory:');
  raw.exec('CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, qty INTEGER, active INTEGER)');
  return new LocalD1(raw);
}

describe('LocalD1 — D1Database surface', () => {
  it('prepare().bind().run() reports changes + last_row_id', async () => {
    const db = freshDb();
    const r = await db.prepare('INSERT INTO items (name, qty) VALUES (?, ?)').bind('a', 3).run();
    expect(r.success).toBe(true);
    expect(r.meta.changes).toBe(1);
    expect(r.meta.last_row_id).toBe(1);
  });

  it('all() returns rows; first() returns one row or a column', async () => {
    const db = freshDb();
    await db.prepare('INSERT INTO items (name, qty) VALUES (?, ?)').bind('a', 1).run();
    await db.prepare('INSERT INTO items (name, qty) VALUES (?, ?)').bind('b', 2).run();

    const all = await db.prepare('SELECT name, qty FROM items ORDER BY qty').all();
    expect(all.results).toEqual([
      { name: 'a', qty: 1 },
      { name: 'b', qty: 2 },
    ]);

    const row = await db.prepare('SELECT name FROM items WHERE qty = ?').bind(2).first<{ name: string }>();
    expect(row).toEqual({ name: 'b' });

    const col = await db.prepare('SELECT name FROM items WHERE qty = ?').bind(1).first<string>('name');
    expect(col).toBe('a');

    const none = await db.prepare('SELECT name FROM items WHERE qty = ?').bind(99).first();
    expect(none).toBeNull();
  });

  it('normalizes booleans → 0/1 and undefined → NULL', async () => {
    const db = freshDb();
    await db.prepare('INSERT INTO items (name, qty, active) VALUES (?, ?, ?)').bind('x', undefined, true).run();
    const row = await db.prepare('SELECT qty, active FROM items WHERE name = ?').bind('x').first<{ qty: number | null; active: number }>();
    expect(row).toEqual({ qty: null, active: 1 });
  });

  it('supports RETURNING via all()', async () => {
    const db = freshDb();
    const r = await db.prepare('INSERT INTO items (name, qty) VALUES (?, ?) RETURNING id, name').bind('z', 7).all<{ id: number; name: string }>();
    expect(r.results).toEqual([{ id: 1, name: 'z' }]);
  });

  it('batch() runs in one transaction (all-or-nothing)', async () => {
    const db = freshDb();
    // Second statement violates the PK → whole batch rolls back.
    await expect(
      db.batch([
        db.prepare('INSERT INTO items (id, name) VALUES (?, ?)').bind(1, 'ok'),
        db.prepare('INSERT INTO items (id, name) VALUES (?, ?)').bind(1, 'dup'),
      ]),
    ).rejects.toThrow();
    const count = await db.prepare('SELECT COUNT(*) AS c FROM items').first<{ c: number }>();
    expect(count?.c).toBe(0);
  });

  it('exec() runs multi-statement DDL', async () => {
    const db = freshDb();
    const r = await db.exec('CREATE TABLE a (x); CREATE TABLE b (y);');
    expect(r.count).toBe(2);
    await db.prepare('INSERT INTO a (x) VALUES (1)').run();
    expect((await db.prepare('SELECT x FROM a').first<{ x: number }>())?.x).toBe(1);
  });

  it('raw() returns array rows for readers and [] for non-readers', async () => {
    const db = freshDb();
    await db.prepare('INSERT INTO items (name, qty) VALUES (?, ?)').bind('a', 1).run();
    const raw = await db.prepare('SELECT name, qty FROM items').raw<[string, number]>();
    expect(raw).toEqual([['a', 1]]);
    const none = await db.prepare('INSERT INTO items (name) VALUES (?)').bind('b').raw();
    expect(none).toEqual([]);
  });
});
