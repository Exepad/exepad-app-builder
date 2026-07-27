interface CapturedImage {
  originalUrl: string;
  r2Key: string;
  r2Url: string;
  contentHash: string;
  size: number;
  contentType: string;
}

interface CaptureResult {
  captured: CapturedImage[];
  failed: { url: string; error: string }[];
  rewrittenConfig: Record<string, unknown>;
}

const MAX_CONCURRENCY = 10;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

const IMAGE_EXTENSION_RE = /\.(jpe?g|png|webp|svg|gif|avif|bmp|tiff?)(?:[?#]|$)/i;
const IMAGE_HOST_RE =
  /unsplash\.com|pexels\.com|pixabay\.com|api\.openverse\.org|pravatar\.cc|images\.unsplash\.com/i;

export function extractImageUrls(config: Record<string, unknown>): Map<string, string[]> {
  const urlMap = new Map<string, string[]>();

  function walk(value: unknown, path: string): void {
    if (value === null || value === undefined) return;

    if (typeof value === 'string') {
      if (isExternalImageUrl(value)) {
        const existing = urlMap.get(value);
        if (existing) {
          existing.push(path);
        } else {
          urlMap.set(value, [path]);
        }
      }
      return;
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], `${path}[${i}]`);
      }
      return;
    }

    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        walk(child, path ? `${path}.${key}` : key);
      }
    }
  }

  walk(config, '');
  return urlMap;
}

function isExternalImageUrl(value: string): boolean {
  if (value.startsWith('data:')) return false;
  if (value.startsWith('blob:')) return false;
  if (value.includes('/published/assets/')) return false;
  if (!value.startsWith('http://') && !value.startsWith('https://')) return false;
  if (IMAGE_HOST_RE.test(value)) return true;
  if (IMAGE_EXTENSION_RE.test(value)) return true;
  return false;
}

export async function captureAndRewriteImages(
  r2: R2Bucket,
  appId: string,
  config: Record<string, unknown>,
): Promise<CaptureResult> {
  const urlMap = extractImageUrls(config);
  const captured: CapturedImage[] = [];
  const failed: { url: string; error: string }[] = [];
  const uniqueUrls = Array.from(urlMap.keys());
  const rewriteMap = new Map<string, string>();

  for (let i = 0; i < uniqueUrls.length; i += MAX_CONCURRENCY) {
    const batch = uniqueUrls.slice(i, i + MAX_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((url) => captureOneImage(r2, appId, url))
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const url = batch[j];

      if (result.status === 'fulfilled' && result.value) {
        captured.push(result.value);
        rewriteMap.set(url, result.value.r2Url);
      } else {
        const error = result.status === 'rejected'
          ? (result.reason instanceof Error ? result.reason.message : String(result.reason))
          : 'Unknown error';
        failed.push({ url, error });
        console.warn(`[image-capture] Failed to capture ${url}: ${error}`);
      }
    }
  }

  const rewrittenConfig = rewriteUrls(config, rewriteMap);
  return { captured, failed, rewrittenConfig };
}

async function captureOneImage(
  r2: R2Bucket,
  appId: string,
  url: string,
): Promise<CapturedImage | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ExepadDeployBot/1.0' },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Timeout after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
    console.warn(`[image-capture] Skipping ${url}: size ${contentLength} exceeds ${MAX_IMAGE_SIZE} limit`);
    return null;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.byteLength;
      if (totalSize > MAX_IMAGE_SIZE) {
        reader.cancel();
        console.warn(`[image-capture] Skipping ${url}: streaming size ${totalSize} exceeds ${MAX_IMAGE_SIZE} limit`);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const imageBytes = new Uint8Array(totalSize);
  let bufferOffset = 0;
  for (const chunk of chunks) {
    imageBytes.set(chunk, bufferOffset);
    bufferOffset += chunk.byteLength;
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
  const ext = CONTENT_TYPE_EXT[contentType] || extFromUrl(url) || 'jpg';

  const hashBuffer = await crypto.subtle.digest('SHA-256', imageBytes);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);

  const r2Key = `${appId}/published/assets/img_${hashHex}.${ext}`;
  const r2Url = `/published/assets/img_${hashHex}.${ext}`;

  await r2.put(r2Key, imageBytes.buffer as ArrayBuffer, {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  return {
    originalUrl: url,
    r2Key,
    r2Url,
    contentHash: hashHex,
    size: imageBytes.byteLength,
    contentType,
  };
}

function extFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.(\w+)$/);
    if (match) {
      const ext = match[1].toLowerCase();
      return ext === 'jpeg' ? 'jpg' : ext;
    }
  } catch {
    // Malformed URLs are silently ignored
  }
  return null;
}

function rewriteUrls(
  config: Record<string, unknown>,
  rewriteMap: Map<string, string>,
): Record<string, unknown> {
  if (rewriteMap.size === 0) return config;

  function rewrite(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return rewriteMap.get(value) ?? value;
    if (Array.isArray(value)) return value.map(rewrite);
    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        result[key] = rewrite(child);
      }
      return result;
    }
    return value;
  }

  return rewrite(config) as Record<string, unknown>;
}
