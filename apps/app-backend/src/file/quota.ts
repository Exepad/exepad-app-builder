/**
 * File storage quota checks
 *
 * Queries the _files table to enforce per-user and per-app storage limits.
 */

import type { StorageProps } from '@exepad/types';

/** Default quota limits */
const DEFAULTS = {
  maxFilesPerUser: 1000,
  maxStoragePerUser: 524_288_000,  // 500 MB
  maxStoragePerApp: 5_368_709_120, // 5 GB
} as const;

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  usage: {
    userFileCount: number;
    userStorageBytes: number;
    appStorageBytes: number;
  };
}

/**
 * Check if a new file upload would exceed quota limits.
 *
 * Queries _files for current usage (excluding soft-deleted files).
 */
export async function checkUploadQuota(
  db: D1Database,
  appId: string,
  ownerId: string,
  newFileSize: number,
  storage: StorageProps,
): Promise<QuotaCheckResult> {
  // Query user-level usage
  const userUsage = await db
    .prepare(
      `SELECT COUNT(*) as file_count, COALESCE(SUM(size_bytes), 0) as total_bytes
       FROM _files
       WHERE owner_id = ? AND app_id = ? AND deleted_at IS NULL`
    )
    .bind(ownerId, appId)
    .first<{ file_count: number; total_bytes: number }>();

  const userFileCount = userUsage?.file_count ?? 0;
  const userStorageBytes = userUsage?.total_bytes ?? 0;

  // Query app-level storage
  const appUsage = await db
    .prepare(
      `SELECT COALESCE(SUM(size_bytes), 0) as total_bytes
       FROM _files
       WHERE app_id = ? AND deleted_at IS NULL`
    )
    .bind(appId)
    .first<{ total_bytes: number }>();

  const appStorageBytes = appUsage?.total_bytes ?? 0;

  const usage = { userFileCount, userStorageBytes, appStorageBytes };

  // Check per-user file count limit
  const maxFiles = storage.maxFilesPerUser ?? DEFAULTS.maxFilesPerUser;
  if (userFileCount >= maxFiles) {
    return {
      allowed: false,
      reason: `Per-user file limit reached (${maxFiles} files). Delete some files to upload more.`,
      usage,
    };
  }

  // Check per-user storage limit
  const maxUserStorage = storage.maxStoragePerUser ?? DEFAULTS.maxStoragePerUser;
  if (userStorageBytes + newFileSize > maxUserStorage) {
    const usedMB = (userStorageBytes / 1024 / 1024).toFixed(1);
    const limitMB = (maxUserStorage / 1024 / 1024).toFixed(0);
    return {
      allowed: false,
      reason: `Per-user storage limit exceeded (${usedMB} MB / ${limitMB} MB). Delete files to free space.`,
      usage,
    };
  }

  // Check per-app storage limit
  const maxAppStorage = storage.maxStoragePerApp ?? DEFAULTS.maxStoragePerApp;
  if (appStorageBytes + newFileSize > maxAppStorage) {
    return {
      allowed: false,
      reason: 'App storage limit exceeded. Contact the app administrator.',
      usage,
    };
  }

  return { allowed: true, usage };
}
