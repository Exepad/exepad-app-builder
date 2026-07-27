/**
 * Standalone backend server (D2/K3) — the vendored full-stack backend for a
 * downloaded buildable project.
 *
 * The standalone project's frontend (the user's TSX + the ejected SDK + the host
 * shim) is built by Vite into `dist/`. Its data hooks (`useModel`/`useHandler`)
 * POST to bare `/rpc`. This tiny server closes that loop with NO platform
 * dependency: it serves the built `dist/` statically and dispatches `/rpc` to
 * `@exepad/app-backend` in-process over a local SQLite (the auto-CRUD + handler
 * backend), using the app's vendored published snapshot under `server/data/`.
 *
 * Bundled by build-server.mjs → dist/standalone-backend.mjs (externals:
 * better-sqlite3, esbuild) and vendored into the project as `server/start.mjs`.
 * Run with `npm start`.
 */
import { installCacheShim, FsStorageAdapter, getAppD1 } from '@exepad/local-adapters';
import { bucketDir } from '@exepad/deploy-utils';
import appBackend from '@exepad/app-backend';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

installCacheShim();

const here = dirname(fileURLToPath(import.meta.url)); // <project>/server
// The vendored data tree (apps/, storage/, buckets/) lives next to this file.
process.env.EXEPAD_DATA_DIR = process.env.EXEPAD_DATA_DIR ?? join(here, 'data');

/** App id: from env, else the generated sibling `app.json`. */
function resolveAppId(): string {
  if (process.env.EXEPAD_SINGLE_APP_ID) return process.env.EXEPAD_SINGLE_APP_ID.trim();
  try {
    return (JSON.parse(readFileSync(join(here, 'app.json'), 'utf8')) as { appId: string }).appId;
  } catch {
    throw new Error('Could not resolve app id (set EXEPAD_SINGLE_APP_ID or provide server/app.json).');
  }
}

const APP_ID = resolveAppId();
// Same-process service token: the app-backend only checks that the request's
// X-Service-Token matches env.SERVICE_TOKEN, and we control both ends here.
const SERVICE_TOKEN = process.env.EXEPAD_SERVICE_TOKEN || 'standalone-local-token';
const PORT = Number(process.env.PORT ?? 8080);
const DIST_DIR = process.env.EXEPAD_DIST_DIR ?? join(here, '..', 'dist');

/** Per-request app-backend Env backed by the vendored local adapters. */
function userEnv() {
  return {
    DB: getAppD1(APP_ID, 'published'),
    CONFIG_CACHE: new FsStorageAdapter(),
    R2_FILES: new FsStorageAdapter(bucketDir(`exepad-files-${APP_ID}`)),
    DEPLOY_MODE: 'published',
    APP_ID,
    APP_ALIAS: APP_ID,
    ENVIRONMENT: 'standalone',
    SERVICE_TOKEN,
  } as never;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  return (dot >= 0 && CONTENT_TYPES[path.slice(dot).toLowerCase()]) || 'application/octet-stream';
}

const app = new Hono();

// ── /rpc — dispatch to the app-backend (auto-CRUD + handlers) ──
app.all('/rpc', async (c) => {
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Service-Token', SERVICE_TOKEN);
  const body =
    c.req.method === 'GET' || c.req.method === 'HEAD' ? undefined : await c.req.raw.arrayBuffer();
  const req = new Request('http://app-backend/rpc', { method: c.req.method, headers, body });
  return appBackend.fetch(req, userEnv());
});

// Health probe.
app.get('/healthz', (c) => c.json({ status: 'ok', appId: APP_ID }));

// ── static dist/ with SPA fallback ──
app.get('*', async (c) => {
  const root = normalize(DIST_DIR);
  const pathname = decodeURIComponent(new URL(c.req.url).pathname);
  const candidate = normalize(join(root, pathname));
  if (candidate !== root && !candidate.startsWith(root + '/')) {
    return c.text('Forbidden', 403);
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return new Response(readFileSync(candidate), { headers: { 'Content-Type': contentTypeFor(candidate) } });
  }
  const index = join(root, 'index.html');
  if (existsSync(index)) {
    return new Response(readFileSync(index), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  return c.text('Not Found — run `npm run build` first.', 404);
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[exepad-standalone] ${APP_ID} serving dist/ + /rpc on http://0.0.0.0:${info.port}`);
});
