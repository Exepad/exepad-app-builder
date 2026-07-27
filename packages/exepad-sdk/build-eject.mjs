// Eject build of @exepad/sdk — a VENDORABLE, standalone-buildable variant.
//
// Difference from build-split.mjs (the platform build):
//   - NO `react-from-window` plugin. React/ReactDOM are real EXTERNALS (peer
//     deps), so a vanilla Vite/Next app resolves them from its own node_modules
//     → a SINGLE React instance (no "invalid hook call").
//   - JSX uses the automatic runtime (`react/jsx-runtime`, also external).
//   - All other deps (radix/recharts/framer/…) stay bundled, so the vendored
//     package is self-contained except for React.
//   - Emits a `package.json` with subpath `exports` + peer React, so the
//     standalone project can install it via `file:./vendor/exepad-sdk`.
//   - Ships the existing hand-written `types/*.d.ts` for editor/tsc support.
//
// Output: packages/exepad-sdk/dist-eject/{index,core,charts,motion,forms,overlays,icons}.js
//         + package.json + LICENSE + *.d.ts. The export packer copies this into
//         D2's vendor/exepad-sdk. The build is minified object code that gets
//         conveyed to users, so the AGPL text ships alongside it (AGPL §4/§5).
//
// Bare `@exepad/sdk` maps to the FULL barrel (`index.js`, built from
// `src/index.ts`) — NOT the lean `core` subset. Agent-generated components import
// the whole surface (Icons/Charts/Motion/AnimatePresence/Calendar/Dialog/…) from
// the bare specifier, exactly as in the platform where bare === src/index.ts. The
// split `core/charts/motion/…` chunks remain available as explicit subpaths.

import { build } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, 'dist-eject');

// subpath name → entry source. Matches the package's `exports` subpaths.
const ENTRIES = {
  core: 'src/entries/core.ts',
  charts: 'src/entries/charts.ts',
  motion: 'src/entries/motion.ts',
  forms: 'src/entries/forms.ts',
  overlays: 'src/entries/overlays.ts',
  icons: 'src/entries/icons.ts',
};

// React (and its runtimes) stay external — the consuming app provides them.
const REACT_EXTERNAL = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom/client',
];
function isExternal(id) {
  return REACT_EXTERNAL.includes(id) || id === 'react' || id.startsWith('react/') || id.startsWith('react-dom');
}

async function buildEntry(name, entryRel) {
  await build({
    configFile: false,
    plugins: [react({ jsxRuntime: 'automatic' })],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    logLevel: 'warn',
    build: {
      outDir: OUT_DIR,
      emptyOutDir: false,
      lib: {
        entry: path.resolve(__dirname, entryRel),
        fileName: () => `${name}.js`,
        formats: ['es'],
      },
      rollupOptions: {
        external: isExternal,
        output: { chunkFileNames: 'chunks/[name]-[hash].js' },
      },
      minify: 'esbuild',
    },
  });
  console.log(`  ✓ ${name}.js`);
}

function writeVendorPackageJson() {
  const exportsMap = {};
  for (const name of Object.keys(ENTRIES)) {
    const hasTypes = existsSync(path.join(__dirname, 'types', `${name}.d.ts`));
    exportsMap[`./${name}`] = {
      ...(hasTypes ? { types: `./types/${name}.d.ts` } : {}),
      import: `./${name}.js`,
    };
  }
  const pkg = {
    name: '@exepad/sdk',
    version: '0.0.0-eject',
    license: 'AGPL-3.0-only',
    type: 'module',
    sideEffects: false,
    // `@exepad/sdk` bare → the FULL barrel (index.js); subpaths map to their
    // lean chunks. The bare specifier must expose everything because the agent's
    // components import the whole surface from it.
    exports: {
      '.': { ...(existsSync(path.join(OUT_DIR, 'types', 'index.d.ts')) ? { types: './types/index.d.ts' } : {}), import: './index.js' },
      ...exportsMap,
    },
    peerDependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
  };
  writeFileSync(path.join(OUT_DIR, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
}

// The minified output is object code under AGPL §1 and is vendored verbatim into
// user downloads, so the licence text must travel inside the built directory.
function copyLicense() {
  const src = path.resolve(__dirname, '../../LICENSE');
  if (!existsSync(src)) {
    console.warn('[build-eject] WARNING: root LICENSE not found — vendored SDK would ship without it');
    return;
  }
  copyFileSync(src, path.join(OUT_DIR, 'LICENSE'));
}

function copyTypes() {
  const typesDir = path.join(__dirname, 'types');
  if (!existsSync(typesDir)) return;
  const outTypes = path.join(OUT_DIR, 'types');
  mkdirSync(outTypes, { recursive: true });
  for (const name of [...Object.keys(ENTRIES), 'index']) {
    const src = path.join(typesDir, `${name}.d.ts`);
    if (existsSync(src)) copyFileSync(src, path.join(outTypes, `${name}.d.ts`));
  }
}

// Bare `@exepad/sdk` resolves to the full barrel, so its `.d.ts` must cover the
// whole surface. There's no hand-written index.d.ts, so aggregate the per-subpath
// declarations (which together mirror src/index.ts). `export *` quietly drops any
// ambiguous duplicate, so this is safe even if two subpaths share a name.
function writeAggregateIndexDts() {
  const outTypes = path.join(OUT_DIR, 'types');
  mkdirSync(outTypes, { recursive: true });
  if (existsSync(path.join(outTypes, 'index.d.ts'))) return; // a real one was copied
  const lines = Object.keys(ENTRIES)
    .filter((n) => existsSync(path.join(outTypes, `${n}.d.ts`)))
    .map((n) => `export * from './${n}';`);
  writeFileSync(path.join(outTypes, 'index.d.ts'), lines.join('\n') + '\n');
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log('[build-eject] Building vendorable SDK chunks (React external)…');
  // The full barrel first — bare `@exepad/sdk` resolves here.
  await buildEntry('index', 'src/index.ts');
  for (const [name, rel] of Object.entries(ENTRIES)) {
    await buildEntry(name, rel);
  }
  copyTypes();
  writeAggregateIndexDts();
  writeVendorPackageJson();
  copyLicense();
  console.log(`[build-eject] Done → ${path.relative(process.cwd(), OUT_DIR)}`);
}

main().catch((err) => {
  console.error('[build-eject] FAILED:', err);
  process.exit(1);
});
