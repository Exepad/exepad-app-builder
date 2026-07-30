/**
 * Platform metadata store (`meta.sqlite`).
 *
 * The self-hosted single-container platform needs a small store outside the
 * per-app SQLite files for: the operator account(s), the app↔owner registry the
 * builder dashboard lists, and a deployment audit trail. This is the local
 * stand-in for the Django `app.exepad.com` backend's Postgres.
 *
 * Lives at `<EXEPAD_DATA_DIR>/meta.sqlite` (override with `EXEPAD_META_DB`).
 * Opened through the shared local-adapters registry so the handle is pooled
 * across the process. We cast the better-sqlite3 handle to a minimal structural
 * interface so this file (and the runtime worker's tsconfig) never needs the
 * `better-sqlite3` type package — the registry owns that dependency.
 */
import { openDbCached } from '@exepad/local-adapters';
import { join } from 'node:path';

export interface MetaUser {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: string;
  /**
   * Monotonic session-revocation counter. Every signed platform-session token
   * carries the value that was current at mint time (the `gen` claim); the
   * verify path rejects a token whose claim no longer matches this column.
   * Bumping it (logout-all, password change) invalidates ALL of the operator's
   * outstanding sessions at once. Backward-compat: tokens minted before this
   * feature carry no `gen` claim and are treated as generation 0.
   */
  session_generation: number;
}

export interface MetaApp {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  status: string;
  last_session_id: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  /** Deployment id of the preview version currently live (the restore pointer). */
  active_preview_version: number | null;
  /** Deployment id of the published release currently live (the rollback pointer). */
  active_published_version: number | null;
  /** When the dashboard preview thumbnail was last captured. Null = never.
   *  The maintenance cron regenerates whenever this is null or < updated_at. */
  thumbnail_at: string | null;
}

export interface MetaDeployment {
  id: number;
  app_id: string;
  mode: string;
  status: string;
  config_path: string | null;
  correlation_id: string | null;
  /** Short human label for the version timeline (the build prompt, truncated). */
  label: string | null;
  error: string | null;
  created_at: string;
}

/**
 * A custom hostname the operator has pointed at this instance (the self-serve
 * custom-domain feature). One row per host (apex, subdomain, wildcard, or a
 * derived `<dashed-ip>.sslip.io` hostname for a bare IP).
 *
 *  - `app_id` NULL  → the host serves the whole studio (apps live under `/a/{id}/`).
 *  - `app_id` set   → the host serves exactly that ONE published app at its root.
 *
 * `status` drives the on-demand-TLS `ask` allowlist, the dynamic CORS allowlist,
 * and host→app routing: only `active` rows take effect. A row becomes `active`
 * after DNS-ownership verification (TXT challenge), so the cert-issuance `ask`
 * endpoint never authorizes a host the operator hasn't proven they control.
 */
export interface MetaDomain {
  /** Lowercased FQDN / wildcard (`*.apps.acme.com`) / sslip hostname. */
  domain: string;
  owner_id: string;
  /** NULL = whole studio; set = single published app served at the host root. */
  app_id: string | null;
  /** TLS strategy: 'auto' (HTTP-01/TLS-ALPN-01) | 'dns' (DNS-01) | 'sslip' | 'byoc'. */
  mode: string;
  /** 'proxied' = the operator's own proxy fronts this host (only the ownership
   *  TXT record applies; the address record is theirs to manage), else NULL. */
  routing: string | null;
  /** 'pending' | 'verifying' | 'active' | 'error'. */
  status: string;
  /** Random token the operator publishes as a TXT record to prove ownership. */
  verification_token: string;
  /** The A/CNAME target shown to the operator (this instance's public IP/host), or null if unknown. */
  dns_target: string | null;
  /** 1 = emit Strict-Transport-Security for this host (opt-in; off by default). */
  hsts: number;
  last_error: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}
interface Stmt {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): RunResult;
}
interface Handle {
  prepare(sql: string): Stmt;
  exec(sql: string): void;
}

function metaDbPath(): string {
  return (
    process.env.EXEPAD_META_DB ??
    join(process.env.EXEPAD_DATA_DIR ?? '/data', 'meta.sqlite')
  );
}

const migrated = new Set<string>();

/** Open (and migrate once) the pooled meta.sqlite handle. */
export function getMetaDb(): Handle {
  const path = metaDbPath();
  const db = openDbCached(path) as unknown as Handle;
  if (!migrated.has(path)) {
    migrate(db);
    migrated.add(path);
  }
  return db;
}

function migrate(db: Handle): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'admin',
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS apps (
      id              TEXT PRIMARY KEY,
      owner_id        TEXT NOT NULL,
      name            TEXT NOT NULL,
      slug            TEXT NOT NULL UNIQUE,
      status          TEXT NOT NULL DEFAULT 'draft',
      last_session_id TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      published_at    TEXT
    );
    CREATE TABLE IF NOT EXISTS deployments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id         TEXT NOT NULL,
      mode           TEXT NOT NULL,
      status         TEXT NOT NULL,
      config_path    TEXT,
      correlation_id TEXT,
      error          TEXT,
      created_at     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS platform_sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_apps_owner ON apps(owner_id);
    CREATE INDEX IF NOT EXISTS idx_deployments_app ON deployments(app_id);
    CREATE TABLE IF NOT EXISTS registered_domains (
      domain             TEXT PRIMARY KEY,
      owner_id           TEXT NOT NULL,
      app_id             TEXT,
      mode               TEXT NOT NULL DEFAULT 'auto',
      status             TEXT NOT NULL DEFAULT 'pending',
      verification_token TEXT NOT NULL,
      dns_target         TEXT,
      hsts               INTEGER NOT NULL DEFAULT 0,
      last_error         TEXT,
      verified_at        TEXT,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_domains_owner ON registered_domains(owner_id);
    CREATE INDEX IF NOT EXISTS idx_domains_app ON registered_domains(app_id);
  `);

  // Additive column tracking the currently-live published deployment id (mirror
  // of active_preview_version) so publish/promote can mark the active release.
  addColumn(db, 'apps', 'active_published_version', 'INTEGER');

  // Additive columns for the app-versioning feature. Run as idempotent ALTERs so
  // existing meta.sqlite files (created before versioning) upgrade in place.
  addColumn(db, 'deployments', 'label', 'TEXT');
  addColumn(db, 'apps', 'active_preview_version', 'INTEGER');
  // Additive column for the maintenance cron's dashboard thumbnails.
  addColumn(db, 'apps', 'thumbnail_at', 'TEXT');
  // Additive column for session-revocation (logout-all / password change). A
  // NOT NULL DEFAULT 0 backfills every pre-existing user to generation 0, so the
  // upgrade never force-logs-out current operators.
  addColumn(db, 'users', 'session_generation', 'INTEGER NOT NULL DEFAULT 0');
  // Additive column for behind-own-proxy domains ('proxied' | NULL): the wizard
  // uses it to drop the A/CNAME advice for hosts whose address the operator's
  // proxy owns. NULL (all pre-existing rows) keeps today's behavior.
  addColumn(db, 'registered_domains', 'routing', 'TEXT');
}

/** Add a column if the table doesn't already have it (SQLite has no IF NOT EXISTS for columns). */
function addColumn(db: Handle, table: string, column: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

// ─── Users ──────────────────────────────────────────────────────────────────

export function countUsers(): number {
  const row = getMetaDb().prepare('SELECT COUNT(*) AS n FROM users').get() as
    | { n: number }
    | undefined;
  return row?.n ?? 0;
}

export function getUserByEmail(email: string): MetaUser | null {
  const row = getMetaDb()
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email.toLowerCase());
  return (row as MetaUser) ?? null;
}

export function getUserById(id: string): MetaUser | null {
  const row = getMetaDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  return (row as MetaUser) ?? null;
}

export function createUser(
  email: string,
  passwordHash: string,
  role = 'admin',
): MetaUser {
  const user: MetaUser = {
    id: crypto.randomUUID(),
    email: email.toLowerCase(),
    password_hash: passwordHash,
    role,
    created_at: nowIso(),
    session_generation: 0,
  };
  getMetaDb()
    .prepare(
      'INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(user.id, user.email, user.password_hash, user.role, user.created_at);
  return user;
}

/** Replace an operator's password hash (used by /auth/change-password). */
export function updateUserPassword(id: string, passwordHash: string): void {
  getMetaDb()
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(passwordHash, id);
}

/** The operator's current session generation, or 0 when the user is unknown. */
export function getSessionGeneration(id: string): number {
  const row = getMetaDb()
    .prepare('SELECT session_generation AS g FROM users WHERE id = ?')
    .get(id) as { g: number } | undefined;
  return row?.g ?? 0;
}

/**
 * Increment an operator's session generation, invalidating every session token
 * minted before now (logout-all, password change). Returns the NEW generation
 * so the caller can immediately re-issue the current browser a fresh cookie that
 * survives the revocation. No-op (returns 0) if the user does not exist.
 */
export function bumpSessionGeneration(id: string): number {
  getMetaDb()
    .prepare('UPDATE users SET session_generation = session_generation + 1 WHERE id = ?')
    .run(id);
  return getSessionGeneration(id);
}

// ─── Apps ───────────────────────────────────────────────────────────────────

/** App ids double as on-disk identifiers (SQLite filename, storage prefix,
 * `/a/{id}` route) so they must satisfy deploy.ts VALID_ALIAS_RE. */
export function generateAppId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(bytes)
    .map((b) => (b % 36).toString(36))
    .join('');
  return `a${suffix}`;
}

export function getApp(id: string): MetaApp | null {
  const row = getMetaDb().prepare('SELECT * FROM apps WHERE id = ?').get(id);
  return (row as MetaApp) ?? null;
}

export function listAppsByOwner(ownerId: string): MetaApp[] {
  return getMetaDb()
    .prepare('SELECT * FROM apps WHERE owner_id = ? ORDER BY updated_at DESC')
    .all(ownerId) as MetaApp[];
}

export function createApp(ownerId: string, name: string): MetaApp {
  const id = generateAppId();
  // Friendly alias used as the app's wildcard subdomain label (<slug>.yourdomain.com).
  // Derived from the display name and made unique against other slugs AND app ids
  // (both share the subdomain-label namespace; resolution is slug-then-id). An empty
  // name falls back to the id, so an unnamed app still gets a valid label to rename.
  const slug = ensureUniqueSlug(slugifyName(name) || id);
  const app: MetaApp = {
    id,
    owner_id: ownerId,
    name,
    slug,
    status: 'draft',
    last_session_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    published_at: null,
    active_preview_version: null,
    active_published_version: null,
    thumbnail_at: null,
  };
  getMetaDb()
    .prepare(
      `INSERT INTO apps (id, owner_id, name, slug, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(app.id, app.owner_id, app.name, app.slug, app.status, app.created_at, app.updated_at);
  return app;
}

export function touchApp(
  id: string,
  fields: Partial<Pick<MetaApp, 'status' | 'last_session_id' | 'name' | 'published_at'>>,
): void {
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [nowIso()];
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`);
    params.push(value);
  }
  params.push(id);
  getMetaDb()
    .prepare(`UPDATE apps SET ${sets.join(', ')} WHERE id = ?`)
    .run(...params);
}

// ─── App aliases (friendly wildcard subdomain labels) ─────────────────────────
//
// An app's `slug` is the label it answers on under a wildcard custom domain:
// `<slug>.yourdomain.com` → this app. It shares the label namespace with app ids
// (custom-domains.ts resolves a wildcard label slug-first, then id), so a slug must
// be a valid DNS label, unique among slugs, and not equal to any app id.

// A single DNS label: start/end alphanumeric, alnum+hyphen in the middle, 1–63 chars.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/** The `preview-` prefix is reserved: the `/a/preview-<id>/` route serves an
 *  app's unpublished draft, so a published app whose slug began with `preview-`
 *  would make its own public URL (`/a/preview-foo/`) ambiguous with a draft
 *  route. Reserved for both creation (ensureUniqueSlug) and rename (setAppSlug). */
export function isReservedSlug(slug: string): boolean {
  return slug.startsWith('preview-');
}

/** DNS-label-safe slug from a display name (accents stripped, non-alnum → hyphen,
 *  collapsed, trimmed, capped). Returns '' when the name has no usable characters. */
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');
export function slugifyName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40);
}

/** True when `slug` is already an app's slug OR an app's id (excluding `excludeId`). */
function slugTaken(slug: string, excludeId?: string): boolean {
  const db = getMetaDb();
  const ex = excludeId ?? '';
  if (db.prepare('SELECT 1 FROM apps WHERE slug = ? AND id != ? LIMIT 1').get(slug, ex)) return true;
  return Boolean(db.prepare('SELECT 1 FROM apps WHERE id = ? AND id != ? LIMIT 1').get(slug, ex));
}

/** A unique, valid label near `base`: appends -2, -3, … on collision. Falls back to a
 *  fresh app id (always label-valid and unique) in the pathological case. */
export function ensureUniqueSlug(base: string, excludeId?: string): string {
  const root = isValidSlug(base) && !isReservedSlug(base) ? base : 'app';
  if (!slugTaken(root, excludeId)) return root;
  for (let i = 2; i < 1000; i++) {
    const cand = `${root}-${i}`.slice(0, 63);
    if (isValidSlug(cand) && !slugTaken(cand, excludeId)) return cand;
  }
  return generateAppId();
}

export function getAppBySlug(slug: string): MetaApp | null {
  const row = getMetaDb().prepare('SELECT * FROM apps WHERE slug = ?').get(slug);
  return (row as MetaApp) ?? null;
}

/**
 * Resolve a `/a/<segment>` URL path segment (a friendly slug OR a raw app id) to
 * the canonical, immutable `app.id` that all storage/routing is keyed on.
 *
 * Published apps are shared at `/a/<slug>/…` (the name-derived alias, e.g.
 * `tidelist`), but the SQLite filename, storage prefixes, and deploy module
 * paths all key on `app.id` (e.g. `avfhfwzn8`). Resolving slug-then-id at the
 * request edge lets the friendly URL serve without touching any of that — the
 * same resolution order the wildcard custom-domain label uses. Slug and id share
 * one uniqueness namespace (see `slugTaken`), so the lookup is unambiguous.
 *
 * Returns the segment unchanged when nothing matches, preserving today's 404
 * behavior for genuinely unknown apps.
 */
export function resolveAppIdForSegment(segment: string): string {
  try {
    const app = getAppBySlug(segment) ?? getApp(segment);
    return app ? app.id : segment;
  } catch {
    // Resolution is an enhancement layered on top of id-keyed routing: if the
    // metadata store is unavailable, fall back to treating the segment as an id
    // so serving degrades to the pre-slug behavior rather than 500-ing.
    return segment;
  }
}

/** Rename an app's alias (its wildcard subdomain label). Validates the label rules
 *  and uniqueness (against other slugs AND app ids). */
export function setAppSlug(
  id: string,
  rawSlug: string,
): { ok: true; slug: string } | { ok: false; error: string } {
  const slug = rawSlug.trim().toLowerCase();
  if (!isValidSlug(slug)) {
    return {
      ok: false,
      error: 'Use 1–63 lowercase letters, numbers, or hyphens (not starting or ending with a hyphen).',
    };
  }
  if (isReservedSlug(slug)) {
    return { ok: false, error: 'The "preview-" prefix is reserved — pick a different alias.' };
  }
  if (slugTaken(slug, id)) {
    return { ok: false, error: `"${slug}" is already taken by another app — pick a different alias.` };
  }
  getMetaDb().prepare('UPDATE apps SET slug = ?, updated_at = ? WHERE id = ?').run(slug, nowIso(), id);
  return { ok: true, slug };
}

// ─── Maintenance cron ─────────────────────────────────────────────────────────
//
// Read/write helpers for the periodic maintenance pass (server/maintenance.ts):
// dashboard thumbnail capture and stuck/errored-app cleanup. These run for ALL
// owners (the cron is not request-scoped), unlike listAppsByOwner above.

/**
 * Built apps whose dashboard thumbnail is missing or stale (the app was rebuilt
 * since the last capture). `updated_at`/`thumbnail_at` are ISO-8601, which sorts
 * lexically, so the string comparison is a correct chronological one.
 */
export function listAppsForThumbnails(): MetaApp[] {
  return getMetaDb()
    .prepare(
      `SELECT * FROM apps
        WHERE status IN ('preview', 'published')
          AND (thumbnail_at IS NULL OR thumbnail_at < updated_at)
        ORDER BY updated_at DESC`,
    )
    .all() as MetaApp[];
}

/**
 * Every app with a deployed config (preview or published), across all owners.
 * Used by the maintenance name-backfill — unlike {@link listAppsForThumbnails}
 * there is no thumbnail-staleness filter, so it returns the complete built set.
 */
export function listBuiltApps(): MetaApp[] {
  return getMetaDb()
    .prepare(
      `SELECT * FROM apps
        WHERE status IN ('preview', 'published')
        ORDER BY updated_at DESC`,
    )
    .all() as MetaApp[];
}

/**
 * Set an app's display name WITHOUT bumping `updated_at`. The build pump syncs
 * the name via {@link touchApp} (a real build legitimately bumps updated_at), but
 * the boot-time name-backfill must not make every existing app read "Updated just
 * now" or re-trigger thumbnail capture — so it uses this updated_at-preserving
 * writer (mirroring {@link setThumbnailAt}).
 */
export function setAppName(id: string, name: string): void {
  getMetaDb().prepare('UPDATE apps SET name = ? WHERE id = ?').run(name, id);
}

/** Stamp the time a thumbnail was successfully captured (does NOT touch updated_at). */
export function setThumbnailAt(id: string, iso: string): void {
  getMetaDb().prepare('UPDATE apps SET thumbnail_at = ? WHERE id = ?').run(iso, id);
}

/**
 * Apps the cleanup pass should permanently delete: builds wedged in `building`
 * past the build cutoff (process died mid-build), plus `error` apps older than
 * the error grace cutoff. Both cutoffs are ISO-8601 instants.
 */
export function listDeadApps(buildingBeforeIso: string, errorBeforeIso: string): MetaApp[] {
  return getMetaDb()
    .prepare(
      `SELECT * FROM apps
        WHERE (status = 'building' AND updated_at < ?)
           OR (status = 'error'    AND updated_at < ?)`,
    )
    .all(buildingBeforeIso, errorBeforeIso) as MetaApp[];
}

/** Permanently remove an app's registry rows (apps + deployments + any bound
 *  custom domains) in one txn. registered_domains has no FK cascade, so a domain
 *  bound to this app would otherwise linger `active` forever — still routing its
 *  host to the now-dead app and still authorizing on-demand ACME for it — and its
 *  PRIMARY KEY would block re-registering that host for another app. */
export function deleteApp(id: string): void {
  const db = getMetaDb();
  db.exec('BEGIN');
  let removedDomains = 0;
  try {
    db.prepare('DELETE FROM deployments WHERE app_id = ?').run(id);
    removedDomains = db.prepare('DELETE FROM registered_domains WHERE app_id = ?').run(id).changes;
    db.prepare('DELETE FROM apps WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  // Force the resolution layer to rebuild its active-domain snapshot on the next
  // lookup (instead of after the 30s TTL), so the deleted app's host stops routing
  // + stops authorizing TLS immediately. Covers every delete path — owner delete,
  // husk-reaper, maintenance-cron reaper all funnel through here.
  if (removedDomains > 0) domainsRevision++;
}

// ─── App access ───────────────────────────────────────────────────────────────
//
// Each app is owned by exactly one operator (apps.owner_id). Ownership is the
// sole access gate on the self-hosted studio.

/** True when the user owns the app. */
export function userCanAccessApp(userId: string, appId: string): boolean {
  const app = getApp(appId);
  if (!app) return false;
  return app.owner_id === userId;
}

/**
 * Every app the user owns, newest first. With `opts` it supports keyset
 * pagination (cursor on `updated_at,id` descending) and a status filter; with no
 * opts it returns the full list.
 */
export function listAppsAccessibleBy(
  userId: string,
  opts: { limit?: number; afterUpdatedAt?: string; afterId?: string; status?: string[] } = {},
): MetaApp[] {
  const conds: string[] = ['owner_id = ?'];
  const params: unknown[] = [userId];
  if (opts.status && opts.status.length > 0) {
    conds.push(`status IN (${opts.status.map(() => '?').join(',')})`);
    params.push(...opts.status);
  }
  if (opts.afterUpdatedAt && opts.afterId) {
    conds.push('(updated_at < ? OR (updated_at = ? AND id < ?))');
    params.push(opts.afterUpdatedAt, opts.afterUpdatedAt, opts.afterId);
  }
  let sql = `SELECT * FROM apps WHERE ${conds.join(' AND ')} ORDER BY updated_at DESC, id DESC`;
  if (opts.limit && opts.limit > 0) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
  }
  return getMetaDb().prepare(sql).all(...params) as MetaApp[];
}

// ─── Deployments ──────────────────────────────────────────────────────────────

export function recordDeployment(d: {
  appId: string;
  mode: string;
  status: string;
  configPath?: string | null;
  correlationId?: string | null;
  label?: string | null;
  error?: string | null;
}): number {
  const info = getMetaDb()
    .prepare(
      `INSERT INTO deployments (app_id, mode, status, config_path, correlation_id, label, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      d.appId,
      d.mode,
      d.status,
      d.configPath ?? null,
      d.correlationId ?? null,
      d.label ?? null,
      d.error ?? null,
      nowIso(),
    );
  return Number(info.lastInsertRowid);
}

export function latestDeployment(appId: string, mode: string): MetaDeployment | null {
  const row = getMetaDb()
    .prepare(
      'SELECT * FROM deployments WHERE app_id = ? AND mode = ? ORDER BY id DESC LIMIT 1',
    )
    .get(appId, mode);
  return (row as MetaDeployment) ?? null;
}

/** Deployment history for an app+mode, newest first (the version list). */
export function listDeployments(appId: string, mode: string, limit = 30): MetaDeployment[] {
  return getMetaDb()
    .prepare(
      'SELECT * FROM deployments WHERE app_id = ? AND mode = ? ORDER BY id DESC LIMIT ?',
    )
    .all(appId, mode, limit) as MetaDeployment[];
}

export function getDeployment(id: number): MetaDeployment | null {
  const row = getMetaDb().prepare('SELECT * FROM deployments WHERE id = ?').get(id);
  return (row as MetaDeployment) ?? null;
}

/**
 * Point a deployment row at its retained version snapshot prefix (e.g.
 * `versions/12`) so it shows in the version timeline. Pass `null` to clear the
 * marker when the snapshot is pruned.
 */
export function updateDeploymentConfigPath(id: number, configPath: string | null): void {
  getMetaDb()
    .prepare('UPDATE deployments SET config_path = ? WHERE id = ?')
    .run(configPath, id);
}

/** Set/clear the preview version that is currently live for an app (restore pointer). */
export function setActivePreviewVersion(appId: string, deploymentId: number | null): void {
  getMetaDb()
    .prepare('UPDATE apps SET active_preview_version = ? WHERE id = ?')
    .run(deploymentId, appId);
}

/** Deployment id of the app's live preview version, or null if never set. */
export function getActivePreviewVersion(appId: string): number | null {
  const row = getMetaDb()
    .prepare('SELECT active_preview_version AS v FROM apps WHERE id = ?')
    .get(appId) as { v: number | null } | undefined;
  return row?.v ?? null;
}

/** Set/clear the published release currently live for an app (the rollback pointer). */
export function setActivePublishedVersion(appId: string, deploymentId: number | null): void {
  getMetaDb()
    .prepare('UPDATE apps SET active_published_version = ? WHERE id = ?')
    .run(deploymentId, appId);
}

/** Deployment id of the app's live published release, or null if never set. */
export function getActivePublishedVersion(appId: string): number | null {
  const row = getMetaDb()
    .prepare('SELECT active_published_version AS v FROM apps WHERE id = ?')
    .get(appId) as { v: number | null } | undefined;
  return row?.v ?? null;
}

// ─── Settings ─────────────────────────────────────────────────────────────────
//
// Instance-global operator settings (LLM provider/key/model, image keys,
// networking overrides, …). The store is the source of truth the operator edits
// in the UI; it overrides the process environment, which acts as the first-boot
// seed / fallback.

// Bumped on every settings write so hot-path readers (net-config's per-request
// CORS snapshot) can cheaply detect a change and rebuild without polling the DB.
let settingsRevision = 0;

/** Monotonic counter, bumped on every settings write. Readers compare it to know
 *  when a cached effective-settings snapshot is stale. */
export function getSettingsRevision(): number {
  return settingsRevision;
}

/** Read a single setting; null when unset. */
export function getSetting(key: string): string | null {
  const row = getMetaDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/** Read every setting as a flat key→value map. */
export function getAllSettings(): Record<string, string> {
  const rows = getMetaDb()
    .prepare('SELECT key, value FROM settings')
    .all() as Array<{ key: string; value: string }>;
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/**
 * Upsert settings. An `undefined` value leaves the key untouched; a `null` value
 * deletes it. Empty strings are stored verbatim (a deliberate "clear to empty").
 */
export function setSettings(values: Record<string, string | null | undefined>): void {
  const db = getMetaDb();
  const ts = nowIso();
  let wrote = false;
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (value === null) {
      db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      wrote = true;
      continue;
    }
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, value, ts);
    wrote = true;
  }
  // Invalidate any cached effective-settings snapshot (net-config) on a real write.
  if (wrote) settingsRevision++;
}

// ─── Registered custom domains (self-serve custom-domain + SSL) ───────────────
//
// Persistence only — host normalization, the in-memory active-domain snapshot,
// DNS verification, sslip derivation, and the TLS-authorize decision live in
// lib/custom-domains.ts. Every write bumps `domainsRevision` so that module can
// cheaply detect a change and refresh its cache without polling the DB on the
// hot path (CORS preflight, on-demand-TLS `ask`, host→app resolution).

let domainsRevision = 0;

/** Monotonic counter, bumped on every registered_domains write. The resolution
 *  layer compares this to know when to rebuild its active-domain snapshot. */
export function getDomainsRevision(): number {
  return domainsRevision;
}

export function listDomains(): MetaDomain[] {
  return getMetaDb()
    .prepare('SELECT * FROM registered_domains ORDER BY created_at DESC')
    .all() as MetaDomain[];
}

export function listDomainsByOwner(ownerId: string): MetaDomain[] {
  return getMetaDb()
    .prepare('SELECT * FROM registered_domains WHERE owner_id = ? ORDER BY created_at DESC')
    .all(ownerId) as MetaDomain[];
}

/** All `active` domains, across owners — the set the resolution snapshot caches. */
export function listActiveDomains(): MetaDomain[] {
  return getMetaDb()
    .prepare("SELECT * FROM registered_domains WHERE status = 'active'")
    .all() as MetaDomain[];
}

export function getDomain(domain: string): MetaDomain | null {
  const row = getMetaDb()
    .prepare('SELECT * FROM registered_domains WHERE domain = ?')
    .get(domain.toLowerCase());
  return (row as MetaDomain) ?? null;
}

export function createDomain(d: {
  domain: string;
  ownerId: string;
  appId?: string | null;
  mode: string;
  routing?: string | null;
  verificationToken: string;
  dnsTarget?: string | null;
}): MetaDomain {
  const row: MetaDomain = {
    domain: d.domain.toLowerCase(),
    owner_id: d.ownerId,
    app_id: d.appId ?? null,
    mode: d.mode,
    routing: d.routing ?? null,
    status: 'pending',
    verification_token: d.verificationToken,
    dns_target: d.dnsTarget ?? null,
    hsts: 0,
    last_error: null,
    verified_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  getMetaDb()
    .prepare(
      `INSERT INTO registered_domains
         (domain, owner_id, app_id, mode, routing, status, verification_token, dns_target, hsts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.domain,
      row.owner_id,
      row.app_id,
      row.mode,
      row.routing,
      row.status,
      row.verification_token,
      row.dns_target,
      row.hsts,
      row.created_at,
      row.updated_at,
    );
  domainsRevision++;
  return row;
}

/**
 * Patch a domain row (owner-scoped). Only the listed fields are writable; any
 * key omitted is left untouched. Always bumps updated_at + the revision counter.
 * Returns true when a row was actually changed.
 */
export function updateDomain(
  domain: string,
  ownerId: string,
  fields: Partial<Pick<MetaDomain, 'app_id' | 'mode' | 'status' | 'dns_target' | 'hsts' | 'last_error' | 'verified_at'>>,
): boolean {
  const allowed: Array<keyof typeof fields> = [
    'app_id', 'mode', 'status', 'dns_target', 'hsts', 'last_error', 'verified_at',
  ];
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [nowIso()];
  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key} = ?`);
      params.push(fields[key] as unknown);
    }
  }
  params.push(domain.toLowerCase(), ownerId);
  const info = getMetaDb()
    .prepare(`UPDATE registered_domains SET ${sets.join(', ')} WHERE domain = ? AND owner_id = ?`)
    .run(...params);
  if (info.changes > 0) domainsRevision++;
  return info.changes > 0;
}

/** Delete a domain (owner-scoped). Returns true when a row was removed. */
export function deleteDomain(domain: string, ownerId: string): boolean {
  const info = getMetaDb()
    .prepare('DELETE FROM registered_domains WHERE domain = ? AND owner_id = ?')
    .run(domain.toLowerCase(), ownerId);
  if (info.changes > 0) domainsRevision++;
  return info.changes > 0;
}
