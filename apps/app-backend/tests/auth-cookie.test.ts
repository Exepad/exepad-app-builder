/**
 * Auth Cookie & Worker Entry Point Tests
 *
 * Covers: Set-Cookie header generation, HttpOnly/Secure/SameSite flags,
 * domain handling, token stripping, SERVICE_TOKEN bypass for auth_*.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { hashPassword } from '../src/auth/utils';
import { createMockD1 } from './helpers/mock-d1';
import { createMockEnv, createMockKV } from './helpers/mock-env';
import { TEST_SECURITY, createAuthMockConfig } from './helpers/mock-auth';

// Import the worker default export
import worker from '../src/index';

let knownHash: string;
const KNOWN_PASSWORD = 'testPassword123';

beforeAll(async () => {
  knownHash = await hashPassword(KNOWN_PASSWORD);
});

function makeEnv(db: ReturnType<typeof createMockD1>, overrides?: Record<string, unknown>) {
  return createMockEnv({
    DB: db,
    configProps: createAuthMockConfig(TEST_SECURITY),
    APP_ID: 'test-app',
    APP_ALIAS: 'test',
    SERVICE_TOKEN: 'test-service-token',
    ...overrides,
  });
}

function makeSigninRequest(origin?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (origin) headers['Origin'] = origin;
  return new Request('http://localhost/rpc', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      method: 'auth_signin',
      params: { email: 'user@test.com', password: KNOWN_PASSWORD },
    }),
  });
}

function makeSignupRequest(origin?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (origin) headers['Origin'] = origin;
  return new Request('http://localhost/rpc', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      method: 'auth_signup',
      params: { email: 'new@test.com', password: 'password123' },
    }),
  });
}

function makeSignoutRequest(token: string) {
  return new Request('http://localhost/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Token': token,
    },
    body: JSON.stringify({ method: 'auth_signout', params: {} }),
  });
}

describe('Set-Cookie handling', () => {
  it('sets exepad_app_session cookie on auth_signin response', async () => {
    const db = createMockD1({
      results: new Map([
        ['SELECT', [{ id: 'u1', email: 'user@test.com', password_hash: knownHash, name: 'U', avatar_url: null, roles: 'user', email_verified: 0 }]],
      ]),
    });
    const env = makeEnv(db);
    const ctx = { waitUntil: () => {} } as any;

    const response = await worker.fetch(makeSigninRequest(), env as any, ctx);
    const setCookie = response.headers.get('Set-Cookie');

    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('exepad_app_session=');
  });

  it('sets exepad_app_session cookie on auth_signup response', async () => {
    const db = createMockD1({ firstReturnsNull: true }); // no existing user
    const env = makeEnv(db);
    const ctx = { waitUntil: () => {} } as any;

    const response = await worker.fetch(makeSignupRequest(), env as any, ctx);
    const setCookie = response.headers.get('Set-Cookie');

    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('exepad_app_session=');
  });

  it('cookie has HttpOnly flag', async () => {
    const db = createMockD1({
      results: new Map([
        ['SELECT', [{ id: 'u1', email: 'user@test.com', password_hash: knownHash, name: 'U', avatar_url: null, roles: 'user', email_verified: 0 }]],
      ]),
    });
    const env = makeEnv(db);
    const ctx = { waitUntil: () => {} } as any;

    const response = await worker.fetch(makeSigninRequest(), env as any, ctx);
    const setCookie = response.headers.get('Set-Cookie')!;

    expect(setCookie).toContain('HttpOnly');
  });

  it('cookie has SameSite=Lax', async () => {
    const db = createMockD1({
      results: new Map([
        ['SELECT', [{ id: 'u1', email: 'user@test.com', password_hash: knownHash, name: 'U', avatar_url: null, roles: 'user', email_verified: 0 }]],
      ]),
    });
    const env = makeEnv(db);
    const ctx = { waitUntil: () => {} } as any;

    const response = await worker.fetch(makeSigninRequest(), env as any, ctx);
    const setCookie = response.headers.get('Set-Cookie')!;

    expect(setCookie).toContain('SameSite=Lax');
  });

  it('cookie omits Secure flag on localhost', async () => {
    const db = createMockD1({
      results: new Map([
        ['SELECT', [{ id: 'u1', email: 'user@test.com', password_hash: knownHash, name: 'U', avatar_url: null, roles: 'user', email_verified: 0 }]],
      ]),
    });
    const env = makeEnv(db);
    const ctx = { waitUntil: () => {} } as any;

    // localhost origin
    const response = await worker.fetch(makeSigninRequest('http://localhost:3000'), env as any, ctx);
    const setCookie = response.headers.get('Set-Cookie')!;

    expect(setCookie).not.toContain('Secure');
  });

  it('cookie has Secure flag when Origin is not localhost', async () => {
    const db = createMockD1({
      results: new Map([
        ['SELECT', [{ id: 'u1', email: 'user@test.com', password_hash: knownHash, name: 'U', avatar_url: null, roles: 'user', email_verified: 0 }]],
      ]),
    });
    const env = makeEnv(db);
    const ctx = { waitUntil: () => {} } as any;

    const response = await worker.fetch(makeSigninRequest('https://myapp.example.com'), env as any, ctx);
    const setCookie = response.headers.get('Set-Cookie')!;

    expect(setCookie).toContain('Secure');
  });

  it('cookie omits Domain on localhost', async () => {
    const db = createMockD1({
      results: new Map([
        ['SELECT', [{ id: 'u1', email: 'user@test.com', password_hash: knownHash, name: 'U', avatar_url: null, roles: 'user', email_verified: 0 }]],
      ]),
    });
    const env = makeEnv(db);
    const ctx = { waitUntil: () => {} } as any;

    const response = await worker.fetch(makeSigninRequest('http://localhost:3000'), env as any, ctx);
    const setCookie = response.headers.get('Set-Cookie')!;

    expect(setCookie).not.toContain('Domain=');
  });

  it('cookie is host-only — never sets Domain from the request Origin/Host', async () => {
    // Security: the cookie Domain must not be derived from the client-supplied
    // Origin/Host header (a crafted Origin could otherwise broaden the cookie to
    // a parent domain / sibling subdomains). A host-only cookie scopes to the
    // exact serving host, matching the operator platform-session cookie.
    const db = createMockD1({
      results: new Map([
        ['SELECT', [{ id: 'u1', email: 'user@test.com', password_hash: knownHash, name: 'U', avatar_url: null, roles: 'user', email_verified: 0 }]],
      ]),
    });
    const env = makeEnv(db);
    const ctx = { waitUntil: () => {} } as any;

    const response = await worker.fetch(makeSigninRequest('https://app.example.com'), env as any, ctx);
    const setCookie = response.headers.get('Set-Cookie')!;

    expect(setCookie).not.toContain('Domain=');
    // Still Secure on a non-localhost origin.
    expect(setCookie).toContain('Secure');
  });

  it('cookie Max-Age defaults to 604800 (7 days)', async () => {
    const db = createMockD1({
      results: new Map([
        ['SELECT', [{ id: 'u1', email: 'user@test.com', password_hash: knownHash, name: 'U', avatar_url: null, roles: 'user', email_verified: 0 }]],
      ]),
    });
    const env = makeEnv(db);
    const ctx = { waitUntil: () => {} } as any;

    const response = await worker.fetch(makeSigninRequest(), env as any, ctx);
    const setCookie = response.headers.get('Set-Cookie')!;

    expect(setCookie).toContain('Max-Age=604800');
  });

  it('strips _sessionToken from response body', async () => {
    const db = createMockD1({
      results: new Map([
        ['SELECT', [{ id: 'u1', email: 'user@test.com', password_hash: knownHash, name: 'U', avatar_url: null, roles: 'user', email_verified: 0 }]],
      ]),
    });
    const env = makeEnv(db);
    const ctx = { waitUntil: () => {} } as any;

    const response = await worker.fetch(makeSigninRequest(), env as any, ctx);
    const body = await response.json() as any;

    expect(body.data._sessionToken).toBeUndefined();
    expect(body.data.user).toBeDefined();
  });
});

// ── Clear Session ─────────────────────────────────────────────────

describe('clear session', () => {
  it('sets Max-Age=0 cookie on auth_signout', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    const ctx = { waitUntil: () => {} } as any;

    const response = await worker.fetch(makeSignoutRequest('some-token'), env as any, ctx);
    const setCookie = response.headers.get('Set-Cookie');

    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('exepad_app_session=;');
  });

  it('strips _clearSession from response body', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    const ctx = { waitUntil: () => {} } as any;

    const response = await worker.fetch(makeSignoutRequest('some-token'), env as any, ctx);
    const body = await response.json() as any;

    expect(body.data._clearSession).toBeUndefined();
  });
});

// ── SERVICE_TOKEN Bypass ──────────────────────────────────────────

describe('SERVICE_TOKEN bypass', () => {
  it('does NOT require SERVICE_TOKEN for auth_* methods', async () => {
    const db = createMockD1({ firstReturnsNull: true });
    const env = makeEnv(db, { SERVICE_TOKEN: 'required-token' });
    const ctx = { waitUntil: () => {} } as any;

    // auth_signup without SERVICE_TOKEN header — should succeed
    const response = await worker.fetch(makeSignupRequest(), env as any, ctx);
    expect(response.status).toBe(200);
  });

  it('requires SERVICE_TOKEN for sys_* methods', async () => {
    const db = createMockD1();
    const env = makeEnv(db, { SERVICE_TOKEN: 'required-token' });
    const ctx = { waitUntil: () => {} } as any;

    // sys_list without SERVICE_TOKEN — should fail
    const request = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'sys_list', model: 'contacts', params: {} }),
    });

    const response = await worker.fetch(request, env as any, ctx);
    expect(response.status).not.toBe(200);
  });
});

// ── Custom sessionDuration ──────────────────────────────────────

describe('custom sessionDuration', () => {
  it('cookie Max-Age uses security.sessionDuration when set', async () => {
    const customSecurity = { ...TEST_SECURITY, sessionDuration: 3600 };
    const db = createMockD1({
      results: new Map([
        ['SELECT', [{ id: 'u1', email: 'user@test.com', password_hash: knownHash, name: 'U', avatar_url: null, roles: 'user', email_verified: 0 }]],
      ]),
    });
    const env = createMockEnv({
      DB: db,
      configProps: createAuthMockConfig(customSecurity),
      APP_ID: 'test-app',
      APP_ALIAS: 'test',
      SERVICE_TOKEN: 'test-service-token',
    });
    const ctx = { waitUntil: () => {} } as any;

    const response = await worker.fetch(makeSigninRequest(), env as any, ctx);
    const setCookie = response.headers.get('Set-Cookie')!;

    expect(setCookie).toContain('Max-Age=3600');
  });
});
