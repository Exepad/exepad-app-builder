/**
 * Build the runtime worker `Env` for the self-hosted single-container process.
 *
 * Replaces Cloudflare bindings with local equivalents:
 *   CONFIG_CACHE → FsStorageAdapter over `<EXEPAD_DATA_DIR>/storage`
 *   ASSETS       → a disk-backed Fetcher serving the built SPA (`dist`)
 *   secrets      → `envSecret()` wrappers over `process.env`
 *   USER_WORKERS → omitted (dispatch is in-process)
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import { FsStorageAdapter, envSecret } from '@exepad/local-adapters';
import type { Env } from '../types/env';

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
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * A Fetcher that serves files from the built SPA directory. Mirrors the
 * Cloudflare Assets binding: exact file hits return the file; everything else
 * (SPA client routes) falls back to `index.html`. Path traversal is rejected.
 */
function createAssetsFetcher(distDir: string): Fetcher {
  const root = normalize(distDir);
  const indexPath = join(root, 'index.html');

  return {
    async fetch(input: RequestInfo | URL): Promise<Response> {
      const request = input instanceof Request ? input : new Request(input);
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const candidate = normalize(join(root, pathname));

      // Traversal guard: resolved path must stay under root.
      if (candidate !== root && !candidate.startsWith(root + '/')) {
        return new Response('Forbidden', { status: 403 });
      }

      if (existsSync(candidate)) {
        const stat = statSync(candidate);
        if (stat.isFile()) {
          // Emit validators so fixed-name bundles (exepad-sdk*.js, react-shim.js)
          // served with `must-revalidate` can actually 304 instead of re-sending
          // ~1.6MB of unchanged bytes every TTL. A weak ETag of size+mtime is
          // enough here (content changes bump mtime on rebuild) and cheap.
          const lastModified = stat.mtime.toUTCString();
          const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
          const ifNoneMatch = request.headers.get('if-none-match');
          const ifModifiedSince = request.headers.get('if-modified-since');
          const notModified =
            (ifNoneMatch !== null && ifNoneMatch.split(',').some((t) => t.trim() === etag)) ||
            (ifNoneMatch === null &&
              ifModifiedSince !== null &&
              Date.parse(ifModifiedSince) >= Math.floor(stat.mtimeMs / 1000) * 1000);
          if (notModified) {
            return new Response(null, {
              status: 304,
              headers: { ETag: etag, 'Last-Modified': lastModified },
            });
          }
          return new Response(readFileSync(candidate), {
            headers: {
              'Content-Type': contentTypeFor(candidate),
              ETag: etag,
              'Last-Modified': lastModified,
            },
          });
        }
      }
      // SPA fallback.
      if (existsSync(indexPath)) {
        return new Response(readFileSync(indexPath), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return new Response('Not Found', { status: 404 });
    },
  } as unknown as Fetcher;
}

/** Default location of the built SPA inside the container image. */
function clientDistDir(): string {
  return process.env.EXEPAD_CLIENT_DIST ?? '/app/apps/runtime/client/dist';
}

export function buildRuntimeEnv(): Env {
  const storage = new FsStorageAdapter();

  // The gateway signs its in-process dispatch to the app-backend with
  // USER_WORKER_SERVICE_TOKEN, and the backend verifies it. If the token is
  // EMPTY, both ends historically skipped the check (fail-open) in non-prod
  // environments — so the backend would trust gateway-injected X-User-* headers
  // unverified. entrypoint.sh/run.sh generate a token for real deployments;
  // generate an ephemeral one here so it is NEVER empty in-process (covering
  // `pnpm dev` and any misconfig), which makes the check always run. Persisting
  // it back to process.env keeps the gateway and backend on the SAME value.
  if (!process.env.USER_WORKER_SERVICE_TOKEN) {
    process.env.USER_WORKER_SERVICE_TOKEN = randomBytes(32).toString('hex');
  }

  const env = {
    ASSETS: createAssetsFetcher(clientDistDir()),
    CONFIG_CACHE: storage as unknown as R2Bucket,

    // Secrets / shared tokens — sourced from process.env in self-host.
    DEPLOY_SECRET: envSecret('DEPLOY_SECRET'),
    RESEND_API_KEY: envSecret('RESEND_API_KEY'),

    EXEPAD_ROUTER_SECRET: process.env.EXEPAD_ROUTER_SECRET ?? '',
    PLATFORM_BRIDGE_SECRET: process.env.PLATFORM_BRIDGE_SECRET ?? process.env.EXEPAD_SESSION_SECRET ?? '',
    PLATFORM_INTERNAL_SECRET: process.env.PLATFORM_INTERNAL_SECRET ?? '',
    USER_WORKER_SERVICE_TOKEN: process.env.USER_WORKER_SERVICE_TOKEN ?? '',
    PLATFORM_DIAGNOSTIC_SECRET: process.env.PLATFORM_DIAGNOSTIC_SECRET ?? '',

    ENVIRONMENT: process.env.ENVIRONMENT ?? 'selfhost',
    PLATFORM_DOMAINS: process.env.PLATFORM_DOMAINS ?? '',
  };

  // USER_WORKERS / BROWSER intentionally omitted — no WfP, no Browser Rendering.
  return env as unknown as Env;
}
