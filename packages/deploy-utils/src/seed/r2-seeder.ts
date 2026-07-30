/**
 * Bucket-Aware Seed Data Loader + Inserter
 *
 * Reads seed files through an `R2Bucket`-shaped binding and inserts the rows
 * via `executeD1DDL` (see `../deploy/d1.ts`). Both bindings are served locally
 * by `@exepad/local-adapters` — the bucket is a directory under the data
 * volume and the database is a SQLite file.
 *
 * Written against the binding interfaces only: no Node.js APIs (fs, Buffer,
 * etc.), and CSV parsing is a small built-in implementation rather than a
 * Node-only parser dependency.
 */

import type { DeploymentConfig } from '../deploy/types';
import type { SeedRepoProps } from '@exepad/types';
import { executeD1DDL } from '../deploy/d1';
import { expandRecords, RelativeDateTokenError } from './relative-dates';
import { planSeedOrder } from './seed-order';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeedFromR2Options {
  r2: R2Bucket;
  config: DeploymentConfig;
  dbId: string;
  appId: string;
  mode: 'preview' | 'published';
  seedEntries: Record<string, SeedRepoProps>;
  /** Model definitions — used to order seeding by FK dependency and to detect FK columns
   *  (including their nullability) so deferral never NULLs a NOT NULL column. */
  models?: Array<{
    name: string;
    columns: Array<{
      name: string;
      isNullable?: boolean;
      references?: { model: string; column?: string; onDelete?: string };
    }>;
  }>;
}

export interface SeedFromR2Result {
  /** Model names that were seeded */
  seeded: string[];
  /** Model names skipped (table not empty) */
  skipped: string[];
  /** Non-fatal errors (parse failures, insert failures) */
  errors: string[];
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

const BATCH_SIZE = 500;

function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function escapeSqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    // Serialize JSON objects/arrays
    const json = JSON.stringify(value);
    return `'${json.replace(/'/g, "''")}'`;
  }
  // String
  return `'${String(value).replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// CSV parser (CF Workers compatible — no Node.js dependencies)
// ---------------------------------------------------------------------------

/**
 * Parse a CSV string into an array of records.
 * - First row is headers
 * - Handles quoted fields (double-quote escaping)
 * - Auto-casts: "true"/"false" → boolean, numeric strings → number,
 *   "null"/"NULL"/empty → null, JSON objects/arrays → parsed
 */
export function parseCSVString(content: string): { records: Record<string, unknown>[]; columns: string[] } {
  const rows = parseCSVRows(content);
  if (rows.length === 0) return { records: [], columns: [] };

  const headers = rows[0];
  const records: Record<string, unknown>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    // Skip empty rows
    if (row.length === 1 && row[0] === '') continue;

    const record: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = autoCast(j < row.length ? row[j] : '');
    }
    records.push(record);
  }

  return { records, columns: headers };
}

/**
 * Split CSV content into rows of fields, handling quoted fields correctly.
 */
function parseCSVRows(content: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const ch = content[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ("")
        if (i + 1 < content.length && content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
    } else {
      if (ch === '"' && field === '') {
        // Start of quoted field
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        current.push(field.trim());
        field = '';
        i++;
      } else if (ch === '\n' || (ch === '\r' && i + 1 < content.length && content[i + 1] === '\n')) {
        current.push(field.trim());
        rows.push(current);
        current = [];
        field = '';
        i += ch === '\r' ? 2 : 1;
      } else if (ch === '\r') {
        // Bare \r (old Mac line ending)
        current.push(field.trim());
        rows.push(current);
        current = [];
        field = '';
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Push last field/row
  if (field !== '' || current.length > 0) {
    current.push(field.trim());
    rows.push(current);
  }

  return rows;
}

/**
 * Auto-cast a CSV field value.
 */
function autoCast(value: string): unknown {
  if (value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === 'NULL') return null;

  // Try number
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') {
    return num;
  }

  // Try JSON (nested objects/arrays)
  if ((value.startsWith('{') && value.endsWith('}')) ||
      (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return JSON.parse(value);
    } catch {
      // Keep as string
    }
  }

  return value;
}

// ---------------------------------------------------------------------------
// JSON parser
// ---------------------------------------------------------------------------

export function parseJSONString(
  content: string,
  modelName: string
): { records: Record<string, unknown>[]; columns: string[]; error?: string } {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (e) {
    return { records: [], columns: [], error: `Invalid JSON for ${modelName}: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!Array.isArray(data)) {
    return { records: [], columns: [], error: `JSON for ${modelName} must be an array of objects` };
  }

  const records: Record<string, unknown>[] = [];
  const columnSet = new Set<string>();

  for (const item of data) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    records.push(item as Record<string, unknown>);
    for (const key of Object.keys(item as object)) {
      columnSet.add(key);
    }
  }

  return { records, columns: Array.from(columnSet) };
}

// ---------------------------------------------------------------------------
// INSERT SQL generation
// ---------------------------------------------------------------------------

function generateInsertSQL(
  model: string,
  columns: string[],
  records: Record<string, unknown>[]
): string {
  const columnList = columns.map(escapeIdentifier).join(', ');
  const valueRows = records.map((record) => {
    const values = columns.map((col) => escapeSqlValue(record[col] ?? null));
    return `(${values.join(', ')})`;
  });
  return `INSERT INTO ${escapeIdentifier(model)} (${columnList}) VALUES ${valueRows.join(', ')};`;
}

// ---------------------------------------------------------------------------
// Auth seed helpers (password hashing for _auth_users)
// ---------------------------------------------------------------------------

// Must match apps/app-backend/src/auth/utils.ts (OWASP 2023 PBKDF2-SHA256).
// Seeded rows land in the same _auth_users table and are verified by the same
// verifyPassword, which reads the iteration count back out of the stored string
// — so pre-existing 100k hashes still verify and get rehashed on next login.
const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPasswordForSeed(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return `pbkdf2:${PBKDF2_ITERATIONS}:${toHex(salt)}:${toHex(new Uint8Array(derivedBits))}`;
}

/**
 * Transform _auth_users CSV records into proper auth table rows.
 * - Hashes plaintext passwords into password_hash column
 * - Generates UUIDs for missing id fields
 * - Ensures roles is a JSON string
 * - Returns both _auth_users and _auth_accounts rows
 */
async function prepareAuthSeedRecords(records: Record<string, unknown>[]): Promise<{
  userRecords: Record<string, unknown>[];
  userColumns: string[];
  accountRecords: Record<string, unknown>[];
  accountColumns: string[];
}> {
  const timestamp = new Date().toISOString();
  const userRecords: Record<string, unknown>[] = [];
  const accountRecords: Record<string, unknown>[] = [];

  for (const record of records) {
    const userId = (record.id as string) || crypto.randomUUID();
    const email = String(record.email || '').toLowerCase().trim();
    const plainPassword = String(record.password || '');
    const name = record.name ?? null;
    let roles = record.roles ?? '["user"]';

    // Ensure roles is a JSON string
    if (typeof roles === 'string' && !roles.startsWith('[')) {
      roles = JSON.stringify([roles]);
    } else if (Array.isArray(roles)) {
      roles = JSON.stringify(roles);
    }

    // Hash password
    const passwordHash = plainPassword
      ? await hashPasswordForSeed(plainPassword)
      : null;

    userRecords.push({
      id: userId,
      email,
      password_hash: passwordHash,
      email_verified: 1,
      name,
      roles,
      created_at: timestamp,
      updated_at: timestamp,
    });

    accountRecords.push({
      id: crypto.randomUUID(),
      user_id: userId,
      provider: 'email',
      provider_account_id: email,
    });
  }

  return {
    userRecords,
    userColumns: ['id', 'email', 'password_hash', 'email_verified', 'name', 'roles', 'created_at', 'updated_at'],
    accountRecords,
    accountColumns: ['id', 'user_id', 'provider', 'provider_account_id'],
  };
}

// ---------------------------------------------------------------------------
// FK column detection
// ---------------------------------------------------------------------------

/**
 * Build a map of model name (lowercased) → FK column info (column name + referenced model).
 * Used to selectively NULL out FK columns that reference not-yet-seeded tables,
 * avoiding FOREIGN KEY constraint violations when tables cross-reference.
 */
interface FkRef {
  column: string;
  referencedModel: string;
  /** Column nullability as declared. `false` = explicit NOT NULL (cannot be FK-deferred). */
  isNullable?: boolean;
}

function buildFkRefMap(
  models?: Array<{
    name: string;
    columns: Array<{ name: string; isNullable?: boolean; references?: { model: string } }>;
  }>
): Map<string, FkRef[]> {
  const map = new Map<string, FkRef[]>();
  if (!models) return map;
  for (const model of models) {
    const fkCols: FkRef[] = model.columns
      .filter((c) => c.references?.model)
      .map((c) => ({
        column: c.name,
        referencedModel: c.references!.model.toLowerCase(),
        isNullable: c.isNullable,
      }));
    if (fkCols.length > 0) {
      map.set(model.name.toLowerCase(), fkCols);
    }
  }
  return map;
}

/** Map lower(modelName) → set of its declared column names. */
function buildModelColumnMap(
  models?: SeedFromR2Options['models'],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!models) return map;
  for (const m of models) {
    map.set(m.name.toLowerCase(), new Set(m.columns.map((c) => c.name)));
  }
  return map;
}

/**
 * Reconcile seed-CSV headers that name a relation by its bare field (`project`,
 * `assignee`) when the built model column is the `_id`-suffixed FK column
 * (`project_id`, `assignee_id`).
 *
 * The SeedDataBuilder generates rows from the Creator's PLAN (which names a
 * relation `project`), while the BackendModelBuilder independently materializes
 * that relation as a `<name>_id` FK column. The two agents run in parallel and
 * drift, so on ANY model with a relation the seed header no longer matches the
 * table and every row fails to insert ("table X has no column named project") —
 * silently emptying that model. It also defeats the FK-deferral pass below,
 * which keys off the real `<name>_id` column name.
 *
 * Rename a header `h` → `h_id` (in `columns` and every record key) only when it
 * is unambiguously the drifted relation: `h_id` is a real FK column, `h` is NOT
 * itself a declared column, and the CSV doesn't already carry `h_id`. Mutates
 * `columns` + `records` in place; returns the applied renames for telemetry.
 */
function reconcileFkColumnNames(
  columns: string[],
  records: Record<string, unknown>[],
  authoredCols: Set<string>,
  fkCols: Set<string>,
): Array<[string, string]> {
  if (fkCols.size === 0) return [];
  const headerSet = new Set(columns);
  const renames: Array<[string, string]> = [];
  for (let i = 0; i < columns.length; i++) {
    const h = columns[i];
    if (authoredCols.has(h)) continue; // a real declared column — never touch it
    const idName = `${h}_id`;
    if (!fkCols.has(idName) || headerSet.has(idName)) continue;
    columns[i] = idName;
    headerSet.delete(h);
    headerSet.add(idName);
    for (const rec of records) {
      if (Object.prototype.hasOwnProperty.call(rec, h)) {
        rec[idName] = rec[h];
        delete rec[h];
      }
    }
    renames.push([h, idName]);
  }
  return renames;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function seedFromR2(options: SeedFromR2Options): Promise<SeedFromR2Result> {
  const { r2, config, dbId, appId, seedEntries } = options;
  const result: SeedFromR2Result = { seeded: [], skipped: [], errors: [] };

  // Capture deploy time once so every dataset in this deploy resolves
  // tokens against the same anchor — `__TODAY__-7d` in `users.csv` and
  // `__TODAY__` in `posts.csv` stay 7 days apart even if the calls
  // span millisecond boundaries.
  const deployNow = new Date();

  // Determine the owner_id for seed data.
  //
  // Preview mode: rows are tagged with `preview-owner-{appId}`. This is
  // synthetic — the runtime gateway does NOT mint that identity for any
  // authenticated user (see apps/runtime/worker/src/routes/gateway/auth.ts:
  // every successful auth path sets `userId = String(preview.uid)` from
  // the Django user pk). The tag exists so the next deploy's DELETE step
  // below can re-clean only the platform-seeded rows without disturbing
  // user-created ones.
  //
  // Important consequence: models with `ownerScope = "user"` will return
  // ZERO rows from `sys_list` in preview mode because the app-backend
  // filters by `WHERE owner_id = user.id` and no logged-in user matches
  // `preview-owner-{appId}`. xlsx-ingested models are auto-flipped to
  // `ownerScope = "shared"` by the agent's CreationWorkflow post-
  // processor (`_flip_ingested_models_to_shared`) so the owner filter
  // is bypassed entirely — that's how dataapps stay viewable in preview.
  // Non-ingested user-scoped models in preview mode share this
  // limitation (preview seed is invisible until the viewer can become
  // the seed's owner) — track separately if needed.
  //
  // Published mode: Extract the first auth user's ID from the _auth_users
  // seed CSV so seed data is owned by a real user who can log in.
  // Build FK reference map from model definitions.
  // D1 enables PRAGMA foreign_keys by default, and each REST API call is a
  // separate connection so we cannot disable FK checks via PRAGMA.
  // Instead, we NULL out FK columns that reference not-yet-seeded tables during
  // INSERT, then UPDATE them after all tables are populated.
  const fkRefs = buildFkRefMap(options.models);
  const modelCols = buildModelColumnMap(options.models);

  // Track which models have been successfully seeded so we only defer FKs
  // pointing to tables that haven't been populated yet.
  const seededModels = new Set<string>();

  // A referenced parent may already hold rows from a PRIOR deploy — the common
  // case being an EDIT that adds a child model referencing an existing, unchanged
  // parent (whose rows are not re-seeded this deploy, so it never enters
  // `seededModels`). Its FK is still satisfiable, so we must NOT defer/block it.
  // Cache the (deploy-scoped) emptiness probe per parent table.
  const parentPopulatedCache = new Map<string, boolean>();
  async function parentAlreadyPopulated(table: string): Promise<boolean> {
    const key = table.toLowerCase();
    const cached = parentPopulatedCache.get(key);
    if (cached !== undefined) return cached;
    let populated = false;
    try {
      populated = !(await isTableEmpty(config, dbId, table));
    } catch {
      populated = false; // unknown table / probe failure → fall back to prior (defer) behavior
    }
    parentPopulatedCache.set(key, populated);
    return populated;
  }

  // Deferred FK updates: { model, column, records (with original FK values) }
  const deferredFkUpdates: Array<{
    model: string;
    primaryCol: string;
    columns: string[];
    records: Record<string, unknown>[];
  }> = [];

  // Pre-fetch all seed file contents from R2 in parallel to reduce sequential round-trips.
  const seedFileContents = new Map<string, string>();
  const entries = Object.entries(seedEntries);
  const prefetchResults = await Promise.allSettled(
    entries.map(async ([entryName, entry]) => {
      const r2Key = `${appId}/${entry.source}`;
      const object = await r2.get(r2Key);
      if (!object) {
        throw new Error(`[${entryName}] Seed file not found in R2: ${r2Key}`);
      }
      return { entryName, content: await object.text() };
    }),
  );
  for (const r of prefetchResults) {
    if (r.status === 'fulfilled') {
      seedFileContents.set(r.value.entryName, r.value.content);
    } else {
      result.errors.push(r.reason?.message || String(r.reason));
    }
  }

  // ── Preview re-seed is destructive (Phase A DELETEs every preview-owner row,
  // and the runtime routes the operator's preview reads/writes to that same
  // owner) — so a plain edit re-deploy would wipe rows the operator added while
  // testing the preview. Skip the whole re-seed when the seed CONTENT is
  // unchanged since the last deploy (signature match): nothing to refresh, so
  // leave the DB — demo seeds AND operator rows — intact. A build that actually
  // changes seed data has a new signature and re-seeds as before. (Published
  // mode is already non-destructive via the per-model isTableEmpty guard.)
  let previewSeedSignature: string | null = null;
  if (options.mode === 'preview') {
    previewSeedSignature = computeSeedSignature(seedFileContents);
    const storedSignature = await readPreviewSeedSignature(config, dbId);
    if (storedSignature && storedSignature === previewSeedSignature) {
      for (const entry of Object.values(seedEntries)) {
        if (entry?.model) result.skipped.push(entry.model);
      }
      console.log(
        '[seed] preview seed content unchanged — skipping re-seed to preserve ' +
          'existing rows (demo seeds + operator-added test data)',
      );
      return result;
    }
  }

  // Determine the owner_id for seed data so rows are visible after login.
  // Uses pre-fetched content to avoid a redundant R2 read.
  let seedOwnerId = 'system-seed';
  if (options.mode === 'preview') {
    seedOwnerId = `preview-owner-${appId}`;
  } else {
    for (const [entryName, entry] of entries) {
      if (entry.model === '_auth_users') {
        try {
          const content = seedFileContents.get(entryName);
          if (content) {
            const parsed = parseCSVString(content);
            if (parsed.records.length > 0 && parsed.records[0].id) {
              seedOwnerId = String(parsed.records[0].id);
            }
          }
        } catch { /* fall back to 'system-seed' */ }
        break;
      }
    }
  }

  // Plan an FK-dependency-aware order: DELETE children before parents (so an
  // owner-scoped DELETE of a parent never trips ON DELETE RESTRICT while children
  // still reference it) and INSERT parents before children (so a child's FK
  // columns are never NULLed into a NOT NULL violation). Falls back to config
  // order on a cycle; the deferred-FK UPDATE pass below is the cycle safety net.
  const { insertOrder, deleteOrder } = planSeedOrder(seedEntries, fkRefs);

  // ── Phase A: clear stale seed rows in child→parent order ──
  // Models whose owner-scoped DELETE fails on a non-empty table (e.g. an
  // owner_id-less table like _auth_users on republish) are recorded so Phase B
  // leaves them alone — preserving the legacy "don't re-seed a non-empty table".
  const skipped = new Set<string>();
  for (const entryName of deleteOrder) {
    const entry = seedEntries[entryName];
    if (!entry) continue;
    const model = entry.model;

    // Append mode skips the cross-batch DELETE so prior DataIngester batches
    // under the same owner survive (a NEW upload adds rows; it doesn't replace).
    const isAppend = entry.mode === 'append' && !!entry.batch_id;
    if (isAppend) continue;

    // Published mode is strictly non-destructive: never DELETE live rows.
    // Seed only into an EMPTY table (first publish) so a re-publish never
    // clobbers catalog/reference data an owner (or users) may have changed.
    // This pairs with deploy.ts only passing shared/reference models here on
    // publish — the net effect is "populate an empty catalog once, then leave
    // it alone." (Fix P-1: published apps previously shipped seeded:0.)
    if (options.mode === 'published') {
      const isEmpty = await isTableEmpty(config, dbId, model);
      if (!isEmpty) {
        result.skipped.push(model);
        skipped.add(model.toLowerCase());
      }
      continue;
    }

    try {
      await executeD1DDL(
        config,
        dbId,
        `DELETE FROM ${escapeIdentifier(model)} WHERE ${escapeIdentifier('owner_id')} = ${escapeSqlValue(seedOwnerId)}`,
      );
    } catch {
      // Table may not have an owner_id column (e.g. _auth_users) or may not
      // exist yet — fall back to the legacy isEmpty check. (With child→parent
      // ordering this catch can no longer be an ON DELETE RESTRICT violation.)
      const isEmpty = await isTableEmpty(config, dbId, model);
      if (!isEmpty) {
        result.skipped.push(model);
        skipped.add(model.toLowerCase());
      }
    }
  }

  // ── Phase B: parse + insert in parent→child order ──
  for (const entryName of insertOrder) {
    const entry = seedEntries[entryName];
    if (!entry) continue;
    const model = entry.model;
    if (skipped.has(model.toLowerCase())) continue;

    try {
      // 2. Use pre-fetched content (R2 reads already done in parallel above)
      const content = seedFileContents.get(entryName);
      if (!content) {
        // Error was already recorded during prefetch
        continue;
      }

      // 3. Parse based on format
      let records: Record<string, unknown>[];
      let columns: string[];

      if (entry.format === 'csv') {
        const parsed = parseCSVString(content);
        records = parsed.records;
        columns = parsed.columns;
      } else {
        const parsed = parseJSONString(content, model);
        if (parsed.error) {
          result.errors.push(`[${entryName}] ${parsed.error}`);
          continue;
        }
        records = parsed.records;
        columns = parsed.columns;
      }

      if (records.length === 0) {
        result.errors.push(`[${entryName}] No records parsed from seed file`);
        continue;
      }

      // 3.3. Reconcile FK-column header drift: the seed builder names a relation
      // `project`/`assignee` (from the plan) while the model builder materialized
      // it as the `project_id`/`assignee_id` FK column. Rename the header to the
      // real FK column so the insert (and the FK-deferral pass below, which keys
      // off `<name>_id`) match the table instead of failing every row.
      const fkRenames = reconcileFkColumnNames(
        columns,
        records,
        modelCols.get(model.toLowerCase()) ?? new Set<string>(),
        new Set((fkRefs.get(model.toLowerCase()) ?? []).map((r) => r.column)),
      );
      if (fkRenames.length > 0) {
        console.log(
          `[seed] [${entryName}] reconciled FK columns to schema: ` +
            fkRenames.map(([a, b]) => `${a}→${b}`).join(', '),
        );
      }

      // 3.4. Expand relative-date tokens (`__TODAY__-7d`, `__NOW__`, ...)
      // before any downstream pass touches the values. CSVs with no tokens
      // pass through unchanged. Per-row tolerance: malformed tokens (e.g.
      // `__TODAY__+8h` — `h` is illegal on TODAY) drop the offending row
      // but the rest still seed. Errors are surfaced on `result.errors`
      // so `deployment-status-preview.json::seedErrors` can show them.
      // Previously a single bad row dropped the entire dataset silently
      // (first surfaced on alo48zsn 2026-05-15 bookings.csv row 2).
      let recordsHadTokens = false;
      const expandResult = expandRecords(records, columns, deployNow);
      records = expandResult.records;
      recordsHadTokens = expandResult.expanded;
      for (const e of expandResult.errors) {
        result.errors.push(`[${entryName}] Relative-date expansion ${e}`);
      }
      if (records.length === 0) {
        // All rows dropped — surface and skip insertion.
        result.errors.push(`[${entryName}] All rows dropped during token expansion`);
        continue;
      }

      // ── Special handling for _auth_users seed ──
      // Auth CSV contains plaintext passwords that must be hashed before insertion.
      // Also creates corresponding _auth_accounts entries for email login.
      if (model === '_auth_users') {
        try {
          const authData = await prepareAuthSeedRecords(records);

          // Insert _auth_users
          const userSQL = generateInsertSQL('_auth_users', authData.userColumns, authData.userRecords);
          await executeD1DDL(config, dbId, userSQL);

          // Insert _auth_accounts
          if (authData.accountRecords.length > 0) {
            const accountSQL = generateInsertSQL('_auth_accounts', authData.accountColumns, authData.accountRecords);
            await executeD1DDL(config, dbId, accountSQL);
          }

          result.seeded.push('_auth_users');
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          result.errors.push(`[${entryName}] Auth seed insert failed: ${msg}`);
        }
        continue;
      }

      // 3.5a. Shift date columns so the most recent date becomes "today".
      // This keeps relative spacing between dates intact while ensuring
      // seed data looks current regardless of when the AI generated it.
      //
      // Skip when expandRecords already substituted relative tokens — those
      // are anchored to deploy time, so a second shift would pull them
      // backward by the offset of the largest `__TODAY__+Nd` token.
      if (!recordsHadTokens) {
        shiftDatesToPresent(records, columns);
      }

      // 3.5. Normalize system columns (owner_id, created_at, updated_at).
      //
      // owner_id is a DEPLOY-TIME invariant — it is ALWAYS forced to this
      // deploy's canonical `seedOwnerId` (preview → `preview-owner-{appId}`,
      // published → first auth user), OVERWRITING any value the seed CSV
      // shipped. The generated seed must never get to decide ownership: the
      // LLM sometimes hardcodes a literal `owner_id` column (e.g.
      // `owner_id="demo"`), and any value other than `seedOwnerId` makes the
      // rows invisible — the preview gateway remaps the operator's reads to
      // `preview-owner-{appId}` (and published owner-scoped queries filter on
      // the auth user), so a "demo"-owned row matches nobody and the app
      // looks empty on first view (found live 2026-06-21 on a CRM seed).
      // `_auth_users` never reaches here (it returns above), so its `id`
      // identities are untouched. Both replace AND append modes use
      // seedOwnerId so append-mode rows stay visible to the seed owner too.
      //
      // created_at / updated_at are only filled when MISSING, so the agent
      // can still ship realistic historical timestamps.
      const timestamp = new Date().toISOString();
      if (!columns.includes('owner_id')) {
        columns.push('owner_id');
      }
      for (const record of records) {
        record['owner_id'] = seedOwnerId;
      }
      for (const sysCol of ['created_at', 'updated_at']) {
        if (!columns.includes(sysCol)) {
          columns.push(sysCol);
          for (const record of records) {
            record[sysCol] = timestamp;
          }
        }
      }

      // 4. NULL out FK columns whose referenced table hasn't been seeded yet,
      //    then UPDATE them after all tables are populated (deferred pass below).
      //    With parent→child ordering this only happens for true FK cycles or a
      //    parent that has no seed entry. A NOT NULL FK column CANNOT be NULLed
      //    (the INSERT would fail and silently leave the table empty), so guard
      //    it: surface a clear error and skip the model rather than emit a
      //    guaranteed-failing INSERT.
      const modelFkRefs = fkRefs.get(model.toLowerCase()) ?? [];
      const affectedFkCols: string[] = [];
      let notNullFkBlock = false;
      for (const ref of modelFkRefs) {
        if (seededModels.has(ref.referencedModel)) continue; // parent seeded this deploy → keep FK intact
        if (!columns.includes(ref.column)) continue;
        // Parent already populated by a prior deploy (edit adds a child of an
        // existing model) → the FK resolves, so keep it intact instead of
        // NULL-deferring (or, for a NOT NULL FK, wrongly dropping the whole model).
        if (await parentAlreadyPopulated(ref.referencedModel)) continue;
        if (ref.isNullable === false) {
          result.errors.push(
            `[${entryName}] cannot defer NOT NULL FK column '${ref.column}' referencing not-yet-seeded '${ref.referencedModel}' — skipping ${model} (FK cycle or parent has no seed data)`,
          );
          notNullFkBlock = true;
          break;
        }
        affectedFkCols.push(ref.column);
      }
      if (notNullFkBlock) continue;

      let insertRecords = records;
      if (affectedFkCols.length > 0) {
        const fkColSet = new Set(affectedFkCols);
        // Deep-copy records so originals are preserved for UPDATE pass
        insertRecords = records.map((r) => {
          const copy = { ...r };
          for (const col of fkColSet) copy[col] = null;
          return copy;
        });
      }

      // 4b. Insert in batches
      let totalInserted = 0;
      for (let i = 0; i < insertRecords.length; i += BATCH_SIZE) {
        const batch = insertRecords.slice(i, i + BATCH_SIZE);
        const sql = generateInsertSQL(model, columns, batch);

        try {
          await executeD1DDL(config, dbId, sql);
          totalInserted += batch.length;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          result.errors.push(`[${entryName}] Batch insert failed (rows ${i}-${i + batch.length}): ${msg}`);
        }
      }

      if (totalInserted > 0) {
        result.seeded.push(model);
        seededModels.add(model.toLowerCase());

        // Queue deferred FK updates only if rows were actually inserted
        if (affectedFkCols.length > 0) {
          const primaryCol = columns.includes('id') ? 'id' : columns[0];
          deferredFkUpdates.push({
            model,
            primaryCol,
            columns: affectedFkCols,
            records, // original values with FK intact
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`[${entryName}] Unexpected error: ${msg}`);
    }
  }

  // 5. Deferred FK updates — now that all tables are populated, set FK columns
  //    to their original values. UPDATEs are batched per table into a single
  //    multi-statement SQL call for efficiency.
  for (const deferred of deferredFkUpdates) {
    const statements: string[] = [];
    for (const record of deferred.records) {
      const pkValue = record[deferred.primaryCol];
      if (pkValue === null || pkValue === undefined) continue;

      const setClauses = deferred.columns
        .map((col) => `${escapeIdentifier(col)} = ${escapeSqlValue(record[col] ?? null)}`)
        .join(', ');
      statements.push(
        `UPDATE ${escapeIdentifier(deferred.model)} SET ${setClauses} WHERE ${escapeIdentifier(deferred.primaryCol)} = ${escapeSqlValue(pkValue)}`
      );
    }

    if (statements.length > 0) {
      const sql = statements.join(';\n') + ';';
      try {
        await executeD1DDL(config, dbId, sql);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.errors.push(`[${deferred.model}] FK update failed: ${msg}`);
      }
    }
  }

  // Persist the preview seed signature so the next deploy can skip a redundant
  // destructive re-seed when the seed content hasn't changed (see gate above).
  if (options.mode === 'preview' && previewSeedSignature) {
    await writePreviewSeedSignature(config, dbId, previewSeedSignature);
  }

  console.log(
    `[seed] Complete: seeded=[${result.seeded.join(',')}] skipped=[${result.skipped.join(',')}] errors=${result.errors.length}`,
  );
  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.warn(`[seed]   ${err}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Preview seed signature — lets an unchanged-seed re-deploy preserve operator
// test data instead of destructively re-seeding (see the gate in seedFromR2).
// ---------------------------------------------------------------------------

const SEED_SIGNATURE_META_KEY = 'exepad_preview_seed_signature';

/** Deterministic FNV-1a hash over the seed file contents (name + body), order
 * independent. No crypto dependency so it runs anywhere the deployer does.
 * Fields are length-prefixed and \0/\x01-delimited so boundaries are
 * unambiguous — a rename or shifted byte can't forge a colliding stream that
 * would wrongly skip a destructive re-seed. (A generic 32-bit FNV collision is
 * still ~1-in-4B, but that skip is benign: operator rows are preserved either
 * way and the next deploy re-seeds.) */
function computeSeedSignature(contents: Map<string, string>): string {
  const sorted = [...contents.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  let h = 0x811c9dc5;
  for (const [name, body] of sorted) {
    const s = `${name.length} ${name} ${body.length} ${body}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16);
}

async function readPreviewSeedSignature(
  config: DeploymentConfig,
  dbId: string,
): Promise<string | null> {
  try {
    const res = await executeD1DDL(
      config,
      dbId,
      `SELECT "value" FROM _exepad_meta WHERE "key" = ${escapeSqlValue(SEED_SIGNATURE_META_KEY)} LIMIT 1`,
    );
    const rows = res.results as Array<Record<string, unknown>>;
    const v = rows?.[0]?.value;
    return v == null ? null : String(v);
  } catch {
    // _exepad_meta may not exist yet (first deploy) — treat as "no signature".
    return null;
  }
}

async function writePreviewSeedSignature(
  config: DeploymentConfig,
  dbId: string,
  signature: string,
): Promise<void> {
  try {
    await executeD1DDL(
      config,
      dbId,
      `INSERT INTO _exepad_meta ("key", "value", "updated_at") VALUES (` +
        `${escapeSqlValue(SEED_SIGNATURE_META_KEY)}, ${escapeSqlValue(signature)}, ` +
        `${escapeSqlValue(new Date().toISOString())}) ` +
        `ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", ` +
        `"updated_at" = excluded."updated_at"`,
    );
  } catch (e) {
    console.warn(
      `[seed] failed to persist preview seed signature: ${e instanceof Error ? e.message : e}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Date shifting
// ---------------------------------------------------------------------------

/**
 * Detect date columns and shift all dates so the newest date = today.
 * Preserves relative spacing between dates.
 * Shifts columns where ALL non-null values are ISO date strings (YYYY-MM-DD)
 * or ISO datetime strings (YYYY-MM-DDTHH:MM:SS...).
 */
function shiftDatesToPresent(
  records: Record<string, unknown>[],
  columns: string[],
): void {
  if (records.length === 0) return;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
  const datetimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

  // Track which columns contain dates and whether they include time components
  const dateColumns: { col: string; hasTime: boolean }[] = [];

  for (const col of columns) {
    let allDates = true;
    let hasValue = false;
    let hasTime = false;
    for (const record of records) {
      const val = record[col];
      if (val === null || val === undefined || val === '') continue;
      hasValue = true;
      if (typeof val !== 'string') { allDates = false; break; }
      if (dateOnlyPattern.test(val)) {
        // pure date — ok
      } else if (datetimePattern.test(val)) {
        hasTime = true;
      } else {
        allDates = false;
        break;
      }
    }
    if (allDates && hasValue) dateColumns.push({ col, hasTime });
  }

  if (dateColumns.length === 0) return;

  // Find the max date across all date columns (date-part only for offset)
  let maxMs = -Infinity;
  for (const { col } of dateColumns) {
    for (const record of records) {
      const val = record[col];
      if (typeof val !== 'string') continue;
      // Extract date portion (first 10 chars) for both formats
      const datePart = val.slice(0, 10);
      const ms = new Date(datePart + 'T00:00:00Z').getTime();
      if (ms > maxMs) maxMs = ms;
    }
  }

  if (!isFinite(maxMs)) return;

  const offsetMs = todayMs - maxMs;
  if (offsetMs === 0) return;

  // Shift all date values, preserving time component when present
  for (const { col, hasTime } of dateColumns) {
    for (const record of records) {
      const val = record[col];
      if (typeof val !== 'string') continue;
      if (hasTime && datetimePattern.test(val)) {
        const shifted = new Date(new Date(val).getTime() + offsetMs);
        record[col] = shifted.toISOString();
      } else if (dateOnlyPattern.test(val)) {
        const shifted = new Date(new Date(val + 'T00:00:00Z').getTime() + offsetMs);
        record[col] = shifted.toISOString().slice(0, 10);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function isTableEmpty(
  config: DeploymentConfig,
  dbId: string,
  model: string
): Promise<boolean> {
  try {
    const res = await executeD1DDL(
      config,
      dbId,
      `SELECT COUNT(*) as count FROM ${escapeIdentifier(model)} LIMIT 1`
    );
    // D1 REST API returns results as an array of row objects
    const rows = res.results as Array<Record<string, unknown>>;
    if (rows.length > 0) {
      const count = rows[0]?.count;
      return count === 0 || count === '0';
    }
    return true;
  } catch (e) {
    // Table might not exist yet — treat as empty, but log the actual error
    console.warn(`[seed] isTableEmpty check failed for '${model}': ${e instanceof Error ? e.message : e}`);
    return true;
  }
}
