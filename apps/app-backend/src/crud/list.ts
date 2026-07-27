/**
 * sys_list - List records with pagination, filtering, and sorting
 *
 * Supports two pagination modes:
 * - offset (default): traditional LIMIT/OFFSET
 * - cursor: keyset pagination for efficient large-dataset traversal
 */

import type { ModelProps } from '../types/env';
import type { RpcResponse, UserContext, ListParams } from '../rpc/types';
import { ValidationError, DatabaseError } from '../utils/errors';
import { buildListQuery, buildCursorListQuery, buildCountQuery, buildSearchConditions, parseJsonColumns } from '../utils/sql';
import { encodeCursor, decodeCursor } from '../utils/cursor';
import { expandForeignKeys, type ExpandAuth } from './expand-fks';

/** Maximum allowed limit */
const MAX_LIMIT = 500;

/** Default limit */
const DEFAULT_LIMIT = 50;

// ── Approximate COUNT(*) cache (offset pagination on large tables) ───────────
//
// Offset pagination needs a `total` for the "page X of N" UI. On a table
// smaller than one page we derive it for free (`offset + rows`), but a
// paginating dashboard on a LARGE table would otherwise issue a full-scan
// `COUNT(*)` on every page request. We cache the count briefly, per
// (model, filters, owner, soft-delete, search), and reuse it across requests
// within the TTL — so scrolling pages 1..N triggers at most one scan per TTL.
//
// Correctness guard: we ONLY cache once a count is confirmed to be large
// (>= COUNT_CACHE_MIN_ROWS). Small tables always return an EXACT, freshly
// counted total — a stale approximate count on a small, fast-changing table
// would be visibly wrong, and counting a small table is cheap anyway.
//
// The cache is keyed (via a WeakMap) by the app's UNDERLYING pooled SQLite
// handle — `LocalD1.raw`, which the registry reuses across requests for a given
// app+mode — falling back to the `D1Database` wrapper itself when no `.raw` is
// exposed (e.g. the test mock). Keying on the pooled handle is what makes the
// cache effective across the separate HTTP requests a dashboard issues, while
// still scoping it per app+mode (each app has its own file → own handle) so one
// app's count can never leak into another's, and lets the cache be GC'd with the
// handle. Entries are approximate and short-lived by design.
const COUNT_CACHE_TTL_MS = 5_000;
const COUNT_CACHE_MIN_ROWS = 10_000;
const COUNT_CACHE_MAX_ENTRIES = 256;

interface CountCacheEntry {
  count: number;
  expiresAt: number;
}

const countCacheByDb = new WeakMap<object, Map<string, CountCacheEntry>>();

/** Stable per-app cache root: the pooled raw handle if present, else the wrapper. */
function countCacheRoot(db: D1Database): object {
  const raw = (db as unknown as { raw?: unknown }).raw;
  return raw && typeof raw === 'object' ? raw : (db as unknown as object);
}

function countCacheKey(
  model: ModelProps,
  filters: Record<string, unknown>,
  userId: string | undefined,
  excludeSoftDeleted: boolean,
  searchCondition: { condition: string; bindings: unknown[] } | undefined,
): string {
  return JSON.stringify({
    m: model.name,
    u: userId ?? null,
    d: excludeSoftDeleted,
    f: filters,
    s: searchCondition ? searchCondition.bindings : null,
  });
}

/**
 * List records with pagination, filtering, and sorting.
 *
 * `allModels` is optional — when provided (always supplied by the
 * router), it enables auto-expansion of foreign-key columns: every
 * `_id`-suffixed FK column gets a sibling joined row attached under
 * the de-suffixed alias (e.g. `guest_id` → `row.guest`). When omitted
 * (e.g. internal callers that don't have the registry), `sysList`
 * still returns correctly — joined sub-objects simply don't appear.
 */
export async function sysList(
  model: ModelProps,
  params: ListParams | undefined,
  user: UserContext,
  db: D1Database,
  allModels?: readonly ModelProps[],
  // Auth context for the FK-expansion read gate. Omitted by internal/test
  // callers → expansion fails CLOSED (gate enforced with authDisabled=false).
  expandAuth?: ExpandAuth,
): Promise<RpcResponse> {
  // Normalize params
  const {
    filters = {},
    orderBy = {},
    limit = DEFAULT_LIMIT,
    offset = 0,
    select,
    cursor,
    paginationMode,
    search,
    searchFields,
  } = params || {};

  const useCursor = paginationMode === 'cursor' || !!cursor;

  // Validate limit — must be a finite integer in [1, MAX_LIMIT]
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ValidationError(`Limit must be an integer between 1 and ${MAX_LIMIT}`);
  }

  // Validate offset (only relevant in offset mode) — must be a non-negative finite integer
  if (!useCursor && (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0)) {
    throw new ValidationError('Offset must be a non-negative integer');
  }

  // Validate select columns if provided
  // Include system columns so users can select/filter/order by created_at, updated_at, etc.
  const hasSoftDelete = model.softDelete === true;
  const systemCols = ['id', 'owner_id', 'created_at', 'updated_at'];
  if (hasSoftDelete) systemCols.push('deleted_at');
  const validColumns = [
    ...model.columns.map((c) => c.name),
    ...systemCols.filter((sc) => !model.columns.some((c) => c.name === sc)),
  ];
  if (select && select.length > 0) {
    const invalidColumns = select.filter((col) => !validColumns.includes(col));
    if (invalidColumns.length > 0) {
      throw new ValidationError(`Invalid columns: ${invalidColumns.join(', ')}`);
    }
  }

  // Validate filter fields
  const filterFields = Object.keys(filters);
  const invalidFilters = filterFields.filter((f) => !validColumns.includes(f));
  if (invalidFilters.length > 0) {
    throw new ValidationError(`Invalid filter fields: ${invalidFilters.join(', ')}`);
  }

  // Validate orderBy fields
  const orderFields = Object.keys(orderBy);
  const invalidOrderFields = orderFields.filter((f) => !validColumns.includes(f));
  if (invalidOrderFields.length > 0) {
    throw new ValidationError(`Invalid orderBy fields: ${invalidOrderFields.join(', ')}`);
  }

  // Build search condition if search term is provided and non-empty
  let searchCondition: { condition: string; bindings: unknown[] } | undefined;
  if (search && typeof search === 'string' && search.trim() !== '') {
    // Determine which fields to search
    let fieldsToSearch: string[];
    if (searchFields && searchFields.length > 0) {
      // Validate searchFields against model columns
      const invalidSearchFields = searchFields.filter((f) => !validColumns.includes(f));
      if (invalidSearchFields.length > 0) {
        throw new ValidationError(`Invalid search fields: ${invalidSearchFields.join(', ')}`);
      }
      fieldsToSearch = searchFields;
    } else {
      // Default: search all text-type columns
      fieldsToSearch = model.columns
        .filter((c) => c.type === 'text')
        .map((c) => c.name);
      if (fieldsToSearch.length === 0) {
        // No text columns — skip search silently
        fieldsToSearch = [];
      }
    }

    if (fieldsToSearch.length > 0) {
      searchCondition = buildSearchConditions(search.trim(), fieldsToSearch);
    }
  }

  // For shared-scope models, omit owner_id filter so all users see all data
  const scopedUserId = model.ownerScope === 'shared' ? undefined : user.id;

  try {
    // ── Cursor mode ──────────────────────────────────────────────
    if (useCursor) {
      return await cursorList(model, {
        filters,
        orderBy,
        limit,
        select,
        cursor,
        userId: scopedUserId,
        excludeSoftDeleted: hasSoftDelete,
        searchCondition,
        allModels,
        user,
        expandAuth,
      }, db);
    }

    // ── Offset mode (default) ────────────────────────────────────
    const listQuery = buildListQuery(model.name, {
      filters,
      orderBy,
      limit,
      offset,
      select,
      userId: scopedUserId,
      excludeSoftDeleted: hasSoftDelete,
      searchCondition,
    });

    const records = await db.prepare(listQuery.sql).bind(...listQuery.bindings).all();

    if (!records.success) {
      throw new DatabaseError('Failed to fetch records');
    }

    // Only run the COUNT(*) when we actually need it. A short page (fewer rows
    // than `limit`) is provably the last page, so `total = offset + rows` —
    // this skips a full-table/full-scan count for the very common case of a
    // table (or filtered result) smaller than one page, which is what most
    // generated dashboards poll. On local SQLite the count wasn't parallel
    // anyway (better-sqlite3 is synchronous), so serialising costs nothing.
    //
    // For a FULL page (a table larger than one page) we run the count, but on
    // confirmed-large tables we serve it from a short-lived per-(model,filters)
    // cache so a dashboard paging through many pages doesn't full-scan on every
    // request. Small tables always get an EXACT, uncached count. See the
    // COUNT_CACHE_* constants above.
    let total: number;
    if (records.results.length < limit) {
      total = offset + records.results.length;
    } else {
      const cacheKey = countCacheKey(model, filters, scopedUserId, hasSoftDelete, searchCondition);
      const cacheRoot = countCacheRoot(db);
      let dbCache = countCacheByDb.get(cacheRoot);
      const now = Date.now();
      const cached = dbCache?.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        total = cached.count;
      } else {
        const countQuery = buildCountQuery(model.name, {
          filters,
          userId: scopedUserId,
          excludeSoftDeleted: hasSoftDelete,
          searchCondition,
        });
        const countResult = await db.prepare(countQuery.sql).bind(...countQuery.bindings).first();
        total = (countResult as { count: number } | null)?.count ?? 0;

        // Cache only confirmed-large counts — small tables stay exact + fresh.
        if (total >= COUNT_CACHE_MIN_ROWS) {
          if (!dbCache) {
            dbCache = new Map();
            countCacheByDb.set(cacheRoot, dbCache);
          }
          // Bound memory: drop the oldest entry when the per-DB cache is full.
          if (dbCache.size >= COUNT_CACHE_MAX_ENTRIES && !dbCache.has(cacheKey)) {
            const oldest = dbCache.keys().next().value;
            if (oldest !== undefined) dbCache.delete(oldest);
          }
          dbCache.set(cacheKey, { count: total, expiresAt: now + COUNT_CACHE_TTL_MS });
        }
      }
    }

    const parsedRecords = records.results.map((record) =>
      parseJsonColumns(model, record as Record<string, unknown>)
    );

    // Auto-expand FK columns into sibling joined rows. No-op when
    // ``allModels`` is undefined (internal callers without the registry).
    if (allModels && allModels.length > 0) {
      await expandForeignKeys(model, parsedRecords, allModels, user, db, expandAuth);
    }

    return {
      success: true,
      data: parsedRecords,
      pagination: {
        total,
        offset,
        limit,
        hasMore: offset + parsedRecords.length < total,
      },
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown database error';
    throw new DatabaseError(message);
  }
}

// ── Cursor pagination helper ─────────────────────────────────────

interface CursorListOpts {
  filters: Record<string, unknown>;
  orderBy: Record<string, 'asc' | 'desc'>;
  limit: number;
  select?: string[];
  cursor?: string;
  userId?: string;
  excludeSoftDeleted: boolean;
  searchCondition?: { condition: string; bindings: unknown[] };
  /** Full model registry — when present, auto-expand FKs on each row. */
  allModels?: readonly ModelProps[];
  /** Pass-through user context for joined-query owner-scope enforcement. */
  user: UserContext;
  /** Auth context for the FK-expansion read gate (see sysList). */
  expandAuth?: ExpandAuth;
}

async function cursorList(
  model: ModelProps,
  opts: CursorListOpts,
  db: D1Database
): Promise<RpcResponse> {
  const {
    filters,
    orderBy,
    limit,
    select,
    cursor,
    userId,
    excludeSoftDeleted,
    searchCondition,
    allModels,
    user,
    expandAuth,
  } = opts;

  // Determine cursor field/direction. On the FIRST page (no cursor) these come
  // from the request's orderBy (first key), or the model's primary key.
  const primaryKey = model.columns.find((c) => c.isPrimary)?.name ?? 'id';
  const orderEntries = Object.entries(orderBy);
  let cursorField = orderEntries.length > 0 ? orderEntries[0][0] : primaryKey;
  let cursorDirection: 'asc' | 'desc' =
    orderEntries.length > 0 ? orderEntries[0][1] : 'asc';

  // Decode existing cursor (if provided).
  // On first page (no cursor), cursorValue/tieValue stay undefined
  // and the query builder omits the cursor WHERE clause entirely.
  let cursorValue: unknown;
  let tieValue: unknown;
  if (cursor) {
    const payload = decodeCursor(cursor);
    if (!payload) {
      throw new ValidationError('Invalid cursor');
    }
    // Honor the field + direction ENCODED IN THE CURSOR, not the request's
    // current orderBy. A client that changes orderBy mid-pagination would
    // otherwise compare against a keyset the cursor value wasn't built for,
    // silently duplicating or skipping rows. The cursor is the source of
    // truth for the sort while paginating; a new sort requires a fresh scan
    // (drop the cursor).
    cursorField = payload.f;
    cursorDirection = payload.d;
    cursorValue = payload.v;
    tieValue = payload.tv;
  }

  const query = buildCursorListQuery(model.name, {
    filters,
    orderBy,
    limit,
    select,
    userId,
    excludeSoftDeleted,
    searchCondition,
    cursorField,
    cursorDirection,
    tieField: primaryKey,
    cursorValue,
    tieValue,
  });

  const records = await db.prepare(query.sql).bind(...query.bindings).all();

  if (!records.success) {
    throw new DatabaseError('Failed to fetch records');
  }

  // We fetched limit+1 — if we got that many, there are more pages
  const hasMore = records.results.length > limit;
  const rows = hasMore ? records.results.slice(0, limit) : records.results;

  const parsedRecords = rows.map((record) =>
    parseJsonColumns(model, record as Record<string, unknown>)
  );

  // Auto-expand FK columns — same path as offset mode.
  if (allModels && allModels.length > 0) {
    await expandForeignKeys(model, parsedRecords, allModels, user, db, expandAuth);
  }

  // Build nextCursor from the last returned row (includes tie-breaker)
  let nextCursor: string | undefined;
  if (hasMore && parsedRecords.length > 0) {
    const lastRow = parsedRecords[parsedRecords.length - 1];
    nextCursor = encodeCursor(
      cursorField,
      lastRow[cursorField],
      cursorDirection,
      primaryKey,
      lastRow[primaryKey]
    );
  }

  return {
    success: true,
    data: parsedRecords,
    pagination: {
      limit,
      hasMore,
      nextCursor,
    },
  };
}
