/**
 * Method Compilation Utilities
 * 
 * Compiles TSX source files to JavaScript for both backend handlers
 * and frontend methods (computed values and actions).
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Options for compiling app methods
 */
export interface CompileOptions {
  /** Directories containing backend handlers (relative to appDir) */
  backend: string[];
  /** Directories containing frontend methods (relative to appDir) */
  frontend: string[];
}

/**
 * Result of compilation
 */
export interface CompileResult {
  /** Whether all compilations succeeded */
  success: boolean;
  /** List of successfully compiled files (relative paths) */
  compiled: string[];
  /** Errors by filename */
  errors: Record<string, string[]>;
}

/**
 * Compile a single TSX file to JavaScript
 */
export async function compileTsxFile(
  sourcePath: string,
  outputPath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await esbuild.build({
      entryPoints: [sourcePath],
      outfile: outputPath,
      bundle: false,
      format: 'esm',
      target: 'es2022',
      platform: 'browser',
      minify: false,
      sourcemap: false,
      logLevel: 'warning',
      jsx: 'automatic',
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Find all TSX files in a directory (non-recursive)
 */
function findTsxFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((f) => f.endsWith('.tsx'));
}

/**
 * Ensure a directory exists
 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Compile all TSX methods in an app directory
 * 
 * @param appDir - Root directory of the app (e.g., apps/runtime/client/public/example/backend-demo)
 * @param options - Directories to compile
 * @returns Compilation result with list of compiled files and any errors
 * 
 * @example
 * ```typescript
 * const result = await compileAppMethods('/path/to/backend-demo', {
 *   backend: ['backend/handlers'],
 *   frontend: ['frontend/computed', 'frontend/actions'],
 * });
 * ```
 */
export async function compileAppMethods(
  appDir: string,
  options: CompileOptions
): Promise<CompileResult> {
  const compiled: string[] = [];
  const errors: Record<string, string[]> = {};

  const allDirs = [...options.backend, ...options.frontend];

  for (const relDir of allDirs) {
    const sourceDir = path.join(appDir, relDir);
    
    if (!fs.existsSync(sourceDir)) {
      console.log(`  Skipping ${relDir} (directory not found)`);
      continue;
    }

    const files = findTsxFiles(sourceDir);
    
    if (files.length === 0) {
      console.log(`  No TSX files in ${relDir}`);
      continue;
    }

    console.log(`  Compiling ${files.length} file(s) in ${relDir}...`);

    for (const file of files) {
      const sourcePath = path.join(sourceDir, file);
      const outputPath = path.join(sourceDir, file.replace('.tsx', '.js'));

      const result = await compileTsxFile(sourcePath, outputPath);

      if (result.success) {
        const relativePath = path.relative(appDir, outputPath);
        compiled.push(relativePath);
        console.log(`    ✓ ${file} → ${file.replace('.tsx', '.js')}`);
      } else {
        errors[file] = [result.error || 'Unknown error'];
        console.log(`    ✗ ${file}: ${result.error}`);
      }
    }
  }

  return {
    success: Object.keys(errors).length === 0,
    compiled,
    errors,
  };
}

/**
 * Watch and compile TSX files on change
 * Note: This is a simple implementation. For production, consider using chokidar.
 */
export async function watchAppMethods(
  appDir: string,
  options: CompileOptions,
  onChange?: (result: CompileResult) => void
): Promise<{ stop: () => void }> {
  const allDirs = [...options.backend, ...options.frontend];
  const watchers: fs.FSWatcher[] = [];

  for (const relDir of allDirs) {
    const sourceDir = path.join(appDir, relDir);
    
    if (!fs.existsSync(sourceDir)) {
      continue;
    }

    const watcher = fs.watch(sourceDir, async (eventType, filename) => {
      if (filename && filename.endsWith('.tsx')) {
        console.log(`\n  File changed: ${relDir}/${filename}`);
        const result = await compileAppMethods(appDir, options);
        onChange?.(result);
      }
    });

    watchers.push(watcher);
  }

  return {
    stop: () => {
      watchers.forEach((w) => w.close());
    },
  };
}
