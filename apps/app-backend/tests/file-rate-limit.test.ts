/**
 * Tests for file upload rate limiting
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkFileUploadRateLimit } from '../src/middleware/rateLimit';
import { createMockKV } from './helpers/mock-env';

describe('checkFileUploadRateLimit', () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    kv = createMockKV();
  });

  it('allows first upload and returns remaining count', async () => {
    const result = await checkFileUploadRateLimit(kv, 'user-1', '1.2.3.4', 1000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(59); // 60 max - 0 current - 1 just used
  });

  it('blocks after max uploads per hour with remaining=0', async () => {
    const windowStart = Math.floor(Date.now() / 1000 / 3600) * 3600;
    await kv.put(`frl:count:user-1:${windowStart}`, '60');

    const result = await checkFileUploadRateLimit(kv, 'user-1', '1.2.3.4', 1000);
    expect(result.allowed).toBe(false);
    expect(result.limitExceeded).toBe('upload_count');
    expect(result.remaining).toBe(0);
  });

  it('blocks after max bytes per hour', async () => {
    const windowStart = Math.floor(Date.now() / 1000 / 3600) * 3600;
    await kv.put(`frl:bytes:user-1:${windowStart}`, String(104_857_000));

    const result = await checkFileUploadRateLimit(kv, 'user-1', '1.2.3.4', 1000);
    expect(result.allowed).toBe(false);
    expect(result.limitExceeded).toBe('upload_bytes');
    expect(result.remaining).toBe(0);
  });

  it('allows when bytes under limit', async () => {
    const windowStart = Math.floor(Date.now() / 1000 / 3600) * 3600;
    await kv.put(`frl:bytes:user-1:${windowStart}`, String(100_000_000));

    const result = await checkFileUploadRateLimit(kv, 'user-1', '1.2.3.4', 1000);
    expect(result.allowed).toBe(true);
  });

  it('blocks unauthenticated IP after max IP uploads', async () => {
    const windowStart = Math.floor(Date.now() / 1000 / 3600) * 3600;
    await kv.put(`frl:ip:1.2.3.4:${windowStart}`, '10');

    const result = await checkFileUploadRateLimit(kv, null, '1.2.3.4', 1000);
    expect(result.allowed).toBe(false);
    expect(result.limitExceeded).toBe('ip_upload_count');
    expect(result.remaining).toBe(0);
  });

  it('increments user counters after successful check', async () => {
    await checkFileUploadRateLimit(kv, 'user-1', '1.2.3.4', 5000);

    const windowStart = Math.floor(Date.now() / 1000 / 3600) * 3600;
    const countVal = await kv.get(`frl:count:user-1:${windowStart}`);
    const bytesVal = await kv.get(`frl:bytes:user-1:${windowStart}`);
    expect(countVal).toBe('1');
    expect(bytesVal).toBe('5000');
  });

  it('increments IP counter for unauthenticated users', async () => {
    await checkFileUploadRateLimit(kv, null, '1.2.3.4', 1000);

    const windowStart = Math.floor(Date.now() / 1000 / 3600) * 3600;
    const ipVal = await kv.get(`frl:ip:1.2.3.4:${windowStart}`);
    expect(ipVal).toBe('1');
  });

  it('does not use IP counter for authenticated users', async () => {
    await checkFileUploadRateLimit(kv, 'user-1', '1.2.3.4', 1000);

    const windowStart = Math.floor(Date.now() / 1000 / 3600) * 3600;
    const ipVal = await kv.get(`frl:ip:1.2.3.4:${windowStart}`);
    expect(ipVal).toBeNull();
  });

  it('uses custom limits', async () => {
    const windowStart = Math.floor(Date.now() / 1000 / 3600) * 3600;
    await kv.put(`frl:count:user-1:${windowStart}`, '5');

    const result = await checkFileUploadRateLimit(kv, 'user-1', '1.2.3.4', 1000, {
      maxUploadsPerHour: 5,
    });
    expect(result.allowed).toBe(false);
    expect(result.limitExceeded).toBe('upload_count');
  });

  it('returns resetAt at end of current hour window', async () => {
    const result = await checkFileUploadRateLimit(kv, 'user-1', null, 1000);
    const windowStart = Math.floor(Date.now() / 1000 / 3600) * 3600;
    expect(result.resetAt).toBe(windowStart + 3600);
  });

  it('returns remaining for IP-based rate limiting', async () => {
    const result = await checkFileUploadRateLimit(kv, null, '1.2.3.4', 1000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9); // 10 max - 0 current - 1 just used
  });

  it('decrements remaining with each upload', async () => {
    const r1 = await checkFileUploadRateLimit(kv, 'user-1', '1.2.3.4', 1000);
    expect(r1.remaining).toBe(59);

    const r2 = await checkFileUploadRateLimit(kv, 'user-1', '1.2.3.4', 1000);
    expect(r2.remaining).toBe(58);
  });

  it('does not double-read KV keys (reuses cached values for increment)', async () => {
    const getSpy = vi.spyOn(kv, 'get');
    await checkFileUploadRateLimit(kv, 'user-1', '1.2.3.4', 1000);

    // Should read count + bytes = 2 KV gets (not 4 from double-reading)
    expect(getSpy).toHaveBeenCalledTimes(2);
    getSpy.mockRestore();
  });

  it('fails open when KV.get throws', async () => {
    const failKV = createMockKV();
    failKV.get = vi.fn().mockRejectedValue(new Error('KV unavailable'));

    const result = await checkFileUploadRateLimit(failKV, 'user-1', '1.2.3.4', 1000);
    expect(result.allowed).toBe(true);
  });

  it('fails open when KV.put throws (write errors)', async () => {
    const failKV = createMockKV();
    failKV.put = vi.fn().mockRejectedValue(new Error('KV write error'));

    const result = await checkFileUploadRateLimit(failKV, 'user-1', '1.2.3.4', 1000);
    expect(result.allowed).toBe(true);
  });

  it('handles both null userId and null clientIp', async () => {
    const result = await checkFileUploadRateLimit(kv, null, null, 1000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(60); // max (no counters to check)
  });
});
