import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockOperatorOwnsApp = vi.fn();
vi.mock('../../../../worker/src/lib/admin-auth', () => ({
  operatorOwnsApp: (...args: unknown[]) => mockOperatorOwnsApp(...args),
}));

import { Hono } from 'hono';
import { exportRoutes } from '../../../../worker/src/routes/admin/export';

const app = new Hono();
app.route('/:appId/export', exportRoutes);

function makeEnv(files: Record<string, string>) {
  const enc = new TextEncoder();
  const CONFIG_CACHE = {
    async get(key: string) {
      if (!(key in files)) return null;
      const s = files[key];
      return {
        async text() {
          return s;
        },
        async arrayBuffer() {
          const u = enc.encode(s);
          return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
        },
      };
    },
    async head(key: string) {
      if (!(key in files)) return null;
      return { size: enc.encode(files[key]).length };
    },
  };
  return { CONFIG_CACHE } as unknown as Record<string, unknown>;
}

const APP_ID = 'test-app';

const CONFIG = {
  name: 'Demo Notes',
  uuid: 'demo-notes',
  frontend: {
    logic: { state: { count: 0 } },
    pages: [{ slug: '/', title: 'Home', content: [{ component: 'Home' }] }],
    header: [{ component: 'Header' }],
  },
  repo: {
    frontend: {
      components: {
        Home: { source: 'code/frontend/components/Home.tsx' },
        Header: { source: 'code/frontend/components/Header.tsx' },
      },
      styles: { theme: { source: 'code/frontend/styles/theme.css' } },
      fonts: ['https://fonts.googleapis.com/css2?family=Inter&display=swap'],
    },
  },
};

function buildFiles(): Record<string, string> {
  return {
    [`${APP_ID}/preview/app-config.json`]: JSON.stringify(CONFIG),
    [`${APP_ID}/code/frontend/components/Home.tsx`]: 'export default function Home() { return null; }',
    [`${APP_ID}/code/frontend/components/Header.tsx`]: 'export default function Header() { return null; }',
    [`${APP_ID}/code/frontend/styles/theme.css`]: '@import "tailwindcss";\n@source "./elsewhere";\n@theme { --color-primary: #7c3aed; }',
  };
}

describe('admin export — standalone project', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOperatorOwnsApp.mockResolvedValue(true);
  });

  it('rejects a non-owner with 401', async () => {
    mockOperatorOwnsApp.mockResolvedValue(false);
    const res = await app.request(`/${APP_ID}/export/source`, undefined, makeEnv(buildFiles()));
    expect(res.status).toBe(401);
  });

  it('generates a complete, coherent buildable project', async () => {
    const res = await app.request(`/${APP_ID}/export/source`, undefined, makeEnv(buildFiles()));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('demo-notes-source.zip');

    const z = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(z);

    // Scaffolding
    for (const f of [
      'package.json',
      'vite.config.ts',
      'tsconfig.json',
      'index.html',
      'src/main.tsx',
      'src/App.tsx',
      'src/exepad-host.ts',
      'src/components-manifest.ts',
      'src/index.css',
      'app_config.json',
      'README.md',
      '.gitignore',
    ]) {
      expect(names).toContain(f);
    }
    // Source placed under src/
    expect(names).toContain('src/code/frontend/components/Home.tsx');
    expect(names).toContain('src/code/frontend/styles/theme.css');

    // package.json: file: SDK dep + the tailwind/animate deps the theme needs
    const pkg = JSON.parse(strFromU8(z['package.json']));
    expect(pkg.dependencies['@exepad/sdk']).toBe('file:./vendor/exepad-sdk');
    expect(pkg.dependencies.react).toBeDefined();
    expect(pkg.devDependencies['@tailwindcss/vite']).toBeDefined();
    expect(pkg.devDependencies['tw-animate-css']).toBeDefined();

    // components-manifest statically imports BOTH entry components by name
    const manifest = strFromU8(z['src/components-manifest.ts']);
    expect(manifest).toContain('"Home":');
    expect(manifest).toContain('"Header":');
    expect(manifest).toContain('./code/frontend/components/Home');

    // theme.css copied with build-only @source stripped (kept tailwind import + tokens)
    const theme = strFromU8(z['src/code/frontend/styles/theme.css']);
    expect(theme).toContain('@import "tailwindcss"');
    expect(theme).toContain('--color-primary');
    expect(theme).not.toContain('@source');

    // index.html includes the app fonts + title
    const html = strFromU8(z['index.html']);
    expect(html).toContain('Demo Notes');
    expect(html).toContain('fonts.googleapis.com');
  });

  // AGPL §4/§5: the export conveys built Exepad code (the vendored SDK, and the
  // backend bundle when present), so it must carry the licence + an accurate
  // notice — not a "no Exepad dependency" claim.
  describe('licence conformance', () => {
    it('ships an accurate licensing notice covering all three bundled parts', async () => {
      const res = await app.request(`/${APP_ID}/export/source`, undefined, makeEnv(buildFiles()));
      const z = unzipSync(new Uint8Array(await res.arrayBuffer()));

      const readme = strFromU8(z['README.md']);
      expect(readme).toContain('## Licensing');
      expect(readme).toContain('vendor/exepad-sdk');
      expect(readme).toContain('GNU Affero General'); // wraps mid-phrase in the prose
      expect(readme).toContain('AGPL section 7 additional permission');
      expect(readme).toContain('LICENSING.md');
      // The generated scaffolding is accounted for, not just app + vendored SDK.
      expect(readme).toContain('src/exepad-host.ts');
      expect(readme).toContain('license under terms of');
      // AGPL §6: the conveyed object code names its Corresponding Source.
      expect(readme).toContain('built from Exepad');
      expect(readme).toContain('https://github.com/Exepad/exepad-app-builder');
      // The old framing ("no Exepad platform dependency") is gone.
      expect(readme).not.toContain('no Exepad platform dependency');
      // No doubled blank line in the Structure list (optional bullets are joined).
      expect(readme).not.toContain('\n\n\n');
    });

    // The project root belongs to the RECIPIENT's app, which is not AGPL. A root
    // LICENSE would make GitHub's licensee badge their proprietary repo
    // "AGPL-3.0" — the exact misimpression the readme dispels.
    it('never puts the AGPL text at the project root', async () => {
      const res = await app.request(`/${APP_ID}/export/source`, undefined, makeEnv(buildFiles()));
      const z = unzipSync(new Uint8Array(await res.arrayBuffer()));

      expect(Object.keys(z)).not.toContain('LICENSE');
      expect(Object.keys(z).filter((n) => /^LICEN[SC]E|^COPYING/i.test(n))).toEqual([]);
    });

    describe('with a vendored SDK on disk', () => {
      let root: string | null = null;
      const prev = process.env.EXEPAD_SDK_EJECT_DIR;

      afterEach(() => {
        if (prev === undefined) delete process.env.EXEPAD_SDK_EJECT_DIR;
        else process.env.EXEPAD_SDK_EJECT_DIR = prev;
        if (root) rmSync(root, { recursive: true, force: true });
        root = null;
      });

      /** A minimal dist-eject; `withLicense` mimics a build-eject run that copied
       *  the root LICENSE in (the current build) vs. one that did not (older). */
      function seedEjectDir(withLicense: boolean): void {
        root = mkdtempSync(join(tmpdir(), 'exepad-eject-'));
        mkdirSync(root, { recursive: true });
        writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@exepad/sdk' }));
        writeFileSync(join(root, 'index.js'), 'export const x=1;');
        if (withLicense) writeFileSync(join(root, 'LICENSE'), 'GNU AFFERO GENERAL PUBLIC LICENSE — from dist-eject\n');
        process.env.EXEPAD_SDK_EJECT_DIR = root;
      }

      it('backfills vendor/exepad-sdk/LICENSE when the eject build has none', async () => {
        seedEjectDir(false);
        const res = await app.request(`/${APP_ID}/export/source`, undefined, makeEnv(buildFiles()));
        const z = unzipSync(new Uint8Array(await res.arrayBuffer()));

        expect(Object.keys(z)).toContain('vendor/exepad-sdk/index.js');
        expect(strFromU8(z['vendor/exepad-sdk/LICENSE'])).toContain('AFFERO GENERAL PUBLIC LICENSE');
      });

      it("keeps the eject build's own LICENSE verbatim", async () => {
        seedEjectDir(true);
        const res = await app.request(`/${APP_ID}/export/source`, undefined, makeEnv(buildFiles()));
        const z = unzipSync(new Uint8Array(await res.arrayBuffer()));

        expect(strFromU8(z['vendor/exepad-sdk/LICENSE'])).toContain('from dist-eject');
      });

      // build-eject marks ONLY React external, so every other dependency —
      // including the shadcn/ui-derived primitives whose MIT copyright +
      // permission notice lives in NOTICE — is bundled into
      // vendor/exepad-sdk/*.js. MIT requires that notice to travel with those
      // bytes, so it ships in the same directory as their LICENSE.
      describe('third-party attribution (NOTICE)', () => {
        let licRoot: string | null = null;
        const prevLicense = process.env.EXEPAD_LICENSE_FILE;

        beforeEach(() => {
          licRoot = mkdtempSync(join(tmpdir(), 'exepad-lic-'));
          writeFileSync(
            join(licRoot, 'LICENSE'),
            'GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n',
          );
          writeFileSync(
            join(licRoot, 'NOTICE'),
            'Exepad\nshadcn/ui — MIT\nCopyright (c) 2023 shadcn — seeded notice\n',
          );
          process.env.EXEPAD_LICENSE_FILE = join(licRoot, 'LICENSE');
        });

        afterEach(() => {
          if (prevLicense === undefined) delete process.env.EXEPAD_LICENSE_FILE;
          else process.env.EXEPAD_LICENSE_FILE = prevLicense;
          if (licRoot) rmSync(licRoot, { recursive: true, force: true });
          licRoot = null;
        });

        it('ships NOTICE beside the vendored SDK, never at the project root', async () => {
          seedEjectDir(true);
          const res = await app.request(`/${APP_ID}/export/source`, undefined, makeEnv(buildFiles()));
          const z = unzipSync(new Uint8Array(await res.arrayBuffer()));

          expect(strFromU8(z['vendor/exepad-sdk/NOTICE'])).toContain('seeded notice');
          // Same rule as LICENSE: in the directory of the code it covers.
          expect(Object.keys(z)).not.toContain('NOTICE');

          const readme = strFromU8(z['README.md']);
          expect(readme).toContain('`vendor/exepad-sdk/NOTICE`');
          expect(readme).toContain('MIT');
          expect(readme).not.toContain('\n\n\n');
        });
      });
    });

    // The bundled backend (server/start.mjs) is a second, larger piece of built
    // Exepad code — it gets its own licence copy, in its own directory.
    describe('with a bundled backend on disk', () => {
      let root: string | null = null;
      const saved: Record<string, string | undefined> = {};

      beforeEach(() => {
        for (const k of [
          'EXEPAD_DATA_DIR',
          'EXEPAD_STANDALONE_BACKEND',
          'EXEPAD_SDK_EJECT_DIR',
          'EXEPAD_LICENSE_FILE',
        ]) {
          saved[k] = process.env[k];
        }
        // No vendored SDK in this group — the backend is the only Exepad code.
        delete process.env.EXEPAD_SDK_EJECT_DIR;

        root = mkdtempSync(join(tmpdir(), 'exepad-standalone-be-'));
        const appStore = join(root, 'data', 'storage', APP_ID);
        mkdirSync(join(appStore, 'published'), { recursive: true });
        writeFileSync(
          join(appStore, 'deployment-status-published.json'),
          JSON.stringify({ appId: APP_ID, status: 'success', configPath: 'published/app-config.json' }),
        );
        writeFileSync(join(appStore, 'published', 'app-config.json'), JSON.stringify({ name: 'Demo Notes' }));
        const backend = join(root, 'standalone-backend.mjs');
        writeFileSync(backend, '/* fake standalone backend bundle */');

        // Hermetic licence texts (never the checkout's own LICENSE/NOTICE).
        const lic = join(root, 'licence-root');
        mkdirSync(lic, { recursive: true });
        writeFileSync(join(lic, 'LICENSE'), 'GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3\n');
        writeFileSync(join(lic, 'NOTICE'), 'Exepad\nshadcn/ui — MIT — seeded notice\n');
        process.env.EXEPAD_LICENSE_FILE = join(lic, 'LICENSE');

        process.env.EXEPAD_DATA_DIR = join(root, 'data');
        process.env.EXEPAD_STANDALONE_BACKEND = backend;
      });

      afterEach(() => {
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
        if (root) rmSync(root, { recursive: true, force: true });
        root = null;
      });

      /** Export with no dist-eject resolvable: the cwd fallback is defeated by
       *  running from a clean temp root, so `vendored` is reliably false. */
      async function exportUnvendored(): Promise<Record<string, Uint8Array>> {
        const prevCwd = process.cwd();
        process.chdir(root!);
        try {
          const res = await app.request(`/${APP_ID}/export/source`, undefined, makeEnv(buildFiles()));
          return unzipSync(new Uint8Array(await res.arrayBuffer()));
        } finally {
          process.chdir(prevCwd);
        }
      }

      it('puts the AGPL text next to the backend bundle, not at the root', async () => {
        const res = await app.request(`/${APP_ID}/export/source`, undefined, makeEnv(buildFiles()));
        const z = unzipSync(new Uint8Array(await res.arrayBuffer()));

        expect(Object.keys(z)).toContain('server/start.mjs');
        expect(strFromU8(z['server/LICENSE'])).toContain('AFFERO GENERAL PUBLIC LICENSE');
        expect(Object.keys(z)).not.toContain('LICENSE');

        const readme = strFromU8(z['README.md']);
        expect(readme).toContain('server/LICENSE');
        expect(readme).toContain('server/start.mjs');
      });

      it('gives the backend bundle its own NOTICE too', async () => {
        const z = await exportUnvendored();

        expect(strFromU8(z['server/NOTICE'])).toContain('seeded notice');
        expect(Object.keys(z)).not.toContain('NOTICE');
        expect(strFromU8(z['README.md'])).toContain('`server/NOTICE`');
      });

      // LICENSING.md's "Exported Components" cover the backend bundle as well as
      // the SDK; the readme must not describe a NARROWER §7 grant than the one
      // the recipient actually has.
      it('extends the section 7 permission to the backend bundle', async () => {
        const res = await app.request(`/${APP_ID}/export/source`, undefined, makeEnv(buildFiles()));
        const readme = strFromU8(unzipSync(new Uint8Array(await res.arrayBuffer()))['README.md']);

        expect(readme).toContain('unmodified copy of the vendored SDK and backend bundle');
      });

      // Backend present but no dist-eject to vendor: only server/LICENSE is in
      // the zip, so the readme must not point at a vendor path that is absent.
      it('never names a vendored-SDK path that did not ship', async () => {
        const z = await exportUnvendored();

        expect(Object.keys(z)).not.toContain('vendor/exepad-sdk/LICENSE');
        expect(Object.keys(z)).not.toContain('vendor/exepad-sdk/NOTICE');

        const readme = strFromU8(z['README.md']);
        expect(readme).not.toContain('vendor/exepad-sdk/LICENSE');
        expect(readme).not.toContain('vendor/exepad-sdk/NOTICE');
        expect(readme).toContain('`server/LICENSE`');
        // …and the vendor folder is described as the placeholder it actually is.
        expect(readme).toContain('placeholder');
        expect(readme).not.toContain('\n\n\n');
      });
    });
  });
});
