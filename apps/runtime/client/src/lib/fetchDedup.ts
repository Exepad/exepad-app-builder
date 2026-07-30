/**
 * Fetch Deduplication Layer
 *
 * Prevents duplicate API calls when multiple React components
 * request the same resource concurrently (e.g., two DataTables
 * both needing `model.books`, or two components referencing
 * different fields of `handler.getDashboardStats`).
 *
 * How it works:
 * 1. Each request is keyed by a string (e.g., "model:appId:books:paramsHash").
 * 2. If a request with the same key is already in-flight, the new caller
 *    receives the same Promise — no duplicate HTTP request is made.
 * 3. After resolution, the result is cached for a short window (CACHE_TTL)
 *    to absorb React re-render refetches (e.g., Zustand store updates
 *    causing cascading re-renders that re-trigger useEffect).
 * 4. Callers can explicitly invalidate keys (e.g., after a mutation).
 */

interface CacheEntry<T = unknown> {
  promise: Promise<T>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** How long a resolved result stays cached (ms). */
const CACHE_TTL = 3_000;

/** Periodic cleanup interval (ms) — prune expired entries to prevent memory leaks. */
const CLEANUP_INTERVAL = 60_000;

if (typeof window !== 'undefined') {
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now >= entry.expiresAt) {
        cache.delete(key);
      }
    }
  }, CLEANUP_INTERVAL);

  // In Node-based test environments (Vitest + jsdom), unref prevents this
  // housekeeping timer from keeping the process alive after tests complete.
  (cleanupTimer as unknown as { unref?: () => void }).unref?.();
}

/**
 * Execute `fetchFn` with deduplication.
 *
 * If a request with the same `key` is already in-flight or was resolved
 * within the last CACHE_TTL ms, the existing Promise is returned instead
 * of issuing a new request.
 */
export function dedupedFetch<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key);

  if (existing && now < existing.expiresAt) {
    return existing.promise as Promise<T>;
  }

  // Set a long initial expiry — will be tightened once the promise resolves.
  const entry: CacheEntry<T> = {
    promise: fetchFn().then(
      (result) => {
        // Tighten expiry to CACHE_TTL from now (absorb re-render refetches).
        entry.expiresAt = Date.now() + CACHE_TTL;
        return result;
      },
      (err) => {
        // On error, remove immediately so retries aren't blocked.
        cache.delete(key);
        throw err;
      },
    ),
    // While in-flight, keep the entry alive for up to 30 s (guards against
    // very slow responses; the entry is replaced on resolve anyway).
    expiresAt: now + 30_000,
  };

  cache.set(key, entry);
  return entry.promise;
}

/**
 * Invalidate all cached entries whose key starts with `prefix`.
 * Call this after mutations so the next fetch gets fresh data.
 */
export function invalidateDedup(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}
