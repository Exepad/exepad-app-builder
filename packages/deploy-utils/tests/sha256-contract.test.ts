/**
 * Tests for SHA-256 content hash contract
 *
 * Verifies that the CONTENT_HASH_LENGTH and CONTENT_HASH_PREFIX constants
 * match the expected truncated hex output from node:crypto.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { CONTENT_HASH_LENGTH, CONTENT_HASH_PREFIX } from '../src/deploy/r2-paths';

describe('SHA-256 content hash contract', () => {
  it('truncated SHA-256 of "hello world" is 12 hex chars', () => {
    const hash = createHash('sha256').update('hello world').digest('hex');
    const truncated = hash.slice(0, CONTENT_HASH_LENGTH);

    // Full SHA-256 of "hello world": b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    expect(truncated).toBe('b94d27b9934d');
    expect(truncated).toHaveLength(12);
  });

  it('CONTENT_HASH_LENGTH is 12', () => {
    expect(CONTENT_HASH_LENGTH).toBe(12);
  });

  it('CONTENT_HASH_PREFIX is "sha256"', () => {
    expect(CONTENT_HASH_PREFIX).toBe('sha256');
  });

  it('formatted hash string matches expected pattern', () => {
    const hash = createHash('sha256').update('hello world').digest('hex');
    const truncated = hash.slice(0, CONTENT_HASH_LENGTH);
    const formatted = `${CONTENT_HASH_PREFIX}:${truncated}`;

    expect(formatted).toBe('sha256:b94d27b9934d');
    expect(formatted).toMatch(/^sha256:[0-9a-f]{12}$/);
  });
});
