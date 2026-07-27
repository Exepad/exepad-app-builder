/**
 * Build-artifact resolution for the export builders.
 *
 * The export builders run INSIDE the bundled runtime server (server.mjs), which
 * is started from different working directories depending on the deployment
 * (`node /app/server.mjs` with cwd=/app in the container; `node
 * $ROOT/apps/runtime/worker/dist/server.mjs` with cwd=$ROOT under run.sh). A
 * `process.cwd()`-relative search therefore fails in one mode or the other —
 * which is exactly how the deployable/source exports silently 404'd.
 *
 * These resolvers anchor on the server bundle's OWN location (import.meta.url),
 * with env overrides + the container/repo fallbacks, so the four sibling
 * artifacts are found regardless of cwd:
 *   - server.mjs              (deployable: the runtime to ship)
 *   - client/dist             (deployable: the SPA to ship)
 *   - standalone-backend.mjs  (source: the vendored /rpc server)
 *   - packages/.../dist-eject (source: the React-external SDK to vendor)
 *
 * The same anchoring resolves the licence texts (LICENSE + NOTICE) that must
 * accompany any of those artifacts when an export conveys them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceOfferUrl } from '../source-offer';

const dec = new TextDecoder();

/** Directory of the running server bundle (server.mjs). esbuild preserves
 *  import.meta.url to point at the ESM output, so this is the bundle dir at
 *  runtime regardless of process.cwd(). */
function bundleDir(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

function firstExisting(
  candidates: (string | undefined)[],
  ok: (p: string) => boolean,
): string | null {
  for (const c of candidates) {
    if (c && ok(c)) return c;
  }
  return null;
}

/** The prebuilt runtime server bundle (`server.mjs`) — for the deployable bundle. */
export function resolveServerBundle(): string | null {
  const d = bundleDir();
  return firstExisting(
    [
      process.env.EXEPAD_SERVER_BUNDLE,
      join(d, 'server.mjs'),
      '/app/server.mjs',
      join(process.cwd(), 'apps/runtime/worker/dist/server.mjs'),
      join(process.cwd(), 'dist/server.mjs'),
    ],
    existsSync,
  );
}

/** The built SPA directory (`client/dist`) — for the deployable bundle. */
export function resolveClientDist(): string | null {
  const d = bundleDir();
  return firstExisting(
    [
      process.env.EXEPAD_CLIENT_DIST,
      join(d, '../../client/dist'), // worker/dist → apps/runtime/client/dist (run.sh)
      join(d, 'client/dist'), // /app/client/dist (container, bundleDir=/app)
      '/app/client/dist',
      join(process.cwd(), 'apps/runtime/client/dist'),
    ],
    (p) => existsSync(join(p, 'index.html')),
  );
}

/** The vendored standalone backend bundle (`standalone-backend.mjs`) — for D2. */
export function resolveStandaloneBackend(): string | null {
  const d = bundleDir();
  return firstExisting(
    [
      process.env.EXEPAD_STANDALONE_BACKEND,
      join(d, 'standalone-backend.mjs'), // sibling of server.mjs (both run.sh + container)
      '/app/standalone-backend.mjs',
      join(process.cwd(), 'apps/runtime/worker/dist/standalone-backend.mjs'),
      join(process.cwd(), 'dist/standalone-backend.mjs'),
    ],
    existsSync,
  );
}

/** The eject-built SDK directory (`dist-eject`) to vendor — for D2. */
export function resolveEjectDir(): string | null {
  const d = bundleDir();
  return firstExisting(
    [
      process.env.EXEPAD_SDK_EJECT_DIR,
      join(d, 'dist-eject'), // /app/dist-eject (container)
      join(d, '../../../../packages/exepad-sdk/dist-eject'), // worker/dist → repo/packages/... (run.sh)
      join(process.cwd(), 'packages/exepad-sdk/dist-eject'),
    ],
    (p) => existsSync(join(p, 'package.json')),
  );
}

// ── Licence texts (AGPL §4/§5/§6) ─────────────────────────────────────────
// Every export that ships built Exepad code — the vendored SDK + backend (D2),
// the whole runtime server + SPA (D1) — must carry that code's licence with it.

/** Read a file only if it really is the AGPL text (so an upward walk can never
 *  pick up an unrelated project's licence). */
function readAgplAt(file: string): Uint8Array | null {
  try {
    if (!existsSync(file)) return null;
    const bytes = new Uint8Array(readFileSync(file));
    return dec.decode(bytes.subarray(0, 512)).includes('AFFERO GENERAL PUBLIC LICENSE')
      ? bytes
      : null;
  } catch {
    return null;
  }
}

/** Locate the root licence directory: the `EXEPAD_LICENSE_FILE` override, else
 *  the nearest ancestor of the bundle (or cwd) holding the AGPL text. Anchored
 *  like the packaged artifacts above rather than on cwd: the Dockerfile copies
 *  LICENSE + NOTICE next to server.mjs at `/app`, and in a source checkout they
 *  sit at the repo root above `apps/runtime/worker/…`. */
function licenseRoot(): { dir: string; license: Uint8Array } | null {
  const override = process.env.EXEPAD_LICENSE_FILE;
  if (override) {
    const bytes = readAgplAt(override);
    if (bytes) return { dir: dirname(override), license: bytes };
  }
  for (const start of [bundleDir(), process.cwd()]) {
    for (let p = start; ; ) {
      const bytes = readAgplAt(join(p, 'LICENSE'));
      if (bytes) return { dir: p, license: bytes };
      const parent = dirname(p);
      if (parent === p) break;
      p = parent;
    }
  }
  return null;
}

/** The AGPL text covering the Exepad code an export conveys. Null (not a throw)
 *  when it cannot be located, so an export degrades instead of failing. */
export function readRootLicense(): Uint8Array | null {
  return licenseRoot()?.license ?? null;
}

/** The third-party attribution NOTICE that sits beside that LICENSE (copyright
 *  line + the bundled dependencies' notices). Only ever read from the directory
 *  the validated AGPL text was found in; null when that build has none. */
export function readRootNotice(): Uint8Array | null {
  const root = licenseRoot();
  if (!root) return null;
  try {
    const file = join(root.dir, 'NOTICE');
    return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
  } catch {
    return null;
  }
}

/**
 * Which Exepad build produced the bytes an export conveys — AGPL §6 wants
 * object code accompanied by a location for its Corresponding Source. Both
 * values are overridable so a FORK's exports point at the fork: the version is
 * `EXEPAD_VERSION` (baked by the Dockerfile), and the repository comes from the
 * same §13 source offer the served pages use (`../source-offer`, which
 * validates the override), honouring the client-side `VITE_EXEPAD_SOURCE_URL`
 * spelling too when only that one is set.
 */
export function exepadSourceRef(): { version: string; sourceUrl: string } {
  const viteUrl = (process.env.VITE_EXEPAD_SOURCE_URL ?? '').trim();
  const runtimeUrl = (process.env.EXEPAD_SOURCE_URL ?? '').trim();
  let sourceUrl = sourceOfferUrl();
  if (!runtimeUrl && viteUrl) {
    try {
      const parsed = new URL(viteUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') sourceUrl = viteUrl;
    } catch {
      /* unparseable — keep the validated offer URL */
    }
  }
  return { version: (process.env.EXEPAD_VERSION ?? '').trim() || 'dev', sourceUrl };
}
