import type {
  DeploymentStatus,
  PublishedManifest,
  WorkerTemplatePointer,
} from '@exepad/types';
import { captureAndRewriteImages } from './image-capture';

const CONTENT_HASH_LENGTH = 12;

async function contentHash(data: ArrayBuffer | string): Promise<string> {
  const buffer =
    typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, CONTENT_HASH_LENGTH);
}

export async function saveDeploymentStatus(
  r2: R2Bucket,
  status: DeploymentStatus,
): Promise<void> {
  const key = `${status.appId}/deployment-status-${status.mode}.json`;
  const body = JSON.stringify({ ...status, updatedAt: new Date().toISOString() });
  await r2.put(key, body, {
    httpMetadata: { contentType: 'application/json' },
  });
}

export async function loadDeploymentStatus(
  r2: R2Bucket,
  appId: string,
  mode: string,
): Promise<DeploymentStatus | null> {
  const key = `${appId}/deployment-status-${mode}.json`;
  const obj = await r2.get(key);
  if (!obj) return null;
  return (await obj.json()) as DeploymentStatus;
}

export async function readAppConfig(
  r2: R2Bucket,
  configKey: string,
): Promise<Record<string, unknown>> {
  const obj = await r2.get(configKey);
  if (!obj) {
    throw new Error(`Config not found in R2: ${configKey}`);
  }
  return (await obj.json()) as Record<string, unknown>;
}

export async function readRepoModules(
  r2: R2Bucket,
  appId: string,
  compiledPaths: string[],
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  if (compiledPaths.length === 0) return results;

  const reads = compiledPaths.map(async (relPath) => {
    const key = `${appId}/${relPath}`;
    const obj = await r2.get(key);

    const filename = relPath.split('/').pop()!;
    const name = stripHashSuffix(stripExtension(filename));

    if (obj) {
      results.set(name, await obj.text());
      return;
    }

    const sourceKey = key.replace(/\.js$/, '.tsx');
    const sourceExists = await r2.get(sourceKey);

    if (sourceExists) {
      throw new Error(
        `Handler source exists but compiled .js is missing: ${key}. ` +
        `The backend must compile .tsx → .js before uploading to R2 (inline compilation is not available in Cloudflare Workers).`,
      );
    }

    throw new Error(
      `Handler not found in R2 (tried .js and .tsx): ${key}. ` +
      `Ensure the handler source was uploaded from GCS to R2.`,
    );
  });

  await Promise.all(reads);
  return results;
}

// In-memory cache for worker template — keyed by SHA.
// Template rarely changes (only on platform updates), so this saves 1 R2 read per deploy.
let _templateCache: { content: string; sha: string } | null = null;

export async function readWorkerTemplate(
  r2: R2Bucket,
): Promise<{ content: string; sha: string }> {
  // Always read the pointer to get the current SHA
  const pointerObj = await r2.get('_system/worker-template-latest.json');
  if (!pointerObj) {
    // Self-host: the app-backend runs in-process (see gateway/dispatch-local.ts),
    // so the deploy pipeline never needs a WfP worker bundle. The `template.js`
    // module written by uploadWorkerScript is inert here — app-registry only
    // loads `handlers/*.js`. Return an empty stub instead of failing the deploy.
    return { content: '', sha: 'none' };
  }
  const pointer = (await pointerObj.json()) as WorkerTemplatePointer;

  // Return cached template if SHA matches (skip the second R2 read)
  if (_templateCache && _templateCache.sha === pointer.sha) {
    return _templateCache;
  }

  const templateObj = await r2.get(pointer.path);
  if (!templateObj) {
    throw new Error(
      `Worker template not found at ${pointer.path}. The pointer references a missing file.`,
    );
  }

  _templateCache = { content: await templateObj.text(), sha: pointer.sha };
  return _templateCache;
}

interface RepoEntry {
  source?: string;
  compiled?: string;
  source_hash?: string;
  type?: string;
  format?: string;
  model?: string;
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

function stripHashSuffix(filename: string): string {
  return filename.replace(/_[a-f0-9]+(_v\d+)?$/, '');
}

function publishedMethodFolder(entry: RepoEntry | undefined): 'handlers' | 'methods' {
  return entry?.type && entry.type !== 'handler' ? 'methods' : 'handlers';
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rewritePublishedConfig(
  appConfig: Record<string, unknown>,
  snapshotPrefix: string,
): Record<string, unknown> {
  const cloned = cloneJson(appConfig);
  const repo = cloned.repo as Record<string, unknown> | undefined;
  if (!repo) return cloned;

  const frontend = repo.frontend as Record<string, unknown> | undefined;
  const repoComponents =
    (frontend?.components as Record<string, RepoEntry> | undefined) ||
    (repo.components as Record<string, RepoEntry> | undefined);
  if (repoComponents) {
    for (const [name, entry] of Object.entries(repoComponents)) {
      if (!entry?.compiled) continue;
      entry.compiled = `${snapshotPrefix}/components/${name.replace(/_/g, '-')}.js`;
    }
  }

  const repoStyles = frontend?.styles as Record<string, RepoEntry> | undefined;
  if (repoStyles) {
    for (const entry of Object.values(repoStyles)) {
      if (!entry?.compiled) continue;
      const filename = entry.compiled.split('/').pop() || 'theme.css';
      entry.compiled = `${snapshotPrefix}/styles/${filename}`;
    }
  }

  const backend = repo.backend as Record<string, unknown> | undefined;
  const repoHandlers =
    (backend?.handlers as Record<string, RepoEntry> | undefined) ||
    (repo.methods as Record<string, RepoEntry> | undefined);
  if (repoHandlers) {
    for (const [name, entry] of Object.entries(repoHandlers)) {
      if (!entry?.compiled) continue;
      entry.compiled = `${snapshotPrefix}/${publishedMethodFolder(entry)}/${name}.js`;
    }
  }

  const repoSeed = repo.seed as Record<string, RepoEntry> | undefined;
  if (repoSeed) {
    for (const [name, entry] of Object.entries(repoSeed)) {
      if (!entry?.source) continue;
      const ext = entry.format === 'json' ? 'json' : 'csv';
      entry.source = `${snapshotPrefix}/seed/${name}.${ext}`;
    }
  }

  return cloned;
}

export async function writePublishedSnapshot(
  r2: R2Bucket,
  appId: string,
  appConfig: Record<string, unknown>,
  repoMethods: Record<string, RepoEntry>,
  options?: { prefix?: string },
): Promise<{ configPath: string; prefix: string }> {
  const snapshotPrefix = options?.prefix || 'published';
  const prefix = `${appId}/${snapshotPrefix}`;
  const manifestFiles: Record<string, { hash: string; size: number }> = {};

  // Load existing manifest for diff-based writes (skip unchanged files)
  let oldManifestFiles: Record<string, { hash: string; size: number }> = {};
  try {
    const oldManifestObj = await r2.get(`${prefix}/_manifest.json`);
    if (oldManifestObj) {
      const oldManifest = (await oldManifestObj.json()) as PublishedManifest;
      oldManifestFiles = oldManifest.files || {};
    }
  } catch {
    // First publish or corrupted manifest — write everything
  }

  let skippedCount = 0;

  async function putPublished(
    relPath: string,
    content: string | ArrayBuffer,
    contentType = 'application/javascript',
  ): Promise<void> {
    const bytes =
      typeof content === 'string'
        ? new TextEncoder().encode(content)
        : new Uint8Array(content);
    const hash = await contentHash(bytes.buffer as ArrayBuffer);
    const entry = { hash: `sha256:${hash}`, size: bytes.byteLength };

    // Skip R2 write if hash matches the existing manifest entry
    const existing = oldManifestFiles[relPath];
    if (existing && existing.hash === entry.hash && existing.size === entry.size) {
      manifestFiles[relPath] = entry;
      skippedCount++;
      return;
    }

    const key = `${prefix}/${relPath}`;
    await r2.put(key, bytes.buffer as ArrayBuffer, {
      httpMetadata: { contentType },
    });

    manifestFiles[relPath] = entry;
  }

  async function readRepo(relPath: string): Promise<string> {
    const key = `${appId}/${relPath}`;
    const obj = await r2.get(key);
    if (!obj) {
      throw new Error(`Required repo file not found: ${key}`);
    }
    return obj.text();
  }

  // Collect all files to process, then read from R2 in parallel
  const methodEntries = Object.entries(repoMethods).filter(([, e]) => e.compiled);
  const repo = appConfig.repo as Record<string, unknown> | undefined;
  const repoComponents =
    ((repo?.frontend as Record<string, unknown>)?.components as Record<string, RepoEntry>) ||
    (repo?.components as Record<string, RepoEntry>) ||
    {};
  const componentEntries = Object.entries(repoComponents).filter(([, e]) => e.compiled);
  const repoStyles =
    ((repo?.frontend as Record<string, unknown>)?.styles as Record<string, RepoEntry>) ||
    {};
  const styleEntries = Object.entries(repoStyles).filter(([, e]) => e.compiled);
  const repoSeed =
    ((appConfig.repo as Record<string, unknown>)?.seed as Record<string, RepoEntry>) || {};
  const seedEntries = Object.entries(repoSeed).filter(([, e]) => e.source);

  // Parallel R2 reads for all source files
  const [methodContents, componentContents, styleContents, seedContents] = await Promise.all([
    Promise.all(methodEntries.map(async ([name, entry]) => ({
      name,
      type: publishedMethodFolder(entry),
      content: await readRepo(entry.compiled!),
    }))),
    Promise.all(componentEntries.map(async ([name, entry]) => ({
      name: name.replace(/_/g, '-'),
      content: await readRepo(entry.compiled!),
    }))),
    Promise.all(styleEntries.map(async ([, entry]) => ({
      filename: entry.compiled!.split('/').pop() || 'theme.css',
      content: await readRepo(entry.compiled!),
    }))),
    Promise.all(seedEntries.map(async ([name, entry]) => ({
      name,
      content: await readRepo(entry.source!),
      format: entry.format,
    }))),
  ]);

  // Write files (putPublished skips unchanged via hash comparison)
  for (const m of methodContents) {
    await putPublished(`${m.type}/${m.name}.js`, m.content);
  }
  for (const c of componentContents) {
    await putPublished(`components/${c.name}.js`, c.content);
  }
  for (const s of styleContents) {
    await putPublished(`styles/${s.filename}`, s.content, 'text/css');
  }
  for (const s of seedContents) {
    const ext = s.format === 'json' ? 'json' : 'csv';
    const ct = ext === 'json' ? 'application/json' : 'text/csv';
    await putPublished(`seed/${s.name}.${ext}`, s.content, ct);
  }

  const captureResult = await captureAndRewriteImages(r2, appId, appConfig);
  for (const img of captureResult.captured) {
    const relPath = img.r2Key.replace(`${appId}/published/`, '');
    manifestFiles[relPath] = {
      hash: `sha256:${img.contentHash}`,
      size: img.size,
    };
  }

  const publishedConfig = rewritePublishedConfig(captureResult.rewrittenConfig, snapshotPrefix);
  const configJson = JSON.stringify(publishedConfig, null, 2);
  await putPublished('app-config.json', configJson, 'application/json');

  if (skippedCount > 0) {
    console.log(`[snapshot] Skipped ${skippedCount} unchanged files (diff-based)`);
  }

  // Clean up orphaned files from old manifest
  const currentKeys = new Set(Object.keys(manifestFiles));
  const orphanedKeys = Object.keys(oldManifestFiles).filter(k => !currentKeys.has(k));
  if (orphanedKeys.length > 0) {
    await Promise.allSettled(
      orphanedKeys.map(relPath => r2.delete(`${prefix}/${relPath}`)),
    );
    console.log(`[snapshot] Cleaned up ${orphanedKeys.length} orphaned files`);
  }

  const manifest: PublishedManifest = {
    version: 1,
    appId,
    mode: 'published',
    configSource: `${snapshotPrefix}/app-config.json`,
    createdAt: new Date().toISOString(),
    files: manifestFiles,
  };
  const manifestJson = JSON.stringify(manifest, null, 2);

  await r2.put(`${prefix}/_manifest.json`, manifestJson, {
    httpMetadata: { contentType: 'application/json' },
  });

  return {
    configPath: `${snapshotPrefix}/app-config.json`,
    prefix: snapshotPrefix,
  };
}

/**
 * Generate lightweight SEO HTML snapshots for each page in the app config.
 * These are injected into the SPA shell by meta-injector for crawlers.
 */
export async function writeSeoSnapshots(
  r2: R2Bucket,
  appId: string,
  appConfig: Record<string, unknown>,
  options?: { prefix?: string },
): Promise<void> {
  const snapshotPrefix = options?.prefix || 'published';
  const frontend = appConfig.frontend as Record<string, unknown> | undefined;
  if (!frontend) return;

  const pages = (frontend.pages as Array<Record<string, unknown>>) || [];
  const appName = (frontend.appName as string) || (appConfig.name as string) || '';

  const navLinks = pages
    .filter(p => p.slug && p.title)
    .map(p => `<a href="${escapeAttr(p.slug as string)}">${escapeContent(p.title as string)}</a>`)
    .join(' ');

  const navHtml = navLinks ? `<nav>${navLinks}</nav>` : '';

  // Build all SEO snapshots, then write to R2 in parallel
  const writes: Array<{ key: string; html: string }> = [];

  for (const page of pages) {
    const slug = page.slug as string;
    if (!slug) continue;

    const title = (page.title as string) || '';
    const summary = (page.summary as string) || '';

    const parts: string[] = [];
    if (appName) parts.push(`<header><span>${escapeContent(appName)}</span>${navHtml}</header>`);
    if (title) parts.push(`<h1>${escapeContent(title)}</h1>`);
    if (summary) parts.push(`<p>${escapeContent(summary)}</p>`);

    const content = (page.content as Array<Record<string, unknown>>) || [];
    for (const comp of content) {
      const compName = (comp.component as string) || (comp.componentType as string) || '';
      if (compName) {
        const readable = compName.replace(/([A-Z])/g, ' $1').trim();
        parts.push(`<section aria-label="${escapeAttr(readable)}"></section>`);
      }
    }

    if (parts.length === 0) continue;

    const html = parts.join('\n');
    const key = slug === '/'
      ? `${appId}/${snapshotPrefix}/seo/index.html`
      : `${appId}/${snapshotPrefix}/seo/${slug.replace(/^\//, '').replace(/\//g, '_')}.html`;

    writes.push({ key, html });
  }

  await Promise.all(
    writes.map(({ key, html }) =>
      r2.put(key, html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } }),
    ),
  );
}

function escapeContent(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str: string): string {
  return escapeContent(str).replace(/"/g, '&quot;');
}

/**
 * Delete all R2 objects under a given prefix.
 * Uses cursor-based pagination and concurrent deletes (up to 1000 per batch).
 * Individual failures are logged but don't stop the overall operation.
 * Returns the number of objects successfully deleted.
 */
export async function deleteR2ObjectsByPrefix(
  r2: R2Bucket,
  prefix: string,
): Promise<number> {
  let totalDeleted = 0;
  let cursor: string | undefined;

  do {
    const listed = await r2.list({ prefix, cursor, limit: 1000 });

    if (listed.objects.length === 0) break;

    const keys = listed.objects.map((obj) => obj.key);
    const results = await Promise.allSettled(keys.map((key) => r2.delete(key)));

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - succeeded;
    if (failed > 0) {
      console.warn(`[R2] ${failed}/${results.length} object deletions failed for prefix ${prefix}`);
    }
    totalDeleted += succeeded;

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return totalDeleted;
}

export async function validatePublishedManifest(
  r2: R2Bucket,
  appId: string,
  snapshotPrefix = 'published',
): Promise<boolean> {
  const manifestKey = `${appId}/${snapshotPrefix}/_manifest.json`;
  const manifestObj = await r2.get(manifestKey);
  if (!manifestObj) return false;

  const manifest = (await manifestObj.json()) as PublishedManifest;

  const checks = Object.entries(manifest.files).map(
    async ([relPath, expected]) => {
      const key = relPath.startsWith('assets/')
        ? `${appId}/published/${relPath}`
        : `${appId}/${snapshotPrefix}/${relPath}`;
      const obj = await r2.get(key);
      if (!obj) return false;

      const data = await obj.arrayBuffer();
      const hash = `sha256:${await contentHash(data)}`;
      return hash === expected.hash;
    },
  );

  const results = await Promise.all(checks);
  return results.every(Boolean);
}
