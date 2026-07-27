import type { Env } from '../types/env';
import { resolveConfigKey } from './config-paths';
import { getDefaultCache, runDeferred } from './runtime-context';

export interface AppConfig {
  name?: string;
  frontend?: {
    appName?: string;
    description?: string;
    favicon?: string;
    metadata?: {
      title?: string;
      description?: string;
      favicon?: string;
      keywords?: string | string[];
      openGraph?: {
        title?: string;
        description?: string;
        image?: string;
        url?: string;
      };
    };
    pages?: Array<{
      slug: string;
      title?: string;
      summary?: string;
      metadata?: {
        title?: string;
        description?: string;
      };
    }>;
    theme?: {
      ogImage?: string;
    };
  };
  security?: {
    enabled?: boolean;
    defaultAccess?: string;
    authProviders?: unknown[];
  };
}

// Mode-aware in-memory TTLs: preview apps change frequently, published can be cached longer
const PUBLISHED_CACHE_TTL = 60_000;  // 60s
const PREVIEW_CACHE_TTL = 10_000;    // 10s — fast iteration during development
const NULL_CACHE_TTL = 10_000;       // 10s — shorter to detect deploy completion faster

// CF Cache API TTLs (survives across Worker isolates within the same PoP)
const PUBLISHED_CF_CACHE_TTL = 300;  // 5 min (seconds for Cache-Control)
const PREVIEW_CF_CACHE_TTL = 30;     // 30s — compromise between freshness and R2 cost

const cache = new Map<string, { config: AppConfig | null; timestamp: number }>();

export function extractAppId(pathname: string): string | null {
  const match = pathname.match(/^\/a\/(?:preview-)?([^/]+)/);
  return match ? match[1] : null;
}

export function extractPageSlug(pathname: string): string {
  const match = pathname.match(/^\/a\/[^/]+(.*)$/);
  const slug = match?.[1] || '/';
  if (slug === '' || slug === '/index.html') return '/';
  return slug;
}

/**
 * Invalidate cached config for an app+mode. Call after deploy to bust stale entries.
 * Purges both the per-isolate in-memory map AND the CF Cache API entry (PoP-scoped),
 * so subsequent isolates don't serve a stale positive config from before the re-deploy.
 */
export async function invalidateConfig(appId: string, mode: string): Promise<void> {
  const cacheKey = `${appId}:${mode}`;
  cache.delete(cacheKey);
  try {
    const cacheApi = getDefaultCache();
    if (cacheApi) {
      await cacheApi.delete(cfCacheUrl(cacheKey));
    }
  } catch {
    // Cache API unavailable — no-op
  }
}

/** Build the synthetic URL used as CF Cache API key for config entries. */
function cfCacheUrl(cacheKey: string): Request {
  return new Request(`https://exepad-config-cache.internal/${cacheKey}`);
}

export async function loadAppConfig(
  appId: string,
  env: Env,
  mode: 'published' | 'preview' = 'published',
  options?: { noCache?: boolean; executionCtx?: ExecutionContext },
): Promise<AppConfig | null> {
  const cacheKey = `${appId}:${mode}`;
  const bypassCache = options?.noCache === true;

  // ── Layer 1: In-memory cache (per-isolate) ──
  if (!bypassCache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      const ttl = cached.config === null
        ? NULL_CACHE_TTL
        : mode === 'preview' ? PREVIEW_CACHE_TTL : PUBLISHED_CACHE_TTL;
      if (Date.now() - cached.timestamp < ttl) {
        return cached.config;
      }
    }
  }

  // ── Layer 2: CF Cache API (shared across isolates at the same PoP) ──
  if (!bypassCache) {
    try {
      const cacheApi = getDefaultCache();
      const cfCached = cacheApi ? await cacheApi.match(cfCacheUrl(cacheKey)) : undefined;
      if (cfCached) {
        const config = await cfCached.json<AppConfig | null>();
        cache.set(cacheKey, { config, timestamp: Date.now() });
        return config;
      }
    } catch {
      // Cache API unavailable in some environments (e.g., local dev) — fall through to R2
    }
  }

  // ── Layer 3: R2 (source of truth) ──
  try {
    const key = await resolveConfigKey(env.CONFIG_CACHE, appId, mode);

    if (!key) {
      // Don't cache null for preview — a deploy may still be in progress and
      // the frontend retry loop needs each fetch to re-check R2.
      if (mode !== 'preview') {
        cache.set(cacheKey, { config: null, timestamp: Date.now() });
      }
      return null;
    }

    const object = await env.CONFIG_CACHE.get(key);
    if (!object) {
      if (mode !== 'preview') {
        cache.set(cacheKey, { config: null, timestamp: Date.now() });
      }
      return null;
    }
    const config = await object.json<AppConfig>();

    // Populate in-memory cache
    cache.set(cacheKey, { config, timestamp: Date.now() });

    // Populate CF Cache API (non-blocking)
    try {
      const cacheApi = getDefaultCache();
      if (!cacheApi) return config;
      const cfTtl = mode === 'preview' ? PREVIEW_CF_CACHE_TTL : PUBLISHED_CF_CACHE_TTL;
      const cfResponse = new Response(JSON.stringify(config), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${cfTtl}`,
        },
      });
      await runDeferred(cacheApi.put(cfCacheUrl(cacheKey), cfResponse), options?.executionCtx);
    } catch {
      // Cache API unavailable — no-op
    }

    return config;
  } catch {
    return null;
  }
}

export function isAuthRequired(config: AppConfig | null): boolean {
  if (!config) return false;
  const sec = config.security;
  if (!sec) return false;
  // Explicit kill switch: admin toggled "Enable Authentication" off.
  // This takes precedence over any leftover authProviders/defaultAccess.
  if (sec.enabled === false) return false;
  return !!(sec.authProviders?.length && sec.defaultAccess && sec.defaultAccess !== 'public');
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
