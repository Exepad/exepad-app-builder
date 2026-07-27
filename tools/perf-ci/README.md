# `tools/perf-ci` — Exepad performance gate

A self-contained Lighthouse + deterministic-byte gate that runs mobile **and**
desktop against a representative deployed app and enforces budgets, so future
changes can't silently regress runtime performance.

> **DEV / CI ONLY.** This package lives under `tools/`, is **not** a pnpm
> workspace member, and is **not** in turbo's build graph. Its devDeps
> (`lighthouse`, `chrome-launcher`) are installed only here and **never ship in
> the container**. `pnpm install` at the repo root does not touch it.

## Why two gates, weighted differently

A Lighthouse Perf *score* is noisy and download-shaped — a single point swings
±3 between runs for no real reason. So the gate is split:

| Gate | Kind | Fails the build? |
|---|---|---|
| **Total-first-fold-JS bytes** | deterministic, parse-bound | **Yes (primary).** Bytes are reproducible build-to-build and are the real mobile bottleneck (parsing the 1.6 MB SDK on a throttled CPU). |
| **Lighthouse Perf score floor** | measured, CPU pinned to 4× | Yes, but only when it drops **below `floor − tolerancePts`** — a structural regression, not run-to-run noise. |
| **Lighthouse core metrics** (TBT/LCP/CLS/FCP/SI) | measured | No by default (`enforceMetricCeilings: false`). Archived + trend-tracked in the report; flip the flag to enforce. |

The byte gate stands on its own: if Chrome fails to launch in CI, the Lighthouse
leg is skipped with a warning and the byte gate still runs.

## What "first-fold JS bytes" means

```
first-fold bytes = SDK monolith  +  always-mounted layout (header/footer)  +  heaviest single page component
```

- **SDK monolith** = the freshly built `apps/runtime/client/public/runtime_assets/dist/index-*.js`
  (the import-map target — *not* the ~10 KB `exepad-sdk.js` re-export shim). The
  runner picks the largest `index-*.js` by size.
- **Layout** = compiled components matching `header|footer|nav|layout` (mounted
  on every page).
- **Heaviest page** = the single largest non-layout compiled component — the
  worst case a visitor must parse before that page is interactive.

Measured both **raw** and **gzip**. Today the SDK monolith dominates (~98.8% of
first-fold bytes), so splitting it is the single highest-leverage way to move
`firstFoldJsBytesGzip` on core-only pages.

## `budgets.json` — what each number means

All ceilings are set **at the current baseline so they can only ratchet down.**
Edit deliberately — every change is a perf policy decision.

### `bytes` (primary hard gate)

| Key | Meaning | Baseline (2026-06-15) |
|---|---|---|
| `sdkBytesRawCeiling` | max raw SDK monolith bytes | 1,666,404 → ceiling **1,700,000** |
| `sdkBytesGzipCeiling` | max gzip SDK monolith bytes | 443,472 → ceiling **460,000** |
| `firstFoldJsBytesRawCeiling` | max raw first-fold total | 1,687,232 → ceiling **1,720,000** |
| `firstFoldJsBytesGzipCeiling` | max gzip first-fold total | 448,756 → ceiling **465,000** |
| `tolerancePct` | headroom for minifier non-determinism (1.5%) | absorbs a few hundred bytes, **not** real regressions |

### `lighthouse` (secondary)

| Key | Meaning |
|---|---|
| `enforceScoreFloor` | `true` — Perf below `floor − tolerancePts` fails the build |
| `enforceMetricCeilings` | `false` — metric ceilings are advisory (trend-only) until flipped |
| `tolerancePts` | `5` — absorbs Lighthouse score noise |
| `mobile.performanceFloor` | `50` (baseline ~55; CPU pinned 4×) |
| `desktop.performanceFloor` | `80` (baseline ~90) |
| `*.metrics.*` | TBT/LCP/CLS/FCP/SI ceilings, generous regression thresholds |

CPU throttling is **pinned to 4× on mobile / 1× on desktop** so the gate
reproduces the real parse cliff and doesn't drift with the runner's CPU.

## Running locally

```bash
# From the repo root.

# 0. Build the SDK + runtime so bytes/served app are current.
pnpm build:sdk && pnpm build

# 1. Deterministic byte gate only — NO Chrome, fast, fully deterministic.
pnpm perf:bytes

# 2. Validate the Lighthouse-JSON extractor against saved reports — NO Chrome.
#    (Defaults to /tmp/lh-final.report.json + /tmp/lh-desktop.report.json;
#     override with PERF_SELFTEST_MOBILE / PERF_SELFTEST_DESKTOP.)
pnpm perf:selftest

# 3. Full gate (mobile + desktop Lighthouse). Needs the tool deps + a running
#    server serving the fixture app.
cd tools/perf-ci && npm install   # one-time: lighthouse + chrome-launcher
cd ../..
pnpm perf:seed                     # stage the committed fixture into .exepad-data
# boot the server (separate shell): SKIP_BUILD=1 ./run.sh local   (or node apps/runtime/worker/dist/server.mjs)
pnpm perf:ci                       # runs mobile + desktop, writes .report/perf-report.json
```

### Useful flags / env

| Flag / env | Default | Purpose |
|---|---|---|
| `--bytes-only` / `--no-lighthouse` | – | byte gate only |
| `--selftest` | – | extractor validation against saved JSON |
| `--base-url=` / `PERF_BASE_URL` | `http://localhost:8080` | server under test |
| `--app=` / `PERF_APP_ID` | `a1kguu163` | fixture app id |
| `PERF_PATHS` | `/,/about,/services,/contact` | candidate paths (first is the LH target) |
| `EXEPAD_DATA_DIR` | `<repo>/.exepad-data` | where compiled component JS + seeded fixture live |
| `CHROME_PATH` | `/usr/bin/google-chrome` | system Chrome for chrome-launcher |
| `PERF_OUT_DIR` | `tools/perf-ci/.report` | report output dir |

## The fixture

`fixture/landing/storage/` is a committed snapshot of a representative deployed
landing app (6 content pages + header/footer). `.exepad-data/` is gitignored and
a real deploy needs the Python agent, so `seed-fixture.mjs` copies this snapshot
into `EXEPAD_DATA_DIR/storage/<appId>`. The runtime resolves a published app's
config purely from FS storage — no `meta.sqlite` row is needed to *serve* it — so
the copy is sufficient for the Lighthouse leg.

To refresh the fixture from a newly built app, re-copy its `published/` (active
config + modules) and `compiled/frontend/` (components + styles) trees, omitting
the bulky `published/releases/` history.

## Wiring it into CI

There is **no perf workflow in `.github/workflows/` today** — the gate is run on
demand from a shell (see above). To automate it, a job needs to: build the SDK +
runtime, `pnpm perf:seed`, boot the server, wait for `/health`, run
`pnpm perf:ci`, and upload `perf-report.json` as an artifact regardless of
pass/fail so the numbers can be trended. Scope it to PRs touching
`apps/runtime/**`, `packages/exepad-sdk/**`, `packages/ui-core/**`, or this tool.

## Report shape

`.report/perf-report.json` contains: `bytes` (measured + per-component + gate),
a `lighthouse` array (one entry per form factor with extracted scores/metrics +
gate verdicts), and a top-level `failed` / `failures` summary.
