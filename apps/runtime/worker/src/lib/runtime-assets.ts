/**
 * Static-asset path classification + cache headers for the SPA's own bundle.
 *
 * Used by the index.ts catch-all to decide whether a request is a built runtime
 * asset (served from disk) vs an SPA route (served index.html), and to set
 * immutable cache headers on content-hashed bundles.
 */
const RUNTIME_STATIC_PREFIXES = [
  '/assets/',
  '/runtime_assets/',
  '/cdn-cgi/',
];

const RUNTIME_STATIC_FILES = new Set([
  '/favicon.svg',
  '/favicon.ico',
]);

const RUNTIME_STATIC_EXTENSIONS = new Set([
  'avif',
  'css',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'js',
  'json',
  'map',
  'mjs',
  'otf',
  'png',
  'svg',
  'ttf',
  'wasm',
  'webp',
  'woff',
  'woff2',
]);

function extensionFromPath(pathname: string): string | null {
  const lastSegment = pathname.split('/').pop() || '';
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) {
    return null;
  }
  return lastSegment.slice(dotIndex + 1).toLowerCase();
}

export function isRuntimeStaticAssetPath(pathname: string): boolean {
  if (RUNTIME_STATIC_FILES.has(pathname)) {
    return true;
  }

  if (RUNTIME_STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }

  // App-captured images live in storage under this app-scoped namespace — those
  // are served by the per-app asset handler, not the runtime static path.
  if (
    pathname.startsWith('/published/assets/') ||
    /^\/a\/(?:preview-)?[^/]+\/published\/assets\//.test(pathname)
  ) {
    return false;
  }

  const extension = extensionFromPath(pathname);
  return extension ? RUNTIME_STATIC_EXTENSIONS.has(extension) : false;
}

// Vite (and the SDK build) emit content-hashed filenames like
// `index-sT4FfsZb.js` / `ClientPageRenderer-BX-LvDyr.js`. A hash segment is a
// trailing `-<token>.<ext>` where the token is ≥6 chars of base64url. Such files
// are immutable by construction (a content change yields a new name), so they
// can be cached forever. Fixed-name files in the same dir (exepad-sdk.js,
// react-shim.js) are NOT hashed and must keep revalidating across rebuilds.
const CONTENT_HASHED_ASSET_RE = /-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/i;

// Fixed-name (NON-content-hashed) bundles that the SDK/runtime build overwrites
// in place on every rebuild: the barrel `exepad-sdk.js`, its subpath bundles
// (`exepad-sdk-core.js`, `-icons`, `-charts`, `-forms`, `-motion`,
// `-overlays`), and the `react-shim.js` shim. Their names are dictionary words
// joined by hyphens, which TRIPS `CONTENT_HASHED_ASSET_RE` — its hash class
// includes `-`, so `-sdk-core` (8 chars) reads as a hash token and the file
// gets wrongly pinned `immutable`. A browser that cached the old bundle would
// then NEVER receive an SDK fix (observed live 2026-06-22: a SelectItem fix
// couldn't reach a warm cache). Match these FIRST so they always revalidate.
//
// The segments are constrained to lowercase words (`(-[a-z]+)*`) so a real
// content-hashed chunk that happens to start with the same prefix — e.g.
// `exepad-sdk-core-BX-LvDyr.js` (mixed-case/digit hash) — does NOT match here
// and still falls through to the immutable rule.
const STABLE_BUNDLE_BASENAME_RE = /^(?:exepad-sdk|react-shim)(?:-[a-z]+)*\.[a-z0-9]+$/;

/**
 * Cache-Control for a runtime static asset, or null to leave the default
 * untouched. Content-hashed assets under `/assets/` and `/runtime_assets/dist/`
 * are immutable; fixed-name SDK/shim bundles get a short revalidating TTL so
 * SDK rebuilds still propagate to already-cached browsers.
 */
export function cacheControlForRuntimeAsset(pathname: string): string | null {
  const isAssets = pathname.startsWith('/assets/');
  const isRuntimeDist = pathname.startsWith('/runtime_assets/dist/');
  if (!isAssets && !isRuntimeDist) return null;

  const basename = pathname.split('/').pop() || '';
  // Fixed-name bundles must revalidate even though they superficially resemble
  // a hashed chunk — checked before CONTENT_HASHED_ASSET_RE.
  if (STABLE_BUNDLE_BASENAME_RE.test(basename)) {
    return 'public, max-age=3600, must-revalidate';
  }

  if (CONTENT_HASHED_ASSET_RE.test(pathname)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=3600, must-revalidate';
}
