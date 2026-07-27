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

const APP_ID = 'depl-test-app';

// ── Route-level owner gate ───────────────────────────────────────
describe('admin export — deployable route owner gate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a non-owner with 401', async () => {
    mockOperatorOwnsApp.mockResolvedValue(false);
    const app = new Hono();
    app.route('/:appId/export', exportRoutes);
    const res = await app.request(`/${APP_ID}/export/deployable`, undefined, {} as never);
    expect(res.status).toBe(401);
  });
});

// ── Builder against an on-disk fixture ───────────────────────────
describe('buildDeployableBundle', () => {
  let root: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'exepad-depl-'));
    for (const k of [
      'EXEPAD_DATA_DIR',
      'EXEPAD_SERVER_BUNDLE',
      'EXEPAD_CLIENT_DIST',
      'EXEPAD_LICENSE_FILE',
      'EXEPAD_VERSION',
      'VITE_EXEPAD_SOURCE_URL',
      'EXEPAD_SOURCE_URL',
    ]) {
      saved[k] = process.env[k];
    }

    // data/ — a minimal published app
    const appStore = join(root, 'data', 'storage', APP_ID);
    mkdirSync(join(appStore, 'published'), { recursive: true });
    writeFileSync(
      join(appStore, 'deployment-status-published.json'),
      JSON.stringify({ appId: APP_ID, status: 'success', configPath: 'published/app-config.json' }),
    );
    writeFileSync(
      join(appStore, 'published', 'app-config.json'),
      JSON.stringify({ name: 'Demo Notes', frontend: { pages: [{ slug: '/' }] } }),
    );
    writeFileSync(join(appStore, 'published', 'app-config.json.exemeta'), '{"contentType":"application/json"}');

    // app/ — fake prebuilt runtime
    const serverBundle = join(root, 'server.mjs');
    writeFileSync(serverBundle, '/* fake server bundle */');
    const clientDist = join(root, 'client-dist');
    mkdirSync(join(clientDist, 'assets'), { recursive: true });
    writeFileSync(join(clientDist, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(join(clientDist, 'assets', 'main-abc.js'), 'console.log(1)');
    // runtime_assets/dist is the SDK — MUST be kept; compiled/ext are studio-only.
    mkdirSync(join(clientDist, 'runtime_assets', 'dist'), { recursive: true });
    writeFileSync(join(clientDist, 'runtime_assets', 'dist', 'exepad-sdk-core.js'), '/* sdk */');
    mkdirSync(join(clientDist, 'runtime_assets', 'compiled'), { recursive: true });
    writeFileSync(join(clientDist, 'runtime_assets', 'compiled', 'x.js'), '/* studio only */');
    mkdirSync(join(clientDist, 'example'), { recursive: true });
    writeFileSync(join(clientDist, 'example', 'y.json'), '{}');

    process.env.EXEPAD_DATA_DIR = join(root, 'data');
    process.env.EXEPAD_SERVER_BUNDLE = serverBundle;
    process.env.EXEPAD_CLIENT_DIST = clientDist;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('returns null when the app has no published deployment', async () => {
    process.env.EXEPAD_DATA_DIR = join(root, 'nonexistent');
    const res = await buildDeployableBundle({} as never, APP_ID);
    expect(res).toBeNull();
  });

  it('packs a complete, self-contained, leak-free bundle', async () => {
    const res = await buildDeployableBundle({} as never, APP_ID);
    expect(res).not.toBeNull();
    expect(res!.appName).toBe('Demo Notes');
    const names = Object.keys(res!.files);

    // Scaffolding
    for (const f of ['Dockerfile', 'docker-compose.yml', 'entrypoint.sh', '.env.example', '.dockerignore', 'README.md']) {
      expect(names).toContain(f);
    }

    // data/ — published snapshot (incl. .exemeta) + the status pointer + DB backup
    expect(names).toContain(`data/storage/${APP_ID}/published/app-config.json`);
    expect(names).toContain(`data/storage/${APP_ID}/published/app-config.json.exemeta`);
    expect(names).toContain(`data/storage/${APP_ID}/deployment-status-published.json`);
    expect(names).toContain(`data/apps/${APP_ID}/published.sqlite`);
    // The DB backup is a real (non-empty) SQLite file.
    expect(res!.files[`data/apps/${APP_ID}/published.sqlite`].length).toBeGreaterThan(0);

    // app/ — prebuilt runtime; SDK kept, studio fixtures dropped
    expect(names).toContain('app/server.mjs');
    expect(names).toContain('app/client/dist/index.html');
    expect(names).toContain('app/client/dist/assets/main-abc.js');
    expect(names).toContain('app/client/dist/runtime_assets/dist/exepad-sdk-core.js');
    expect(names.some((n) => n.includes('runtime_assets/compiled'))).toBe(false);
    expect(names.some((n) => n.startsWith('app/client/dist/example/'))).toBe(false);

    // Dockerfile pins the app id; bundle never carries platform secrets / registry.
    const dec = new TextDecoder();
    expect(dec.decode(res!.files['Dockerfile'])).toContain(`EXEPAD_SINGLE_APP_ID=${APP_ID}`);
    expect(names.some((n) => /meta\.sqlite|password|secret|env\.sh/i.test(n))).toBe(false);
  });

  // AGPL §4/§5/§6: this bundle conveys the ENTIRE Exepad runtime in object form
  // (app/server.mjs + the compiled SPA), so the licence and the third-party
  // notices must travel with it, and the readme must say where the source is.
  describe('licence conformance', () => {
    const dec = new TextDecoder();

    /** Stand in for the repo/image root (Dockerfile puts both at /app). */
    function seedLicenseRoot(withNotice: boolean): void {
      const dir = join(root, 'licence-root');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'LICENSE'),
        'GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n— seeded root licence\n',
      );
      if (withNotice) writeFileSync(join(dir, 'NOTICE'), 'Exepad\nCopyright © 2026 Exepad LLC — seeded notice\n');
      process.env.EXEPAD_LICENSE_FILE = join(dir, 'LICENSE');
    }

    it('ships LICENSE + NOTICE at the bundle root and points at the source', async () => {
      seedLicenseRoot(true);
      process.env.EXEPAD_VERSION = 'v9.9.9';
      process.env.VITE_EXEPAD_SOURCE_URL = 'https://github.com/forker/my-exepad';

      const res = await buildDeployableBundle({} as never, APP_ID);
      const names = Object.keys(res!.files);

      expect(names).toContain('LICENSE');
      expect(dec.decode(res!.files['LICENSE'])).toContain('AFFERO GENERAL PUBLIC LICENSE');
      expect(names).toContain('NOTICE');
      expect(dec.decode(res!.files['NOTICE'])).toContain('seeded notice');

      const readme = dec.decode(res!.files['README.md']);
      expect(readme).toContain('## Licensing');
      expect(readme).toContain('app/server.mjs');
      expect(readme).toContain('GNU Affero General'); // wraps mid-phrase in the prose
      expect(readme).toContain('`LICENSE` file here');
      expect(readme).toContain('`NOTICE`');
      expect(readme).toContain('built from Exepad `v9.9.9`');
      expect(readme).toContain('https://github.com/forker/my-exepad');
      // Structure block lists what actually shipped, with no doubled blank line.
      expect(readme).toContain('LICENSE               GNU AGPL-3.0');
      expect(readme).toContain('NOTICE                copyright');
      expect(readme).not.toContain('\n\n\n');
    });

    // One knob rebrands a fork: the runtime §13 offer wins, the client-side
    // spelling only fills in when it is the sole override.
    it('prefers the runtime source-offer URL over the client-side spelling', async () => {
      seedLicenseRoot(true);
      process.env.EXEPAD_SOURCE_URL = 'https://git.example.org/fork';
      process.env.VITE_EXEPAD_SOURCE_URL = 'https://github.com/someone-else/stale';

      const res = await buildDeployableBundle({} as never, APP_ID);
      const readme = dec.decode(res!.files['README.md']);

      expect(readme).toContain('https://git.example.org/fork');
      expect(readme).not.toContain('someone-else/stale');

      // …and the RUNNING bundle must make the same offer as the readme beside
      // it: the shipped server reads EXEPAD_SOURCE_URL at boot for `GET /source`
      // and the page <link rel="license">, so it has to be baked into the image
      // (unset → it would redirect this fork's users to upstream Exepad).
      const dockerfile = dec.decode(res!.files['Dockerfile']);
      expect(dockerfile).toContain('EXEPAD_SOURCE_URL="https://git.example.org/fork"');
      expect(dockerfile).not.toContain('someone-else/stale');
      // Compose exposes the same knob, defaulting to the baked value.
      expect(dec.decode(res!.files['docker-compose.yml'])).toContain(
        'EXEPAD_SOURCE_URL:-https://git.example.org/fork',
      );
    });

    it('bakes the upstream offer + build version when nothing overrides them', async () => {
      seedLicenseRoot(true);
      delete process.env.EXEPAD_SOURCE_URL;
      delete process.env.VITE_EXEPAD_SOURCE_URL;
      process.env.EXEPAD_VERSION = 'v1.2.3';

      const res = await buildDeployableBundle({} as never, APP_ID);
      const dockerfile = dec.decode(res!.files['Dockerfile']);

      expect(dockerfile).toContain('EXEPAD_SOURCE_URL="https://github.com/Exepad/exepad-app-builder"');
      expect(dockerfile).toContain('EXEPAD_VERSION="v1.2.3"');
    });

    it('quotes the baked values so a stray space cannot break the ENV block', async () => {
      seedLicenseRoot(true);
      process.env.EXEPAD_SOURCE_URL = 'https://git.example.org/a b';

      const res = await buildDeployableBundle({} as never, APP_ID);
      const dockerfile = dec.decode(res!.files['Dockerfile']);

      expect(dockerfile).toContain('EXEPAD_SOURCE_URL="https://git.example.org/a b"');
    });

    it('degrades to a licence URL when the build has no NOTICE', async () => {
      seedLicenseRoot(false);

      const res = await buildDeployableBundle({} as never, APP_ID);
      const names = Object.keys(res!.files);

      expect(names).toContain('LICENSE');
      expect(names).not.toContain('NOTICE');

      const readme = dec.decode(res!.files['README.md']);
      expect(readme).not.toContain('NOTICE                copyright');
      expect(readme).toContain('The `LICENSE` file here is that licence text.');
    });
  });
});
