/**
 * Gateway — Utility helpers
 */

import { buildCorsHeaders, applyCorsHeaders } from '../../lib/origin';

export function getCookieValue(request: Request, name: string): string | undefined {
  const values = getCookieValues(request, name);
  return values.length > 0 ? values[0] : undefined;
}

/**
 * Returns all values for a cookie name. When the browser has multiple cookies
 * with the same name but different Path scopes (e.g. after the cookie path was
 * broadened), RFC 6265 orders the more-specific path first. Callers that need
 * to tolerate stale values should iterate through every candidate.
 */
export function getCookieValues(request: Request, name: string): string[] {
  const header = request.headers.get('Cookie');
  if (!header) return [];
  const values: string[] = [];
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) values.push(rest.join('='));
  }
  return values;
}

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export function corsHeaders(origin: string | null): Record<string, string> {
  return buildCorsHeaders(origin);
}

export function wrapWithCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  applyCorsHeaders(headers, origin);
  return new Response(response.body, { status: response.status, headers });
}

export function workerNotFoundResponse(appId: string): Response {
  return jsonResponse({
    success: false,
    error: {
      code: 'WORKER_NOT_FOUND',
      message: `App backend for app '${appId}' not found. The app may not be deployed.`,
    },
  }, 503);
}

export function workerErrorResponse(error: unknown): Response {
  return jsonResponse({
    success: false,
    error: {
      code: 'WORKER_ERROR',
      message: error instanceof Error ? error.message : 'Worker execution failed',
    },
  }, 500);
}

// NOTE: there is deliberately no "local worker unavailable / connection error"
// helper here. The app-backend is imported and dispatched IN-PROCESS
// (`dispatch-local.ts`), so there is no socket to refuse a connection: a missing
// deploy surfaces as WORKER_NOT_FOUND above, and a module that throws surfaces
// as WORKER_ERROR. The old ECONNREFUSED probe + "start the local worker" hint
// belonged to the removed `fetch('http://localhost:8787')` dev path.
