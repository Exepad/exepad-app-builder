// Stage-1 prerender: render a published page's FULL client app tree in Node and
// return the HTML that belongs inside `#root` — hydration-correct (it carries the
// same Suspense-boundary structure the browser produces, via
// `renderToPipeableStream`), so the client `hydrateRoot`s over it with no flash
// and no React #418.
//
// Why this is hydration-correct where `renderFirstFold.mjs` (isolated components)
// and the old headless capture were not:
//   * It mounts the SAME tree the client mounts — the real `router` shape
//     (`/*` splat → AppLayout → AppPage → ClientPageRenderer → DynamicRenderer →
//     CodeComponent's Suspense boundary), so boundary structure matches.
//   * It initializes the component registry AND primes the first-fold component
//     modules synchronously BEFORE render, so CodeComponent resolves + renders
//     real content on its first render (the client reproduces both before
//     `hydrateRoot` in main.tsx → first renders match).
//   * `renderToPipeableStream` emits the `<!--$-->` Suspense markers the client
//     needs to adopt lazy boundaries.
//
// The SDK SOURCE uses real `import 'react'` (the `window.React` shim is
// browser-build-only), so bundling the SDK source + compiled components for Node
// yields a real React render. happy-dom supplies the `document`/`window` the
// render path reads synchronously (config blob, route mode).

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// esbuild + happy-dom live in the client package (not deploy-utils), so resolve
// them from there at call time rather than via bare top-level imports that the
// deploy-utils package graph can't see.
async function loadToolchain(repoRoot) {
  const { createRequire } = await import('node:module');
  const req = createRequire(join(repoRoot, 'apps/runtime/client/package.json'));
  const [{ build }, happy] = await Promise.all([
    import(pathToFileURL(req.resolve('esbuild')).href),
    import(pathToFileURL(req.resolve('happy-dom')).href),
  ]);
  return { build, Window: happy.Window };
}

/**
 * @param {object} o
 * @param {string}  o.repoRoot   Monorepo root.
 * @param {string}  o.appId      e.g. "ag35xetdj".
 * @param {string}  o.basePath   e.g. "/a/ag35xetdj" (path-mode registry base).
 * @param {string}  o.pagePath   Router entry, e.g. "/a/ag35xetdj/about".
 * @param {object}  o.config     Full published WebAppProps (for inline config + registry repo).
 * @param {Array<{file:string,url:string}>} o.components  First-fold compiled components
 *        (header + page content + footer, in tree order). `file` = abs path to the
 *        compiled .js, `url` = the runtime URL CodeComponent resolves (registry base
 *        + /repo/ + compiled path).
 * @returns {Promise<{ html: string, errors: string[] }>} `html` is the `#root` innerHTML.
 */
export async function renderAppPageToHtml({ repoRoot, appId, basePath, pagePath, config, components }) {
  const { build, Window } = await loadToolchain(repoRoot);
  const CLIENT = join(repoRoot, 'apps/runtime/client');
  const SDK = join(repoRoot, 'packages/exepad-sdk/src');

  const compImports = components
    .map((c, i) => `import C${i} from ${JSON.stringify(c.file)};`)
    .join('\n');
  const primeCalls = components
    .map((c, i) => `primeCodeComponentModule(${JSON.stringify(c.url)}, C${i});`)
    .join('\n');

  // The harness mirrors router.tsx's server-appId branch exactly (path '/*' →
  // withSuspense(AppLayout) → child '*' withSuspense(AppPage)) so the SSR
  // Suspense structure matches the client router's.
  const harness = `
import * as React from 'react';
import { StrictMode, lazy, Suspense } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Writable } from 'node:stream';
import { initializeComponentRegistry } from '@/lib/componentRegistry';
import { primeCodeComponentModule } from '@/app_runtime/runtime/components/custom/code/CodeComponent';
import { preloadComponents, getRegisteredComponentTypes } from '@/registry';
import { extractImageDims } from '@/lib/imageDimensionGuard';
${compImports}

// Bake width/height onto unsized code-component imgs whose dimensions are
// encoded in the URL (the same dims the runtime imageDimensionGuard would set
// post-mount). Without this the prerendered hero ships with no reserved box and
// shifts everything below it when it loads (measured CLS 0.238). Reuses the
// guard's exact extractor so server and client agree.
function bakeImgDims(html) {
  return html.replace(/<img\\b[^>]*>/g, (tag) => {
    if (/\\b(width|height)=/.test(tag)) return tag;
    const m = tag.match(/\\bsrc="([^"]+)"/);
    if (!m) return tag;
    const d = extractImageDims(m[1]);
    if (!d) return tag;
    return tag.replace(/^<img\\b/, \`<img width="\${d.w}" height="\${d.h}"\`);
  });
}

const AppLayout = lazy(() => import('@/pages/AppLayout'));
const AppPage = lazy(() => import('@/pages/AppPage'));
const RouterErrorBoundary = lazy(() => import('@/pages/RouterErrorBoundary'));

function lazyFallback() {
  return React.createElement(
    'div', { className: 'flex items-center justify-center min-h-screen' },
    React.createElement('div', { className: 'animate-pulse text-muted-foreground' }, 'Loading...'),
  );
}
function withSuspense(C) {
  return React.createElement(Suspense, { fallback: lazyFallback() }, React.createElement(C));
}

export default async function render() {
  // Two synchronous-on-first-render prerequisites the client normally only meets
  // via post-mount effects: (1) the runtime registry must hold CodeComponent so
  // DynamicRenderer's getComponentSync returns it (else it renders its empty
  // loading slot); (2) the repo registry + the first-fold modules must be primed
  // so CodeComponent resolves + renders real content. main.tsx reproduces both
  // before hydrateRoot.
  initializeComponentRegistry(${JSON.stringify(config.repo ?? null)}, ${JSON.stringify(basePath)});
  await preloadComponents(getRegisteredComponentTypes());
${primeCalls}
  const router = createMemoryRouter([
    {
      path: '/*',
      element: withSuspense(AppLayout),
      errorElement: withSuspense(RouterErrorBoundary),
      children: [{ path: '*', element: withSuspense(AppPage) }],
    },
  ], { initialEntries: [${JSON.stringify(pagePath)}] });

  const tree = React.createElement(StrictMode, null, React.createElement(RouterProvider, { router }));
  const errors = [];
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sink = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } });
    const { pipe } = renderToPipeableStream(tree, {
      onAllReady() { pipe(sink); },
      // A boundary error renders its fallback; record it but don't fail the whole
      // page — partial prerender still beats none, and we surface errors upstream.
      onError(err) { errors.push(String(err && err.stack || err)); },
    });
    sink.on('finish', () => resolve({ html: bakeImgDims(Buffer.concat(chunks).toString('utf8')), errors }));
    sink.on('error', reject);
  });
}
`;

  // The SDK source uses `@/` to mean ITS OWN src, while esbuild applies the
  // client tsconfig's `@/`→client/src globally. Disambiguate by importer: an
  // `@/` import originating inside the SDK source resolves against the SDK src;
  // everything else falls through to the client tsconfig paths.
  const sdkAtAlias = {
    name: 'sdk-at-alias',
    setup(b) {
      b.onResolve({ filter: /^@\// }, async (args) => {
        if (!/exepad-sdk[\\/]src[\\/]/.test(args.importer)) return undefined;
        const r = await b.resolve('./' + args.path.slice(2), { kind: args.kind, resolveDir: SDK });
        if (r.errors.length) return { errors: r.errors };
        return { path: r.path, external: r.external };
      });
    },
  };

  // Browser-only subpaths unused for static SSR — stubbed so resolution proceeds.
  const stubPlugin = {
    name: 'ssr-stub',
    setup(b) {
      b.onResolve({ filter: /lucide-react\/dynamicIconImports/ }, () => ({ path: 'x', namespace: 'ssr-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'ssr-stub' }, () => ({
        contents: 'export default {}; export const dynamicIconImports = {};',
        loader: 'js',
      }));
      // Vite asset query suffixes (?url / ?raw / ?inline / ?worker) — strip to a
      // bare specifier so esbuild can resolve the underlying file.
      b.onResolve({ filter: /\?(url|raw|inline|worker)$/ }, (args) => ({
        path: join(args.resolveDir, args.path.replace(/\?(url|raw|inline|worker)$/, '')),
      }));
    },
  };

  const res = await build({
    stdin: { contents: harness, resolveDir: CLIENT, loader: 'js' },
    absWorkingDir: CLIENT,
    tsconfig: join(CLIENT, 'tsconfig.json'),
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
    loader: {
      '.ts': 'tsx',
      '.tsx': 'tsx',
      '.css': 'empty',
      '.svg': 'dataurl',
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.jpeg': 'dataurl',
      '.gif': 'dataurl',
      '.webp': 'dataurl',
      '.woff': 'empty',
      '.woff2': 'empty',
      '.json': 'json',
    },
    jsx: 'automatic',
    conditions: ['default', 'import', 'node'],
    define: {
      'import.meta.env': JSON.stringify({ PROD: true, DEV: false, MODE: 'production', SSR: true }),
      'import.meta.hot': 'undefined',
    },
    plugins: [sdkAtAlias, stubPlugin],
    // react-dom/server's CJS does dynamic require('stream') — satisfy it in ESM.
    banner: { js: `import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);` },
    logLevel: 'silent',
  });

  // happy-dom must be live on globalThis BEFORE the bundle is imported (its module
  // graph touches document/window when the lazy pages resolve during render).
  const cleanupDom = installHappyDom({ Window, appId, basePath, pagePath, config });

  const dir = mkdtempSync(join(tmpdir(), 'exepad-ssr-page-'));
  const out = join(dir, 'render.mjs');
  try {
    writeFileSync(out, res.outputFiles[0].text);
    const mod = await import(pathToFileURL(out).href);
    const { html, errors } = await mod.default();
    return { html, errors };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cleanupDom();
  }
}

/**
 * Stand up a happy-dom window + document seeded with the `#root` attributes and
 * the `__exepad_config` blob the render path reads synchronously, and mirror the
 * needed globals onto `globalThis`. Returns a cleanup fn that restores them.
 */
function installHappyDom({ Window, appId, basePath, pagePath, config }) {
  const url = `https://prerender.local${pagePath}`;
  const win = new Window({ url });
  const doc = win.document;
  // The SDK's `useNavigation` fallback reads `window.__EXEPAD_BASE_PATH__` during
  // RENDER to derive `currentSlug` (which drives active-nav state, etc.).
  // ExposePlatformGlobal sets it during its own render, but that component sits
  // AFTER the header/content in the tree, so a first render would otherwise see
  // it unset → wrong slug → markup that won't match the client. Seed it up front
  // so the server's first render matches the client's (main.tsx seeds it too).
  win.__EXEPAD_BASE_PATH__ = basePath;
  const configJson = JSON.stringify(config).replace(/</g, '\\u003c');
  doc.documentElement.innerHTML =
    `<head></head><body>` +
    `<div id="root" data-app-id="${appId}" data-app-mode="published" data-route-mode="path"></div>` +
    `<script type="application/json" id="__exepad_config" data-app-id="${appId}">${configJson}</script>` +
    `</body>`;

  // Minimal browser-API stubs the render path / effects may touch. Effects don't
  // run under renderToPipeableStream, but module-scope and lazy-init reads might.
  const noopObs = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  win.matchMedia = win.matchMedia || ((q) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
  }));
  win.IntersectionObserver = win.IntersectionObserver || noopObs;
  win.ResizeObserver = win.ResizeObserver || noopObs;
  win.requestIdleCallback = win.requestIdleCallback || ((cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 0));
  win.cancelIdleCallback = win.cancelIdleCallback || ((id) => clearTimeout(id));

  const names = [
    'window', 'document', 'navigator', 'location', 'history', 'customElements',
    'HTMLElement', 'Element', 'Node', 'Text', 'DocumentFragment', 'Event',
    'CustomEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame',
    'cancelAnimationFrame', 'matchMedia', 'IntersectionObserver', 'ResizeObserver',
    'requestIdleCallback', 'cancelIdleCallback', 'NodeFilter', 'DOMParser',
  ];
  const restore = [];
  for (const name of names) {
    const value = name === 'window' ? win : win[name];
    if (value === undefined) continue;
    const had = Object.prototype.hasOwnProperty.call(globalThis, name);
    const prev = had ? globalThis[name] : undefined;
    restore.push(() => {
      try {
        if (had) globalThis[name] = prev;
        else delete globalThis[name];
      } catch { /* getter-only — leave as is */ }
    });
    // Node 22 exposes some globals (navigator) as getter-only — assignment throws;
    // fall back to defineProperty, and skip if even that is refused.
    try {
      globalThis[name] = value;
    } catch {
      try {
        Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
      } catch { /* immutable host global — render path tolerates the real one */ }
    }
  }

  return () => {
    for (const fn of restore) fn();
    try { win.happyDOM?.close?.(); } catch { /* best effort */ }
  };
}
