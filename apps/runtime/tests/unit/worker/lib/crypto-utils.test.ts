/**
 * crypto-utils.ts — constant-time comparison for secret/signature checks.
 *
 * This exercises the REAL implementation. Elsewhere in the suite
 * `constantTimeEqual` is frequently mocked to a trivial `a === b`, so its
 * actual length-XOR / charCode-XOR logic goes untested. A regression here
 * (e.g. an early-return short-circuit, or a length-mismatch that throws
 * mid-comparison) is a timing-attack / auth-bypass hole, so we assert the
 * exact boolean contract across boundary, unicode, and malformed inputs.
 */

import { describe, it, expect } from 'vitest';
import { constantTimeEqual } from '../../../../worker/src/lib/crypto-utils';

describe('constantTimeEqual', () => {
  // ── Equality (true) cases ────────────────────────────────────────
  describe('returns true for equal strings', () => {
    it('treats two empty strings as equal', () => {
      expect(constantTimeEqual('', '')).toBe(true);
    });

    it('treats identical ASCII strings as equal', () => {
      expect(constantTimeEqual('abc', 'abc')).toBe(true);
    });

    it('treats identical secret-shaped tokens as equal', () => {
      const tok = 'exepad_sk_' + 'a1b2c3d4'.repeat(8);
      expect(constantTimeEqual(tok, tok)).toBe(true);
    });

    it('treats identical single-character strings as equal', () => {
      expect(constantTimeEqual('x', 'x')).toBe(true);
    });

    it('treats identical unicode strings as equal', () => {
      expect(constantTimeEqual('héllo·世界', 'héllo·世界')).toBe(true);
    });

    it('treats strings containing a NUL byte as equal to themselves', () => {
      expect(constantTimeEqual('a\0b', 'a\0b')).toBe(true);
    });
  });

  // ── Inequality (false) cases ─────────────────────────────────────
  describe('returns false for differing strings', () => {
    it('rejects same-length strings differing in one char', () => {
      expect(constantTimeEqual('abc', 'abd')).toBe(false);
    });

    it('rejects same-length strings differing in the first char', () => {
      expect(constantTimeEqual('Xbc', 'abc')).toBe(false);
    });

    it('rejects same-length strings differing only in case', () => {
      expect(constantTimeEqual('ABC', 'abc')).toBe(false);
    });

    it('rejects a string vs the same string with a trailing NUL', () => {
      // 'abc' vs 'abc\0' — classic length-XOR trap: charCodeAt past the
      // shorter string is NaN, so the impl must use `|| 0` AND fold in the
      // length difference. A naive loop over the shorter length would
      // wrongly report equal here.
      expect(constantTimeEqual('abc', 'abc\0')).toBe(false);
      expect(constantTimeEqual('abc\0', 'abc')).toBe(false);
    });

    it('rejects strings of differing length (prefix relationship)', () => {
      expect(constantTimeEqual('abc', 'abcd')).toBe(false);
      expect(constantTimeEqual('abcd', 'abc')).toBe(false);
    });

    it('rejects empty vs non-empty in both orders', () => {
      expect(constantTimeEqual('', 'a')).toBe(false);
      expect(constantTimeEqual('a', '')).toBe(false);
    });

    it('rejects differing unicode strings', () => {
      expect(constantTimeEqual('héllo·世界', 'héllo·世堺')).toBe(false);
    });

    it('rejects when a NUL byte differs from a real char', () => {
      // Guards against the `|| 0` fallback masking a real NUL char.
      expect(constantTimeEqual('a\0c', 'abc')).toBe(false);
    });

    it('rejects a long token differing only in the last char', () => {
      const base = 'token_' + '9'.repeat(120);
      const tampered = base.slice(0, -1) + '8';
      expect(constantTimeEqual(base, tampered)).toBe(false);
    });
  });

  // ── Robustness: never throws ─────────────────────────────────────
  describe('never throws', () => {
    it('does not throw on two empty strings', () => {
      expect(() => constantTimeEqual('', '')).not.toThrow();
    });

    it('does not throw on empty vs long string', () => {
      expect(() => constantTimeEqual('', 'x'.repeat(10_000))).not.toThrow();
    });

    it('does not throw on large differing-length inputs', () => {
      const a = 'a'.repeat(5000);
      const b = 'b'.repeat(7000);
      expect(constantTimeEqual(a, b)).toBe(false);
    });
  });

  // ── Symmetry property ────────────────────────────────────────────
  describe('is order-independent', () => {
    it.each([
      ['', ''],
      ['abc', 'abc'],
      ['abc', 'abd'],
      ['abc', 'abcd'],
      ['a\0', 'a'],
      ['héllo', 'hello'],
    ])('constantTimeEqual(%j, %j) === constantTimeEqual(reversed args)', (a, b) => {
      expect(constantTimeEqual(a, b)).toBe(constantTimeEqual(b, a));
    });
  });
});
