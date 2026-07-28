import { vi, describe, it, expect, beforeEach } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';

// ── Mock auth (module-level) ─────────────────────────────────────
const mockOperatorOwnsApp = vi.fn();

vi.mock('../../../../worker/src/lib/admin-auth', () => ({
  operatorOwnsApp: (...args: unknown[]) => mockOperatorOwnsApp(...args),
}));

// ── Import Hono router (AFTER mocks) ────────────────────────────
import { Hono } from 'hono';
import { source } from '../../../../worker/src/routes/admin/source';

const app = new Hono();
app.route('/:appId/source', source);

// ── In-memory CONFIG_CACHE (R2-surface subset the route uses) ────
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
  name: 'My Demo App',
  repo: {
    frontend: {
      components: {
        Hero: { source: 'code/frontend/components/Hero.tsx', supporting_modules: ['Helper'] },
      },
      styles: {
        theme: { source: 'code/frontend/styles/theme.css' },
      },
    },
    backend: {
      handlers: {
        getData: { source: 'code/backend/handlers/getData.tsx' },
      },
    },
  },
};

/** A storage state that mirrors a real build, plus an ORPHAN from a prior build. */
function buildFiles(): Record<string, string> {
  return {
    [`${APP_ID}/${'preview/app-config.json'}`]: JSON.stringify(CONFIG),
    [`${APP_ID}/code/frontend/components/Hero.tsx`]: 'export default function Hero() { return null; }',
    [`${APP_ID}/code/frontend/components/Helper.tsx`]: 'export const Helper = 1;',
    [`${APP_ID}/code/frontend/styles/theme.css`]: ':root { --x: 1; }',
    [`${APP_ID}/code/backend/handlers/getData.tsx`]: 'export default async () => ({});',
    // Orphan: a renamed/removed component a prior build left behind. The
    // config-driven walk must NOT surface it.
    [`${APP_ID}/code/frontend/components/OldName.tsx`]: 'export default function OldName() {}',
  };
}

describe('admin source routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOperatorOwnsApp.mockResolvedValue(true);
  });

  it('rejects a non-owner with 401 (tree)', async () => {
    mockOperatorOwnsApp.mockResolvedValue(false);
    const res = await app.request(`/${APP_ID}/source`, undefined, makeEnv(buildFiles()));
    expect(res.status).toBe(401);
  });

  it('rejects a non-owner with 401 (download)', async () => {
    mockOperatorOwnsApp.mockResolvedValue(false);
    const res = await app.request(`/${APP_ID}/source/download`, undefined, makeEnv(buildFiles()));
    expect(res.status).toBe(401);
  });

  it('lists config-referenced source + app_config, EXCLUDING orphans', async () => {
    const res = await app.request(`/${APP_ID}/source`, undefined, makeEnv(buildFiles()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { files: { path: string; size: number }[]; appName: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.appName).toBe('My Demo App');
    const paths = body.data.files.map((f) => f.path).sort();
    expect(paths).toEqual(
      [
        'code/backend/handlers/getData.tsx',
        'code/frontend/components/Helper.tsx',
        'code/frontend/components/Hero.tsx',
        'code/frontend/styles/theme.css',
      ].sort(),
    );
    // The orphan from a prior build must not appear.
    expect(paths).not.toContain('code/frontend/components/OldName.tsx');
    // app_config.json is intentionally NOT exposed in the source tree.
    expect(paths).not.toContain('app_config.json');
  });

  it('serves a single source file as text', async () => {
    const res = await app.request(
      `/${APP_ID}/source/file?path=code/frontend/components/Hero.tsx`,
      undefined,
      makeEnv(buildFiles()),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toContain('function Hero');
  });

  it('does NOT expose app_config.json (404)', async () => {
    const res = await app.request(
      `/${APP_ID}/source/file?path=app_config.json`,
      undefined,
      makeEnv(buildFiles()),
    );
    expect(res.status).toBe(404);
  });

  it('404s on an orphan / non-referenced / traversal path', async () => {
    const files = makeEnv(buildFiles());
    for (const bad of [
      'code/frontend/components/OldName.tsx', // exists on disk but not in config
      'app_config.json', // config is no longer exposed
      '../../meta.sqlite',
      'code/../../secrets',
      'preview/app-config.json', // the real config key is not directly fetchable
    ]) {
      const res = await app.request(
        `/${APP_ID}/source/file?path=${encodeURIComponent(bad)}`,
        undefined,
        files,
      );
      expect(res.status).toBe(404);
    }
  });

  it('404s when the app has no config yet', async () => {
    const res = await app.request(`/${APP_ID}/source`, undefined, makeEnv({}));
    expect(res.status).toBe(404);
  });

  it('downloads a coherent zip (README + source, no config, no orphan)', async () => {
    const res = await app.request(`/${APP_ID}/source/download`, undefined, makeEnv(buildFiles()));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    // The read-only mirror uses a distinct name so it never collides with the
    // buildable-project export (`<slug>-source.zip`).
    expect(res.headers.get('content-disposition')).toContain('my-demo-app-source-mirror.zip');

    const bytes = new Uint8Array(await res.arrayBuffer());
    const unzipped = unzipSync(bytes);
    const names = Object.keys(unzipped).sort();
    expect(names).toContain('README.md');
    expect(names).toContain('code/frontend/components/Hero.tsx');
    expect(names).toContain('code/frontend/components/Helper.tsx');
    expect(names).not.toContain('code/frontend/components/OldName.tsx');
    expect(names).not.toContain('app_config.json');
    expect(strFromU8(unzipped['code/frontend/components/Hero.tsx'])).toContain('function Hero');
  });
});
