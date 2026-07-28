/**
 * Tests for rate limiting middleware
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkRateLimit } from '../src/middleware/rateLimit';
import { createMockKV } from './helpers/mock-env';

describe('checkRateLimit', () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    kv = createMockKV();
  });

  it('allows first request within window', async () => {
    const result = await checkRateLimit(kv, 'user-1', 10, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('decrements remaining with each request', async () => {
    const r1 = await checkRateLimit(kv, 'user-1', 10, 60);
    expect(r1.remaining).toBe(9);

    const r2 = await checkRateLimit(kv, 'user-1', 10, 60);
    expect(r2.remaining).toBe(8);

    const r3 = await checkRateLimit(kv, 'user-1', 10, 60);
    expect(r3.remaining).toBe(7);
  });

  it('blocks when at limit', async () => {
    // Simulate counter already at max
    const windowStart = Math.floor(Date.now() / 1000 / 60) * 60;
    const kvKey = `rl:user-1:${windowStart}`;
    await kv.put(kvKey, '10');

    const result = await checkRateLimit(kv, 'user-1', 10, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('blocks when over limit', async () => {
    const windowStart = Math.floor(Date.now() / 1000 / 60) * 60;
    const kvKey = `rl:user-1:${windowStart}`;
    await kv.put(kvKey, '15');

    const result = await checkRateLimit(kv, 'user-1', 10, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('returns resetAt in the future', async () => {
    const result = await checkRateLimit(kv, 'user-1', 10, 60);
    const now = Math.floor(Date.now() / 1000);
    expect(result.resetAt).toBeGreaterThanOrEqual(now);
    expect(result.resetAt).toBeLessThanOrEqual(now + 60);
  });

  it('uses different keys for different users', async () => {
    await checkRateLimit(kv, 'user-1', 10, 60);
    await checkRateLimit(kv, 'user-2', 10, 60);

    // Both should have 9 remaining (separate counters)
    const r1 = await checkRateLimit(kv, 'user-1', 10, 60);
    const r2 = await checkRateLimit(kv, 'user-2', 10, 60);
    expect(r1.remaining).toBe(8);
    expect(r2.remaining).toBe(8);
  });

  it('fails open when KV.get throws', async () => {
    const failKV = createMockKV();
    failKV.get = vi.fn().mockRejectedValue(new Error('KV unavailable'));

    const result = await checkRateLimit(failKV, 'user-1', 10, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
  });

  it('still allows when KV.put throws (fail-open on write)', async () => {
    const failKV = createMockKV();
    failKV.put = vi.fn().mockRejectedValue(new Error('KV write error'));

    const result = await checkRateLimit(failKV, 'user-1', 10, 60);
    expect(result.allowed).toBe(true);
    // remaining is still decremented (locally computed)
    expect(result.remaining).toBe(9);
  });

  it('handles different window sizes', async () => {
    const result = await checkRateLimit(kv, 'user-1', 5, 30);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);

    const now = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / 30) * 30;
    expect(result.resetAt).toBe(windowStart + 30);
  });

  it('handles max=1 (single request per window)', async () => {
    const r1 = await checkRateLimit(kv, 'user-1', 1, 60);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(0);

    const r2 = await checkRateLimit(kv, 'user-1', 1, 60);
    expect(r2.allowed).toBe(false);
    expect(r2.remaining).toBe(0);
  });

  // ── P7: Rate limit edge cases ──────────────────────────────────

  it('handles non-numeric KV value (corrupted data) — allows request', async () => {
    const windowStart = Math.floor(Date.now() / 1000 / 60) * 60;
    const kvKey = `rl:user-1:${windowStart}`;
    await kv.put(kvKey, 'corrupted');

    // parseInt("corrupted") = NaN → NaN >= 10 is false → allows
    const result = await checkRateLimit(kv, 'user-1', 10, 60);
    expect(result.allowed).toBe(true);
  });

  it('handles NaN max gracefully — allows all requests', async () => {
    // NaN max: current >= NaN is always false → always allows
    const result = await checkRateLimit(kv, 'user-1', NaN, 60);
    expect(result.allowed).toBe(true);
  });

  it('handles max=0 — blocks all requests', async () => {
    // current (0) >= max (0) → true → blocked
    const result = await checkRateLimit(kv, 'user-1', 0, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});
