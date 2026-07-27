/**
 * Unit tests for schema builder (generateCreateTableSQL)
 */

import { describe, it, expect } from 'vitest';
import { generateCreateTableSQL } from '../src/schema/builder';
import type { ModelProps } from '../src/schema/types';

describe('generateCreateTableSQL', () => {
  const baseModel: ModelProps = {
    uuid: 'test',
    name: 'items',
    columns: [
      { name: 'id', type: 'integer', isPrimary: true },
      { name: 'title', type: 'text' },
    ],
  };

  it('generates valid CREATE TABLE', () => {
    const sql = generateCreateTableSQL(baseModel);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "items"');
    expect(sql).toContain('"id"');
    expect(sql).toContain('"title"');
  });

  it('throws for invalid model name', () => {
    const bad: ModelProps = { ...baseModel, name: 'has-dash' };
    expect(() => generateCreateTableSQL(bad)).toThrow('Invalid model name');
  });

  it('throws for invalid column name', () => {
    const bad: ModelProps = {
      ...baseModel,
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: '123bad', type: 'text' },
      ],
    };
    expect(() => generateCreateTableSQL(bad)).toThrow('Invalid column name');
  });

  describe('ON DELETE clause', () => {
    it('adds ON DELETE CASCADE when onDelete is cascade', () => {
      const model: ModelProps = {
        ...baseModel,
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'parent_id', type: 'integer', references: { model: 'parents', column: 'id', onDelete: 'cascade' } },
        ],
      };
      const sql = generateCreateTableSQL(model);
      expect(sql).toContain('ON DELETE CASCADE');
    });

    it('adds ON DELETE SET NULL when onDelete is set_null', () => {
      const model: ModelProps = {
        ...baseModel,
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'parent_id', type: 'integer', references: { model: 'parents', column: 'id', onDelete: 'set_null' } },
        ],
      };
      const sql = generateCreateTableSQL(model);
      expect(sql).toContain('ON DELETE SET NULL');
    });

    it('defaults to ON DELETE CASCADE when onDelete is not set', () => {
      const model: ModelProps = {
        ...baseModel,
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'parent_id', type: 'integer', references: { model: 'parents', column: 'id' } },
        ],
      };
      const sql = generateCreateTableSQL(model);
      expect(sql).toContain('ON DELETE CASCADE');
    });
  });

  describe('softDelete flag', () => {
    it('auto-adds deleted_at column when softDelete is true', () => {
      const model: ModelProps = { ...baseModel, softDelete: true };
      const sql = generateCreateTableSQL(model);
      expect(sql).toContain('"deleted_at"');
    });

    it('does not add deleted_at when softDelete is false or absent', () => {
      const sql = generateCreateTableSQL(baseModel);
      expect(sql).not.toContain('"deleted_at"');
    });
  });
});
