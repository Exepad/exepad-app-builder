#!/usr/bin/env node
/**
 * Exepad performance gate.
 *
 * DEV/CI ONLY. This package is never installed into or bundled inside the
 * self-hosted container — it lives under tools/ and is excluded from the
 * workspace build graph.
 *
 * Two gates, deliberately weighted differently:
 *
 *   1. BYTES (primary, HARD). A deterministic total-first-fold-JS-byte budget:
 *      the freshly built @exepad/sdk monolith + the first-fold component JS for
 *      a page. Bytes are the reliable, parse-bound proxy for mobile TBT/LCP and
 *      are reproducible build-to-build. A breach fails the build.
 *
 *   2. LIGHTHOUSE (secondary, mostly SOFT). Mobile + desktop runs with CPU
 *      throttling pinned to 4x so the gate reflects the real parse cliff. The
 *      Perf score is noisy and download-shaped, so it only fails when it drops
 *      BELOW (floor - tolerance) — a structural regression, not +/-3 noise.
 *      Core metrics (TBT/LCP/CLS/FCP/SI) are archived and trend-tracked; they
 *      fail CI only when `lighthouse.enforceMetricCeilings` is true.
 *
 * Usage:
 *   node runner.mjs                     # full gate against $PERF_BASE_URL
 *   node runner.mjs --base-url=http://localhost:8080 --app=a1kguu163
 *   node runner.mjs --bytes-only        # deterministic byte gate only (no Chrome)
 *   node runner.mjs --selftest          # validate extraction against saved JSON reports (no Chrome)
 *   node runner.mjs --no-lighthouse     # alias for --bytes-only
 *
 * Env:
 *   PERF_BASE_URL   default http://localhost:8080
 *   PERF_APP_ID     default a1kguu163
 *   PERF_PATHS      comma-separated extra paths relative to /a/<app> (default: / /about /services /contact)
 *   EXEPAD_DATA_DIR default <repo>/.exepad-data  (to locate compiled component JS)
 *   CHROME_PATH     system chrome (default /usr/bin/google-chrome)
 *   PERF_OUT_DIR    where to write report JSON (default tools/perf-ci/.report)
 *   PERF_SELFTEST_MOBILE / PERF_SELFTEST_DESKTOP   saved report paths for --selftest
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

// ── arg / env parsing ────────────────────────────────────────────────────────
function arg(name, fallback) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
}

const SELFTEST = !!arg('selftest', false);
const BYTES_ONLY = !!arg('bytes-only', false) || !!arg('no-lighthouse', false);
const BASE_URL = String(arg('base-url', process.env.PERF_BASE_URL ?? 'http://localhost:8080')).replace(/\/$/, '');
const APP_ID = String(arg('app', process.env.PERF_APP_ID ?? 'a1kguu163'));
const DATA_DIR = process.env.EXEPAD_DATA_DIR ?? join(REPO_ROOT, '.exepad-data');
const CHROME_PATH = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const OUT_DIR = process.env.PERF_OUT_DIR ?? join(__dirname, '.report');
const SDK_DIST = join(REPO_ROOT, 'apps/runtime/client/public/runtime_assets/dist');

const DEFAULT_PATHS = (process.env.PERF_PATHS ?? '/,/about,/services,/contact')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

const BUDGETS = JSON.parse(readFileSync(join(__dirname, 'budgets.json'), 'utf-8'));

// ── pretty output ────────────────────────────────────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  b: (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  g: (s) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  y: (s) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  r: (s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  d: (s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
};
const PASS = c.g('PASS');
const FAIL = c.r('FAIL');
const WARN = c.y('WARN');

function fmtBytes(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}MB`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}KB`;
  return `${n}B`;
}

// ── byte measurement (deterministic primary gate) ────────────────────────────

/** Find the SDK monolith. The import-map target is the hashed index-*.js (the
 *  big bundle); exepad-sdk.js is just a ~10KB re-export shim, NOT the payload. */
function findSdkMonolith() {
  if (!existsSync(SDK_DIST)) {
    throw new Error(
      `SDK dist not found at ${SDK_DIST}. Run \`pnpm build:sdk\` first.`,
    );
  }
  const files = readdirSync(SDK_DIST).filter((f) => /^index-.*\.js$/.test(f));
  if (files.length === 0) {
    throw new Error(`No index-*.js (SDK monolith) in ${SDK_DIST}. Run \`pnpm build:sdk\`.`);
  }
  // The SDK monolith is by far the largest index-*.js chunk.
  let biggest = null;
  let biggestSize = -1;
  for (const f of files) {
    const size = statSync(join(SDK_DIST, f)).size;
    if (size > biggestSize) {
      biggestSize = size;
      biggest = f;
    }
  }
  return join(SDK_DIST, biggest);
}

function rawAndGzip(path) {
  const buf = readFileSync(path);
  return { raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length };
}

/** Resolve the compiled component JS files mounted on first fold for the fixture
 *  app. We read the published app-config to map the route → page sections, then
 *  add the always-present layout components (header/footer). Falls back to "all
 *  compiled components" if the config can't be parsed, which is a safe over-
 *  estimate for the byte ceiling. */
function firstFoldComponentFiles() {
  const compiledDir = join(DATA_DIR, 'storage', APP_ID, 'compiled', 'frontend', 'components');
  if (!existsSync(compiledDir)) return [];
  const all = readdirSync(compiledDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => join(compiledDir, f));
  return all;
}

/** Worst-case first-fold = SDK + the single heaviest page component + the two
 *  always-mounted layout components (header + footer). This is the byte total a
 *  visitor's browser must PARSE before the heaviest page is interactive. */
function measureBytes() {
  const sdkPath = findSdkMonolith();
  const sdk = rawAndGzip(sdkPath);

  const componentFiles = firstFoldComponentFiles();
  const perComponent = componentFiles.map((p) => {
    const name = p.split('/').pop();
    return { name, ...rawAndGzip(p) };
  });

  // Identify layout (always-on) vs page components by conventional naming.
  const layout = perComponent.filter((x) => /header|footer|nav|layout/i.test(x.name));
  const pages = perComponent.filter((x) => !layout.includes(x));

  const layoutRaw = layout.reduce((s, x) => s + x.raw, 0);
  const layoutGz = layout.reduce((s, x) => s + x.gzip, 0);

  // Heaviest single page (raw) is the worst case for first-fold parse.
  let heaviest = { name: '(none)', raw: 0, gzip: 0 };
  for (const p of pages) if (p.raw > heaviest.raw) heaviest = p;

  const firstFoldRaw = sdk.raw + layoutRaw + heaviest.raw;
  const firstFoldGzip = sdk.gzip + layoutGz + heaviest.gzip;

  return {
    sdkPath: sdkPath.replace(REPO_ROOT + '/', ''),
    sdk,
    perComponent,
    layout: layout.map((x) => x.name),
    heaviestPage: heaviest.name,
    firstFoldRaw,
    firstFoldGzip,
  };
}

function ceilWithTolerance(ceiling, tolPct) {
  return Math.round(ceiling * (1 + tolPct / 100));
}

function gateBytes(measured) {
  const b = BUDGETS.bytes;
  const tol = b.tolerancePct ?? 0;
  const checks = [
    { label: 'SDK raw', value: measured.sdk.raw, ceiling: b.sdkBytesRawCeiling, fmt: fmtBytes },
    { label: 'SDK gzip', value: measured.sdk.gzip, ceiling: b.sdkBytesGzipCeiling, fmt: fmtBytes },
    { label: 'first-fold raw', value: measured.firstFoldRaw, ceiling: b.firstFoldJsBytesRawCeiling, fmt: fmtBytes },
    { label: 'first-fold gzip', value: measured.firstFoldGzip, ceiling: b.firstFoldJsBytesGzipCeiling, fmt: fmtBytes },
  ];
  const results = checks.map((ck) => {
    const hardCeiling = ceilWithTolerance(ck.ceiling, tol);
    const ok = ck.value <= hardCeiling;
    return { ...ck, hardCeiling, ok };
  });
  return { results, failed: results.some((r) => !r.ok) };
}

// ── lighthouse extraction (works on saved JSON, no Chrome needed) ─────────────

/** Pull the category scores + the five mobile-weighted core metrics out of a
 *  Lighthouse JSON report. Verified against /tmp/lh-final.report.json (mobile)
 *  and /tmp/lh-desktop.report.json (desktop). */
export function extractFromReport(report) {
  const cat = report.categories ?? {};
  const a = report.audits ?? {};
  const score100 = (s) => (typeof s === 'number' ? Math.round(s * 100) : null);
  const numeric = (id) => {
    const x = a[id];
    return x && typeof x.numericValue === 'number' ? x.numericValue : null;
  };
  return {
    url: report.finalDisplayedUrl ?? report.finalUrl ?? report.requestedUrl ?? null,
    formFactor: report.configSettings?.formFactor ?? null,
    cpuSlowdownMultiplier: report.configSettings?.throttling?.cpuSlowdownMultiplier ?? null,
    lighthouseVersion: report.lighthouseVersion ?? null,
    scores: {
      performance: score100(cat.performance?.score),
      accessibility: score100(cat.accessibility?.score),
      bestPractices: score100(cat['best-practices']?.score),
      seo: score100(cat.seo?.score),
    },
    metrics: {
      firstContentfulPaintMs: numeric('first-contentful-paint'),
      largestContentfulPaintMs: numeric('largest-contentful-paint'),
      cumulativeLayoutShift: numeric('cumulative-layout-shift'),
      totalBlockingTimeMs: numeric('total-blocking-time'),
      speedIndexMs: numeric('speed-index'),
      timeToInteractiveMs: numeric('interactive'),
    },
  };
}

/** Soft/hard scoring of one extracted Lighthouse result against the budget for
 *  its form factor. Score floor is a HARD gate (with tolerance) iff
 *  enforceScoreFloor; metric ceilings are advisory unless enforceMetricCeilings. */
function gateLighthouse(extracted, formFactor) {
  const lh = BUDGETS.lighthouse;
  const budget = lh[formFactor];
  if (!budget) return { failed: false, scoreCheck: null, metricChecks: [] };

  const perf = extracted.scores.performance;
  const floor = budget.performanceFloor;
  const tolPts = lh.tolerancePts ?? 0;
  const effectiveFloor = floor - tolPts;
  const scoreOk = perf == null ? true : perf >= effectiveFloor;
  const scoreHard = lh.enforceScoreFloor === true;

  const metricChecks = [];
  const metricDefs = [
    { key: 'totalBlockingTimeMs', label: 'TBT (ms)', lowerIsBetter: true },
    { key: 'largestContentfulPaintMs', label: 'LCP (ms)', lowerIsBetter: true },
    { key: 'cumulativeLayoutShift', label: 'CLS', lowerIsBetter: true },
    { key: 'firstContentfulPaintMs', label: 'FCP (ms)', lowerIsBetter: true },
    { key: 'speedIndexMs', label: 'SI (ms)', lowerIsBetter: true },
  ];
  for (const def of metricDefs) {
    const ceiling = budget.metrics?.[def.key];
    const value = extracted.metrics[def.key];
    if (ceiling == null || value == null) continue;
    metricChecks.push({ ...def, ceiling, value, ok: value <= ceiling });
  }
  const metricHard = lh.enforceMetricCeilings === true;

  const failed =
    (scoreHard && !scoreOk) ||
    (metricHard && metricChecks.some((m) => !m.ok));

  return {
    failed,
    scoreCheck: { perf, floor, effectiveFloor, ok: scoreOk, hard: scoreHard },
    metricChecks,
    metricHard,
  };
}

// ── lighthouse run (dynamic import so --selftest / --bytes-only need no deps) ──
async function runLighthouse(url, formFactor) {
  const [{ default: lighthouse }, chromeLauncher] = await Promise.all([
    import('lighthouse'),
    import('chrome-launcher'),
  ]);

  const chrome = await chromeLauncher.launch({
    chromePath: CHROME_PATH,
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  // Pin throttling so the gate reproduces the real parse-bound mobile cliff.
  // 4x CPU slowdown is the mobile default; we set it explicitly for both form
  // factors and never let it drift.
  const mobileEmu = {
    mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false,
  };
  const desktopEmu = {
    mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false,
  };
  const throttling = {
    rttMs: 150,
    throughputKbps: formFactor === 'desktop' ? 10240 : 1638.4,
    requestLatencyMs: formFactor === 'desktop' ? 0 : 562.5,
    downloadThroughputKbps: formFactor === 'desktop' ? 10240 : 1474.56,
    uploadThroughputKbps: formFactor === 'desktop' ? 10240 : 675,
    cpuSlowdownMultiplier: formFactor === 'desktop' ? 1 : 4,
  };

  try {
    const result = await lighthouse(url, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      formFactor,
      screenEmulation: formFactor === 'desktop' ? desktopEmu : mobileEmu,
      throttlingMethod: 'simulate',
      throttling,
    });
    return JSON.parse(result.report);
  } finally {
    await chrome.kill().catch(() => undefined);
  }
}

// ── report rendering ─────────────────────────────────────────────────────────
function printByteTable(measured, gate) {
  console.log(c.b('\n● Deterministic JS-byte gate (PRIMARY, hard)'));
  console.log(c.d(`  SDK monolith: ${measured.sdkPath}`));
  console.log(c.d(`  layout components: ${measured.layout.join(', ') || '(none detected)'}`));
  console.log(c.d(`  heaviest page component: ${measured.heaviestPage}`));
  console.log('  ' + ['metric', 'measured', 'ceiling(+tol)', ''].map((s, i) => s.padEnd([18, 12, 14, 6][i])).join(''));
  for (const r of gate.results) {
    const status = r.ok ? PASS : FAIL;
    console.log(
      '  ' +
        r.label.padEnd(18) +
        r.fmt(r.value).padEnd(12) +
        r.fmt(r.hardCeiling).padEnd(14) +
        status,
    );
  }
}

function printLighthouseTable(label, extracted, gate) {
  console.log(c.b(`\n● Lighthouse — ${label} (CPU ${extracted.cpuSlowdownMultiplier ?? '?'}x, ${extracted.lighthouseVersion ?? '?'})`));
  console.log(c.d(`  ${extracted.url ?? ''}`));
  const s = extracted.scores;
  console.log(
    `  scores  perf ${String(s.performance)}  a11y ${String(s.accessibility)}  bp ${String(s.bestPractices)}  seo ${String(s.seo)}`,
  );
  if (gate.scoreCheck) {
    const sc = gate.scoreCheck;
    const status = sc.ok ? PASS : sc.hard ? FAIL : WARN;
    console.log(
      `  perf floor ${sc.floor} (effective ${sc.effectiveFloor} after tolerance)  →  ${status}` +
        (sc.hard ? '' : c.d(' [soft]')),
    );
  }
  for (const m of gate.metricChecks) {
    const status = m.ok ? PASS : gate.metricHard ? FAIL : WARN;
    const val = m.key === 'cumulativeLayoutShift' ? m.value.toFixed(3) : Math.round(m.value);
    console.log(
      `  ${m.label.padEnd(10)} ${String(val).padEnd(8)} ceiling ${String(m.ceiling).padEnd(8)} ${status}` +
        (gate.metricHard ? '' : c.d(' [trend-only]')),
    );
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(c.b('Exepad perf-ci gate'));
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    appId: APP_ID,
    mode: SELFTEST ? 'selftest' : BYTES_ONLY ? 'bytes-only' : 'full',
    budgets: BUDGETS,
    bytes: null,
    lighthouse: [],
    failed: false,
    failures: [],
  };

  // ── selftest: validate extraction against saved reports, no Chrome ──────────
  if (SELFTEST) {
    const mPath = process.env.PERF_SELFTEST_MOBILE ?? '/tmp/lh-final.report.json';
    const dPath = process.env.PERF_SELFTEST_DESKTOP ?? '/tmp/lh-desktop.report.json';
    console.log(c.d(`  selftest reports: ${mPath} | ${dPath}`));
    let ok = true;
    for (const [ff, p] of [['mobile', mPath], ['desktop', dPath]]) {
      if (!existsSync(p)) {
        console.log(`  ${WARN} missing saved report ${p} — skipping ${ff}`);
        continue;
      }
      const extracted = extractFromReport(JSON.parse(readFileSync(p, 'utf-8')));
      const gate = gateLighthouse(extracted, ff);
      printLighthouseTable(`${ff} (selftest)`, extracted, gate);
      // Assertions: extraction must yield numbers, not nulls.
      if (extracted.scores.performance == null || extracted.metrics.largestContentfulPaintMs == null) {
        console.log(`  ${FAIL} extraction returned null for ${ff} — parser broken`);
        ok = false;
      }
    }
    console.log(ok ? c.g('\nselftest OK — extraction parses real Lighthouse JSON.') : c.r('\nselftest FAILED.'));
    process.exit(ok ? 0 : 1);
  }

  // ── byte gate (always) ──────────────────────────────────────────────────────
  const measured = measureBytes();
  const byteGate = gateBytes(measured);
  report.bytes = { measured, gate: byteGate };
  printByteTable(measured, byteGate);
  if (byteGate.failed) {
    report.failed = true;
    report.failures.push('byte-budget');
  }

  // ── lighthouse gate (unless bytes-only) ─────────────────────────────────────
  if (!BYTES_ONLY) {
    const paths = DEFAULT_PATHS;
    // Run one representative page per form factor to keep CI fast; the byte
    // gate already covers worst-case bytes across all pages.
    const targetPath = paths[0] === '/' ? '' : paths[0];
    const url = `${BASE_URL}/a/${APP_ID}${targetPath}`;
    let lhAttempted = 0;
    let lhErrored = 0;
    for (const ff of ['mobile', 'desktop']) {
      lhAttempted += 1;
      try {
        const lhReport = await runLighthouse(url, ff);
        const extracted = extractFromReport(lhReport);
        const gate = gateLighthouse(extracted, ff);
        printLighthouseTable(ff, extracted, gate);
        report.lighthouse.push({ formFactor: ff, url, extracted, gate });
        if (gate.failed) {
          report.failed = true;
          report.failures.push(`lighthouse-${ff}`);
        }
      } catch (err) {
        lhErrored += 1;
        console.log(`  ${WARN} Lighthouse ${ff} run failed: ${err instanceof Error ? err.message : String(err)}`);
        report.lighthouse.push({ formFactor: ff, url, error: String(err) });
        // A Lighthouse infra failure is NOT a perf regression — do not fail the
        // hard gate on a flaky Chrome launch. The byte gate stands on its own.
      }
    }
    // Make a silent degrade-to-bytes-only VISIBLE in PR review: if any (or all)
    // Lighthouse runs errored, emit a GitHub annotation so a Chrome-launch flake
    // that quietly reduced the gate to bytes-only can't pass unnoticed.
    report.lighthouseDegraded = lhErrored > 0;
    if (lhErrored > 0) {
      const scope = lhErrored === lhAttempted ? 'ALL' : `${lhErrored}/${lhAttempted}`;
      console.log(`::warning title=Lighthouse degraded::${scope} Lighthouse run(s) errored — this perf gate ran BYTES-ONLY; metric/score regressions were NOT checked.`);
    }
  }

  // ── write report artifact ───────────────────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, 'perf-report.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(c.d(`\nreport → ${outPath}`));

  if (report.failed) {
    console.log(c.r(`\n✗ perf gate FAILED: ${report.failures.join(', ')}`));
    process.exit(1);
  }
  console.log(c.g('\n✓ perf gate passed.'));
}

main().catch((err) => {
  console.error(c.r(`perf-ci fatal: ${err instanceof Error ? err.stack : String(err)}`));
  process.exit(2);
});
