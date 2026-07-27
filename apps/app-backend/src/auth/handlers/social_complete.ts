/**
 * auth_social_complete — Complete OAuth flow by creating/linking user and session.
 *
 * ⚠️  NOT REACHABLE END-TO-END IN THE SELF-HOSTED BUILD. This is the second half
 * of a social-login flow whose FIRST half — the runtime-side provider callback
 * that exchanges the authorization code and calls this method — is not part of
 * the self-hosted runtime. Nothing in this repo invokes `auth_social_complete`;
 * it is reachable only as a directly-called RPC method. Treat it as unfinished
 * scaffolding, not a supported feature.
 *
 * Given a verified provider profile + the nonce minted by auth_social_login, it:
 *
 * 1. Validates the nonce (single-use, stored by auth_social_login)
 * 2. Finds or creates the user
 * 3. Links the provider account
 * 4. Creates a session
 * 5. Returns user + raw session token + OAuth metadata
 *
 * Unlike auth_signin/auth_signup, this handler does NOT use the `_sessionToken`
 * signal (which the entry point turns into a Set-Cookie): the caller is expected
 * to be a server-side callback that needs the raw token to carry into its own
 * redirect. `sessionToken`, `returnUrl`, and `appAlias` are therefore returned
 * as plain data fields.
 */

import type { SecurityProps, ModelProps, HandlerProps } from '@exepad/types';
import {
  generateSessionToken,
  hashSessionToken,
  generateId,
  parseRoles,
  now,
  expiresAt,
  resolveSelfSignupRole,
} from '../utils';
import { ValidationError, ForbiddenError, EmailNotVerifiedError } from '../../utils/errors';

const DEFAULT_SESSION_DURATION = 604800; // 7 days

interface SocialProfile {
  email: string;
  name?: string;
  avatar_url?: string;
  provider_account_id: string; // Google 'sub' claim
  /** ID-token claim from the OAuth provider. Google always sets this to true. */
  email_verified?: boolean;
}

export interface SocialCompleteResult {
  user: {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
    roles: string[];
    email_verified: boolean;
  };
  /** Raw session token for the runtime callback to encrypt into the finalize URL. */
  sessionToken: string;
  /** Where to redirect the user after auth. */
  returnUrl: string;
  /** App subdomain alias — legacy fallback when `origin` isn't set. */
  appAlias: string;
  /**
   * Browser origin captured at `auth_social_login` time, e.g.
   * `https://ironpulsegymmanager.exepad.app`. Empty string if the client
   * didn't send one or the value failed the `*.exepad.app` allowlist check.
   * When present, the runtime callback uses this directly instead of
   * reconstructing `${appAlias}.exepad.app` — which can differ from the
   * live subdomain.
   */
  origin: string;
}

export async function authSocialComplete(
  params: Record<string, unknown>,
  db: D1Database,
  security: SecurityProps,
  opts?: { models?: ModelProps[]; handlers?: HandlerProps[] }
): Promise<SocialCompleteResult> {
  const provider = params.provider as string;
  const profile = params.profile as SocialProfile | undefined;
  const nonce = params.nonce as string | undefined;

  if (!provider || !profile?.email || !profile?.provider_account_id || !nonce) {
    throw new ValidationError('Missing required parameters: provider, profile, nonce');
  }

  // Honor the "Require Email Verification" toggle against the provider's
  // own verification claim. Google always returns `email_verified: true`
  // for addresses managed through Google (the provider has already done
  // identity proofing). For other providers that could return false, we
  // block entry — the user would need to switch to email/password signup
  // and go through our own verification flow. Callers that don't pass the
  // claim at all are implicitly trusted (status-quo behaviour), so this
  // check only fires on an explicit `false`.
  if (
    security.requireVerification === true &&
    profile.email_verified === false
  ) {
    throw new EmailNotVerifiedError(
      'Your email address could not be automatically verified. Please use email/password signup and verify manually.',
    );
  }

  // 1. Validate nonce — lookup in _auth_verification_tokens
  const nonceHash = await hashSessionToken(nonce);
  const storedToken = await db
    .prepare(
      `SELECT token, user_id, type, expires_at FROM _auth_verification_tokens
       WHERE token = ? AND type = 'oauth_state'`
    )
    .bind(nonceHash)
    .first<{ token: string; user_id: string; type: string; expires_at: string }>();

  if (!storedToken) {
    throw new ValidationError('Invalid or expired OAuth state');
  }

  // Check expiry
  if (new Date(storedToken.expires_at) < new Date()) {
    await db.prepare('DELETE FROM _auth_verification_tokens WHERE token = ?').bind(nonceHash).run();
    throw new ValidationError('OAuth state has expired. Please try again.');
  }

  // 2. Delete nonce (single-use) and parse stored metadata
  await db.prepare('DELETE FROM _auth_verification_tokens WHERE token = ?').bind(nonceHash).run();

  let returnUrl = '/';
  let appAlias = '';
  let origin = '';
  try {
    const parsed = JSON.parse(storedToken.user_id);
    returnUrl = parsed.returnUrl || '/';
    appAlias = parsed.appAlias || '';
    origin = parsed.origin || '';
  } catch {
    // Fallback to defaults
  }

  const email = profile.email.toLowerCase().trim();
  const timestamp = now();
  const sessionDuration = security.sessionDuration ?? DEFAULT_SESSION_DURATION;

  // 3. Check if this provider account already exists
  const existingAccount = await db
    .prepare(
      `SELECT a.user_id, u.id, u.email, u.name, u.avatar_url, u.roles, u.email_verified
       FROM _auth_accounts a
       JOIN _auth_users u ON u.id = a.user_id
       WHERE a.provider = ? AND a.provider_account_id = ?`
    )
    .bind(provider, profile.provider_account_id)
    .first<{
      user_id: string;
      id: string;
      email: string;
      name: string | null;
      avatar_url: string | null;
      roles: string;
      email_verified: number;
    }>();

  if (existingAccount) {
    // Existing OAuth user — create session and return
    const rawToken = generateSessionToken();
    const tokenHash = await hashSessionToken(rawToken);

    await db
      .prepare(
        `INSERT INTO _auth_sessions (id, user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(tokenHash, existingAccount.id, expiresAt(sessionDuration), timestamp)
      .run();

    return {
      user: {
        id: existingAccount.id,
        email: existingAccount.email,
        name: existingAccount.name,
        avatar_url: existingAccount.avatar_url,
        roles: parseRoles(existingAccount.roles),
        email_verified: existingAccount.email_verified === 1,
      },
      sessionToken: rawToken,
      returnUrl,
      appAlias,
      origin,
    };
  }

  // 4. No existing provider account — check if a user with this email exists
  const existingUser = await db
    .prepare(
      'SELECT id, email, name, avatar_url, roles, email_verified FROM _auth_users WHERE email = ?'
    )
    .bind(email)
    .first<{
      id: string;
      email: string;
      name: string | null;
      avatar_url: string | null;
      roles: string;
      email_verified: number;
    }>();

  if (existingUser) {
    // Link new provider account to existing user
    const rawToken = generateSessionToken();
    const tokenHash = await hashSessionToken(rawToken);

    await db.batch([
      db
        .prepare(
          `INSERT INTO _auth_accounts (id, user_id, provider, provider_account_id)
           VALUES (?, ?, ?, ?)`
        )
        .bind(generateId(), existingUser.id, provider, profile.provider_account_id),
      db
        .prepare(
          `INSERT INTO _auth_sessions (id, user_id, expires_at, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind(tokenHash, existingUser.id, expiresAt(sessionDuration), timestamp),
    ]);

    return {
      user: {
        id: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
        avatar_url: existingUser.avatar_url,
        roles: parseRoles(existingUser.roles),
        email_verified: existingUser.email_verified === 1,
      },
      sessionToken: rawToken,
      returnUrl,
      appAlias,
      origin,
    };
  }

  // 5. No existing user — create new user (if signup is allowed)
  if (security.allowSignup === false) {
    throw new ForbiddenError('Account not found. Contact your administrator.');
  }

  const userId = generateId();
  // Same privilege-escalation guard as email signup: a social self-registration
  // must never mint a privileged role (see resolveSelfSignupRole).
  const { role: signupRole, downgradedFrom } = resolveSelfSignupRole(security, {
    models: opts?.models,
    handlers: opts?.handlers,
  });
  if (downgradedFrom) {
    console.warn(
      `[authSocialComplete] defaultRole '${downgradedFrom}' is privileged; social self-registration downgraded to '${signupRole}' to prevent privilege escalation`,
    );
  }
  const rolesJson = JSON.stringify([signupRole]);
  const rawToken = generateSessionToken();
  const tokenHash = await hashSessionToken(rawToken);

  await db.batch([
    // Create user (password_hash is NULL for social-only users)
    db
      .prepare(
        `INSERT INTO _auth_users (id, email, password_hash, name, avatar_url, roles, email_verified, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, 1, ?, ?)`
      )
      .bind(
        userId,
        email,
        profile.name || null,
        profile.avatar_url || null,
        rolesJson,
        timestamp,
        timestamp
      ),
    // Link provider account
    db
      .prepare(
        `INSERT INTO _auth_accounts (id, user_id, provider, provider_account_id)
         VALUES (?, ?, ?, ?)`
      )
      .bind(generateId(), userId, provider, profile.provider_account_id),
    // Create session
    db
      .prepare(
        `INSERT INTO _auth_sessions (id, user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(tokenHash, userId, expiresAt(sessionDuration), timestamp),
  ]);

  return {
    user: {
      id: userId,
      email,
      name: profile.name || null,
      avatar_url: profile.avatar_url || null,
      roles: [signupRole],
      email_verified: true, // Google-verified email
    },
    sessionToken: rawToken,
    returnUrl,
    appAlias,
    origin,
  };
}
