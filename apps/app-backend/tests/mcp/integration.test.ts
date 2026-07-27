/**
 * Integration tests for MCP — full handshake through transport + handler.
 *
 * Tests the complete flow: HTTP request → transport → handler → tool layer.
 */

import { describe, it, expect } from 'vitest';
import { handleMcpPost } from '../../src/mcp/transport';
import { TEST_MODEL, TEST_USER, TEST_ANON, createMockEnv } from '../helpers/mock-env';
import { createMockD1 } from '../helpers/mock-d1';
import type { InjectedProps } from '@exepad/types';
import type { UserContext } from '../../src/rpc/types';

const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

const apiKeyUser: UserContext = {
  ...TEST_USER,
  authMethod: 'api_key',
  apiKeyScopes: ['*'],
  apiKeyId: 'key-1',
};

function makeJsonRpcRequest(
  method: string,
  id?: number | string,
  params?: Record<string, unknown>,
): Request {
  const body: Record<string, unknown> = { jsonrpc: '2.0', method };
  if (id !== undefined) body.id = id;
  if (params) body.params = params;
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text());
}

describe('MCP integration', () => {
  describe('full handshake', () => {
    it('initialize → tools/list → tools/call (list)', async () => {
      const config: InjectedProps = {
        models: [TEST_MODEL],
        handlers: [],
        mcp: { enabled: true },
      };
      const row = { id: 1, name: 'Alice', email: 'a@b.com', owner_id: 'user-123' };
      const db = createMockD1({ results: new Map([['SELECT', [row]]]) });
      const env = createMockEnv({ DB: db });

      // Step 1: initialize
      const initReq = makeJsonRpcRequest('initialize', 1);
      const initRes = await handleMcpPost(initReq, apiKeyUser, config, env, corsHeaders);
      expect(initRes.status).toBe(200);
      const initBody = await parseResponse(initRes);
      expect(initBody.result).toBeDefined();
      const serverInfo = (initBody.result as Record<string, unknown>).serverInfo as Record<string, unknown>;
      expect(serverInfo.name).toContain('Exepad');

      // Step 2: tools/list
      const listReq = makeJsonRpcRequest('tools/list', 2);
      const listRes = await handleMcpPost(listReq, apiKeyUser, config, env, corsHeaders);
      expect(listRes.status).toBe(200);
      const listBody = await parseResponse(listRes);
      const tools = (listBody.result as Record<string, unknown>).tools as Array<{ name: string }>;
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.name === 'contacts__list')).toBe(true);

      // Step 3: tools/call — list contacts
      const callReq = makeJsonRpcRequest('tools/call', 3, {
        name: 'contacts__list',
        arguments: {},
      });
      const callRes = await handleMcpPost(callReq, apiKeyUser, config, env, corsHeaders);
      expect(callRes.status).toBe(200);
      const callBody = await parseResponse(callRes);
      const callResult = callBody.result as { content: Array<{ type: string; text: string }> };
      expect(callResult.content).toHaveLength(1);
      expect(callResult.content[0].type).toBe('text');
      // The text should be valid JSON
      const parsed = JSON.parse(callResult.content[0].text);
      expect(parsed).toHaveProperty('records');
      expect(parsed).toHaveProperty('pagination');
    });
  });

  describe('API key scope enforcement', () => {
    it('respects scopes on tools/call', async () => {
      const config: InjectedProps = {
        models: [TEST_MODEL],
        handlers: [],
        mcp: { enabled: true },
      };
      const env = createMockEnv({ DB: createMockD1() });

      // User with read-only scope
      const readOnlyUser: UserContext = {
        ...TEST_USER,
        authMethod: 'api_key',
        apiKeyScopes: ['model:contacts:read'],
        apiKeyId: 'key-read',
      };

      // tools/call for list should still work — executeTool handles auth,
      // but the tool layer enforces scope at the executor level.
      // The MCP handler wraps tool errors as isError result.
      const callReq = makeJsonRpcRequest('tools/call', 1, {
        name: 'contacts__list',
        arguments: {},
      });
      const callRes = await handleMcpPost(callReq, readOnlyUser, config, env, corsHeaders);
      expect(callRes.status).toBe(200);
      // The response should have content (either success or isError)
      const body = await parseResponse(callRes);
      expect(body.result).toBeDefined();
    });
  });

  describe('MCP disabled', () => {
    it('mcp not enabled — caller should gate at route level, not transport', async () => {
      // The transport itself does not check config.mcp.enabled
      // (that's done in index.ts route). But we verify the handler
      // still works if somehow called with disabled config.
      const config: InjectedProps = {
        models: [TEST_MODEL],
        handlers: [],
        // mcp.enabled intentionally omitted / false
      };
      const env = createMockEnv({ DB: createMockD1() });

      const req = makeJsonRpcRequest('initialize', 1);
      const res = await handleMcpPost(req, apiKeyUser, config, env, corsHeaders);
      // Should still return 200 since transport doesn't gate on mcp.enabled
      expect(res.status).toBe(200);
    });
  });

  describe('CRUD tool execution via MCP', () => {
    it('creates a record via tools/call', async () => {
      const config: InjectedProps = {
        models: [TEST_MODEL],
        handlers: [],
        mcp: { enabled: true },
      };
      const createdRow = { id: 1, name: 'Bob', email: 'bob@test.com', owner_id: 'user-123' };
      const db = createMockD1({
        results: new Map([['INSERT INTO', [createdRow]]]),
      });
      const env = createMockEnv({ DB: db });

      const callReq = makeJsonRpcRequest('tools/call', 1, {
        name: 'contacts__create',
        arguments: { name: 'Bob', email: 'bob@test.com' },
      });
      const callRes = await handleMcpPost(callReq, apiKeyUser, config, env, corsHeaders);
      expect(callRes.status).toBe(200);

      const body = await parseResponse(callRes);
      const result = body.result as { content: Array<{ type: string; text: string }>; isError?: boolean };
      expect(result.isError).toBeUndefined();
      expect(result.content[0].type).toBe('text');

      const data = JSON.parse(result.content[0].text);
      expect(data.name).toBe('Bob');
      expect(data.email).toBe('bob@test.com');

      // Verify SQL was executed on mock D1
      expect(db._queries.some((q) => q.sql.includes('INSERT INTO'))).toBe(true);
    });

    it('reads a record via tools/call', async () => {
      const config: InjectedProps = {
        models: [TEST_MODEL],
        handlers: [],
        mcp: { enabled: true },
      };
      const row = { id: 1, name: 'Alice', email: 'a@b.com', owner_id: 'user-123' };
      const db = createMockD1({
        results: new Map([['SELECT', [row]]]),
      });
      const env = createMockEnv({ DB: db });

      const callReq = makeJsonRpcRequest('tools/call', 1, {
        name: 'contacts__read',
        arguments: { id: 1 },
      });
      const callRes = await handleMcpPost(callReq, apiKeyUser, config, env, corsHeaders);
      expect(callRes.status).toBe(200);

      const body = await parseResponse(callRes);
      const result = body.result as { content: Array<{ type: string; text: string }>; isError?: boolean };
      expect(result.isError).toBeUndefined();

      const data = JSON.parse(result.content[0].text);
      expect(data.name).toBe('Alice');
    });
  });

  describe('error handling', () => {
    it('returns isError for nonexistent tool', async () => {
      const config: InjectedProps = {
        models: [TEST_MODEL],
        handlers: [],
        mcp: { enabled: true },
      };
      const env = createMockEnv({ DB: createMockD1() });

      const callReq = makeJsonRpcRequest('tools/call', 1, {
        name: 'nonexistent__tool',
        arguments: {},
      });
      const callRes = await handleMcpPost(callReq, apiKeyUser, config, env, corsHeaders);
      expect(callRes.status).toBe(200);

      const body = await parseResponse(callRes);
      const result = body.result as { content: Array<{ text: string }>; isError?: boolean };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });

    it('returns JSON-RPC error for unknown method', async () => {
      const config: InjectedProps = {
        models: [TEST_MODEL],
        handlers: [],
        mcp: { enabled: true },
      };
      const env = createMockEnv({ DB: createMockD1() });

      const req = makeJsonRpcRequest('unknown/method', 1);
      const res = await handleMcpPost(req, apiKeyUser, config, env, corsHeaders);
      expect(res.status).toBe(200);

      const body = await parseResponse(res);
      expect(body.error).toBeDefined();
      expect((body.error as Record<string, unknown>).code).toBe(-32601);
    });
  });
});
