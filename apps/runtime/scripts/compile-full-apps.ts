#!/usr/bin/env npx tsx
/**
 * Compile all full_apps example TSX components to browser-ready JS
 * using the same esbuild config as compile-code-components.ts
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FULL_APPS_DIR = path.resolve(__dirname, '../client/public/example/examples_for_agents/full_apps');

const externalizeExepadSdkPlugin: esbuild.Plugin = {
  name: 'externalize-exepad-sdk',
  setup(build) {
    build.onResolve({ filter: /^@exepad\// }, args => ({
      path: args.path,
      external: true,
    }));
  },
};

const reactFromWindowPlugin: esbuild.Plugin = {
  name: 'react-from-window',
  setup(build) {
    build.onResolve({ filter: /^react(\/.*)?$/ }, args => ({
      path: args.path,
      namespace: 'react-window',
    }));
    build.onLoad({ filter: /.*/, namespace: 'react-window' }, args => {
      if (args.path === 'react/jsx-runtime' || args.path === 'react/jsx-dev-runtime') {
        return {
          contents: `
            const React = window.React;
            export const jsx = (type, props, key) => {
              const { children, ...rest } = props || {};
              const finalProps = key !== undefined ? { ...rest, key } : rest;
              if (Array.isArray(children)) return React.createElement.apply(React, [type, finalProps].concat(children));
              return React.createElement(type, finalProps, children);
            };
            export const jsxs = jsx;
            export const jsxDEV = jsx;
            export const Fragment = React.Fragment;
          `,
          loader: 'js' as const,
        };
      }
      return {
        contents: `
          const React = window.React;
          export default React;
          export const { useState, useEffect, useRef, useCallback, useMemo, useContext, useReducer, useLayoutEffect, forwardRef, memo, createContext, createElement, Fragment, Children, cloneElement, isValidElement, lazy, Suspense, startTransition, useTransition, useDeferredValue, useId, Component, PureComponent } = React;
        `,
        loader: 'js' as const,
      };
    });
  },
};

async function main() {
  const apps = fs.readdirSync(FULL_APPS_DIR).filter(d => {
    const repoPath = path.join(FULL_APPS_DIR, d, 'repo');
    return fs.existsSync(repoPath) && fs.statSync(path.join(FULL_APPS_DIR, d)).isDirectory();
  });

  let total = 0, success = 0, failed = 0;

  for (const app of apps) {
    const codeDir = path.join(FULL_APPS_DIR, app, 'repo/frontend/code/components');
    const compiledDir = path.join(FULL_APPS_DIR, app, 'repo/frontend/compiled/components');

    if (!fs.existsSync(codeDir)) continue;

    const tsxFiles = fs.readdirSync(codeDir).filter(f => f.endsWith('.tsx'));

    for (const tsx of tsxFiles) {
      const inputPath = path.join(codeDir, tsx);
      const outputPath = path.join(compiledDir, tsx.replace('.tsx', '.js'));
      total++;

      try {
        await esbuild.build({
          entryPoints: [inputPath],
          bundle: true,
          format: 'esm',
          target: 'es2020',
          platform: 'browser',
          plugins: [externalizeExepadSdkPlugin, reactFromWindowPlugin],
          jsx: 'automatic',
          jsxImportSource: 'react',
          define: { 'process.env.NODE_ENV': '"production"' },
          outfile: outputPath,
          minify: true,
          sourcemap: false,
          treeShaking: true,
          write: true,
        });

        const size = fs.statSync(outputPath).size;
        console.log(`  ✅ ${app}/${tsx} → ${(size / 1024).toFixed(1)}KB`);
        success++;
      } catch (err: any) {
        console.log(`  ❌ ${app}/${tsx}: ${err.message?.slice(0, 300)}`);
        failed++;
      }
    }
  }

  console.log(`\nDone: ${success}/${total} compiled, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
