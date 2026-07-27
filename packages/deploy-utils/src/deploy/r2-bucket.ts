/**
 * Local file-storage "bucket" provisioning.
 *
 * Self-hosted single-container replacement for Cloudflare R2 bucket
 * provisioning. Each per-app files bucket is just a directory at
 * `<EXEPAD_DATA_DIR>/buckets/{bucketName}`; the runtime binds `env.R2_FILES`
 * to an `FsStorageAdapter` rooted there. Kept separate from the config-cache
 * storage root so app-files never leak into `CONFIG_CACHE` listings.
 *
 * Public signatures are unchanged from the REST era.
 */

import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DeploymentConfig, R2BucketInfo } from './types';

/** Absolute directory backing a named bucket. */
export function bucketDir(bucketName: string): string {
  return join(process.env.EXEPAD_DATA_DIR ?? '/data', 'buckets', bucketName);
}

function infoFor(bucketName: string, dir: string): R2BucketInfo {
  let creation_date = new Date().toISOString();
  try {
    creation_date = statSync(dir).birthtime.toISOString();
  } catch {
    /* not yet stat-able */
  }
  return { name: bucketName, creation_date };
}

/** Get a bucket by name, or null if its directory doesn't exist. */
export async function getR2Bucket(
  _config: DeploymentConfig,
  bucketName: string,
): Promise<R2BucketInfo | null> {
  const dir = bucketDir(bucketName);
  return existsSync(dir) && statSync(dir).isDirectory() ? infoFor(bucketName, dir) : null;
}

/** Create a bucket directory. */
export async function createR2Bucket(
  _config: DeploymentConfig,
  bucketName: string,
): Promise<R2BucketInfo> {
  const dir = bucketDir(bucketName);
  mkdirSync(dir, { recursive: true });
  return infoFor(bucketName, dir);
}

/** Get or create a bucket directory (idempotent). */
export async function provisionR2Bucket(
  _config: DeploymentConfig,
  bucketName: string,
): Promise<R2BucketInfo> {
  const dir = bucketDir(bucketName);
  mkdirSync(dir, { recursive: true });
  return infoFor(bucketName, dir);
}

/**
 * Delete a bucket directory and everything under it.
 * Returns true if the bucket existed, false otherwise.
 */
export async function deleteR2Bucket(
  _config: DeploymentConfig,
  bucketName: string,
): Promise<boolean> {
  const dir = bucketDir(bucketName);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
