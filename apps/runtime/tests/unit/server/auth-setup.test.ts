// @vitest-environment node
/**
 * Keystone tests for the operator platform-auth route (`routes/auth.ts`).
 *
 * These cover the first-run instance-claim protection the OSS launch relies on
 * to stop whoever reaches the port first from claiming an exposed instance, plus
 * the login and self-service password-change paths:
 *
 *   - POST /auth/setup: setup-token gate (required token: wrong/missing → 403,
 *     correct → first admin + session cookie), password length validation, and
 *     the "already completed" guard once any user exists.
 *   - POST /auth/login: wrong password → 401, correct → 200 + session cookie.
 *   - POST /auth/change-password: auth guard, wrong current password → 400,
 *     success rotates the stored hash.
 *
 * The real Hono `auth` app is mounted in-memory; only the meta DB location and
 * the worker Env are stubbed, so the session-crypto + password paths run
 * end-to-end (no mocks of auth, meta-db, or password).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auth } from '../../../worker/src/routes/auth';
import { countUsers, getUserByEmail } from '../../../worker/src/lib/meta-db';
import { PLATFORM_SESSION_COOKIE, mintSessionToken } from '../../../worker/src/routes/gateway/auth';
import type { Env } from '../../../worker/src/types/env';

const SECRET = 'test-session-secret-auth-setup-0123456789';
const SETUP_TOKEN = 'setup-token-abcdef-0123456789';
let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-auth-setup-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
  process.env.EXEPAD_META_DB = join(dataDir, 'meta.sqlite');
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.EXEPAD_SETUP_TOKEN;
  delete process.env.EXEPAD_ALLOW_OPEN_SETUP;
  delete process.env.EXEPAD_COOKIE_SECURE;
});

function env(): Env {
  return { PLATFORM_BRIDGE_SECRET: SECRET } as unknown as Env;
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://host.local${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function setCookieHeaders(res: Response): string {
  // Hono/undici expose Set-Cookie via getSetCookie() when present.
  const getter = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getter === 'function') return getter.call(res.headers).join('\n');
  return res.headers.get('set-cookie') || '';
}

// Runs before any user exists — order matters (setup is a first-run-only gate).
describe('POST /auth/setup — first-run instance claim', () => {
  it('rejects setup with a MISSING token when a setup token is required', async () => {
    process.env.EXEPAD_SETUP_TOKEN = SETUP_TOKEN;
    expect(countUsers()).toBe(0);
    const res = await auth.fetch(
      post('/setup', { email: 'admin@x.com', password: 'longenoughpw' }),
      env(),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false });
    expect(countUsers()).toBe(0); // no admin was created
  });

  it('rejects setup with a WRONG token when a setup token is required', async () => {
    process.env.EXEPAD_SETUP_TOKEN = SETUP_TOKEN;
    const res = await auth.fetch(
      post('/setup', { email: 'admin@x.com', password: 'longenoughpw', setupToken: 'nope' }),
      env(),
    );
    expect(res.status).toBe(403);
    expect(countUsers()).toBe(0);
  });

  it('rejects a short (<8 char) password even with a valid token', async () => {
    process.env.EXEPAD_SETUP_TOKEN = SETUP_TOKEN;
    const res = await auth.fetch(
      post('/setup', { email: 'admin@x.com', password: 'short', setupToken: SETUP_TOKEN }),
      env(),
    );
    expect(res.status).toBe(400);
    expect(countUsers()).toBe(0);
  });

  it('creates the first admin with the correct token and sets a session cookie', async () => {
    process.env.EXEPAD_SETUP_TOKEN = SETUP_TOKEN;
    const res = await auth.fetch(
      post('/setup', {
        email: 'Admin@X.com',
        password: 'a-strong-password',
        setupToken: SETUP_TOKEN,
      }),
      env(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; user: { email: string; role: string } };
    expect(body.success).toBe(true);
    expect(body.user.email).toBe('admin@x.com'); // normalized lowercase
    expect(body.user.role).toBe('admin');
    expect(setCookieHeaders(res)).toContain(`${PLATFORM_SESSION_COOKIE}=`);
    expect(countUsers()).toBe(1);
  });

  it('refuses a SECOND setup once an admin exists (regardless of token)', async () => {
    process.env.EXEPAD_SETUP_TOKEN = SETUP_TOKEN;
    const res = await auth.fetch(
      post('/setup', { email: 'attacker@x.com', password: 'a-strong-password', setupToken: SETUP_TOKEN }),
      env(),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, error: 'Setup already completed' });
    expect(countUsers()).toBe(1);
  });
});

// These depend on the admin created above.
describe('POST /auth/login', () => {
  it('rejects a wrong password with 401', async () => {
    const res = await auth.fetch(
      post('/login', { email: 'admin@x.com', password: 'wrong-password' }),
      env(),
    );
    expect(res.status).toBe(401);
    expect(setCookieHeaders(res)).not.toContain(`${PLATFORM_SESSION_COOKIE}=`);
  });

  it('rejects an unknown email with 401 (no user enumeration via status)', async () => {
    const res = await auth.fetch(
      post('/login', { email: 'nobody@x.com', password: 'a-strong-password' }),
      env(),
    );
    expect(res.status).toBe(401);
  });

  it('accepts the correct password and sets the session cookie', async () => {
    const res = await auth.fetch(
      post('/login', { email: 'admin@x.com', password: 'a-strong-password' }),
      env(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
    expect(setCookieHeaders(res)).toContain(`${PLATFORM_SESSION_COOKIE}=`);
  });
});

describe('POST /auth/change-password', () => {
  async function adminCookie(): Promise<string> {
    const user = getUserByEmail('admin@x.com')!;
    const token = await mintSessionToken(user.id, user.email, [user.role], SECRET);
    return `${PLATFORM_SESSION_COOKIE}=${token}`;
  }

  it('requires an authenticated operator', async () => {
    const res = await auth.fetch(
      post('/change-password', { currentPassword: 'a-strong-password', newPassword: 'another-strong-pw' }),
      env(),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a wrong current password with 400', async () => {
    const cookie = await adminCookie();
    const res = await auth.fetch(
      post('/change-password', { currentPassword: 'not-it', newPassword: 'another-strong-pw' }, { Cookie: cookie }),
      env(),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a short new password with 400', async () => {
    const cookie = await adminCookie();
    const res = await auth.fetch(
      post('/change-password', { currentPassword: 'a-strong-password', newPassword: 'short' }, { Cookie: cookie }),
      env(),
    );
    expect(res.status).toBe(400);
  });

  it('rotates the password so the new one logs in and the old one no longer does', async () => {
    const cookie = await adminCookie();
    const changed = await auth.fetch(
      post('/change-password', { currentPassword: 'a-strong-password', newPassword: 'a-brand-new-password' }, { Cookie: cookie }),
      env(),
    );
    expect(changed.status).toBe(200);

    const oldLogin = await auth.fetch(post('/login', { email: 'admin@x.com', password: 'a-strong-password' }), env());
    expect(oldLogin.status).toBe(401);

    const newLogin = await auth.fetch(post('/login', { email: 'admin@x.com', password: 'a-brand-new-password' }), env());
    expect(newLogin.status).toBe(200);
  });
});
