#!/usr/bin/env node
/**
 * Stage a committed fixture app into EXEPAD_DATA_DIR so the runtime server can
 * serve it at /a/<appId>/ for the Lighthouse leg of the perf gate.
 *
 * Why a fixture: `.exepad-data/` is gitignored, and a real deploy needs the
 * Python agent (heavy + non-deterministic). The runtime resolves an app's
 * config purely from FS storage (storage/<appId>/published/app-config.json) —
 * no meta.sqlite row is required to SERVE a published app — so copying the
 * committed snapshot under storage/<appId> is enough.
 *
 * Usage:
 *   node seed-fixture.mjs                       # seed default fixture → default appId
 *   node seed-fixture.mjs --fixture=landing --app=a1kguu163
 *
 * Env:
 *   EXEPAD_DATA_DIR  default <repo>/.exepad-data
 *   PERF_APP_ID      default a1kguu163  (must match runner.mjs)
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
}

const FIXTURE = String(arg('fixture', 'landing'));
const APP_ID = String(arg('app', process.env.PERF_APP_ID ?? 'a1kguu163'));
const DATA_DIR = process.env.EXEPAD_DATA_DIR ?? join(REPO_ROOT, '.exepad-data');

const fixtureStorage = join(__dirname, 'fixture', FIXTURE, 'storage');
if (!existsSync(fixtureStorage)) {
  console.error(`[seed-fixture] fixture not found: ${fixtureStorage}`);
  process.exit(1);
}

const dest = join(DATA_DIR, 'storage', APP_ID);
mkdirSync(dest, { recursive: true });
cpSync(fixtureStorage, dest, { recursive: true });

// The bootstrap dirs the server expects to exist on first run.
for (const d of ['secrets', 'apps', 'storage', 'buckets', 'uploads', 'agent']) {
  mkdirSync(join(DATA_DIR, d), { recursive: true });
}

console.log(`[seed-fixture] staged fixture "${FIXTURE}" → ${dest} (app /a/${APP_ID}/)`);
