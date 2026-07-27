/**
 * Unified Config Fetcher (Client-side SPA version)
 * Single source of truth for all config fetching across the application
 *
 * Replaces the server-side React.cache() + headers() version.
 * Config is now fetched on the client and cached in-memory per session.
 */

import { WebAppProps } from '@/interfaces/apps/webapp';
import { PageProps as AppPageProps } from '@/interfaces/apps/page';
import { ConfigService } from '@/services/ConfigService';
import { normalizeConfig } from '@/config/normalizer';
import { validateSecurityConfig } from '@/config/security-validator';
import { resolveAccess } from '@/config/access-resolver';

export type ConfigSource = 'backend' | 'demo' | 'example';
export type ConfigMode = 'published' | 'preview';

export interface UnifiedConfigParams {
  source: ConfigSource;
  appId: string;
  mode: ConfigMode;
  slugSegments?: string[];
}

export interface UnifiedConfigResult {
  config: WebAppProps;
  pageSlug: string;
  basePath: string;
  currentPage: AppPageProps | null;
}

const configCache = new Map<string, { result: UnifiedConfigResult; timestamp: number }>();
const CONFIG_CACHE_TTL = 30_000;

function getCacheKey(params: UnifiedConfigParams): string {
  return `${params.source}:${params.appId}:${params.mode}`;
}

function isDomainBasedRequest(): boolean {
  const root = document.getElementById('root');
  return root?.getAttribute('data-route-mode') === 'domain';
}

/**
 * Fetch and process config. Caches results in-memory per session.
 */
export async function getConfig(
  params: UnifiedConfigParams
): Promise<UnifiedConfigResult | null> {
  const cacheKey = getCacheKey(params);

  if (params.mode !== 'preview') {
    const cached = configCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CONFIG_CACHE_TTL) {
      return cached.result;
    }
  }

  const { source, appId, mode, slugSegments = [] } = params;

  try {
    let config: WebAppProps | null = null;
    let configPathDepth: number | undefined;

    if (source === 'example') {
      const result = await ConfigService.fetchExampleWithMeta(appId, slugSegments);
      if (result) {
        config = result.config;
        configPathDepth = result.configPathDepth;
      }
    } else {
      config = await ConfigService.fetch(appId, mode, {
        source,
        slugSegments,
      });
    }

    if (!config) {
      return null;
    }

    const result = buildConfigResult(config, params, configPathDepth);

    if (mode !== 'preview') {
      configCache.set(cacheKey, { result, timestamp: Date.now() });
    }

    return result;
  } catch (error) {
    // Preserve typed worker error codes (e.g. NOT_PUBLISHED) so AppLayout
    // can render a distinct state. The generic catch in AppLayout receives
    // the thrown error directly.
    const code = (error as Error & { code?: string })?.code;
    if (code) {
      throw error;
    }
    console.error(`[UnifiedConfig] Error fetching config:`, error);
    return null;
  }
}

/**
 * Synchronous config processing shared by `getConfig` (post-fetch) and
 * `getConfigSync` (worker-inlined). Normalizes, validates security, resolves
 * access, and computes the page slug / base path. Pure and synchronous so it
 * can run inside a React render lazy-initializer for a first-paint with no
 * network round trip.
 */
function buildConfigResult(
  config: WebAppProps,
  params: UnifiedConfigParams,
  configPathDepth?: number,
): UnifiedConfigResult {
  const { source, appId, mode, slugSegments = [] } = params;

  let resolved: WebAppProps = normalizeConfig(config) as WebAppProps;
  const securityValidation = validateSecurityConfig(resolved);
  if (securityValidation.errors.length) {
    console.error('[Auth] Security config errors:', securityValidation.errors);
  }
  const { config: resolvedConfig, roleExpansionMap } = resolveAccess(resolved);
  resolved = resolvedConfig as WebAppProps;
  if (Object.keys(roleExpansionMap).length > 0) {
    resolved = { ...resolved, _roleExpansionMap: roleExpansionMap } as WebAppProps;
  }

  const actualPath = calculateActualPath(source, appId, slugSegments, configPathDepth);
  const isDomainBased = isDomainBasedRequest();
  const { pageSlug, basePath } = calculatePaths(source, actualPath, slugSegments, mode, isDomainBased);
  const currentPage = findPageBySlug(resolved, pageSlug);

  return { config: resolved, pageSlug, basePath, currentPage };
}

/**
 * Read the published config the worker inlined into the HTML shell
 * (`<script type="application/json" id="__exepad_config">`). Present only for
 * PUBLIC published apps; absent for preview/auth-required apps and in local
 * dev, where callers fall back to the network path. Verified against the
 * shell's `data-app-id` so a stale/foreign blob is never trusted.
 */
export function readInlinedConfig(): WebAppProps | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById('__exepad_config');
  if (!el?.textContent) return null;
  try {
    const inlinedAppId = el.getAttribute('data-app-id');
    const rootAppId = document.getElementById('root')?.getAttribute('data-app-id');
    if (inlinedAppId && rootAppId && inlinedAppId !== rootAppId) return null;
    return JSON.parse(el.textContent) as WebAppProps;
  } catch {
    return null;
  }
}

/**
 * Synchronous config resolution from the worker-inlined blob — no network.
 * Returns a fully-processed result (and warms `configCache`, so the subsequent
 * async `getConfig` in AppLayout's effect resolves from cache without a fetch),
 * or null when no usable inlined config is present (preview, non-backend
 * source, or local dev) so the caller falls back to `getConfig`.
 */
export function getConfigSync(params: UnifiedConfigParams): UnifiedConfigResult | null {
  if (params.mode === 'preview' || params.source !== 'backend') return null;

  const cacheKey = getCacheKey(params);
  const cached = configCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CONFIG_CACHE_TTL) {
    return cached.result;
  }

  const inlined = readInlinedConfig();
  if (!inlined) return null;

  try {
    const result = buildConfigResult(inlined, params);
    configCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch (error) {
    console.warn('[UnifiedConfig] Failed to process inlined config:', error);
    return null;
  }
}

/**
 * Invalidate cached config for a given app (e.g., after a preview update).
 */
export function invalidateConfig(appId: string): void {
  for (const key of configCache.keys()) {
    if (key.includes(appId)) {
      configCache.delete(key);
    }
  }
}

// ============================================================================
// PATH CALCULATION HELPERS
// ============================================================================

function calculateActualPath(
  source: ConfigSource,
  appId: string,
  slugSegments: string[],
  configPathDepth?: number
): string[] {
  if (source === 'backend' || source === 'demo') {
    return [appId];
  }

  if (source === 'example' && configPathDepth !== undefined) {
    const fullPath = [appId, ...slugSegments];
    return fullPath.slice(0, configPathDepth);
  }

  return [appId, ...slugSegments];
}

function calculatePaths(
  source: ConfigSource,
  actualPath: string[],
  requestedSegments: string[],
  mode: ConfigMode,
  isDomainBased: boolean = false
): { pageSlug: string; basePath: string } {
  switch (source) {
    case 'backend': {
      const pageSlug = requestedSegments.length > 0
        ? `/${requestedSegments.join('/')}`
        : '/';

      if (isDomainBased) {
        return { pageSlug, basePath: '' };
      }

      const prefix = mode === 'preview' ? 'preview-' : '';
      const basePath = `/a/${prefix}${actualPath[0]}`;
      return { pageSlug, basePath };
    }

    case 'demo': {
      const pageSlug = requestedSegments.length > 0
        ? `/${requestedSegments.join('/')}`
        : '/';
      const basePath = `/demo/${actualPath[0]}`;
      return { pageSlug, basePath };
    }

    case 'example': {
      const fullPath = requestedSegments;
      const remainingSegments = fullPath.slice(actualPath.length - 1);

      const pageSlug = remainingSegments.length > 0
        ? `/${remainingSegments.join('/')}`
        : '/';
      const basePath = `/example/${actualPath.join('/')}`;

      return { pageSlug, basePath };
    }

    default:
      return { pageSlug: '/', basePath: '/' };
  }
}

function findPageBySlug(
  appConfig: WebAppProps,
  pageSlug: string
): AppPageProps | null {
  const normalizedSlug = normalizeSlug(pageSlug);
  const pages = appConfig.frontend?.pages;

  let page = pages?.find(
    (p: AppPageProps) => normalizeSlug(p.slug) === normalizedSlug
  );

  if (!page && normalizedSlug === '/') {
    page = pages?.[0];
  }

  if (!page && normalizedSlug === '/') {
    page = {
      uuid: 'empty-page-fallback',
      pageType: 'WebPageProps',
      title: appConfig.name || 'Home',
      slug: '/',
      summary: '',
      shortSummary: '',
      lastUpdatedEpoch: Date.now() / 1000,
      content: []
    } as AppPageProps;
  }

  return page || null;
}

function normalizeSlug(slug: string | undefined): string {
  if (!slug || slug === '') return '/';
  return slug.startsWith('/') ? slug : `/${slug}`;
}

export function parsePreviewMode(
  appId: string,
  searchParams?: Record<string, string | string[] | undefined>
): {
  isPreview: boolean;
  cleanAppId: string;
} {
  if (searchParams?.preview === 'true') {
    return { isPreview: true, cleanAppId: appId };
  }

  const PREVIEW_PREFIX = 'preview-';
  if (appId.startsWith(PREVIEW_PREFIX)) {
    const cleanAppId = appId.substring(PREVIEW_PREFIX.length);
    if (!cleanAppId || cleanAppId.length === 0) {
      return { isPreview: false, cleanAppId: appId };
    }
    return { isPreview: true, cleanAppId };
  }

  return { isPreview: false, cleanAppId: appId };
}

export function slugArrayToPath(slugSegments?: string[]): string {
  if (!slugSegments || slugSegments.length === 0) return '/';
  return `/${slugSegments.join('/')}`;
}
