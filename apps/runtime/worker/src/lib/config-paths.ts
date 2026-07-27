import type { DeploymentStatus } from '@exepad/types';

const APP_CONFIG_FILENAME = 'app-config.json';
const DEFAULT_PUBLISHED_CONFIG_PATH = `published/${APP_CONFIG_FILENAME}`;
const DEFAULT_PUBLISHED_PREFIX = 'published';

export function getDefaultPublishedConfigPath(): string {
  return DEFAULT_PUBLISHED_CONFIG_PATH;
}

export function getDefaultPublishedPrefix(): string {
  return DEFAULT_PUBLISHED_PREFIX;
}

export async function resolvePublishedConfigPath(
  r2: R2Bucket,
  appId: string,
): Promise<string> {
  const statusObj = await r2.get(`${appId}/deployment-status-published.json`);
  if (!statusObj) {
    return DEFAULT_PUBLISHED_CONFIG_PATH;
  }

  try {
    const status = (await statusObj.json()) as DeploymentStatus;
    return status.configPath || DEFAULT_PUBLISHED_CONFIG_PATH;
  } catch {
    return DEFAULT_PUBLISHED_CONFIG_PATH;
  }
}

export async function resolveConfigKey(
  r2: R2Bucket,
  appId: string,
  mode: 'preview' | 'published',
): Promise<string | null> {
  if (mode === 'preview') {
    const statusObj = await r2.get(`${appId}/deployment-status-preview.json`);
    if (statusObj) {
      try {
        const status = (await statusObj.json()) as DeploymentStatus;
        if (status.configPath) {
          return `${appId}/${status.configPath}`;
        }
      } catch {
        // fall through to published fallback
      }
    }

    const publishedConfigPath = await resolvePublishedConfigPath(r2, appId);
    return `${appId}/${publishedConfigPath}`;
  }

  const publishedConfigPath = await resolvePublishedConfigPath(r2, appId);
  return `${appId}/${publishedConfigPath}`;
}

export async function resolvePublishedPrefix(
  r2: R2Bucket,
  appId: string,
): Promise<string> {
  const configPath = await resolvePublishedConfigPath(r2, appId);
  if (!configPath.endsWith(`/${APP_CONFIG_FILENAME}`)) {
    return DEFAULT_PUBLISHED_PREFIX;
  }

  return configPath.slice(0, -(`/${APP_CONFIG_FILENAME}`).length) || DEFAULT_PUBLISHED_PREFIX;
}

export async function resolveSeoSnapshotKey(
  r2: R2Bucket,
  appId: string,
  pageSlug: string,
): Promise<string> {
  const slug = pageSlug === '/' ? 'index' : pageSlug.replace(/^\//, '').replace(/\//g, '_');
  const publishedPrefix = await resolvePublishedPrefix(r2, appId);
  return `${appId}/${publishedPrefix}/seo/${slug}.html`;
}

/**
 * Storage key for a page's Stage-1 prerender artifact (hydration-correct `#root`
 * HTML), mirroring the SEO snapshot key under the same release prefix. The
 * sibling `.modules.json` (same key, `.html`→`.modules.json`) lists the
 * first-fold component URLs the client primes before hydrating.
 */
export async function resolvePrerenderKey(
  r2: R2Bucket,
  appId: string,
  pageSlug: string,
): Promise<string> {
  const slug = pageSlug === '/' ? 'index' : pageSlug.replace(/^\//, '').replace(/\//g, '_');
  const publishedPrefix = await resolvePublishedPrefix(r2, appId);
  return `${appId}/${publishedPrefix}/prerender/${slug}.html`;
}

