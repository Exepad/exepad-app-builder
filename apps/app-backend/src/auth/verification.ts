/**
 * Email verification token issuance and consumption.
 *
 * Reuses the `_auth_verification_tokens` table (`type='email_verify'` rows).
 * Tokens are generated opaque strings, hashed before storage so the DB
 * row can't be replayed if the DB is exfiltrated.
 */

import { generateSessionToken, hashSessionToken, expiresAt, now } from './utils';

const EMAIL_VERIFY_TTL_SECONDS = 60 * 60 * 24; // 24 hours

export async function issueEmailVerificationToken(
  db: D1Database,
  userId: string,
): Promise<string> {
  const raw = generateSessionToken();
  const hash = await hashSessionToken(raw);
  await db.batch([
    // Invalidate prior outstanding tokens for this user so the old email
    // link stops working as soon as a new one is issued.
    db
      .prepare(
        `DELETE FROM _auth_verification_tokens WHERE user_id = ? AND type = 'email_verify'`,
      )
      .bind(userId),
    db
      .prepare(
        `INSERT INTO _auth_verification_tokens (token, user_id, type, expires_at)
         VALUES (?, ?, 'email_verify', ?)`,
      )
      .bind(hash, userId, expiresAt(EMAIL_VERIFY_TTL_SECONDS)),
  ]);
  return raw;
}

export async function consumeEmailVerificationToken(
  db: D1Database,
  rawToken: string,
): Promise<{ userId: string } | null> {
  const hash = await hashSessionToken(rawToken);
  const row = await db
    .prepare(
      `SELECT user_id, expires_at FROM _auth_verification_tokens
       WHERE token = ? AND type = 'email_verify'`,
    )
    .bind(hash)
    .first<{ user_id: string; expires_at: string }>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db
      .prepare(`DELETE FROM _auth_verification_tokens WHERE token = ?`)
      .bind(hash)
      .run();
    return null;
  }
  await db.batch([
    db
      .prepare(`UPDATE _auth_users SET email_verified = 1, updated_at = ? WHERE id = ?`)
      .bind(now(), row.user_id),
    db.prepare(`DELETE FROM _auth_verification_tokens WHERE token = ?`).bind(hash),
  ]);
  return { userId: row.user_id };
}
