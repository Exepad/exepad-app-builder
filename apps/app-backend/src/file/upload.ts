/**
 * File upload handler (sys_file_upload)
 *
 * Processes multipart/form-data uploads:
 * 1. Parse multipart body via Request.formData() (native in Workers)
 * 2. Validate MIME type, magic bytes, file size
 * 3. Check quota limits
 * 4. Store to R2 with server-generated key
 * 5. Record metadata in D1 _files table
 * 6. Return file metadata JSON
 */

import type { Env } from '../types/env';
import type { InjectedProps } from '@exepad/types';
import type { UserContext } from '../rpc/types';
import { WorkerError, UnauthorizedError } from '../utils/errors';
import {
  validateMimeType,
  verifyMagicBytes,
  sanitizeFilename,
  sanitizeSvg,
  normalizeMimeType,
} from './validation';
import { buildR2Key, buildFileUrl } from './keys';
import { checkFileAccess } from './access';
import { checkUploadQuota } from './quota';

/** Default max file size: 10 MB */
const DEFAULT_MAX_FILE_SIZE = 10_485_760;

/**
 * Handle a file upload request.
 *
 * This function is called directly from the worker entry point for
 * POST /files/upload requests (multipart/form-data). It returns a
 * complete Response (not an RpcResponse) since it bypasses the RPC layer.
 */
export async function handleFileUpload(
  request: Request,
  user: UserContext,
  config: InjectedProps,
  env: Env,
): Promise<Response> {
  const storage = config.storage!;

  // Auth check. Uploads always require an authenticated user — the _files
  // table owner_id column is NOT NULL and per-user quota / access control
  // depends on a real owner.
  if (!user.isAuthenticated) {
    throw new UnauthorizedError('Authentication required to upload files');
  }
  checkFileAccess(user, storage, 'upload');
  const ownerId = user.id;

  // Validate R2 binding exists
  if (!env.R2_FILES) {
    throw new WorkerError(
      'INTERNAL_ERROR',
      'File storage is not configured (R2_FILES binding missing)',
      500
    );
  }

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new WorkerError(
      'INVALID_REQUEST',
      'Failed to parse multipart form data. Ensure Content-Type is multipart/form-data.',
      400
    );
  }

  const file = formData.get('file') as unknown as {
    name: string;
    type: string;
    size: number;
    arrayBuffer(): Promise<ArrayBuffer>;
    stream(): ReadableStream;
  } | null;
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
    throw new WorkerError(
      'INVALID_REQUEST',
      'Missing "file" field in multipart form data',
      400
    );
  }

  // Read optional metadata fields from form data
  const requestedVisibility = (formData.get('visibility') as string) || 'private';
  if (!['private', 'shared', 'public'].includes(requestedVisibility)) {
    throw new WorkerError('INVALID_REQUEST', 'Invalid visibility value', 400);
  }
  const visibility = requestedVisibility;
  const modelName = formData.get('model_name') as string | null;
  const recordId = formData.get('record_id') as string | null;
  const fieldName = formData.get('field_name') as string | null;

  // Validate file size
  const maxSize = storage.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  if (file.size > maxSize) {
    const maxMB = (maxSize / 1024 / 1024).toFixed(1);
    throw new WorkerError(
      'INVALID_REQUEST',
      `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is ${maxMB} MB.`,
      413
    );
  }

  if (file.size === 0) {
    throw new WorkerError('INVALID_REQUEST', 'File is empty', 400);
  }

  // Read file bytes for magic byte verification
  const fileBytes = new Uint8Array(await file.arrayBuffer());

  // Validate MIME type
  const contentType = file.type || 'application/octet-stream';
  const mimeError = validateMimeType(contentType, storage.allowedMimeTypes, storage.allowSvg);
  if (mimeError) {
    throw new WorkerError('INVALID_REQUEST', mimeError, 400);
  }

  // Verify magic bytes match declared MIME type
  if (!verifyMagicBytes(contentType, fileBytes)) {
    throw new WorkerError(
      'INVALID_REQUEST',
      `File content does not match declared type '${contentType}'. The file may be corrupted or mislabeled.`,
      400
    );
  }

  // Sanitize SVG content before storage (defense-in-depth)
  let storageBytes: Uint8Array = fileBytes;
  const normalizedContentType = normalizeMimeType(contentType);
  if (normalizedContentType === 'image/svg+xml') {
    const svgText = new TextDecoder().decode(fileBytes);
    const sanitized = sanitizeSvg(svgText);
    storageBytes = new TextEncoder().encode(sanitized);
  }

  // Check quota
  const quotaResult = await checkUploadQuota(
    env.DB,
    env.APP_ID,
    ownerId,
    file.size,
    storage,
  );
  if (!quotaResult.allowed) {
    throw new WorkerError('INVALID_REQUEST', quotaResult.reason!, 429);
  }

  // Generate file ID and R2 key
  const fileId = crypto.randomUUID();
  const safeName = sanitizeFilename(file.name || 'unnamed');
  const r2Key = buildR2Key(ownerId, fileId, safeName);

  // Store to R2
  try {
    await env.R2_FILES.put(r2Key, storageBytes, {
      httpMetadata: { contentType },
      customMetadata: {
        ownerId,
        appId: env.APP_ID,
        fileId,
      },
    });
  } catch (error) {
    console.error(`[file-upload] R2 put failed for ${r2Key}:`, error);
    throw new WorkerError('INTERNAL_ERROR', 'Failed to store file', 500);
  }

  // Record in D1
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO _files (id, owner_id, app_id, filename, content_type, size_bytes, r2_key, visibility, model_name, record_id, field_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        fileId,
        ownerId,
        env.APP_ID,
        safeName,
        contentType,
        storageBytes.byteLength,
        r2Key,
        visibility,
        modelName,
        recordId,
        fieldName,
        now,
        now,
      )
      .run();
  } catch (error) {
    // Cleanup R2 on D1 failure
    console.error(`[file-upload] D1 insert failed for ${fileId}, cleaning up R2:`, error);
    await env.R2_FILES.delete(r2Key).catch(() => {});
    throw new WorkerError('INTERNAL_ERROR', 'Failed to record file metadata', 500);
  }

  // Build response
  const url = buildFileUrl(env.APP_ID, fileId, safeName);
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        id: fileId,
        url,
        filename: safeName,
        size: storageBytes.byteLength,
        contentType,
        visibility,
        createdAt: now,
      },
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
