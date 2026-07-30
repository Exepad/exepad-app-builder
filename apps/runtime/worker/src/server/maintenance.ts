/**
 * Maintenance cron — the container's only background job.
 *
 * `docker/entrypoint.sh` has no scheduler and the Node server is otherwise
 * request-driven, so this is a single self-rescheduling timer started from
 * main.ts after the server boots. Each tick does two things:
 *
 *   1. cleanupDeadApps — permanently remove apps wedged in `building` (a build
 *      whose process died) past the building cutoff, and `error` apps past the
 *      error grace. "Permanently" = storage + per-app SQLite (deprovisionApp)
 *      AND the meta.sqlite registry rows (deleteApp).
 *   2. captureThumbnails — screenshot each built app's live preview into a
 *      dashboard thumbnail when missing or stale, in an isolated subprocess
 *      (see screenshot-worker.ts).
 *
 * Hard invariant: this must NEVER throw out of the timer. The runtime is the
 * container's only public listener and entrypoint.sh exits the whole container
 * if `node` dies (`wait -n`). Every tick body is wrapped; Chromium runs in a
 * child process so a browser OOM/crash can't take the server down.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Env } from '../types/env';
import { resolveSecret } from '../lib/secrets';
import {
  mintPreviewAccessToken,
  mintSessionToken,
  PLATFORM_SESSION_COOKIE,
} from '../routes/gateway/auth';
import { deprovisionApp } from '../routes/deprovision';
import { isBuildActive } from '../routes/orchestrate';
import { loadAppConfig } from '../lib/app-config';
import { displayNameFromConfig } from '../lib/app-name';
import {
  getApp,
  getUserById,
  listAppsForThumbnails,
  listBuiltApps,
  listDeadApps,
  setThumbnailAt,
  setAppName,
  deleteApp,
  type MetaApp,
} from '../lib/meta-db';

// This is a destructive cron (it permanently deletes apps), so its audit trail
// must be visible. The shared logger defaults to 'warn' in self-host, which
// would hide info/debug lines — so print via console directly, matching the
// worker's existing [Deprovision]/[API Gateway] operational lines. debug is a
// no-op (per-tick "done" timing is noise).
const log = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(`[Maintenance] ${msg}`, meta ? JSON.stringify(meta) : ''),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn(`[Maintenance] ${msg}`, meta ? JSON.stringify(meta) : ''),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error(`[Maintenance] ${msg}`, meta ? JSON.stringify(meta) : ''),
  debug: (_msg: string, _meta?: Record<string, unknown>) => {},
};

// ─── Config (env, all with defaults) ──────────────────────────────────────────

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(v.toLowerCase());
}
function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * True when the Playwright browser bundle is actually present. When
 * PLAYWRIGHT_BROWSERS_PATH is set (the container always sets it) an empty or
 * missing dir means Chromium was never installed — the server-lite image, or a
 * failed local download. Memoized: the bundle can't appear mid-process.
 */
let _browsersPresent: boolean | null = null;
function browsersPresent(): boolean {
  if (_browsersPresent === null) {
    const p = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!p) {
      _browsersPresent = true; // playwright's own cache resolution decides
    } else {
      try {
        _browsersPresent = existsSync(p) && readdirSync(p).length > 0;
      } catch {
        _browsersPresent = false;
      }
      if (!_browsersPresent) {
        log.info('no Chromium bundle at PLAYWRIGHT_BROWSERS_PATH — dashboard thumbnails disabled', {
          path: p,
        });
      }
    }
  }
  return _browsersPresent;
}

const CFG = {
  get enabled() {
    return envBool('EXEPAD_MAINTENANCE_ENABLED', true);
  },
  get intervalMin() {
    return envNum('EXEPAD_MAINTENANCE_INTERVAL_MIN', 15);
  },
  get firstDelaySec() {
    return envNum('EXEPAD_MAINTENANCE_FIRST_DELAY_SEC', 90);
  },
  get thumbsEnabled() {
    // The env flag is the operator switch; browser presence is checked HERE —
    // the single consumer — rather than only in docker/entrypoint.sh, so a
    // Chromium-less rig (the server-lite image, or a `run.sh local` whose
    // browser download failed) degrades to "thumbnails off" instead of
    // spawning a screenshot child that crashes on launch every 15-min tick.
    // Only enforced when PLAYWRIGHT_BROWSERS_PATH is explicitly set: without
    // it, playwright resolves browsers from its own cache and remains the
    // authority (no false negatives on dev machines).
    return envBool('EXEPAD_THUMBNAILS_ENABLED', true) && browsersPresent();
  },
  get cleanupEnabled() {
    return envBool('EXEPAD_CLEANUP_ENABLED', true);
  },
  get nameBackfillEnabled() {
    return envBool('EXEPAD_NAME_BACKFILL_ENABLED', true);
  },
  get buildingMinutes() {
    return envNum('EXEPAD_CLEANUP_BUILDING_MINUTES', 30);
  },
  get errorHours() {
    return envNum('EXEPAD_CLEANUP_ERROR_HOURS', 24);
  },
};

interface WorkItem {
  appId: string;
  url: string;
  cookies?: Array<{ name: string; value: string }>;
}
interface CaptureResult {
  appId: string;
  ok: boolean;
  bytes?: number;
  error?: string;
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let started = false;

/** Start the self-rescheduling maintenance timer. Idempotent. */
export function startMaintenanceCron(env: Env): void {
  if (started) return;
  if (!CFG.enabled) {
    log.info('maintenance cron disabled (EXEPAD_MAINTENANCE_ENABLED)');
    return;
  }
  started = true;
  const intervalMs = CFG.intervalMin * 60_000;

  const schedule = (delayMs: number): void => {
    const t = setTimeout(run, delayMs);
    // Don't let the cron timer keep the process alive on its own — the HTTP
    // server holds the event loop; the timer is incidental.
    t.unref?.();
  };

  // Reschedule only AFTER a tick finishes, so a slow Chromium pass can never
  // overlap the next one. `tick` swallows its own errors; the extra .catch is
  // belt-and-suspenders so the timer chain can never break.
  const run = (): void => {
    void tick(env)
      .catch((e) => log.error('maintenance tick crashed', { error: String(e) }))
      .finally(() => schedule(intervalMs));
  };

  log.info('maintenance cron scheduled', {
    intervalMin: CFG.intervalMin,
    firstDelaySec: CFG.firstDelaySec,
    thumbnails: CFG.thumbsEnabled,
    cleanup: CFG.cleanupEnabled,
  });
  schedule(CFG.firstDelaySec * 1000);
}

// The name-backfill is a one-time reconciliation for apps created before the
// build pump started syncing apps.name from the config — it never needs to run
// twice in a process, so it's gated to the first tick.
let nameBackfillDone = false;

async function tick(env: Env): Promise<void> {
  const t0 = Date.now();
  if (CFG.nameBackfillEnabled && !nameBackfillDone) {
    nameBackfillDone = true;
    try {
      await backfillAppNames(env);
    } catch (e) {
      log.error('maintenance name backfill failed', { error: String(e) });
    }
  }
  if (CFG.cleanupEnabled) {
    try {
      await cleanupDeadApps(env);
    } catch (e) {
      log.error('maintenance cleanup failed', { error: String(e) });
    }
  }
  if (CFG.thumbsEnabled) {
    try {
      await captureThumbnails(env);
    } catch (e) {
      log.error('maintenance thumbnails failed', { error: String(e) });
    }
  }
  log.debug('maintenance tick done', { ms: Date.now() - t0 });
}

// ─── Cleanup: permanently delete stuck/errored apps ───────────────────────────

async function cleanupDeadApps(env: Env): Promise<void> {
  const now = Date.now();
  const buildingBefore = new Date(now - CFG.buildingMinutes * 60_000).toISOString();
  const errorBefore = new Date(now - CFG.errorHours * 3_600_000).toISOString();

  const candidates = listDeadApps(buildingBefore, errorBefore).filter(
    (a) => !isBuildActive(a.id),
  );
  if (candidates.length === 0) return;

  let removed = 0;
  for (const app of candidates) {
    // Final guard: re-read so we never delete an app a concurrent build just
    // moved out of building/error (or that started building since the scan).
    const fresh = getApp(app.id);
    if (!fresh || isBuildActive(fresh.id)) continue;
    if (!isDead(fresh, buildingBefore, errorBefore)) continue;
    try {
      // deprovisionApp removes storage + per-app SQLite (collects, never throws);
      // deleteApp removes the registry rows. Order: files first, rows last, so a
      // throw can't orphan the registry pointer.
      await deprovisionApp(env, fresh.id);
      deleteApp(fresh.id);
      removed++;
      log.info('maintenance: removed dead app', {
        appId: fresh.id,
        status: fresh.status,
        updatedAt: fresh.updated_at,
      });
    } catch (e) {
      log.error('maintenance: failed to remove dead app', {
        appId: fresh.id,
        error: String(e),
      });
    }
  }
  if (removed > 0) {
    log.info('maintenance: cleanup complete', { removed, scanned: candidates.length });
  }
}

function isDead(app: MetaApp, buildingBefore: string, errorBefore: string): boolean {
  return (
    (app.status === 'building' && app.updated_at < buildingBefore) ||
    (app.status === 'error' && app.updated_at < errorBefore)
  );
}

// ─── Name backfill: reconcile apps.name from the deployed config ───────────────
//
// apps.name is seeded at create with a prompt-derived placeholder; the build pump
// now syncs the agent's real config name into it on every successful build. Apps
// built before that change keep the placeholder until rebuilt — this one-time
// boot pass reads each built app's deployed config and copies a real name across
// (updated_at-preserving, so it doesn't disturb "Updated …" or thumbnail freshness).

export async function backfillAppNames(env: Env): Promise<void> {
  const apps = listBuiltApps();
  if (apps.length === 0) return;

  let fixed = 0;
  for (const app of apps) {
    // A build in flight will settle the name itself; don't race it.
    if (isBuildActive(app.id)) continue;
    try {
      const config = await loadAppConfig(app.id, env, 'preview', { noCache: true });
      const name = displayNameFromConfig(config);
      if (name && name !== app.name) {
        setAppName(app.id, name);
        fixed++;
        log.info('name backfill: synced from config', {
          appId: app.id,
          from: app.name,
          to: name,
        });
      }
    } catch (e) {
      // Never let one unreadable config abort the pass (or the tick).
      log.warn('name backfill: skipped app', { appId: app.id, error: String(e) });
    }
  }
  if (fixed > 0) {
    log.info('name backfill complete', { fixed, scanned: apps.length });
  }
}

// ─── Thumbnails: screenshot live previews via an isolated child ───────────────

async function captureThumbnails(env: Env): Promise<void> {
  const pending = listAppsForThumbnails().filter((a) => !isBuildActive(a.id));
  if (pending.length === 0) return;

  const bridgeSecret = await resolveSecret(env.PLATFORM_BRIDGE_SECRET);
  if (!bridgeSecret) {
    log.warn('maintenance: no PLATFORM_BRIDGE_SECRET — skipping thumbnails');
    return;
  }
  const port = Number(process.env.PORT ?? 8080);

  // Authenticate the capture as the app's owner. Two layers are needed:
  //   • preview token (`?pt=`)   → authenticates the server-side resource fetches
  //     (config, /repo/*.js) for the preview.
  //   • platform session cookie  → authenticates BOTH those AND the client-side
  //     PreviewPage gate, which calls /auth/me. Without it the headless render
  //     shows the "Authentication Required" overlay: a fresh browser context has
  //     no operator session, and the cloud `?pt`→JWT exchange is a no-op in
  //     self-host. Same signing secret (PLATFORM_BRIDGE_SECRET) for both.
  const items: WorkItem[] = [];
  for (const app of pending) {
    const owner = getUserById(app.owner_id);
    if (!owner) {
      log.warn('maintenance: app owner not found — skipping thumbnail', {
        appId: app.id,
        ownerId: app.owner_id,
      });
      continue;
    }
    const previewToken = await mintPreviewAccessToken(app.id, owner.id, owner.email, bridgeSecret);
    // Short-lived (10 min) — the capture happens within seconds of minting.
    const sessionToken = await mintSessionToken(owner.id, owner.email, [owner.role], bridgeSecret, 600);
    items.push({
      appId: app.id,
      url: `http://127.0.0.1:${port}/a/preview-${app.id}/?pt=${encodeURIComponent(previewToken)}`,
      cookies: [{ name: PLATFORM_SESSION_COOKIE, value: sessionToken }],
    });
  }
  if (items.length === 0) return;

  const results = await runScreenshotChild(items);
  let ok = 0;
  for (const r of results) {
    if (r.ok) {
      setThumbnailAt(r.appId, new Date().toISOString());
      ok++;
    } else {
      log.warn('maintenance: thumbnail capture failed', { appId: r.appId, error: r.error });
    }
  }
  log.info('maintenance: thumbnails captured', { requested: items.length, ok });
}

/** Spawn the isolated screenshot child, await it, and return its results. */
function runScreenshotChild(items: WorkItem[]): Promise<CaptureResult[]> {
  const workfile = join(tmpdir(), 'exepad-thumb-work.json');
  const childPath =
    process.env.EXEPAD_SCREENSHOT_WORKER ??
    fileURLToPath(new URL('./screenshot-worker.mjs', import.meta.url));

  return new Promise<CaptureResult[]>((resolve) => {
    let settled = false;
    const done = (r: CaptureResult[]): void => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };

    try {
      writeFileSync(workfile, JSON.stringify({ items }));
    } catch (e) {
      log.error('maintenance: failed to write thumbnail work-file', { error: String(e) });
      return done([]);
    }

    let out = '';
    const child = spawn(process.execPath, [childPath, workfile], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    child.stdout?.on('data', (b: Buffer) => {
      out += b.toString();
    });
    child.on('error', (e) => {
      log.error('maintenance: screenshot child failed to start', { error: String(e) });
      done([]);
    });
    child.on('close', (code) => {
      try {
        rmSync(workfile, { force: true });
      } catch {
        /* ignore */
      }
      if (code !== 0) {
        log.warn('maintenance: screenshot child exited non-zero', { code });
        return done([]);
      }
      try {
        done(JSON.parse(out || '[]') as CaptureResult[]);
      } catch {
        log.error('maintenance: unparseable screenshot child output');
        done([]);
      }
    });

    // Hard cap so a hung browser can't wedge the cron chain forever.
    const killer = setTimeout(
      () => {
        if (!settled) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
          log.warn('maintenance: screenshot child timed out — killed');
          done([]);
        }
      },
      Math.max(60_000, items.length * 45_000),
    );
    killer.unref?.();
  });
}
