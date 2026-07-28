/**
 * Handler Compilation Utilities
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Handler compilation result
 */
export interface HandlerCompileResult {
  success: boolean;
  outputPath?: string;
  errors?: string[];
}

/**
 * Lightweight backend shim for @exepad/sdk.
 * The SDK is a frontend package (React, UI components, lodash, etc.), but
 * backend handlers only use utility exports like `_` (lodash). This shim
 * provides a minimal backend-compatible module so that handlers can be
 * compiled without installing the full SDK.
 */
const SDK_SHIM_SOURCE = `
export const React = {};
export const ReactDOM = {};
function round(n, p = 0) { const f = 10 ** p; return Math.round(n * f) / f; }
function get(o, p, d) { const k = typeof p === 'string' ? p.split('.') : p; let v = o; for (const s of k) { if (v == null) return d; v = v[s]; } return v === undefined ? d : v; }
function sum(a) { return (a || []).reduce((s, v) => s + (v || 0), 0); }
function sumBy(a, fn) { return (a || []).reduce((s, v) => s + (typeof fn === 'function' ? fn(v) : (v && v[fn]) || 0), 0); }
function groupBy(a, fn) { return (a || []).reduce((r, v) => { const k = typeof fn === 'function' ? fn(v) : v[fn]; (r[k] = r[k] || []).push(v); return r; }, {}); }
function orderBy(a, keys, orders) { return [...(a || [])].sort((x, y) => { for (let i = 0; i < keys.length; i++) { const k = keys[i]; const d = (orders && orders[i]) === 'desc' ? -1 : 1; if (x[k] < y[k]) return -1 * d; if (x[k] > y[k]) return 1 * d; } return 0; }); }
function uniqBy(a, fn) { const s = new Set(); return (a || []).filter(v => { const k = typeof fn === 'function' ? fn(v) : v[fn]; if (s.has(k)) return false; s.add(k); return true; }); }
export const _ = { round, get, sum, sumBy, groupBy, orderBy, uniqBy };
`;

/**
 * esbuild plugin that intercepts `import { _ } from '@exepad/sdk'` and
 * replaces it with the inline SDK shim. Used by `compileHandler()` /
 * `compileHandlers()` which call `esbuild.build()` (Node.js only).
 */
const sdkBackendShim: esbuild.Plugin = {
  name: 'exepad-sdk-backend-shim',
  setup(build) {
    build.onResolve({ filter: /^@exepad\/sdk$/ }, () => ({
      path: '@exepad/sdk',
      namespace: 'sdk-shim',
    }));
    build.onLoad({ filter: /.*/, namespace: 'sdk-shim' }, () => ({
      contents: SDK_SHIM_SOURCE,
      loader: 'js',
    }));
  },
};

/**
 * Compile a single handler TypeScript file to JavaScript
 */
export async function compileHandler(
  sourcePath: string,
  outputPath: string
): Promise<HandlerCompileResult> {
  try {
    const result = await esbuild.build({
      entryPoints: [sourcePath],
      outfile: outputPath,
      bundle: true,
      format: 'esm',
      target: 'es2022',
      platform: 'browser',
      minify: false, // Keep readable for debugging
      sourcemap: false,
      treeShaking: true,
      plugins: [sdkBackendShim],
      logLevel: 'warning',
    });

    if (result.errors.length > 0) {
      return {
        success: false,
        errors: result.errors.map((e) => e.text),
      };
    }

    return {
      success: true,
      outputPath,
    };
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * Compile all handlers in a directory
 */
export async function compileHandlers(
  sourceDir: string,
  outputDir: string
): Promise<{
  success: boolean;
  compiled: string[];
  errors: Record<string, string[]>;
}> {
  const compiled: string[] = [];
  const errors: Record<string, string[]> = {};

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Find all TypeScript files (.ts and .tsx) (L5)
  const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));

  for (const file of files) {
    const sourcePath = path.join(sourceDir, file);
    const baseName = file.replace(/\.tsx?$/, '');
    const outputPath = path.join(outputDir, `${baseName}.js`);

    const result = await compileHandler(sourcePath, outputPath);

    if (result.success) {
      compiled.push(baseName);
    } else {
      errors[file] = result.errors || ['Unknown error'];
    }
  }

  return {
    success: Object.keys(errors).length === 0,
    compiled,
    errors,
  };
}

/**
 * Compile handler source code from a string (no filesystem needed).
 *
 * Uses `esbuild.transform()` instead of `esbuild.build()`, so it works in
 * environments without filesystem access (e.g., Cloudflare Workers).
 *
 * Since `transform()` doesn't resolve imports, `@exepad/sdk` imports are
 * replaced by prepending the SDK shim and rewriting the import statement.
 *
 * @param source — Raw .ts/.tsx source code
 * @param loader — esbuild loader, defaults to 'tsx'
 * @returns Compiled JavaScript string
 */
export async function compileHandlerSource(
  source: string,
  loader: 'ts' | 'tsx' = 'tsx',
): Promise<{ success: boolean; code?: string; errors?: string[] }> {
  try {
    // Replace @exepad/sdk import with inline shim.
    // esbuild.transform() is single-file and can't resolve external modules,
    // so we prepend the shim code and rewrite the import to reference it.
    let processedSource = source;
    const sdkImportPattern = /import\s+\{([^}]+)\}\s+from\s+['"]@exepad\/sdk['"];?/g;
    if (sdkImportPattern.test(source)) {
      // Prepend shim and remove the original import (the shim exports match)
      processedSource = SDK_SHIM_SOURCE + '\n' + source.replace(
        /import\s+\{[^}]+\}\s+from\s+['"]@exepad\/sdk['"];?/g,
        '// @exepad/sdk resolved via inline shim above',
      );
    }

    const result = await esbuild.transform(processedSource, {
      loader,
      format: 'esm',
      target: 'es2022',
      minify: false,
      treeShaking: true,
    });

    if (result.warnings.length > 0) {
      // Warnings are non-fatal, log but don't fail
    }

    return { success: true, code: result.code };
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}
