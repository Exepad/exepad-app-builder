/**
 * Phase 2: Authentication Backend — Integration Tests
 *
 * Tests auth RPC methods against a live app-backend on localhost:8787.
 * Requires: `pnpm dev` running in apps/app-backend (backend-demo app with security config)
 *
 * Cookie name: exepad_app_session
 * Session token: sent via Set-Cookie header on signup/signin, X-Session-Token header on subsequent requests
 */

import { describe, it, expect } from 'vitest';

const RPC_URL = 'http://localhost:8787/rpc';
const TS = Date.now();

/** Helper: raw fetch to /rpc — returns Response (so we can inspect headers) */
async function rpcRaw(
  body: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<Response> {
  return fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Helper: parse JSON from response */
async function rpcJson(
  body: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<{ success: boolean; data?: any; error?: any }> {
  const res = await rpcRaw(body, headers);
  return res.json() as any;
}

/** Extract session token from Set-Cookie header */
function extractSessionToken(res: Response): string | null {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  const match = setCookie.match(/exepad_app_session=([^;]+)/);
  return match ? match[1] : null;
}

// ─── Phase 2.1: Signup Flow ───────────────────────────────────────────

describe('Phase 2.1 — Signup Flow', () => {
  it('2.1a — auth_signup with valid email/password → user created, Set-Cookie present', async () => {
    const res = await rpcRaw({
      method: 'auth_signup',
      params: {
        email: `signup-valid-${TS}@test.com`,
        password: 'SecureP@ss1',
        name: 'Signup Test',
      },
    });

    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.user).toBeDefined();
    expect(json.data.user.id).toBeDefined();
    expect(json.data.user.email).toBe(`signup-valid-${TS}@test.com`);
    expect(json.data.user.name).toBe('Signup Test');
    expect(json.data.user.roles).toBeInstanceOf(Array);

    // Set-Cookie header must be present with session token
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('exepad_app_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');

    // Token should NOT be in the JSON body (it gets stripped)
    expect(json.data._sessionToken).toBeUndefined();
  });

  it('2.1b — auth_signup with duplicate email → error, no crash', async () => {
    const email = `signup-dup-${TS}@test.com`;

    // First signup succeeds
    await rpcJson({
      method: 'auth_signup',
      params: { email, password: 'SecureP@ss1', name: 'First' },
    });

    // Second signup with same email should fail
    const res = await rpcJson({
      method: 'auth_signup',
      params: { email, password: 'SecureP@ss1', name: 'Second' },
    });

    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });

  it('2.1c — auth_signup with weak password → rejected with validation error', async () => {
    const res = await rpcJson({
      method: 'auth_signup',
      params: {
        email: `signup-weak-${TS}@test.com`,
        password: 'short',  // less than 8 chars
        name: 'Weak Password',
      },
    });

    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.error.message.toLowerCase()).toContain('password');
  });

  it('2.1d — auth_signup with invalid email format → rejected', async () => {
    const res = await rpcJson({
      method: 'auth_signup',
      params: {
        email: 'not-an-email',
        password: 'SecureP@ss1',
        name: 'Bad Email',
      },
    });

    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });
});

// ─── Phase 2.2: Signin Flow ──────────────────────────────────────────

describe('Phase 2.2 — Signin Flow', () => {
  const signinEmail = `signin-${TS}@test.com`;
  const signinPassword = 'SecureP@ss1';

  // Create account for signin tests
  it('setup — create account for signin tests', async () => {
    const res = await rpcJson({
      method: 'auth_signup',
      params: { email: signinEmail, password: signinPassword, name: 'Signin User' },
    });
    expect(res.success).toBe(true);
  });

  it('2.2a — auth_signin with correct credentials → session cookie set, user returned', async () => {
    const res = await rpcRaw({
      method: 'auth_signin',
      params: { email: signinEmail, password: signinPassword },
    });

    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.user).toBeDefined();
    expect(json.data.user.id).toBeDefined();
    expect(json.data.user.email).toBe(signinEmail);
    expect(json.data.user.name).toBe('Signin User');
    expect(json.data.user.roles).toBeInstanceOf(Array);

    // Session cookie must be set
    const token = extractSessionToken(res);
    expect(token).toBeTruthy();
    expect(token!.length).toBeGreaterThanOrEqual(32);
  });

  it('2.2b — auth_signin with wrong password → generic error (not "wrong password")', async () => {
    const res = await rpcJson({
      method: 'auth_signin',
      params: { email: signinEmail, password: 'WrongPassword1' },
    });

    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    // Must use a generic message that doesn't leak whether the email exists
    const msg = res.error.message.toLowerCase();
    expect(msg).toContain('invalid');
    expect(msg).not.toContain('wrong password');
  });

  it('2.2c — auth_signin with non-existent email → same generic error (prevents enumeration)', async () => {
    const res = await rpcJson({
      method: 'auth_signin',
      params: { email: `nonexistent-${TS}@test.com`, password: 'SecureP@ss1' },
    });

    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    // Same generic error as wrong password
    const msg = res.error.message.toLowerCase();
    expect(msg).toContain('invalid');
  });
});

// ─── Phase 2.3: Session & Me ─────────────────────────────────────────

describe('Phase 2.3 — Session & Me', () => {
  let sessionToken: string;
  const meEmail = `me-${TS}@test.com`;
  const mePassword = 'SecureP@ss1';

  it('setup — signup and capture session token', async () => {
    const res = await rpcRaw({
      method: 'auth_signup',
      params: { email: meEmail, password: mePassword, name: 'Me User' },
    });

    sessionToken = extractSessionToken(res)!;
    expect(sessionToken).toBeTruthy();
  });

  it('2.3a — auth_me with valid session → returns user object', async () => {
    const res = await rpcJson(
      { method: 'auth_me' },
      { 'X-Session-Token': sessionToken }
    );

    expect(res.success).toBe(true);
    expect(res.data.user).toBeDefined();
    expect(res.data.user.email).toBe(meEmail);
    expect(res.data.user.name).toBe('Me User');
    expect(res.data.user.id).toBeDefined();
    expect(res.data.user.roles).toBeInstanceOf(Array);
  });

  it('2.3b — auth_me with invalid/expired session → returns null user', async () => {
    const res = await rpcJson(
      { method: 'auth_me' },
      { 'X-Session-Token': 'invalid-token-abcdef123456' }
    );

    // auth_me returns { success: true, data: null } when no valid session
    // (by design — it's a session check, not an auth-required endpoint)
    expect(res.success).toBe(true);
    expect(res.data).toBeNull();
  });

  it('2.3c — auth_me with no session → returns null user', async () => {
    const res = await rpcJson(
      { method: 'auth_me' },
      {} // no session token, no platform headers
    );

    expect(res.success).toBe(true);
    expect(res.data).toBeNull();
  });

  it('2.3d — auth_signout → cookie cleared, subsequent auth_me returns 401', async () => {
    // First sign in to get a fresh token (the signup token may still work)
    const signinRes = await rpcRaw({
      method: 'auth_signin',
      params: { email: meEmail, password: mePassword },
    });
    const freshToken = extractSessionToken(signinRes)!;
    expect(freshToken).toBeTruthy();

    // Verify the token works
    const meCheck = await rpcJson(
      { method: 'auth_me' },
      { 'X-Session-Token': freshToken }
    );
    expect(meCheck.success).toBe(true);

    // Sign out
    const signoutRes = await rpcRaw(
      { method: 'auth_signout' },
      { 'Content-Type': 'application/json', 'X-Session-Token': freshToken }
    );

    const signoutJson = (await signoutRes.json()) as any;
    expect(signoutJson.success).toBe(true);

    // Set-Cookie should clear the cookie (Max-Age=0)
    const setCookie = signoutRes.headers.get('set-cookie');
    expect(setCookie).toContain('Max-Age=0');

    // Subsequent auth_me with the same token should return null (session invalidated)
    const meAfter = await rpcJson(
      { method: 'auth_me' },
      { 'X-Session-Token': freshToken }
    );
    expect(meAfter.data).toBeNull();
  });
});

// ─── Phase 2.4: Dual-Mode Gateway ────────────────────────────────────

describe('Phase 2.4 — Dual-Mode Gateway', () => {
  it('2.4a — Mode A: X-User-Id headers work for CRUD when no session', async () => {
    // Use platform headers (Mode A) for a CRUD operation
    const res = await rpcJson(
      {
        method: 'sys_list',
        model: 'contacts',
        params: { limit: 1 },
      },
      {
        'X-User-Id': 'platform-user-1',
        'X-User-Email': 'platform@example.com',
        'X-User-Roles': 'user',
      }
    );

    expect(res.success).toBe(true);
    // Mode A should work — the request should be processed
    expect(res.data).toBeInstanceOf(Array);
  });

  it('2.4b — Mode B: session cookie takes precedence over platform headers', async () => {
    // Sign up to get a session token
    const email = `modeB-${TS}@test.com`;
    const signupRes = await rpcRaw({
      method: 'auth_signup',
      params: { email, password: 'SecureP@ss1', name: 'Mode B User' },
    });
    const token = extractSessionToken(signupRes)!;
    expect(token).toBeTruthy();

    // Call auth_me with BOTH session token AND platform headers
    // Mode B (session) should take precedence
    const res = await rpcJson(
      { method: 'auth_me' },
      {
        'X-Session-Token': token,
        'X-User-Id': 'different-platform-user',
        'X-User-Email': 'different@example.com',
        'X-User-Roles': 'admin',
      }
    );

    expect(res.success).toBe(true);
    // The returned user should be the Mode B session user, NOT the platform header user
    // Auth system lowercases emails on signup
    expect(res.data.user.email).toBe(email.toLowerCase());
    expect(res.data.user.email).not.toBe('different@example.com');
  });
});
