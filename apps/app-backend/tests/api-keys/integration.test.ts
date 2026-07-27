/**
 * Integration tests — API key auth through the RPC router.
 *
 * Tests the full flow: extractUserContext (API key detection) → routeRpcRequest
 * (scope enforcement) → CRUD/handler dispatch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractUserContext, routeRpcRequest } from '../../src/rpc/router';
import {
  generateApiKey,
  hashApiKey,
  buildApiKeyUserContext,
} from '../../src/auth/api-keys';
import { createMockD1 } from '../helpers/mock-d1';
import { createMockEnv, TEST_MODEL, createMockConfig } from '../helpers/mock-env';
import type { UserContext } from '../../src/rpc/types';
import type { InjectedProps } from '../../src/types/env';

// ── extractUserContext — Mode C (API key) ──────────────────────

describe('extractUserContext with API key', () => {
  it('detects Bearer exepad_sk_* and returns API key user context', async () => {
    const rawKey = generateApiKey();
    const keyHash = await hashApiKey(rawKey);

    const db = createMockD1({
      results: new Map([
        [
          '_auth_api_keys',
          [
            {
              id: 'key-1',
              user_id: 'user-123',
              scopes: '["*"]',
              expires_at: null,
              revoked_at: null,
              email: 'apiuser@example.com',
              name: 'API User',
              roles: '',
            },
          ],
        ],
      ]),
    });

    const request = new Request('https://example.com/rpc', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });

    const ctx = await extractUserContext(request, db);
    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.authMethod).toBe('api_key');
    expect(ctx.email).toBe('apiuser@example.com');
    expect(ctx.apiKeyScopes).toEqual(['*']);
    expect(ctx.apiKeyId).toBe('key-1');
  });

  it('falls through to unauthenticated for invalid API key', async () => {
    const db = createMockD1({ firstReturnsNull: true });

    const request = new Request('https://example.com/rpc', {
      headers: { Authorization: 'Bearer exepad_sk_0000000000000000000000000000000000000000000000000' },
    });

    const ctx = await extractUserContext(request, db);
    expect(ctx.isAuthenticated).toBe(false);
  });

  it('prefers session token over API key', async () => {
    // If both X-Session-Token and Authorization are present, session wins
    // (because Mode B is checked first in extractUserContext)
    const db = createMockD1({
      results: new Map([
        [
          // Session validation query hits _auth_sessions
          '_auth_sessions',
          [
            {
              user_id: 'session-user',
              email: 'session@example.com',
              name: 'Session User',
              roles: '',
              expires_at: new Date(Date.now() + 86400000).toISOString(),
            },
          ],
        ],
      ]),
    });

    const request = new Request('https://example.com/rpc', {
      headers: {
        'X-Session-Token': 'valid-session-token',
        Authorization: `Bearer ${generateApiKey()}`,
      },
    });

    const ctx = await extractUserContext(request, db);
    // Session should win — authMethod is 'session'
    expect(ctx.authMethod).toBe('session');
    expect(ctx.id).toBe('session-user');
  });

  it('does not detect non-exepad_sk_ bearer tokens as API keys', async () => {
    const db = createMockD1();

    const request = new Request('https://example.com/rpc', {
      headers: { Authorization: 'Bearer some-other-token' },
    });

    const ctx = await extractUserContext(request, db);
    // Should fall through to Mode A (platform headers) → unauthenticated
    expect(ctx.isAuthenticated).toBe(false);
    expect(ctx.authMethod).toBe('platform_header');
  });
});

// ── routeRpcRequest — CRUD scope enforcement ───────────────────

describe('routeRpcRequest with API key scope enforcement', () => {
  const config: InjectedProps = {
    models: [
      {
        ...TEST_MODEL,
        name: 'contacts',
        crudPolicy: {
          create: 'authenticated',
          read: 'authenticated',
          list: 'authenticated',
          update: 'authenticated',
          delete: 'authenticated',
        },
      },
    ],
    handlers: [
      {
        uuid: 'handler-1',
        name: 'getStats',
        code: 'return { count: 42 };',
        authLevel: 'authenticated',
      },
    ],
    security: {
      enableAuth: true,
    },
  };

  const makeApiKeyUser = (scopes: string[]): UserContext => ({
    id: 'user-123',
    email: 'test@example.com',
    roles: [],
    isAuthenticated: true,
    authMethod: 'api_key',
    apiKeyScopes: scopes,
    apiKeyId: 'key-1',
  });

  it('allows CRUD when scope matches', async () => {
    const user = makeApiKeyUser(['model:contacts:list']);
    const env = createMockEnv({
      configProps: config,
    });

    // sys_list should succeed with correct scope
    const result = await routeRpcRequest(
      { method: 'sys_list', model: 'contacts', params: {} },
      user,
      config,
      env,
      new Request('https://example.com'),
    );

    expect(result.success).toBe(true);
  });

  it('allows CRUD with wildcard scope', async () => {
    const user = makeApiKeyUser(['*']);
    const env = createMockEnv({
      configProps: config,
    });

    const result = await routeRpcRequest(
      { method: 'sys_list', model: 'contacts', params: {} },
      user,
      config,
      env,
      new Request('https://example.com'),
    );

    expect(result.success).toBe(true);
  });

  it('rejects CRUD when scope does not match', async () => {
    const user = makeApiKeyUser(['model:contacts:read']);
    const env = createMockEnv({
      configProps: config,
    });

    // sys_create requires model:contacts:create scope
    await expect(
      routeRpcRequest(
        { method: 'sys_create', model: 'contacts', params: { data: { name: 'Test' } } },
        user,
        config,
        env,
        new Request('https://example.com'),
      ),
    ).rejects.toThrow(/API key lacks scope/);
  });

  it('rejects CRUD on wrong model', async () => {
    // User has scope for orders, not contacts
    const user = makeApiKeyUser(['model:orders:list']);
    const env = createMockEnv({
      configProps: config,
    });

    await expect(
      routeRpcRequest(
        { method: 'sys_list', model: 'contacts', params: {} },
        user,
        config,
        env,
        new Request('https://example.com'),
      ),
    ).rejects.toThrow(/API key lacks scope/);
  });

  it('allows handler when scope matches', async () => {
    const user = makeApiKeyUser(['handler:getStats']);
    const env = createMockEnv({
      configProps: config,
    });

    // The handler executor will be called — may error since it's a mock env,
    // but the scope check should pass (no ForbiddenError)
    try {
      await routeRpcRequest(
        { method: 'getStats', params: {} },
        user,
        config,
        env,
        new Request('https://example.com'),
      );
    } catch (e: any) {
      // Should NOT be a scope error
      expect(e.message).not.toMatch(/API key lacks scope/);
    }
  });

  it('rejects handler when scope does not match', async () => {
    const user = makeApiKeyUser(['handler:otherHandler']);
    const env = createMockEnv({
      configProps: config,
    });

    await expect(
      routeRpcRequest(
        { method: 'getStats', params: {} },
        user,
        config,
        env,
        new Request('https://example.com'),
      ),
    ).rejects.toThrow(/API key lacks scope/);
  });

  it('rejects sys_aggregate when scope does not match', async () => {
    const user = makeApiKeyUser(['model:contacts:read']);
    const env = createMockEnv({
      configProps: config,
    });

    // sys_aggregate uses 'list' policy — key has 'read' but not 'list'
    await expect(
      routeRpcRequest(
        {
          method: 'sys_aggregate',
          model: 'contacts',
          params: { aggregations: [{ function: 'count', column: 'id', alias: 'total' }] },
        },
        user,
        config,
        env,
        new Request('https://example.com'),
      ),
    ).rejects.toThrow(/API key lacks scope/);
  });

  it('allows sys_aggregate with wildcard scope', async () => {
    const user = makeApiKeyUser(['*']);
    const env = createMockEnv({
      configProps: config,
    });

    const result = await routeRpcRequest(
      {
        method: 'sys_aggregate',
        model: 'contacts',
        params: { aggregations: [{ function: 'count', column: 'id', alias: 'total' }] },
      },
      user,
      config,
      env,
      new Request('https://example.com'),
    );

    expect(result.success).toBe(true);
  });

  it('non-API-key users bypass scope checks', async () => {
    const user: UserContext = {
      id: 'user-123',
      email: 'test@example.com',
      roles: [],
      isAuthenticated: true,
      authMethod: 'session',
      // No apiKeyScopes — should not trigger scope enforcement
    };
    const env = createMockEnv({
      configProps: config,
    });

    // Session-based users have no scope restrictions
    const result = await routeRpcRequest(
      { method: 'sys_list', model: 'contacts', params: {} },
      user,
      config,
      env,
      new Request('https://example.com'),
    );

    expect(result.success).toBe(true);
  });

  it('rejects sys_read when scope does not match', async () => {
    const user = makeApiKeyUser(['model:contacts:list']); // has list, not read
    const env = createMockEnv({
      configProps: config,
    });

    await expect(
      routeRpcRequest(
        { method: 'sys_read', model: 'contacts', params: { id: 1 } },
        user,
        config,
        env,
        new Request('https://example.com'),
      ),
    ).rejects.toThrow(/API key lacks scope/);
  });

  it('allows sys_read with matching scope', async () => {
    const user = makeApiKeyUser(['model:contacts:read']);
    const row = { id: 1, name: 'Alice', email: 'a@b.com', owner_id: 'user-123' };
    const db = createMockD1({ results: new Map([['SELECT', [row]]]) });
    const env = createMockEnv({
      DB: db,
      configProps: config,
    });

    const result = await routeRpcRequest(
      { method: 'sys_read', model: 'contacts', params: { id: 1 } },
      user,
      config,
      env,
      new Request('https://example.com'),
    );

    expect(result.success).toBe(true);
  });

  it('rejects sys_update when scope does not match', async () => {
    const user = makeApiKeyUser(['model:contacts:read']); // has read, not update
    const env = createMockEnv({
      configProps: config,
    });

    await expect(
      routeRpcRequest(
        { method: 'sys_update', model: 'contacts', params: { id: 1, data: { name: 'Bob' } } },
        user,
        config,
        env,
        new Request('https://example.com'),
      ),
    ).rejects.toThrow(/API key lacks scope/);
  });

  it('rejects sys_delete when scope does not match', async () => {
    const user = makeApiKeyUser(['model:contacts:read']); // has read, not delete
    const env = createMockEnv({
      configProps: config,
    });

    await expect(
      routeRpcRequest(
        { method: 'sys_delete', model: 'contacts', params: { id: 1 } },
        user,
        config,
        env,
        new Request('https://example.com'),
      ),
    ).rejects.toThrow(/API key lacks scope/);
  });

  it('rejects sys_upsert when scope does not match', async () => {
    // sys_upsert uses 'create' policy
    const user = makeApiKeyUser(['model:contacts:read']); // has read, not create
    const env = createMockEnv({
      configProps: config,
    });

    await expect(
      routeRpcRequest(
        { method: 'sys_upsert', model: 'contacts', params: { data: { name: 'Test' } } },
        user,
        config,
        env,
        new Request('https://example.com'),
      ),
    ).rejects.toThrow(/API key lacks scope/);
  });

  it('rejects sys_upsert with ONLY create scope (upsert can UPDATE existing rows)', async () => {
    // A create-only key must not be able to overwrite existing rows via
    // INSERT ... ON CONFLICT DO UPDATE — sys_upsert now also requires update.
    const user = makeApiKeyUser(['model:contacts:create']);
    const env = createMockEnv({
      configProps: config,
    });

    await expect(
      routeRpcRequest(
        { method: 'sys_upsert', model: 'contacts', params: { data: { name: 'Test', email: 'test@b.com' } } },
        user,
        config,
        env,
        new Request('https://example.com'),
      ),
    ).rejects.toThrow(/API key lacks scope: model:contacts:update/);
  });

  it('allows sys_upsert with BOTH create and update scopes', async () => {
    const user = makeApiKeyUser(['model:contacts:create', 'model:contacts:update']);
    const row = { id: 1, name: 'Test', email: 'test@b.com', owner_id: 'user-123' };
    const db = createMockD1({ results: new Map([['INSERT', [row]]]) });
    const env = createMockEnv({
      DB: db,
      configProps: config,
    });

    const result = await routeRpcRequest(
      { method: 'sys_upsert', model: 'contacts', params: { data: { name: 'Test', email: 'test@b.com' } } },
      user,
      config,
      env,
      new Request('https://example.com'),
    );

    expect(result.success).toBe(true);
  });

  it('allows sys_upsert with wildcard scope', async () => {
    const user = makeApiKeyUser(['*']);
    const row = { id: 1, name: 'Test', email: 'test@b.com', owner_id: 'user-123' };
    const db = createMockD1({ results: new Map([['INSERT', [row]]]) });
    const env = createMockEnv({
      DB: db,
      configProps: config,
    });

    const result = await routeRpcRequest(
      { method: 'sys_upsert', model: 'contacts', params: { data: { name: 'Test', email: 'test@b.com' } } },
      user,
      config,
      env,
      new Request('https://example.com'),
    );

    expect(result.success).toBe(true);
  });
});

// ── routeRpcRequest — API key management RPCs ──────────────────

describe('routeRpcRequest — auth_*_api_key methods', () => {
  const config: InjectedProps = {
    models: [],
    handlers: [],
    security: { enableAuth: true },
  };

  it('routes auth_create_api_key', async () => {
    const user: UserContext = {
      id: 'user-123',
      email: 'test@example.com',
      roles: [],
      isAuthenticated: true,
      authMethod: 'session',
    };
    const env = createMockEnv({
      configProps: config,
    });

    const result = await routeRpcRequest(
      {
        method: 'auth_create_api_key',
        params: { name: 'Test Key', scopes: ['*'] },
      },
      user,
      config,
      env,
      new Request('https://example.com'),
    );

    expect(result.success).toBe(true);
    expect((result.data as any).rawKey).toMatch(/^exepad_sk_/);
    expect((result.data as any).key.name).toBe('Test Key');
  });

  it('routes auth_list_api_keys', async () => {
    const user: UserContext = {
      id: 'user-123',
      email: 'test@example.com',
      roles: [],
      isAuthenticated: true,
      authMethod: 'session',
    };
    const env = createMockEnv({
      configProps: config,
    });

    const result = await routeRpcRequest(
      { method: 'auth_list_api_keys', params: {} },
      user,
      config,
      env,
      new Request('https://example.com'),
    );

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('returns error for unauthenticated API key management', async () => {
    const user: UserContext = {
      id: '',
      email: '',
      roles: [],
      isAuthenticated: false,
      authMethod: 'platform_header',
    };
    const env = createMockEnv({
      configProps: config,
    });

    const result = await routeRpcRequest(
      {
        method: 'auth_create_api_key',
        params: { name: 'Test', scopes: ['*'] },
      },
      user,
      config,
      env,
      new Request('https://example.com'),
    );

    // Auth errors are returned as { success: false, error: ... } per router convention
    expect(result.success).toBe(false);
    expect((result as any).error.code).toBe('UNAUTHORIZED');
  });

  it('returns error when security is not enabled', async () => {
    const noSecurityConfig: InjectedProps = {
      models: [],
      handlers: [],
      // No security config
    };
    const user: UserContext = {
      id: 'user-123',
      email: 'test@example.com',
      roles: [],
      isAuthenticated: true,
      authMethod: 'session',
    };
    const env = createMockEnv({
      configProps: noSecurityConfig,
    });

    // Without security enabled, auth_* methods should not match
    await expect(
      routeRpcRequest(
        {
          method: 'auth_create_api_key',
          params: { name: 'Test', scopes: ['*'] },
        },
        user,
        noSecurityConfig,
        env,
        new Request('https://example.com'),
      ),
    ).rejects.toThrow(/not found/i);
  });
});
