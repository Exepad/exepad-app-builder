# 06 — Configuration Loading & Runtime Services

> Standalone reference for platform engineers.
> All file paths are relative to `apps/runtime/`.

---

## 1. ConfigService

**File:** `src/services/ConfigService.ts`

ConfigService is the single entry-point for loading an app's JSON configuration.
It supports five distinct sources, published-mode caching, retry logic with
exponential back-off, and progressive path resolution for nested example
configs.

### 1.1 Config Sources

The `ConfigSource` union type is defined at line 14:

```ts
export type ConfigSource = 'backend' | 'public' | 'static' | 'demo' | 'example';
```

| Source      | Method                   | Description |
|-------------|--------------------------|-------------|
| `backend`   | `fetchFromBackend`       | Direct fetch to the runtime worker. Published mode loads `/api/{appId}/app-config`; preview mode loads `/api/preview-{appId}/app-config` with `cache: 'no-store'`. `fetchFromBackend` is now just the historical source name for the worker-backed path. |
| `public`    | `fetchFromPublicDir`     | Fetches from `public/configs/{appId}.json` (or `{appId}-preview.json` for preview). Direct fetch against the Vite public directory. (lines 270-284) |
| `static` / `demo` | `fetchFromDemo`  | `static` and `demo` are aliases (lines 164-167). Server-side only. In Edge Runtime fetches via absolute URL (`/demo/{appId}.json`); in Node.js Runtime reads from the filesystem at `public/demo/{appId}.json`. (lines 290-340) |
| `example`   | `fetchFromExample` / `fetchExampleWithMeta` | Server-side only. Supports nested directory structures via `slugSegments`. Tries progressively shorter paths with three filename patterns per path depth. (lines 352-492) |

### 1.2 Resolution Order (Example Source)

`fetchExampleWithMeta` (line 352) builds a `fullPath` from `[appId, ...slugSegments]` and iterates from longest to shortest path. At each depth it tries three patterns:

1. `{path}.json` -- standard flat file (line 377/438)
2. `{path}/app-config.json` -- directory pattern with hyphen (line 389/449)
3. `{path}/app_config.json` -- directory pattern with underscore (line 402/460)

The first match wins. The method returns a `ConfigFetchResult` containing both the
parsed config and `configPathDepth` (the number of slug segments consumed), which
the page router uses to separate config-path segments from page-route segments
(lines 35-39).

### 1.3 Caching Strategy

```
Published mode  -->  In-memory Map with 5-minute TTL
Preview mode    -->  No caching (always fetch fresh)
```

**In-memory cache** (lines 44-58):

- Stored in module-level `configCache: Map<string, ConfigCacheEntry>`
- Key format: `{source}:{appId}{/slugSegments}:{mode}` (line 82)
- TTL: `CACHE_TTL_MS = 5 * 60 * 1000` (300 000 ms / 5 minutes) (line 58)
- On cache hit the service logs the entry age in seconds (line 88)
- On successful fetch in published mode the result is stored with `Date.now()` timestamp (lines 97-103)

**Preview-mode bypass**: The `fetch` method only checks the cache when
`mode === 'published'` (line 85). Preview fetches always go to the source.

**Worker fetch note**: Preview mode passes `cache: 'no-store'` on the worker
request so edits always read fresh config. Published mode relies on the runtime
cache layer described above; there is no backend POST or signed-URL handoff in
the current contract.

**React `cache()` deduplication**: As noted in the header comment (line 8), a
`cache()` wrapper at the call-site provides request-level deduplication so that
multiple React Server Components in the same request share a single fetch.

### 1.4 Cache Invalidation

Two methods:

| Method | Signature | Behavior |
|--------|-----------|----------|
| `invalidate` | `(appId, slugSegments?) => void` | Builds a path pattern and deletes all cache keys containing `:pattern:` (lines 116-130) |
| `clearCache` | `() => void` | Clears the entire `configCache` Map (lines 135-138) |

### 1.5 Retry Logic

`fetchWithRetries` (line 143) wraps each source fetch in a retry loop:

- Default retries: **3** (line 78)
- On failure, waits `2^attempt * 1000` ms (exponential back-off, line 185)
- After exhausting all retries, throws the last error (line 190)

### 1.6 Config Diffing

Two utility methods support incremental updates in preview mode:

- **`extractComponents`** (line 498): Recursively traverses `header`, `footer`, `sidebar`, and all page `content` arrays, collecting every object with `uuid` + `componentType` into a `Map<string, ComponentProps>`.
- **`compareConfigs`** (line 540): Compares old and new configs by `lastUpdatedEpoch` per component; returns only components whose epoch increased, as `ComponentUpdate[]`.

---

## 2. Config Caching

**File:** `src/services/ConfigService.ts`

> Historical note: this section used to document a generic `CacheService` class
> (`src/services/CacheService.ts`) with LRU eviction, memory caps, web-storage
> persistence, and hit/miss statistics. **That file no longer exists**, and
> neither does the `services/index.ts` barrel that once re-exported it — each
> service is imported from its own module. Config caching now lives inside
> `ConfigService` itself.

### 2.1 Strategy

- **Published mode** — cached with a 5-minute TTL.
- **Preview mode** — never cached; every load fetches fresh so edits appear
  immediately.

### 2.2 Storage

`readFromCache` / `writeToCache` operate directly on the module-level
`localConfigCache` — a plain `Map<string, ConfigCacheEntry>` holding
`{ config, timestamp }` entries, checked against `CACHE_TTL_MS` (5 minutes).

This module is SPA-only, so there is no second tier: it previously probed
`caches.default` (a Workers-only extension that browser `CacheStorage` does not
expose) before falling through to the Map, which meant the branch never once
fired in the browser. It was removed. The server side is unrelated — the worker
installs its own in-memory shim via `installCacheShim()` from
`@exepad/local-adapters`, and never imports this module.

### 2.3 Invalidation

`invalidate()` enumerates `localConfigCache.keys()` and drops the matching
entries; `clearCache()` empties the Map. Both are per-process and start empty on
a cold start, which is harmless since TTL expiry covers those cases.

---

## 3. PersistenceService

**File:** `src/services/PersistenceService.ts`

Handles saving configuration changes back to the backend during **preview mode
only**. It communicates exclusively through the WebSocketManager.

### 3.1 Data Model

```ts
interface ContentUpdate {        // line 10
  componentId: string;
  content: string;
  componentType: string;
  target_field: string;
  timestamp: number;
  isSaved?: boolean;
}
```

### 3.2 Public API

| Method | Signature | Description |
|--------|-----------|-------------|
| `save` | `(appId, updates[], options?) => Promise<SaveResult>` | Sends an `app_config_saved` WebSocket message containing all updates (lines 45-71) |
| `enableAutoSave` | `(appId, getUpdates, intervalMs=30000) => void` | Starts a 30-second `setInterval` that calls `save()` with unsaved updates (lines 76-97) |
| `disableAutoSave` | `() => void` | Clears the auto-save interval (lines 102-108) |
| `scheduleSave` | `(appId, updates, delayMs=2000) => void` | Debounced save: clears any pending timeout for the same `appId`, then schedules a new one (lines 120-139) |
| `cancelPendingSave` | `(appId) => void` | Cancels a pending debounced save (lines 144-151) |
| `getUnsavedCount` | `(updates: Map) => number` | Counts entries where `isSaved !== true` (lines 113-115) |
| `cleanup` | `() => void` | Disables auto-save and clears all pending timeouts (lines 156-164) |

### 3.3 Save Options

```ts
interface SaveOptions {          // line 19
  forced?: boolean;              // bypass debounce
  autoSave?: boolean;            // marks the save as auto-triggered
}
```

---

## 4. WebSocketManager

**File:** `src/services/WebSocketManager.ts`

A singleton WebSocket connection manager used exclusively in **preview mode** for
real-time bidirectional communication between the runtime and the builder/backend.

### 4.1 Singleton Pattern

Private constructor (line 52); access via `WebSocketManager.getInstance()` (line 59).

### 4.2 Connection Lifecycle

**`connect(appId, jwtToken?)`** (line 71):

1. Builds the WebSocket URL from `VITE_WS_URL` or by replacing `http` with `ws` in `VITE_BACKEND_URL`, falling back to `wss://backend.exepad.com` (lines 79-82).
2. Constructs the endpoint: `/ws/runtime-bridge/?type=runtime&app_uuid={appId}` (line 90).
3. If a JWT token is provided, appends `&token={jwt}` (line 94).
4. Creates the `WebSocket` object and attaches event handlers (lines 105-219).

**Event handlers:**

| Event | Behavior |
|-------|----------|
| `onopen` | Resets reconnect counter, records pong timestamp, starts heartbeat, flushes queued messages, notifies `connection` subscribers with `status: 'connected'` (lines 111-118) |
| `onmessage` | Parses JSON, handles `pong` for heartbeat, deduplicates by `message.id` (capped at 1000 IDs), routes to type-specific subscribers and wildcard (`*`) subscribers (lines 120-156) |
| `onerror` | Logs connection context (readyState, URL, appId, timestamp); notifies subscribers (lines 158-179) |
| `onclose` | Logs close code with human-readable reason map (lines 191-205), stops heartbeat, notifies subscribers, triggers auto-reconnect for non-clean closes (code !== 1000) (lines 216-219) |

### 4.3 Auto-Reconnect with Exponential Back-off

`reconnect(appId)` (line 353):

- Maximum attempts: **10** (`maxReconnectAttempts`, line 45)
- Delay: `min(1000 * 2^attempts, 30000)` ms (line 363)
- On each reconnect attempt, clears the cached JWT token and requests a fresh one via dynamic import of `jwt-helper` to handle expired tokens (lines 374-386)
- Calls `connect(appId, freshToken)` after the delay (line 388)

### 4.4 Heartbeat

`startHeartbeat()` (line 395):

- Sends a `{ type: 'ping' }` message every **30 seconds** (line 415)
- Tracks `lastPongTimestamp`; if no `pong` received for **90 seconds**, considers the connection dead and calls `ws.close()` to trigger reconnection (lines 401-407)
- Pong responses are handled in `onmessage` (lines 126-129)

### 4.5 Message Sending

`send(message, options?)` (line 249):

- Validates message size against a **1 MB** limit (`MAX_MESSAGE_SIZE`, line 260); shows a toast notification on rejection (lines 267-269)
- If connected (`readyState === OPEN`), sends immediately (lines 275-277)
- If disconnected, queues up to **100** messages (line 280); drops with toast warning if queue is full (lines 288-299)
- Throws `'WebSocket not connected, message queued'` if queued (line 301)

**Deduplication**: When `options.deduplicate === true`, a unique `id` is generated and attached to the message. The receiver-side `messageIdSet` (capped at 1000 entries) prevents duplicate processing (lines 133-149).

### 4.6 Queue Flushing

`flushQueue()` (line 434):

- Called on successful reconnection
- Drops messages older than **60 seconds** (line 445)
- Shows a toast notification if stale messages were dropped (lines 459-463)

### 4.7 Pub/Sub

`subscribe(channel, handler)` (line 225):

- Stores handlers in a `Map<string, Set<MessageHandler>>`
- Returns an unsubscribe function (line 233)
- Special channel `'*'` receives all messages (line 152)
- `'connection'` channel receives status changes (lines 117, 175, 209, 357)

### 4.8 Debug Info

`getDebugInfo()` (line 486) returns: `{ status, queueSize, subscribers, reconnectAttempts }`.

---

## 5. ErrorReportingService

**File:** `src/services/ErrorReportingService.ts`

Centralized error tracking with Sentry integration, local frequency monitoring,
and recovery decision logic. All methods are `static`.

### 5.1 Sentry Integration

`initSentry()` (line 52): Initializes only in production or when
`VITE_ENABLE_SENTRY === 'true'`. This method sets the `sentryInitialized` flag.

Auto-initialized on import when running in the browser (lines 206-208).

### 5.2 Error Reporting

`report(error, context?)` (line 70):

1. Builds a `fullContext: ErrorContext` with `mode`, `timestamp`, `url`, `userAgent`, `stackTrace` (lines 71-78)
2. Increments per-component error count in the static `errorCounts` Map, keyed by `componentId || componentType || 'unknown'` (lines 81-83)
3. Appends to `errorLogs[]` (max 100 entries, FIFO) (lines 86-89)
4. Console output: full details in development; only critical (3+ occurrences) in production (lines 92-100)
5. Sends to Sentry in production via `window.Sentry.captureException()` with `contexts.runtime` and `tags` (lines 103-123)
6. Dispatches a `'runtime-error'` CustomEvent on `window` for external monitoring tools (lines 126-132)

### 5.3 Error Context

```ts
interface ErrorContext {            // line 8
  componentType?: string;
  componentId?: string;
  appId?: string;
  errorCount?: number;
  userAction?: string;
  stackTrace?: string;
  mode: RuntimeMode;               // 'published' | 'preview'
  timestamp: number;
  url?: string;
  userAgent?: string;
}
```

### 5.4 Recovery Logic

`shouldRecover(context)` (line 139): Returns `true` if the component's error count is below **3**. Components that have errored 3 or more times are considered unrecoverable.

`clearErrors(componentId)` (line 150): Resets the error count for a component after a successful recovery.

### 5.5 Error Statistics

`getErrorStats()` (line 158): Returns:

```ts
interface ErrorStats {
  totalErrors: number;              // sum of all per-component counts
  componentErrors: [string, number][];  // per-component breakdown
  recentErrors: ErrorLog[];         // last 20 error log entries
}
```

### 5.6 Additional Methods

| Method | Line | Description |
|--------|------|-------------|
| `getErrorCount(componentId)` | 169 | Returns count for a specific component |
| `hasCriticalErrors(componentId)` | 176 | `true` if count >= 3 |
| `reset()` | 183 | Clears all counts and logs (useful for testing) |
| `exportLogs()` | 192 | Returns full JSON string of counts, recent errors, and stats |

---

## Service Dependency Graph

```
ConfigService
  |
  +-- (internal Map for published-mode cache)
  +-- fetchFromBackend  --> Backend API + signed URL
  +-- fetchFromPublicDir --> /public/configs/
  +-- fetchFromDemo     --> /public/demo/ (fs or fetch)
  +-- fetchFromExample  --> /public/example/ (fs or fetch, progressive path)

PersistenceService
  |
  +-- WebSocketManager.getInstance().send()

WebSocketManager (singleton)
  |
  +-- jwt-helper (dynamic import on reconnect)
  +-- sonner toast (user notifications)

ErrorReportingService (static)
  |
  +-- window.Sentry (production only)
  +-- CustomEvent 'runtime-error'
```
