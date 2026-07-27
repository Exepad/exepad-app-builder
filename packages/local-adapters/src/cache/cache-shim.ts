/**
 * In-process shim for the Cloudflare Cache API (`caches.default`). The runtime
 * uses it as a PoP-local layer in `lib/app-config.ts` via `getDefaultCache()`.
 * Backed by a bounded Map keyed on the request URL; Responses are stored as
 * {status, headers, body} and reconstructed on match (Response bodies are
 * one-shot, so we can't cache the object directly).
 *
 * Call `installCacheShim()` once at process boot, before any module that reads
 * `caches.default`, so the existing code path keeps working unchanged.
 */
interface CachedResponse {
  status: number;
  headers: [string, string][];
  body: Buffer;
  // Epoch-ms after which the entry is stale, or null when it never expires.
  expiresAt: number | null;
}

/**
 * Derive an `expiresAt` epoch-ms from a `Cache-Control` header value.
 * - `no-store` / `no-cache` → already stale (never a hit).
 * - `max-age=<n>` → now + n seconds.
 * - otherwise → null (no TTL, entry lives until evicted).
 */
function parseExpiry(cacheControl: string | null): number | null {
  if (!cacheControl) return null;
  const cc = cacheControl.toLowerCase();
  if (cc.includes('no-store') || cc.includes('no-cache')) return -1;
  const m = /max-age\s*=\s*(\d+)/.exec(cc);
  if (m) return Date.now() + Number(m[1]) * 1000;
  return null;
}

class CacheShim {
  private store = new Map<string, CachedResponse>();
  private max: number;
  private maxBytes: number;
  private maxEntryBytes: number;
  private totalBytes = 0;

  constructor(
    max = 1000,
    maxBytes = 128 * 1024 * 1024,
    maxEntryBytes = 8 * 1024 * 1024,
  ) {
    this.max = max;
    this.maxBytes = maxBytes;
    this.maxEntryBytes = maxEntryBytes;
  }

  private keyOf(request: Request | string): string {
    return typeof request === 'string' ? request : request.url;
  }

  private drop(key: string, entry: CachedResponse): void {
    this.store.delete(key);
    this.totalBytes -= entry.body.byteLength;
  }

  async match(request: Request | string): Promise<Response | undefined> {
    const key = this.keyOf(request);
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.drop(key, entry);
      return undefined;
    }
    // LRU: promote to most-recently-used by re-inserting at the tail.
    this.store.delete(key);
    this.store.set(key, entry);
    // The WHATWG Response constructor throws if a body is supplied with a
    // null-body status (101/204/205/304), so pass null for those.
    const nullBody = entry.status === 101 || entry.status === 204 ||
      entry.status === 205 || entry.status === 304;
    return new Response(nullBody ? null : entry.body, {
      status: entry.status,
      headers: entry.headers,
    });
  }

  async put(request: Request | string, response: Response): Promise<void> {
    const key = this.keyOf(request);
    const body = Buffer.from(await response.clone().arrayBuffer());
    // Replacing an existing entry: reclaim its bytes first.
    const existing = this.store.get(key);
    if (existing) this.drop(key, existing);
    // Never cache a body larger than the per-entry cap.
    if (body.byteLength > this.maxEntryBytes) return;
    const entry: CachedResponse = {
      status: response.status,
      headers: [...response.headers.entries()],
      body,
      expiresAt: parseExpiry(response.headers.get('cache-control')),
    };
    this.store.set(key, entry);
    this.totalBytes += body.byteLength;
    // Evict the oldest entries until under both the entry-count and byte budgets.
    // The just-inserted entry is at the tail, so it is never the eviction target
    // while other entries remain.
    while (this.store.size > this.max || this.totalBytes > this.maxBytes) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined || oldestKey === key) break;
      const oldest = this.store.get(oldestKey);
      if (!oldest) break;
      this.drop(oldestKey, oldest);
    }
  }

  async delete(request: Request | string): Promise<boolean> {
    const key = this.keyOf(request);
    const entry = this.store.get(key);
    if (!entry) return false;
    this.drop(key, entry);
    return true;
  }
}

const defaultCache = new CacheShim();

export function installCacheShim(): void {
  const g = globalThis as unknown as { caches?: unknown };
  if (g.caches) return;
  g.caches = {
    default: defaultCache,
    async open() {
      return defaultCache;
    },
  };
}

export { defaultCache };
