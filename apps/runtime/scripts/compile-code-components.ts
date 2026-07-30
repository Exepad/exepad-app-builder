#!/usr/bin/env npx tsx
/**
 * Compile Code Components Script
 * 
 * Uses esbuild to compile TSX source files into standalone ES modules
 * that can be loaded dynamically by the CodeComponent system.
 * 
 * The compiled modules use React from the host application's window.React
 * global, so they don't bundle their own copy of React.
 * 
 * Usage:
 *   npx tsx scripts/compile-code-components.ts [path]
 *   npm run compile:remote
 * 
 * With path (e.g., "my_app"):
 *   Input:  public/demo/assets/{path}/src/*.tsx
 *   Output: public/demo/assets/{path}/js/*.js
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

function getConfig(customPath?: string) {
  if (customPath) {
    // Custom path: look in public/demo/assets/{customPath}/src/ directory
    const baseDir = path.resolve(__dirname, '../client/public/demo/assets');
    const targetDir = path.resolve(baseDir, customPath);
    return {
      srcDir: path.resolve(targetDir, 'src'),
      outDir: path.resolve(targetDir, 'js'),
    };
  }
  
  // Default: src/ -> compiled/ (for backward compatibility)
  const baseDir = path.resolve(__dirname, '../client/public/runtime_assets');
  return {
    srcDir: path.resolve(baseDir, 'src'),
    outDir: path.resolve(baseDir, 'compiled'),
  };
}

// Parse command line argument (optional path)
const customPath = process.argv[2];
const CONFIG = getConfig(customPath);

// Banner that injects React from the host's window object
// This allows the compiled module to use React without bundling it
const REACT_BANNER = `
const React = window.React;
const { useState, useEffect, useRef, useCallback, useMemo, useContext, createContext, forwardRef, memo, Fragment } = React;
`;

// ============================================================================
// Utilities
// ============================================================================

function kebabCase(str: string): string {
  return str
    // Handle acronyms: CTA -> cta, not c-t-a
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    // Handle normal camelCase
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function findTsxFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      // Recursively search subdirectories
      results.push(...findTsxFilesRecursive(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      results.push(fullPath);
    }
  }
  
  return results;
}

async function getSourceFiles(): Promise<string[]> {
  if (!fs.existsSync(CONFIG.srcDir)) {
    console.error(`❌ Source directory does not exist: ${CONFIG.srcDir}`);
    process.exit(1);
  }
  
  return findTsxFilesRecursive(CONFIG.srcDir);
}

// ============================================================================
// esbuild Plugin: Externalize @exepad/* packages
// ============================================================================

/**
 * Plugin that marks all @exepad/* imports as external.
 * This covers @exepad/sdk and @exepad/ext-* extension imports.
 * The imports will be preserved in the output and resolved at runtime
 * via the browser's import map.
 */
const externalizeExepadSdkPlugin: esbuild.Plugin = {
  name: 'externalize-exepad-sdk',
  setup(build) {
    // Mark all @exepad/* as external - preserve import statements
    build.onResolve({ filter: /^@exepad\// }, args => {
      return {
        path: args.path,
        external: true,
      };
    });
  },
};

// ============================================================================
// esbuild Plugin: React from Window (Legacy fallback)
// ============================================================================

/**
 * Plugin that replaces React imports with references to window.React
 * This is a fallback for components that import directly from 'react'
 * instead of '@exepad/sdk'
 */
const reactFromWindowPlugin: esbuild.Plugin = {
  name: 'react-from-window',
  setup(build) {
    // Intercept all React-related imports
    build.onResolve({ filter: /^react(\/.*)?$/ }, args => {
      return {
        path: args.path,
        namespace: 'react-window',
      };
    });

    // Return empty module - React comes from banner
    build.onLoad({ filter: /.*/, namespace: 'react-window' }, args => {
      // For react/jsx-runtime, export jsx functions that use React.createElement
      if (args.path === 'react/jsx-runtime' || args.path === 'react/jsx-dev-runtime') {
        return {
          contents: `
            const React = window.React;
            export const jsx = (type, props, key) => {
              const { children, ...rest } = props || {};
              const finalProps = key !== undefined ? { ...rest, key } : rest;
              // Handle children: if array, spread as args; otherwise pass as single arg
              if (Array.isArray(children)) {
                return React.createElement.apply(React, [type, finalProps].concat(children));
              }
              return React.createElement(type, finalProps, children);
            };
            export const jsxs = (type, props, key) => {
              // jsxs is specifically for multiple children (arrays)
              const { children, ...rest } = props || {};
              const finalProps = key !== undefined ? { ...rest, key } : rest;
              if (Array.isArray(children)) {
                return React.createElement.apply(React, [type, finalProps].concat(children));
              }
              return React.createElement(type, finalProps, children);
            };
            export const jsxDEV = jsx;
            export const Fragment = React.Fragment;
          `,
          loader: 'js',
        };
      }
      
      // For plain 'react' import
      return {
        contents: `
          const React = window.React;
          export default React;
          export const { useState, useEffect, useRef, useCallback, useMemo, useContext, useReducer, useLayoutEffect, useImperativeHandle, useDebugValue, forwardRef, memo, createContext, createElement, Fragment, Children, cloneElement, isValidElement, lazy, Suspense, startTransition, useTransition, useDeferredValue, useId, Component, PureComponent } = React;
        `,
        loader: 'js',
      };
    });
  },
};

// ============================================================================
// Compilation
// ============================================================================

interface CompileResult {
  input: string;
  output: string;
  success: boolean;
  error?: string;
  size?: number;
}

async function compileFile(inputPath: string): Promise<CompileResult> {
  const fileName = path.basename(inputPath, '.tsx');
  const outputFileName = kebabCase(fileName) + '.js';
  
  // Output flat structure - all files go directly to outDir
  const outputPath = path.join(CONFIG.outDir, outputFileName);

  try {
    await esbuild.build({
      entryPoints: [inputPath],
      bundle: true,
      format: 'esm',
      target: 'es2020',
      platform: 'browser',
      
      // Plugins: 
      // 1. externalizeExepadSdkPlugin - preserves @exepad/sdk imports for runtime resolution
      // 2. reactFromWindowPlugin - fallback for direct 'react' imports
      plugins: [externalizeExepadSdkPlugin, reactFromWindowPlugin],
      
      // JSX configuration - use automatic transform
      jsx: 'automatic',
      jsxImportSource: 'react',
      
      // Define process.env variables for browser environment
      // This prevents "process is not defined" errors in bundled dependencies
      define: {
        'process.env.NODE_ENV': '"production"',
      },
      
      // Output configuration
      outfile: outputPath,
      minify: true,
      sourcemap: false,
      
      // Tree shaking
      treeShaking: true,
      
      // Don't write to stdout
      write: true,
      
      // Metafile for size info
      metafile: true,
    });

    const stats = fs.statSync(outputPath);
    
    return {
      input: inputPath,
      output: outputPath,
      success: true,
      size: stats.size,
    };
  } catch (error) {
    return {
      input: inputPath,
      output: outputPath,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('🚀 Code Components Compiler');
  console.log('=============================\n');

  // Ensure output directory exists
  ensureDir(CONFIG.outDir);

  if (customPath) {
    console.log(`📂 Custom path: ${customPath}`);
    console.log(`   Source: ${CONFIG.srcDir}`);
    console.log(`   Output: ${CONFIG.outDir}\n`);
  }

  console.log('📦 Using esbuild with React-from-window plugin\n');

  // Get source files
  const sourceFiles = await getSourceFiles();
  
  if (sourceFiles.length === 0) {
    console.log('⚠️  No .tsx files found in', CONFIG.srcDir);
    return;
  }

  console.log(`📂 Found ${sourceFiles.length} source files:\n`);
  sourceFiles.forEach(file => {
    const relativePath = path.relative(CONFIG.srcDir, file);
    console.log(`   - ${relativePath}`);
  });
  console.log('');

  // Compile each file
  console.log('🔨 Compiling...\n');
  const results: CompileResult[] = [];

  for (const file of sourceFiles) {
    const result = await compileFile(file);
    results.push(result);

    if (result.success) {
      const sizeKB = ((result.size || 0) / 1024).toFixed(2);
      const relativeInput = path.relative(CONFIG.srcDir, file);
      const relativeOutput = path.relative(CONFIG.outDir, result.output);
      console.log(`   ✅ ${relativeInput} → ${relativeOutput} (${sizeKB} KB)`);
    } else {
      const relativeInput = path.relative(CONFIG.srcDir, file);
      console.log(`   ❌ ${relativeInput} - ${result.error}`);
    }
  }

  // Summary
  console.log('\n=============================');
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`✨ Compilation complete!`);
  console.log(`   ${successful} succeeded, ${failed} failed`);
  
  if (successful > 0) {
    const totalSize = results
      .filter(r => r.success)
      .reduce((sum, r) => sum + (r.size || 0), 0);
    console.log(`   Total output size: ${(totalSize / 1024).toFixed(2)} KB`);
  }

  console.log(`\n📁 Output directory: ${CONFIG.outDir}`);
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
