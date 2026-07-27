/**
 * Auth-specific types for per-app authentication (Mode B)
 */

import type { SecurityProps } from '@exepad/types';
import type { UserContext } from '../rpc/types';

/** Parameters for auth_signup */
export interface SignupParams {
  email: string;
  password: string;
  name?: string;
}

/** Parameters for auth_signin */
export interface SigninParams {
  email: string;
  password: string;
}

/** User data returned to the client (no sensitive fields) */
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  roles: string[];
  email_verified: boolean;
}

/**
 * Auth handler result with optional session token signal.
 * _sessionToken and _clearSession are stripped by the worker entry point
 * and converted into Set-Cookie headers.
 */
export interface AuthResult {
  user?: AuthUser;
  _sessionToken?: string;
  _clearSession?: boolean;
  /**
   * True when signup succeeded but the user must verify their email
   * before they can sign in. No session is issued in this case — the
   * client should render a "Check your email" state.
   */
  verification_required?: boolean;
}

/** Auth handler function signature */
export type AuthHandler = (
  params: Record<string, unknown>,
  db: D1Database,
  security: SecurityProps,
  request: Request,
  user?: UserContext
) => Promise<AuthResult>;
