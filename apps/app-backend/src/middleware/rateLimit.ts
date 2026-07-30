/**
 * Rate Limiting via Cloudflare KV
 *
 * Uses a fixed-window counter. Entirely opt-in:
 * if `RATE_LIMIT_KV` is not bound, rate limiting is a no-op.
 *
 * Design notes:
 * - Fails open: if KV is unreachable, the request is allowed through (H1).
 * - Best-effort enforcement: KV's eventual consistency means concurrent requests
 *   may slightly exceed the limit (TOCTOU). Acceptable for abuse prevention,
 *   not for billing or strict quota enforcement (H2).
 */

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in the current window */
  remaining: number;
  /** Epoch seconds when the current window resets */
  resetAt: number;
}

// ── Auth brute-force / spam throttle ─────────────────────────────
//
// The unauthenticated auth surface (sign-in password guessing, sign-up
// flooding, reset-email bombing) needs a TIGHTER limit than the generic
// per-identity RPC cap, and it must work in self-host where NO client IP is
// available (the runtime serves via `@hono/node-server` with only a WHATWG
// Request — no socket, no proxy `x-forwarded-for`). So account-targeted methods
// are keyed on the targeted EMAIL (protecting each account regardless of the
// attacker's origin) and sign-up is keyed per-app (a flood cap). The store is a
// per-app KV, so keys are already app-isolated. Still opt-in via RATE_LIMIT_KV.

// The generic `checkRateLimit` (KV) fails OPEN and its self-host binding is an
// in-process counter whose windows are LOST on restart — fine for the generic
// per-identity RPC cap, but too weak for the account-targeted AUTH surface. For
// auth, use `checkAuthRateLimit` below: it persists counters in the app SQLite
// (env.DB) so windows + lockouts survive a process restart, FAILS CLOSED
// specifically for these auth methods (a store outage must not silently disable
// brute-force protection), applies a progressive lockout on repeated abuse, and
// keeps the KV counter as a fallback. `deriveAuthRateLimit` still describes the
// bucket; only the counter store and the failure mode differ from the generic path.
interface AuthLimitRule {
  /** 'email' → key on the targeted account; 'global' → one bucket for the app. */
  kind: 'email' | 'global';
  /** Max attempts per window. */
  max: number;
  /** Window length in seconds. */
  window: number;
}

const AUTH_LIMIT_RULES: Record<string, AuthLimitRule> = {
  // Password guessing against a specific account.
  auth_signin: { kind: 'email', max: 8, window: 300 },
  // Reset-email bombing a victim's inbox.
  auth_request_reset: { kind: 'email', max: 5, window: 900 },
  // Re-sending verification email.
  auth_request_verification: { kind: 'email', max: 5, window: 900 },
  // Mass account creation — no per-account notion, so cap per app.
  auth_signup: { kind: 'global', max: 30, window: 60 },
};

export interface AuthRateLimitDescriptor {
  key: string;
  max: number;
  window: number;
}

/**
 * Describe the rate-limit bucket for an auth RPC, or `null` when the method is
 * not throttled. Pure + exported for unit testing. The email is normalised
 * (trim + lowercase) so casing/whitespace can't split an attacker across
 * buckets; a missing email collapses to a shared per-method bucket so an
 * email-less probe is still bounded.
 */
export function deriveAuthRateLimit(
  method: string,
  params: Record<string, unknown> | undefined,
): AuthRateLimitDescriptor | null {
  const rule = AUTH_LIMIT_RULES[method];
  if (!rule) return null;
  if (rule.kind === 'global') {
    return { key: `arl:${method}`, max: rule.max, window: rule.window };
  }
  const rawEmail = params && typeof params.email === 'string' ? params.email : '';
  const email = rawEmail.trim().toLowerCase();
  const suffix = email || '_noemail_';
  return { key: `arl:${method}:${suffix}`, max: rule.max, window: rule.window };
}

/**
 * Check and increment the rate limit counter for the given key.
 *
 * Fails open on KV errors — a KV outage should not block requests.
 *
 * @param kv - The `RATE_LIMIT_KV` binding (self-host: an in-memory shim, one
 *             store per app+mode — see runtime `server/build-user-env.ts`)
 * @param key - Unique identifier (e.g. user ID or IP)
 * @param max - Maximum requests per window
 * @param windowSec - Window size in seconds (default 60)
 */
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  max: number,
  windowSec: number = 60
): Promise<RateLimitResult> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
  const resetAt = windowStart + windowSec;
  const kvKey = `rl:${key}:${windowStart}`;

  let current: number;
  try {
    const raw = await kv.get(kvKey);
    current = raw ? parseInt(raw, 10) : 0;
  } catch {
    // KV read failed — fail open, allow the request through
    return { allowed: true, remaining: max, resetAt };
  }

  if (current >= max) {
    return { allowed: false, remaining: 0, resetAt };
  }

  // Increment — KV is eventually consistent, so this is best-effort.
  try {
    await kv.put(kvKey, String(current + 1), {
      expirationTtl: windowSec * 2, // auto-cleanup after 2x window
    });
  } catch {
    // KV write failed — still allow the request (fail-open)
  }

  return { allowed: true, remaining: max - current - 1, resetAt };
}

// ── Durable auth throttle (SQLite-backed, fail-closed) ───────────
//
// Persists the account-targeted auth counters in the app database so a process
// restart cannot reset the throttle. Fixed-window counter + a PROGRESSIVE
// lockout: each time a bucket exceeds its cap the lockout doubles (base = the
// rule window), capped at AUTH_LOCKOUT_MAX_SEC; a clean window decays the strike
// count so a legitimate user who waits out the window recovers quickly.

/** Table holding one row per throttle bucket (`descriptor.key`). */
const AUTH_THROTTLE_TABLE = '_exepad_auth_throttle';

/** Upper bound on a progressive lockout (1 hour). */
const AUTH_LOCKOUT_MAX_SEC = 3600;

interface AuthThrottleRow {
  windowStart: number;
  count: number;
  strikes: number;
  lockoutUntil: number | null;
}

/** Per-DB-handle guard so the CREATE TABLE runs at most once per connection. */
const ensuredThrottleTable = new WeakSet<D1Database>();

async function ensureAuthThrottleTable(db: D1Database): Promise<void> {
  if (ensuredThrottleTable.has(db)) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${AUTH_THROTTLE_TABLE} (
        bucket TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL,
        strikes INTEGER NOT NULL DEFAULT 0,
        lockout_until INTEGER
      )`,
    )
    .run();
  ensuredThrottleTable.add(db);
}

/** Durable check+increment for one bucket. Throws on any DB error (caller decides). */
async function checkAuthRateLimitSqlite(
  db: D1Database,
  descriptor: AuthRateLimitDescriptor,
): Promise<RateLimitResult> {
  const { key, max, window } = descriptor;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / window) * window;
  const resetAt = windowStart + window;

  await ensureAuthThrottleTable(db);

  const row = await db
    .prepare(
      `SELECT window_start AS windowStart, count, strikes, lockout_until AS lockoutUntil
       FROM ${AUTH_THROTTLE_TABLE} WHERE bucket = ?`,
    )
    .bind(key)
    .first<AuthThrottleRow>();

  // Active progressive lockout — reject until it expires.
  if (row?.lockoutUntil && row.lockoutUntil > now) {
    return { allowed: false, remaining: 0, resetAt: row.lockoutUntil };
  }

  const inWindow = !!row && row.windowStart === windowStart;
  const currentCount = inWindow ? row!.count : 0;
  // Decay strikes once a clean window has elapsed without a lockout, so a
  // legitimate user isn't escalated forever after one bad burst.
  const priorStrikes = row && !inWindow && !row.lockoutUntil ? 0 : (row?.strikes ?? 0);

  const upsert = async (fields: {
    windowStart: number;
    count: number;
    strikes: number;
    lockoutUntil: number | null;
  }) => {
    await db
      .prepare(
        `INSERT INTO ${AUTH_THROTTLE_TABLE} (bucket, window_start, count, strikes, lockout_until)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(bucket) DO UPDATE SET
           window_start = excluded.window_start,
           count = excluded.count,
           strikes = excluded.strikes,
           lockout_until = excluded.lockout_until`,
      )
      .bind(key, fields.windowStart, fields.count, fields.strikes, fields.lockoutUntil)
      .run();
  };

  if (currentCount >= max) {
    // Over the cap → trip a progressive lockout (doubles per consecutive strike).
    const strikes = priorStrikes + 1;
    const lockoutSec = Math.min(window * 2 ** (strikes - 1), AUTH_LOCKOUT_MAX_SEC);
    const lockoutUntil = now + lockoutSec;
    await upsert({ windowStart, count: currentCount, strikes, lockoutUntil });
    return { allowed: false, remaining: 0, resetAt: lockoutUntil };
  }

  const newCount = currentCount + 1;
  await upsert({ windowStart, count: newCount, strikes: priorStrikes, lockoutUntil: null });
  return { allowed: true, remaining: max - newCount, resetAt };
}

/**
 * Check + increment the DURABLE auth throttle for a derived bucket.
 *
 * Store precedence and failure model:
 * - `db` present  → SQLite counter (survives restart). On ANY store error we
 *   try `kv` as a fallback, and if that also fails we FAIL CLOSED (reject) —
 *   an outage must not silently disable brute-force protection for auth.
 * - `db` absent, `kv` present → KV counter (best-effort, fail-OPEN — matches the
 *   generic limiter when no durable store is wired).
 * - neither store → throttling is not configured → allow (opt-in, like the rest
 *   of the limiter). The app-backend always binds `env.DB`, so self-host takes
 *   the durable path.
 *
 * Pair with `deriveAuthRateLimit(method, params)` to obtain the descriptor.
 */
export async function checkAuthRateLimit(
  descriptor: AuthRateLimitDescriptor,
  stores: { db?: D1Database; kv?: KVNamespace },
): Promise<RateLimitResult> {
  const { db, kv } = stores;

  if (db) {
    try {
      return await checkAuthRateLimitSqlite(db, descriptor);
    } catch {
      if (kv) {
        try {
          return await checkRateLimit(kv, descriptor.key, descriptor.max, descriptor.window);
        } catch {
          // fall through to fail-closed
        }
      }
      // FAIL CLOSED for account-targeted auth: reject rather than leave
      // brute-force unthrottled while the durable store is unavailable.
      const now = Math.floor(Date.now() / 1000);
      return { allowed: false, remaining: 0, resetAt: now + descriptor.window };
    }
  }

  if (kv) {
    return checkRateLimit(kv, descriptor.key, descriptor.max, descriptor.window);
  }

  // No store configured → throttling disabled (opt-in).
  const now = Math.floor(Date.now() / 1000);
  return { allowed: true, remaining: descriptor.max, resetAt: now + descriptor.window };
}

// ── File Upload Rate Limiting ────────────────────────────────────

/** Configurable limits for file upload rate limiting */
export interface FileRateLimits {
  /** Max uploads per hour per user. @default 60 */
  maxUploadsPerHour?: number;
  /** Max upload bytes per hour per user. @default 104_857_600 (100 MB) */
  maxBytesPerHour?: number;
  /** Max uploads per hour per IP (unauthenticated fallback). @default 10 */
  maxUploadsPerHourPerIp?: number;
}

export interface FileRateLimitResult {
  /** Whether the upload is allowed */
  allowed: boolean;
  /** Which limit was exceeded, if any */
  limitExceeded?: 'upload_count' | 'upload_bytes' | 'ip_upload_count';
  /** Remaining uploads in the current window (based on the tightest limit) */
  remaining: number;
  /** Epoch seconds when the current window resets */
  resetAt: number;
}

const FILE_RL_WINDOW_SEC = 3600; // 1 hour

/**
 * Check file upload rate limits.
 *
 * Checks three counters:
 * 1. Per-user upload count (max 60/hr default)
 * 2. Per-user upload bytes (max 100MB/hr default)
 * 3. Per-IP upload count for unauthenticated users (max 10/hr default)
 *
 * Fails open on KV errors — a KV outage should not block uploads.
 */
export async function checkFileUploadRateLimit(
  kv: KVNamespace,
  userId: string | null,
  clientIp: string | null,
  fileSize: number,
  limits: FileRateLimits = {},
): Promise<FileRateLimitResult> {
  const maxUploads = limits.maxUploadsPerHour ?? 60;
  const maxBytes = limits.maxBytesPerHour ?? 104_857_600;
  const maxIpUploads = limits.maxUploadsPerHourPerIp ?? 10;

  const windowStart = Math.floor(Date.now() / 1000 / FILE_RL_WINDOW_SEC) * FILE_RL_WINDOW_SEC;
  const resetAt = windowStart + FILE_RL_WINDOW_SEC;
  const ttl = FILE_RL_WINDOW_SEC * 2;

  // Read current counter values (cached for reuse in increment phase)
  let currentCount = 0;
  let currentBytes = 0;
  let currentIpCount = 0;

  // --- Check 1: Per-user upload count ---
  if (userId) {
    const countKey = `frl:count:${userId}:${windowStart}`;
    try {
      const raw = await kv.get(countKey);
      currentCount = raw ? parseInt(raw, 10) : 0;
      if (currentCount >= maxUploads) {
        return { allowed: false, limitExceeded: 'upload_count', remaining: 0, resetAt };
      }
    } catch {
      // fail open
    }
  }

  // --- Check 2: Per-user upload bytes ---
  if (userId) {
    const bytesKey = `frl:bytes:${userId}:${windowStart}`;
    try {
      const raw = await kv.get(bytesKey);
      currentBytes = raw ? parseInt(raw, 10) : 0;
      if (currentBytes + fileSize > maxBytes) {
        return { allowed: false, limitExceeded: 'upload_bytes', remaining: 0, resetAt };
      }
    } catch {
      // fail open
    }
  }

  // --- Check 3: Per-IP upload count (unauthenticated fallback) ---
  if (!userId && clientIp) {
    const ipKey = `frl:ip:${clientIp}:${windowStart}`;
    try {
      const raw = await kv.get(ipKey);
      currentIpCount = raw ? parseInt(raw, 10) : 0;
      if (currentIpCount >= maxIpUploads) {
        return { allowed: false, limitExceeded: 'ip_upload_count', remaining: 0, resetAt };
      }
    } catch {
      // fail open
    }
  }

  // --- Increment counters (best-effort, reusing cached reads) ---
  try {
    if (userId) {
      const countKey = `frl:count:${userId}:${windowStart}`;
      await kv.put(countKey, String(currentCount + 1), { expirationTtl: ttl });

      const bytesKey = `frl:bytes:${userId}:${windowStart}`;
      await kv.put(bytesKey, String(currentBytes + fileSize), { expirationTtl: ttl });
    } else if (clientIp) {
      const ipKey = `frl:ip:${clientIp}:${windowStart}`;
      await kv.put(ipKey, String(currentIpCount + 1), { expirationTtl: ttl });
    }
  } catch {
    // fail open — write failures should not block the upload
  }

  // Compute remaining as the tightest constraint
  const remaining = userId
    ? Math.max(0, maxUploads - currentCount - 1)
    : clientIp
      ? Math.max(0, maxIpUploads - currentIpCount - 1)
      : maxUploads;

  return { allowed: true, remaining, resetAt };
}
