/**
 * Auth Routing Tests
 *
 * Covers: auth_* method dispatch in RPC router, extractUserContext Mode B,
 * security gating, unknown auth methods.
 */

import { describe, it, expect } from 'vitest';
import { routeRpcRequest, extractUserContext, checkAuth } from '../src/rpc/router';
import { MethodNotAllowedError, UnauthorizedError } from '../src/utils/errors';
import { createMockD1 } from './helpers/mock-d1';
import {
  TEST_SECURITY,
  TEST_ANON_USER,
  TEST_SESSION_USER,
  createAuthMockConfig,
  createTestSessionRow,
} from './helpers/mock-auth';

function makeEnv(db: ReturnType<typeof createMockD1>, security?: object) {
  const parsedConfig = createAuthMockConfig(security as any);
  return {
    env: {
      DB: db,
      APP_ID: 'test-app',
      APP_ALIAS: 'test',
    },
    parsedConfig,
  };
}

describe('auth_* method routing', () => {
  it('routes auth_signup and returns success', async () => {
    const db = createMockD1({ firstReturnsNull: true }); // no existing user
    const { env, parsedConfig } = makeEnv(db, TEST_SECURITY);
    const rpcRequest = { method: 'auth_signup', params: { email: 'new@test.com', password: 'password123' } };
    const request = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const result = await routeRpcRequest(rpcRequest, TEST_ANON_USER, parsedConfig, env as any, request);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('routes auth_signin and returns success', async () => {
    // Need a user with a password hash in the mock
    const { hashPassword } = await import('../src/auth/utils');
    const hash = await hashPassword('password123');
    const db = createMockD1({
      results: new Map([
        ['SELECT', [{ id: 'u1', email: 'user@test.com', password_hash: hash, name: 'U', avatar_url: null, roles: 'user', email_verified: 0 }]],
      ]),
    });
    const { env, parsedConfig } = makeEnv(db, TEST_SECURITY);
    const rpcRequest = { method: 'auth_signin', params: { email: 'user@test.com', password: 'password123' } };
    const request = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const result = await routeRpcRequest(rpcRequest, TEST_ANON_USER, parsedConfig, env as any, request);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('routes auth_signout', async () => {
    const db = createMockD1();
    const { env, parsedConfig } = makeEnv(db, TEST_SECURITY);
    const rpcRequest = { method: 'auth_signout', params: {} };
    const request = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': 'some-token',
      },
    });

    const result = await routeRpcRequest(rpcRequest, TEST_ANON_USER, parsedConfig, env as any, request);
    expect(result.success).toBe(true);
  });

  it('routes auth_me', async () => {
    const row = { id: 'u1', email: 'user@test.com', name: 'U', avatar_url: null, roles: 'user', email_verified: 0 };
    const db = createMockD1({
      results: new Map([['SELECT', [row]]]),
    });
    const { env, parsedConfig } = makeEnv(db, TEST_SECURITY);
    const rpcRequest = { method: 'auth_me', params: {} };
    const user = {
      id: 'u1',
      email: 'user@test.com',
      roles: ['user'],
      isAuthenticated: true,
      authMethod: 'session' as const,
    };
    const request = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const result = await routeRpcRequest(rpcRequest, user, parsedConfig, env as any, request);
    expect(result.success).toBe(true);
  });

  it('returns structured error for unknown auth_ method (not HTTP error)', async () => {
    const db = createMockD1();
    const { env, parsedConfig } = makeEnv(db, TEST_SECURITY);
    const rpcRequest = { method: 'auth_foo', params: {} };
    const request = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    // Auth errors are caught and returned as { success: false } so the
    // browser console stays clean for end users (no 4xx HTTP errors).
    const result = await routeRpcRequest(rpcRequest, TEST_ANON_USER, parsedConfig, env as any, request);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('throws MethodNotAllowedError when config.security is not set', async () => {
    const db = createMockD1();
    // No security in config
    const config = createAuthMockConfig(undefined as any);
    delete config.security;
    const env = { DB: db, APP_ID: 'test', APP_ALIAS: 'test' };
    const rpcRequest = { method: 'auth_signup', params: { email: 'a@b.com', password: 'pass1234' } };
    const request = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(
      routeRpcRequest(rpcRequest, TEST_ANON_USER, config, env as any, request)
    ).rejects.toThrow(MethodNotAllowedError);
  });
});

// ── extractUserContext Mode B ─────────────────────────────────────

describe('extractUserContext — Mode B session', () => {
  it('falls back to unauthenticated when no token and no headers', async () => {
    const db = createMockD1();
    const request = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const ctx = await extractUserContext(request, db);
    expect(ctx.isAuthenticated).toBe(false);
  });

  it('extracts UserContext from X-Session-Token when valid session exists', async () => {
    const sessionRow = createTestSessionRow();
    const db = createMockD1({
      results: new Map([['_auth_sessions', [sessionRow]]]),
    });
    const request = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': 'valid-raw-token',
      },
    });

    const ctx = await extractUserContext(request, db);
    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.authMethod).toBe('session');
    expect(ctx.id).toBe(sessionRow.user_id);
  });

  it('falls back to Mode A headers when session token is invalid', async () => {
    const db = createMockD1({ firstReturnsNull: true }); // session not found
    const request = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': 'invalid-token',
        'X-User-Id': 'platform-user-1',
        'X-User-Email': 'platform@test.com',
      },
    });

    const ctx = await extractUserContext(request, db);
    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.authMethod).toBe('platform_header');
    expect(ctx.id).toBe('platform-user-1');
  });

  it('Mode B takes priority over Mode A when both present and valid', async () => {
    const sessionRow = createTestSessionRow({ user_id: 'session-user-1' });
    const db = createMockD1({
      results: new Map([['_auth_sessions', [sessionRow]]]),
    });
    const request = new Request('http://localhost/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': 'valid-token',
        'X-User-Id': 'platform-user-1', // This should be ignored
      },
    });

    const ctx = await extractUserContext(request, db);
    expect(ctx.id).toBe('session-user-1');
    expect(ctx.authMethod).toBe('session');
  });
});

// ── H8 guard: write operations require auth even with public policy ──

describe('checkAuth — H8 write guard', () => {
  it('blocks unauthenticated create even with public policy', () => {
    expect(() => checkAuth('public', TEST_ANON_USER, 'create')).toThrow(UnauthorizedError);
  });

  it('blocks unauthenticated update even with public policy', () => {
    expect(() => checkAuth('public', TEST_ANON_USER, 'update')).toThrow(UnauthorizedError);
  });

  it('blocks unauthenticated delete even with public policy', () => {
    expect(() => checkAuth('public', TEST_ANON_USER, 'delete')).toThrow(UnauthorizedError);
  });

  it('allows authenticated user to create with public policy', () => {
    expect(() => checkAuth('public', TEST_SESSION_USER, 'create')).not.toThrow();
  });

  it('allows public read for unauthenticated user', () => {
    expect(() => checkAuth('public', TEST_ANON_USER, 'read')).not.toThrow();
  });

  it('allows public list for unauthenticated user', () => {
    expect(() => checkAuth('public', TEST_ANON_USER, 'list')).not.toThrow();
  });
});
