// @vitest-environment node
/**
 * buildUserEnv must bind a rate-limit store in self-host (2026-06-27).
 *
 * The app-backend limiter is opt-in via RATE_LIMIT_KV; under WfP each app had a
 * KV, but the single-container runtime bound nothing, so auth brute-force /
 * signup spam went unthrottled. buildUserEnv now binds a per-(app,mode) KvShim
 * singleton. The singleton-ness is the crux: buildUserEnv runs per request, so a
 * fresh store each call would never accumulate counters → the limiter would be a
 * silent no-op.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUserEnv } from '../../../worker/src/server/build-user-env';

describe('buildUserEnv rate-limit binding', () => {
  // buildUserEnv opens the per-app SQLite eagerly, so it needs a writable data dir.
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'exepad-rl-'));
    process.env.EXEPAD_DATA_DIR = dataDir;
  });
  afterEach(() => {
    delete process.env.EXEPAD_DATA_DIR;
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('binds RATE_LIMIT_KV with a generous generic cap', () => {
    const env = buildUserEnv('appone', 'published');
    expect(env.RATE_LIMIT_KV).toBeDefined();
    // Generic per-identity cap is a DoS backstop, not the auth gate — must be
    // generous so normal CRUD/dashboard bursts are never throttled.
    expect(Number(env.RATE_LIMIT_MAX)).toBeGreaterThanOrEqual(600);
    expect(Number(env.RATE_LIMIT_WINDOW)).toBeGreaterThan(0);
  });

  it('returns the SAME store instance for the same app+mode (counters persist)', () => {
    const a = buildUserEnv('appone', 'published');
    const b = buildUserEnv('appone', 'published');
    expect(a.RATE_LIMIT_KV).toBe(b.RATE_LIMIT_KV);
  });

  it('isolates stores per app and per mode (no cross-app/-mode throttling)', () => {
    const previewOne = buildUserEnv('appone', 'preview');
    const publishedOne = buildUserEnv('appone', 'published');
    const previewTwo = buildUserEnv('apptwo', 'preview');
    expect(previewOne.RATE_LIMIT_KV).not.toBe(publishedOne.RATE_LIMIT_KV);
    expect(previewOne.RATE_LIMIT_KV).not.toBe(previewTwo.RATE_LIMIT_KV);
  });

  it('the bound store actually counts (get/put round-trips)', async () => {
    const env = buildUserEnv('countapp', 'published');
    const kv = env.RATE_LIMIT_KV as unknown as {
      get(k: string): Promise<string | null>;
      put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void>;
    };
    expect(await kv.get('k')).toBeNull();
    await kv.put('k', '1', { expirationTtl: 60 });
    expect(await kv.get('k')).toBe('1');
  });
});
