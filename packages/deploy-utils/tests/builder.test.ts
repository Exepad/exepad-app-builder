/**
 * Tests for schema builder (generateCreateTableSQL, generateIndexSQL, generateSchema)
 */

import { describe, it, expect } from 'vitest';
import {
  generateCreateTableSQL,
  generateIndexSQL,
  generateSchema,
  generateSchemaSQL,
} from '../src/schema/builder';
import type { ModelProps } from '../src/schema/types';

const basicModel: ModelProps = {
  uuid: 'test',
  name: 'contacts',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'name', type: 'text' },
    { name: 'email', type: 'text', isUnique: true },
  ],
};

describe('generateCreateTableSQL', () => {
  it('generates basic CREATE TABLE', () => {
    const sql = generateCreateTableSQL(basicModel);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "contacts"');
    expect(sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(sql).toContain('"name" TEXT NOT NULL');
    expect(sql).toContain('"email" TEXT NOT NULL UNIQUE');
  });

  it('auto-adds system columns (owner_id, created_at, updated_at)', () => {
    const sql = generateCreateTableSQL(basicModel);
    expect(sql).toContain('"owner_id" TEXT NOT NULL');
    expect(sql).toContain('"created_at" TEXT NOT NULL');
    expect(sql).toContain('"updated_at" TEXT NOT NULL');
  });

  it('does not duplicate system columns if already present', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'items',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'owner_id', type: 'text' },
      ],
    };
    const sql = generateCreateTableSQL(model);
    const ownerMatches = sql.match(/"owner_id"/g) || [];
    expect(ownerMatches.length).toBe(1);
  });

  it('handles nullable columns', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'items',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'notes', type: 'text', isNullable: true },
      ],
    };
    const sql = generateCreateTableSQL(model);
    expect(sql).toContain('"notes" TEXT');
    expect(sql).not.toContain('"notes" TEXT NOT NULL');
  });

  it('handles string default value', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'items',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'status', type: 'text', defaultValue: 'active' },
      ],
    };
    const sql = generateCreateTableSQL(model);
    expect(sql).toContain("DEFAULT 'active'");
  });

  it('handles numeric default value', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'items',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'count', type: 'integer', defaultValue: 0, isNullable: true },
      ],
    };
    const sql = generateCreateTableSQL(model);
    expect(sql).toContain('DEFAULT 0');
  });

  it('handles boolean default value', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'items',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'active', type: 'integer', defaultValue: true, isNullable: true },
      ],
    };
    const sql = generateCreateTableSQL(model);
    expect(sql).toContain('DEFAULT 1');
  });

  it('handles null default value', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'items',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'notes', type: 'text', isNullable: true, defaultValue: null },
      ],
    };
    const sql = generateCreateTableSQL(model);
    expect(sql).toContain('DEFAULT NULL');
  });

  it('maps JSON type to TEXT', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'items',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'meta', type: 'json', isNullable: true },
      ],
    };
    const sql = generateCreateTableSQL(model);
    expect(sql).toContain('"meta" TEXT');
  });

  it('generates FOREIGN KEY constraint', () => {
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
    expect(sql).toContain('FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE');
  });

  it('generates FK with set_null on delete', () => {
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

  it('adds deleted_at column when softDelete is enabled', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'items',
      softDelete: true,
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'name', type: 'text' },
      ],
    };
    const sql = generateCreateTableSQL(model);
    expect(sql).toContain('"deleted_at" TEXT');
  });

  it('does not duplicate deleted_at if already in columns', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'items',
      softDelete: true,
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'deleted_at', type: 'text', isNullable: true },
      ],
    };
    const sql = generateCreateTableSQL(model);
    const matches = sql.match(/"deleted_at"/g) || [];
    expect(matches.length).toBe(1);
  });

  it('auto-adds id INTEGER PRIMARY KEY when no column has isPrimary', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'products',
      columns: [
        { name: 'title', type: 'text' },
        { name: 'price', type: 'real' },
      ],
    };
    const sql = generateCreateTableSQL(model);
    expect(sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(sql).toContain('"title" TEXT NOT NULL');
    expect(sql).toContain('"price" REAL NOT NULL');
  });

  it('does not add auto id when a column already has isPrimary', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'products',
      columns: [
        { name: 'sku', type: 'text', isPrimary: true },
        { name: 'title', type: 'text' },
      ],
    };
    const sql = generateCreateTableSQL(model);
    expect(sql).toContain('"sku" TEXT PRIMARY KEY NOT NULL');
    // Should NOT have an auto-added "id" column
    expect(sql).not.toMatch(/"id" INTEGER PRIMARY KEY/);
  });

  it('throws for invalid model name', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'invalid-name',
      columns: [{ name: 'id', type: 'integer', isPrimary: true }],
    };
    expect(() => generateCreateTableSQL(model)).toThrow('Invalid model name');
  });

  it('throws for invalid column name', () => {
    const model: ModelProps = {
      uuid: 'test',
      name: 'items',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'bad column', type: 'text' },
      ],
    };
    expect(() => generateCreateTableSQL(model)).toThrow('Invalid column name');
  });
});

describe('generateIndexSQL', () => {
  it('always creates owner_id index', () => {
    const indexes = generateIndexSQL(basicModel);
    const ownerIdx = indexes.find((s) => s.includes('owner_id'));
    expect(ownerIdx).toBeDefined();
    expect(ownerIdx).toContain('CREATE INDEX IF NOT EXISTS');
    expect(ownerIdx).toContain('"idx_contacts_owner_id"');
  });

  it('creates user-defined indexes', () => {
    const model: ModelProps = {
      ...basicModel,
      indexes: [{ name: 'idx_contacts_email', columns: ['email'], unique: false }],
    };
    const indexes = generateIndexSQL(model);
    expect(indexes.length).toBe(2); // owner_id + email
    expect(indexes[1]).toContain('"idx_contacts_email"');
    expect(indexes[1]).toContain('"email"');
  });

  it('creates unique indexes', () => {
    const model: ModelProps = {
      ...basicModel,
      indexes: [{ name: 'idx_contacts_email_unique', columns: ['email'], unique: true }],
    };
    const indexes = generateIndexSQL(model);
    expect(indexes[1]).toContain('CREATE UNIQUE INDEX');
  });

  it('creates multi-column indexes', () => {
    const model: ModelProps = {
      ...basicModel,
      indexes: [{ name: 'idx_name_email', columns: ['name', 'email'], unique: false }],
    };
    const indexes = generateIndexSQL(model);
    expect(indexes[1]).toContain('"name", "email"');
  });
});

describe('generateSchema', () => {
  it('combines tables and indexes for multiple models', () => {
    const models: ModelProps[] = [
      basicModel,
      {
        uuid: 'test2',
        name: 'tasks',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'title', type: 'text' },
        ],
      },
    ];
    const schema = generateSchema(models);
    expect(schema.createTables).toHaveLength(2);
    expect(schema.createIndexes.length).toBeGreaterThanOrEqual(2); // at least 2 owner_id indexes
    expect(schema.all.length).toBe(schema.createTables.length + schema.createIndexes.length);
  });
});

describe('generateSchemaSQL', () => {
  it('returns semicolon-delimited SQL string', () => {
    const models: ModelProps[] = [basicModel];
    const sql = generateSchemaSQL(models);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS');
    expect(sql.endsWith(';')).toBe(true);
  });
});
