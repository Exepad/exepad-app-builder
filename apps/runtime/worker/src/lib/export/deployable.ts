/**
 * Deployable-bundle builder (D1): pack ONE published app into a self-contained,
 * run-ready archive the user hosts on their own VPS. The bundle pairs the
 * prebuilt runtime (server.mjs + slim SPA) with the app's published snapshot +
 * data DB, pinned via `EXEPAD_SINGLE_APP_ID`. `docker compose up` → a live app.
 *
 * Faithfulness notes:
 *  - The storage subtree is copied verbatim from disk INCLUDING `.exemeta`
 *    sidecars, so the deployed FsStorageAdapter sees a byte-identical tree.
 *  - The app DB is copied via better-sqlite3's ONLINE backup (a consistent
 *    single .sqlite with the WAL already applied) — no torn-read risk and no
 *    `-wal`/`-shm` to ship.
 *  - NO meta.sqlite / operator account is included: a deployable bundle has no
 *    studio surface (gated off in lib/single-app.ts), so it ships no platform
 *    registry and never carries the platform operator's password hash.
 *  - This bundle CONVEYS the Exepad runtime in object form (`app/server.mjs` +
 *    the compiled SPA), so AGPL §4/§5 apply: the licence + third-party notices
 *    travel at the bundle root, and the readme records which build they came
 *    from (§6 Corresponding Source).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8 } from 'fflate';
import type { Env } from '../../types/env';
import { slug, MAX_ZIP_BYTES, ExportTooLargeError } from './source-set';
import { packPublishedAppData, publishedAppName } from './app-data';
import {
  resolveServerBundle,
  resolveClientDist,
  readRootLicense,
  readRootNotice,
  exepadSourceRef,
} from './artifacts';
import * as T from './templates/deployable';

// Native/binary externals the bundled server keeps out of its bundle — MUST
// match the versions the runtime image installs (see root Dockerfile).
const BETTER_SQLITE3_VERSION = '11.8.1';
const ESBUILD_VERSION = '0.27.2';

// SPA subtrees that exist only for the studio/demo experience — never loaded
// when serving a single app. Dropped to keep the bundle slim. NOTE we KEEP
// `runtime_assets/dist/` (its sibling under the same folder): that is the runtime
// SDK bundle the compiled components import (`exepad-sdk-*.js` + react shims + icon
// chunks), so it is required to serve any app — only compiled/ + ext/ are dropped.
const CLIENT_SKIP_PREFIXES = ['example/', 'runtime_assets/compiled/', 'runtime_assets/ext/'];

function isStudioOnlyClientPath(relPath: string): boolean {
  return CLIENT_SKIP_PREFIXES.some((p) => relPath === p.replace(/\/$/, '') || relPath.startsWith(p));
}

export async function buildDeployableBundle(
  _env: Env,
  appId: string,
): Promise<{ files: Record<string, Uint8Array>; appName: string } | null> {
  // Gate: the app must have a successful published deployment to be packable.
  const appName = publishedAppName(appId);
  if (appName === null) return null;

  const serverBundle = resolveServerBundle();
  const clientDist = resolveClientDist();
  if (!serverBundle) {
    throw new Error(
      'Runtime server bundle (server.mjs) not found. Build the worker (pnpm --filter @exepad/runtime-worker build) before exporting a deployable bundle.',
    );
  }
  if (!clientDist) {
    throw new Error('Built SPA (client/dist) not found. Build the client before exporting a deployable bundle.');
  }

  const out: Record<string, Uint8Array> = {};
  let total = 0;
  const add = (path: string, bytes: Uint8Array) => {
    total += bytes.length;
    if (total > MAX_ZIP_BYTES) throw new ExportTooLargeError();
    out[path] = bytes;
  };
  const addText = (path: string, text: string) => add(path, strToU8(text));

  /** Recursively add every file under `absDir` to the zip at `zipPrefix`,
   *  skipping paths (relative to `absDir`) for which `skip` returns true. */
  const walkClient = (absDir: string, zipPrefix: string, relBase = '') => {
    for (const name of readdirSync(absDir)) {
      const relPath = relBase ? `${relBase}/${name}` : name;
      if (isStudioOnlyClientPath(relPath)) continue;
      const abs = join(absDir, name);
      const st = statSync(abs);
      const zipRel = `${zipPrefix}${name}`;
      if (st.isDirectory()) walkClient(abs, `${zipRel}/`, relPath);
      else if (st.isFile()) add(zipRel, new Uint8Array(readFileSync(abs)));
    }
  };

  // ── data/ — the app's published snapshot + DB (shared with D2's backend) ──
  await packPublishedAppData(add, appId, 'data/');

  // ── app/ — the prebuilt runtime ──
  add('app/server.mjs', new Uint8Array(readFileSync(serverBundle)));
  walkClient(clientDist, 'app/client/dist/');

  // ── licence + attribution for the runtime shipped above (AGPL §4/§5) ──
  // Unlike the source export (D2), the root here is Exepad's own bundle, not a
  // user project, so the licence belongs at the root. Missing texts degrade to
  // a readme pointer rather than failing the export.
  const licenseBytes = readRootLicense();
  const noticeBytes = readRootNotice();
  if (licenseBytes) add('LICENSE', licenseBytes);
  if (noticeBytes) add('NOTICE', noticeBytes);

  // ── scaffolding ──
  const { version: exepadVersion, sourceUrl: exepadSourceUrl } = exepadSourceRef();
  const inputs: T.DeployableInputs = {
    appId,
    appName,
    slug: slug(appName),
    betterSqlite3Version: BETTER_SQLITE3_VERSION,
    esbuildVersion: ESBUILD_VERSION,
    exepadVersion,
    exepadSourceUrl,
  };
  addText('Dockerfile', T.dockerfile(inputs));
  addText('docker-compose.yml', T.dockerCompose(inputs));
  addText('entrypoint.sh', T.ENTRYPOINT_SH);
  addText('.env.example', T.ENV_EXAMPLE);
  addText('.dockerignore', T.DOCKERIGNORE);
  addText('README.md', T.readme(inputs, licenseBytes != null, noticeBytes != null));

  return { files: out, appName };
}
