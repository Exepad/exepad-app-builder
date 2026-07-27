/**
 * Simple in-memory sliding-window rate limiter for the self-hosted Node
 * runtime (@hono/node-server).
 *
 * Keyed on the real client IP + route prefix. The IP is the unspoofable TCP
 * peer from the Node socket, EXCEPT behind a trusted reverse proxy (the shipped
 * Caddy front, or an operator-configured proxy) where the proxy-set
 * X-Forwarded-For is believed instead — see `resolveClientIp`. State is a
 * per-process Map, so this is a single-container burst limiter; front it with
 * your proxy's own rate limiting for multi-instance or stricter enforcement.
 */

import { createMiddleware } from 'hono/factory';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import type { Env } from '../types/env';

function isTruthy(v: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(v ?? '');
}

/**
 * True when a trusted reverse proxy fronts the runtime, so its
 * `X-Forwarded-For` may be believed. The shipped container runs Caddy in front
 * (entrypoint.sh sets `EXEPAD_TLS_FRONTED=1`); operators behind their own proxy
 * opt in with `EXEPAD_TRUST_PROXY=1`. When neither is set the runtime is
 * directly exposed and forwarded headers are attacker-controlled.
 */
function trustsProxyHeaders(): boolean {
  return (
    isTruthy(process.env.EXEPAD_TLS_FRONTED) || isTruthy(process.env.EXEPAD_TRUST_PROXY)
  );
}

/**
 * Resolve the real client IP used to bucket rate limits.
 *
 * SECURITY: `X-Forwarded-For` / `cf-connecting-ip` are client-settable request
 * headers. On a directly-exposed self-host instance an attacker rotates them to
 * mint a fresh bucket per request, neutering the brute-force throttle on
 * /auth/login and /auth/setup. So forwarded headers are trusted ONLY behind a
 * known proxy (see `trustsProxyHeaders`); otherwise we key on the unspoofable
 * TCP peer address from the Node socket.
 */
export function resolveClientIp(c: Context<{ Bindings: Env }>): string {
  if (trustsProxyHeaders()) {
    // SECURITY: `cf-connecting-ip` is a single trustworthy value only when a
    // Cloudflare edge actually injects it. The shipped container sets
    // EXEPAD_TLS_FRONTED=1 but its Caddy front does NOT strip this header, so
    // believing it by default lets an attacker rotate it to mint a fresh bucket
    // per request — the exact brute-force bypass the X-Forwarded-For branch
    // below guards against. Operators genuinely behind Cloudflare opt in with
    // `EXEPAD_TRUST_CF=1`; everyone else falls through to the rightmost-XFF
    // logic (the optional cloudflared quick tunnel sends a single-entry
    // X-Forwarded-For carrying the same client IP, so it resolves identically).
    if (isTruthy(process.env.EXEPAD_TRUST_CF)) {
      const cf = c.req.header('cf-connecting-ip');
      if (cf?.trim()) return cf.trim();
    }
    const xff = c.req.header('x-forwarded-for');
    if (xff) {
      // With one trusted hop (the shipped Caddy) the proxy APPENDS the real
      // peer as the last entry; any earlier entries are client-supplied and
      // spoofable, so take the rightmost. Operators chaining multiple proxies
      // should terminate X-Forwarded-For trust at their own edge.
      const parts = xff
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
  }
  try {
    return getConnInfo(c).remote.address || 'unknown';
  } catch {
    // conninfo is only available under @hono/node-server; degrade closed to a
    // shared bucket rather than a per-request-spoofable one.
    return 'unknown';
  }
}

interface RateLimitOptions {
  /** Maximum number of requests allowed in the window. */
  maxRequests: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}

/**
 * Derive the rate-limit bucket key. Pure + exported for unit testing. Keys are
 * scoped by client IP + route.
 */
export function deriveRateLimitKey(args: { ip: string; route: string }): string {
  return `${args.ip}:${args.route}`;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowEntry>();

// Periodic cleanup to prevent memory growth in long-lived isolates
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 120_000; // 2 minutes

function cleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of windows) {
    if (entry.resetAt <= now) {
      windows.delete(key);
    }
  }
}

export function rateLimiter(opts: RateLimitOptions) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    // Skip rate limiting in development
    if (c.env.ENVIRONMENT === 'development') {
      await next();
      return;
    }

    cleanup();

    const ip = resolveClientIp(c);
    const route = c.req.routePath || c.req.path;
    const key = deriveRateLimitKey({ ip, route });
    const now = Date.now();

    let entry = windows.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      windows.set(key, entry);
    }

    entry.count++;

    // Advertise the limit so clients can self-throttle (RFC-style headers).
    const remaining = Math.max(0, opts.maxRequests - entry.count);
    const resetSec = Math.ceil(entry.resetAt / 1000);
    c.header('X-RateLimit-Limit', String(opts.maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(resetSec));

    if (entry.count > opts.maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return c.json(
        { success: false, error: 'Too many requests. Please try again later.' },
        429,
        {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(opts.maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(resetSec),
        },
      );
    }

    await next();
  });
}
