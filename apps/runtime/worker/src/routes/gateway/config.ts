/**
 * Gateway — Config loading and caching
 *
 * Uses the same mode-aware TTL strategy as lib/app-config.ts:
 * - Published: 60s in-memory, 5min CF Cache API
 * - Preview: 10s in-memory, 30s CF Cache API
 * Config invalidation is triggered by deploy.ts after successful deploys.
 */

import type { DeploymentStatus } from '@exepad/types';
import type { Env } from '../../types/env';
import type { AppConfig } from './types';
import { resolveConfigKey } from '../../lib/config-paths';
import { getDefaultCache } from '../../lib/runtime-context';

// Mode-aware in-memory TTLs
const PUBLISHED_CACHE_TTL = 60_000;  // 60s
const PREVIEW_CACHE_TTL = 10_000;    // 10s
const NULL_CACHE_TTL = 10_000;       // 10s

// CF Cache API TTLs (seconds for Cache-Control)
const PUBLISHED_CF_CACHE_TTL = 300;  // 5 min
const PREVIEW_CF_CACHE_TTL = 30;     // 30s

// ─── Config caches ──────────────────────────────────────────────────────────

export const configCache = new Map<string, { config: AppConfig | null; timestamp: number }>();
export const exampleConfigCache = new Map<string, { config: AppConfig | null; timestamp: number }>();

/**
 * Invalidate gateway config cache for an app+mode. Call after deploy.
 * Purges both the per-isolate in-memory map AND the CF Cache API entry (PoP-scoped),
 * so other isolates stop serving a stale positive config from before the re-deploy.
 */
export async function invalidateGatewayConfig(appId: string, mode: string): Promise<void> {
  const cacheKey = `${appId}:${mode}`;
  configCache.delete(cacheKey);
  try {
    const cacheApi = getDefaultCache();
    if (cacheApi) {
      await cacheApi.delete(cfCacheUrl(cacheKey));
    }
  } catch {
    // Cache API unavailable — no-op
  }
}

function cfCacheUrl(cacheKey: string): Request {
  return new Request(`https://exepad-gw-config-cache.internal/${cacheKey}`);
}

// ─── R2 config loading ─────────────────────────────────────────────────────

export async function getLatestPreviewConfigPath(
  appId: string,
  env: Env,
): Promise<string | null> {
  const statusKey = `${appId}/deployment-status-preview.json`;
  const statusObj = await env.CONFIG_CACHE.get(statusKey);
  if (!statusObj) return null;
  const status = (await statusObj.json()) as DeploymentStatus;
  return status?.configPath ?? null;
}

export async function loadAppConfig(
  appId: string,
  mode: string,
  env: Env,
): Promise<AppConfig | null> {
  const cacheKey = `${appId}:${mode}`;

  // ── Layer 1: In-memory cache ──
  const cached = configCache.get(cacheKey);
  if (cached) {
    const ttl = cached.config === null
      ? NULL_CACHE_TTL
      : mode === 'preview' ? PREVIEW_CACHE_TTL : PUBLISHED_CACHE_TTL;
    if (Date.now() - cached.timestamp < ttl) {
      return cached.config;
    }
  }

  // ── Layer 2: CF Cache API ──
  try {
    const cacheApi = getDefaultCache();
    const cfCached = cacheApi ? await cacheApi.match(cfCacheUrl(cacheKey)) : undefined;
    if (cfCached) {
      const config = (await cfCached.json()) as AppConfig | null;
      configCache.set(cacheKey, { config, timestamp: Date.now() });
      return config;
    }
  } catch {
    // Cache API unavailable (local dev) — fall through
  }

  // ── Layer 3: R2 ──
  try {
    const normalizedMode = mode === 'preview' ? 'preview' : 'published';
    const configKey = await resolveConfigKey(env.CONFIG_CACHE, appId, normalizedMode);

    if (!configKey) {
      // Don't cache null for preview — deploy may still be in progress
      if (mode !== 'preview') {
        configCache.set(cacheKey, { config: null, timestamp: Date.now() });
      }
      return null;
    }

    const object = await env.CONFIG_CACHE.get(configKey);
    if (!object) {
      if (mode !== 'preview') {
        configCache.set(cacheKey, { config: null, timestamp: Date.now() });
      }
      return null;
    }

    const config = (await object.json()) as AppConfig;
    configCache.set(cacheKey, { config, timestamp: Date.now() });

    // Populate CF Cache API (non-blocking, best-effort)
    try {
      const cacheApi = getDefaultCache();
      if (!cacheApi) return config;
      const cfTtl = mode === 'preview' ? PREVIEW_CF_CACHE_TTL : PUBLISHED_CF_CACHE_TTL;
      const cfResponse = new Response(JSON.stringify(config), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${cfTtl}` },
      });
      cacheApi.put(cfCacheUrl(cacheKey), cfResponse).catch(() => {});
    } catch {
      // no-op
    }

    return config;
  } catch (error) {
    console.error(`[API Gateway] Failed to load config for ${appId} (${mode}):`, error);
    return null;
  }
}

// ─── Full config loading (returns complete WebAppProps, not just backend slice) ─

/**
 * Load full app config from R2 as a raw Response body (avoids parse + re-serialize).
 * Returns the R2ObjectBody and ETag for conditional responses.
 */
export async function loadFullAppConfigBody(
  appId: string,
  mode: string,
  env: Env,
): Promise<{ body: ReadableStream; etag: string } | null> {
  try {
    const normalizedMode = mode === 'preview' ? 'preview' : 'published';
    const configKey = await resolveConfigKey(env.CONFIG_CACHE, appId, normalizedMode);

    if (!configKey) return null;
    const object = await env.CONFIG_CACHE.get(configKey);
    if (!object) return null;
    return { body: object.body, etag: object.etag };
  } catch (error) {
    console.error(`[API Gateway] Failed to load full config for ${appId} (${mode}):`, error);
    return null;
  }
}

// ─── Example app config loading (local dev fallback) ──────────────────────

export async function loadExampleConfig(appId: string, env: Env): Promise<AppConfig | null> {
  if (!env.ASSETS) return null;

  const cached = exampleConfigCache.get(appId);
  if (cached && Date.now() - cached.timestamp < PUBLISHED_CACHE_TTL) return cached.config;

  // Example apps use underscores in directory names, appId uses hyphens
  const dirName = appId.replace(/-/g, '_');
  const paths = [
    `/example/examples_for_agents/full_apps/${dirName}/app_config.json`,
    `/example/${dirName}/app_config.json`,
  ];
  for (const p of paths) {
    try {
      const resp = await env.ASSETS.fetch(new Request(`http://placeholder${p}`));
      if (resp.ok) {
        const config = (await resp.json()) as AppConfig;
        exampleConfigCache.set(appId, { config, timestamp: Date.now() });
        return config;
      }
    } catch (err) {
      console.debug(`[Gateway] Example config load failed for ${p}:`, err instanceof Error ? err.message : String(err));
    }
  }
  exampleConfigCache.set(appId, { config: null, timestamp: Date.now() });
  return null;
}
