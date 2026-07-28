/**
 * Per-file SQLite handle registry. One better-sqlite3 connection per absolute
 * path, cached so every caller in the process — the deploy pipeline writing
 * schema/seed and the runtime dispatching CRUD — reuses the SAME handle for a
 * given app+mode and sees each other's committed writes immediately.
 *
 * App files live at `<dbDir>/{appId}/{mode}.sqlite` (mode = preview | published),
 * mirroring the old per-app D1 databases (`exepad-{appId}` / `exepad-preview-{appId}`).
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LocalD1 } from './local-d1.js';

export type AppMode = 'preview' | 'published';

/** Pool keyed by absolute file path. */
const handles = new Map<string, Database.Database>();

/** Absolute path to an app's SQLite file. `dbDir` defaults to $EXEPAD_DATA_DIR/apps. */
export function appDbPath(appId: string, mode: AppMode, dbDir?: string): string {
  const base = dbDir ?? join(process.env.EXEPAD_DATA_DIR ?? '/data', 'apps');
  return join(base, appId, `${mode}.sqlite`);
}

/**
 * Open (or reuse) the pooled better-sqlite3 handle for an absolute path.
 * Creates the parent directory and the file on first open, with WAL + FK on.
 */
export function openDbCached(path: string): Database.Database {
  const existing = handles.get(path);
  if (existing && existing.open) return existing;

  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Wait up to 5s for a lock instead of throwing SQLITE_BUSY immediately —
  // defense-in-depth for cross-process/checkpoint contention (e.g. a backup
  // tool or a stalled WAL checkpoint touching the same file).
  db.pragma('busy_timeout = 5000');
  handles.set(path, db);
  return db;
}

/** Open (or reuse) the pooled handle for an app+mode. */
export function openAppDb(appId: string, mode: AppMode, dbDir?: string): Database.Database {
  return openDbCached(appDbPath(appId, mode, dbDir));
}

/** Get a D1-compatible adapter for an app+mode (what `env.DB` is bound to). */
export function getAppD1(appId: string, mode: AppMode, dbDir?: string): LocalD1 {
  return new LocalD1(openAppDb(appId, mode, dbDir));
}

/** Close + forget the pooled handle for an absolute path. */
export function closeDbAt(path: string): void {
  const db = handles.get(path);
  if (db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    handles.delete(path);
  }
}

/** Close + forget an app's handle (used by deprovision). */
export function closeAppDb(appId: string, mode: AppMode, dbDir?: string): void {
  closeDbAt(appDbPath(appId, mode, dbDir));
}

/**
 * Open an arbitrary SQLite file UNPOOLED — the caller owns the lifecycle.
 * Use for one-off handles the caller holds for its own lifetime (e.g. a CLI
 * tool). For shared app/meta handles prefer {@link openDbCached}.
 */
export function openDb(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

/**
 * Checkpoint + close EVERY pooled handle. Call on graceful shutdown (SIGTERM)
 * so the WAL is truncated back into the main database file and no handle is left
 * mid-write — otherwise a hard container stop can leave a large `-wal` sidecar
 * that has to be recovered on next open. Best-effort per handle.
 */
export function closeAllDbs(): void {
  for (const [path, db] of handles) {
    try {
      if (db.open) {
        db.pragma('wal_checkpoint(TRUNCATE)');
        db.close();
      }
    } catch {
      /* best-effort: keep closing the rest */
    }
    handles.delete(path);
  }
}
