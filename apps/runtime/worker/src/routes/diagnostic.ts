/// <reference lib="dom" />
/**
 * Diagnostic probe routes — Surveyor Phase 2 Class B.
 *
 * Mounted at ``/api/:appId/_diag/*`` BEFORE the catch-all gateway in
 * index.ts. Authenticated by the dedicated ``X-Diagnostic-Secret``
 * header (classic worker secret, rotated quarterly, distinct from
 * PLATFORM_BRIDGE_SECRET / EXEPAD_ROUTER_SECRET so the blast radius
 * of a leak is bounded).
 *
 * Endpoints:
 *   POST /:appId/_diag/execute_handler
 *     Proxy a single handler call to the preview WfP worker. Reuses
 *     dispatchRpc() from gateway/dispatch.ts so behavior matches a
 *     real /rpc request exactly. 5s wall-clock cap.
 *
 *   POST /:appId/_diag/query_db
 *     Read-only SQL on the preview D1. SELECT/PRAGMA whitelisted via
 *     node-sql-parser AST + prefix gate (sql-whitelist.ts is the
 *     trust boundary against prompt-injectable LLM SQL). 100-row cap.
 *
 *   GET  /:appId/_diag/sample_table?name=X&limit=10
 *     Convenience wrapper — compiles to SELECT * FROM <X> LIMIT N
 *     after identifier sanitization, runs through query_db's path.
 *
 *   POST /:appId/_diag/inspect
 *     Combined screenshot + DOM inspection in a single CF Browser
 *     Rendering session. Returns ``png_b64`` (when wantScreenshot=true),
 *     ``dom`` (text/styles/attributes for the requested selector),
 *     ``page_errors``, ``failed_requests``. The agent-side screenshot
 *     tool uploads the PNG to GCS and surfaces a signed URL — bytes
 *     never enter the LLM context.
 *
 * NOTE: integration tests deferred. The runtime worker has no test
 * infrastructure today (no vitest in the worker package). Pure-logic
 * tests (sql-whitelist) live under apps/runtime/tests/unit/worker/.
 * Diagnostic-route behavior is verified via post-deploy manual probes
 * + the agent E2E test (apps/agent/tests/e2e/test_surveyor_runtime_probes.py).
 */

import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { Env } from '../types/env';
import { constantTimeEqual } from '../lib/crypto-utils';
import { resolveSecret } from '../lib/secrets';
import { createLogger } from '../lib/logger';
import { getD1Database, executeD1Query } from '@exepad/deploy-utils';
import { dispatchRpc } from './gateway/dispatch';
import { loadAppConfig as loadGatewayConfig } from './gateway/config';
import { resolveGatewayIdentity } from './gateway/auth';
import { validateReadOnlySql, safeIdentifier } from '../lib/sql-whitelist';

export const diagnostic = new Hono<{ Bindings: Env }>();

const PROBE_TIMEOUT_MS = 5000;
const RESPONSE_PAYLOAD_CAP_BYTES = 10 * 1024;
const SQL_ROW_CAP = 100;
const DEFAULT_DIAGNOSTIC_PRINCIPAL = '_exepad_diagnostic_';

// ── Auth middleware ────────────────────────────────────────────────────────

/**
 * Require ``X-Diagnostic-Secret`` on every diagnostic route. The trust
 * boundary against agent or third-party traffic. Returns 401 on
 * mismatch; the agent's ``RuntimeProbeClient`` knows how to surface
 * this as ``{error: 'http_401'}``.
 */
diagnostic.use('/:appId/_diag/*', async (c, next) => {
  const provided = c.req.header('X-Diagnostic-Secret') || '';
  const expected = await resolveSecret(c.env.PLATFORM_DIAGNOSTIC_SECRET);
  if (!expected || !constantTimeEqual(provided, expected)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});

function logProbe(
  c: { req: { header: (k: string) => string | undefined }; env: Env },
  appId: string,
  tool: string,
  outcome: string,
  extra: Record<string, unknown> = {},
): void {
  const log = createLogger({
    requestId: c.req.header('X-Request-Id'),
    appId,
  });
  log.info('diagnostic_audit', { tool, outcome, ...extra });
}

// ── Shared helpers ─────────────────────────────────────────────────────────

/**
 * Resolve the preview D1 database id for ``appId``. Self-host uses the local
 * SQLite-backed deploy-utils, which key the database off the file path derived
 * from the (CF-shaped but ignored) config + the `exepad-preview-` db name.
 */
async function resolveDiagnosticD1(env: Env, appId: string): Promise<
  | {
      ok: true;
      config: { accountId: string; apiToken: string; wfpNamespace: string; appId: string; appAlias: string };
      dbId: string;
    }
  | { ok: false; error: string; status: ContentfulStatusCode }
> {
  void env;
  const config = {
    accountId: 'local',
    apiToken: 'local',
    wfpNamespace: 'local',
    appId,
    appAlias: appId,
  };
  const dbName = `exepad-preview-${appId}`;
  let dbInfo;
  try {
    dbInfo = await getD1Database(config, dbName);
  } catch (e) {
    return { ok: false, error: `d1_lookup_failed: ${(e as Error).message}`, status: 502 };
  }
  if (!dbInfo) {
    return { ok: false, error: `preview_d1_not_found: ${dbName}`, status: 404 };
  }
  return { ok: true, config, dbId: dbInfo.uuid };
}

/** Truncate large payloads to a fixed byte budget so the agent never
 * receives a 5MB JSON blob — the LLM context can't use it anyway. */
function capJson(payload: unknown, capBytes: number): { value: unknown; truncated: boolean } {
  const serialized = JSON.stringify(payload);
  if (serialized.length <= capBytes) return { value: payload, truncated: false };
  return {
    value: { _truncated_excerpt: serialized.slice(0, capBytes), _original_bytes: serialized.length },
    truncated: true,
  };
}

// ── POST /:appId/_diag/execute_handler ─────────────────────────────────────

interface ExecuteHandlerBody {
  handler_name?: string;
  params?: Record<string, unknown>;
  as_user?: string | null;
}

diagnostic.post('/:appId/_diag/execute_handler', async (c) => {
  const appId = c.req.param('appId');
  const start = Date.now();

  let body: ExecuteHandlerBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const { handler_name, params, as_user } = body;
  if (!handler_name || typeof handler_name !== 'string') {
    return c.json({ error: 'handler_name required' }, 400);
  }

  // Validate the handler exists in the deployed config — fail fast
  // before spinning up a worker dispatch for a name that doesn't exist.
  // Only DynamicBackend exposes ``handlers`` (static / none backends
  // can't be probed this way).
  const config = await loadGatewayConfig(appId, 'preview', c.env);
  const backend = config?.backend;
  const handlers = backend && backend.mode === 'dynamic' ? backend.handlers ?? [] : [];
  const handler = handlers.find((h) => h.name === handler_name);
  if (!handler) {
    logProbe(c, appId, 'execute_handler', 'handler_not_found', { handler_name });
    return c.json({ error: 'handler_not_found', handler_name }, 404);
  }

  // Build identity so dispatchRpc gets the right X-User-Id. Default
  // to a synthetic diagnostic principal — handler row-level filters
  // on owner_id will return [] for the real owner, which the caller
  // can override by passing as_user.
  const identity = await resolveGatewayIdentity(c.req.raw, appId, 'preview', c.env);
  const effectiveUser = as_user || DEFAULT_DIAGNOSTIC_PRINCIPAL;
  identity.headers.set('X-User-Id', effectiveUser);

  try {
    const dispatch = dispatchRpc(
      c.req.raw,
      appId,
      handler_name,
      'handler',
      c.env,
      'preview',
      config,
      { method: handler_name, params: params ?? {} },
      identity,
    );
    const timeoutPromise = new Promise<Response>((_resolve, reject) =>
      setTimeout(() => reject(new Error('duration_exceeded')), PROBE_TIMEOUT_MS),
    );

    const resp = await Promise.race([dispatch, timeoutPromise]);
    const duration_ms = Date.now() - start;

    let parsed: unknown;
    let raw = '';
    try {
      raw = await resp.text();
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = raw;
    }
    const { value, truncated } = capJson(parsed, RESPONSE_PAYLOAD_CAP_BYTES);

    logProbe(c, appId, 'execute_handler', 'ok', {
      handler_name,
      status: resp.status,
      duration_ms,
      truncated,
    });
    return c.json({
      status: resp.status,
      duration_ms,
      response: value,
      _truncated: truncated || undefined,
    });
  } catch (e) {
    const duration_ms = Date.now() - start;
    if ((e as Error).message === 'duration_exceeded') {
      logProbe(c, appId, 'execute_handler', 'duration_exceeded', { handler_name, duration_ms });
      return c.json({ error: 'duration_exceeded', duration_ms }, 504);
    }
    logProbe(c, appId, 'execute_handler', 'dispatch_error', {
      handler_name,
      message: (e as Error).message,
    });
    return c.json({ error: 'dispatch_error', message: (e as Error).message }, 502);
  }
});

// ── POST /:appId/_diag/query_db ─────────────────────────────────────────────

diagnostic.post('/:appId/_diag/query_db', async (c) => {
  const appId = c.req.param('appId');
  const start = Date.now();

  let body: { sql?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const sql = (body.sql ?? '').trim();
  if (!sql) return c.json({ error: 'sql required' }, 400);

  const verdict = validateReadOnlySql(sql);
  if (!verdict.ok) {
    logProbe(c, appId, 'query_db', 'rejected_by_whitelist', {
      reason: verdict.reason,
      sql_excerpt: sql.slice(0, 200),
    });
    return c.json({ error: 'sql_rejected', reason: verdict.reason }, 400);
  }

  const d1 = await resolveDiagnosticD1(c.env, appId);
  if (!d1.ok) {
    logProbe(c, appId, 'query_db', 'd1_resolve_failed', { reason: d1.error });
    return c.json({ error: d1.error }, d1.status);
  }

  try {
    const result = await executeD1Query(d1.config, d1.dbId, sql, []);
    const allRows = (result.results as unknown[]) ?? [];
    const truncated = allRows.length > SQL_ROW_CAP;
    const rows = truncated ? allRows.slice(0, SQL_ROW_CAP) : allRows;
    const duration_ms = Date.now() - start;

    logProbe(c, appId, 'query_db', 'ok', {
      duration_ms,
      row_count: rows.length,
      truncated,
    });
    return c.json({
      rows,
      row_count: rows.length,
      duration_ms,
      _truncated: truncated || undefined,
    });
  } catch (e) {
    logProbe(c, appId, 'query_db', 'd1_error', { message: (e as Error).message });
    return c.json({ error: 'd1_error', message: (e as Error).message }, 502);
  }
});

// ── GET /:appId/_diag/sample_table?name=X&limit=10 ─────────────────────────

diagnostic.get('/:appId/_diag/sample_table', async (c) => {
  const appId = c.req.param('appId');
  const start = Date.now();

  const name = c.req.query('name') ?? '';
  const limitRaw = c.req.query('limit') ?? '10';
  const safeName = safeIdentifier(name);
  if (!safeName) {
    return c.json({ error: 'invalid_table_name' }, 400);
  }
  let limit = parseInt(limitRaw, 10);
  if (Number.isNaN(limit) || limit < 1) limit = 10;
  if (limit > SQL_ROW_CAP) limit = SQL_ROW_CAP;

  // Sanitized identifier + numeric limit — safe to splice. Passes
  // through the same whitelist gate as raw query_db just in case.
  const sql = `SELECT * FROM "${safeName}" LIMIT ${limit}`;
  const verdict = validateReadOnlySql(sql);
  if (!verdict.ok) {
    logProbe(c, appId, 'sample_table', 'rejected_by_whitelist', { reason: verdict.reason });
    return c.json({ error: 'sql_rejected', reason: verdict.reason }, 400);
  }

  const d1 = await resolveDiagnosticD1(c.env, appId);
  if (!d1.ok) return c.json({ error: d1.error }, d1.status);

  try {
    const result = await executeD1Query(d1.config, d1.dbId, sql, []);
    const rows = ((result.results as unknown[]) ?? []).slice(0, SQL_ROW_CAP);
    const duration_ms = Date.now() - start;
    logProbe(c, appId, 'sample_table', 'ok', { duration_ms, row_count: rows.length, table: safeName });
    return c.json({ rows, row_count: rows.length, duration_ms, table: safeName });
  } catch (e) {
    logProbe(c, appId, 'sample_table', 'd1_error', { message: (e as Error).message });
    return c.json({ error: 'd1_error', message: (e as Error).message }, 502);
  }
});

// ── POST /:appId/_diag/inspect — combined screenshot + DOM ─────────────────

// Screenshot/DOM inspection relied on Cloudflare Browser Rendering, which has no
// self-host equivalent. The probe stays registered (so the agent's Surveyor gets
// a structured answer) but reports the capability as unavailable.
diagnostic.post('/:appId/_diag/inspect', async (c) => {
  const appId = c.req.param('appId');
  logProbe(c, appId, 'inspect', 'browser_unavailable');
  return c.json({ error: 'browser_unavailable' }, 503);
});
