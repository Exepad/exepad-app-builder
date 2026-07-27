/**
 * Tests for generateFilesDDL
 *
 * Verifies the _files system table DDL is correct and idempotent.
 */

import { describe, it, expect } from 'vitest';
import { generateFilesDDL } from '../src/schema/builder';

describe('generateFilesDDL', () => {
  const statements = generateFilesDDL();

  it('returns an array of SQL statements', () => {
    expect(Array.isArray(statements)).toBe(true);
    expect(statements.length).toBeGreaterThan(0);
  });

  it('first statement creates the _files table', () => {
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS "_files"');
  });

  it('table has required columns', () => {
    const createTable = statements[0];
    const requiredColumns = [
      '"id" TEXT PRIMARY KEY',
      '"owner_id" TEXT NOT NULL',
      '"app_id" TEXT NOT NULL',
      '"filename" TEXT NOT NULL',
      '"content_type" TEXT NOT NULL',
      '"size_bytes" INTEGER NOT NULL',
      '"r2_key" TEXT NOT NULL UNIQUE',
      '"visibility" TEXT NOT NULL',
      '"created_at" TEXT NOT NULL',
      '"updated_at" TEXT NOT NULL',
    ];
    for (const col of requiredColumns) {
      expect(createTable).toContain(col);
    }
  });

  it('table has nullable optional columns', () => {
    const createTable = statements[0];
    expect(createTable).toContain('"model_name" TEXT');
    expect(createTable).toContain('"record_id" TEXT');
    expect(createTable).toContain('"field_name" TEXT');
    expect(createTable).toContain('"metadata" TEXT');
    expect(createTable).toContain('"thumbnail_r2_key" TEXT');
    expect(createTable).toContain('"deleted_at" TEXT');
  });

  it('has default visibility of private', () => {
    expect(statements[0]).toContain("DEFAULT 'private'");
  });

  it('creates indexes', () => {
    const indexStatements = statements.slice(1);
    expect(indexStatements.length).toBeGreaterThanOrEqual(3);

    // Owner index
    const ownerIdx = indexStatements.find((s) => s.includes('idx_files_owner'));
    expect(ownerIdx).toBeDefined();
    expect(ownerIdx).toContain('"owner_id"');

    // Model index (composite)
    const modelIdx = indexStatements.find((s) => s.includes('idx_files_model'));
    expect(modelIdx).toBeDefined();
    expect(modelIdx).toContain('"model_name"');
    expect(modelIdx).toContain('"record_id"');

    // Created index
    const createdIdx = indexStatements.find((s) => s.includes('idx_files_created'));
    expect(createdIdx).toBeDefined();
    expect(createdIdx).toContain('"created_at"');
  });

  it('uses IF NOT EXISTS for idempotency', () => {
    for (const stmt of statements) {
      expect(stmt).toContain('IF NOT EXISTS');
    }
  });

  it('returns consistent results across calls', () => {
    const first = generateFilesDDL();
    const second = generateFilesDDL();
    expect(first).toEqual(second);
  });
});
