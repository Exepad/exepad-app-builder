#!/usr/bin/env npx tsx
/**
 * Compile Example Code Components
 *
 * Walks all example directories under public/example/, finds configs with
 * repo.frontend.components, and compiles each component's TSX source to JS using
 * esbuild with the React-from-window plugin (same pipeline as deploy).
 *
 * Usage:
 *   npx tsx scripts/compile-example-components.ts           # one-shot
 *   npx tsx scripts/compile-example-components.ts --watch   # watch mode
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXAMPLES_DIR = path.resolve(__dirname, '../client/public/example');

// ============================================================================
// esbuild Plugins (same as compile-code-components.ts)
// ============================================================================

const externalizeExepadSdkPlugin: esbuild.Plugin = {
  name: 'externalize-exepad-sdk',
  setup(build) {
    build.onResolve({ filter: /^@exepad\// }, (args) => ({
      path: args.path,
      external: true,
    }));
  },
};

const reactFromWindowPlugin: esbuild.Plugin = {
  name: 'react-from-window',
  setup(build) {
    build.onResolve({ filter: /^react(\/.*)?$/ }, (args) => ({
      path: args.path,
      namespace: 'react-window',
    }));

    build.onLoad({ filter: /.*/, namespace: 'react-window' }, (args) => {
      if (args.path === 'react/jsx-runtime' || args.path === 'react/jsx-dev-runtime') {
        return {
          contents: `
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
          `,
          loader: 'js' as const,
        };
      }
      return {
        contents: `
          const React = window.React;
          export default React;
          export const { useState, useEffect, useRef, useCallback, useMemo, useContext, useReducer, useLayoutEffect, useImperativeHandle, useDebugValue, forwardRef, memo, createContext, createElement, Fragment, Children, cloneElement, isValidElement, lazy, Suspense, startTransition, useTransition, useDeferredValue, useId, Component, PureComponent } = React;
        `,
        loader: 'js' as const,
      };
    });
  },
};

// ============================================================================
// Helpers
// ============================================================================

const WATCH_MODE = process.argv.includes('--watch');

interface ComponentEntry {
  source: string;
  compiled: string;
  summary?: string;
}

interface ComponentMapping {
  sourcePath: string;
  outputPath: string;
  name: string;
}

/**
 * Recursively find all JSON config files that contain repo.frontend.components.
 */
function findConfigsWithComponents(dir: string): { configPath: string; appDir: string; components: Record<string, ComponentEntry> }[] {
  const results: { configPath: string; appDir: string; components: Record<string, ComponentEntry> }[] = [];

  function walk(d: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.startsWith('.')) {
        try {
          const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
          const components = data?.repo?.frontend?.components;
          if (components && typeof components === 'object' && Object.keys(components).length > 0) {
            // Check that at least one component has source + compiled fields
            const valid = Object.values(components).some(
              (c: any) => c?.source && c?.compiled
            );
            if (valid) {
              results.push({ configPath: full, appDir: path.dirname(full), components });
            }
          }
        } catch {
          // Not valid JSON or can't read - skip
        }
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Build the flat list of source → output mappings from all configs.
 */
function buildComponentMappings(): ComponentMapping[] {
  const configs = findConfigsWithComponents(EXAMPLES_DIR);
  const mappings: ComponentMapping[] = [];

  for (const { appDir, components } of configs) {
    for (const [name, config] of Object.entries(components)) {
      if (!config.source || !config.compiled) continue;
      const sourcePath = path.join(appDir, 'repo', config.source);
      const outputPath = path.join(appDir, 'repo', config.compiled);
      if (fs.existsSync(sourcePath)) {
        mappings.push({ sourcePath, outputPath, name });
      }
    }
  }

  return mappings;
}

/**
 * Compile a single component TSX → JS.
 */
async function compileOne(mapping: ComponentMapping): Promise<boolean> {
  fs.mkdirSync(path.dirname(mapping.outputPath), { recursive: true });
  try {
    await esbuild.build({
      entryPoints: [mapping.sourcePath],
      outfile: mapping.outputPath,
      bundle: true,
      format: 'esm',
      target: 'es2020',
      platform: 'browser',
      plugins: [externalizeExepadSdkPlugin, reactFromWindowPlugin],
      jsx: 'automatic',
      jsxImportSource: 'react',
      define: { 'process.env.NODE_ENV': '"production"' },
      minify: true,
      sourcemap: false,
      treeShaking: true,
      write: true,
    });
    return true;
  } catch (err) {
    const rel = path.relative(EXAMPLES_DIR, mapping.sourcePath);
    console.warn(`   ⚠ ${mapping.name} (${rel}): ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

// ============================================================================
// Initial compilation
// ============================================================================

async function compileAll() {
  console.log('📦 Compiling example code components...');

  const mappings = buildComponentMappings();
  let compiled = 0;
  let skipped = 0;
  let failed = 0;

  for (const mapping of mappings) {
    // Skip if compiled file already exists and is newer than source
    if (fs.existsSync(mapping.outputPath)) {
      const srcStat = fs.statSync(mapping.sourcePath);
      const outStat = fs.statSync(mapping.outputPath);
      if (outStat.mtimeMs >= srcStat.mtimeMs) {
        skipped++;
        continue;
      }
    }

    if (await compileOne(mapping)) {
      compiled++;
    } else {
      failed++;
    }
  }

  if (compiled > 0 || failed > 0) {
    console.log(`   ✓ ${compiled} compiled, ${skipped} up-to-date, ${failed} failed`);
  } else {
    console.log(`   ✓ All ${skipped} components up-to-date`);
  }

  return mappings;
}

// ============================================================================
// Watch mode
// ============================================================================

function startWatcher(mappings: ComponentMapping[]) {
  // Build a lookup: source path → mapping
  const bySource = new Map<string, ComponentMapping>();
  for (const m of mappings) {
    bySource.set(m.sourcePath, m);
  }

  // Collect unique directories to watch
  const watchDirs = new Set<string>();
  for (const m of mappings) {
    watchDirs.add(path.dirname(m.sourcePath));
  }

  // Debounce per file to avoid duplicate triggers
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  console.log(`👀 Watching ${mappings.length} component source files for changes...`);

  for (const dir of watchDirs) {
    fs.watch(dir, (_eventType: string, filename: string | null) => {
      if (!filename || !filename.endsWith('.tsx')) return;
      const fullPath = path.join(dir, filename);
      const mapping = bySource.get(fullPath);
      if (!mapping) return;

      // Debounce: wait 100ms before compiling
      const existing = timers.get(fullPath);
      if (existing) clearTimeout(existing);

      timers.set(fullPath, setTimeout(async () => {
        timers.delete(fullPath);
        const rel = path.relative(EXAMPLES_DIR, fullPath);
        const ok = await compileOne(mapping);
        if (ok) {
          console.log(`   ✓ Recompiled ${rel}`);
        }
      }, 100));
    });
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const mappings = await compileAll();

  if (WATCH_MODE) {
    startWatcher(mappings);
    // Keep process alive
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
