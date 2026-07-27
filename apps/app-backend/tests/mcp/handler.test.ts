/**
 * Tests for MCP method handler — routes JSON-RPC methods to tool layer.
 */

import { describe, it, expect } from 'vitest';
import { handleMcpMethod } from '../../src/mcp/handler';
import { TEST_MODEL, TEST_USER, TEST_ANON, createMockEnv } from '../helpers/mock-env';
import { createMockD1 } from '../helpers/mock-d1';
import type { McpContext, JsonRpcRequest } from '../../src/mcp/types';
import type { InjectedProps, HandlerProps } from '@exepad/types';
import type { UserContext } from '../../src/rpc/types';

const authUser: UserContext = {
  ...TEST_USER,
  authMethod: 'api_key',
  apiKeyScopes: ['*'],
  apiKeyId: 'key-1',
};

const anonUser: UserContext = {
  ...TEST_ANON,
  authMethod: 'platform_header',
};

function makeCtx(overrides?: Partial<McpContext>): McpContext {
  const config: InjectedProps = {
    models: [TEST_MODEL],
    handlers: [],
    mcp: { enabled: true },
  };
  const env = createMockEnv({ DB: createMockD1() });
  return {
    appId: 'test-app',
    appAlias: 'test',
    config,
    user: authUser,
    env,
    ...overrides,
  };
}

function makeRequest(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: '2.0', method, params, id: 1 };
}

describe('handleMcpMethod', () => {
  describe('initialize', () => {
    it('returns protocol version, server info, and capabilities', async () => {
      const ctx = makeCtx();
      const { result } = await handleMcpMethod(makeRequest('initialize'), ctx);
      const r = result as Record<string, unknown>;
      expect(r.protocolVersion).toBe('2024-11-05');
      expect(r.serverInfo).toEqual({
        name: 'test (Exepad)',
        version: '1.0.0',
      });
      expect(r.capabilities).toEqual({
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
      });
    });

    it('includes app alias in server name', async () => {
      const ctx = makeCtx({ appAlias: 'my-crm-app' });
      const { result } = await handleMcpMethod(makeRequest('initialize'), ctx);
      const r = result as Record<string, unknown>;
      expect((r.serverInfo as Record<string, unknown>).name).toBe('my-crm-app (Exepad)');
    });
  });

  describe('notifications/initialized', () => {
    it('returns empty result', async () => {
      const ctx = makeCtx();
      const { result } = await handleMcpMethod(makeRequest('notifications/initialized'), ctx);
      expect(result).toEqual({});
    });
  });

  describe('tools/list', () => {
    it('returns MCP-formatted tools from discovery', async () => {
      const ctx = makeCtx();
      const { result } = await handleMcpMethod(makeRequest('tools/list'), ctx);
      const r = result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
      expect(r.tools.length).toBeGreaterThan(0);
      // Each tool should have name, description, inputSchema
      for (const tool of r.tools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema).toBeDefined();
      }
    });

    it('uses tool.id as MCP tool name', async () => {
      const ctx = makeCtx();
      const { result } = await handleMcpMethod(makeRequest('tools/list'), ctx);
      const r = result as { tools: Array<{ name: string }> };
      const toolNames = r.tools.map((t) => t.name);
      expect(toolNames).toContain('contacts__create');
      expect(toolNames).toContain('contacts__list');
      expect(toolNames).toContain('contacts__read');
      expect(toolNames).toContain('contacts__update');
      expect(toolNames).toContain('contacts__delete');
    });

    it('returns empty tools for empty config', async () => {
      const ctx = makeCtx({ config: { models: [], handlers: [], mcp: { enabled: true } } });
      const { result } = await handleMcpMethod(makeRequest('tools/list'), ctx);
      const r = result as { tools: unknown[] };
      expect(r.tools).toEqual([]);
    });

    it('includes handler tools', async () => {
      const handler: HandlerProps = {
        uuid: 'h1',
        name: 'getStats',
        authLevel: 'public',
        inputs: [],
        outputs: [{ name: 'count', type: 'number' }],
        method: 'getStats',
      };
      const ctx = makeCtx({
        config: { models: [], handlers: [handler], mcp: { enabled: true } },
      });
      const { result } = await handleMcpMethod(makeRequest('tools/list'), ctx);
      const r = result as { tools: Array<{ name: string }> };
      expect(r.tools.some((t) => t.name === 'handler__getStats')).toBe(true);
    });

    it('excludes tools with authLevel none', async () => {
      const config: InjectedProps = {
        models: [{
          ...TEST_MODEL,
          crudPolicy: {
            create: 'none',
            read: 'none',
            list: 'none',
            update: 'none',
            delete: 'none',
          },
        }],
        mcp: { enabled: true },
      };
      const ctx = makeCtx({ config });
      const { result } = await handleMcpMethod(makeRequest('tools/list'), ctx);
      const r = result as { tools: unknown[] };
      expect(r.tools).toEqual([]);
    });
  });

  describe('tools/call', () => {
    it('routes to executeTool and returns text content on success', async () => {
      const row = { id: 1, name: 'Alice', email: 'a@b.com', owner_id: 'user-123' };
      const db = createMockD1({ results: new Map([['SELECT', [row]]]) });
      const env = createMockEnv({ DB: db });
      const ctx = makeCtx({ env });

      const { result } = await handleMcpMethod(
        makeRequest('tools/call', { name: 'contacts__list', arguments: {} }),
        ctx,
      );

      const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
      expect(r.content).toHaveLength(1);
      expect(r.content[0].type).toBe('text');
      expect(r.isError).toBeUndefined();
    });

    it('returns isError: true on tool failure', async () => {
      const ctx = makeCtx();
      const { result } = await handleMcpMethod(
        makeRequest('tools/call', { name: 'nonexistent__tool', arguments: {} }),
        ctx,
      );

      const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain('Error');
    });

    it('returns INVALID_PARAMS when name is missing', async () => {
      const ctx = makeCtx();
      const { error } = await handleMcpMethod(
        makeRequest('tools/call', { arguments: {} }),
        ctx,
      );

      expect(error).toBeDefined();
      expect(error!.code).toBe(-32602);
      expect(error!.message).toContain('name');
    });

    it('returns INVALID_PARAMS when name is not a string', async () => {
      const ctx = makeCtx();
      const { error } = await handleMcpMethod(
        makeRequest('tools/call', { name: 123, arguments: {} }),
        ctx,
      );

      expect(error).toBeDefined();
      expect(error!.code).toBe(-32602);
    });

    it('defaults arguments to empty object when not provided', async () => {
      const ctx = makeCtx();
      // contacts__list with no arguments should still work
      const { result } = await handleMcpMethod(
        makeRequest('tools/call', { name: 'contacts__list' }),
        ctx,
      );

      const r = result as { content: Array<{ type: string }>; isError?: boolean };
      expect(r.content).toHaveLength(1);
      expect(r.content[0].type).toBe('text');
    });

    it('enforces auth for authenticated tools with anon user', async () => {
      const ctx = makeCtx({ user: { ...anonUser, authMethod: 'api_key' as const, apiKeyScopes: ['*'], apiKeyId: 'k' } });
      // contacts__create requires authentication
      const { result } = await handleMcpMethod(
        makeRequest('tools/call', { name: 'contacts__create', arguments: { name: 'X', email: 'x@y.com' } }),
        ctx,
      );

      const r = result as { isError?: boolean; content: Array<{ text: string }> };
      expect(r.isError).toBe(true);
    });

    it('rejects CRUD tool when API key lacks scope', async () => {
      const scopedUser: UserContext = {
        ...TEST_USER,
        authMethod: 'api_key',
        apiKeyScopes: ['model:contacts:read'],
        apiKeyId: 'key-scoped',
      };
      const db = createMockD1();
      const env = createMockEnv({ DB: db });
      const ctx = makeCtx({ user: scopedUser, env });

      // Try to create — key only has read scope
      const { result } = await handleMcpMethod(
        makeRequest('tools/call', { name: 'contacts__create', arguments: { name: 'X', email: 'x@y.com' } }),
        ctx,
      );

      const r = result as { isError?: boolean; content: Array<{ text: string }> };
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain('scope');
    });

    it('allows CRUD tool when API key has matching scope', async () => {
      const scopedUser: UserContext = {
        ...TEST_USER,
        authMethod: 'api_key',
        apiKeyScopes: ['model:contacts:list'],
        apiKeyId: 'key-scoped',
      };
      const row = { id: 1, name: 'Alice', email: 'a@b.com', owner_id: 'user-123' };
      const db = createMockD1({ results: new Map([['SELECT', [row]]]) });
      const env = createMockEnv({ DB: db });
      const ctx = makeCtx({ user: scopedUser, env });

      const { result } = await handleMcpMethod(
        makeRequest('tools/call', { name: 'contacts__list', arguments: {} }),
        ctx,
      );

      const r = result as { isError?: boolean; content: Array<{ type: string }> };
      expect(r.isError).toBeUndefined();
      expect(r.content[0].type).toBe('text');
    });

    it('allows CRUD tool when API key has wildcard scope', async () => {
      const scopedUser: UserContext = {
        ...TEST_USER,
        authMethod: 'api_key',
        apiKeyScopes: ['*'],
        apiKeyId: 'key-wildcard',
      };
      const db = createMockD1();
      const env = createMockEnv({ DB: db });
      const ctx = makeCtx({ user: scopedUser, env });

      const { result } = await handleMcpMethod(
        makeRequest('tools/call', { name: 'contacts__list', arguments: {} }),
        ctx,
      );

      const r = result as { isError?: boolean; content: Array<{ type: string }> };
      expect(r.isError).toBeUndefined();
    });

    it('rejects handler tool when API key lacks handler scope', async () => {
      const handler: HandlerProps = {
        uuid: 'h1',
        name: 'getStats',
        authLevel: 'public',
        inputs: [],
        outputs: [{ name: 'count', type: 'number' }],
        method: 'getStats',
      };
      const scopedUser: UserContext = {
        ...TEST_USER,
        authMethod: 'api_key',
        apiKeyScopes: ['model:contacts:read'],  // No handler scope
        apiKeyId: 'key-no-handler',
      };
      const env = createMockEnv({ DB: createMockD1() });
      const ctx = makeCtx({
        user: scopedUser,
        env,
        config: { models: [], handlers: [handler], mcp: { enabled: true } },
      });

      const { result } = await handleMcpMethod(
        makeRequest('tools/call', { name: 'handler__getStats', arguments: {} }),
        ctx,
      );

      const r = result as { isError?: boolean; content: Array<{ text: string }> };
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain('scope');
    });
  });

  describe('resources/list', () => {
    it('returns empty resources list', async () => {
      const ctx = makeCtx();
      const { result } = await handleMcpMethod(makeRequest('resources/list'), ctx);
      expect(result).toEqual({ resources: [] });
    });
  });

  describe('ping', () => {
    it('returns empty result', async () => {
      const ctx = makeCtx();
      const { result } = await handleMcpMethod(makeRequest('ping'), ctx);
      expect(result).toEqual({});
    });
  });

  describe('unknown method', () => {
    it('returns METHOD_NOT_FOUND error', async () => {
      const ctx = makeCtx();
      const { error } = await handleMcpMethod(makeRequest('unknown/method'), ctx);
      expect(error).toBeDefined();
      expect(error!.code).toBe(-32601);
      expect(error!.message).toContain('unknown/method');
    });
  });
});
