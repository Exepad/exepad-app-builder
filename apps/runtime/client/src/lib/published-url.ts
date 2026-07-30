/**
 * Resolve the canonical, public absolute URL for a published (or preview) app
 * from the relative path the worker emits (`/a/<alias>/`).
 *
 * The worker returns `publishedUrl`/`previewUrl` as relative paths so they carry
 * no scheme or host. Naively resolving them against `window.location.origin`
 * inherits whatever the Studio itself was loaded on — e.g. `http://localhost` or
 * a dev/worker port like `http://localhost:8080` — which is NOT the URL an
 * operator shares. A published app is reached through the front proxy on the
 * standard HTTPS port, so the canonical live URL is `https://<host>/a/<alias>`
 * with no port, mirroring the custom-domain path which already hardcodes https.
 *
 * Absolute URLs (custom domains, tunnel URLs) are already canonical and pass
 * through untouched.
 */
export function resolvePublishedAppUrl(path: string): string;
export function resolvePublishedAppUrl(path: null | undefined): null | undefined;
export function resolvePublishedAppUrl(
  path: string | null | undefined,
): string | null | undefined;
export function resolvePublishedAppUrl(
  path: string | null | undefined,
): string | null | undefined {
  if (!path) return path;
  // Already absolute (custom domain / tunnel) — leave as-is.
  if (/^https?:\/\//i.test(path)) return path;
  if (typeof window === 'undefined' || !window.location?.origin) return path;
  try {
    const url = new URL(path, window.location.origin);
    url.protocol = 'https:';
    url.port = '';
    return url.toString();
  } catch {
    return path;
  }
}
