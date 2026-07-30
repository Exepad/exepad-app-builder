// Real React SSR of a published page's first-fold code components → HTML with
// proper Suspense markers (`renderToPipeableStream`), for Stage-1 prerender.
//
// Why this works (proven by spike):
// the @exepad/sdk SOURCE uses real `import 'react'` — the `window.React` shim is
// browser-build-only — so bundling the SDK source (not the browser bundle) for
// Node yields a real React, and the compiled component modules render under
// react-dom/server. This module bundles the named components + the SDK source
// for Node with esbuild and streams them to an HTML string.
//
// NOTE: this renders the components in isolation (page content order). It is the
// render FOUNDATION; hydration-correct injection (matching the client's
// AppLayout→…→CodeComponent tree) + deploy wiring are the next increments.

import { build } from 'esbuild';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Bundle a Node-renderable module that default-exports `render(): Promise<string>`
 * rendering the given compiled components in order. Resolves @exepad/sdk/* to the
 * SDK source (real React) and react/react-dom from the client's node_modules.
 *
 * @param {object} o
 * @param {string[]} o.componentFiles  Absolute paths to compiled component .js (browser ESM, in paint order).
 * @param {string} o.repoRoot          Monorepo root (for client node_modules + SDK source).
 * @returns {Promise<string>} the rendered HTML (with Suspense markers).
 */
export async function renderFirstFoldToHtml({ componentFiles, repoRoot }) {
  if (!componentFiles?.length) return '';
  const CLIENT = join(repoRoot, 'apps/runtime/client');
  const SDK = join(repoRoot, 'packages/exepad-sdk/src');

  const imports = componentFiles
    .map((f, i) => `import C${i} from ${JSON.stringify(f)};`)
    .join('\n');
  const elements = componentFiles
    .map((_, i) => `React.createElement(C${i}, { key: ${i} })`)
    .join(', ');

  const harness = `
    import * as React from 'react';
    import { renderToPipeableStream } from 'react-dom/server';
    import { Writable } from 'node:stream';
    ${imports}
    export default function render() {
      return new Promise((resolve, reject) => {
        const tree = React.createElement(React.Fragment, null, ${elements});
        const chunks = [];
        const sink = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } });
        const { pipe } = renderToPipeableStream(tree, {
          onAllReady() { pipe(sink); },
          onError(err) { reject(err); },
        });
        sink.on('finish', () => resolve(Buffer.concat(chunks).toString('utf8')));
        sink.on('error', reject);
      });
    }
  `;

  // Browser-only subpaths unused for static SSR — stubbed so resolution proceeds.
  const stubPlugin = {
    name: 'ssr-stub',
    setup(b) {
      b.onResolve({ filter: /lucide-react\/dynamicIconImports/ }, () => ({ path: 'x', namespace: 'ssr-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'ssr-stub' }, () => ({
        contents: 'export default {}; export const dynamicIconImports = {};',
        loader: 'js',
      }));
    },
  };

  const res = await build({
    stdin: { contents: harness, resolveDir: CLIENT, loader: 'js' },
    absWorkingDir: CLIENT,
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    alias: {
      '@exepad/sdk/core': join(SDK, 'entries/core.ts'),
      '@exepad/sdk/icons': join(SDK, 'entries/icons.ts'),
      '@exepad/sdk/charts': join(SDK, 'entries/charts.ts'),
      '@exepad/sdk/motion': join(SDK, 'entries/motion.ts'),
      '@exepad/sdk/forms': join(SDK, 'entries/forms.ts'),
      '@exepad/sdk/overlays': join(SDK, 'entries/overlays.ts'),
      '@exepad/sdk': join(SDK, 'index.ts'),
    },
    loader: { '.ts': 'tsx', '.tsx': 'tsx' },
    jsx: 'automatic',
    conditions: ['default', 'import', 'node'],
    plugins: [stubPlugin],
    // react-dom/server's CJS does dynamic require('stream') — satisfy it in ESM.
    banner: { js: `import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);` },
    logLevel: 'silent',
  });

  const dir = mkdtempSync(join(tmpdir(), 'exepad-ssr-'));
  const out = join(dir, 'render.mjs');
  try {
    writeFileSync(out, res.outputFiles[0].text);
    const mod = await import(pathToFileURL(out).href);
    return await mod.default();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
