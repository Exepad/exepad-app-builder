/**
 * auth_reset_password — Set a new password using a reset token
 *
 * Validates the token, updates the password, and revokes all sessions.
 */

import type { SecurityProps } from '@exepad/types';
import type { AuthResult } from '../types';
import {
  hashPassword,
  hashSessionToken,
  validatePassword,
  now,
} from '../utils';
import { ValidationError, UnauthorizedError } from '../../utils/errors';

export async function authResetPassword(
  params: Record<string, unknown>,
  db: D1Database,
  security: SecurityProps
): Promise<AuthResult> {
  const { token, password, confirmPassword } = params as {
    token?: string;
    password?: string;
    confirmPassword?: string;
  };

  // Validate inputs
  if (!token) {
    throw new ValidationError('Reset token is required');
  }
  if (!password) {
    throw new ValidationError('Password is required');
  }
  if (password !== confirmPassword) {
    throw new ValidationError('Passwords do not match', 'confirmPassword');
  }

  const passwordError = validatePassword(password, security.passwordPolicy);
  if (passwordError) {
    throw new ValidationError(passwordError, 'password');
  }

  // Hash token and look up
  const tokenHash = await hashSessionToken(token);
  const tokenRow = await db
    .prepare(
      `SELECT user_id, expires_at FROM _auth_verification_tokens
       WHERE token = ? AND type = 'password_reset'`
    )
    .bind(tokenHash)
    .first<{ user_id: string; expires_at: string }>();

  if (!tokenRow) {
    throw new UnauthorizedError('invalid_token');
  }

  // Check expiry
  if (new Date(tokenRow.expires_at) < new Date()) {
    // Clean up expired token
    await db
      .prepare('DELETE FROM _auth_verification_tokens WHERE token = ?')
      .bind(tokenHash)
      .run();
    throw new UnauthorizedError('expired_token');
  }

  const userId = tokenRow.user_id;
  const timestamp = now();
  const passwordHash = await hashPassword(password);

  // Update password, delete token, and revoke all sessions in a batch
  await db.batch([
    db
      .prepare(
        'UPDATE _auth_users SET password_hash = ?, updated_at = ? WHERE id = ?'
      )
      .bind(passwordHash, timestamp, userId),
    db
      .prepare('DELETE FROM _auth_verification_tokens WHERE token = ?')
      .bind(tokenHash),
    db
      .prepare(
        "DELETE FROM _auth_verification_tokens WHERE user_id = ? AND type = 'password_reset'"
      )
      .bind(userId),
    db
      .prepare('DELETE FROM _auth_sessions WHERE user_id = ?')
      .bind(userId),
  ]);

  return {};
}
