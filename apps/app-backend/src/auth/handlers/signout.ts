/**
 * auth_signout — Invalidate session and clear cookie
 */

import type { AuthResult } from '../types';
import { hashSessionToken } from '../utils';

export async function authSignout(
  _params: Record<string, unknown>,
  db: D1Database,
  _security: unknown,
  request: Request
): Promise<AuthResult> {
  const rawToken = request.headers.get('X-Session-Token');
  if (!rawToken) {
    // No session to invalidate — already signed out
    return { _clearSession: true };
  }

  const tokenHash = await hashSessionToken(rawToken);
  await db.prepare('DELETE FROM _auth_sessions WHERE id = ?').bind(tokenHash).run();

  return { _clearSession: true };
}
