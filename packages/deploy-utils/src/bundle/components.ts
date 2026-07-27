/**
 * Component Compilation Utilities
 *
 * Profile B esbuild: bundled with external React dependencies.
 */

import * as esbuild from 'esbuild';

import type { HandlerCompileResult } from './handlers';

/**
 * Compile a single remote component TypeScript file to JavaScript.
 *
 * Uses bundled mode with external React + Exepad runtime dependencies (Profile B):
 * - bundle: true (resolves all non-external imports)
 * - external: react, react/*, react-dom, react-dom/*, @exepad/* (sdk + extensions)
 * - format: esm, target: es2022
 *
 * `@exepad/sdk` (and any `@exepad/ext-*`) MUST stay external: the runtime resolves
 * these bare specifiers in the browser via the SPA import map
 * (`@exepad/sdk` → `/runtime_assets/dist/exepad-sdk.js`) when it dynamically
 * `import()`s the compiled component. Bundling them would fail to resolve at
 * compile time and double-load React at run time.
 */
export async function compileComponent(
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
      external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@exepad/sdk', '@exepad/*'],
      minify: false,
      sourcemap: false,
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
