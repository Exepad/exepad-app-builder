/**
 * auth_verify_email — Consume an email-verification token and mark the
 * associated user as verified.
 *
 * Called by the runtime worker's GET /verify-email endpoint, which
 * resolves email verification links. Always returns 200 with
 * `{ success: true, data: { verified: boolean } }` even on failure — the
 * runtime redirect URL uses the boolean to pick the banner state.
 */

import type { SecurityProps } from '@exepad/types';
import type { AuthResult } from '../types';
import { consumeEmailVerificationToken } from '../verification';
import { ValidationError } from '../../utils/errors';

export async function authVerifyEmail(
  params: Record<string, unknown>,
  db: D1Database,
  _security: SecurityProps,
): Promise<AuthResult & { verified: boolean }> {
  const token = params.token as string | undefined;
  if (!token || typeof token !== 'string') {
    throw new ValidationError('Token is required', 'token');
  }
  const result = await consumeEmailVerificationToken(db, token);
  if (!result) {
    throw new ValidationError('Invalid or expired verification link', 'token');
  }
  return { verified: true };
}
