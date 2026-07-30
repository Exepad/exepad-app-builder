import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Plugin that replaces React imports with window.React for browser runtime.
 * 
 * This ensures the SDK uses the same React instance as the host application,
 * avoiding the "multiple React instances" problem that occurs when React is
 * loaded both via Next.js bundle AND via import map.
 * 
 * Uses enforce: 'pre' to run before @vitejs/plugin-react
 */
const reactFromWindowPlugin: Plugin = {
  name: 'react-from-window',
  enforce: 'pre',  // Run before other plugins
  resolveId(source) {
    // Intercept all react and react-dom imports
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
  }
};

export default defineConfig({
  plugins: [
    reactFromWindowPlugin,
    // Use classic JSX transform to avoid jsx-runtime imports
    react({ jsxRuntime: 'classic' })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    // Output directly to the runtime app's public directory for the import map
    outDir: '../../apps/runtime/client/public/runtime_assets/dist',
    emptyOutDir: false, // Don't delete other files in the directory
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      // The file name format matching your import map 
      fileName: 'exepad-sdk',
      formats: ['es'], // strictly ESM for browser support
    },
    rollupOptions: {
      // React is now handled by reactFromWindowPlugin - no externals needed
      external: [],
      output: {}
    },
    // Aggressive minification — Lighthouse flagged esbuild's default minify
    // as leaving ~27% inflation (169 KiB savings available on a 629 KiB
    // gzipped artifact). Terser with multiple compression passes catches
    // what esbuild leaves behind and is worth the slower build time
    // because this file is loaded by every generated app.
    minify: 'terser',
    terserOptions: {
      compress: {
        passes: 3,
        drop_console: false, // keep console for runtime diagnostics
        drop_debugger: true,
        pure_funcs: ['console.debug'],
      },
      mangle: {
        // Don't mangle React-global property names — they must match
        // window.React's runtime shape.
        reserved: ['React', 'ReactDOM'],
      },
      format: {
        comments: false,
      },
    },
  }
});
