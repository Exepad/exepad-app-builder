/**
 * Auth DDL Generation Tests
 *
 * Covers: generateAuthDDL() — table creation, indexes, constraints, idempotency.
 */

import { describe, it, expect } from 'vitest';
import { generateAuthDDL } from '../src/schema/builder';

describe('generateAuthDDL', () => {
  const ddl = generateAuthDDL();

  it('returns array of SQL statements', () => {
    expect(Array.isArray(ddl)).toBe(true);
    expect(ddl.length).toBeGreaterThan(0);
  });

  it('includes CREATE TABLE for _auth_users', () => {
    const stmt = ddl.find((s) => s.includes('CREATE TABLE') && s.includes('_auth_users'));
    expect(stmt).toBeDefined();
    expect(stmt).toContain('"id" TEXT PRIMARY KEY');
    expect(stmt).toContain('"email" TEXT');
    expect(stmt).toContain('"password_hash" TEXT');
    expect(stmt).toContain('"roles" TEXT');
  });

  it('includes CREATE TABLE for _auth_sessions with foreign key', () => {
    const stmt = ddl.find((s) => s.includes('CREATE TABLE') && s.includes('_auth_sessions'));
    expect(stmt).toBeDefined();
    expect(stmt).toContain('"user_id" TEXT');
    expect(stmt).toContain('"expires_at" TEXT');
    expect(stmt).toContain('REFERENCES "_auth_users"');
  });

  it('_auth_sessions has CASCADE on delete', () => {
    const stmt = ddl.find((s) => s.includes('CREATE TABLE') && s.includes('_auth_sessions'));
    expect(stmt).toBeDefined();
    expect(stmt).toContain('ON DELETE CASCADE');
  });

  it('includes CREATE TABLE for _auth_accounts with unique constraint', () => {
    const stmt = ddl.find((s) => s.includes('CREATE TABLE') && s.includes('_auth_accounts'));
    expect(stmt).toBeDefined();
    expect(stmt).toContain('"provider" TEXT');
    expect(stmt).toContain('"provider_account_id" TEXT');
    // Unique constraint on provider + provider_account_id
    expect(stmt).toContain('UNIQUE');
  });

  it('includes CREATE TABLE for _auth_verification_tokens', () => {
    const stmt = ddl.find((s) => s.includes('CREATE TABLE') && s.includes('_auth_verification_tokens'));
    expect(stmt).toBeDefined();
    expect(stmt).toContain('"token" TEXT');
  });

  it('includes CREATE INDEX statements', () => {
    const indexes = ddl.filter((s) => s.includes('CREATE INDEX'));
    expect(indexes.length).toBeGreaterThan(0);
  });

  it('all tables use IF NOT EXISTS for idempotency', () => {
    const createStatements = ddl.filter((s) => s.includes('CREATE TABLE'));
    for (const stmt of createStatements) {
      expect(stmt).toContain('IF NOT EXISTS');
    }
  });

  it('index statements use IF NOT EXISTS for idempotency', () => {
    const indexStatements = ddl.filter((s) => s.includes('CREATE INDEX'));
    for (const stmt of indexStatements) {
      expect(stmt).toContain('IF NOT EXISTS');
    }
  });
});
