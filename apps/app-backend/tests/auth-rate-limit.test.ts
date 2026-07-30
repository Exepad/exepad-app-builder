/**
 * Auth brute-force / spam throttle (2026-06-27).
 *
 * Found on the LedgerLite SaaS audit: the app-backend rate limiter is opt-in via
 * RATE_LIMIT_KV, which the self-host runtime never bound — so sign-in password
 * guessing and sign-up flooding were UNTHROTTLED on a paid multi-tenant SaaS.
 * Self-host has no client IP (the runtime serves a bare WHATWG Request), so the
 * throttle keys account-targeted methods on the EMAIL and caps sign-up per app.
 *
 * These pin the descriptor mapping + normalisation, prove non-auth methods are
 * untouched, and prove the derived key actually trips checkRateLimit at the cap.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { deriveAuthRateLimit, checkRateLimit } from '../src/middleware/rateLimit';
import { createMockKV } from './helpers/mock-env';

describe('deriveAuthRateLimit', () => {
  it('keys sign-in on the targeted email (account brute-force protection)', () => {
    const d = deriveAuthRateLimit('auth_signin', { email: 'Alice@Example.COM', password: 'x' });
    expect(d).not.toBeNull();
    expect(d!.key).toBe('arl:auth_signin:alice@example.com'); // trimmed + lowercased
    expect(d!.max).toBe(8);
    expect(d!.window).toBe(300);
  });

  it('normalises whitespace + case so an attacker cannot split buckets', () => {
    const a = deriveAuthRateLimit('auth_signin', { email: '  bob@x.com ' });
    const b = deriveAuthRateLimit('auth_signin', { email: 'BOB@X.COM' });
    expect(a!.key).toBe('arl:auth_signin:bob@x.com');
    expect(a!.key).toBe(b!.key);
  });

  it('caps sign-up per app (global bucket — no per-account notion)', () => {
    const d = deriveAuthRateLimit('auth_signup', { email: 'new@x.com' });
    expect(d!.key).toBe('arl:auth_signup'); // not email-scoped
    expect(d!.max).toBe(30);
    expect(d!.window).toBe(60);
  });

  it('throttles reset + verification email sends (anti-bombing)', () => {
    expect(deriveAuthRateLimit('auth_request_reset', { email: 'v@x.com' })!.key)
      .toBe('arl:auth_request_reset:v@x.com');
    expect(deriveAuthRateLimit('auth_request_verification', { email: 'v@x.com' })!.window)
      .toBe(900);
  });

  it('collapses a missing email to a bounded shared bucket', () => {
    const d = deriveAuthRateLimit('auth_signin', {});
    expect(d!.key).toBe('arl:auth_signin:_noemail_');
  });

  it('returns null for non-throttled methods (CRUD, auth_me, signout)', () => {
    expect(deriveAuthRateLimit('sys_create', { model: 'x' })).toBeNull();
    expect(deriveAuthRateLimit('auth_me', {})).toBeNull();
    expect(deriveAuthRateLimit('auth_signout', {})).toBeNull();
    expect(deriveAuthRateLimit('auth_verify_email', { token: 't' })).toBeNull();
  });

  it('the derived sign-in key trips checkRateLimit exactly at the cap', async () => {
    const kv = createMockKV();
    const d = deriveAuthRateLimit('auth_signin', { email: 'target@x.com' })!;
    let lastAllowed = true;
    for (let i = 0; i < d.max; i++) {
      const r = await checkRateLimit(kv, d.key, d.max, d.window);
      lastAllowed = r.allowed;
    }
    expect(lastAllowed).toBe(true); // attempts 1..max allowed
    const over = await checkRateLimit(kv, d.key, d.max, d.window);
    expect(over.allowed).toBe(false); // attempt max+1 blocked
    expect(over.remaining).toBe(0);
  });

  it('keys distinct emails into independent buckets (no collateral lockout)', async () => {
    const kv = createMockKV();
    const victim = deriveAuthRateLimit('auth_signin', { email: 'victim@x.com' })!;
    // Exhaust the attacker-targeted account...
    for (let i = 0; i <= victim.max; i++) await checkRateLimit(kv, victim.key, victim.max, victim.window);
    // ...a DIFFERENT account is still free to sign in.
    const other = deriveAuthRateLimit('auth_signin', { email: 'other@x.com' })!;
    const r = await checkRateLimit(kv, other.key, other.max, other.window);
    expect(r.allowed).toBe(true);
  });
});
