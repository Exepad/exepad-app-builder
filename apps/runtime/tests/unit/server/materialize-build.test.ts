// @vitest-environment node
/**
 * Unit tests for `worker/src/server/materialize-build.ts`.
 *
 * Focus (per task brief):
 *   - Error/fallback branches: a missing or malformed artifact must produce a
 *     CLEAN thrown Error (not an unhandled crash) and must NOT leave a partial
 *     build that the deploy pipeline would treat as complete.
 *   - `stripBuildTimeCssDirectives` (exercised through the fallback path): the
 *     raw theme.css fallback must never ship build-time `@import "tailwindcss"` /
 *     `@source "..."` directives to the browser, while URL/relative `@import`s
 *     (fonts) survive. A correctly-compiled stylesheet is left untouched.
 *   - Happy path: the expected output set (sources + compiled JS/CSS + config)
 *     materializes under the right `{appId}/...` keys.
 *
 * Harness mirrors the sibling `platform-orchestration.test.ts`: real
 * `FsStorageAdapter` for `CONFIG_CACHE` + the real `@exepad/deploy-utils`
 * compiler (no mocks) so the compile-throw branch is exercised by feeding the
 * real compiler genuinely broken TSX. `stripBuildTimeCssDirectives` is not
 * exported, so it is asserted via the bytes written to storage.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStorageAdapter } from '@exepad/local-adapters';

import { materializeBuild, type ArtifactMap } from '../../../worker/src/server/materialize-build';
import type { Env } from '../../../worker/src/types/env';

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-materialize-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function storageEnv(): Env {
  return {
    CONFIG_CACHE: new FsStorageAdapter() as unknown as R2Bucket,
  } as unknown as Env;
}

async function readKey(env: Env, key: string): Promise<string | null> {
  const obj = await env.CONFIG_CACHE.get(key);
  return obj ? await obj.text() : null;
}

// Unique appId per test so the shared FS storage dir never cross-contaminates.
let n = 0;
const nextAppId = (tag: string) => `mat${tag}${++n}`.replace(/[^a-z0-9]/gi, '').toLowerCase();

const VALID_COMPONENT_TSX =
  'export default function Hero() { return <div className="x">hello</div>; }';
const VALID_HANDLER_TSX =
  'export default async function doThing(ctx: any) { return { ok: true }; }';

// ---------------------------------------------------------------------------
// Missing / malformed top-level config artifact → clean throw
// ---------------------------------------------------------------------------

describe('materializeBuild — config artifact guards', () => {
  it('throws a clean Error when app_config.json artifact is absent', async () => {
    const env = storageEnv();
    await expect(
      materializeBuild(env, nextAppId('noconfig'), {} as ArtifactMap),
    ).rejects.toThrow(/no app_config\.json/i);
  });

  it('throws a clean Error (does not crash) on invalid JSON config', async () => {
    const env = storageEnv();
    await expect(
      materializeBuild(env, nextAppId('badjson'), {
        'app_config.json': '{ this is : not json',
      } as ArtifactMap),
    ).rejects.toThrow(/not valid JSON/i);
  });

  it('accepts a base64-encoded app_config.json artifact (artifactText decode)', async () => {
    const env = storageEnv();
    const appId = nextAppId('b64cfg');
    const cfg = { uuid: appId, name: 'B64', repo: {} };
    const artifacts: ArtifactMap = {
      'app_config.json': {
        mime_type: 'application/json',
        base64: Buffer.from(JSON.stringify(cfg), 'utf-8').toString('base64'),
      },
    };
    const result = await materializeBuild(env, appId, artifacts);
    expect(result.appConfig.uuid).toBe(appId);
    expect(result.configPath).toBe('preview/app-config.json');
  });
});

// ---------------------------------------------------------------------------
// Missing referenced sub-artifacts → clean throw, no completed config write
// ---------------------------------------------------------------------------

describe('materializeBuild — missing referenced artifact branches', () => {
  it('throws when a referenced component artifact is missing', async () => {
    const env = storageEnv();
    const appId = nextAppId('nocomp');
    const appConfig = {
      uuid: appId,
      repo: { frontend: { components: { Hero: { type: 'code_component' } } } },
    };
    await expect(
      materializeBuild(env, appId, {
        'app_config.json': JSON.stringify(appConfig),
      } as ArtifactMap),
    ).rejects.toThrow(/Missing component artifact: codefocus_component:Hero\.tsx/);

    // SECURITY/INTEGRITY: a failed materialize must NOT leave the final config
    // staged — the deploy pipeline reads the config last and would otherwise
    // treat a half-written build as complete.
    expect(await readKey(env, `${appId}/preview/app-config.json`)).toBeNull();
  });

  it('throws when a referenced supporting module artifact is missing', async () => {
    const env = storageEnv();
    const appId = nextAppId('nomod');
    const appConfig = {
      uuid: appId,
      repo: {
        frontend: {
          components: {
            Hero: { type: 'code_component', supporting_modules: ['Util'] },
          },
        },
      },
    };
    await expect(
      materializeBuild(env, appId, {
        'app_config.json': JSON.stringify(appConfig),
        'codefocus_component:Hero.tsx': VALID_COMPONENT_TSX,
      } as ArtifactMap),
    ).rejects.toThrow(/Missing supporting module artifact: codefocus_module:Util\.tsx/);
  });

  it('throws when a referenced handler artifact is missing', async () => {
    const env = storageEnv();
    const appId = nextAppId('nohandler');
    const appConfig = {
      uuid: appId,
      repo: { backend: { handlers: { doThing: {} } } },
    };
    await expect(
      materializeBuild(env, appId, {
        'app_config.json': JSON.stringify(appConfig),
      } as ArtifactMap),
    ).rejects.toThrow(/Missing handler artifact: handler_code:doThing\.tsx/);
  });
});

// ---------------------------------------------------------------------------
// Compile throws → clean Error (not unhandled), surfaces compiler errors
// ---------------------------------------------------------------------------

describe('materializeBuild — compile failure branches', () => {
  it('throws a clean Error when a component fails to compile (broken TSX)', async () => {
    const env = storageEnv();
    const appId = nextAppId('compfail');
    const appConfig = {
      uuid: appId,
      repo: { frontend: { components: { Bad: { type: 'code_component' } } } },
    };
    // Genuinely un-bundleable: imports a module that does not exist on disk.
    const brokenTsx =
      'import { Nope } from "./DoesNotExistModule";\nexport default function Bad(){ return <div>{Nope}</div>; }';
    await expect(
      materializeBuild(env, appId, {
        'app_config.json': JSON.stringify(appConfig),
        'codefocus_component:Bad.tsx': brokenTsx,
      } as ArtifactMap),
    ).rejects.toThrow(/Component "Bad" failed to compile/);

    // Source TSX may be staged, but the compiled JS must not exist and the
    // final config must not be written for a failed build.
    expect(await readKey(env, `${appId}/compiled/frontend/components/Bad.js`)).toBeNull();
    expect(await readKey(env, `${appId}/preview/app-config.json`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// stripBuildTimeCssDirectives — via the theme.css fallback path
// ---------------------------------------------------------------------------

describe('materializeBuild — CSS fallback directive stripping', () => {
  /** Build the minimal config + artifacts for a styles-only materialize. */
  function stylesFixture(appId: string, themeCss: string, compiledCss?: string) {
    const appConfig = {
      uuid: appId,
      repo: {
        frontend: {
          styles: {
            theme: {
              source: 'code/frontend/styles/theme.css',
              compiled: 'compiled/frontend/styles/theme.css',
            },
            compiled: {
              source: 'code/frontend/styles/theme.css',
              compiled: 'compiled/frontend/styles/compiled.css',
            },
          },
        },
      },
    };
    const artifacts: ArtifactMap = {
      'app_config.json': JSON.stringify(appConfig),
      'codefocus_style:theme.css': themeCss,
    };
    if (compiledCss != null) artifacts['codefocus_style:compiled.css'] = compiledCss;
    return artifacts;
  }

  it('strips bare @import "tailwindcss" and @source on the fallback path', async () => {
    const env = storageEnv();
    const appId = nextAppId('fallbackstrip');
    const themeCss = [
      '@import "tailwindcss";',
      "@import 'tw-animate-css';",
      '@source "./components";',
      ':root { --x: 1; }',
      '.x { color: red; }',
    ].join('\n');

    // No compiled.css artifact → fallback path runs the stripper.
    await materializeBuild(env, appId, stylesFixture(appId, themeCss));

    const shipped = await readKey(env, `${appId}/compiled/frontend/styles/compiled.css`);
    expect(shipped).not.toBeNull();
    // Build-only directives must be gone.
    expect(shipped).not.toMatch(/@import\s+["']tailwindcss["']/);
    expect(shipped).not.toMatch(/@import\s+["']tw-animate-css["']/);
    expect(shipped).not.toMatch(/@source\b/);
    // Real CSS rules survive.
    expect(shipped).toContain('--x: 1;');
    expect(shipped).toContain('.x { color: red; }');
  });

  it('preserves URL/relative @import (e.g. Google Fonts) on the fallback path', async () => {
    const env = storageEnv();
    const appId = nextAppId('fonturl');
    const fontImport = '@import url(https://fonts.googleapis.com/css2?family=Inter);';
    const schemeImport = '@import "https://example.com/x.css";';
    const relImport = '@import "./local.css";';
    const themeCss = [
      fontImport,
      schemeImport,
      relImport,
      '@import "tailwindcss";', // bare — should be stripped
      'body { margin: 0; }',
    ].join('\n');

    await materializeBuild(env, appId, stylesFixture(appId, themeCss));

    const shipped = await readKey(env, `${appId}/compiled/frontend/styles/compiled.css`);
    expect(shipped).not.toBeNull();
    expect(shipped).toContain(fontImport);
    expect(shipped).toContain(schemeImport);
    expect(shipped).toContain(relImport);
    // The bare tailwindcss import is still removed.
    expect(shipped).not.toMatch(/@import\s+["']tailwindcss["']/);
    expect(shipped).toContain('body { margin: 0; }');
  });

  it('writes theme.css keys from the compiled artifact when the theme.css source is absent', async () => {
    // The RecipeVault failure: a build shipped only the Tailwind output, no
    // theme.css source artifact. The runtime fetches compiled/.../theme.css, so
    // that key must not dangle (404 → unstyled). The defensive fallback writes
    // the compiled artifact to the theme keys.
    const env = storageEnv();
    const appId = nextAppId('themeabsent');
    const artifacts = stylesFixture(appId, undefined as unknown as string, '.btn { color: teal; }');
    delete artifacts['codefocus_style:theme.css']; // truly absent
    await materializeBuild(env, appId, artifacts);

    const themeAtRuntimeUrl = await readKey(env, `${appId}/compiled/frontend/styles/theme.css`);
    expect(themeAtRuntimeUrl).not.toBeNull();
    expect(themeAtRuntimeUrl).toContain('teal');
    const themeSource = await readKey(env, `${appId}/code/frontend/styles/theme.css`);
    expect(themeSource).not.toBeNull();
    // compiled.css still ships.
    const compiled = await readKey(env, `${appId}/compiled/frontend/styles/compiled.css`);
    expect(compiled).toContain('teal');
  });

  it('does NOT strip directives when a real compiled.css artifact is present', async () => {
    const env = storageEnv();
    const appId = nextAppId('nostrip');
    // theme.css contains build directives, but compiled.css is the shipped one.
    const themeCss = '@import "tailwindcss";\n:root { --t: 0; }';
    // A real compiled stylesheet would not contain these, but assert the
    // no-op nature: whatever is in compiled.css is what ships, unmodified
    // (and a correctly-compiled file contains no bare directives anyway).
    const compiledCss = '.btn { display: flex; }\n.card { gap: 4px; }';

    await materializeBuild(env, appId, stylesFixture(appId, themeCss, compiledCss));

    const shipped = await readKey(env, `${appId}/compiled/frontend/styles/compiled.css`);
    expect(shipped).toBe(compiledCss);

    // theme.css source + compiled-theme copies still land verbatim.
    expect(await readKey(env, `${appId}/code/frontend/styles/theme.css`)).toBe(themeCss);
    expect(await readKey(env, `${appId}/compiled/frontend/styles/theme.css`)).toBe(themeCss);
  });

  it('handles @source / @import with leading whitespace and trailing junk', async () => {
    const env = storageEnv();
    const appId = nextAppId('wsstrip');
    const themeCss = [
      '   @source "./components";',
      '\t@import "tailwindcss" layer(base);',
      '.keep { color: blue; }',
    ].join('\n');

    await materializeBuild(env, appId, stylesFixture(appId, themeCss));

    const shipped = await readKey(env, `${appId}/compiled/frontend/styles/compiled.css`);
    expect(shipped).not.toMatch(/@source\b/);
    expect(shipped).not.toMatch(/@import\s+["']tailwindcss["']/);
    expect(shipped).toContain('.keep { color: blue; }');
  });
});

// ---------------------------------------------------------------------------
// Happy path — full expected output set
// ---------------------------------------------------------------------------

describe('materializeBuild — happy path output set', () => {
  it('writes sources, compiled JS, compiled CSS, and config under {appId}/ keys', async () => {
    const env = storageEnv();
    const appId = nextAppId('happy');

    const appConfig = {
      uuid: appId,
      name: 'Happy',
      repo: {
        frontend: {
          components: {
            Hero: {
              type: 'code_component',
              source: 'code/frontend/components/Hero.tsx',
              compiled: 'compiled/frontend/components/Hero.js',
            },
          },
          styles: {
            theme: {
              source: 'code/frontend/styles/theme.css',
              compiled: 'compiled/frontend/styles/theme.css',
            },
            compiled: {
              source: 'code/frontend/styles/theme.css',
              compiled: 'compiled/frontend/styles/compiled.css',
            },
          },
        },
        backend: {
          handlers: {
            doThing: {
              source: 'code/backend/handlers/doThing.tsx',
              compiled: 'compiled/backend/handlers/doThing.js',
            },
          },
        },
        seed: {
          rows: { source: 'code/seed/rows.csv' },
        },
      },
    };

    const artifacts: ArtifactMap = {
      'app_config.json': JSON.stringify(appConfig),
      'codefocus_component:Hero.tsx': VALID_COMPONENT_TSX,
      'handler_code:doThing.tsx': VALID_HANDLER_TSX,
      'codefocus_style:theme.css': ':root { --x: 1; }',
      'codefocus_style:compiled.css': '.x { color: red; }',
      'seed:rows.csv': 'id,name\n1,a\n',
    };

    const result = await materializeBuild(env, appId, artifacts);
    expect(result.configPath).toBe('preview/app-config.json');
    expect(result.appConfig.uuid).toBe(appId);

    // Compiled component JS — JSX lowered, no .tsx type annotations.
    const componentJs = await readKey(env, `${appId}/compiled/frontend/components/Hero.js`);
    expect(componentJs).not.toBeNull();
    expect(componentJs).toContain('createElement');

    // Compiled handler JS — type annotation stripped.
    const handlerJs = await readKey(env, `${appId}/compiled/backend/handlers/doThing.js`);
    expect(handlerJs).not.toBeNull();
    expect(handlerJs).toContain('ok');
    expect(handlerJs).not.toContain(': any');

    // Sources land verbatim.
    expect(await readKey(env, `${appId}/code/frontend/components/Hero.tsx`)).toBe(
      VALID_COMPONENT_TSX,
    );
    expect(await readKey(env, `${appId}/code/backend/handlers/doThing.tsx`)).toBe(
      VALID_HANDLER_TSX,
    );

    // Styles (no fallback → compiled artifact shipped untouched).
    expect(await readKey(env, `${appId}/compiled/frontend/styles/compiled.css`)).toBe(
      '.x { color: red; }',
    );

    // Seed CSV written to its config-referenced path.
    expect(await readKey(env, `${appId}/code/seed/rows.csv`)).toBe('id,name\n1,a\n');

    // Config written last, fully-staged.
    const cfg = await readKey(env, `${appId}/preview/app-config.json`);
    expect(cfg).not.toBeNull();
    expect(JSON.parse(cfg!).uuid).toBe(appId);
  });

  it('honors a custom configKey option for the config write path', async () => {
    const env = storageEnv();
    const appId = nextAppId('customkey');
    const artifacts: ArtifactMap = {
      'app_config.json': JSON.stringify({ uuid: appId, repo: {} }),
    };
    const result = await materializeBuild(env, appId, artifacts, {
      configKey: 'published/v3/app-config.json',
    });
    expect(result.configPath).toBe('published/v3/app-config.json');
    expect(await readKey(env, `${appId}/published/v3/app-config.json`)).not.toBeNull();
    // Default preview path was NOT written.
    expect(await readKey(env, `${appId}/preview/app-config.json`)).toBeNull();
  });

  it('skips seed entries whose CSV artifact is absent (no throw)', async () => {
    const env = storageEnv();
    const appId = nextAppId('seedskip');
    const appConfig = {
      uuid: appId,
      repo: { seed: { missing: { source: 'code/seed/missing.csv' } } },
    };
    // No seed:missing.csv artifact — must be tolerated, config still completes.
    const result = await materializeBuild(env, appId, {
      'app_config.json': JSON.stringify(appConfig),
    } as ArtifactMap);
    expect(result.configPath).toBe('preview/app-config.json');
    expect(await readKey(env, `${appId}/code/seed/missing.csv`)).toBeNull();
    expect(await readKey(env, `${appId}/preview/app-config.json`)).not.toBeNull();
  });
});
