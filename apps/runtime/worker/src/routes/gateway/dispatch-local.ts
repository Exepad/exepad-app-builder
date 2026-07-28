/**
 * In-process dispatch to the app-backend.
 *
 * Replaces both the Workers-for-Platforms path (`USER_WORKERS.get().fetch()`)
 * and the old local-dev HTTP path (a `fetch` at `http://localhost:8787`, the
 * wrangler dev port — that constant no longer exists). The app-backend runs
 * in the SAME Node process, so we build its per-app `Env` and call its
 * `fetch(request, env)` export directly — no network hop, no serialization
 * beyond the request body we already construct.
 */
import appBackend from '@exepad/app-backend';
import type { AppMode } from '@exepad/local-adapters';
import type { Env } from '../../types/env';
import { resolveSecret } from '../../lib/secrets';
import { buildUserEnv } from '../../server/build-user-env';

async function userEnvFor(appId: string, mode: AppMode, env: Env, appAlias?: string) {
  const serviceToken = await resolveSecret(env.USER_WORKER_SERVICE_TOKEN);
  return buildUserEnv(appId, mode, {
    serviceToken: serviceToken || undefined,
    environment: env.ENVIRONMENT,
    appAlias,
  });
}

/**
 * Dispatch a JSON-RPC body to the app-backend in-process.
 * `headers` carry the gateway's identity + service-token signals.
 */
export async function dispatchRpcInProcess(
  headers: Headers,
  rpcBody: Record<string, unknown>,
  appId: string,
  mode: AppMode,
  env: Env,
  appAlias?: string,
): Promise<Response> {
  const userEnv = await userEnvFor(appId, mode, env, appAlias);
  const request = new Request('http://app-backend/rpc', {
    method: 'POST',
    headers,
    body: JSON.stringify(rpcBody),
  });
  return appBackend.fetch(request, userEnv as never);
}

/**
 * Forward a raw request to the app-backend at a specific path (`/mcp`,
 * `/files/...`), preserving method + streaming body. Used by MCP + file routes
 * where the app-backend dispatches on the URL pathname and the body may be
 * multipart/binary. `headers` are the merged gateway identity + service headers.
 */
export async function fetchAppBackendInProcess(
  request: Request,
  path: string,
  headers: Headers,
  appId: string,
  mode: AppMode,
  env: Env,
  appAlias?: string,
): Promise<Response> {
  const userEnv = await userEnvFor(appId, mode, env, appAlias);
  const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }
  const forwarded = new Request(`http://app-backend/${path.replace(/^\/+/, '')}`, init);
  return appBackend.fetch(forwarded, userEnv as never);
}
