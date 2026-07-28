// @vitest-environment node
/**
 * Session-revocation tests for the operator platform session.
 *
 * The `users.session_generation` column + the `gen` token claim let the platform
 * invalidate EVERY outstanding session for an operator at once (logout-all,
 * password change) instead of just clearing one browser's cookie. These tests
 * exercise the real functions un-mocked — only the meta DB location and the
 * worker Env are stubbed (temp dir), so the session-crypto + meta-store paths run
 * end-to-end.
 *
 * Covered:
 *   - a token minted at gen=N is REJECTED after the user's gen is bumped to N+1;
 *   - a token minted AFTER the bump (carrying gen=N+1) is accepted again;
 *   - POST /auth/logout is logout-ALL: it bumps the generation and the pre-logout
 *     cookie stops verifying;
 *   - POST /auth/change-password bumps the generation (old cookie dies) and
 *     re-issues the current browser a fresh, valid cookie;
 *   - backward-compat: a legacy token with NO `gen` claim is treated as gen 0 and
 *     accepted while the user is still at generation 0 (a deploy doesn't force a
 *     logout of everyone).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auth } from '../../../worker/src/routes/auth';
import {
  createUser,
  getSessionGeneration,
  bumpSessionGeneration,
  type MetaUser,
} from '../../../worker/src/lib/meta-db';
import { hashPassword } from '../../../worker/src/lib/password';
import {
  mintSessionToken,
  verifyPlatformSession,
  PLATFORM_SESSION_COOKIE,
} from '../../../worker/src/routes/gateway/auth';
import type { Env } from '../../../worker/src/types/env';

const SECRET = 'test-session-secret-revocation-0123456789';
let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-session-revocation-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
  process.env.EXEPAD_META_DB = join(dataDir, 'meta.sqlite');
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function env(): Env {
  return { PLATFORM_BRIDGE_SECRET: SECRET } as unknown as Env;
}

/** Insert a fresh operator with a known password. Unique email per call. */
async function makeUser(tag: string, password = 'a-strong-password'): Promise<MetaUser> {
  return createUser(`${tag}@revocation.test`, await hashPassword(password), 'admin');
}

function cookieReq(token: string): Request {
  return new Request('https://host.local/x', {
    headers: { Cookie: `${PLATFORM_SESSION_COOKIE}=${token}` },
  });
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://host.local${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function setCookieHeaders(res: Response): string {
  const getter = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getter === 'function') return getter.call(res.headers).join('\n');
  return res.headers.get('set-cookie') || '';
}

/** Pull the platform-session token value out of a Set-Cookie header string. */
function tokenFromSetCookie(setCookie: string): string {
  const m = new RegExp(`${PLATFORM_SESSION_COOKIE}=([^;\\n]+)`).exec(setCookie);
  return m ? m[1] : '';
}

// ── Legacy (no-`gen`-claim) token signer — mirrors gateway/auth.ts ────────────
// Reproduces the exact HMAC-SHA256(hex) over a base64url(JSON) payload so we can
// forge a pre-feature token that OMITS the `gen` claim, to prove it's treated as
// generation 0 rather than force-rejected.
function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function signLegacyToken(uid: string, secret: string): Promise<string> {
  const payload = {
    type: 'app_session',
    uid,
    roles: ['admin'],
    exp: Math.floor(Date.now() / 1000) + 3600,
    // NB: no `gen` field — this is what an old token looks like.
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const signature = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${payloadB64}.${signature}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('session_generation revocation (verify path)', () => {
  it('rejects a token minted at gen=N after the user is bumped to N+1', async () => {
    const user = await makeUser('bump');
    expect(getSessionGeneration(user.id)).toBe(0);

    const token = await mintSessionToken(user.id, user.email, [user.role], SECRET);
    // Valid while the stored generation still matches the token claim.
    expect(await verifyPlatformSession(cookieReq(token), SECRET)).not.toBeNull();

    // Revoke: bump the generation past the token's claim.
    const newGen = bumpSessionGeneration(user.id);
    expect(newGen).toBe(1);

    // The same token is now rejected.
    expect(await verifyPlatformSession(cookieReq(token), SECRET)).toBeNull();

    // A freshly minted token (carrying the new generation) works again.
    const fresh = await mintSessionToken(user.id, user.email, [user.role], SECRET);
    expect(await verifyPlatformSession(cookieReq(fresh), SECRET)).not.toBeNull();
  });

  it('treats a legacy token with NO gen claim as generation 0 (deploy-safe)', async () => {
    const user = await makeUser('legacy');
    expect(getSessionGeneration(user.id)).toBe(0);

    const legacy = await signLegacyToken(user.id, SECRET);
    const payload = await verifyPlatformSession(cookieReq(legacy), SECRET);
    expect(payload?.uid).toBe(user.id);
    expect(payload?.gen).toBeUndefined();

    // Once revoked, even the claimless legacy token stops verifying.
    bumpSessionGeneration(user.id);
    expect(await verifyPlatformSession(cookieReq(legacy), SECRET)).toBeNull();
  });
});

describe('POST /auth/logout — logout-all', () => {
  it('bumps the session generation so the pre-logout cookie stops verifying', async () => {
    const user = await makeUser('logout');
    const token = await mintSessionToken(user.id, user.email, [user.role], SECRET);
    expect(await verifyPlatformSession(cookieReq(token), SECRET)).not.toBeNull();
    expect(getSessionGeneration(user.id)).toBe(0);

    const res = await auth.fetch(
      post('/logout', {}, { Cookie: `${PLATFORM_SESSION_COOKIE}=${token}` }),
      env(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });

    expect(getSessionGeneration(user.id)).toBe(1);
    expect(await verifyPlatformSession(cookieReq(token), SECRET)).toBeNull();
  });

  it('is a no-op bump when called without a valid session cookie', async () => {
    const user = await makeUser('logout-anon');
    expect(getSessionGeneration(user.id)).toBe(0);
    const res = await auth.fetch(post('/logout', {}), env());
    expect(res.status).toBe(200);
    // No cookie ⇒ nobody to revoke ⇒ this user's generation is untouched.
    expect(getSessionGeneration(user.id)).toBe(0);
  });
});

describe('POST /auth/change-password — revokes then re-issues', () => {
  it('bumps the generation (old cookie dies) and hands back a fresh valid cookie', async () => {
    const user = await makeUser('changepw', 'old-strong-password');
    const oldToken = await mintSessionToken(user.id, user.email, [user.role], SECRET);
    expect(await verifyPlatformSession(cookieReq(oldToken), SECRET)).not.toBeNull();

    const res = await auth.fetch(
      post(
        '/change-password',
        { currentPassword: 'old-strong-password', newPassword: 'new-strong-password' },
        { Cookie: `${PLATFORM_SESSION_COOKIE}=${oldToken}` },
      ),
      env(),
    );
    expect(res.status).toBe(200);

    // Generation advanced ⇒ the cookie used for the request is now revoked.
    expect(getSessionGeneration(user.id)).toBe(1);
    expect(await verifyPlatformSession(cookieReq(oldToken), SECRET)).toBeNull();

    // …but the response re-issued THIS browser a fresh cookie that verifies.
    const reissued = tokenFromSetCookie(setCookieHeaders(res));
    expect(reissued).not.toBe('');
    expect(reissued).not.toBe(oldToken);
    expect(await verifyPlatformSession(cookieReq(reissued), SECRET)).not.toBeNull();
  });
});
