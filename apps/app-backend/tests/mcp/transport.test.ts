/**
 * Tests for MCP HTTP transport — JSON-RPC parsing, auth gate, response format.
 */

import { describe, it, expect } from 'vitest';
import { handleMcpPost, handleMcpGet, handleMcpDelete } from '../../src/mcp/transport';
import { TEST_MODEL, TEST_USER, TEST_ANON, createMockEnv } from '../helpers/mock-env';
import { createMockD1 } from '../helpers/mock-d1';
import type { InjectedProps } from '@exepad/types';
import type { UserContext } from '../../src/rpc/types';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
};

const config: InjectedProps = {
  models: [TEST_MODEL],
  handlers: [],
  mcp: { enabled: true },
};

const apiKeyUser: UserContext = {
  ...TEST_USER,
  authMethod: 'api_key',
  apiKeyScopes: ['*'],
  apiKeyId: 'key-1',
};

const sessionUser: UserContext = {
  ...TEST_USER,
  authMethod: 'session',
};

const anonUser: UserContext = {
  ...TEST_ANON,
  authMethod: 'platform_header',
};

function makeJsonRpcRequest(method: string, id?: number | string, params?: Record<string, unknown>): Request {
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

describe('handleMcpPost', () => {
  describe('auth', () => {
    it('rejects unauthenticated requests', async () => {
      const env = createMockEnv({ DB: createMockD1() });
      const request = makeJsonRpcRequest('initialize', 1);
      const response = await handleMcpPost(request, anonUser, config, env, corsHeaders);

      expect(response.status).toBe(401);
      const body = await parseResponse(response);
      expect(body.error).toBeDefined();
      expect((body.error as Record<string, unknown>).code).toBe(-32603);
    });

    it('rejects session-based auth (requires API key)', async () => {
      const env = createMockEnv({ DB: createMockD1() });
      const request = makeJsonRpcRequest('initialize', 1);
      const response = await handleMcpPost(request, sessionUser, config, env, corsHeaders);

      expect(response.status).toBe(401);
      const body = await parseResponse(response);
      expect((body.error as Record<string, unknown>).message).toContain('Authentication required');
    });

    it('accepts valid API key auth', async () => {
      const env = createMockEnv({ DB: createMockD1() });
      const request = makeJsonRpcRequest('initialize', 1);
      const response = await handleMcpPost(request, apiKeyUser, config, env, corsHeaders);

      expect(response.status).toBe(200);
      const body = await parseResponse(response);
      expect(body.result).toBeDefined();
    });
  });

  describe('JSON-RPC parsing', () => {
    it('rejects invalid JSON', async () => {
      const env = createMockEnv({ DB: createMockD1() });
      const request = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json {{{',
      });
      const response = await handleMcpPost(request, apiKeyUser, config, env, corsHeaders);

      expect(response.status).toBe(400);
      const body = await parseResponse(response);
      expect((body.error as Record<string, unknown>).code).toBe(-32700);
    });

    it('rejects batch requests (array body)', async () => {
      const env = createMockEnv({ DB: createMockD1() });
      const request = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ jsonrpc: '2.0', method: 'ping', id: 1 }]),
      });
      const response = await handleMcpPost(request, apiKeyUser, config, env, corsHeaders);

      expect(response.status).toBe(400);
      const body = await parseResponse(response);
      expect((body.error as Record<string, unknown>).code).toBe(-32600);
    });

    it('rejects missing jsonrpc field', async () => {
      const env = createMockEnv({ DB: createMockD1() });
      const request = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'ping', id: 1 }),
      });
      const response = await handleMcpPost(request, apiKeyUser, config, env, corsHeaders);

      expect(response.status).toBe(400);
      const body = await parseResponse(response);
      expect((body.error as Record<string, unknown>).message).toContain('jsonrpc');
    });

    it('rejects non-string method', async () => {
      const env = createMockEnv({ DB: createMockD1() });
      const request = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 123, id: 1 }),
      });
      const response = await handleMcpPost(request, apiKeyUser, config, env, corsHeaders);

      expect(response.status).toBe(400);
      const body = await parseResponse(response);
      expect((body.error as Record<string, unknown>).message).toContain('method');
    });

    it('returns 202 for notifications (no id)', async () => {
      const env = createMockEnv({ DB: createMockD1() });
      const request = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      });
      const response = await handleMcpPost(request, apiKeyUser, config, env, corsHeaders);

      expect(response.status).toBe(202);
    });
  });

  describe('response format', () => {
    it('returns Content-Type: application/json', async () => {
      const env = createMockEnv({ DB: createMockD1() });
      const request = makeJsonRpcRequest('ping', 1);
      const response = await handleMcpPost(request, apiKeyUser, config, env, corsHeaders);

      expect(response.headers.get('Content-Type')).toBe('application/json');
    });

    it('includes CORS headers', async () => {
      const env = createMockEnv({ DB: createMockD1() });
      const request = makeJsonRpcRequest('ping', 1);
      const response = await handleMcpPost(request, apiKeyUser, config, env, corsHeaders);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('echoes request id in response', async () => {
      const env = createMockEnv({ DB: createMockD1() });
      const request = makeJsonRpcRequest('ping', 42);
      const response = await handleMcpPost(request, apiKeyUser, config, env, corsHeaders);

      const body = await parseResponse(response);
      expect(body.id).toBe(42);
    });

    it('echoes string request id in response', async () => {
      const env = createMockEnv({ DB: createMockD1() });
      const request = makeJsonRpcRequest('ping', 'req-abc');
      const response = await handleMcpPost(request, apiKeyUser, config, env, corsHeaders);

      const body = await parseResponse(response);
      expect(body.id).toBe('req-abc');
    });

    it('returns jsonrpc: 2.0 in response', async () => {
      const env = createMockEnv({ DB: createMockD1() });
      const request = makeJsonRpcRequest('ping', 1);
      const response = await handleMcpPost(request, apiKeyUser, config, env, corsHeaders);

      const body = await parseResponse(response);
      expect(body.jsonrpc).toBe('2.0');
    });
  });
});

describe('handleMcpGet', () => {
  it('returns 405 Method Not Allowed', () => {
    const response = handleMcpGet(corsHeaders);
    expect(response.status).toBe(405);
  });

  it('includes Allow: POST header', () => {
    const response = handleMcpGet(corsHeaders);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('includes CORS headers', () => {
    const response = handleMcpGet(corsHeaders);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('handleMcpDelete', () => {
  it('returns 405 Method Not Allowed', () => {
    const response = handleMcpDelete(corsHeaders);
    expect(response.status).toBe(405);
  });

  it('includes Allow: POST header', () => {
    const response = handleMcpDelete(corsHeaders);
    expect(response.headers.get('Allow')).toBe('POST');
  });
});
