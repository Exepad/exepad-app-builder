/**
 * Shared auth test utilities
 */

import type { SecurityProps } from '@exepad/types';
import type { InjectedProps, ModelProps, HandlerProps } from '../../src/types/env';
import type { UserContext } from '../../src/rpc/types';
import { createMockD1 } from './mock-d1';
import { createMockEnv } from './mock-env';
import { hashPassword } from '../../src/auth/utils';

/** Standard SecurityProps for auth tests */
export const TEST_SECURITY: SecurityProps = {
  authProviders: [{ provider: 'email' }],
  allowSignup: true,
  sessionDuration: 604800,
};

/** SecurityProps with strict password policy */
export const TEST_SECURITY_STRICT: SecurityProps = {
  ...TEST_SECURITY,
  passwordPolicy: {
    minLength: 10,
    requireUppercase: true,
    requireNumber: true,
  },
};

/** SecurityProps with signup disabled */
export const TEST_SECURITY_NO_SIGNUP: SecurityProps = {
  ...TEST_SECURITY,
  allowSignup: false,
};

/** Authenticated user context (Mode B — session) */
export const TEST_SESSION_USER: UserContext = {
  id: 'user-session-1',
  email: 'session@example.com',
  name: 'Session User',
  roles: ['user'],
  isAuthenticated: true,
  authMethod: 'session',
};

/** Unauthenticated user context */
export const TEST_ANON_USER: UserContext = {
  id: '',
  email: '',
  roles: [],
  isAuthenticated: false,
  authMethod: 'platform_header',
};

/** Standard test user row as returned from _auth_users table */
export function createTestUserRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'user-session-1',
    email: 'test@example.com',
    password_hash: null as string | null,
    name: 'Test User',
    avatar_url: null,
    roles: 'user',
    email_verified: 0,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Standard test session row as returned from _auth_sessions JOIN _auth_users */
export function createTestSessionRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    user_id: 'user-session-1',
    expires_at: new Date(Date.now() + 86400000).toISOString(), // 24h from now
    email: 'test@example.com',
    name: 'Test User',
    roles: 'user',
    ...overrides,
  };
}

/** Pre-hash a password for use in mock D1 results */
export async function hashTestPassword(password: string): Promise<string> {
  return hashPassword(password);
}

/** Create an auth-enabled mock `InjectedProps` for seeding the mock R2 bucket. */
export function createAuthMockConfig(
  security: SecurityProps = TEST_SECURITY,
  models: ModelProps[] = [],
  handlers: HandlerProps[] = []
): InjectedProps {
  return { models, handlers, security };
}

/** Create a mock env with auth-enabled config */
export function createAuthMockEnv(
  security: SecurityProps = TEST_SECURITY,
  dbOpts?: Parameters<typeof createMockD1>[0]
) {
  const db = createMockD1(dbOpts);
  return {
    env: {
      ...createMockEnv({
        DB: db,
        configProps: createAuthMockConfig(security),
      }),
      DB: db,
    },
    db,
  };
}

/** Create a request with X-Session-Token header */
export function createSessionTokenRequest(
  method: string,
  params: Record<string, unknown> = {},
  token: string = 'mock-raw-token'
): Request {
  return new Request('http://localhost/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Token': token,
    },
    body: JSON.stringify({ method, params }),
  });
}
