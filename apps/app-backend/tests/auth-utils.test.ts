/**
 * Auth Utility Tests
 *
 * Covers: password hashing (PBKDF2), session token generation/hashing,
 * UUID generation, email validation, password policy validation, timestamps.
 */

import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  generateSessionToken,
  hashSessionToken,
  generateId,
  isValidEmail,
  validatePassword,
  now,
  expiresAt,
} from '../src/auth/utils';

// ── Password Hashing ────────────────────────────────────────────────

describe('hashPassword', () => {
  it('returns pbkdf2:{iterations}:{salt}:{hash} format', async () => {
    const hash = await hashPassword('testPassword123');
    const parts = hash.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('pbkdf2');
    // OWASP 2023 work factor for PBKDF2-HMAC-SHA256.
    expect(parseInt(parts[1], 10)).toBe(600_000);
    // salt and hash should be hex strings
    expect(parts[2]).toMatch(/^[0-9a-f]+$/);
    expect(parts[3]).toMatch(/^[0-9a-f]+$/);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const hash1 = await hashPassword('samePassword');
    const hash2 = await hashPassword('samePassword');
    expect(hash1).not.toBe(hash2);
  });

  it('salt is 32 hex chars (16 bytes)', async () => {
    const hash = await hashPassword('test');
    const salt = hash.split(':')[2];
    expect(salt).toHaveLength(32);
  });

  it('hash is 64 hex chars (32 bytes)', async () => {
    const hash = await hashPassword('test');
    const hashHex = hash.split(':')[3];
    expect(hashHex).toHaveLength(64);
  });
});

describe('verifyPassword', () => {
  it('returns true for correct password', async () => {
    const hash = await hashPassword('correctPassword');
    expect(await verifyPassword('correctPassword', hash)).toBe(true);
  });

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('correctPassword');
    expect(await verifyPassword('wrongPassword', hash)).toBe(false);
  });

  it('returns false for malformed hash string (missing parts)', async () => {
    expect(await verifyPassword('any', 'pbkdf2:100000:abc')).toBe(false);
  });

  it('returns false for non-pbkdf2 prefix', async () => {
    expect(await verifyPassword('any', 'bcrypt:100000:aabb:ccdd')).toBe(false);
  });

  it('returns false for empty hash', async () => {
    expect(await verifyPassword('any', '')).toBe(false);
  });

  it('throws on odd-length hex in stored hash salt', async () => {
    // Crafted hash with odd-length salt
    await expect(
      verifyPassword('any', 'pbkdf2:100000:abc:aabbccdd')
    ).rejects.toThrow('Invalid hex string: odd length');
  });

  it('throws on non-hex characters in stored hash', async () => {
    await expect(
      verifyPassword('any', 'pbkdf2:100000:gggg:aabbccdd')
    ).rejects.toThrow('Invalid hex string: non-hex characters');
  });

});

// ── Rehash-on-login (transparent work-factor upgrade) ────────────────

describe('needsRehash', () => {
  it('flags a below-strength (100k) hash for upgrade', () => {
    expect(needsRehash('pbkdf2:100000:aabb:ccdd')).toBe(true);
  });

  it('does not flag a current-strength (600k) hash', () => {
    expect(needsRehash('pbkdf2:600000:aabb:ccdd')).toBe(false);
  });

  it('flags an unrecognized or malformed hash format', () => {
    expect(needsRehash('bcrypt:10:aabb:ccdd')).toBe(true);
    expect(needsRehash('pbkdf2:notanumber:aabb:ccdd')).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
  });

  it('a freshly produced hash never needs a rehash', async () => {
    expect(needsRehash(await hashPassword('whatever'))).toBe(false);
  });
});

// ── Session Tokens ──────────────────────────────────────────────────

describe('generateSessionToken', () => {
  it('returns 64-char hex string (32 bytes)', () => {
    const token = generateSessionToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it('produces unique tokens on each call', () => {
    const tokens = new Set(Array.from({ length: 10 }, () => generateSessionToken()));
    expect(tokens.size).toBe(10);
  });
});

describe('hashSessionToken', () => {
  it('returns 64-char hex string (SHA-256)', async () => {
    const hash = await hashSessionToken('some-token');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('same input produces same hash (deterministic)', async () => {
    const hash1 = await hashSessionToken('token-abc');
    const hash2 = await hashSessionToken('token-abc');
    expect(hash1).toBe(hash2);
  });

  it('different inputs produce different hashes', async () => {
    const hash1 = await hashSessionToken('token-a');
    const hash2 = await hashSessionToken('token-b');
    expect(hash1).not.toBe(hash2);
  });
});

// ── UUID ────────────────────────────────────────────────────────────

describe('generateId', () => {
  it('returns valid UUID v4 format', () => {
    const id = generateId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('produces unique IDs', () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateId()));
    expect(ids.size).toBe(10);
  });
});

// ── Email Validation ────────────────────────────────────────────────

describe('isValidEmail', () => {
  it('accepts valid emails', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('a.b+c@foo.co.uk')).toBe(true);
    expect(isValidEmail('test123@domain.org')).toBe(true);
  });

  it('rejects email without @', () => {
    expect(isValidEmail('userexample.com')).toBe(false);
  });

  it('rejects email without domain', () => {
    expect(isValidEmail('user@')).toBe(false);
  });

  it('rejects email with spaces', () => {
    expect(isValidEmail('user @example.com')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });

  it('rejects emails > 254 characters', () => {
    const longEmail = 'a'.repeat(250) + '@b.co';
    expect(longEmail.length).toBeGreaterThan(254);
    expect(isValidEmail(longEmail)).toBe(false);
  });
});

// ── Password Validation ─────────────────────────────────────────────

describe('validatePassword', () => {
  it('returns null for valid password (>= 8 chars)', () => {
    expect(validatePassword('password123')).toBeNull();
  });

  it('returns error for short password', () => {
    expect(validatePassword('short')).toMatch(/at least 8 characters/);
  });

  it('enforces minLength from policy', () => {
    expect(validatePassword('12345678', { minLength: 10 })).toMatch(/at least 10/);
    expect(validatePassword('1234567890', { minLength: 10 })).toBeNull();
  });

  it('enforces requireUppercase when set', () => {
    expect(validatePassword('alllowercase', { requireUppercase: true })).toMatch(/uppercase/);
    expect(validatePassword('hasUpperCase', { requireUppercase: true })).toBeNull();
  });

  it('enforces requireNumber when set', () => {
    expect(validatePassword('nonumber!!', { requireNumber: true })).toMatch(/number/);
    expect(validatePassword('hasnumber1', { requireNumber: true })).toBeNull();
  });

  it('allows any password >= 8 chars when policy is undefined', () => {
    expect(validatePassword('simpleeee')).toBeNull();
  });
});

// ── Timestamps ──────────────────────────────────────────────────────

describe('now', () => {
  it('returns ISO 8601 string', () => {
    const result = now();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(() => new Date(result)).not.toThrow();
  });
});

describe('expiresAt', () => {
  it('returns future timestamp for positive seconds', () => {
    const before = Date.now();
    const result = expiresAt(3600);
    const resultMs = new Date(result).getTime();
    // Should be roughly 1 hour from now (within 1s tolerance)
    expect(resultMs).toBeGreaterThan(before + 3599000);
    expect(resultMs).toBeLessThan(before + 3601000);
  });
});
