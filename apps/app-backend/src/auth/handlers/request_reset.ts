/**
 * auth_request_reset — Request a password reset email
 *
 * Always returns success to prevent email enumeration.
 * If the email exists, generates a reset token and sends an email.
 */

import type { SecurityProps } from '@exepad/types';
import type { AuthResult } from '../types';
import type { Env } from '../../types/env';
import {
  generateSessionToken,
  hashSessionToken,
  isValidEmail,
  now,
  expiresAt,
} from '../utils';
import { ValidationError } from '../../utils/errors';
import { createEmailService, buildPlatformFetcher, type EmailServiceProps } from '../../services/email';

const TOKEN_EXPIRY_SECONDS = 3600; // 1 hour

interface RequestResetDeps {
  env: Env;
  appName?: string;
  emailConfig?: EmailServiceProps;
}

export async function authRequestReset(
  params: Record<string, unknown>,
  db: D1Database,
  security: SecurityProps,
  request: Request,
  deps: RequestResetDeps
): Promise<AuthResult> {
  const { email } = params as { email?: string };

  if (!email) {
    throw new ValidationError('Email is required');
  }
  if (!isValidEmail(email)) {
    throw new ValidationError('Invalid email format', 'email');
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Look up user — return success either way (prevent enumeration)
  const user = await db
    .prepare('SELECT id, name FROM _auth_users WHERE email = ?')
    .bind(normalizedEmail)
    .first<{ id: string; name: string | null }>();

  if (!user) {
    // User doesn't exist — return success silently
    return {};
  }

  // Delete any existing password_reset tokens for this user
  await db
    .prepare(
      "DELETE FROM _auth_verification_tokens WHERE user_id = ? AND type = 'password_reset'"
    )
    .bind(user.id)
    .run();

  // Generate token
  const rawToken = generateSessionToken();
  const tokenHash = await hashSessionToken(rawToken);
  const timestamp = now();

  await db
    .prepare(
      `INSERT INTO _auth_verification_tokens (token, user_id, type, expires_at)
       VALUES (?, ?, 'password_reset', ?)`
    )
    .bind(tokenHash, user.id, expiresAt(TOKEN_EXPIRY_SECONDS))
    .run();

  // Build reset URL from the browser's Origin/Referer header (worker URL is internal)
  const origin =
    request.headers.get('Origin') ||
    (request.headers.get('Referer') ? new URL(request.headers.get('Referer')!).origin : null) ||
    new URL(request.url).origin;
  const resetUrl = `${origin}/reset-password?token=${rawToken}`;

  // Send email (best-effort — don't fail the request if email fails)
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
      subject: `Reset your password`,
      template: 'platform:password-reset',
      data: {
        appName: appName || env.APP_ALIAS || env.APP_ID,
        resetUrl,
        expiresIn: '1 hour',
        userName: user.name || normalizedEmail,
      },
    });
  } catch (err) {
    // Log but don't fail — user should not know if email failed
    console.error('[authRequestReset] Failed to send reset email:', err);
  }

  return {};
}
