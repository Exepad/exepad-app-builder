/**
 * Shared "published app data" packer for the export builders.
 *
 * Both the deployable bundle (D1) and the standalone project's vendored backend
 * (D2/K3) ship the SAME runnable data artifact: the app's published storage
 * subtree + its data DB. This packs that tree under an arbitrary zip `prefix`
 * (`data/` for D1, `server/data/` for D2) so the two builders stay in lockstep.
 *
 * Faithfulness: the storage subtree is copied verbatim from disk INCLUDING
 * `.exemeta` sidecars; the DB is an ONLINE better-sqlite3 backup (a consistent
 * single `.sqlite`, no `-wal`/`-shm`). No meta.sqlite / operator account is ever
 * included — a shipped app has no studio surface and no platform registry.
 */
import { readFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openAppDb } from '@exepad/local-adapters';
import { bucketDir } from '@exepad/deploy-utils';

export type AddFile = (path: string, bytes: Uint8Array) => void;

function dataDir(): string {
  return process.env.EXEPAD_DATA_DIR ?? '/data';
}

/** Recursively add every file under `absDir` to the zip at `zipPrefix`. */
function walk(absDir: string, zipPrefix: string, add: AddFile): void {
  for (const name of readdirSync(absDir)) {
    const abs = join(absDir, name);
    const st = statSync(abs);
    const zipRel = `${zipPrefix}${name}`;
    if (st.isDirectory()) walk(abs, `${zipRel}/`, add);
    else if (st.isFile()) add(zipRel, new Uint8Array(readFileSync(abs)));
  }
}

/** Online-backup the app's published DB to a consistent single `.sqlite` file. */
async function backupPublishedDb(appId: string): Promise<Uint8Array> {
  const db = openAppDb(appId, 'published'); // pooled handle — the one the server uses
  const dest = join(tmpdir(), `exepad-export-${appId}-${Date.now()}.sqlite`);
  try {
    await db.backup(dest);
    return new Uint8Array(readFileSync(dest));
  } finally {
    for (const f of [dest, `${dest}-wal`, `${dest}-shm`]) {
      try {
        rmSync(f, { force: true });
      } catch {
        /* best-effort temp cleanup */
      }
    }
  }
}

/** Best-effort app name from the published config (via the status pointer). */
export function publishedAppName(appId: string): string | null {
  const appStorageDir = join(dataDir(), 'storage', appId);
  const statusPath = join(appStorageDir, 'deployment-status-published.json');
  if (!existsSync(statusPath)) return null;
  try {
    const status = JSON.parse(readFileSync(statusPath, 'utf8')) as { configPath?: string };
    const cfgAbs = join(appStorageDir, status.configPath || 'published/app-config.json');
    if (existsSync(cfgAbs)) {
      const c = JSON.parse(readFileSync(cfgAbs, 'utf8')) as { name?: string };
      return c?.name?.trim() || 'app';
    }
  } catch {
    /* fall through */
  }
  return 'app';
}

/**
 * Pack the app's published serving set (storage subtree + status pointer + DB +
 * uploaded files) under `prefix`. Returns false if the app has no published
 * deployment (the caller maps that to a 404). The data layout under `prefix` is
 * `storage/{appId}/published/**`, `apps/{appId}/published.sqlite`, and
 * `buckets/exepad-files-{appId}/**` — i.e. an EXEPAD_DATA_DIR the runtime can
 * serve verbatim.
 */
export async function packPublishedAppData(
  add: AddFile,
  appId: string,
  prefix: string,
): Promise<boolean> {
  const root = dataDir();
  const appStorageDir = join(root, 'storage', appId);
  const statusPath = join(appStorageDir, 'deployment-status-published.json');
  if (!existsSync(statusPath)) return false;

  // Published storage subtree (compiled JS/CSS, releases, seo, prerender, seed).
  // Studio-only artifacts (preview/, compiled/, code/, versions/, chat-history,
  // thumbnail) live outside published/ and are deliberately excluded.
  const publishedDir = join(appStorageDir, 'published');
  if (existsSync(publishedDir)) walk(publishedDir, `${prefix}storage/${appId}/published/`, add);

  add(`${prefix}storage/${appId}/deployment-status-published.json`, new Uint8Array(readFileSync(statusPath)));
  const statusMeta = `${statusPath}.exemeta`;
  if (existsSync(statusMeta)) {
    add(`${prefix}storage/${appId}/deployment-status-published.json.exemeta`, new Uint8Array(readFileSync(statusMeta)));
  }

  // The app's data DB (consistent online backup).
  add(`${prefix}apps/${appId}/published.sqlite`, await backupPublishedDb(appId));

  // Per-app uploaded files bucket, if any.
  const filesBucket = bucketDir(`exepad-files-${appId}`);
  if (existsSync(filesBucket)) walk(filesBucket, `${prefix}buckets/exepad-files-${appId}/`, add);

  return true;
}
