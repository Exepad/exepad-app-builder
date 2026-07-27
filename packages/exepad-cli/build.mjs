// Bundles the CLI into a single dependency-free dist/cli.js with a node shebang.
// esbuild keeps the published package tiny (the whole point of the thin launcher)
// and sidesteps ESM extension-resolution at runtime.
import { build } from 'esbuild';
import { chmodSync } from 'node:fs';

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: 'dist/cli.js',
  banner: { js: '#!/usr/bin/env node' },
  // package.json is read at runtime via import.meta.url; keep it external on disk.
  logLevel: 'info',
});

chmodSync('dist/cli.js', 0o755);
