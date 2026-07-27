/**
 * Screenshot child — an isolated, short-lived Chromium process spawned by the
 * maintenance cron (server/maintenance.ts) to capture dashboard thumbnails.
 *
 * Why a separate process and not in-process:
 *   The runtime Node server is the container's only public listener, and
 *   `docker/entrypoint.sh` exits the whole container if `node` dies (`wait -n`).
 *   Chromium is memory-hungry and can OOM/crash; isolating it here means a
 *   browser death takes down only this subprocess, never the server. Memory is
 *   reclaimed on exit.
 *
 * Contract:
 *   argv[2] = path to a JSON work-file: { items: [{ appId, url }], viewport?,
 *             timeoutMs?, settleMs? }. Each `url` is a ready-to-load preview URL
 *             that already carries a `?pt=` preview-access token, so this child
 *             needs no secrets and never touches meta.sqlite.
 *   stdout  = JSON array of { appId, ok, bytes?, error? } (the parent stamps
 *             `thumbnail_at` for the ok ones).
 *   exit    = 0 on a completed pass (even with per-item failures); non-zero only
 *             if the browser itself can't start.
 *
 * Deps: `playwright-core` (esbuild external, installed in the image) +
 *       `@exepad/local-adapters` (bundled) for the same FS storage surface the
 *       server's CONFIG_CACHE reads back.
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { FsStorageAdapter } from '@exepad/local-adapters';

interface WorkItem {
  appId: string;
  url: string;
  /** Cookies to install on the context before navigating (e.g. the platform
   *  session, which authenticates the client-side PreviewPage gate). */
  cookies?: Array<{ name: string; value: string }>;
}

interface WorkFile {
  items: WorkItem[];
  viewport?: { width: number; height: number };
  timeoutMs?: number;
  settleMs?: number;
}

interface CaptureResult {
  appId: string;
  ok: boolean;
  bytes?: number;
  error?: string;
}

async function main(): Promise<void> {
  const workfile = process.argv[2];
  if (!workfile) {
    console.error('[screenshot-worker] usage: screenshot-worker <workfile.json>');
    process.exit(2);
  }

  const work = JSON.parse(readFileSync(workfile, 'utf-8')) as WorkFile;
  const items = work.items ?? [];
  const viewport = work.viewport ?? { width: 1280, height: 800 };
  const navTimeout = work.timeoutMs ?? 30_000;
  const settleMs = work.settleMs ?? 1200;

  if (items.length === 0) {
    process.stdout.write('[]');
    return;
  }

  const storage = new FsStorageAdapter();
  const results: CaptureResult[] = [];

  // --no-sandbox: the container runs as root with no setuid sandbox.
  // --disable-dev-shm-usage: default /dev/shm is 64 MB and crashes Chromium.
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    for (const item of items) {
      const context = await browser.newContext({ viewport, colorScheme: 'light' });
      if (item.cookies?.length) {
        // Scope cookies to the target origin (Playwright derives domain/path).
        const origin = new URL(item.url).origin;
        await context.addCookies(
          item.cookies.map((c) => ({ name: c.name, value: c.value, url: origin })),
        );
      }
      const page = await context.newPage();
      try {
        // `load` (not `networkidle`): preview keep-alive sockets can mean the
        // page never reaches network idle. Settle afterwards for late paints.
        await page.goto(item.url, { waitUntil: 'load', timeout: navTimeout });
        // Let fonts swap from fallback before the frame (string form avoids
        // pulling DOM lib types into this node-compiled file).
        await page.evaluate('document.fonts && document.fonts.ready').catch(() => undefined);
        await page.waitForTimeout(settleMs);

        const buf = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false });
        await storage.put(`${item.appId}/thumbnail.jpg`, buf, {
          httpMetadata: { contentType: 'image/jpeg' },
        });
        results.push({ appId: item.appId, ok: true, bytes: buf.length });
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        results.push({ appId: item.appId, ok: false, error: msg });
      } finally {
        await context.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  process.stdout.write(JSON.stringify(results));
}

main().catch((err) => {
  console.error(
    `[screenshot-worker] fatal: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
