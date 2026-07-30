// src/app_runtime/interfaces/offline.ts
// Offline support configuration for Progressive Web Apps

/**
 * Configures Progressive Web App offline support including Service Worker, IndexedDB caching, and background sync.
 */
export interface OfflineProps {
  /** If true, registers a Service Worker and enables offline capabilities. */
  enabled: boolean;

  /** List of state keys (from frontend.logic.state) to persist to IndexedDB for offline access. */
  persistState?: string[];

  /** Model-level caching rules for offline access to backend data. */
  cacheModels?: CacheModelProps[];

  /** Sync strategy: 'eager' (sync immediately when online), 'lazy' (sync on next request), or 'manual' (user-triggered). */
  syncStrategy?: 'eager' | 'lazy' | 'manual';

  /** Conflict resolution when offline changes clash with server data: 'client-wins', 'server-wins', or 'manual' (user picks). */
  conflictResolution?: 'client-wins' | 'server-wins' | 'manual';

  /** Service Worker caching options for static assets and API responses. */
  caching?: CachingProps;
}

/**
 * Configures offline caching behavior for a specific backend model.
 */
export interface CacheModelProps {
  /** The backend model name to cache (must match a name in backend.models). */
  model: string;

  /** The caching strategy: 'cache-first' (fast, may be stale), 'network-first' (fresh, slower), or 'stale-while-revalidate'. */
  strategy: 'cache-first' | 'network-first' | 'stale-while-revalidate';

  /** Maximum number of records to store in the local cache for this model. */
  maxItems?: number;

  /** Cache time-to-live in seconds. */
  ttlSeconds?: number;

  /** If true, only the current user's records (matching owner_id) are cached. @default false */
  ownerOnly?: boolean;
}

/**
 * Configures Service Worker caching behavior for static assets and API responses.
 */
export interface CachingProps {
  /** If true, static assets (JS, CSS, images) are cached by the Service Worker. @default true */
  staticAssets?: boolean;

  /** If true, API responses are cached for offline access. @default false */
  apiResponses?: boolean;

  /** List of route paths to precache during Service Worker installation (e.g., ['/', '/dashboard']). */
  precacheRoutes?: string[];

  /** Maximum time in seconds that cached API responses are valid. */
  maxAgeSeconds?: number;
}
