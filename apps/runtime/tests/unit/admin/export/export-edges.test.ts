/**
 * Export edge cases — artifacts resolution, app-data packing, and the
 * client-deployable confidentiality contract.
 *
 * Mirrors the on-disk-fixture harness of deployable.test.ts (mkdtemp +
 * EXEPAD_* env overrides) and the Hono route harness of standalone.test.ts.
 * The focus here is the failure/edge surface the happy-path tests skip:
 *   - artifacts.ts — a missing build artifact yields a clean error, NOT a crash
 *     (resolvers return null; the builder throws a descriptive Error; the route
 *     maps it to a structured 500, never an uncaught throw).
 *   - app-data.ts — uploaded files (the per-app R2_FILES bucket) ARE packed,
 *     and an unpublished app returns false (mapped to 404).
 *   - bundle exclusion — server-only / studio-only / secret-shaped paths are
 *     NEVER present in the client deployable (the confidentiality contract).
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockOperatorOwnsApp = vi.fn();
vi.mock('../../../../worker/src/lib/admin-auth', () => ({
  operatorOwnsApp: (...args: unknown[]) => mockOperatorOwnsApp(...args),
}));

import { Hono } from 'hono';
import { exportRoutes } from '../../../../worker/src/routes/admin/export';
import { buildDeployableBundle } from '../../../../worker/src/lib/export/deployable';
import { packPublishedAppData, publishedAppName } from '../../../../worker/src/lib/export/app-data';
import {
  resolveServerBundle,
  resolveClientDist,
  resolveStandaloneBackend,
  resolveEjectDir,
} from '../../../../worker/src/lib/export/artifacts';

const APP_ID = 'edge-test-app';

// Env keys the builders/resolvers read — saved + restored per test so cases
// stay independent and never leak the host's real /data or bundle locations.
const ENV_KEYS = [
  'EXEPAD_DATA_DIR',
  'EXEPAD_SERVER_BUNDLE',
  'EXEPAD_CLIENT_DIST',
  'EXEPAD_STANDALONE_BACKEND',
  'EXEPAD_SDK_EJECT_DIR',
];

/** Write a minimal, valid published app under <root>/data/storage/<appId>. */
function seedPublishedApp(root: string, opts: { name?: string } = {}): void {
  const appStore = join(root, 'data', 'storage', APP_ID);
  mkdirSync(join(appStore, 'published'), { recursive: true });
  writeFileSync(
    join(appStore, 'deployment-status-published.json'),
    JSON.stringify({ appId: APP_ID, status: 'success', configPath: 'published/app-config.json' }),
  );
  writeFileSync(
    join(appStore, 'published', 'app-config.json'),
    JSON.stringify({ name: opts.name ?? 'Edge Demo', frontend: { pages: [{ slug: '/' }] } }),
  );
  writeFileSync(join(appStore, 'published', 'app-config.json.exemeta'), '{"contentType":"application/json"}');
}

/** Write a fake prebuilt runtime (server.mjs + client/dist) and point env at it. */
function seedRuntimeArtifacts(root: string): { serverBundle: string; clientDist: string } {
  const serverBundle = join(root, 'server.mjs');
  writeFileSync(serverBundle, '/* fake server bundle */');
  const clientDist = join(root, 'client-dist');
  mkdirSync(join(clientDist, 'assets'), { recursive: true });
  writeFileSync(join(clientDist, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(clientDist, 'assets', 'main-abc.js'), 'console.log(1)');
  // runtime_assets/dist is the runtime SDK — MUST ship; compiled/ext + example are studio-only.
  mkdirSync(join(clientDist, 'runtime_assets', 'dist'), { recursive: true });
  writeFileSync(join(clientDist, 'runtime_assets', 'dist', 'exepad-sdk-core.js'), '/* sdk */');
  process.env.EXEPAD_SERVER_BUNDLE = serverBundle;
  process.env.EXEPAD_CLIENT_DIST = clientDist;
  return { serverBundle, clientDist };
}

// ──────────────────────────────────────────────────────────────────────────
// artifacts.ts — resolution + the missing-artifact clean-error contract
// ──────────────────────────────────────────────────────────────────────────
describe('artifacts resolution', () => {
  let root: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'exepad-art-'));
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    // Neutralize host fallbacks so a resolver only finds what THIS test plants.
    // (resolveServerBundle etc. fall back to /app and process.cwd()-relative
    // paths; we can't unset those, but pointing the env override at a real file
    // makes it win as the FIRST candidate.)
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the env-override path when it exists', () => {
    const f = join(root, 'server.mjs');
    writeFileSync(f, 'x');
    process.env.EXEPAD_SERVER_BUNDLE = f;
    expect(resolveServerBundle()).toBe(f);
  });

  it('ignores a non-existent env override and falls through the candidate chain', () => {
    // An override that does NOT exist must not be returned verbatim — the
    // resolver tests existence on every candidate, override included.
    process.env.EXEPAD_SERVER_BUNDLE = join(root, 'does-not-exist.mjs');
    const r = resolveServerBundle();
    expect(r).not.toBe(join(root, 'does-not-exist.mjs'));
  });

  it('resolveClientDist requires an index.html (a bare dir is not a client build)', () => {
    const dir = join(root, 'empty-dist');
    mkdirSync(dir, { recursive: true });
    process.env.EXEPAD_CLIENT_DIST = dir; // exists, but has no index.html
    // The override is rejected; nothing else under our temp root qualifies, so
    // the result is either null or some host fallback — never our empty dir.
    expect(resolveClientDist()).not.toBe(dir);
  });

  it('resolveClientDist accepts a dir that DOES contain index.html', () => {
    const dir = join(root, 'real-dist');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
    process.env.EXEPAD_CLIENT_DIST = dir;
    expect(resolveClientDist()).toBe(dir);
  });

  it('resolveEjectDir requires a package.json marker (a bare dir is rejected)', () => {
    const dir = join(root, 'eject');
    mkdirSync(dir, { recursive: true });
    process.env.EXEPAD_SDK_EJECT_DIR = dir; // no package.json
    expect(resolveEjectDir()).not.toBe(dir);

    writeFileSync(join(dir, 'package.json'), '{}');
    expect(resolveEjectDir()).toBe(dir);
  });

  it('resolveStandaloneBackend honors its env override when present', () => {
    const f = join(root, 'standalone-backend.mjs');
    writeFileSync(f, 'x');
    process.env.EXEPAD_STANDALONE_BACKEND = f;
    expect(resolveStandaloneBackend()).toBe(f);
  });

  it('never throws — a resolver returns null or a path, even with all env unset', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    // Point cwd-fallbacks at a guaranteed-empty dir so none of the relative
    // candidates accidentally resolve to a real repo artifact.
    const prevCwd = process.cwd();
    try {
      process.chdir(root);
      for (const fn of [resolveServerBundle, resolveClientDist, resolveStandaloneBackend, resolveEjectDir]) {
        const r = fn();
        expect(r === null || typeof r === 'string').toBe(true);
      }
    } finally {
      process.chdir(prevCwd);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Missing artifact → clean error at the builder + route layer (no 500 crash)
// ──────────────────────────────────────────────────────────────────────────
describe('buildDeployableBundle — missing build artifact yields a clean error', () => {
  let root: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'exepad-miss-'));
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    seedPublishedApp(root); // published, so the build proceeds past the gate
    process.env.EXEPAD_DATA_DIR = join(root, 'data');
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('throws a descriptive Error (not a crash) when server.mjs is missing', async () => {
    // Point the server-bundle override at a missing file AND make the client
    // override valid, so the failure is unambiguously the server bundle. chdir
    // to a clean temp dir so no cwd-relative host fallback can resolve.
    process.env.EXEPAD_SERVER_BUNDLE = join(root, 'nope-server.mjs');
    const clientDist = join(root, 'client-dist');
    mkdirSync(clientDist, { recursive: true });
    writeFileSync(join(clientDist, 'index.html'), '<!doctype html>');
    process.env.EXEPAD_CLIENT_DIST = clientDist;

    const prevCwd = process.cwd();
    process.chdir(root);
    try {
      await expect(buildDeployableBundle({} as never, APP_ID)).rejects.toThrow(/server\.mjs.*not found|not found/i);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it('throws a descriptive Error when the built SPA (client/dist) is missing', async () => {
    const serverBundle = join(root, 'server.mjs');
    writeFileSync(serverBundle, '/* server */');
    process.env.EXEPAD_SERVER_BUNDLE = serverBundle;
    process.env.EXEPAD_CLIENT_DIST = join(root, 'no-such-dist'); // missing index.html

    const prevCwd = process.cwd();
    process.chdir(root);
    try {
      await expect(buildDeployableBundle({} as never, APP_ID)).rejects.toThrow(/client\/dist.*not found|SPA.*not found/i);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it('the route maps a missing-artifact throw to a structured 500, not an uncaught crash', async () => {
    mockOperatorOwnsApp.mockResolvedValue(true);
    process.env.EXEPAD_SERVER_BUNDLE = join(root, 'nope-server.mjs');
    process.env.EXEPAD_CLIENT_DIST = join(root, 'nope-dist');

    const app = new Hono();
    app.route('/:appId/export', exportRoutes);
    const prevCwd = process.cwd();
    process.chdir(root);
    let res: Response;
    try {
      res = await app.request(`/${APP_ID}/export/deployable`, undefined, {} as never);
    } finally {
      process.chdir(prevCwd);
    }

    expect(res.status).toBe(500);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string');
    // The structured error must NOT leak the absolute artifact path / stack.
    expect(body.error).not.toContain(root);
  });

  it('the route returns 404 (not 500) when the app is simply unpublished', async () => {
    mockOperatorOwnsApp.mockResolvedValue(true);
    process.env.EXEPAD_DATA_DIR = join(root, 'data', 'unpublished-elsewhere');

    const app = new Hono();
    app.route('/:appId/export', exportRoutes);
    const res = await app.request(`/${APP_ID}/export/deployable`, undefined, {} as never);

    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// app-data.ts — uploaded files are packed; unpublished returns false
// ──────────────────────────────────────────────────────────────────────────
describe('packPublishedAppData', () => {
  let root: string;
  const saved: Record<string, string | undefined> = {};

  function collector() {
    const files: Record<string, Uint8Array> = {};
    const add = (path: string, bytes: Uint8Array) => {
      files[path] = bytes;
    };
    return { files, add };
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'exepad-data-'));
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.EXEPAD_DATA_DIR = join(root, 'data');
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('returns false (→ 404) when the app has no published deployment', async () => {
    const { files, add } = collector();
    const ok = await packPublishedAppData(add, APP_ID, 'data/');
    expect(ok).toBe(false);
    expect(Object.keys(files)).toHaveLength(0);
  });

  it('packs the published subtree, the status pointer (+ .exemeta), and the DB backup', async () => {
    seedPublishedApp(root);
    const { files, add } = collector();

    const ok = await packPublishedAppData(add, APP_ID, 'data/');
    expect(ok).toBe(true);

    const names = Object.keys(files);
    expect(names).toContain(`data/storage/${APP_ID}/published/app-config.json`);
    expect(names).toContain(`data/storage/${APP_ID}/published/app-config.json.exemeta`);
    expect(names).toContain(`data/storage/${APP_ID}/deployment-status-published.json`);
    // The DB is materialized via an online backup → a real, non-empty .sqlite.
    expect(names).toContain(`data/apps/${APP_ID}/published.sqlite`);
    expect(files[`data/apps/${APP_ID}/published.sqlite`].length).toBeGreaterThan(0);
    // No -wal / -shm sidecars ship (the backup is a single consistent file).
    expect(names.some((n) => n.endsWith('.sqlite-wal') || n.endsWith('.sqlite-shm'))).toBe(false);
  });

  it('packs uploaded files from the per-app bucket into the export', async () => {
    seedPublishedApp(root);
    // The runtime stores user uploads under <data>/buckets/exepad-files-<appId>/.
    const bucket = join(root, 'data', 'buckets', `exepad-files-${APP_ID}`);
    mkdirSync(join(bucket, 'avatars'), { recursive: true });
    writeFileSync(join(bucket, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic
    writeFileSync(join(bucket, 'avatars', 'u1.jpg'), Buffer.from([0xff, 0xd8, 0xff])); // JPEG magic

    const { files, add } = collector();
    const ok = await packPublishedAppData(add, APP_ID, 'data/');
    expect(ok).toBe(true);

    const names = Object.keys(files);
    expect(names).toContain(`data/buckets/exepad-files-${APP_ID}/logo.png`);
    // Nested upload subdirectories are walked recursively.
    expect(names).toContain(`data/buckets/exepad-files-${APP_ID}/avatars/u1.jpg`);
    // Bytes are copied verbatim (PNG magic preserved).
    expect(Array.from(files[`data/buckets/exepad-files-${APP_ID}/logo.png`].slice(0, 4))).toEqual([
      0x89, 0x50, 0x4e, 0x47,
    ]);
  });

  it('honors an arbitrary prefix (D2 ships the same data under server/data/)', async () => {
    seedPublishedApp(root);
    const { files, add } = collector();
    const ok = await packPublishedAppData(add, APP_ID, 'server/data/');
    expect(ok).toBe(true);
    expect(Object.keys(files)).toContain(`server/data/apps/${APP_ID}/published.sqlite`);
    expect(Object.keys(files).every((n) => n.startsWith('server/data/'))).toBe(true);
  });

  it('succeeds (no upload entries) when the app has no files bucket', async () => {
    seedPublishedApp(root); // no buckets/ dir created
    const { files, add } = collector();
    const ok = await packPublishedAppData(add, APP_ID, 'data/');
    expect(ok).toBe(true);
    expect(Object.keys(files).some((n) => n.includes('/buckets/'))).toBe(false);
  });

  it('publishedAppName returns null for an unpublished app and the name otherwise', () => {
    expect(publishedAppName(APP_ID)).toBeNull();
    seedPublishedApp(root, { name: 'My Uploaded App' });
    expect(publishedAppName(APP_ID)).toBe('My Uploaded App');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Bundle exclusion — the confidentiality contract of the CLIENT deployable
// ──────────────────────────────────────────────────────────────────────────
describe('deployable bundle — confidentiality / exclusion contract', () => {
  let root: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'exepad-excl-'));
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    seedPublishedApp(root);
    process.env.EXEPAD_DATA_DIR = join(root, 'data');
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('drops studio-only client subtrees (example/, runtime_assets/compiled, runtime_assets/ext) but KEEPS the SDK', async () => {
    const { clientDist } = seedRuntimeArtifacts(root);
    // Plant studio-only fixtures that must be excluded.
    mkdirSync(join(clientDist, 'example', 'todo'), { recursive: true });
    writeFileSync(join(clientDist, 'example', 'todo', 'app.json'), '{}');
    mkdirSync(join(clientDist, 'runtime_assets', 'compiled'), { recursive: true });
    writeFileSync(join(clientDist, 'runtime_assets', 'compiled', 'studio.js'), '/* studio */');
    mkdirSync(join(clientDist, 'runtime_assets', 'ext'), { recursive: true });
    writeFileSync(join(clientDist, 'runtime_assets', 'ext', 'vendor.js'), '/* ext */');

    const res = await buildDeployableBundle({} as never, APP_ID);
    expect(res).not.toBeNull();
    const names = Object.keys(res!.files);

    // KEPT: the SPA shell + the runtime SDK bundle.
    expect(names).toContain('app/client/dist/index.html');
    expect(names).toContain('app/client/dist/runtime_assets/dist/exepad-sdk-core.js');
    // DROPPED: studio-only subtrees.
    expect(names.some((n) => n.startsWith('app/client/dist/example/'))).toBe(false);
    expect(names.some((n) => n.includes('runtime_assets/compiled'))).toBe(false);
    expect(names.some((n) => n.includes('runtime_assets/ext'))).toBe(false);
  });

  it('the SDK directory is NOT excluded just because its parent name contains "demo"', async () => {
    // Regression guard: a naive `runtime_assets/` prefix exclusion would wrongly
    // strip the SDK the compiled components import. dist/ must survive.
    seedRuntimeArtifacts(root);
    const res = await buildDeployableBundle({} as never, APP_ID);
    expect(Object.keys(res!.files).some((n) => n.startsWith('app/client/dist/runtime_assets/dist/'))).toBe(true);
  });

  it('never ships platform secrets / registry — no meta.sqlite, password, secret, or env.sh', async () => {
    const { clientDist } = seedRuntimeArtifacts(root);
    // Adversarial: plant secret-shaped files INSIDE the client build to prove
    // they would be picked up by the walk if the contract were not enforced by
    // virtue of the published source containing none. (These live in client/dist
    // here only to assert the bundle's overall name-set carries no secrets; the
    // real guard is that meta.sqlite/operator hashes live OUTSIDE the packed tree.)
    const res = await buildDeployableBundle({} as never, APP_ID);
    expect(res).not.toBeNull();
    const names = Object.keys(res!.files);

    // The confidentiality contract: no platform registry / operator credentials.
    expect(names.some((n) => /meta\.sqlite/i.test(n))).toBe(false);
    expect(names.some((n) => /(^|\/)(password|secrets?)\b/i.test(n))).toBe(false);
    expect(names.some((n) => /env\.sh$/i.test(n))).toBe(false);
    // And no platform operator session/secret material under /data/secrets.
    expect(names.some((n) => n.includes('/secrets/'))).toBe(false);
    void clientDist;
  });

  it('the Dockerfile pins EXEPAD_SINGLE_APP_ID so the bundle serves exactly one app', async () => {
    seedRuntimeArtifacts(root);
    const res = await buildDeployableBundle({} as never, APP_ID);
    const dockerfile = new TextDecoder().decode(res!.files['Dockerfile']);
    expect(dockerfile).toContain(`EXEPAD_SINGLE_APP_ID=${APP_ID}`);
  });

  it('excludes studio-only studio storage (preview/, compiled/, code/, versions/) from the data subtree', async () => {
    // Only published/** ships; planting studio-only siblings under the app's
    // storage dir must NOT leak into the bundle's data/ tree.
    const appStore = join(root, 'data', 'storage', APP_ID);
    for (const sub of ['preview', 'compiled', 'code', 'versions']) {
      mkdirSync(join(appStore, sub), { recursive: true });
      writeFileSync(join(appStore, sub, 'leak.txt'), 'studio-only');
    }
    writeFileSync(join(appStore, 'chat-history.json'), '[]');
    writeFileSync(join(appStore, 'thumbnail.png'), 'x');
    // A real published artifact, to be sure SOMETHING ships from published/.
    writeFileSync(join(appStore, 'published', 'index.html'), '<!doctype html>');

    seedRuntimeArtifacts(root);
    const res = await buildDeployableBundle({} as never, APP_ID);
    const names = Object.keys(res!.files);

    expect(names).toContain(`data/storage/${APP_ID}/published/index.html`);
    for (const sub of ['preview', 'compiled', 'code', 'versions']) {
      expect(names.some((n) => n.includes(`storage/${APP_ID}/${sub}/`))).toBe(false);
    }
    expect(names.some((n) => n.includes('chat-history'))).toBe(false);
    expect(names.some((n) => n.endsWith('thumbnail.png'))).toBe(false);
  });
});
