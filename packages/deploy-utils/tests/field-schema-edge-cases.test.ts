/**
 * Field Schema Edge Cases
 *
 * Tests for schema generation edge cases: primary key NOT NULL,
 * default value formatting, system column deduplication,
 * and foreign key generation — covers BUG-1 gap.
 */

import { describe, it, expect } from 'vitest';
import { generateCreateTableSQL } from '../src/schema/builder';
import type { ModelProps } from '../src/schema/types';

// ── Helpers ──────────────────────────────────────────────────────

/** Create a minimal model with a single column (besides the PK) */
function makeModel(
  pk: { name: string; type: 'integer' | 'text' | 'real'; isNullable?: boolean },
  extra: ModelProps['columns'] = [],
  opts: Partial<ModelProps> = {}
): ModelProps {
  return {
    uuid: 'test-uuid',
    name: 'test_table',
    columns: [
      { name: pk.name, type: pk.type, isPrimary: true, isNullable: pk.isNullable },
      { name: 'label', type: 'text' },
      ...extra,
    ],
    ...opts,
  };
}

// ── Primary key NOT NULL ─────────────────────────────────────────

describe('Primary key NOT NULL generation', () => {
  it('integer PK: generates AUTOINCREMENT, no explicit NOT NULL', () => {
    const sql = generateCreateTableSQL(
      makeModel({ name: 'id', type: 'integer' })
    );
    expect(sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
    // Should NOT have "AUTOINCREMENT NOT NULL"
    expect(sql).not.toMatch(/"id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL/);
  });

  it('text PK: generates NOT NULL (no AUTOINCREMENT)', () => {
    const sql = generateCreateTableSQL(
      makeModel({ name: 'id', type: 'text' })
    );
    expect(sql).toContain('"id" TEXT PRIMARY KEY NOT NULL');
    expect(sql).not.toContain('AUTOINCREMENT');
  });

  it('real PK: generates NOT NULL (no AUTOINCREMENT)', () => {
    const sql = generateCreateTableSQL(
      makeModel({ name: 'id', type: 'real' })
    );
    expect(sql).toContain('"id" REAL PRIMARY KEY NOT NULL');
    expect(sql).not.toContain('AUTOINCREMENT');
  });

  it('nullable text PK: no NOT NULL', () => {
    const sql = generateCreateTableSQL(
      makeModel({ name: 'id', type: 'text', isNullable: true })
    );
    expect(sql).toContain('"id" TEXT PRIMARY KEY');
    expect(sql).not.toMatch(/"id" TEXT PRIMARY KEY NOT NULL/);
  });

  it('nullable integer PK: no NOT NULL, has AUTOINCREMENT', () => {
    const sql = generateCreateTableSQL(
      makeModel({ name: 'id', type: 'integer', isNullable: true })
    );
    expect(sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(sql).not.toMatch(/AUTOINCREMENT NOT NULL/);
  });
});

// ── Default value formatting ─────────────────────────────────────

describe('Default value formatting in DDL', () => {
  it('null default → DEFAULT NULL', () => {
    const sql = generateCreateTableSQL(
      makeModel({ name: 'id', type: 'integer' }, [
        { name: 'status', type: 'text', isNullable: true, defaultValue: null },
      ])
    );
    expect(sql).toMatch(/"status" TEXT DEFAULT NULL/);
  });

  it('empty string default → DEFAULT \'\'', () => {
    const sql = generateCreateTableSQL(
      makeModel({ name: 'id', type: 'integer' }, [
        { name: 'note', type: 'text', isNullable: true, defaultValue: '' },
      ])
    );
    expect(sql).toMatch(/"note" TEXT DEFAULT ''/);
  });

  it('numeric zero default → DEFAULT 0', () => {
    const sql = generateCreateTableSQL(
      makeModel({ name: 'id', type: 'integer' }, [
        { name: 'count', type: 'integer', isNullable: true, defaultValue: 0 },
      ])
    );
    expect(sql).toMatch(/"count" INTEGER DEFAULT 0/);
  });

  it('boolean true default → DEFAULT 1', () => {
    const sql = generateCreateTableSQL(
      makeModel({ name: 'id', type: 'integer' }, [
        { name: 'active', type: 'integer', isNullable: true, defaultValue: true },
      ])
    );
    expect(sql).toMatch(/"active" INTEGER DEFAULT 1/);
  });

  it('boolean false default → DEFAULT 0', () => {
    const sql = generateCreateTableSQL(
      makeModel({ name: 'id', type: 'integer' }, [
        { name: 'active', type: 'integer', isNullable: true, defaultValue: false },
      ])
    );
    expect(sql).toMatch(/"active" INTEGER DEFAULT 0/);
  });

  it('string with single quotes → properly escaped', () => {
    const sql = generateCreateTableSQL(
      makeModel({ name: 'id', type: 'integer' }, [
        { name: 'desc', type: 'text', isNullable: true, defaultValue: "it's quoted" },
      ])
    );
    expect(sql).toContain("DEFAULT 'it''s quoted'");
  });

  it('JSON object default → stringified and quoted', () => {
    const sql = generateCreateTableSQL(
      makeModel({ name: 'id', type: 'integer' }, [
        { name: 'config', type: 'json', isNullable: true, defaultValue: { key: 'val' } },
      ])
    );
    expect(sql).toContain(`DEFAULT '{"key":"val"}'`);
  });
});

// ── System column deduplication ──────────────────────────────────

describe('System column deduplication', () => {
  it('does not duplicate owner_id when user-defined', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'custom_table',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'owner_id', type: 'text' }, // user-defined
        { name: 'title', type: 'text' },
      ],
    };

    const sql = generateCreateTableSQL(model);
    // Count occurrences of "owner_id" in the SQL
    const matches = sql.match(/"owner_id"/g);
    expect(matches).toHaveLength(1);
  });

  it('does not duplicate created_at when user-defined', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'custom_table',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'created_at', type: 'text' }, // user-defined
        { name: 'title', type: 'text' },
      ],
    };

    const sql = generateCreateTableSQL(model);
    const matches = sql.match(/"created_at"/g);
    expect(matches).toHaveLength(1);
  });

  it('does not duplicate deleted_at when user-defined + softDelete', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'custom_table',
      softDelete: true,
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'deleted_at', type: 'text', isNullable: true }, // user-defined
        { name: 'title', type: 'text' },
      ],
    };

    const sql = generateCreateTableSQL(model);
    const matches = sql.match(/"deleted_at"/g);
    expect(matches).toHaveLength(1);
  });

  it('adds deleted_at when softDelete is true and column not user-defined', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'custom_table',
      softDelete: true,
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'title', type: 'text' },
      ],
    };

    const sql = generateCreateTableSQL(model);
    expect(sql).toContain('"deleted_at"');
  });

  it('does NOT add deleted_at when softDelete is not set', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'custom_table',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'title', type: 'text' },
      ],
    };

    const sql = generateCreateTableSQL(model);
    expect(sql).not.toContain('"deleted_at"');
  });
});

// ── Foreign key generation ───────────────────────────────────────

describe('Foreign key generation', () => {
  it('generates ON DELETE CASCADE', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'orders',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        {
          name: 'user_id',
          type: 'integer',
          references: { model: 'users', column: 'id', onDelete: 'cascade' },
        },
      ],
    };

    const sql = generateCreateTableSQL(model);
    expect(sql).toContain(
      'FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE'
    );
  });

  it('generates ON DELETE SET NULL', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'orders',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        {
          name: 'user_id',
          type: 'integer',
          isNullable: true,
          references: { model: 'users', column: 'id', onDelete: 'set_null' },
        },
      ],
    };

    const sql = generateCreateTableSQL(model);
    expect(sql).toContain('ON DELETE SET NULL');
  });

  it('generates ON DELETE RESTRICT', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'orders',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        {
          name: 'user_id',
          type: 'integer',
          references: { model: 'users', column: 'id', onDelete: 'restrict' },
        },
      ],
    };

    const sql = generateCreateTableSQL(model);
    expect(sql).toContain('ON DELETE RESTRICT');
  });

  it('generates ON DELETE NO ACTION', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'orders',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        {
          name: 'user_id',
          type: 'integer',
          references: { model: 'users', column: 'id', onDelete: 'no_action' },
        },
      ],
    };

    const sql = generateCreateTableSQL(model);
    expect(sql).toContain('ON DELETE NO ACTION');
  });

  it('defaults to ON DELETE CASCADE when onDelete is not specified', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'orders',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        {
          name: 'user_id',
          type: 'integer',
          references: { model: 'users', column: 'id' },
        },
      ],
    };

    const sql = generateCreateTableSQL(model);
    expect(sql).toContain('FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE');
  });
});

// ── UNIQUE constraint ────────────────────────────────────────────

describe('UNIQUE constraint on columns', () => {
  it('adds UNIQUE to non-primary unique column', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'users',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'email', type: 'text', isUnique: true },
      ],
    };

    const sql = generateCreateTableSQL(model);
    expect(sql).toContain('"email" TEXT NOT NULL UNIQUE');
  });

  it('does NOT add UNIQUE to primary key column (even if isUnique is true)', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'users',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true, isUnique: true },
        { name: 'name', type: 'text' },
      ],
    };

    const sql = generateCreateTableSQL(model);
    // PK is inherently unique; no redundant UNIQUE keyword
    expect(sql).not.toMatch(/"id" INTEGER PRIMARY KEY AUTOINCREMENT.*UNIQUE/);
  });
});

// ── Invalid identifiers ──────────────────────────────────────────

describe('Invalid identifier rejection', () => {
  it('rejects model name with spaces', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'bad table',
      columns: [{ name: 'id', type: 'integer', isPrimary: true }],
    };
    expect(() => generateCreateTableSQL(model)).toThrow('Invalid model name');
  });

  it('rejects column name with special characters', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'good_table',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'bad-col', type: 'text' },
      ],
    };
    expect(() => generateCreateTableSQL(model)).toThrow('Invalid column name');
  });
});
