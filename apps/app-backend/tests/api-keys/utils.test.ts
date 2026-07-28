/**
 * Tests for API key utility functions — generation, prefix, hashing.
 */

import { describe, it, expect } from 'vitest';
import { generateApiKey, getKeyPrefix, hashApiKey } from '../../src/auth/api-keys';

describe('generateApiKey', () => {
  it('starts with exepad_sk_ prefix', () => {
    const key = generateApiKey();
    expect(key).toMatch(/^exepad_sk_/);
  });

  it('has correct total length (10 prefix + 48 hex = 58)', () => {
    const key = generateApiKey();
    expect(key).toHaveLength(58);
  });

  it('hex portion is valid hex characters', () => {
    const key = generateApiKey();
    const hex = key.slice(10); // after "exepad_sk_"
    expect(hex).toMatch(/^[0-9a-f]{48}$/);
  });

  it('generates unique keys', () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateApiKey()));
    expect(keys.size).toBe(20);
  });
});

describe('getKeyPrefix', () => {
  it('returns first 14 characters', () => {
    const key = 'exepad_sk_abcd1234567890abcdef1234567890abcdef12345678';
    expect(getKeyPrefix(key)).toBe('exepad_sk_abcd');
  });

  it('includes exepad_sk_ plus 4 hex chars', () => {
    const key = generateApiKey();
    const prefix = getKeyPrefix(key);
    expect(prefix).toHaveLength(14);
    expect(prefix).toMatch(/^exepad_sk_[0-9a-f]{4}$/);
  });
});

describe('hashApiKey', () => {
  it('produces a hex string', async () => {
    const key = generateApiKey();
    const hash = await hashApiKey(key);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('produces consistent hashes for the same input', async () => {
    const key = generateApiKey();
    const hash1 = await hashApiKey(key);
    const hash2 = await hashApiKey(key);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different keys', async () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    const hash1 = await hashApiKey(key1);
    const hash2 = await hashApiKey(key2);
    expect(hash1).not.toBe(hash2);
  });

  it('produces 64-char hex string (SHA-256 = 32 bytes)', async () => {
    const key = generateApiKey();
    const hash = await hashApiKey(key);
    expect(hash).toHaveLength(64);
  });
});
