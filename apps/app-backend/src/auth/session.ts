/**
 * Session validation for per-app auth (Mode B).
 * Called by the RPC router when X-Session-Token header is present.
 */

import type { UserContext } from '../rpc/types';
import { hashSessionToken, parseRoles } from './utils';

/**
 * Validate a raw session token against D1 and build a UserContext.
 * Returns null if the session is invalid or expired.
 */
export async function validateSession(
  rawToken: string,
  db: D1Database
): Promise<UserContext | null> {
  const tokenHash = await hashSessionToken(rawToken);

  const row = await db
    .prepare(
      `SELECT s.user_id, s.expires_at, u.email, u.name, u.roles
       FROM _auth_sessions s
       JOIN _auth_users u ON s.user_id = u.id
       WHERE s.id = ? AND s.expires_at > datetime('now')`
    )
    .bind(tokenHash)
    .first<{
      user_id: string;
      expires_at: string;
      email: string;
      name: string | null;
      roles: string;
    }>();

  if (!row) return null;

  return {
    id: row.user_id,
    email: row.email,
    name: row.name ?? undefined,
    roles: parseRoles(row.roles),
    isAuthenticated: true,
    authMethod: 'session',
  };
}

/**
 * Delete all expired sessions from _auth_sessions.
 * Returns the number of rows purged.
 */
export async function purgeExpiredSessions(db: D1Database): Promise<number> {
  const result = await db
    .prepare('DELETE FROM _auth_sessions WHERE expires_at < datetime(\'now\')')
    .run();
  return result.meta?.changes ?? 0;
}
