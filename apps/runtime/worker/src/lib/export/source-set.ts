/**
 * Shared source-set enumeration for the read-only Source browser and the export
 * builders (deployable bundle / standalone project / handover kit).
 *
 * "Source set" = the human-authored files the agent wrote for an app, discovered
 * by walking the live config's `repo.*` source refs (NOT a raw storage prefix
 * walk — see the rationale in routes/admin/source.ts). The same enumeration
 * drives the read-only browser (which omits app_config.json) and the export
 * builders (which include it), so the logic lives here once.
 */
import type { Env } from '../../types/env';

/** The app's live preview config — the source of truth for what files exist. */
export const CONFIG_REL = 'preview/app-config.json';

/** Cap any in-memory zip so a pathological app can't exhaust the event loop. */
export const MAX_ZIP_BYTES = 25 * 1024 * 1024;

/** Extensions treated as text (inline-viewable). */
export const TEXT_EXTS = new Set([
  'tsx', 'ts', 'jsx', 'js', 'css', 'csv', 'json', 'md', 'txt', 'html', 'svg',
]);

export interface RepoEntryLike {
  source?: string;
  supporting_modules?: string[];
}

export interface SourceEntry {
  /** Path relative to the repo root (e.g. `code/frontend/components/Foo.tsx`). */
  path: string;
  /** Full storage key (`{appId}/{path}`). */
  key: string;
  size: number;
}

export interface Enumerated {
  configRaw: string | null;
  entries: SourceEntry[];
}

export function ext(path: string): string {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i + 1).toLowerCase() : '';
}

/**
 * A source path is safe when it is a plain relative path under the repo (no
 * leading slash, no `.`/`..` segment, no NUL). Config is platform-generated so
 * this is defense-in-depth; consumers additionally require membership in the
 * enumerated set, which is the real traversal guard.
 */
export function isSafeRelPath(p: string): boolean {
  if (!p || p.startsWith('/') || p.includes('\0')) return false;
  return !p.split('/').some((seg) => seg === '..' || seg === '.' || seg === '');
}

/** Collect every config-referenced source path (relative to `{appId}/`). */
export function collectSourcePaths(config: Record<string, unknown>): Set<string> {
  const paths = new Set<string>();
  const add = (s: unknown) => {
    if (typeof s === 'string' && isSafeRelPath(s)) paths.add(s);
  };
  const repo = (config.repo as Record<string, unknown> | undefined) ?? {};
  const frontend = (repo.frontend as Record<string, unknown> | undefined) ?? {};
  const backend = (repo.backend as Record<string, unknown> | undefined) ?? {};

  const components = (frontend.components as Record<string, RepoEntryLike> | undefined) ?? {};
  for (const entry of Object.values(components)) {
    add(entry?.source);
    // Supporting modules are referenced by name; their persisted source sits as
    // a sibling of the entry component (see materialize-build.ts). Pre-fix
    // builds never persisted them — those refs simply resolve to no file and
    // are skipped by the head() existence check below.
    for (const mod of entry?.supporting_modules ?? []) {
      if (typeof mod === 'string' && mod) add(`code/frontend/components/${mod}.tsx`);
    }
  }
  const modules = (frontend.modules as Record<string, RepoEntryLike> | undefined) ?? {};
  for (const entry of Object.values(modules)) add(entry?.source);

  const handlers = (backend.handlers as Record<string, RepoEntryLike> | undefined) ?? {};
  for (const entry of Object.values(handlers)) add(entry?.source);

  const styles = (frontend.styles as Record<string, RepoEntryLike> | undefined) ?? {};
  for (const entry of Object.values(styles)) add(entry?.source);

  const seed = (repo.seed as Record<string, RepoEntryLike> | undefined) ?? {};
  for (const entry of Object.values(seed)) add(entry?.source);

  return paths;
}

/**
 * Enumerate the app's source working set from its live config. Returns the raw
 * config text plus every referenced source file that actually exists in storage
 * (missing refs — e.g. supporting modules from a pre-fix build — are skipped).
 */
export async function enumerateSource(env: Env, appId: string): Promise<Enumerated> {
  const configObj = await env.CONFIG_CACHE.get(`${appId}/${CONFIG_REL}`);
  if (!configObj) return { configRaw: null, entries: [] };
  const configRaw = await configObj.text();

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(configRaw) as Record<string, unknown>;
  } catch {
    config = {};
  }

  const entries: SourceEntry[] = [];
  for (const rel of [...collectSourcePaths(config)].sort()) {
    const key = `${appId}/${rel}`;
    const meta = await env.CONFIG_CACHE.head(key);
    if (meta) entries.push({ path: rel, key, size: meta.size });
  }
  return { configRaw, entries };
}

/** Best-effort human app name from the config (cosmetic — for filenames/titles). */
export function appNameOf(configRaw: string | null): string {
  if (!configRaw) return 'app';
  try {
    const c = JSON.parse(configRaw) as Record<string, unknown>;
    const app = c.app as Record<string, unknown> | undefined;
    const meta = c.metadata as Record<string, unknown> | undefined;
    const name = (c.name ?? app?.name ?? meta?.name) as string | undefined;
    return name?.trim() || 'app';
  } catch {
    return 'app';
  }
}

/** Filesystem-safe slug for download filenames / package names. */
export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

/**
 * Read the bytes for each enumerated entry into a `path → bytes` map. Entries
 * that raced a concurrent rebuild (get() returns null) are skipped. Throws if
 * the running total exceeds {@link MAX_ZIP_BYTES} (caller maps to HTTP 413).
 */
export async function readEntryBytes(
  env: Env,
  entries: SourceEntry[],
  startBytes = 0,
): Promise<{ files: Record<string, Uint8Array>; total: number }> {
  const files: Record<string, Uint8Array> = {};
  let total = startBytes;
  for (const e of entries) {
    const obj = await env.CONFIG_CACHE.get(e.key);
    if (!obj) continue;
    const buf = new Uint8Array(await obj.arrayBuffer());
    total += buf.length;
    if (total > MAX_ZIP_BYTES) {
      throw new ExportTooLargeError();
    }
    files[e.path] = buf;
  }
  return { files, total };
}

export class ExportTooLargeError extends Error {
  constructor() {
    super('Export is too large to download as a single archive.');
    this.name = 'ExportTooLargeError';
  }
}
