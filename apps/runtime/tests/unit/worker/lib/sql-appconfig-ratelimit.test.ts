/**
 * sql-appconfig-ratelimit.test.ts — three small-but-load-bearing worker libs.
 *
 *  - sql-utils.escapeLikePattern: the wildcard-injection guard for free-text
 *    search in admin D1 routes. A regression lets a user search string smuggle
 *    `%`/`_`/`\` wildcards into a `LIKE ? ESCAPE '\'` clause (data enumeration).
 *  - app-config.isAuthRequired: the per-app auth kill-switch. A wrong `true`
 *    locks an open app; a wrong `false` exposes a private one.
 *  - rate-limit.rateLimiter: the burst limiter middleware — window counting,
 *    429 past the limit, RFC-style headers, and window reset.
 *
 * Pure-function + Hono-middleware harness (mirrors the sibling lib tests and
 * the `rateLimiter` usage in tests/unit/server/token-governance.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { escapeLikePattern } from '../../../../worker/src/lib/sql-utils';
import { isAuthRequired, type AppConfig } from '../../../../worker/src/lib/app-config';
import { rateLimiter, deriveRateLimitKey } from '../../../../worker/src/lib/rate-limit';
import type { Env } from '../../../../worker/src/types/env';

// ─────────────────────────────────────────────────────────────────────────────
// escapeLikePattern — LIKE wildcard-injection guard
// ─────────────────────────────────────────────────────────────────────────────
describe('escapeLikePattern', () => {
  it('escapes a literal percent so it cannot act as a multi-char wildcard', () => {
    // A user typing "100%" must match the literal string, not "100<anything>".
    expect(escapeLikePattern('100%')).toBe('100\\%');
  });

  it('escapes a literal underscore so it cannot act as a single-char wildcard', () => {
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
  });

  it('escapes a backslash FIRST so the escape char itself is neutralized', () => {
    // If `\` were not doubled, a user-supplied `\%` would survive as an escaped
    // `%` and silently change matching semantics. The lone backslash must become
    // a doubled, literal backslash.
    expect(escapeLikePattern('\\')).toBe('\\\\');
  });

  it('does not double-escape: a user "\\%" becomes escaped-backslash + escaped-percent', () => {
    // Order matters. `\` → `\\`, then `%` → `\%`, yielding `\\\%` (4 chars):
    // a literal backslash followed by a literal percent.
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%');
  });

  it('escapes every wildcard in a mixed payload', () => {
    expect(escapeLikePattern('%_\\')).toBe('\\%\\_\\\\');
  });

  it('neutralizes a classic enumeration payload (leading %)', () => {
    // "%" alone would match every row; escaped it matches only a literal "%".
    const out = escapeLikePattern('%');
    expect(out).toBe('\\%');
    // Sanity: the result contains no UNescaped wildcard metacharacter.
    expect(/(?<!\\)[%_]/.test(out)).toBe(false);
  });

  it('handles many wildcards without leaving any unescaped', () => {
    const out = escapeLikePattern('a%b_c%d_');
    // Each metacharacter must be immediately preceded by exactly one backslash.
    expect(out).toBe('a\\%b\\_c\\%d\\_');
    expect(/(?<!\\)[%_]/.test(out)).toBe(false);
  });

  it('leaves benign input untouched', () => {
    expect(escapeLikePattern('hello world 123')).toBe('hello world 123');
  });

  it('returns empty string for empty input', () => {
    expect(escapeLikePattern('')).toBe('');
  });

  it('does not treat SQL-quote characters as wildcards (parameterization handles quotes)', () => {
    // The function is only responsible for LIKE metacharacters; quotes pass
    // through unchanged because the value is bound as a `?` parameter.
    expect(escapeLikePattern("o'brien")).toBe("o'brien");
    expect(escapeLikePattern('a"b')).toBe('a"b');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isAuthRequired — per-app authentication kill-switch
// ─────────────────────────────────────────────────────────────────────────────
describe('isAuthRequired', () => {
  /** A fully "auth-on" security block (providers + non-public default access). */
  function secured(): AppConfig {
    return {
      security: {
        enabled: true,
        defaultAccess: 'private',
        authProviders: [{ type: 'google' }],
      },
    };
  }

  it('returns false for a null config', () => {
    expect(isAuthRequired(null)).toBe(false);
  });

  it('returns false when there is no security block at all', () => {
    expect(isAuthRequired({})).toBe(false);
    expect(isAuthRequired({ name: 'app' })).toBe(false);
  });

  it('returns true for a fully-configured secured app', () => {
    expect(isAuthRequired(secured())).toBe(true);
  });

  it('kill-switch: enabled === false overrides leftover providers/defaultAccess', () => {
    const cfg = secured();
    cfg.security!.enabled = false; // admin toggled "Enable Authentication" off
    // Even with providers + private default access still present, auth is OFF.
    expect(isAuthRequired(cfg)).toBe(false);
  });

  it('treats enabled === undefined as "not killed" (defers to providers/access)', () => {
    const cfg = secured();
    delete cfg.security!.enabled;
    expect(isAuthRequired(cfg)).toBe(true);
  });

  it('requires at least one auth provider', () => {
    const cfg = secured();
    cfg.security!.authProviders = [];
    expect(isAuthRequired(cfg)).toBe(false);
  });

  it('requires defaultAccess to be present', () => {
    const cfg = secured();
    delete cfg.security!.defaultAccess;
    expect(isAuthRequired(cfg)).toBe(false);
  });

  it('returns false when defaultAccess is explicitly "public" (open app)', () => {
    const cfg = secured();
    cfg.security!.defaultAccess = 'public';
    expect(isAuthRequired(cfg)).toBe(false);
  });

  it('returns true for any non-public defaultAccess (e.g. "authenticated")', () => {
    const cfg = secured();
    cfg.security!.defaultAccess = 'authenticated';
    expect(isAuthRequired(cfg)).toBe(true);
  });

  it('returns false when providers exist but defaultAccess is empty string (falsy)', () => {
    const cfg = secured();
    cfg.security!.defaultAccess = '';
    expect(isAuthRequired(cfg)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveRateLimitKey — bucket-key derivation (pure)
// ─────────────────────────────────────────────────────────────────────────────
describe('deriveRateLimitKey', () => {
  it('buckets by IP+route', () => {
    expect(deriveRateLimitKey({ ip: '1.2.3.4', route: '/r' })).toBe('1.2.3.4:/r');
  });

  it('distinct IPs on the same route get distinct buckets', () => {
    expect(deriveRateLimitKey({ ip: '1.1.1.1', route: '/r' }))
      .not.toBe(deriveRateLimitKey({ ip: '9.9.9.9', route: '/r' }));
  });

  it('distinct routes for the same IP get distinct buckets', () => {
    expect(deriveRateLimitKey({ ip: '5.5.5.5', route: '/a' }))
      .not.toBe(deriveRateLimitKey({ ip: '5.5.5.5', route: '/b' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rateLimiter middleware — window counting, 429, headers, reset
// ─────────────────────────────────────────────────────────────────────────────
describe('rateLimiter middleware', () => {
  /** Build a tiny Hono app gated by the limiter. ENVIRONMENT defaults to a
   *  non-development value so the limiter is actually active. */
  function app(opts: { maxRequests: number; windowMs: number }, environment = 'selfhost') {
    const a = new Hono<{ Bindings: Env }>();
    a.use('*', rateLimiter(opts));
    a.get('/r', (c) => c.json({ ok: true }));
    return a;
  }

  const baseEnv = { ENVIRONMENT: 'selfhost' } as unknown as Env;

  // These bucketing/window tests key off the client IP carried in a forwarded
  // header (cf-connecting-ip / x-forwarded-for). Under the hardened limiter that
  // header is only trusted behind a proxy, so run them in trusted-proxy mode;
  // the Hono test client has no real socket for getConnInfo to read otherwise.
  // cf-connecting-ip additionally needs the explicit Cloudflare opt-in.
  beforeEach(() => {
    process.env.EXEPAD_TRUST_PROXY = '1';
    process.env.EXEPAD_TRUST_CF = '1';
  });
  afterEach(() => {
    delete process.env.EXEPAD_TRUST_PROXY;
    delete process.env.EXEPAD_TRUST_CF;
    vi.useRealTimers();
  });

  /** Issue a request for a given client IP (each test uses a fresh IP so the
   *  module-level window Map doesn't bleed between tests). */
  function hit(a: Hono<{ Bindings: Env }>, ip: string, headers: Record<string, string> = {}, env: Env = baseEnv) {
    return a.request('/r', { headers: { 'cf-connecting-ip': ip, ...headers } }, env);
  }

  it('allows requests up to the limit and sets RFC-style headers', async () => {
    const a = app({ maxRequests: 3, windowMs: 60_000 });
    const ip = 'rl-allow-1';

    const r1 = await hit(a, ip);
    expect(r1.status).toBe(200);
    expect(r1.headers.get('X-RateLimit-Limit')).toBe('3');
    // First request consumed: 3 - 1 = 2 remaining.
    expect(r1.headers.get('X-RateLimit-Remaining')).toBe('2');
    expect(r1.headers.get('X-RateLimit-Reset')).toMatch(/^\d+$/);

    const r2 = await hit(a, ip);
    expect(r2.status).toBe(200);
    expect(r2.headers.get('X-RateLimit-Remaining')).toBe('1');

    const r3 = await hit(a, ip);
    expect(r3.status).toBe(200);
    expect(r3.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('returns 429 with Retry-After once the limit is exceeded', async () => {
    const a = app({ maxRequests: 2, windowMs: 60_000 });
    const ip = 'rl-429-1';

    await hit(a, ip); // count 1
    await hit(a, ip); // count 2 (at limit, still allowed)
    const over = await hit(a, ip); // count 3 → over

    expect(over.status).toBe(429);
    const body = await over.json();
    expect(body).toMatchObject({ success: false });
    expect(body.error).toMatch(/too many requests/i);
    expect(over.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(Number(over.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(over.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(over.headers.get('X-RateLimit-Limit')).toBe('2');
  });

  it('keeps returning 429 for every subsequent request in the same window', async () => {
    const a = app({ maxRequests: 1, windowMs: 60_000 });
    const ip = 'rl-429-sticky';

    expect((await hit(a, ip)).status).toBe(200); // count 1
    expect((await hit(a, ip)).status).toBe(429); // count 2
    expect((await hit(a, ip)).status).toBe(429); // count 3
    expect((await hit(a, ip)).status).toBe(429); // count 4
  });

  it('isolates buckets per client IP', async () => {
    const a = app({ maxRequests: 1, windowMs: 60_000 });

    expect((await hit(a, 'rl-iso-A')).status).toBe(200);
    expect((await hit(a, 'rl-iso-A')).status).toBe(429); // A exhausted
    // A different IP gets its own fresh bucket.
    expect((await hit(a, 'rl-iso-B')).status).toBe(200);
  });

  it('resets the window after windowMs elapses, allowing requests again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const a = app({ maxRequests: 1, windowMs: 10_000 });
    const ip = 'rl-reset-1';

    expect((await hit(a, ip)).status).toBe(200); // count 1, resetAt = 10_000
    expect((await hit(a, ip)).status).toBe(429); // still in window

    // Advance past the window boundary — entry.resetAt <= now triggers reset.
    vi.setSystemTime(10_001);
    const after = await hit(a, ip);
    expect(after.status).toBe(200); // fresh window
    expect(after.headers.get('X-RateLimit-Remaining')).toBe('0'); // 1 - 1
  });

  it('X-RateLimit-Reset reflects the window end (epoch seconds, in the future)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const a = app({ maxRequests: 5, windowMs: 30_000 });
    const r = await hit(a, 'rl-reset-hdr');
    // resetAt = now + 30_000 = 30_000ms → ceil(30_000/1000) = 30 epoch-seconds.
    expect(r.headers.get('X-RateLimit-Reset')).toBe('30');
  });

  it('keys by IP: different IPs get independent buckets', async () => {
    const a = app({ maxRequests: 1, windowMs: 60_000 });

    // Distinct IPs → each gets its own bucket, so both first hits pass.
    expect((await hit(a, 'rl-ip-1')).status).toBe(200);
    expect((await hit(a, 'rl-ip-2')).status).toBe(200);
    // The first IP's second hit is over its own limit.
    expect((await hit(a, 'rl-ip-1')).status).toBe(429);
  });

  it('bypasses rate limiting entirely in development (no headers, never 429)', async () => {
    const a = app({ maxRequests: 1, windowMs: 60_000 }, 'development');
    const devEnv = { ENVIRONMENT: 'development' } as unknown as Env;
    const ip = 'rl-dev-1';

    const r1 = await hit(a, ip, {}, devEnv);
    const r2 = await hit(a, ip, {}, devEnv);
    const r3 = await hit(a, ip, {}, devEnv);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200); // would be 429 in production
    // Dev path returns before any X-RateLimit header is attached.
    expect(r1.headers.get('X-RateLimit-Limit')).toBeNull();
  });

  it('behind a trusted proxy, falls back to x-forwarded-for when cf-connecting-ip is absent', async () => {
    const a = app({ maxRequests: 1, windowMs: 60_000 });

    // Trusted-proxy mode (set in beforeEach): no cf-connecting-ip → the proxy's
    // appended (rightmost) x-forwarded-for entry is the bucket IP.
    const xff = (await a.request('/r', { headers: { 'x-forwarded-for': 'rl-xff-1' } }, baseEnv));
    expect(xff.status).toBe(200);
    const xff2 = (await a.request('/r', { headers: { 'x-forwarded-for': 'rl-xff-1' } }, baseEnv));
    expect(xff2.status).toBe(429); // same xff bucket exhausted
  });

  it('behind a trusted proxy, keys on the RIGHTMOST x-forwarded-for entry (proxy-appended peer)', async () => {
    const a = app({ maxRequests: 1, windowMs: 60_000 });
    // Client prepends a spoofed entry; the proxy appends the real peer last. The
    // limiter must key on the trustworthy rightmost entry, so two requests that
    // differ only in the spoofed prefix share one bucket.
    const h1 = { 'x-forwarded-for': 'spoofed-A, real-peer-9' };
    const h2 = { 'x-forwarded-for': 'spoofed-B, real-peer-9' };
    expect((await a.request('/r', { headers: h1 }, baseEnv)).status).toBe(200);
    expect((await a.request('/r', { headers: h2 }, baseEnv)).status).toBe(429);
  });

  it('WITHOUT a trusted proxy, ignores spoofable forwarded headers (shared bucket, no per-request reset)', async () => {
    // The security fix: on a directly-exposed instance an attacker must NOT be
    // able to mint a fresh bucket by rotating X-Forwarded-For / cf-connecting-ip.
    // With no proxy trust and no real socket, all such requests collapse to the
    // same ('unknown') bucket, so a rotated header cannot escape the limit.
    delete process.env.EXEPAD_TRUST_PROXY;
    const a = app({ maxRequests: 1, windowMs: 60_000 });
    const first = await a.request('/r', { headers: { 'x-forwarded-for': 'evil-1' } }, baseEnv);
    expect(first.status).toBe(200);
    // A different spoofed XFF would previously get a fresh bucket; now it does not.
    const second = await a.request('/r', { headers: { 'x-forwarded-for': 'evil-2' } }, baseEnv);
    expect(second.status).toBe(429);
    // And rotating cf-connecting-ip is equally ineffective.
    const third = await a.request('/r', { headers: { 'cf-connecting-ip': 'evil-3' } }, baseEnv);
    expect(third.status).toBe(429);
  });

  it('behind a trusted proxy WITHOUT the Cloudflare opt-in, rotating cf-connecting-ip cannot mint fresh buckets', async () => {
    // The DEFAULT shipped container sets EXEPAD_TLS_FRONTED=1 (proxy trust) but
    // its Caddy front does not strip cf-connecting-ip, so the header must stay
    // untrusted absent EXEPAD_TRUST_CF — otherwise /auth/login's 10/min cap
    // never fires against an attacker rotating the header.
    delete process.env.EXEPAD_TRUST_CF;
    const a = app({ maxRequests: 1, windowMs: 60_000 });
    // The proxy-appended peer is constant; only the spoofable header rotates.
    const xff = { 'x-forwarded-for': 'rl-cf-rot-peer' };

    expect((await hit(a, 'rl-cf-rot-1', xff)).status).toBe(200);
    expect((await hit(a, 'rl-cf-rot-2', xff)).status).toBe(429); // rotated header, same bucket
    expect((await hit(a, 'rl-cf-rot-3', xff)).status).toBe(429);
  });

  it('with EXEPAD_TRUST_CF=1 the cf-connecting-ip header IS honoured (explicit opt-in)', async () => {
    // Operators genuinely behind Cloudflare keep per-client buckets.
    const a = app({ maxRequests: 1, windowMs: 60_000 });

    expect((await hit(a, 'rl-cf-optin-A')).status).toBe(200);
    expect((await hit(a, 'rl-cf-optin-A')).status).toBe(429); // A exhausted
    // A different cf-connecting-ip is a different client → its own fresh bucket.
    expect((await hit(a, 'rl-cf-optin-B')).status).toBe(200);
  });
});
