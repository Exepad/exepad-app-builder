// Per-entry isolated SDK lib builds (ADDITIVE — never touches the monolith).
//
// WHY one Vite pass per entry (not a single multi-entry build):
//   - Vite LIB mode IGNORES `manualChunks`.
//   - Single-pass multi-entry + manualChunks LEAKS recharts/framer into core
//     (Rollup co-locates tiny shared utils into the heavy chunks).
//   By running an isolated Rollup pass per entry, each entry's source graph
//   never reaches the other entries' heavy deps, so by construction recharts
//   can only appear in the charts chunk and framer only in the motion chunk.
//   The cost: shared Radix/cn code duplicates across chunks (accepted).
//
// Output: stable-named additive files alongside the monolith in
//   apps/runtime/client/public/runtime_assets/dist/
//     exepad-sdk-core.js, -charts.js, -motion.js, -forms.js, -overlays.js, -icons.js
// The monolith (exepad-sdk.js + index-*.js + icons/*.js) is left untouched.

import { build } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeSubpathsJson } from './scripts/gen-subpaths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- react-from-window plugin (mirrors vite.config.ts; applied per entry) ---
// Routes react/react-dom (and the jsx-runtime) to window.React so every split
// chunk shares the host React instance, exactly like the monolith.
const reactFromWindowPlugin = {
  name: 'react-from-window',
  enforce: 'pre',
  resolveId(source) {
    if (source === 'react' || source.startsWith('react/')) {
      return { id: `\0virtual:${source}`, moduleSideEffects: false };
    }
    if (source === 'react-dom' || source.startsWith('react-dom/')) {
      return { id: `\0virtual:${source}`, moduleSideEffects: false };
    }
    return null;
  },
  load(id) {
    if (id === '\0virtual:react') {
      return `
        const React = window.React;
        if (!React) {
          console.error('[SDK] window.React not found! Ensure expose-react.ts loads before SDK.');
        }
        export default React;
        export const { useState, useEffect, useRef, useCallback, useMemo, useContext, useReducer, useLayoutEffect, useImperativeHandle, useDebugValue, forwardRef, memo, createContext, createElement, Fragment, Children, cloneElement, isValidElement, lazy, Suspense, startTransition, useTransition, useDeferredValue, useId, Component, PureComponent, createRef, useInsertionEffect, useSyncExternalStore } = React || {};
      `;
    }
    if (id === '\0virtual:react/jsx-runtime' || id === '\0virtual:react/jsx-dev-runtime') {
      return `
        const React = window.React;
        export const jsx = (type, props, key) => {
          const { children, ...rest } = props || {};
          const finalProps = key !== undefined ? { ...rest, key } : rest;
          if (Array.isArray(children)) {
            return React.createElement.apply(React, [type, finalProps].concat(children));
          }
          return React.createElement(type, finalProps, children);
        };
        export const jsxs = jsx;
        export const jsxDEV = jsx;
        export const Fragment = React.Fragment;
      `;
    }
    if (id === '\0virtual:react-dom') {
      return `
        const ReactDOM = window.ReactDOM;
        if (!ReactDOM) {
          console.error('[SDK] window.ReactDOM not found! Ensure expose-react.ts loads before SDK.');
        }
        export default ReactDOM;
        export const { createPortal, flushSync, findDOMNode, render, hydrate, unmountComponentAtNode } = ReactDOM || {};
      `;
    }
    if (id === '\0virtual:react-dom/client') {
      return `
        const ReactDOM = window.ReactDOM;
        export const createRoot = ReactDOM?.createRoot;
        export const hydrateRoot = ReactDOM?.hydrateRoot;
        export default { createRoot, hydrateRoot };
      `;
    }
    return null;
  },
};

const OUT_DIR = path.resolve(
  __dirname,
  '../../apps/runtime/client/public/runtime_assets/dist'
);

// fileName (no extension) → entry source. The leading `exepad-sdk-` keeps the
// split chunks namespaced next to the monolith `exepad-sdk.js`.
const ENTRIES = {
  'exepad-sdk-core': 'src/entries/core.ts',
  'exepad-sdk-charts': 'src/entries/charts.ts',
  'exepad-sdk-motion': 'src/entries/motion.ts',
  'exepad-sdk-forms': 'src/entries/forms.ts',
  'exepad-sdk-overlays': 'src/entries/overlays.ts',
  'exepad-sdk-icons': 'src/entries/icons.ts',
};

async function buildEntry(fileName, entryRel) {
  const entry = path.resolve(__dirname, entryRel);
  await build({
    configFile: false,
    plugins: [reactFromWindowPlugin, react({ jsxRuntime: 'classic' })],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    logLevel: 'warn',
    build: {
      outDir: OUT_DIR,
      emptyOutDir: false, // ADDITIVE — never delete the monolith
      lib: {
        entry,
        fileName: () => `${fileName}.js`,
        formats: ['es'],
      },
      rollupOptions: {
        external: [],
        output: {
          // Lazy icon chunks (lucide dynamicIconImports) — keep them in the
          // existing `icons/` namespace so they don't collide with the
          // monolith's already-emitted icon chunks of the same name/hash.
          chunkFileNames: 'icons/[name]-[hash].js',
          // Force everything reachable from this entry into the single entry
          // file (no shared-chunk extraction) so isolation holds.
          inlineDynamicImports: false,
        },
      },
      minify: 'terser',
      terserOptions: {
        compress: {
          passes: 3,
          drop_console: false,
          drop_debugger: true,
          pure_funcs: ['console.debug'],
        },
        mangle: {
          reserved: ['React', 'ReactDOM'],
        },
        format: { comments: false },
      },
    },
  });
  console.log(`  ✓ ${fileName}.js`);
}

async function main() {
  console.log('[build-split] Building per-entry isolated SDK chunks (additive)…');
  for (const [fileName, entryRel] of Object.entries(ENTRIES)) {
    await buildEntry(fileName, entryRel);
  }
  // Regenerate the agent's import-routing table from the (just-built) entries so
  // it can never drift from what the chunks actually export.
  writeSubpathsJson();
  console.log('[build-split] Done. Run `node scripts/check-split-chunks.mjs` to gate.');
}

main().catch((err) => {
  console.error('[build-split] FAILED:', err);
  process.exit(1);
});
