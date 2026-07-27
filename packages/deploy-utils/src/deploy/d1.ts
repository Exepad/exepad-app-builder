/**
 * Local SQLite database provisioning + execution.
 *
 * Self-hosted single-container replacement for the old Cloudflare D1 REST API.
 * Each app+mode is one SQLite file at `<EXEPAD_DATA_DIR>/apps/{appId}/{mode}.sqlite`
 * (the same path the runtime opens for `env.DB`). `dbId` throughout the deploy
 * pipeline is that absolute file path; the execute helpers resolve it to the
 * shared pooled `better-sqlite3` handle and run SQL directly.
 *
 * Public signatures are unchanged from the REST era so callers (the deploy
 * pipeline, deprovision, admin, diagnostics) are untouched — only the bodies
 * are local now.
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { appDbPath, openDbCached, closeDbAt, type AppMode } from '@exepad/local-adapters/db';
import type { DeploymentConfig, D1DatabaseInfo } from './types';
import { executeLocalDDL, executeLocalQuery, executeLocalBatch } from './d1-local';

/** Base directory holding every app's SQLite files. */
function appsBaseDir(): string {
  return join(process.env.EXEPAD_DATA_DIR ?? '/data', 'apps');
}

/** Derive the canonical D1 database name for an app+mode. */
function dbNameFor(appId: string, mode: AppMode): string {
  return mode === 'preview' ? `exepad-preview-${appId}` : `exepad-${appId}`;
}

/** Parse a legacy D1 database name back into {appId, mode}. */
function parseDbName(dbName: string): { appId: string; mode: AppMode } {
  if (dbName.startsWith('exepad-preview-')) {
    return { appId: dbName.slice('exepad-preview-'.length), mode: 'preview' };
  }
  if (dbName.startsWith('exepad-')) {
    return { appId: dbName.slice('exepad-'.length), mode: 'published' };
  }
  // Unknown pattern — treat the whole string as the app id, published mode.
  return { appId: dbName, mode: 'published' };
}

function infoFor(path: string, name: string): D1DatabaseInfo {
  let createdAt = new Date().toISOString();
  try {
    createdAt = statSync(path).birthtime.toISOString();
  } catch {
    /* file not yet stat-able */
  }
  return { uuid: path, name, accountId: 'local', createdAt };
}

/**
 * List all provisioned app databases by scanning the data directory.
 * Optionally filter by exact database name. Used by deprovision GC.
 */
export async function listD1Databases(
  _config: DeploymentConfig,
  options?: { name?: string },
): Promise<D1DatabaseInfo[]> {
  const base = appsBaseDir();
  const out: D1DatabaseInfo[] = [];
  let appDirs: string[];
  try {
    appDirs = readdirSync(base);
  } catch {
    return [];
  }
  for (const appId of appDirs) {
    for (const mode of ['published', 'preview'] as AppMode[]) {
      const path = appDbPath(appId, mode);
      if (!existsSync(path)) continue;
      const name = dbNameFor(appId, mode);
      if (options?.name && options.name !== name) continue;
      out.push(infoFor(path, name));
    }
  }
  return out;
}

/** Get a provisioned database by name, or null if it doesn't exist yet. */
export async function getD1Database(
  _config: DeploymentConfig,
  dbName: string,
): Promise<D1DatabaseInfo | null> {
  const { appId, mode } = parseDbName(dbName);
  const path = appDbPath(appId, mode);
  return existsSync(path) ? infoFor(path, dbName) : null;
}

/** Create (open) the SQLite file for a database name. */
export async function createD1Database(
  _config: DeploymentConfig,
  dbName: string,
): Promise<D1DatabaseInfo> {
  const { appId, mode } = parseDbName(dbName);
  const path = appDbPath(appId, mode);
  openDbCached(path); // creates the file (+ parent dir) if missing
  return infoFor(path, dbName);
}

/** Delete a database file (and its WAL/SHM sidecars). `dbId` is the file path. */
export async function deleteD1Database(_config: DeploymentConfig, dbId: string): Promise<void> {
  closeDbAt(dbId);
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(dbId + suffix, { force: true });
  }
  // Remove the now-empty per-app directory so a deprovisioned app leaves no
  // trace under <DATA_DIR>/apps/{appId}/. Best-effort and only when empty — the
  // sibling mode's DB may still live here (this runs once per mode), so the dir
  // is removed by whichever delete clears the last file.
  try {
    const dir = dirname(dbId);
    if (existsSync(dir) && readdirSync(dir).length === 0) {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Execute DDL/setup SQL (migrations, system tables, seed inserts).
 * Single statement → rows for SELECT/PRAGMA, otherwise change counts.
 * Multi-statement string → run atomically (no result rows).
 */
export async function executeD1DDL(
  _config: DeploymentConfig,
  dbId: string,
  sql: string,
): Promise<{ success: boolean; results: unknown[] }> {
  const r = executeLocalDDL(openDbCached(dbId), sql);
  return { success: r.success, results: r.results };
}

/** Get or create the SQLite file for this app+mode. */
export async function provisionD1Database(config: DeploymentConfig): Promise<D1DatabaseInfo> {
  const dbName = config.d1NamingPattern
    ? config.d1NamingPattern.replace('{appId}', config.appId)
    : `exepad-${config.appId}`;
  // Mode is explicit on the config when known; otherwise inferred from the name.
  const mode: AppMode = config.mode ?? (dbName.startsWith('exepad-preview-') ? 'preview' : 'published');
  const path = appDbPath(config.appId, mode);
  openDbCached(path); // creates the file (+ parent dir) if missing
  return infoFor(path, dbName);
}

/** Execute a single parameterized query (`?` placeholders). */
export async function executeD1Query(
  _config: DeploymentConfig,
  dbId: string,
  sql: string,
  params: (string | number | null)[] = [],
): Promise<{ success: boolean; results: unknown[]; meta?: unknown }> {
  const r = executeLocalQuery(openDbCached(dbId), sql, params);
  return { success: r.success, results: r.results, meta: r.meta };
}

/** Execute multiple DDL statements atomically in a single transaction. */
export async function executeD1DDLBatch(
  _config: DeploymentConfig,
  dbId: string,
  statements: string[],
): Promise<{ success: boolean; results: unknown[] }> {
  if (statements.length === 0) return { success: true, results: [] };
  if (statements.length === 1) return executeD1DDL(_config, dbId, statements[0]);
  const r = executeLocalBatch(openDbCached(dbId), statements);
  return { success: r.success, results: r.results };
}
