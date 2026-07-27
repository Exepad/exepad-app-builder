/**
 * auth_me — Get current user profile from session
 *
 * Returns null (not 401) when unauthenticated — standard session-check
 * endpoint that the frontend polls on mount to determine auth state.
 */

import type { UserContext } from '../../rpc/types';
import type { AuthResult } from '../types';
import { parseRoles } from '../utils';

export async function authMe(
  _params: Record<string, unknown>,
  db: D1Database,
  _security: unknown,
  _request: Request,
  user: UserContext
): Promise<AuthResult | null> {
  if (!user.isAuthenticated) {
    return null;
  }

  // Mode A (platform header) users don't exist in _auth_users — return
  // the header-derived info directly. This makes dev examples with security
  // config work without requiring manual signup.
  if (user.authMethod === 'platform_header') {
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.id,
        avatar_url: null,
        roles: user.roles.length ? user.roles : ['user'],
        email_verified: true,
      },
    };
  }

  const row = await db
    .prepare(
      'SELECT id, email, name, avatar_url, roles, email_verified FROM _auth_users WHERE id = ?'
    )
    .bind(user.id)
    .first<{
      id: string;
      email: string;
      name: string | null;
      avatar_url: string | null;
      roles: string;
      email_verified: number;
    }>();

  if (!row) {
    // Session valid but user deleted — clear stale session
    return { _clearSession: true };
  }

  return {
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      avatar_url: row.avatar_url,
      roles: parseRoles(row.roles),
      email_verified: row.email_verified === 1,
    },
  };
}
