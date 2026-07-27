/**
 * Deployment Versioning
 *
 * Stores deployment snapshots in a `_exepad_meta` table within the app's D1 database.
 * This enables rollback by preserving the previous schema state before each deployment.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { openDbCached, closeDbAt } from '@exepad/local-adapters/db';
import type { DeploymentConfig } from './types';
import type { ExistingTable } from '../schema/types';
import type { ModelProps } from '@exepad/types';
import { executeD1DDL, executeD1Query } from './d1';
import { introspectTableREST } from './d1-introspect';

/**
 * Ensure the `_exepad_meta` table exists for storing deployment metadata.
 */
async function ensureMetaTable(config: DeploymentConfig, dbId: string): Promise<void> {
  await executeD1DDL(
    config,
    dbId,
    `CREATE TABLE IF NOT EXISTS "_exepad_meta" (
      "key" TEXT PRIMARY KEY,
      "value" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL
    )`
  );
}

/**
 * Set a key-value pair in the meta table.
 */
async function setMeta(
  config: DeploymentConfig,
  dbId: string,
  key: string,
  value: string
): Promise<void> {
  const now = new Date().toISOString();
  await executeD1Query(
    config,
    dbId,
    `INSERT INTO "_exepad_meta" ("key", "value", "updated_at")
     VALUES (?, ?, ?)
     ON CONFLICT("key") DO UPDATE SET "value" = ?, "updated_at" = ?`,
    [key, value, now, value, now]
  );
}

/**
 * Get a value from the meta table.
 */
async function getMeta(
  config: DeploymentConfig,
  dbId: string,
  key: string
): Promise<string | null> {
  try {
    const result = await executeD1Query(
      config,
      dbId,
      `SELECT "value" FROM "_exepad_meta" WHERE "key" = ?`,
      [key]
    );
    if (result.results && result.results.length > 0) {
      return (result.results[0] as Record<string, unknown>).value as string;
    }
    return null;
  } catch {
    // Table might not exist yet
    return null;
  }
}

/**
 * Save a deployment snapshot — introspects current schema and stores it in meta.
 * Call this BEFORE applying new migrations so we have a restore point.
 *
 * NOTE: this "restore point" is the introspected column/index STRUCTURE only —
 * it holds no row data, so reverse-DDL rollback (rollback.ts) can drop added
 * columns/tables but can never restore a destructive change's lost rows. The
 * byte-level companion to this — {@link backupAppDatabase} (`VACUUM INTO` on the
 * pooled handle, pruned by {@link pruneAppDatabaseBackups}) — makes destructive
 * migrations fully recoverable, and the deploy pipeline prefers restoring it
 * over reverse-DDL when a destructive migration fails.
 */
export async function saveDeploymentSnapshot(
  config: DeploymentConfig,
  dbId: string,
  models: ModelProps[]
): Promise<string> {
  await ensureMetaTable(config, dbId);

  // Introspect current state of all model tables
  const existingTables: ExistingTable[] = [];
  for (const model of models) {
    const table = await introspectTableREST(config, dbId, model.name);
    if (table) {
      existingTables.push(table);
    }
  }

  const version = new Date().toISOString();
  const snapshot = JSON.stringify(existingTables);

  await setMeta(config, dbId, 'previous_schema', snapshot);
  await setMeta(config, dbId, 'schema_version', version);

  return version;
}

/**
 * Get the previous schema snapshot stored before the last deployment.
 */
export async function getPreviousSchema(
  config: DeploymentConfig,
  dbId: string
): Promise<ExistingTable[] | null> {
  const snapshot = await getMeta(config, dbId, 'previous_schema');
  if (!snapshot) return null;

  try {
    return JSON.parse(snapshot) as ExistingTable[];
  } catch {
    return null;
  }
}

/**
 * Get the current schema version timestamp.
 */
export async function getSchemaVersion(
  config: DeploymentConfig,
  dbId: string
): Promise<string | null> {
  return getMeta(config, dbId, 'schema_version');
}

// ─── Byte-level pre-migration backups ───────────────────────────────────────
//
// `dbId` throughout the local deploy pipeline is the ABSOLUTE path of the app's
// SQLite file (`<DATA_DIR>/apps/{appId}/{mode}.sqlite`). Backups live alongside
// it under `.../apps/{appId}/backups/` so they share the app's storage volume
// and are removed when the app is deprovisioned.

/** Sub-directory (under the app's DB dir) that holds pre-migration backups. */
const BACKUP_SUBDIR = 'backups';

/**
 * How many byte-level pre-migration backups to retain per app+mode. Mirrors the
 * published-release retention (KEEP_PUBLISHED_RELEASES) so a long-lived app
 * can't accumulate unbounded snapshots and exhaust the /data volume.
 */
export const KEEP_DB_BACKUPS = 5;

export interface DbBackupResult {
  /** Absolute path of the written backup file. */
  path: string;
  /** Size of the backup file in bytes (0 if it couldn't be stat-ed). */
  bytes: number;
}

/** The backups directory + the `{mode}` filename stem for a given app DB path. */
function backupLocation(dbId: string): { dir: string; stem: string } {
  return {
    dir: join(dirname(dbId), BACKUP_SUBDIR),
    stem: basename(dbId).replace(/\.sqlite$/i, ''),
  };
}

/**
 * Take a byte-level, point-in-time backup of the app database via `VACUUM INTO`
 * on the pooled better-sqlite3 handle (the SAME handle the runtime binds to
 * `env.DB`, so the copy reflects every committed write, including WAL). Unlike
 * the structure-only {@link saveDeploymentSnapshot}, this preserves ROW DATA, so
 * a destructive migration can be fully reverted by restoring it.
 *
 * Call BEFORE applying a migration that runs any statements. `VACUUM INTO`
 * cannot run inside a transaction; the pooled handle is not mid-transaction at
 * this point in the deploy pipeline.
 *
 * @param dbId absolute path of the app SQLite file.
 * @param label optional tag folded into the filename (e.g. the correlationId).
 */
export async function backupAppDatabase(dbId: string, label?: string): Promise<DbBackupResult> {
  const { dir, stem } = backupLocation(dbId);
  mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tag = label ? `-${label.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40)}` : '';
  const dest = join(dir, `${stem}-${stamp}${tag}.sqlite`);

  const db = openDbCached(dbId);
  // Single-quote the destination for the SQL literal; `''` escapes any quote.
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);

  let bytes = 0;
  try {
    bytes = statSync(dest).size;
  } catch {
    /* best-effort size */
  }
  return { path: dest, bytes };
}

/**
 * List this app+mode's backup files, oldest first. Filenames start with the
 * `{mode}-<ISO timestamp>` stem, so a lexicographic sort is chronological.
 */
export function listAppDatabaseBackups(dbId: string): string[] {
  const { dir, stem } = backupLocation(dbId);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.startsWith(`${stem}-`) && f.endsWith('.sqlite'))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Delete this app+mode's backups beyond the newest {@link KEEP_DB_BACKUPS}.
 * Returns the paths that were pruned. Best-effort — a failed unlink is ignored.
 */
export function pruneAppDatabaseBackups(dbId: string, keep: number = KEEP_DB_BACKUPS): string[] {
  const all = listAppDatabaseBackups(dbId);
  const stale = all.slice(0, Math.max(0, all.length - keep));
  for (const p of stale) {
    try {
      rmSync(p, { force: true });
    } catch {
      /* best-effort */
    }
  }
  return stale;
}

/**
 * Restore the app database from a byte-level backup produced by
 * {@link backupAppDatabase}. This fully reverts BOTH schema and row data — the
 * only way to undo a destructive migration's data loss (reverse-DDL cannot).
 *
 * The pooled handle is closed, the backup file is copied over the live DB, its
 * stale `-wal`/`-shm` sidecars are removed, and the next caller re-opens a fresh
 * handle (WAL is re-enabled on open). `VACUUM INTO` output is a standalone,
 * fully-checkpointed database file, so a plain file copy is a correct restore.
 */
export async function restoreAppDatabase(dbId: string, backupPath: string): Promise<void> {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }
  // Drop the pooled handle so no connection holds the live file mid-overwrite.
  closeDbAt(dbId);
  copyFileSync(backupPath, dbId);
  // Clear WAL/SHM sidecars left by the previous handle — they belong to the
  // now-replaced database and would otherwise be replayed on next open.
  for (const suffix of ['-wal', '-shm']) {
    try {
      rmSync(dbId + suffix, { force: true });
    } catch {
      /* best-effort */
    }
  }
  // Re-open a fresh pooled handle (WAL + FK pragmas re-applied) so subsequent
  // callers in this process see the restored database.
  openDbCached(dbId);
}
