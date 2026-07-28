/**
 * Admin Files Routes
 *
 * GET    /                  — List uploaded files (paginated, newest first)
 * GET    /:fileId/download  — Download a file (streamed from the app-backend serve)
 * DELETE /:fileId           — Soft-delete a file (dispatched as sys_file_delete RPC)
 *
 * Listing reads the per-app D1 `_files` table directly (like admin/forms.ts).
 * Download/delete must go through the app-backend because the per-app R2 bucket
 * (`exepad-files-{appId}`, binding R2_FILES) is bound to the app-backend, not the
 * runtime worker. We dispatch with the gateway service token + a synthetic admin
 * identity so the app-backend's checkFileAccess() passes for any visibility.
 */

import { Hono } from 'hono';
import type { Env } from '../../types/env';
import { authenticateAdmin, isAdminAuthError } from '../../lib/admin-auth';
import { escapeLikePattern } from '../../lib/sql-utils';
import { executeD1Query } from '@exepad/deploy-utils';
import { buildDispatchHeaders, type GatewayIdentity } from '../gateway/auth';
import { dispatchRpcInProcess, fetchAppBackendInProcess } from '../gateway/dispatch-local';

export const files = new Hono<{ Bindings: Env }>();

/**
 * Synthetic admin identity for app-backend dispatch. Only the runtime can mint
 * this — the app-backend only trusts X-User-* headers when the request also
 * carries the gateway service token (set by buildDispatchHeaders). The `admin`
 * role lets checkFileAccess()/checkFileOwnership() pass for private files too.
 */
function adminIdentity(): GatewayIdentity {
  const headers = new Headers();
  headers.set('X-User-Id', '_exepad_admin_');
  headers.set(
    'X-User-Email',
    process.env.EXEPAD_ADMIN_EMAIL ||
      (process.env.ENVIRONMENT === 'selfhost' ? 'admin@selfhost' : 'admin@exepad.app'),
  );
  headers.set('X-User-Roles', 'admin');
  return {
    headers,
    isAuthenticated: true,
    kind: 'platform_bridge',
    stateKey: null,
    userRoles: ['admin'],
  };
}

function normalizeMode(raw: string | undefined): 'preview' | 'published' {
  return raw === 'preview' ? 'preview' : 'published';
}

// ── GET / — list files ───────────────────────────────────────

files.get('/', async (c) => {
  const appId = c.req.param('appId')!;
  const mode = c.req.query('mode') || 'published';
  // Read-only: never provision a DB just to list files (write-on-read).
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode, { createIfMissing: false });
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);
  if (auth.dbMissing) {
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20', 10)));
    return c.json({ success: true, data: { items: [], total: 0, page, limit: pageSize } });
  }

  const { config, dbId } = auth;

  try {
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20', 10)));
    const search = c.req.query('search')?.trim() || '';
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['"deleted_at" IS NULL'];
    const params: (string | number | null)[] = [];
    if (search) {
      conditions.push(`"filename" LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLikePattern(search)}%`);
    }
    const whereClause = conditions.join(' AND ');

    const countResult = await executeD1Query(
      config, dbId,
      `SELECT COUNT(*) as total FROM "_files" WHERE ${whereClause}`,
      params,
    );
    const total = (countResult.results[0] as Record<string, unknown>)?.total as number ?? 0;

    const selectResult = await executeD1Query(
      config, dbId,
      `SELECT "id", "filename", "content_type", "size_bytes", "visibility", "owner_id",
              "model_name", "record_id", "field_name", "created_at"
       FROM "_files" WHERE ${whereClause} ORDER BY "created_at" DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    const items = (selectResult.results as Record<string, unknown>[]).map((r) => ({
      id: r.id,
      filename: r.filename,
      contentType: r.content_type,
      sizeBytes: r.size_bytes,
      visibility: r.visibility,
      ownerId: r.owner_id,
      modelName: r.model_name,
      recordId: r.record_id,
      fieldName: r.field_name,
      createdAt: r.created_at,
    }));

    return c.json({ success: true, data: { items, total, page, limit: pageSize } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // No uploads yet (table not created until first storage use) — return empty.
    if (message.includes('no such table')) {
      return c.json({ success: true, data: { items: [], total: 0, page: 1, limit: 20 } });
    }
    return c.json({ success: false, error: message }, 500);
  }
});

// ── GET /:fileId/download — stream file from the app-backend ──

files.get('/:fileId/download', async (c) => {
  const appId = c.req.param('appId')!;
  const fileId = c.req.param('fileId')!;
  const mode = normalizeMode(c.req.query('mode'));
  // Read-only: never provision a DB just to resolve a download.
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode, { createIfMissing: false });
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);
  if (auth.dbMissing) return c.json({ success: false, error: 'File not found' }, 404);

  const { config, dbId } = auth;

  // Resolve filename — the app-backend serve path is /files/{id}/{filename}.
  let filename = 'file';
  try {
    const r = await executeD1Query(
      config, dbId,
      `SELECT "filename" FROM "_files" WHERE "id" = ? AND "deleted_at" IS NULL`,
      [fileId],
    );
    const row = r.results[0] as Record<string, unknown> | undefined;
    if (!row) {
      return c.json({ success: false, error: 'File not found' }, 404);
    }
    filename = String(row.filename || 'file');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('no such table')) {
      return c.json({ success: false, error: 'File not found' }, 404);
    }
    return c.json({ success: false, error: message }, 500);
  }

  try {
    const headers = await buildDispatchHeaders(c.req.raw, appId, mode, c.env, {
      identity: adminIdentity(),
    });
    const workerResponse = await fetchAppBackendInProcess(
      c.req.raw,
      `files/${fileId}/${encodeURIComponent(filename)}`,
      headers,
      appId,
      mode,
      c.env,
    );
    // Pass the binary + content headers (Content-Type/Disposition) straight through.
    return new Response(workerResponse.body, {
      status: workerResponse.status,
      headers: workerResponse.headers,
    });
  } catch (error) {
    console.error(`[Admin Files] download error for ${appId}/${fileId}:`, error);
    return c.json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

// ── DELETE /:fileId — soft-delete via sys_file_delete RPC ─────

files.delete('/:fileId', async (c) => {
  const appId = c.req.param('appId')!;
  const fileId = c.req.param('fileId')!;
  const mode = normalizeMode(c.req.query('mode'));
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode);
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);

  try {
    const headers = await buildDispatchHeaders(c.req.raw, appId, mode, c.env, {
      identity: adminIdentity(),
    });
    const workerResponse = await dispatchRpcInProcess(
      headers,
      { method: 'sys_file_delete', params: { id: fileId } },
      appId,
      mode,
      c.env,
    );
    const body = await workerResponse.text();
    return new Response(body, {
      status: workerResponse.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(`[Admin Files] delete error for ${appId}/${fileId}:`, error);
    return c.json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
