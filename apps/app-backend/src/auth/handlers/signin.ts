/**
 * auth_signin — Email/password login
 */

import type { SecurityProps } from '@exepad/types';
import type { AuthResult, SigninParams } from '../types';
import {
  verifyPassword,
  hashPassword,
  needsRehash,
  getDummyPasswordHash,
  generateSessionToken,
  hashSessionToken,
  isValidEmail,
  parseRoles,
  now,
  expiresAt,
} from '../utils';
import { UnauthorizedError, ValidationError, EmailNotVerifiedError } from '../../utils/errors';

const DEFAULT_SESSION_DURATION = 604800; // 7 days
const INVALID_CREDENTIALS_MSG = 'Invalid email or password';

export async function authSignin(
  params: Record<string, unknown>,
  db: D1Database,
  security: SecurityProps
): Promise<AuthResult> {
  const { email, password } = params as unknown as SigninParams;

  if (!email || !password) {
    throw new ValidationError('Email and password are required');
  }
  if (!isValidEmail(email)) {
    throw new UnauthorizedError(INVALID_CREDENTIALS_MSG);
  }

  // Lookup user — generic error to prevent user enumeration
  const user = await db
    .prepare(
      'SELECT id, email, password_hash, name, avatar_url, roles, email_verified FROM _auth_users WHERE email = ?'
    )
    .bind(email.toLowerCase().trim())
    .first<{
      id: string;
      email: string;
      password_hash: string | null;
      name: string | null;
      avatar_url: string | null;
      roles: string;
      email_verified: number;
    }>();

  if (!user || !user.password_hash) {
    // Run one real PBKDF2 derivation against a dummy hash before rejecting, so
    // the unknown-user path takes the same wall-clock time as a known-user
    // password check. Without this, the fast reject here vs. the slow verify
    // below is a reliable oracle for whether an email is registered.
    await verifyPassword(password, await getDummyPasswordHash());
    throw new UnauthorizedError(INVALID_CREDENTIALS_MSG);
  }

  // Verify password (timing-safe)
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    throw new UnauthorizedError(INVALID_CREDENTIALS_MSG);
  }

  // Transparently upgrade a below-strength hash now that we hold the plaintext
  // and it verified. Best-effort — a write failure must not fail the login.
  if (needsRehash(user.password_hash)) {
    const upgraded = await hashPassword(password);
    await db
      .prepare('UPDATE _auth_users SET password_hash = ? WHERE id = ?')
      .bind(upgraded, user.id)
      .run()
      .catch((err) => console.warn('[authSignin] password rehash upgrade failed:', err));
  }

  // Block unverified users when the admin has turned on the
  // "Require Email Verification" toggle. Runs AFTER the password check so
  // the client can distinguish "wrong credentials" from "verify first" —
  // that's fine for UX (the user already proved they know the password)
  // and doesn't leak user existence beyond what a correct password does.
  if (security.requireVerification === true && user.email_verified !== 1) {
    throw new EmailNotVerifiedError(
      'Email not verified. Check your inbox for the verification link, or request a new one.',
    );
  }

  // Create session
  const rawToken = generateSessionToken();
  const tokenHash = await hashSessionToken(rawToken);
  const sessionDuration = security.sessionDuration ?? DEFAULT_SESSION_DURATION;
  const timestamp = now();

  await db
    .prepare(
      `INSERT INTO _auth_sessions (id, user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(tokenHash, user.id, expiresAt(sessionDuration), timestamp)
    .run();

  // Opportunistic cleanup: purge a batch of expired sessions to prevent table bloat.
  // Fire-and-forget — errors are logged but do not affect the login response.
  db.prepare("DELETE FROM _auth_sessions WHERE expires_at < datetime('now') LIMIT 100")
    .run()
    .catch((err) => console.warn('[authSignin] Expired session cleanup failed:', err));

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatar_url,
      roles: parseRoles(user.roles),
      email_verified: user.email_verified === 1,
    },
    _sessionToken: rawToken,
  };
}
