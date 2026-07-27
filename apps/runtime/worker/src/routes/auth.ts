/**
 * Local platform authentication (self-hosted single container).
 *
 * Replaces the Django `app.exepad.com` login. A single operator (or a few)
 * logs into the builder UI; we verify against `meta.sqlite` users and mint an
 * HMAC-signed session token (reusing `gateway/auth.ts`), set as the
 * `exepad_platform_session` cookie. The same secret (PLATFORM_BRIDGE_SECRET =
 * EXEPAD_SESSION_SECRET) lets `resolveGatewayIdentity` decode the cookie and
 * grant the operator owner-identity on their own app previews.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types/env';
import { resolveSecret } from '../lib/secrets';
import { hashPassword, verifyPassword } from '../lib/password';
import { constantTimeEqual } from '../lib/crypto-utils';
import {
  bumpSessionGeneration,
  countUsers,
  createUser,
  getUserByEmail,
  getUserById,
  updateUserPassword,
  type MetaUser,
} from '../lib/meta-db';
import {
  mintSessionToken,
  verifyPlatformSession,
  PLATFORM_SESSION_COOKIE,
  PLATFORM_SESSION_TTL_SECONDS,
  type SessionPayload,
} from './gateway/auth';

export const auth = new Hono<{ Bindings: Env }>();

let warnedInsecureCookie = false;

function buildSessionCookie(token: string, maxAgeSeconds: number, isSecure?: boolean): string {
  const attrs = [
    `${PLATFORM_SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  // `Secure` when the caller computed it from a TLS-terminating proxy header,
  // with the env flag as a fallback when the param isn't passed. A Secure
  // cookie is dropped by the browser over plain HTTP (the default self-host
  // case, http://localhost:8080), which would silently break session auth.
  const secure = isSecure ?? process.env.EXEPAD_COOKIE_SECURE === '1';
  if (secure) {
    attrs.push('Secure');
  } else if (maxAgeSeconds > 0 && !warnedInsecureCookie) {
    // The platform session cookie is the sole credential authorizing the whole
    // admin/orchestrate/source surface. Issuing it WITHOUT `Secure` means a
    // plain-HTTP request could expose it to a network MITM. That's acceptable
    // for the local http://localhost default, but if the container is bound to a
    // public interface without TLS termination the operator should know. Warn
    // once so it's visible in the logs without spamming every login.
    warnedInsecureCookie = true;
    console.warn(
      '[auth] Issuing the platform session cookie WITHOUT the Secure flag ' +
      '(request was not detected as HTTPS). This is expected for local ' +
      'http://localhost use. If this instance is reachable over a network, ' +
      'terminate TLS in front of it or set EXEPAD_COOKIE_SECURE=1 so the ' +
      'admin credential is never sent over cleartext.',
    );
  }
  return attrs.join('; ');
}

/**
 * Compute whether the session cookie should carry `Secure`. True when the env
 * flag is set OR a reverse proxy reports the original request was HTTPS
 * (X-Forwarded-Proto / X-Forwarded-Scheme), so TLS terminated upstream still
 * yields a Secure cookie.
 */
function isRequestSecure(c: Context<{ Bindings: Env }>): boolean {
  return (
    process.env.EXEPAD_COOKIE_SECURE === '1' ||
    c.req.header('x-forwarded-proto') === 'https' ||
    c.req.header('x-forwarded-scheme') === 'https'
  );
}

function publicUser(user: MetaUser): { id: string; email: string; role: string } {
  return { id: user.id, email: user.email, role: user.role };
}

async function sessionSecret(env: Env): Promise<string> {
  return resolveSecret(env.PLATFORM_BRIDGE_SECRET);
}

/**
 * The resolved operator for platform routes. Backs the Studio builder surface
 * (orchestrate, publish, domains) via the signed session cookie.
 */
export interface PlatformAuth {
  payload: SessionPayload;
  user: MetaUser;
}

/**
 * Resolve the authenticated operator for platform routes, or null. Verifies the
 * platform session cookie (set at login) and confirms the user still exists in
 * `meta.sqlite`. Every existing `app.owner_id !== authed.user.id` check applies
 * unchanged.
 */
export async function requirePlatformUser(
  c: Context<{ Bindings: Env }>,
): Promise<PlatformAuth | null> {
  const secret = await sessionSecret(c.env);
  if (secret) {
    const payload = await verifyPlatformSession(c.req.raw, secret);
    if (payload) {
      const user = getUserById(payload.uid);
      if (user) {
        return { payload, user };
      }
    }
  }

  return null;
}

// First-run setup hardening. On a network-reachable instance, whoever POSTs to
// /auth/setup first would become the sole operator admin. When EXEPAD_SETUP_TOKEN
// is configured (the container generates one on first boot and prints it to the
// logs, unless an admin is seeded via EXEPAD_ADMIN_*), setup requires that
// token. EXEPAD_ALLOW_OPEN_SETUP=1 explicitly permits tokenless setup (e.g. a
// purely local, non-exposed instance).
function setupTokenConfig(): { token: string; required: boolean } {
  const token = (process.env.EXEPAD_SETUP_TOKEN || '').trim();
  const allowOpen = /^(1|true|yes|on)$/i.test((process.env.EXEPAD_ALLOW_OPEN_SETUP || '').trim());
  return { token, required: Boolean(token) && !allowOpen };
}

// ─── GET /auth/status — is first-run setup needed? ───────────────────────────

auth.get('/status', (c) => {
  return c.json({
    needsSetup: countUsers() === 0,
    setupTokenRequired: setupTokenConfig().required,
  });
});

// ─── POST /auth/setup — create the first admin (first-run only) ──────────────

auth.post('/setup', async (c) => {
  if (countUsers() > 0) {
    return c.json({ success: false, error: 'Setup already completed' }, 403);
  }
  let body: { email?: string; password?: string; setupToken?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  // Enforce the first-run setup token when configured, so an exposed instance
  // can't be claimed by whoever reaches the port first before the operator
  // completes setup.
  const { token: setupToken, required: setupTokenRequired } = setupTokenConfig();
  if (setupTokenRequired) {
    const provided = (c.req.header('X-Exepad-Setup-Token') || body.setupToken || '').trim();
    if (!provided || !constantTimeEqual(provided, setupToken)) {
      return c.json(
        {
          success: false,
          error: 'A valid setup token is required. It was printed to the server logs on first boot.',
        },
        403,
      );
    }
  }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !email.includes('@')) {
    return c.json({ success: false, error: 'A valid email is required' }, 400);
  }
  if (password.length < 8) {
    return c.json({ success: false, error: 'Password must be at least 8 characters' }, 400);
  }

  const secret = await sessionSecret(c.env);
  if (!secret) {
    return c.json(
      { success: false, error: 'EXEPAD_SESSION_SECRET is not configured' },
      500,
    );
  }

  const user = createUser(email, await hashPassword(password), 'admin');
  const token = await mintSessionToken(
    user.id, user.email, [user.role], secret, PLATFORM_SESSION_TTL_SECONDS, user.session_generation,
  );
  c.header('Set-Cookie', buildSessionCookie(token, PLATFORM_SESSION_TTL_SECONDS, isRequestSecure(c)));
  return c.json({ success: true, user: publicUser(user) });
});

// ─── POST /auth/login ────────────────────────────────────────────────────────

auth.post('/login', async (c) => {
  let body: { email?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !password) {
    return c.json({ success: false, error: 'Email and password are required' }, 400);
  }

  const secret = await sessionSecret(c.env);
  if (!secret) {
    return c.json(
      { success: false, error: 'EXEPAD_SESSION_SECRET is not configured' },
      500,
    );
  }

  const user = getUserByEmail(email);
  // Always run the hash verify (even on unknown email, against a dummy) to keep
  // timing uniform, then reject. constantTimeEqual handles the comparison. The
  // dummy hash MUST declare the SAME iteration count as real hashes
  // (lib/password.ts ITERATIONS) — verifyPassword derives bits using the count
  // embedded in the stored string, so a lower count would make the unknown-email
  // path measurably faster and leak whether an operator email exists.
  const ok = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyPassword(password, 'pbkdf2$600000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  if (!user || !ok) {
    return c.json({ success: false, error: 'Invalid email or password' }, 401);
  }

  const token = await mintSessionToken(
    user.id, user.email, [user.role], secret, PLATFORM_SESSION_TTL_SECONDS, user.session_generation,
  );
  c.header('Set-Cookie', buildSessionCookie(token, PLATFORM_SESSION_TTL_SECONDS, isRequestSecure(c)));
  return c.json({ success: true, user: publicUser(user) });
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────

auth.post('/logout', async (c) => {
  // Logout-ALL: bump the operator's session generation so every session token
  // minted before now (this browser AND any other device / copied cookie) is
  // rejected on its next use — not just clearing the cookie on this one client.
  // Scoped to the session COOKIE (not requirePlatformUser): a PAT bearer must
  // not be able to nuke the operator's interactive browser sessions.
  const secret = await sessionSecret(c.env);
  if (secret) {
    const payload = await verifyPlatformSession(c.req.raw, secret);
    if (payload) bumpSessionGeneration(payload.uid);
  }
  c.header('Set-Cookie', buildSessionCookie('', 0, isRequestSecure(c)));
  return c.json({ success: true });
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────

auth.get('/me', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);
  return c.json({ success: true, user: publicUser(authed.user) });
});

// ─── POST /auth/change-password — operator self-service ──────────────────────

auth.post('/change-password', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid request body' }, 400);
  }
  const currentPassword = body.currentPassword || '';
  const newPassword = body.newPassword || '';

  if (newPassword.length < 8) {
    return c.json({ success: false, error: 'New password must be at least 8 characters' }, 400);
  }
  const valid = await verifyPassword(currentPassword, authed.user.password_hash);
  if (!valid) {
    return c.json({ success: false, error: 'Current password is incorrect' }, 400);
  }

  updateUserPassword(authed.user.id, await hashPassword(newPassword));

  // Invalidate every session minted before this change (other browsers, stolen
  // cookies) by bumping the operator's session generation, then re-issue THIS
  // browser a fresh cookie carrying the new generation so the operator who just
  // changed their password isn't logged out of the tab they're using. Only the
  // cookie path can restamp a cookie; a PAT-authenticated caller simply gets the
  // (harmless, ignored) Set-Cookie header — its sessions are still revoked.
  const newGen = bumpSessionGeneration(authed.user.id);
  const secret = await sessionSecret(c.env);
  if (secret) {
    const token = await mintSessionToken(
      authed.user.id, authed.user.email, [authed.user.role], secret, PLATFORM_SESSION_TTL_SECONDS, newGen,
    );
    c.header('Set-Cookie', buildSessionCookie(token, PLATFORM_SESSION_TTL_SECONDS, isRequestSecure(c)));
  }
  return c.json({ success: true });
});

/**
 * Idempotent admin seed from environment. Called at boot (server/main.ts) so a
 * fresh container with `EXEPAD_ADMIN_EMAIL`/`EXEPAD_ADMIN_PASSWORD` set comes up
 * ready to log in. No-op if any user already exists or the env is unset.
 */
export async function seedAdminFromEnv(): Promise<void> {
  if (countUsers() > 0) return;
  const email = (process.env.EXEPAD_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.EXEPAD_ADMIN_PASSWORD || '';
  if (!email || !password) return;
  createUser(email, await hashPassword(password), 'admin');
  console.log(`[auth] Seeded admin account: ${email}`);
}
