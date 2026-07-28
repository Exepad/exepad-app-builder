/**
 * auth_request_verification — Resend the email-verification link for a
 * user who signed up but hasn't verified yet.
 *
 * Mirrors authRequestReset — always returns success to prevent user
 * enumeration. Issues a new token (invalidating any prior one) and
 * sends a fresh verification email.
 */

import type { SecurityProps } from '@exepad/types';
import type { AuthResult } from '../types';
import type { Env } from '../../types/env';
import { isValidEmail } from '../utils';
import { issueEmailVerificationToken } from '../verification';
import { ValidationError } from '../../utils/errors';
import { createEmailService, buildPlatformFetcher, type EmailServiceProps } from '../../services/email';

interface RequestVerificationDeps {
  env: Env;
  appName?: string;
  emailConfig?: EmailServiceProps;
}

export async function authRequestVerification(
  params: Record<string, unknown>,
  db: D1Database,
  _security: SecurityProps,
  request: Request,
  deps: RequestVerificationDeps,
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
    .prepare('SELECT id, email_verified FROM _auth_users WHERE email = ?')
    .bind(normalizedEmail)
    .first<{ id: string; email_verified: number }>();

  if (!user) {
    return {};
  }
  // Already verified — nothing to do, but still return success to hide state.
  if (user.email_verified === 1) {
    return {};
  }

  const rawToken = await issueEmailVerificationToken(db, user.id);

  const origin =
    request.headers.get('Origin') ||
    (request.headers.get('Referer') ? new URL(request.headers.get('Referer')!).origin : null) ||
    new URL(request.url).origin;
  const verifyUrl = `${origin}/verify-email?token=${rawToken}`;

  // Best-effort send — swallow failures so the response shape is stable
  // and we don't leak whether the address is registered.
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
    console.error('[authRequestVerification] Failed to send verification email:', err);
  }

  return {};
}
