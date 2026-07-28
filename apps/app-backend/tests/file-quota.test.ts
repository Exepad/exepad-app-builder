/**
 * Tests for file storage quota checks
 */

import { describe, it, expect } from 'vitest';
import { checkUploadQuota, type QuotaCheckResult } from '../src/file/quota';
import { createMockD1 } from './helpers/mock-d1';
import type { StorageProps } from '@exepad/types';

function makeStorage(overrides?: Partial<StorageProps>): StorageProps {
  return { enabled: true, ...overrides };
}

function setupDb(userCount: number, userBytes: number, appBytes: number) {
  const results = new Map<string, Record<string, unknown>[]>();
  // User-level query (first query with owner_id)
  results.set('owner_id', [{ file_count: userCount, total_bytes: userBytes }]);
  // App-level query (second query without owner_id, just app_id and SUM)
  results.set('WHERE app_id', [{ total_bytes: appBytes }]);
  return createMockD1({ results });
}

describe('checkUploadQuota', () => {
  const storage = makeStorage();

  it('allows upload when all limits pass', async () => {
    const db = setupDb(5, 1024, 2048);
    const result = await checkUploadQuota(db, 'app-1', 'user-1', 1000, storage);

    expect(result.allowed).toBe(true);
    expect(result.usage.userFileCount).toBe(5);
    expect(result.usage.userStorageBytes).toBe(1024);
    expect(result.usage.appStorageBytes).toBe(2048);
  });

  it('rejects when file count limit is reached', async () => {
    const db = setupDb(1000, 1024, 2048); // Default limit is 1000
    const result = await checkUploadQuota(db, 'app-1', 'user-1', 100, storage);

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/file limit/i);
  });

  it('rejects when user storage limit exceeded', async () => {
    // Default user limit: 500 MB (524_288_000)
    const db = setupDb(5, 524_288_000, 524_288_000);
    const result = await checkUploadQuota(db, 'app-1', 'user-1', 1000, storage);

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/storage limit exceeded/i);
  });

  it('rejects when app storage limit exceeded', async () => {
    // Default app limit: 5 GB (5_368_709_120)
    const db = setupDb(5, 1024, 5_368_709_120);
    const result = await checkUploadQuota(db, 'app-1', 'user-1', 1000, storage);

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/app storage limit/i);
  });

  it('uses custom limits from StorageProps', async () => {
    const customStorage = makeStorage({
      maxFilesPerUser: 3,
      maxStoragePerUser: 1024 * 1024, // 1 MB
      maxStoragePerApp: 10 * 1024 * 1024, // 10 MB
    });

    // 3 files — at limit
    const db = setupDb(3, 100, 200);
    const result = await checkUploadQuota(db, 'app-1', 'user-1', 100, customStorage);

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/file limit.*3 files/);
  });

  it('allows upload just under user storage limit', async () => {
    const customStorage = makeStorage({ maxStoragePerUser: 10000 });
    const db = setupDb(1, 9000, 9000);
    const result = await checkUploadQuota(db, 'app-1', 'user-1', 999, customStorage);

    expect(result.allowed).toBe(true);
  });

  it('rejects upload that would push over user storage limit', async () => {
    const customStorage = makeStorage({ maxStoragePerUser: 10000 });
    const db = setupDb(1, 9000, 9000);
    const result = await checkUploadQuota(db, 'app-1', 'user-1', 1001, customStorage);

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/storage limit exceeded/i);
  });

  it('handles null/empty DB results gracefully', async () => {
    const db = createMockD1({ firstReturnsNull: true });
    const result = await checkUploadQuota(db, 'app-1', 'user-1', 100, storage);

    // All defaults to 0 — should allow
    expect(result.allowed).toBe(true);
    expect(result.usage.userFileCount).toBe(0);
    expect(result.usage.userStorageBytes).toBe(0);
    expect(result.usage.appStorageBytes).toBe(0);
  });
});
