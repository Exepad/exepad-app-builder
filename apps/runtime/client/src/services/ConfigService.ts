/**
 * Config Service
 * Unified configuration management with multiple source support
 *
 * BROWSER-ONLY. This module is imported exclusively by SPA code
 * (`app_shared/utils/unifiedConfig`, `context/EditModeContext`,
 * `context/ConfigUpdateContext`) and never by the Node worker, so there is no
 * server-side/edge cache available here — only the page's own memory.
 *
 * CACHING STRATEGY:
 * - Published mode: in-memory Map with a 5-min TTL, scoped to the page session.
 * - Preview mode: no caching — always fetches fresh data for editing.
 * - `app_shared/utils/unifiedConfig` layers its own per-session result cache
 *   on top of this one.
 */

import { WebAppProps } from '@/app_runtime/interfaces/apps/webapp';
import { ComponentProps } from '@/app_runtime/interfaces/components/common/core';

export type ConfigSource = 'backend' | 'public' | 'static' | 'demo' | 'example';

export interface FetchOptions {
  source?: ConfigSource;
  retries?: number;
  timeout?: number;
  slugSegments?: string[]; // For nested paths in example/demo
}

export interface ComponentUpdate {
  componentId: string;
  lastUpdatedEpoch: number;
  componentData?: ComponentProps;
  timestamp: number;
}

/**
 * Extended result that includes config path metadata
 * Used for example routes where the config file path depth matters for routing
 */
export interface ConfigFetchResult {
  config: WebAppProps;
  /** Number of path segments used to find the config file (e.g., 2 for apps/BookingApp.json) */
  configPathDepth: number;
}

/**
 * Cache entry for the in-memory (per page session) config cache
 */
interface ConfigCacheEntry {
  config: WebAppProps;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Cache TTL
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 5 * 60 * 1000;       // 5 minutes

// ---------------------------------------------------------------------------
// In-memory config cache. Lives for the life of the page; the Map itself is the
// key registry, so pattern-based invalidation can enumerate it directly.
// ---------------------------------------------------------------------------
const localConfigCache = new Map<string, ConfigCacheEntry>();

function readFromCache(cacheKey: string): WebAppProps | null {
  const entry = localConfigCache.get(cacheKey);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.config;
  }
  return null;
}

function writeToCache(cacheKey: string, config: WebAppProps): void {
  localConfigCache.set(cacheKey, { config, timestamp: Date.now() });
}

/**
 * ConfigService - Fetching logic with caching for published mode
 *
 * CACHING:
 * - Published mode: in-memory Map with a 5-min TTL, per page session.
 * - Preview mode: never cached — always fetches fresh data for editing.
 */
export class ConfigService {
  /**
   * Fetch config from various sources
   * Uses the in-memory cache for published mode to avoid redundant backend calls
   */
  static async fetch(
    appId: string,
    mode: 'published' | 'preview',
    options: FetchOptions = {}
  ): Promise<WebAppProps | null> {
    const { source = 'backend', retries = 3, slugSegments } = options;
    // Include slugSegments in cache key to differentiate between different apps
    // e.g., example:apps/BookingApp:published vs example:apps/DashboardApp:published
    const slugKey = slugSegments?.length ? `/${slugSegments.join('/')}` : '';
    const cacheKey = `${source}:${appId}${slugKey}:${mode}`;

    // Check cache for published mode
    if (mode === 'published') {
      const cached = readFromCache(cacheKey);
      if (cached) {
        console.log(`[ConfigService] Cache HIT for ${cacheKey}`);
        return cached;
      }
    }

    try {
      const config = await this.fetchWithRetries(appId, mode, source, retries, slugSegments);

      // Cache successful fetches for published mode
      if (config && mode === 'published') {
        writeToCache(cacheKey, config);
        console.log(`[ConfigService] Cached config for ${cacheKey}`);
      }

      return config;
    } catch (error) {
      // Preserve typed worker error codes (e.g. NOT_PUBLISHED) so callers
      // can render a distinct state. Generic failures still fall through
      // to a null return so the existing "App Not Found" path is unchanged.
      const code = (error as Error & { code?: string })?.code;
      if (code) {
        throw error;
      }
      console.error(`[ConfigService] Failed to fetch config:`, error);
      return null;
    }
  }

  /**
   * Invalidate cache for a specific app
   * Supports both simple appId and full path (e.g., 'apps/BookingApp')
   */
  static async invalidate(appId: string, slugSegments?: string[]): Promise<void> {
    const pathPattern = slugSegments?.length ? `${appId}/${slugSegments.join('/')}` : appId;

    const matchingKeys = Array.from(localConfigCache.keys()).filter(key =>
      key.includes(`:${pathPattern}:`)
    );

    for (const key of matchingKeys) {
      localConfigCache.delete(key);
    }
    console.log(`[ConfigService] Invalidated cache for ${pathPattern} (deleted ${matchingKeys.length} entries)`);
  }

  /**
   * Clear the entire in-memory config cache
   */
  static async clearCache(): Promise<void> {
    localConfigCache.clear();
    console.log('[ConfigService] Cache cleared');
  }

  /**
   * Fetch with retries (extracted for reusability)
   */
  private static async fetchWithRetries(
    appId: string,
    mode: 'published' | 'preview',
    source: ConfigSource,
    retries: number,
    slugSegments?: string[]
  ): Promise<WebAppProps> {
    let lastError: Error | null = null;

    // `fetchFromWorker` (the 'backend' source) already runs its own internal
    // retry/backoff loop tuned for the post-deploy race, so wrapping it in this
    // outer retry loop just multiplies the request count (e.g. a genuinely
    // non-existent app fired ~12 config requests + several seconds of backoff
    // before surfacing "App Not Found"). Give backend a single outer pass and
    // let its inner loop own retries; other sources keep the outer retries.
    const effectiveRetries = source === 'backend' ? 1 : retries;

    for (let attempt = 0; attempt < effectiveRetries; attempt++) {
      try {
        let config: WebAppProps | null = null;

        switch (source) {
          case 'backend':
            config = await this.fetchFromBackend(appId, mode);
            break;
          case 'public':
            config = await this.fetchFromPublicDir(appId, mode);
            break;
          case 'static':
          case 'demo':
            config = await this.fetchFromDemo(appId);
            break;
          case 'example':
            config = await this.fetchFromExample(appId, slugSegments);
            break;
        }

        if (config) {
          return config;
        }
      } catch (error) {
        lastError = error as Error;
        // Use `effectiveRetries` (the actual loop bound) for both the log and
        // the backoff gate. Previously these referenced `retries`, so the
        // backend path (effectiveRetries === 1) logged a misleading "1/3" and
        // could sleep an exponential-backoff delay after its only attempt —
        // wasted time before surfacing the failure. One source of truth now.
        console.warn(
          `[ConfigService] Attempt ${attempt + 1}/${effectiveRetries} failed for ${appId}:`,
          error
        );
        // Exponential backoff
        if (attempt < effectiveRetries - 1) {
          await this.delay(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError || new Error(`Failed to fetch config after ${effectiveRetries} attempts`);
  }

  /**
   * Fetch config directly from the Runtime worker.
   */
  private static async fetchFromBackend(
    appId: string,
    mode: 'published' | 'preview',
  ): Promise<WebAppProps | null> {
    return this.fetchFromWorker(appId, mode);
  }

  /**
   * Fetch full config from the runtime worker's `/api/{appId}/app-config`.
   *
   * Retry transient 404 / 503 responses on a fixed backoff ladder. Immediately
   * after a deploy the gateway can still answer 404 (the config object is not
   * in CONFIG_CACHE storage yet) or 503 (config storage not available yet).
   * Preview mode gets a longer retry budget because deploys are the common
   * case there and the gateway negative-caches a config miss for ~10s
   * (`NULL_CACHE_TTL` in worker/src/routes/gateway/config.ts).
   */
  private static async fetchFromWorker(
    appId: string,
    mode: 'published' | 'preview',
  ): Promise<WebAppProps | null> {
    const apiAppId = mode === 'preview' ? `preview-${appId}` : appId;
    const url = `/api/${apiAppId}/app-config`;
    const retryDelaysMs = mode === 'preview'
      ? [300, 600, 1200, 2000, 3000]
      : [250, 500, 1000];
    let lastStatus = 0;

    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
      const response = await fetch(url, {
        ...(mode === 'preview' ? { cache: 'no-store' as RequestCache } : {}),
      });

      if (response.ok) {
        const data = await response.json();
        return typeof data === 'string' ? JSON.parse(data) : data;
      }

      lastStatus = response.status;

      // The worker emits `{ error: "not_published", preview_available: true }`
      // when the published URL is hit for an app whose only existing deploy
      // is preview. Retrying won't change that — surface immediately with a
      // typed error the SPA recognizes.
      //
      // Detection (in try) is separated from the throw (after try) so the
      // catch-and-fall-through cannot swallow the synthetic NOT_PUBLISHED
      // error along with the genuine "body unreadable" failures.
      let isNotPublished = false;
      if (response.status === 404) {
        try {
          const body = await response.clone().json();
          if (body && body.error === 'not_published') {
            isNotPublished = true;
          }
        } catch {
          // body unreadable or not JSON — fall through to retry logic
        }
      }
      if (isNotPublished) {
        const e = new Error('Worker config endpoint reports app not published');
        (e as Error & { code?: string }).code = 'NOT_PUBLISHED';
        throw e;
      }

      // The worker emits 503 with `error.code: "DEPLOY_FAILED"` when the
      // preview deploy explicitly failed (deployment-status-preview.json
      // status === "failed"). Retrying won't change that — surface
      // immediately with a typed error so AppLayout can render a real
      // "build failed" card instead of spinning forever. 1ybz1p4n
      // (2026-05-19) is the canonical case: previewRetry would otherwise
      // keep polling a permanently-broken app.
      let deployFailed: { message?: string; step?: string } | null = null;
      if (response.status === 503) {
        try {
          const body = await response.clone().json();
          if (
            body &&
            typeof body === 'object' &&
            (body as { error?: { code?: string } }).error?.code === 'DEPLOY_FAILED'
          ) {
            const err = (body as { error: { message?: string; step?: string; underlyingError?: string } }).error;
            deployFailed = {
              message: err.underlyingError || err.message,
              step: err.step,
            };
          }
        } catch {
          // body unreadable or not JSON — fall through to retry logic
        }
      }
      if (deployFailed) {
        const e = new Error(
          deployFailed.message ||
            `Preview build failed${deployFailed.step ? ` at step '${deployFailed.step}'` : ''}.`,
        );
        (e as Error & { code?: string; step?: string }).code = 'DEPLOY_FAILED';
        (e as Error & { code?: string; step?: string }).step = deployFailed.step;
        throw e;
      }

      // Only retry on 404 (config not yet in CONFIG_CACHE storage — the transient
      // post-deploy race, which affects published too right after a publish) and
      // 503. 401/403/500 are genuine failures and surface immediately. The
      // request-count blow-up for a genuinely non-existent app is bounded by the
      // single outer pass (see `effectiveRetries` in fetchWithRetries), not by
      // shortening this deploy-race retry budget.
      const isRetryable = response.status === 404 || response.status === 503;
      if (!isRetryable || attempt === retryDelaysMs.length) {
        throw new Error(`Worker config endpoint returned ${response.status}`);
      }

      // Preview mode: 404 during the early polling window is the expected
      // state immediately after a deploy (the build status page mounts the
      // iframe before the config lands in storage). Suppress per-attempt
      // noise — only log the final failure. Published mode still logs every
      // attempt because a 404 there usually indicates a real problem.
      if (mode === 'published') {
        // eslint-disable-next-line no-console
        console.warn(
          `[ConfigService] ${url} returned ${response.status}, retrying in ${retryDelaysMs[attempt]}ms (attempt ${attempt + 1}/${retryDelaysMs.length})`,
        );
      }
      await new Promise((r) => setTimeout(r, retryDelaysMs[attempt]));
    }

    // Exhausted all retries — treat as terminal failure.
    throw new Error(`Worker config endpoint returned ${lastStatus} after retries`);
  }

  /**
   * Fetch from public directory (new)
   */
  private static async fetchFromPublicDir(
    appId: string,
    mode: 'published' | 'preview'
  ): Promise<WebAppProps | null> {
    const fileName = mode === 'preview' ? `${appId}-preview.json` : `${appId}.json`;
    const publicPath = `/configs/${fileName}`;

    const response = await fetch(publicPath, { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`Config file not found: ${publicPath}`);
    }

    return await response.json();
  }

  /**
   * Fetch from demo directory (public/demo) via HTTP.
   */
  private static async fetchFromDemo(appId: string): Promise<WebAppProps | null> {
    const url = `/demo/${appId}.json`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Demo config not found: ${appId}`);
    }
    return await response.json();
  }

  /**
   * Fetch from example directory with metadata (public method)
   * Returns both the config and the path depth where the config was found
   * This is essential for correct page routing in nested example paths
   * 
   * Lookup order:
   * 1. {appId}.json (standard pattern)
   * 2. {appId}/app-config.json (directory pattern for local dev)
   * 3. Progressively shorter paths for nested configs
   */
  static async fetchExampleWithMeta(
    appId: string,
    slugSegments?: string[]
  ): Promise<ConfigFetchResult | null> {
    const fullPath = [appId, ...(slugSegments || [])];

    for (let i = fullPath.length; i >= 1; i--) {
      const pathSegments = fullPath.slice(0, i);

      const patterns = [
        `/example/${pathSegments.join('/')}.json`,
        `/example/${pathSegments.join('/')}/app-config.json`,
        `/example/${pathSegments.join('/')}/app_config.json`,
      ];

      if (pathSegments.length >= 2) {
        const lastSegment = pathSegments[pathSegments.length - 1];
        const parentSegment = pathSegments[pathSegments.length - 2];
        const categoryMatch = parentSegment.match(/^blocks[_-](.+)$/);
        if (categoryMatch) {
          const category = categoryMatch[1].replace(/_/g, '-');
          patterns.push(`/example/${pathSegments.join('/')}/block-${category}-${lastSegment}.json`);
        }
      }

      for (const url of patterns) {
        try {
          const response = await fetch(url);
          if (response.ok) {
            const config = await response.json();
            return { config, configPathDepth: i };
          }
        } catch {
          continue;
        }
      }
    }

    throw new Error(`Example config not found: ${appId}`);
  }

  /**
   * Fetch from example directory (public/example)
   * Supports nested directory structures
   * @deprecated Use fetchExampleWithMeta for correct routing support
   */
  private static async fetchFromExample(
    appId: string,
    slugSegments?: string[]
  ): Promise<WebAppProps | null> {
    const result = await this.fetchExampleWithMeta(appId, slugSegments);
    return result?.config ?? null;
  }


  /**
   * Extract all components from a config
   */
  static extractComponents(config: WebAppProps): Map<string, ComponentProps> {
    const components = new Map<string, ComponentProps>();

    const traverse = (items: any[] | undefined) => {
      if (!items || !Array.isArray(items)) return;

      for (const item of items) {
        if (item && typeof item === 'object') {
          if (item.uuid && item.componentType) {
            components.set(item.uuid, item as ComponentProps);
          }
          Object.values(item).forEach((value) => {
            if (Array.isArray(value)) {
              traverse(value);
            } else if (
              value &&
              typeof value === 'object' &&
              (value as any).uuid &&
              (value as any).componentType
            ) {
              components.set((value as any).uuid, value as ComponentProps);
            }
          });
        }
      }
    };

    traverse(config.frontend?.header);
    traverse(config.frontend?.footer);
    traverse(config.frontend?.sidebar);
    config.frontend?.pages?.forEach((page) => {
      if ('content' in page && Array.isArray(page.content)) {
        traverse(page.content);
      }
    });

    return components;
  }

  /**
   * Compare two configs and return changed components
   */
  static compareConfigs(
    oldConfig: WebAppProps | null,
    newConfig: WebAppProps
  ): ComponentUpdate[] {
    if (!oldConfig) return [];

    const oldComponents = this.extractComponents(oldConfig);
    const newComponents = this.extractComponents(newConfig);
    const updates: ComponentUpdate[] = [];

    newComponents.forEach((newComp, uuid) => {
      const oldComp = oldComponents.get(uuid);
      const newEpoch = newComp.lastUpdatedEpoch || 0;
      const oldEpoch = oldComp?.lastUpdatedEpoch || 0;

      if (newEpoch > oldEpoch) {
        updates.push({
          componentId: uuid,
          lastUpdatedEpoch: newEpoch,
          componentData: newComp,
          timestamp: Date.now(),
        });
      }
    });

    if (updates.length > 0) {
      console.log(`[ConfigService] Found ${updates.length} component updates`);
    }

    return updates;
  }

  /**
   * Utility delay function for retries
   */
  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
