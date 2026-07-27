// Generate dist/sdk-subpaths.json — the SINGLE SOURCE OF TRUTH for the
// agent's import-splitting fixer (component_sdk_subpaths.py).
//
// WHY: the SDK is shipped as a bare `@exepad/sdk` barrel (the global import-map
// target, byte-frozen for immutable deployed apps) PLUS additive per-entry
// subpath chunks (`@exepad/sdk/core|charts|motion|forms|overlays|icons`). The
// agent rewrites a newly-generated component's bare-barrel import into subpath
// imports so a core-only page never downloads/parses the 443KB-gzip monolith.
//
// The routing table (which public symbol lives behind which subpath) MUST stay
// in lock-step with src/entries/*.ts, or the fixer routes a symbol to a chunk
// that doesn't export it and the app crashes at module-eval. So we DERIVE the
// table directly from the entry source files instead of hand-maintaining it.
//
// Parsing scope: each entry file is a flat list of `export { ... } from '...'`
// and `export type { ... } from '...'` re-export statements. We collect the
// PUBLIC export names (the name a consumer imports): for `A as B` that's `B`,
// for an inline `type X` specifier that's `X`.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');

// Subpath specifier → entry source file. Order is significant: it defines the
// precedence used by the coverage report (core is the catch-all default).
export const ENTRY_FILES = {
  '@exepad/sdk/core': 'src/entries/core.ts',
  '@exepad/sdk/charts': 'src/entries/charts.ts',
  '@exepad/sdk/motion': 'src/entries/motion.ts',
  '@exepad/sdk/forms': 'src/entries/forms.ts',
  '@exepad/sdk/overlays': 'src/entries/overlays.ts',
  '@exepad/sdk/icons': 'src/entries/icons.ts',
};

/** Strip line comments and block comments from TS source. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Parse the PUBLIC export names from a single entry source file.
 * Handles `export { ... } from '...'` and `export type { ... } from '...'`,
 * inline `type X` specifiers, and `A as B` aliases (public name = B).
 */
export function parseEntryExports(absPath) {
  const src = stripComments(readFileSync(absPath, 'utf8'));
  const names = new Set();
  // Non-greedy brace body; export lists never nest braces.
  const re = /export\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*['"][^'"]+['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    for (let spec of m[1].split(',')) {
      spec = spec.trim();
      if (!spec) continue;
      // Drop an inline `type ` qualifier on the specifier.
      spec = spec.replace(/^type\s+/, '');
      // `A as B` → the bound/public name is B (the part after `as`).
      const parts = spec.split(/\s+as\s+/);
      const publicName = parts[parts.length - 1].trim();
      if (publicName && /^[A-Za-z_$][\w$]*$/.test(publicName)) {
        names.add(publicName);
      }
    }
  }
  return names;
}

/** Build the {subpath: [names]} map from the entry files. */
export function buildSubpathMap() {
  const entries = {};
  for (const [subpath, rel] of Object.entries(ENTRY_FILES)) {
    const abs = path.join(PKG_ROOT, rel);
    if (!existsSync(abs)) {
      throw new Error(`[gen-subpaths] entry source missing: ${rel}`);
    }
    entries[subpath] = [...parseEntryExports(abs)].sort();
  }
  return entries;
}

/** Write dist/sdk-subpaths.json. Returns the written object. */
export function writeSubpathsJson() {
  const entries = buildSubpathMap();
  const out = {
    version: 1,
    generatedFrom: 'packages/exepad-sdk/src/entries/*.ts',
    note:
      'Routing table for the agent import-split fixer. core is the default; ' +
      'a symbol NOT listed under any subpath stays on the bare @exepad/sdk barrel.',
    entries,
  };
  const distDir = path.join(PKG_ROOT, 'dist');
  mkdirSync(distDir, { recursive: true }); // clean builds (e.g. Docker) have no pre-existing dist/
  const outPath = path.join(distDir, 'sdk-subpaths.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  const total = Object.values(entries).reduce((n, a) => n + a.length, 0);
  console.log(
    `[gen-subpaths] wrote ${path.relative(PKG_ROOT, outPath)} ` +
      `(${total} symbols across ${Object.keys(entries).length} subpaths)`
  );
  return out;
}

// Run standalone: `node scripts/gen-subpaths.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  writeSubpathsJson();
}
