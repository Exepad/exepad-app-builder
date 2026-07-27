/**
 * Bundle the self-hosted runtime into single ESM files.
 *
 *   dist/server.mjs            — the @hono/node-server entrypoint (SPA + gateway
 *                                + deploy + auth + orchestration + the
 *                                maintenance cron). Entry: src/server/main.ts.
 *   dist/screenshot-worker.mjs — the isolated Chromium child the cron spawns to
 *                                capture dashboard thumbnails. Entry:
 *                                src/server/screenshot-worker.ts.
 *   dist/standalone-backend.mjs — the minimal /rpc + static server vendored into
 *                                a downloaded standalone project (D2). Entry:
 *                                src/server/standalone-backend.ts.
 *
 * Only native / binary-backed packages stay external and are installed in the
 * final image:
 *   - better-sqlite3 (native addon)
 *   - esbuild        (ships a platform binary; used by the build materializer)
 *   - playwright-core (drives the system-installed Chromium; child only)
 */
import * as esbuild from 'esbuild';

const external = ['better-sqlite3', 'esbuild', 'playwright-core'];

// Some bundled CJS deps reference `require`; provide it under ESM output.
const banner = {
  js: "import { createRequire as ___createRequire } from 'module'; const require = ___createRequire(import.meta.url);",
};

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external,
  banner,
  logLevel: 'info',
};

await esbuild.build({
  ...common,
  entryPoints: ['src/server/main.ts'],
  outfile: 'dist/server.mjs',
});
console.log('[build-server] wrote dist/server.mjs');

await esbuild.build({
  ...common,
  entryPoints: ['src/server/screenshot-worker.ts'],
  outfile: 'dist/screenshot-worker.mjs',
});
console.log('[build-server] wrote dist/screenshot-worker.mjs');

await esbuild.build({
  ...common,
  entryPoints: ['src/server/standalone-backend.ts'],
  outfile: 'dist/standalone-backend.mjs',
});
console.log('[build-server] wrote dist/standalone-backend.mjs');
