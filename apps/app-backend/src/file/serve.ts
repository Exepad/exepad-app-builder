/**
 * File serve handler (sys_file_serve)
 *
 * Serves file bytes from R2 with appropriate security headers.
 *
 * Route: GET /files/{fileId}/{filename}
 *
 * Security headers applied:
 * - Content-Type from D1 metadata (never from request)
 * - Content-Disposition: inline for safe types, attachment for others
 * - X-Content-Type-Options: nosniff
 * - Content-Security-Policy: script-src 'none'
 * - Cache-Control: private, max-age=3600
 */

import type { Env } from '../types/env';
import type { InjectedProps } from '@exepad/types';
import type { UserContext } from '../rpc/types';
import { WorkerError } from '../utils/errors';
import { checkFileAccess, type FileRecord } from './access';
import { getContentDisposition } from './validation';

/**
 * Handle a file serve request.
 *
 * Called from the worker entry point for GET /files/{id}/{filename} requests.
 * Returns a binary Response with the file body and security headers.
 */
export async function handleFileServe(
  request: Request,
  user: UserContext,
  config: InjectedProps,
  env: Env,
): Promise<Response> {
  const storage = config.storage!;
  const url = new URL(request.url);

  // Parse file ID from path: /files/{fileId}/{filename}
  const pathParts = url.pathname.replace(/^\/files\//, '').split('/');
  const fileId = pathParts[0];

  if (!fileId) {
    throw new WorkerError('INVALID_REQUEST', 'Missing file ID in URL', 400);
  }

  if (!env.R2_FILES) {
    throw new WorkerError('INTERNAL_ERROR', 'File storage not configured', 500);
  }

  // Look up file in D1
  const file = await env.DB.prepare(
    `SELECT id, owner_id, app_id, filename, content_type, size_bytes, r2_key, visibility,
            model_name, record_id, field_name, metadata, thumbnail_r2_key, created_at, updated_at, deleted_at
     FROM _files WHERE id = ? AND app_id = ? AND deleted_at IS NULL`
  )
    .bind(fileId, env.APP_ID)
    .first<FileRecord>();

  if (!file) {
    throw new WorkerError('NOT_FOUND', 'File not found', 404);
  }

  // Access control check
  checkFileAccess(user, storage, 'download', file);

  // Fetch from R2
  const r2Object = await env.R2_FILES.get(file.r2_key);
  if (!r2Object) {
    console.error(`[file-serve] R2 object missing for key: ${file.r2_key} (file ${fileId})`);
    throw new WorkerError('NOT_FOUND', 'File data not found in storage', 404);
  }

  // Build security headers
  const headers = new Headers();
  headers.set('Content-Type', file.content_type);
  headers.set('Content-Length', String(file.size_bytes));
  headers.set('Content-Disposition', getContentDisposition(file.content_type, file.filename));
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "script-src 'none'");
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('ETag', `"${fileId}"`);

  // Support conditional requests (304 Not Modified)
  const ifNoneMatch = request.headers.get('If-None-Match');
  if (ifNoneMatch === `"${fileId}"`) {
    // Per RFC 7232: 304 MUST NOT include entity headers (Content-Type, Content-Length, Content-Disposition)
    const notModifiedHeaders = new Headers();
    notModifiedHeaders.set('ETag', `"${fileId}"`);
    notModifiedHeaders.set('Cache-Control', 'private, max-age=3600');
    notModifiedHeaders.set('X-Content-Type-Options', 'nosniff');
    notModifiedHeaders.set('Content-Security-Policy', "script-src 'none'");
    return new Response(null, { status: 304, headers: notModifiedHeaders });
  }

  return new Response(r2Object.body, { status: 200, headers });
}
