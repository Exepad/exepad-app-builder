/**
 * Admin Export Routes — owner-gated downloads of an app, in three forms:
 *
 *   GET /handover    — coding-agent handover kit (source + spec for any framework)
 *   GET /source      — complete, ready-to-build standalone project (full-stack)
 *   GET /deployable  — self-contained, run-ready bundle (compiled app + backend + data)
 *
 * All three share the config-driven source enumeration and the owner-only gate
 * from the read-only Source browser (routes/admin/source.ts). Auth is
 * {@link operatorOwnsApp} (no DB provisioning side effect). Zips are built in
 * THIS module where fflate lives, and returned directly (see the Response
 * realm-split note in admin-auth.ts).
 */
import { Hono } from 'hono';
import { zipSync } from 'fflate';
import type { Env } from '../../types/env';
import { operatorOwnsApp } from '../../lib/admin-auth';
import { slug, ExportTooLargeError } from '../../lib/export/source-set';
import { buildHandoverKit } from '../../lib/export/handover';
import { buildStandaloneProject } from '../../lib/export/standalone';
import { buildDeployableBundle } from '../../lib/export/deployable';

export const exportRoutes = new Hono<{ Bindings: Env }>();

/** Build a zip Response from a path→bytes map, in this module (fflate realm). */
function zipResponse(files: Record<string, Uint8Array>, filename: string): Response {
  const zipped = zipSync(files, { level: 6 });
  const body = zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(zipped.length),
      'Cache-Control': 'no-store',
    },
  });
}

// ── GET /handover — coding-agent handover kit ────────────────
exportRoutes.get('/handover', async (c) => {
  const appId = c.req.param('appId')!;
  if (!(await operatorOwnsApp(c.req.raw, c.env, appId))) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  try {
    const kit = await buildHandoverKit(c.env, appId);
    if (!kit) {
      return c.json(
        { success: false, error: 'No source is available for this app yet. Build it first.' },
        404,
      );
    }
    return zipResponse(kit.files, `${slug(kit.appName)}-handover.zip`);
  } catch (err) {
    if (err instanceof ExportTooLargeError) {
      return c.json({ success: false, error: err.message }, 413);
    }
    console.error(`[Export] handover error for ${appId}:`, err);
    return c.json({ success: false, error: 'Failed to build handover kit.' }, 500);
  }
});

// ── GET /source — complete, ready-to-build standalone project ─
exportRoutes.get('/source', async (c) => {
  const appId = c.req.param('appId')!;
  if (!(await operatorOwnsApp(c.req.raw, c.env, appId))) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  try {
    const project = await buildStandaloneProject(c.env, appId);
    if (!project) {
      return c.json(
        { success: false, error: 'No source is available for this app yet. Build it first.' },
        404,
      );
    }
    return zipResponse(project.files, `${slug(project.appName)}-source.zip`);
  } catch (err) {
    if (err instanceof ExportTooLargeError) {
      return c.json({ success: false, error: err.message }, 413);
    }
    console.error(`[Export] source error for ${appId}:`, err);
    return c.json({ success: false, error: 'Failed to build standalone project.' }, 500);
  }
});

// ── GET /deployable — self-contained, run-ready bundle (D1) ──
exportRoutes.get('/deployable', async (c) => {
  const appId = c.req.param('appId')!;
  if (!(await operatorOwnsApp(c.req.raw, c.env, appId))) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  try {
    const bundle = await buildDeployableBundle(c.env, appId);
    if (!bundle) {
      return c.json(
        { success: false, error: 'This app has no published deployment yet. Publish it first.' },
        404,
      );
    }
    return zipResponse(bundle.files, `${slug(bundle.appName)}-deployable.zip`);
  } catch (err) {
    if (err instanceof ExportTooLargeError) {
      return c.json({ success: false, error: err.message }, 413);
    }
    console.error(`[Export] deployable error for ${appId}:`, err);
    return c.json({ success: false, error: 'Failed to build deployable bundle.' }, 500);
  }
});
