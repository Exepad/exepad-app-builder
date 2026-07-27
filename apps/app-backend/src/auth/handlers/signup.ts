/**
 * auth_signup — Email/password registration
 */

import type { SecurityProps, ModelProps, HandlerProps } from '@exepad/types';
import type { Env } from '../../types/env';
import type { AuthResult, SignupParams } from '../types';
import {
  hashPassword,
  generateSessionToken,
  hashSessionToken,
  generateId,
  isValidEmail,
  validatePassword,
  now,
  expiresAt,
  resolveSelfSignupRole,
} from '../utils';
import { issueEmailVerificationToken } from '../verification';
import { ValidationError, ConflictError, ForbiddenError, InternalError } from '../../utils/errors';
import { createEmailService, buildPlatformFetcher, type EmailServiceProps } from '../../services/email';

const DEFAULT_SESSION_DURATION = 604800; // 7 days

interface SignupDeps {
  env: Env;
  appName?: string;
  emailConfig?: EmailServiceProps;
  /** Deployed models/handlers — let the self-signup guard see CRUD/handler role gates. */
  models?: ModelProps[];
  handlers?: HandlerProps[];
}

export async function authSignup(
  params: Record<string, unknown>,
  db: D1Database,
  security: SecurityProps,
  request: Request,
  deps: SignupDeps
): Promise<AuthResult> {
  // Check if signup is allowed
  if (security.allowSignup === false) {
    throw new ForbiddenError('Self-registration is disabled for this app');
  }

  const { email, password, name } = params as unknown as SignupParams;

  // Validate inputs
  if (!email || !password) {
    throw new ValidationError('Email and password are required');
  }
  if (!isValidEmail(email)) {
    throw new ValidationError('Invalid email format', 'email');
  }

  const passwordError = validatePassword(password, security.passwordPolicy);
  if (passwordError) {
    throw new ValidationError(passwordError, 'password');
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Check email uniqueness
  const existing = await db
    .prepare('SELECT id FROM _auth_users WHERE email = ?')
    .bind(normalizedEmail)
    .first();
  if (existing) {
    throw new ConflictError('An account with this email already exists');
  }

  // Create user
  const userId = generateId();
  const timestamp = now();
  const passwordHash = await hashPassword(password);
  // Never let a public self-registration mint a privileged role. If the app's
  // defaultRole is privileged (e.g. an app misconfigured with defaultRole:'admin'
  // + allowSignup:true), downgrade to a safe non-privileged role so a random
  // visitor can't self-register into the admin dashboard.
  const { role: signupRole, downgradedFrom } = resolveSelfSignupRole(security, {
    models: deps?.models,
    handlers: deps?.handlers,
  });
  if (downgradedFrom) {
    console.warn(
      `[authSignup] defaultRole '${downgradedFrom}' is privileged; public self-registration downgraded to '${signupRole}' to prevent privilege escalation`,
    );
  }
  const rolesJson = JSON.stringify([signupRole]);

  await db.batch([
    db
      .prepare(
        `INSERT INTO _auth_users (id, email, password_hash, name, roles, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(userId, normalizedEmail, passwordHash, name || null, rolesJson, timestamp, timestamp),
    db
      .prepare(
        `INSERT INTO _auth_accounts (id, user_id, provider, provider_account_id)
         VALUES (?, ?, 'email', ?)`
      )
      .bind(generateId(), userId, normalizedEmail),
  ]);

  // If email verification is required, withhold the session and send a
  // verification email. The user must click the link before they can sign
  // in. This is the "Require Email Verification" admin toggle at work.
  if (security.requireVerification === true) {
    const rawVerifyToken = await issueEmailVerificationToken(db, userId);
    const origin =
      request.headers.get('Origin') ||
      (request.headers.get('Referer') ? new URL(request.headers.get('Referer')!).origin : null) ||
      new URL(request.url).origin;
    const verifyUrl = `${origin}/verify-email?token=${rawVerifyToken}`;

    try {
      const { env, appName, emailConfig } = deps;
      const platform = buildPlatformFetcher(env);
      const emailService = createEmailService({
        config: emailConfig || {},
        platform,
        appId: env.APP_ID,
        appName: appName || env.APP_ALIAS || env.APP_ID,
        platformSecret: env.PLATFORM_INTERNAL_SECRET,
      });
      await emailService.send({
        to: normalizedEmail,
        subject: `Verify your email`,
        template: 'email-verification',
        data: {
          appName: appName || env.APP_ALIAS || env.APP_ID,
          verifyUrl,
        },
      });
    } catch (err) {
      // Fail loud so the user can retry. Unlike password reset, there's
      // no enumeration-leak concern — the user just typed their own email.
      console.error('[authSignup] Failed to send verification email:', err);
      throw new InternalError('Could not send verification email. Please try again.');
    }

    return {
      user: {
        id: userId,
        email: normalizedEmail,
        name: name || null,
        avatar_url: null,
        roles: [signupRole],
        email_verified: false,
      },
      verification_required: true,
      // Intentionally NO _sessionToken — the user cannot access the app
      // until they click the verification link.
    };
  }

  // Standard flow: verification not required, issue a session immediately.
  const rawToken = generateSessionToken();
  const tokenHash = await hashSessionToken(rawToken);
  const sessionDuration = security.sessionDuration ?? DEFAULT_SESSION_DURATION;

  await db
    .prepare(
      `INSERT INTO _auth_sessions (id, user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(tokenHash, userId, expiresAt(sessionDuration), timestamp)
    .run();

  return {
    user: {
      id: userId,
      email: normalizedEmail,
      name: name || null,
      avatar_url: null,
      roles: [signupRole],
      email_verified: false,
    },
    _sessionToken: rawToken,
  };
}
