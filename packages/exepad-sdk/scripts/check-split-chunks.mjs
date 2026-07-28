// Build gate for the per-entry isolated SDK chunks.
//
// FAILS (exit 1) if:
//   - recharts appears in MORE THAN ONE chunk, or in core at all
//   - framer-motion appears in MORE THAN ONE chunk, or in core at all
//   - any expected chunk is missing
//
// Prints a per-chunk raw + gzip size table.
//
// NOTE ON MARKERS: terser mangles internal identifiers, so the original plan's
// `generateCategoricalChart` / `VisualElement` / `animateValue` markers do NOT
// survive minification. We use markers that DO survive (public API surface +
// the bare package name retained in re-export glue):
//   recharts → "recharts" (re-export glue) + "ResponsiveContainer" (public API)
//   framer   → "framer"   (re-export glue) + "motionValue"        (public API)
// A chunk "contains" the engine if ANY of its markers is present.

import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(
  __dirname,
  '../../../apps/runtime/client/public/runtime_assets/dist'
);
// The agent-facing catalogs (sdk-exports.json, sdk-subpaths.json) live in the
// SDK package's own dist/, not the runtime's served dist/.
const PKG_ROOT_DIST = path.resolve(__dirname, '../dist');

// Split chunk files (the additive output of build-split.mjs).
const CHUNKS = [
  'exepad-sdk-core.js',
  'exepad-sdk-charts.js',
  'exepad-sdk-motion.js',
  'exepad-sdk-forms.js',
  'exepad-sdk-overlays.js',
  'exepad-sdk-icons.js',
];

const ENGINES = {
  recharts: ['recharts', 'ResponsiveContainer'],
  'framer-motion': ['framer', 'motionValue'],
};

function gzipLen(buf) {
  return gzipSync(buf, { level: 9 }).length;
}

function fmt(n) {
  return n.toLocaleString('en-US');
}

let failed = false;
const sizes = [];
const presence = { recharts: [], 'framer-motion': [] };

for (const name of CHUNKS) {
  const p = path.join(DIST, name);
  if (!existsSync(p)) {
    console.error(`✗ MISSING expected chunk: ${name}`);
    failed = true;
    continue;
  }
  const buf = readFileSync(p);
  const text = buf.toString('utf8');
  sizes.push({ name, raw: buf.length, gzip: gzipLen(buf) });

  for (const [engine, markers] of Object.entries(ENGINES)) {
    if (markers.some((m) => text.includes(m))) {
      presence[engine].push(name);
    }
  }
}

// Account for the split icons lazy chunk (icons/icons-*.js) in the size table.
try {
  const { readdirSync, statSync } = await import('node:fs');
  const iconsDir = path.join(DIST, 'icons');
  if (existsSync(iconsDir)) {
    const candidates = readdirSync(iconsDir)
      .filter((f) => f.startsWith('icons-') && f.endsWith('.js'))
      .map((f) => ({ f, size: statSync(path.join(iconsDir, f)).size }))
      .sort((a, b) => b.size - a.size);
    if (candidates.length) {
      const big = candidates[0];
      const buf = readFileSync(path.join(iconsDir, big.f));
      sizes.push({ name: `icons/${big.f} (lazy)`, raw: buf.length, gzip: gzipLen(buf) });
    }
  }
} catch { /* best-effort */ }

// --- Size table ---
console.log('\n── Split SDK chunk sizes ──');
console.log(
  `${'chunk'.padEnd(40)} ${'raw'.padStart(12)} ${'gzip'.padStart(12)}`
);
console.log('-'.repeat(66));
for (const s of sizes) {
  console.log(
    `${s.name.padEnd(40)} ${fmt(s.raw).padStart(12)} ${fmt(s.gzip).padStart(12)}`
  );
}
console.log('-'.repeat(66));

// --- Engine isolation gate ---
console.log('\n── Engine isolation gate ──');
for (const engine of Object.keys(ENGINES)) {
  const where = presence[engine];
  const inCore = where.includes('exepad-sdk-core.js');
  const overOne = where.length > 1;
  const ok = where.length === 1 && !inCore;
  const status = ok ? '✓' : '✗';
  console.log(`${status} ${engine}: ${where.length ? where.join(', ') : '(absent)'}`);
  if (inCore) {
    console.error(`  ✗ ${engine} MUST NOT appear in core (exepad-sdk-core.js)`);
    failed = true;
  }
  if (overOne) {
    console.error(`  ✗ ${engine} appears in ${where.length} chunks — must be single-instance`);
    failed = true;
  }
  if (where.length === 0) {
    console.error(`  ✗ ${engine} not found in ANY chunk — split likely broken`);
    failed = true;
  }
}

// --- Routing-table coverage gate -------------------------------------------
// The agent splits a generated component's bare `@exepad/sdk` import into
// subpath imports using dist/sdk-subpaths.json. If that table drifts from the
// real export surface (a symbol routed to a chunk that doesn't export it, a
// symbol in two chunks, or a runtime export not covered at all), a generated
// app crashes at module-eval. Gate it here so SDK builds catch the drift.
console.log('\n── Import routing-table coverage gate ──');
try {
  const subPath = path.join(PKG_ROOT_DIST, 'sdk-subpaths.json');
  const expPath = path.join(PKG_ROOT_DIST, 'sdk-exports.json');
  if (!existsSync(subPath)) {
    console.error(`  ✗ missing ${path.relative(DIST, subPath)} — run gen-subpaths.mjs`);
    failed = true;
  } else if (!existsSync(expPath)) {
    console.error(`  ✗ missing sdk-exports.json — cannot verify coverage`);
    failed = true;
  } else {
    const sub = JSON.parse(readFileSync(subPath, 'utf8')).entries || {};
    const flat = new Set(JSON.parse(readFileSync(expPath, 'utf8')).flat || []);
    const owner = {};
    const dups = [];
    for (const [sp, names] of Object.entries(sub)) {
      for (const n of names) {
        if (owner[n]) dups.push(`${n} (in ${owner[n]} AND ${sp})`);
        else owner[n] = sp;
      }
    }
    const missing = [...flat].filter((n) => !owner[n]);
    const core = new Set(sub['@exepad/sdk/core'] || []);
    const heavyInCore = [];
    for (const sp of Object.keys(sub)) {
      if (sp === '@exepad/sdk/core') continue;
      for (const n of sub[sp]) if (core.has(n)) heavyInCore.push(`${n} (${sp})`);
    }
    if (dups.length) {
      console.error(`  ✗ ${dups.length} symbol(s) routed to >1 subpath: ${dups.slice(0, 8).join(', ')}`);
      failed = true;
    }
    if (missing.length) {
      console.error(`  ✗ ${missing.length} runtime export(s) not routed anywhere: ${missing.slice(0, 12).join(', ')}`);
      failed = true;
    }
    if (heavyInCore.length) {
      console.error(`  ✗ ${heavyInCore.length} heavy symbol(s) also in core: ${heavyInCore.slice(0, 8).join(', ')}`);
      failed = true;
    }
    if (!dups.length && !missing.length && !heavyInCore.length) {
      console.log(
        `✓ routing table: ${Object.keys(owner).length} symbols, ` +
          `all ${flat.size} runtime exports covered, no duplicates, none leak into core`
      );
    }
  }
} catch (err) {
  console.error(`  ✗ coverage gate error: ${err.message}`);
  failed = true;
}

if (failed) {
  console.error('\n✗ check-split-chunks: FAILED');
  process.exit(1);
}
console.log('\n✓ check-split-chunks: PASSED (engine isolation + routing-table coverage)');
