/**
 * File access control
 *
 * Enforces FilePolicyProps auth levels and owner_id scoping for file operations.
 */

import type { StorageProps, FilePolicyProps, AccessLevel } from '@exepad/types';
import type { UserContext } from '../rpc/types';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';

/** File record from the _files table */
export interface FileRecord {
  id: string;
  owner_id: string;
  app_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  r2_key: string;
  visibility: 'private' | 'shared' | 'public';
  model_name?: string | null;
  record_id?: string | null;
  field_name?: string | null;
  metadata?: string | null;
  thumbnail_r2_key?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

type FileOperation = 'upload' | 'download' | 'delete' | 'list';

/**
 * Check if a user is allowed to perform a file operation.
 *
 * For download/delete on specific files, also checks owner_id scoping.
 * For upload/list, only checks the FilePolicyProps auth level.
 */
export function checkFileAccess(
  user: UserContext,
  storage: StorageProps,
  operation: FileOperation,
  file?: FileRecord,
): void {
  const policy = storage.filePolicy || {};
  const level: AccessLevel = policy[operation] || 'authenticated';

  // Public access — the operation itself is open to anyone (e.g. a public CDN
  // app). But app-level public access must NOT override a per-file privacy
  // choice: a file the owner explicitly uploaded `visibility: 'private'` stays
  // owner-only even here. Without this, publicAccess / download:'public' served
  // private files to any unauthenticated caller.
  if (level === 'public' || storage.publicAccess) {
    // Write operations still require auth even for public-access apps
    if (operation === 'upload' || operation === 'delete') {
      if (!user.isAuthenticated) {
        throw new UnauthorizedError('Authentication required for write operations');
      }
    }
    // For a specific file:
    //  - delete is an ownership action — 'shared'/'public' visibility grants READ,
    //    never the right to remove another user's file, so always owner-gate it.
    //  - download of a 'private' file stays owner-gated even under public access
    //    (per-file privacy overrides the app-level flag). Public/shared downloads
    //    remain open.
    if (file) {
      if (operation === 'delete') {
        checkFileOwnership(user, file, 'delete');
      } else if (operation === 'download' && file.visibility === 'private') {
        checkFileOwnership(user, file, 'download');
      }
    }
    return;
  }

  // All non-public operations require authentication
  if (!user.isAuthenticated) {
    throw new UnauthorizedError('Authentication required');
  }

  if (level === 'authenticated') {
    // Authenticated — check ownership for file-specific operations
    if (file && operation !== 'list') {
      checkFileOwnership(user, file, operation);
    }
    return;
  }

  // 'owner' — same as 'authenticated' but always enforce ownership
  if (level === 'owner') {
    if (file && operation !== 'list') {
      checkFileOwnership(user, file, operation);
    }
    return;
  }

  // Role-based access
  if (level.startsWith('role:')) {
    const requiredRole = level.slice(5);
    if (!user.roles.includes(requiredRole)) {
      throw new ForbiddenError(`Role '${requiredRole}' required`);
    }
    return;
  }

  // 'none' — permanently blocked
  if (level === 'none') {
    throw new ForbiddenError('This operation is disabled');
  }
}

/**
 * Check that the current user owns the file, or the file has appropriate visibility.
 *
 * Visibility levels (READ semantics):
 * - 'private': only the owner can access
 * - 'shared': any authenticated user in the same app can access
 * - 'public': anyone can access (including unauthenticated)
 *
 * Visibility governs READ (download) only. Deletion is an ownership action:
 * 'shared'/'public' grant other users the right to *view* a file, never to
 * *remove* it — so a delete always requires the owner (or an admin), whatever
 * the visibility or app public-access flag. Without this, any authenticated user
 * could delete another user's shared file.
 */
function checkFileOwnership(user: UserContext, file: FileRecord, operation: FileOperation): void {
  const isOwnerOrAdmin = file.owner_id === user.id || user.roles.includes('admin');

  if (operation === 'delete') {
    if (!isOwnerOrAdmin) {
      throw new ForbiddenError('Access denied — you do not own this file');
    }
    return;
  }

  // Read (download) — visibility-based access.
  // Public files are accessible to anyone
  if (file.visibility === 'public') return;

  // Shared files are accessible to any authenticated user
  if (file.visibility === 'shared' && user.isAuthenticated) return;

  // Private files require owner match (or admin role)
  if (!isOwnerOrAdmin) {
    throw new ForbiddenError('Access denied — you do not own this file');
  }
}
