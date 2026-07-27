import { vi, describe, it, expect, beforeEach } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';

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
  frontend: {
    logic: { state: { count: 0, filter: 'all' } },
    pages: [
      { slug: '/', title: 'Home', content: [] },
      { slug: '/notes', title: 'Notes', content: [] },
    ],
  },
  backend: {
    models: [
      {
        name: 'notes',
        columns: [
          { name: 'id', type: 'integer', isNullable: false },
          { name: 'title', type: 'text', isNullable: false },
        ],
      },
    ],
  },
  repo: {
    frontend: {
      components: { Home: { source: 'code/frontend/components/Home.tsx' } },
      styles: { theme: { source: 'code/frontend/styles/theme.css' } },
      fonts: ['https://fonts.googleapis.com/css2?family=Inter&display=swap'],
    },
    backend: { handlers: { getPinned: { source: 'code/backend/handlers/getPinned.tsx' } } },
  },
};

function buildFiles(): Record<string, string> {
  return {
    [`${APP_ID}/preview/app-config.json`]: JSON.stringify(CONFIG),
    [`${APP_ID}/code/frontend/components/Home.tsx`]:
      "import { LightDOMContainer } from '@exepad/sdk/core';\n" +
      "import { Icons } from '@exepad/sdk/icons';\n" +
      "import { useModel } from '@exepad/sdk/core';\n" +
      'export default function Home() { return null; }',
    [`${APP_ID}/code/backend/handlers/getPinned.tsx`]: 'export default async () => ({});',
    [`${APP_ID}/code/frontend/styles/theme.css`]: '@theme { --color-primary: #7c3aed; --color-surface: #fff; }',
  };
}

describe('admin export — handover kit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOperatorOwnsApp.mockResolvedValue(true);
  });

  it('rejects a non-owner with 401', async () => {
    mockOperatorOwnsApp.mockResolvedValue(false);
    const res = await app.request(`/${APP_ID}/export/handover`, undefined, makeEnv(buildFiles()));
    expect(res.status).toBe(401);
  });

  it('404s when the app has no config', async () => {
    const res = await app.request(`/${APP_ID}/export/handover`, undefined, makeEnv({}));
    expect(res.status).toBe(404);
  });

  it('builds a handover zip with source + spec + per-app manifest', async () => {
    const res = await app.request(`/${APP_ID}/export/handover`, undefined, makeEnv(buildFiles()));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('demo-notes-handover.zip');

    const z = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(z).sort();

    // Agent entrypoint + spec + checklist
    expect(names).toContain('AGENTS.md');
    expect(names).toContain('CLAUDE.md');
    expect(names).toContain('.cursorrules');
    expect(names).toContain('spec/sdk-primitives.md');
    expect(names).toContain('spec/data-contract.md');
    expect(names).toContain('spec/theme.md');
    expect(names).toContain('spec/recipes/nextjs.md');
    expect(names).toContain('INTEGRATION_CHECKLIST.md');
    // Structure + verbatim source
    expect(names).toContain('app_config.json');
    expect(names).toContain('code/frontend/components/Home.tsx');
    expect(names).toContain('code/backend/handlers/getPinned.tsx');
    expect(names).toContain('code/frontend/styles/theme.css');

    // Per-app manifest reflects THIS app
    const manifest = JSON.parse(strFromU8(z['MANIFEST.json']));
    expect(manifest.app.name).toBe('Demo Notes');
    expect(manifest.pages.map((p: any) => p.slug).sort()).toEqual(['/', '/notes']);
    expect(manifest.state.sort()).toEqual(['count', 'filter']);
    expect(manifest.models[0].name).toBe('notes');
    // fields are extracted from the model's `columns` with name + type + nullable.
    expect(manifest.models[0].fields.map((f: any) => f.name).sort()).toEqual(['id', 'title']);
    expect(manifest.models[0].fields.find((f: any) => f.name === 'title').type).toBe('text');
    expect(manifest.models[0].fields.find((f: any) => f.name === 'id').nullable).toBe(false);
    expect(manifest.handlers).toContain('getPinned');
    expect(manifest.fonts.length).toBe(1);
    // SDK usage scanned from imports
    expect(manifest.sdkUsage.core.sort()).toEqual(['LightDOMContainer', 'useModel']);
    expect(manifest.sdkUsage.icons).toEqual(['Icons']);
    // theme tokens parsed from theme.css
    expect(manifest.theme.tokens).toContain('--color-primary');
  });
});
