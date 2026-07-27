/**
 * Mock Request builders for tests
 */

/**
 * Create a POST /rpc request with JSON body
 */
export function createRpcRequest(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  model?: string
): Request {
  const body: Record<string, unknown> = { method, params };
  if (model) body.model = model;

  return new Request('http://localhost/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Create standard user authentication headers
 */
export function createMockUserHeaders(
  userId = 'user-123',
  email = 'test@example.com',
  roles = ''
): Record<string, string> {
  return {
    'X-User-Id': userId,
    'X-User-Email': email,
    ...(roles ? { 'X-User-Roles': roles } : {}),
  };
}

/**
 * Create a GET request
 */
export function createGetRequest(
  path: string,
  headers: Record<string, string> = {}
): Request {
  return new Request(`http://localhost${path}`, {
    method: 'GET',
    headers,
  });
}

/**
 * Create an OPTIONS (preflight) request
 */
export function createOptionsRequest(
  path: string = '/rpc',
  headers: Record<string, string> = {}
): Request {
  return new Request(`http://localhost${path}`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:3001',
      ...headers,
    },
  });
}
