/**
 * File metadata RPC methods
 *
 * These go through the normal JSON-RPC router (unlike upload/serve which
 * are intercepted at the URL path level).
 *
 * - sys_file_read: Get metadata for a single file by ID
 * - sys_file_list: List files with pagination and filters
 * - sys_file_delete: Soft-delete a file
 */

import type { InjectedProps } from '@exepad/types';
import type { UserContext } from '../rpc/types';
import type { RpcResponse } from '../rpc/types';
import type { Env } from '../types/env';
import { WorkerError, NotFoundError, UnauthorizedError } from '../utils/errors';
import { checkFileAccess, type FileRecord } from './access';
import { buildFileUrl } from './keys';

/** Safely parse JSON metadata, returning the raw string on failure */
function safeParseJSON(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Shape the raw DB row into a client-facing file object */
function formatFileResponse(file: FileRecord, appId: string) {
  return {
    id: file.id,
    url: buildFileUrl(appId, file.id, file.filename),
    filename: file.filename,
    contentType: file.content_type,
    size: file.size_bytes,
    visibility: file.visibility,
    modelName: file.model_name || undefined,
    recordId: file.record_id || undefined,
    fieldName: file.field_name || undefined,
    metadata: file.metadata ? safeParseJSON(file.metadata) : undefined,
    createdAt: file.created_at,
    updatedAt: file.updated_at,
  };
}

/**
 * sys_file_read — Get metadata for a single file by ID.
 */
export async function sysFileRead(
  params: Record<string, unknown> | undefined,
  user: UserContext,
  db: D1Database,
  config: InjectedProps,
  appId: string,
): Promise<RpcResponse> {
  const storage = config.storage!;
  const fileId = params?.id as string;

  if (!fileId) {
    throw new WorkerError('INVALID_REQUEST', 'Missing file "id" parameter', 400);
  }

  checkFileAccess(user, storage, 'download');

  const file = await db
    .prepare(
      `SELECT id, owner_id, app_id, filename, content_type, size_bytes, r2_key, visibility,
              model_name, record_id, field_name, metadata, thumbnail_r2_key, created_at, updated_at, deleted_at
       FROM _files WHERE id = ? AND app_id = ? AND deleted_at IS NULL`
    )
    .bind(fileId, appId)
    .first<FileRecord>();

  if (!file) {
    throw new NotFoundError('File', fileId);
  }

  // Check ownership / visibility
  checkFileAccess(user, storage, 'download', file);

  return { success: true, data: formatFileResponse(file, appId) };
}

/**
 * sys_file_list — List files with optional filters and pagination.
 *
 * Params:
 * - limit: number (default 50, max 100)
 * - offset: number (default 0)
 * - model_name: string (optional filter)
 * - record_id: string (optional filter)
 * - visibility: string (optional filter)
 * - owner_only: boolean (default true) — when false, also surface other users'
 *   shared/public files. It can never surface another user's PRIVATE files; the
 *   listing always excludes private files the caller doesn't own (admins excepted).
 */
export async function sysFileList(
  params: Record<string, unknown> | undefined,
  user: UserContext,
  db: D1Database,
  config: InjectedProps,
  appId: string,
): Promise<RpcResponse> {
  const storage = config.storage!;
  checkFileAccess(user, storage, 'list');

  const rawLimit = params?.limit != null ? Number(params.limit) : 50;
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 100);
  const rawOffset = params?.offset != null ? Number(params.offset) : 0;
  const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);
  const modelName = params?.model_name as string | undefined;
  const recordId = params?.record_id as string | undefined;
  const visibilityFilter = params?.visibility as string | undefined;
  const ownerOnly = params?.owner_only !== false;

  // Build query
  const conditions: string[] = ['app_id = ?', 'deleted_at IS NULL'];
  const binds: unknown[] = [appId];

  // Visibility scoping. A non-admin caller must NEVER receive another user's
  // PRIVATE file via list — only their own files, plus (when owner_only=false)
  // app-wide shared/public ones. Admins see everything.
  const isAdmin = user.isAuthenticated && user.roles.includes('admin');
  if (!isAdmin) {
    if (!user.isAuthenticated) {
      // Anonymous listing is only reachable via filePolicy.list:'public' or
      // publicAccess. Anon callers can at most read shared/public files, so the
      // listing excludes private files entirely (no owner identity to match).
      conditions.push("visibility IN ('shared', 'public')");
    } else if (ownerOnly) {
      // Default: strictly the caller's own files.
      conditions.push('owner_id = ?');
      binds.push(user.id);
    } else {
      // owner_only=false widens to the caller's own files plus any shared/public
      // file in the app — but still never another user's private file.
      conditions.push("(owner_id = ? OR visibility IN ('shared', 'public'))");
      binds.push(user.id);
    }
  }

  if (modelName) {
    conditions.push('model_name = ?');
    binds.push(modelName);
  }
  if (recordId) {
    conditions.push('record_id = ?');
    binds.push(recordId);
  }
  if (visibilityFilter) {
    conditions.push('visibility = ?');
    binds.push(visibilityFilter);
  }

  const whereClause = conditions.join(' AND ');

  // Count total
  const countResult = await db
    .prepare(`SELECT COUNT(*) as total FROM _files WHERE ${whereClause}`)
    .bind(...binds)
    .first<{ total: number }>();
  const total = countResult?.total ?? 0;

  // Fetch page
  const rows = await db
    .prepare(
      `SELECT id, owner_id, app_id, filename, content_type, size_bytes, r2_key, visibility,
              model_name, record_id, field_name, metadata, thumbnail_r2_key, created_at, updated_at, deleted_at
       FROM _files WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, limit, offset)
    .all<FileRecord>();

  const files = (rows.results || []).map((f) => formatFileResponse(f, appId));

  return {
    success: true,
    data: files,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  };
}

/**
 * sys_file_delete — Delete a file.
 *
 * The `_files` row is soft-deleted (deleted_at set) so it survives as an audit
 * tombstone, but the backing storage object (and any thumbnail) is HARD-deleted
 * immediately to free real disk. There is no restore/undelete path — every
 * read/serve/list query filters `deleted_at IS NULL`, so the object is already
 * unreachable after the tombstone — and quota accounts only live rows, so
 * leaving the bytes on disk let a delete→re-upload loop grow the volume without
 * bound (both the per-user and per-app caps count only live rows).
 *
 * Only the file owner or an admin can delete.
 */
export async function sysFileDelete(
  params: Record<string, unknown> | undefined,
  user: UserContext,
  env: Env,
  config: InjectedProps,
  appId: string,
): Promise<RpcResponse> {
  const db = env.DB;
  const storage = config.storage!;
  const fileId = params?.id as string;

  if (!fileId) {
    throw new WorkerError('INVALID_REQUEST', 'Missing file "id" parameter', 400);
  }

  if (!user.isAuthenticated) {
    throw new UnauthorizedError('Authentication required to delete files');
  }

  checkFileAccess(user, storage, 'delete');

  // Look up the file
  const file = await db
    .prepare(
      `SELECT id, owner_id, app_id, filename, content_type, size_bytes, r2_key, visibility,
              model_name, record_id, field_name, metadata, thumbnail_r2_key, created_at, updated_at, deleted_at
       FROM _files WHERE id = ? AND app_id = ? AND deleted_at IS NULL`
    )
    .bind(fileId, appId)
    .first<FileRecord>();

  if (!file) {
    throw new NotFoundError('File', fileId);
  }

  // Check ownership
  checkFileAccess(user, storage, 'delete', file);

  // Soft-delete the row (audit tombstone)...
  const now = new Date().toISOString();
  await db
    .prepare('UPDATE _files SET deleted_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, fileId)
    .run();

  // ...then hard-delete the backing bytes so the /data volume actually shrinks.
  // Best-effort: the row is already tombstoned, so a storage hiccup here must
  // not fail the delete (it would only orphan bytes, never resurrect the file).
  if (env.R2_FILES) {
    if (file.r2_key) {
      await env.R2_FILES.delete(file.r2_key).catch((err) => {
        console.error(`[files] failed to purge storage object ${file.r2_key}:`, err);
      });
    }
    if (file.thumbnail_r2_key) {
      await env.R2_FILES.delete(file.thumbnail_r2_key).catch((err) => {
        console.error(
          `[files] failed to purge thumbnail object ${file.thumbnail_r2_key}:`,
          err,
        );
      });
    }
  }

  return { success: true, data: { id: fileId, deleted: true } };
}
