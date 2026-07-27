/**
 * API Keys DDL Generation Tests
 *
 * Covers: generateApiKeysDDL() — table creation, indexes, constraints, idempotency.
 */

import { describe, it, expect } from 'vitest';
import { generateApiKeysDDL } from '../src/schema/builder';

describe('generateApiKeysDDL', () => {
  const ddl = generateApiKeysDDL();

  it('returns array of SQL statements', () => {
    expect(Array.isArray(ddl)).toBe(true);
    expect(ddl.length).toBeGreaterThan(0);
  });

  it('returns 4 statements (1 table + 3 indexes)', () => {
    expect(ddl).toHaveLength(4);
  });

  describe('table creation', () => {
    const createTable = ddl[0];

    it('uses CREATE TABLE IF NOT EXISTS for idempotency', () => {
      expect(createTable).toContain('CREATE TABLE IF NOT EXISTS');
    });

    it('creates _auth_api_keys table', () => {
      expect(createTable).toContain('"_auth_api_keys"');
    });

    it('has id as TEXT PRIMARY KEY', () => {
      expect(createTable).toContain('"id" TEXT PRIMARY KEY');
    });

    it('has name NOT NULL', () => {
      expect(createTable).toContain('"name" TEXT NOT NULL');
    });

    it('has key_hash UNIQUE NOT NULL', () => {
      expect(createTable).toContain('"key_hash" TEXT UNIQUE NOT NULL');
    });

    it('has key_prefix NOT NULL', () => {
      expect(createTable).toContain('"key_prefix" TEXT NOT NULL');
    });

    it('has user_id with FK to _auth_users', () => {
      expect(createTable).toContain('"user_id" TEXT NOT NULL REFERENCES "_auth_users"("id") ON DELETE CASCADE');
    });

    it('has scopes with default empty array', () => {
      expect(createTable).toContain(`"scopes" TEXT NOT NULL DEFAULT '[]'`);
    });

    it('has nullable expires_at, last_used_at, revoked_at', () => {
      expect(createTable).toContain('"expires_at" TEXT');
      expect(createTable).toContain('"last_used_at" TEXT');
      expect(createTable).toContain('"revoked_at" TEXT');
    });

    it('has created_at and updated_at NOT NULL', () => {
      expect(createTable).toContain('"created_at" TEXT NOT NULL');
      expect(createTable).toContain('"updated_at" TEXT NOT NULL');
    });
  });

  describe('indexes', () => {
    it('creates index on key_hash', () => {
      const idx = ddl.find((s) => s.includes('idx_auth_api_keys_key_hash'));
      expect(idx).toBeDefined();
      expect(idx).toContain('CREATE INDEX IF NOT EXISTS');
      expect(idx).toContain('"key_hash"');
    });

    it('creates index on user_id', () => {
      const idx = ddl.find((s) => s.includes('idx_auth_api_keys_user_id'));
      expect(idx).toBeDefined();
      expect(idx).toContain('"user_id"');
    });

    it('creates index on key_prefix', () => {
      const idx = ddl.find((s) => s.includes('idx_auth_api_keys_key_prefix'));
      expect(idx).toBeDefined();
      expect(idx).toContain('"key_prefix"');
    });
  });
});
