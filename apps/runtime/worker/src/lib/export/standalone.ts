/**
 * Standalone-project builder (D2): generate a complete, buildable Vite + React
 * project from an app's source. The components are placed verbatim under src/;
 * scaffolding + a host shim + a config-driven assembler are generated; the
 * eject-built SDK (packages/exepad-sdk/dist-eject) is vendored in so
 * `npm install && npm run build` works with no platform dependency.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { strToU8 } from 'fflate';
import type { Env } from '../../types/env';
import {
  enumerateSource,
  appNameOf,
  slug,
  readEntryBytes,
  MAX_ZIP_BYTES,
  ExportTooLargeError,
} from './source-set';
import { packPublishedAppData } from './app-data';
import {
  resolveEjectDir,
  resolveStandaloneBackend,
  readRootLicense,
  readRootNotice,
  exepadSourceRef,
} from './artifacts';
import * as T from './templates/standalone';

const dec = new TextDecoder();

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function walkDir(dir: string, base = dir): { rel: string; bytes: Uint8Array }[] {
  const out: { rel: string; bytes: Uint8Array }[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...walkDir(abs, base));
    else if (st.isFile()) {
      out.push({ rel: relative(base, abs).split(sep).join('/'), bytes: new Uint8Array(readFileSync(abs)) });
    }
  }
  return out;
}

/** Build-time-only `@source` directives confuse a standalone Tailwind v4 build
 *  (it auto-detects content); strip them from the theme stylesheet copy. */
function sanitizeThemeCss(bytes: Uint8Array): Uint8Array {
  const css = dec.decode(bytes).replace(/^[ \t]*@source\b[^;]*;[ \t]*$\n?/gim, '');
  return strToU8(css);
}

export async function buildStandaloneProject(
  env: Env,
  appId: string,
): Promise<{ files: Record<string, Uint8Array>; appName: string; vendored: boolean } | null> {
  const { configRaw, entries } = await enumerateSource(env, appId);
  if (configRaw == null) return null;

  const appName = appNameOf(configRaw);
  let cfg: any = {};
  try {
    cfg = JSON.parse(configRaw);
  } catch {
    cfg = {};
  }

  const compEntries: Record<string, { source?: string }> = cfg.repo?.frontend?.components ?? {};
  const components = Object.entries(compEntries)
    .map(([name, e]) => ({ name, source: e?.source }))
    .filter((c) => typeof c.source === 'string')
    .map((c) => ({ name: c.name, importPath: './' + (c.source as string).replace(/\.tsx?$/, '') }));
  const fonts: string[] = Array.isArray(cfg.repo?.frontend?.fonts) ? cfg.repo.frontend.fonts : [];
  const { version: exepadVersion, sourceUrl: exepadSourceUrl } = exepadSourceRef();
  const inputs: T.StandaloneInputs = {
    appName,
    slug: slug(appName),
    components,
    fonts,
    exepadVersion,
    exepadSourceUrl,
  };

  const out: Record<string, Uint8Array> = {};
  let total = 0;
  const add = (path: string, bytes: Uint8Array) => {
    total += bytes.length;
    if (total > MAX_ZIP_BYTES) throw new ExportTooLargeError();
    out[path] = bytes;
  };
  const addText = (path: string, text: string) => add(path, strToU8(text));

  // Source files verbatim under src/ (theme.css sanitized for a standalone build).
  const { files: sourceFiles } = await readEntryBytes(env, entries);
  for (const [p, b] of Object.entries(sourceFiles)) {
    add('src/' + p, p.endsWith('styles/theme.css') ? sanitizeThemeCss(b) : b);
  }

  // Vendor the eject-built SDK.
  const ejectDir = resolveEjectDir();
  let vendored = false;
  if (ejectDir) {
    for (const f of walkDir(ejectDir)) add('vendor/exepad-sdk/' + f.rel, f.bytes);
    vendored = true;
  } else {
    addText(
      'vendor/exepad-sdk/README.md',
      '# Vendored SDK missing\n\nThe SDK was not vendored at export time. Run ' +
        '`pnpm --filter @exepad/sdk build:eject` and copy `packages/exepad-sdk/dist-eject/*` ' +
        'into this folder, then `npm install`.\n',
    );
  }

  // ── Vendored full-stack backend (K3) — a minimal /rpc + static server over
  // the app's published snapshot + SQLite. Present only when the app has a
  // published deployment AND the prebuilt backend bundle is available; otherwise
  // the project is frontend-only (data hooks no-op / VITE_API_BASE).
  let hasBackend = false;
  const backendBundle = resolveStandaloneBackend();
  if (backendBundle) {
    const packed = await packPublishedAppData(add, appId, 'server/data/');
    if (packed) {
      add('server/start.mjs', new Uint8Array(readFileSync(backendBundle)));
      addText('server/app.json', JSON.stringify({ appId }, null, 2) + '\n');
      hasBackend = true;
    }
  }

  // AGPL §4/§5: the Exepad code conveyed in this download (the vendored SDK, and
  // the backend bundle when present) must travel with its licence. build-eject
  // writes a LICENSE into dist-eject, so the walk above normally carries the
  // vendored copy already — only fill the gap when it does not (older eject).
  //
  // NOTICE travels with the same bytes for a separate reason: build-eject marks
  // only React external, so every other dependency — including the MIT-licensed
  // shadcn/ui-derived primitives — is BUNDLED into vendor/exepad-sdk/*.js, and
  // MIT requires its copyright + permission notice to accompany substantial
  // portions. The same third-party code rides along in the backend bundle.
  //
  // Deliberately NOT at the project root: the root belongs to the RECIPIENT's
  // own application (which is not AGPL — see the readme's Licensing section),
  // and a root LICENSE would make GitHub badge their repo "AGPL-3.0". Each copy
  // sits in the directory of the Exepad code it actually covers. Both texts
  // degrade to absent (readme adapts) rather than failing the export.
  const licenseBytes = readRootLicense();
  const noticeBytes = readRootNotice();
  if (licenseBytes) {
    if (vendored && !('vendor/exepad-sdk/LICENSE' in out)) {
      add('vendor/exepad-sdk/LICENSE', licenseBytes);
    }
    if (hasBackend) add('server/LICENSE', licenseBytes);
  }
  if (noticeBytes) {
    if (vendored && !('vendor/exepad-sdk/NOTICE' in out)) {
      add('vendor/exepad-sdk/NOTICE', noticeBytes);
    }
    if (hasBackend) add('server/NOTICE', noticeBytes);
  }

  addText('app_config.json', prettyJson(configRaw));
  addText('package.json', T.packageJson(inputs, hasBackend));
  addText('vite.config.ts', T.VITE_CONFIG);
  addText('tsconfig.json', T.TSCONFIG);
  addText('index.html', T.indexHtml(inputs));
  addText('src/main.tsx', T.MAIN_TSX);
  addText('src/App.tsx', T.APP_TSX);
  addText('src/index.css', T.INDEX_CSS);
  addText('src/exepad-host.ts', T.EXEPAD_HOST_TS);
  addText('src/components-manifest.ts', T.componentsManifest(inputs));
  addText('.gitignore', T.GITIGNORE);
  addText('.env.example', T.ENV_EXAMPLE);
  // The readme must only ever name paths that really shipped: the SDK is
  // vendored only when the eject build was resolvable, the backend only when the
  // app is published, and each licence/attribution copy only when its text was
  // found (the eject build may ship its own LICENSE). Derive the directories
  // from `out` itself so the two can never drift.
  const EXEPAD_DIRS = ['vendor/exepad-sdk', 'server'];
  const licenseDirs = EXEPAD_DIRS.filter((d) => `${d}/LICENSE` in out);
  const noticeDirs = EXEPAD_DIRS.filter((d) => `${d}/NOTICE` in out);
  addText('README.md', T.readme(inputs, hasBackend, vendored, licenseDirs, noticeDirs));

  return { files: out, appName, vendored };
}
