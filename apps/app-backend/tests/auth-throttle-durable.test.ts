/**
 * Durable auth throttle (SQLite-backed, fail-closed) — 2026-07-04.
 *
 * The account-targeted auth limiter now persists its counters in the app SQLite
 * (env.DB) instead of a process-memory KV shim, so a restart can't reset the
 * throttle; it FAILS CLOSED for these auth methods when the store is down (a
 * generic RPC still fails open via KV), and applies a progressive lockout on
 * repeated abuse. These exercise: durability across a "restart" (a fresh DB
 * connection to the same file), fail-closed on DB error, the KV fallback, the
 * disabled (no-store) case, and lockout escalation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalD1 } from '@exepad/local-adapters/db';
import {
  checkAuthRateLimit,
  deriveAuthRateLimit,
  type RateLimitResult,
} from '../src/middleware/rateLimit';
import { createMockKV } from './helpers/mock-env';

const SIGNIN = deriveAuthRateLimit('auth_signin', { email: 'victim@example.com' })!; // max 8 / 300s

/** Call the throttle repeatedly until it blocks; return the first blocked result. */
async function exhaust(
  stores: { db?: D1Database; kv?: KVNamespace },
  desc = SIGNIN,
  cap = 20,
): Promise<RateLimitResult> {
  let last: RateLimitResult = { allowed: true, remaining: 0, resetAt: 0 };
  for (let i = 0; i < cap; i++) {
    last = await checkAuthRateLimit(desc, stores);
    if (!last.allowed) return last;
  }
  return last;
}

describe('checkAuthRateLimit — durability', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'exepad-throttle-'));
    file = join(dir, 'app.sqlite');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('counters survive a process restart (new connection to the same DB file)', async () => {
    const raw1 = new Database(file);
    const db1 = new LocalD1(raw1) as unknown as D1Database;

    // Burn the whole window: attempts 1..max allowed, max+1 blocked.
    for (let i = 0; i < SIGNIN.max; i++) {
      const r = await checkAuthRateLimit(SIGNIN, { db: db1 });
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkAuthRateLimit(SIGNIN, { db: db1 });
    expect(blocked.allowed).toBe(false);
    raw1.close(); // "process exits"

    // "Restart": a brand-new connection + adapter over the SAME file.
    const raw2 = new Database(file);
    const db2 = new LocalD1(raw2) as unknown as D1Database;
    const afterRestart = await checkAuthRateLimit(SIGNIN, { db: db2 });
    expect(afterRestart.allowed).toBe(false); // still throttled — counter persisted
    raw2.close();
  });

  it('keeps distinct target accounts in independent buckets', async () => {
    const raw = new Database(file);
    const db = new LocalD1(raw) as unknown as D1Database;
    await exhaust({ db }); // victim@example.com exhausted

    const other = deriveAuthRateLimit('auth_signin', { email: 'bystander@example.com' })!;
    const r = await checkAuthRateLimit(other, { db });
    expect(r.allowed).toBe(true); // no collateral lockout
    raw.close();
  });
});

describe('checkAuthRateLimit — failure model', () => {
  it('FAILS CLOSED for auth when the durable store errors and no KV fallback', async () => {
    const throwingDb = {
      prepare() {
        throw new Error('sqlite unavailable');
      },
    } as unknown as D1Database;
    const r = await checkAuthRateLimit(SIGNIN, { db: throwingDb });
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('falls back to the KV counter when the durable store errors', async () => {
    const throwingDb = {
      prepare() {
        throw new Error('sqlite unavailable');
      },
    } as unknown as D1Database;
    const kv = createMockKV();
    const r = await checkAuthRateLimit(SIGNIN, { db: throwingDb, kv });
    expect(r.allowed).toBe(true); // KV path (fail-open) kept the request flowing
  });

  it('is disabled (allows) when neither a durable store nor KV is configured', async () => {
    const r = await checkAuthRateLimit(SIGNIN, {});
    expect(r.allowed).toBe(true);
  });
});

describe('checkAuthRateLimit — progressive lockout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('escalates the lockout duration on repeated abuse and decays after recovery', async () => {
    const raw = new Database(':memory:');
    const db = new LocalD1(raw) as unknown as D1Database;

    // ── Strike 1 at T0 ──
    const t0 = 1_000_000_000_000; // fixed epoch ms
    vi.setSystemTime(t0);
    const first = await exhaust({ db });
    expect(first.allowed).toBe(false);
    const firstLockout = first.resetAt - Math.floor(t0 / 1000);
    expect(firstLockout).toBe(SIGNIN.window); // base window (300s)

    // ── Move past the lockout AND into a fresh window, then re-abuse ──
    const t1 = t0 + (SIGNIN.window + 100) * 1000;
    vi.setSystemTime(t1);
    const second = await exhaust({ db });
    expect(second.allowed).toBe(false);
    const secondLockout = second.resetAt - Math.floor(t1 / 1000);
    expect(secondLockout).toBe(SIGNIN.window * 2); // doubled (600s)

    raw.close();
  });
});
