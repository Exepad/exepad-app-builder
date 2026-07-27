import type { Context } from 'hono';
import type { Env } from '../types/env';
import { type AppConfig, extractAppId, extractPageSlug, loadAppConfig, escapeHtml, isAuthRequired } from './app-config';
import { resolveSeoSnapshotKey, resolvePrerenderKey } from './config-paths';
import { PREVIEW_ACCESS_TTL_SECONDS, resolveGatewayIdentity } from '../routes/gateway/auth';
import { getExecutionContext } from './runtime-context';
import { isSingleAppMode, singleAppId } from './single-app';
import { resolveHostMapping, isWholeStudioCustomHost } from './custom-domains';
import { sourceOfferUrl } from './source-offer';

function isPreviewRoute(pathname: string): boolean {
  return /^\/a\/preview-/.test(pathname);
}

function findPage(config: AppConfig, slug: string) {
  return config.frontend?.pages?.find(p => p.slug === slug);
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function isInternalRuntimeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.workers.dev') ||
    host === 'exepad.com' ||
    host === 'app.exepad.com' ||
    host.endsWith('.exepad.com')
  );
}

function resolveRouteMode(requestUrl: URL): 'domain' | 'path' {
  // A literal `/a/<appId>/…` request is intrinsically path-based, whatever host
  // it arrived on. Self-host is reached via arbitrary hosts (LAN IP, a custom
  // self-host domain) that the `isInternalRuntimeHost` allowlist below cannot
  // enumerate; without this shortcut such a host is misread as `domain`, which
  // makes the SPA use `basePath=''` and request `/repo/*` with no `/a/<appId>`
  // prefix. On the cloud an external router rewrites those prefix-less requests
  // and supplies `x-exepad-app-id`; self-host has no such router, so every
  // component + stylesheet 404s and each section renders the "not available"
  // placeholder. Genuine cloud app domains keep the hostname-based decision:
  // `*.exepad.app` subdomain apps are served from the host root and must stay
  // `domain`, so they are excluded from the path shortcut.
  if (!isExepadCloudHost(requestUrl.hostname) && /^\/a\/[^/]+/.test(requestUrl.pathname)) {
    return 'path';
  }
  // A self-serve custom domain mapped to the WHOLE studio serves apps under
  // /a/{id}/ just like an internal host — keep it in 'path' mode so the bare
  // root and per-app paths resolve their assets correctly (a single-app custom
  // domain is forced to 'domain' separately, in injectMeta).
  if (isWholeStudioCustomHost(requestUrl.hostname)) {
    return 'path';
  }
  return isInternalRuntimeHost(requestUrl.hostname) ? 'path' : 'domain';
}

/**
 * Build the Set-Cookie header pair for `__exepad_pa`. Two headers: the fresh
 * broad-Path cookie, plus a clear for any legacy narrow-Path cookie that may
 * still be lingering (RFC 6265 orders more-specific-Path first on refresh).
 *
 * Shared between the initial meta-injector render and the /__refresh route so
 * cookie attributes (Path, Max-Age, HttpOnly, Secure, SameSite) stay in one
 * place and can never drift.
 */
export function buildPreviewAccessCookieHeaders(
  token: string,
  appId: string,
  req?: Request,
): string[] {
  // `Secure` only when explicitly enabled OR the request arrived over HTTPS —
  // a Secure cookie is dropped by the browser over plain HTTP (the default
  // self-host case, http://localhost:8080), which would silently break preview
  // auth. HTTPS is detected from the env flag, a TLS-terminating proxy header
  // (X-Forwarded-Proto), or the request URL's own scheme. Matches the
  // platform-session cookie behavior in routes/auth.ts.
  const isSecure =
    process.env.EXEPAD_COOKIE_SECURE === '1' ||
    req?.headers.get('x-forwarded-proto') === 'https' ||
    (req ? new URL(req.url).protocol === 'https:' : false);
  const secure = isSecure ? '; Secure' : '';
  return [
    `__exepad_pa=${encodeURIComponent(token)}; Path=/; Max-Age=${PREVIEW_ACCESS_TTL_SECONDS}; HttpOnly${secure}; SameSite=Lax`,
    `__exepad_pa=; Path=/a/preview-${appId}/; Max-Age=0; HttpOnly${secure}; SameSite=Lax`,
  ];
}

/**
 * Strip build-time-only Tailwind v4 directives before inlining compiled CSS
 * into the live document. Mirrors `CodeFocusCssLoader.stripBuildTimeCssDirectives`
 * in the client exactly, so the server-inlined CSS matches what the client
 * would otherwise inject. `repo.frontend.styles.theme` carries the raw theme.css
 * (bare `@import "tailwindcss"` / `@source "..."`); left intact the browser
 * resolves those bare specifiers against the page URL and 404s. URL/relative
 * `@import`s are preserved.
 */
function stripBuildTimeCssDirectives(css: string): string {
  return css
    .replace(/^[ \t]*@source\b[^;]*;[ \t]*$\n?/gim, '')
    .replace(/^[ \t]*@import\s+["']([^"']+)["'][^;]*;[ \t]*$\n?/gim, (match, spec) =>
      /^(?:url\(|https?:|\.{0,2}\/)/i.test(String(spec).trim()) ? match : '',
    );
}

const SSR_CSS_STYLE_ID = 'exepad-codefocus-css-ssr';
const SSR_CSS_ROOT_VARS_ID = 'exepad-codefocus-root-vars-ssr';
// Keep the inlined sheet bounded — pathologically large compiled CSS keeps the
// post-mount fetch path (CodeFocusCssLoader) rather than bloating every byte of
// HTML. ~200KB raw (~25-30KB gzipped) comfortably covers a real purged app
// sheet (this app's is ~51KB raw) while capping the worst case.
const SSR_CSS_MAX_BYTES = 200_000;

/**
 * Read the app's compiled Tailwind sheets (`repo.frontend.styles[*].compiled`)
 * from storage and return a render-blocking `<style>` block to inline in
 * `<head>`.
 *
 * This moves the app CSS from a post-mount client fetch (CodeFocusCssLoader)
 * into the initial HTML, so the first paint is already styled. It removes the
 * single largest CLS source — components mounting unstyled and reflowing when
 * the CSS finally arrives — and takes a render-affecting request off the LCP
 * critical path. The client loader detects this `<style>` by id and skips its
 * own fetch + re-inject (so the CSS is parsed exactly once).
 *
 * Best-effort: returns '' on any miss (bad path, oversized, R2 error) so the
 * client transparently falls back to fetching.
 */
// Per-config-object memo for the inlined app-CSS `<style>` fragment. Building it
// reads EVERY compiled Tailwind sheet (up to SSR_CSS_MAX_BYTES) off disk and runs
// several full-sheet regex passes — repeated on every HTML request for the same
// warm config. Those inputs (the compiled sheets) change ONLY on deploy, and a
// deploy invalidates the config cache so loadAppConfig then hands back a NEW
// config OBJECT. Keying the memo on config identity therefore rebuilds exactly
// once per deploy with NO cross-module invalidation, and can never serve CSS from
// a superseded config. Only successful (non-empty) results are cached, so a
// transient disk/R2 miss simply retries on the next request instead of being
// pinned as empty for the config's lifetime.
const inlineAppCssByConfig = new WeakMap<object, string>();

async function buildInlineAppCss(
  config: AppConfig | null,
  appId: string,
  env: Env,
): Promise<string> {
  if (config) {
    const memo = inlineAppCssByConfig.get(config);
    if (memo !== undefined) return memo;
  }
  const built = await buildInlineAppCssUncached(config, appId, env);
  // Cache only a real, non-empty result (an empty string means "fall back to the
  // client fetch" — often a transient miss we don't want to pin).
  if (config && built) inlineAppCssByConfig.set(config, built);
  return built;
}

async function buildInlineAppCssUncached(
  config: AppConfig | null,
  appId: string,
  env: Env,
): Promise<string> {
  const styles = (
    config as { repo?: { frontend?: { styles?: Record<string, { compiled?: string }> } } } | null
  )?.repo?.frontend?.styles;
  if (!styles || typeof styles !== 'object') return '';

  const compiledPaths = Object.values(styles)
    .map((s) => s?.compiled)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (compiledPaths.length === 0) return '';

  try {
    const sheets = await Promise.all(
      compiledPaths.map(async (compiled) => {
        const obj = await env.CONFIG_CACHE.get(`${appId}/${compiled}`);
        return obj ? await obj.text() : '';
      }),
    );
    let joined = sheets.map(stripBuildTimeCssDirectives).join('\n');
    if (!joined.trim() || joined.length > SSR_CSS_MAX_BYTES) return '';

    // Defuse any literal `</style>` / `</script>` token in the CSS so it can't
    // close the inline element early. `\/` is a valid CSS escape for `/`, so
    // this never changes the rendered styles. Compiled Tailwind won't contain
    // these, but user `content:` strings theoretically could.
    joined = joined.replace(/<\/(style|script)/gi, '<\\/$1');

    let out = `\n    <style id="${SSR_CSS_STYLE_ID}">${joined}</style>`;

    // Mirror the client loader: re-publish the first `:root { … }` block
    // unlayered so design tokens win over any `@layer`-wrapped `:root` in the
    // compiled sheet.
    const rootMatch = joined.match(/:root\s*\{([^}]+)\}/);
    if (rootMatch) {
      out += `\n    <style id="${SSR_CSS_ROOT_VARS_ID}">:root { ${rootMatch[1]} }</style>`;
    }
    return out;
  } catch {
    return '';
  }
}

const SEO_SNAPSHOT_HIDDEN_STYLE = [
  'position:absolute',
  'width:1px',
  'height:1px',
  'padding:0',
  'margin:-1px',
  'overflow:hidden',
  'clip:rect(0, 0, 0, 0)',
  'clip-path:inset(50%)',
  'white-space:nowrap',
  'border:0',
].join(';');

/**
 * Extract `<link rel="stylesheet" href="/assets/...">` tags from the SPA's
 * built index.html. The runtime SPA's Vite bundle contains every Tailwind
 * class used in the SPA source (including the gate markup below, which
 * mirrors the in-SPA React gate at PreviewPage.tsx:254-281), so linking to
 * this bundle guarantees the gate renders with real styles — unlike the
 * per-app compiled.css, whose class inventory is purged against user
 * components and varies per app.
 *
 * Cached at module scope: the SPA bundle hash doesn't change within a worker
 * isolate's lifetime, so we only regex-scan once.
 */
let _cachedSpaStylesheets: string[] | null = null;

export function extractSpaStylesheets(indexHtml: string): string[] {
  const matches = indexHtml.match(/<link\b[^>]*rel="stylesheet"[^>]*href="\/assets\/[^"]+"[^>]*>/g);
  return matches ? matches : [];
}

async function getSpaStylesheets(env: Env, requestUrl: string): Promise<string[]> {
  if (_cachedSpaStylesheets !== null) return _cachedSpaStylesheets;
  try {
    const indexReq = new Request(new URL('/index.html', requestUrl).toString());
    const resp = await env.ASSETS.fetch(indexReq);
    if (!resp.ok) return [];
    const html = await resp.text();
    _cachedSpaStylesheets = extractSpaStylesheets(html);
    return _cachedSpaStylesheets;
  } catch {
    return [];
  }
}

/**
 * Build the "Authentication Required" page served for unauthenticated preview
 * requests. Links to the runtime SPA's own bundled stylesheet (not per-app
 * compiled.css) so the gate renders with the same Tailwind classes the SPA
 * itself uses — mirroring `client/src/core/preview/PreviewPage.tsx:254-281`.
 *
 * The page intentionally does NOT include a "Go to Login" button or any
 * auto-redirect script: when the gate is rendered inside the Agent editor's
 * `<iframe>`, any navigation to app.exepad.com/signin loads the Agent
 * dashboard INSIDE the preview iframe (an "iframe-resident-dashboard" loop).
 * Re-auth is handled silently by the parent keep-alive loop in
 * `app-preview-panel.tsx`, so the gate is purely informational.
 */
function buildUnauthorizedPreviewHtml(
  _appId: string,
  _requestUrl: URL,
  nonce: string | undefined,
  spaStylesheets: string[],
): string {
  const nonceAttr = nonce ? ` nonce="${escapeHtml(nonce)}"` : '';
  const styleLinks = spaStylesheets.join('\n    ');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Authentication Required</title>
    ${styleLinks}
    <style${nonceAttr}>
      html, body { margin: 0; padding: 0; min-height: 100%; }
      body { font-family: system-ui, -apple-system, sans-serif; }
    </style>
  </head>
  <body>
    <div class="fixed inset-0 z-[100] flex items-center justify-center bg-background px-4 py-8">
      <div class="w-full max-w-md">
        <div class="bg-card text-card-foreground flex flex-col gap-6 rounded-2xl border-0 py-6 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.08)]">
          <div class="px-6 text-center">
            <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <svg width="28" height="28" class="h-7 w-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 class="text-2xl font-semibold text-foreground">Authentication Required</h1>
            <p class="mt-1.5 text-sm text-muted-foreground">
              Preview mode requires authentication. Your session will refresh automatically&mdash;if this message stays, reload the editor.
            </p>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

/**
 * True for actual Exepad cloud hostnames (where the canonical/og:url should
 * point at the `{appId}.exepad.app` published domain). Distinct from
 * `isInternalRuntimeHost`, which also matches localhost / *.local / a custom
 * self-host domain — for those, the canonical base must stay same-origin.
 */
function isExepadCloudHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host.endsWith('exepad.com') || host.endsWith('exepad.app');
}

/**
 * Rewrite an absolute Exepad-cloud asset URL (e.g. a hero image baked into a
 * compiled component as `https://{appId}.exepad.app/published/assets/img_…jpg`)
 * to a same-origin self-host path (`/a/{appId}/published/assets/img_…jpg`).
 *
 * Compiled artifacts deployed while the app lived on Exepad cloud can carry
 * absolute cloud URLs. Emitting those verbatim in a self-host preload hint
 * sends the browser cross-origin to a domain the deployment doesn't own — the
 * asset never loads and the preconnect/preload is wasted. On a genuine cloud
 * host we leave the URL untouched.
 */
function rewriteSelfHostAssetUrl(
  assetUrl: string | null,
  appId: string,
  requestUrl: URL,
): string | null {
  if (!assetUrl) return assetUrl;
  if (isExepadCloudHost(requestUrl.hostname)) return assetUrl;
  let parsed: URL;
  try {
    parsed = new URL(assetUrl);
  } catch {
    return assetUrl; // already relative / unparseable — leave as-is
  }
  if (!/^https?:$/.test(parsed.protocol) || !isExepadCloudHost(parsed.hostname)) {
    return assetUrl;
  }
  const path = parsed.pathname.replace(/^\//, '');
  // Cloud per-app asset paths (published/assets/…, repo/…) are served on
  // self-host under the /a/{appId}/ prefix.
  return `/a/${appId}/${path}${parsed.search}`;
}

export function resolveCanonicalBase(config: AppConfig | null, appId: string, requestUrl: URL): string {
  const configuredUrl = config?.frontend?.metadata?.openGraph?.url;
  if (configuredUrl) {
    return normalizeBaseUrl(configuredUrl);
  }

  // The `{appId}.exepad.app` fallback only makes sense on Exepad cloud — for any
  // other host (custom self-host domain, LAN IP, localhost) use same-origin so
  // canonical/og:url don't point at a domain the deployment doesn't own.
  if (!isExepadCloudHost(requestUrl.hostname)) {
    return normalizeBaseUrl(requestUrl.origin);
  }

  return `https://${appId}.exepad.app`;
}

/**
 * Extract the LCP candidate image URL for the current page by reading the
 * compiled JS of the first code component referenced from the page config.
 *
 * This runs at HTML-render time, fetching exactly one compiled component
 * from R2 via the CONFIG_CACHE binding (~10-20ms direct read). The extracted
 * URL is emitted as a `<link rel="preload" as="image" fetchpriority="high">`
 * in the head so the browser starts downloading the hero image in parallel
 * with JS parsing — the single biggest Core Web Vitals win for Code Focus
 * apps, where dynamic `import()` of code components otherwise hides image
 * `src` attributes from the preload scanner for 5-7 seconds.
 *
 * Returns the first image URL found in the compiled JS, or null if:
 *  - the page has no components, or
 *  - the compiled path can't be resolved from config.repo, or
 *  - the R2 object is missing, or
 *  - no image URL is found in the compiled source.
 */
const _IMAGE_URL_EXTRACT_RE =
  /["'](\/a\/[^"']*?\.(?:jpg|jpeg|png|webp|avif|gif)(?:\?[^"']*)?)["']|["'](https?:\/\/[^"']*?\.(?:jpg|jpeg|png|webp|avif|gif)(?:\?[^"']*)?)["']/i;

// Extensionless image URLs from the placeholder / image-CDN services the agent
// uses for generated hero imagery (picsum, unsplash, …). These carry no file
// extension, so the extension regex above misses them — yet they are frequently
// the LCP element, and because the URL is buried in a dynamically-imported code
// component, their LCP "Load Delay" dominates (~3s of not-yet-started) until the
// CSR boot parses the component. Catching them lets the preload start the
// download from the HTML instead.
const _IMAGE_HOST_EXTRACT_RE =
  /["'](https?:\/\/(?:[a-z0-9-]+\.)*(?:picsum\.photos|unsplash\.com|placehold\.co|placekitten\.com|loremflickr\.com|placeholder\.com|pexels\.com|pixabay\.com|openverse\.org|ui-avatars\.com|dummyimage\.com|cloudinary\.com|imgix\.net)\/[^"']+)["']/i;

/**
 * First image URL referenced in a compiled component's source — an
 * extension-bearing URL (same-origin `/a/**` or remote) if present, else a
 * known extensionless image-service URL. Returns null when neither matches.
 */
function extractFirstImageUrl(source: string): string | null {
  const m = _IMAGE_URL_EXTRACT_RE.exec(source);
  if (m) return m[1] || m[2] || null;
  const h = _IMAGE_HOST_EXTRACT_RE.exec(source);
  if (h) return h[1] || null;
  return null;
}

/**
 * First-fold code component URLs to modulepreload, plus the LCP image URL
 * extracted from the first component's compiled JS. Both are returned from a
 * single function because they share the same R2 reads — computing them
 * together avoids a second pass over the config and R2.
 */
interface FirstFoldAssets {
  lcpImageUrl: string | null;
  componentJsUrls: string[];
}

async function extractFirstFoldAssets(
  config: AppConfig | null,
  appId: string,
  pathname: string,
  env: Env,
): Promise<FirstFoldAssets> {
  const result: FirstFoldAssets = { lcpImageUrl: null, componentJsUrls: [] };
  if (!config) return result;

  const isPreview = isPreviewRoute(pathname);
  const basePath = `/a/${isPreview ? 'preview-' : ''}${appId}/repo`;

  const pageSlug = extractPageSlug(pathname);
  const page = findPage(config, pageSlug);

  // 1. Explicit overrides for the LCP image take precedence
  const explicitPage = (page as { metadata?: { lcpImage?: string } } | undefined)?.metadata
    ?.lcpImage;
  const explicitApp = (config.frontend?.metadata as { lcpImage?: string } | undefined)?.lcpImage;
  if (explicitPage) result.lcpImageUrl = explicitPage;
  else if (explicitApp) result.lcpImageUrl = explicitApp;

  // 2. Walk page.content for every CodeComponent reference. Collect compiled
  //    JS URLs for modulepreload hints, and scan the FIRST component's source
  //    for an LCP image URL (if we don't already have one).
  const contentBlocks =
    (page as { content?: Array<Record<string, unknown>> } | undefined)?.content || [];
  const repoComponents =
    (config as { repo?: { frontend?: { components?: Record<string, { compiled?: string }> } } })
      .repo?.frontend?.components || {};

  // Also include the MainHeader / MainFooter / shared components referenced
  // by the app shell, since they contain above-the-fold content (nav, logo)
  // and run in parallel with the page-specific component.
  const shellComponentNames = new Set<string>();
  const headerComponent = (config.frontend as { header?: { component?: string } } | undefined)
    ?.header?.component;
  if (headerComponent) shellComponentNames.add(headerComponent);
  // Footer is below-fold — skip modulepreload to keep the hint budget tight.

  let firstCompScanned = false;
  for (const block of contentBlocks) {
    const compName =
      typeof block?.component === 'string'
        ? (block.component as string)
        : typeof block?.componentName === 'string'
          ? (block.componentName as string)
          : null;
    if (!compName) continue;
    const entry = repoComponents[compName];
    const compiledPath = entry?.compiled;
    if (!compiledPath) continue;

    result.componentJsUrls.push(`${basePath}/${compiledPath}`);

    if (!firstCompScanned && !result.lcpImageUrl) {
      firstCompScanned = true;
      try {
        const obj = await env.CONFIG_CACHE.get(`${appId}/${compiledPath}`);
        if (obj) {
          const source = await obj.text();
          result.lcpImageUrl = extractFirstImageUrl(source);
        }
      } catch {
        // non-fatal — preload is best-effort
      }
    }
  }

  // Add shell component compiled URLs (header etc.)
  for (const name of shellComponentNames) {
    const entry = repoComponents[name];
    if (entry?.compiled) {
      result.componentJsUrls.push(`${basePath}/${entry.compiled}`);
    }
  }

  // 3. Final fallback for the LCP image: openGraph.image
  if (!result.lcpImageUrl) {
    const og = config.frontend?.metadata?.openGraph?.image;
    if (og) result.lcpImageUrl = og;
  }

  return result;
}

function buildMetaTags(config: AppConfig | null, appId: string, pathname: string, requestUrl: URL): string {
  if (!config) return '<title>Exepad App</title>';

  const pageSlug = extractPageSlug(pathname);
  const page = findPage(config, pageSlug);

  const appName = config.frontend?.metadata?.title || config.frontend?.appName || config.name || 'Exepad App';
  const pageTitle = page?.metadata?.title || page?.title;
  const siteTitle = appName;
  // Format: "Page Title | App Name" — but only when pageTitle does not
  // already contain the brand. Creator output occasionally emits
  // `page.title = "{Brand} | {Tagline}"`, and a naive `${pageTitle} | ${appName}`
  // join produces `Brand | Tagline | Brand`. Splitting on `|` and checking
  // each trimmed segment catches both prefix and suffix duplication.
  const segments = pageTitle?.split('|').map((s) => s.trim()) ?? [];
  const pageTitleAlreadyBranded = segments.some(
    (s) => s.toLowerCase() === appName.toLowerCase(),
  );
  const title = pageTitle && !pageTitleAlreadyBranded
    ? `${pageTitle} | ${appName}`
    : (pageTitle || appName);
  const description = page?.metadata?.description || page?.summary || config.frontend?.metadata?.description || config.frontend?.description || '';
  const rawOgImage = config.frontend?.metadata?.openGraph?.image || config.frontend?.theme?.ogImage || '';
  const keywords = config.frontend?.metadata?.keywords;
  const canonicalBase = resolveCanonicalBase(config, appId, requestUrl);
  // Convert relative R2 paths to absolute URLs so social media crawlers can fetch them.
  // Uses canonicalBase to respect custom domains (openGraph.url) when set.
  const ogImage = rawOgImage && rawOgImage.startsWith('/')
    ? `${canonicalBase}/a/${appId}/repo${rawOgImage}`
    : rawOgImage;
  const canonicalUrl = `${canonicalBase}${pageSlug === '/' ? '' : pageSlug}`;
  const preview = isPreviewRoute(pathname);
  const noIndex = preview || isAuthRequired(config);

  const tags: string[] = [
    `<title>${escapeHtml(title)}</title>`,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
  ];

  if (description) {
    tags.push(`<meta name="description" content="${escapeHtml(description)}" />`);
  }

  if (keywords) {
    const kw = Array.isArray(keywords) ? keywords.join(', ') : keywords;
    tags.push(`<meta name="keywords" content="${escapeHtml(kw)}" />`);
  }

  // Robots
  if (noIndex) {
    tags.push('<meta name="robots" content="noindex, nofollow" />');
  } else {
    tags.push('<meta name="robots" content="index, follow" />');
  }

  // Open Graph
  tags.push(`<meta property="og:title" content="${escapeHtml(title)}" />`);
  if (description) {
    tags.push(`<meta property="og:description" content="${escapeHtml(description)}" />`);
  }
  if (ogImage) {
    tags.push(`<meta property="og:image" content="${escapeHtml(ogImage)}" />`);
  }
  tags.push(`<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`);
  tags.push(`<meta property="og:type" content="website" />`);
  if (config.name) {
    tags.push(`<meta property="og:site_name" content="${escapeHtml(config.name)}" />`);
  }

  // Twitter Card
  tags.push(`<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}" />`);
  tags.push(`<meta name="twitter:title" content="${escapeHtml(title)}" />`);
  if (description) {
    tags.push(`<meta name="twitter:description" content="${escapeHtml(description)}" />`);
  }
  if (ogImage) {
    tags.push(`<meta name="twitter:image" content="${escapeHtml(ogImage)}" />`);
  }

  // JSON-LD structured data. JSON.stringify does NOT escape `<`/`>`/`&`, so a
  // config-controlled title containing `</script>` would break out of the
  // script element (stored XSS). Escape those to their \u-sequences — valid
  // JSON that parses back identically, but inert inside an HTML <script>.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteTitle,
    url: canonicalBase,
  };
  const jsonLdSafe = JSON.stringify(jsonLd)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  tags.push(`<script type="application/ld+json">${jsonLdSafe}</script>`);

  // Favicon — resolve from metadata or top-level frontend.favicon
  const faviconSvg = config.frontend?.metadata?.favicon || config.frontend?.favicon;
  if (faviconSvg && faviconSvg.startsWith('<svg')) {
    tags.push(`<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(faviconSvg)}" />`);
  }

  return tags.join('\n    ');
}

/**
 * AGPL-3.0 section 13 source offer, emitted into EVERY HTML page this worker
 * serves — the studio shell *and* every app page, including the ones anonymous
 * visitors reach on a published/tunnel URL, a custom domain, or a single-app
 * bundle. The studio About page carries a human-readable copy, but it sits
 * behind the operator login, so this machine-readable link (and the `/source`
 * route it mirrors) is what actually reaches an app's own users.
 *
 * `href` is the ABSOLUTE repository URL rather than the same-origin `/source`
 * route: the "Share live URL" tunnel proxy path-rewrites any unrecognised path
 * to `/a/{appId}/…` (`lib/publish-profile.ts`), so a same-origin link would
 * resolve to the app's SPA shell there. Both surfaces read the one
 * `sourceOfferUrl()` constant, so a fork rebrands in a single place.
 *
 * The `title` names what the offer covers — the Exepad *platform*, not the
 * page's own content: an application built with Exepad belongs to its author
 * under the section 7 additional permission in LICENSING.md.
 */
function buildSourceOfferLink(): string {
  return `<link rel="license" href="${escapeHtml(sourceOfferUrl())}" title="Exepad platform source (AGPL-3.0)" />`;
}

/**
 * Stage-1 prerender artifact for the page: the hydration-correct `#root` HTML
 * plus the first-fold module list the client primes before `hydrateRoot`.
 *
 * Gated on the `EXEPAD_PRERENDER` env flag AND the artifact existing — off by
 * default, so a deployment with no artifacts (or the flag unset) serves the
 * normal cold-mount HTML unchanged. Best-effort: any miss returns null and the
 * caller falls back to the empty `#root`.
 */
interface PrerenderArtifact {
  html: string;
  basePath: string;
  modules: string[];
}

async function loadPrerender(
  appId: string,
  pageSlug: string,
  env: Env,
): Promise<PrerenderArtifact | null> {
  if (process.env.EXEPAD_PRERENDER !== '1') return null;
  try {
    const htmlKey = await resolvePrerenderKey(env.CONFIG_CACHE, appId, pageSlug);
    const htmlObj = await env.CONFIG_CACHE.get(htmlKey);
    if (!htmlObj) return null;
    const html = await htmlObj.text();
    if (!html.trim()) return null;

    let basePath = `/a/${appId}`;
    let modules: string[] = [];
    const modObj = await env.CONFIG_CACHE.get(htmlKey.replace(/\.html$/, '.modules.json'));
    if (modObj) {
      try {
        const parsed = JSON.parse(await modObj.text()) as { basePath?: string; modules?: string[] };
        if (parsed.basePath) basePath = parsed.basePath;
        if (Array.isArray(parsed.modules)) modules = parsed.modules;
      } catch {
        // Malformed manifest → still inject HTML; client primes nothing and the
        // unprimed boundaries client-render (no crash, just no SSR adoption).
      }
    }
    return { html, basePath, modules };
  } catch {
    return null;
  }
}

async function loadSeoSnapshot(appId: string, pageSlug: string, env: Env): Promise<string | null> {
  try {
    const key = await resolveSeoSnapshotKey(env.CONFIG_CACHE, appId, pageSlug);
    const object = await env.CONFIG_CACHE.get(key);
    if (!object) return null;
    return await object.text();
  } catch {
    return null;
  }
}

/**
 * Injects SEO meta tags, structured data, crawlable content snapshots,
 * and CSP nonce attributes into the SPA's index.html.
 */
export async function injectMeta(c: Context<{ Bindings: Env }>): Promise<Response> {
  const url = new URL(c.req.url);
  const pathAppId = extractAppId(url.pathname);

  // Single-app serve mode: the pinned app is served at the origin root, so a
  // request with no /a/{appId}/ prefix resolves to it. Synthesize the
  // equivalent /a/{appId}{slug} pathname so every meta/SEO/prerender helper
  // below — all of which parse `/a/{appId}/...` — works unchanged, and force
  // route-mode 'domain' (basePath='') so the SPA serves from the origin root
  // exactly as it does on an `{appId}.exepad.app` subdomain.
  let metaPathname = url.pathname;
  let appId = pathAppId;
  let forcedDomainMode = false;
  if (!appId && isSingleAppMode()) {
    appId = singleAppId();
    metaPathname = `/a/${appId}${url.pathname === '/' ? '' : url.pathname}`;
    forcedDomainMode = true;
  }

  // Self-serve custom domain mapped to ONE published app served at the root:
  // resolve the appId from the Host header and force domain route-mode, exactly
  // as single-app mode does above. (A whole-studio custom domain returns no
  // single appId here — it serves /a/{id}/ paths, handled by resolveRouteMode.)
  if (!appId) {
    const mapping = resolveHostMapping(url.hostname);
    if (mapping?.appId) {
      appId = mapping.appId;
      metaPathname = `/a/${appId}${url.pathname === '/' ? '' : url.pathname}`;
      forcedDomainMode = true;
    }
  }

  // One-click "Share live URL" tunnel: the publish proxy rewrites to
  // /a/{appId}/… (so appId already resolved from the path above) but wants the
  // app served at the origin root — bare in-app URLs (`/wishlist`), exactly like
  // a single-app host. It signals this with `x-exepad-serve-mode: domain`, a
  // spoof-proof header (it is in the proxy's STRIPPED_REQUEST_HEADERS, so an
  // inbound visitor cannot set it; the proxy re-stamps it on re-entry).
  if (appId && !forcedDomainMode && c.req.header('x-exepad-serve-mode') === 'domain') {
    forcedDomainMode = true;
  }

  const isPreview = isPreviewRoute(metaPathname);
  const routeMode = forcedDomainMode ? 'domain' : resolveRouteMode(url);

  let previewIdentity: Awaited<ReturnType<typeof resolveGatewayIdentity>> | null = null;
  if (appId && isPreview) {
    previewIdentity = await resolveGatewayIdentity(c.req.raw, appId, 'preview', c.env);
    if (!previewIdentity.isAuthenticated) {
      // Render the SPA's auth-gate screen as static HTML directly from the
      // worker, linking to the runtime SPA's own bundled stylesheet. We can't
      // reach the in-SPA styled version (PreviewPage.tsx:254) because
      // mounting the SPA requires fetching app-config, which is also gated —
      // and reopening that endpoint would leak private preview content.
      const nonce = c.get('cspNonce' as never) as string | undefined;
      const spaStylesheets = await getSpaStylesheets(c.env, c.req.url);
      const html = buildUnauthorizedPreviewHtml(appId, url, nonce, spaStylesheets);
      return c.html(html, 401, {
        'Cache-Control': 'private, no-store',
      });
    }
  }

  const indexReq = new Request(new URL('/index.html', c.req.url).toString());
  const indexResponse = await c.env.ASSETS.fetch(indexReq);

  if (!indexResponse.ok) {
    return c.text('Not Found', 404);
  }

  let metaTags = '<title>Exepad App Studio - Self-hosted App Container</title>';
  let seoContent = '';
  let preloadTags = '';
  let inlineConfigScript = '';
  let inlineAppCssTag = '';
  let isPublicHtml = false;
  let unauthedForAuthRequired = false;
  let prerender: PrerenderArtifact | null = null;

  if (appId) {
    const mode = isPreview ? 'preview' : 'published';
    const noCache = c.req.header('X-Exepad-No-Cache') === '1';
    const config = await loadAppConfig(appId, c.env, mode, {
      noCache,
      executionCtx: getExecutionContext(c),
    });
    // Public share tunnel: the request re-enters via the loopback INNER_ORIGIN
    // (`http://127.0.0.1`), so `url` is that loopback and canonical/OG/schema
    // would leak it. The tunnel proxy advertises the real public host via
    // X-Forwarded-Host (and strips any inbound copy). Trust it ONLY on that
    // loopback re-entry — NOT merely on forcedDomainMode: domain mode is also
    // reachable on the main :8080 surface (a client-set X-Exepad-Serve-Mode) and
    // is unconditional in single-app / custom-domain deployments served on real
    // public hosts, where X-Forwarded-Host is attacker-controlled and would
    // otherwise poison the canonical host. `url.host === '127.0.0.1'` is unique to
    // the tunnel re-entry (direct loopback hits carry the `:8090` port; public
    // hosts carry their own name). The new URL() is guarded so a malformed value
    // can never 500 the page — it falls back to the loopback origin.
    let canonicalReqUrl = url;
    const isTunnelReentry = forcedDomainMode && url.host === '127.0.0.1';
    const fwdHost = isTunnelReentry ? c.req.header('x-forwarded-host') : undefined;
    if (fwdHost) {
      try {
        canonicalReqUrl = new URL(`${c.req.header('x-forwarded-proto') || 'https'}://${fwdHost}`);
      } catch {
        /* malformed forwarded host — keep the loopback fallback rather than 500 */
      }
    }
    metaTags = buildMetaTags(config, appId, metaPathname, canonicalReqUrl);

    // For published apps that require auth, resolve identity up front so we
    // can decide whether emitting preload hints is safe. Those hints point at
    // /repo/**/*.js and /published/assets/** URLs that serveAppR2Asset will
    // 401 for guests — if we emit them anyway, the browser's preload scanner
    // fires the requests before the SPA boots and the console fills with
    // "Failed to load resource: 401" errors. Suppressing the hints for guests
    // also avoids advertising the compiled component filename list to
    // unauthenticated visitors.
    if (!isPreview && isAuthRequired(config)) {
      const publishedIdentity = await resolveGatewayIdentity(
        c.req.raw, appId, 'published', c.env,
      );
      unauthedForAuthRequired = !publishedIdentity.isAuthenticated;
    }

    // Public-published gate (drives inline config/CSS + Stage-1 prerender
    // adoption below). Computed up front because the LCP-image preload strategy
    // branches on whether this page is prerendered.
    isPublicHtml = !!config && !isPreview && !isAuthRequired(config);
    if (isPublicHtml) {
      prerender = await loadPrerender(appId, extractPageSlug(metaPathname), c.env);
    }

    // First-fold preloads — the Code Focus dynamic import() of code
    // components hides <img src> AND the component JS itself from the
    // browser's preload scanner, causing 5-7s of "Load Delay" before the
    // LCP image even starts downloading. Emitting these hints in the server
    // HTML starts both the image and the component JS downloading in
    // parallel with the main runtime bundle, saving most of that delay.
    if (!unauthedForAuthRequired) {
      try {
        const assets = await extractFirstFoldAssets(config, appId, metaPathname, c.env);
        // Compiled artifacts may carry absolute *.exepad.app/.com asset URLs from
        // a prior cloud deploy; on self-host, rewrite them to same-origin so the
        // preload/preconnect points at a host this deployment actually serves.
        assets.lcpImageUrl = rewriteSelfHostAssetUrl(assets.lcpImageUrl, appId, url);
        const hints: string[] = [];
        if (assets.lcpImageUrl) {
          // Preconnect to the cross-origin image host so the DNS+TLS handshake
          // overlaps the HTML parse. ONE preconnect only: on simulated slow-4G the
          // link is bandwidth-saturated by the render-blocking CSS, so even an
          // extra preconnect handshake (e.g. to a redirect-target CDN) regressed
          // mobile FCP 2.5s→3.8s for no gain — proven not worth it. No-cors image →
          // no crossorigin attr (matches the eventual <img> fetch mode).
          if (/^https?:\/\//i.test(assets.lcpImageUrl)) {
            try {
              const origin = new URL(assets.lcpImageUrl).origin;
              if (origin !== url.origin) {
                hints.push(`<link rel="preconnect" href="${escapeHtml(origin)}" />`);
              }
            } catch {
              /* unparseable URL — skip preconnect, still emit the preload */
            }
          }
          // Image preload is desktop-gated. On simulated slow-4G (4× CPU) a
          // high-priority hero fetch competes with the render-blocking CSS and
          // pushes mobile FCP/LCP OUT (measured FCP 2.5s→3.8s) for zero LCP gain —
          // the mobile critical path is bandwidth-saturated, so rescheduling the
          // image can only hurt. This holds EVEN when the page is prerendered
          // (mobile FCP is CSS-download-bound, not render-bound). Desktop (fast
          // link + CPU) paints the early-downloaded image sooner, so it keeps the
          // win.
          hints.push(
            `<link rel="preload" as="image" href="${escapeHtml(assets.lcpImageUrl)}" media="(min-width: 768px)" fetchpriority="high" />`,
          );
        }
        for (const jsUrl of assets.componentJsUrls) {
          hints.push(`<link rel="modulepreload" href="${escapeHtml(jsUrl)}" />`);
        }
        preloadTags = hints.join('\n    ');
      } catch {
        // Preload is a nice-to-have — never let extraction errors break the
        // HTML response.
      }
    }

    const pageSlug = extractPageSlug(metaPathname);
    const snapshot = await loadSeoSnapshot(appId, pageSlug, c.env);
    if (snapshot) {
      // `inert` (not `aria-hidden`) so the crawlable snapshot's <a> links are
      // removed from the tab order AND the accessibility tree. aria-hidden on a
      // container holding focusable descendants is an axe `aria-hidden-focus`
      // violation; `inert` is the canonical fix for visually-hidden-but-present
      // markup and cascades to all descendants.
      seoContent = `\n  <div id="seo-content" inert style="${SEO_SNAPSHOT_HIDDEN_STYLE}">${snapshot}</div>`;
    }

    // Inline the published config into the HTML so the SPA can render the first
    // page synchronously instead of doing a serial `/api/{appId}/app-config`
    // round trip after the runtime bundle parses (the single largest slice of
    // LCP render-delay). The worker already loaded this exact object above, so
    // emitting it is free. Only for PUBLIC published apps: preview iterates too
    // fast to cache, and auth-required configs must stay behind the gated
    // endpoint (never serialized into HTML that an intermediary could cache).
    // type="application/json" is inert data (not executed) so it needs no nonce;
    // `</` is escaped to prevent a `</script>` breakout.
    if (isPublicHtml) {
      const serialized = JSON.stringify(config!).replace(/</g, '\\u003c');
      // Guard against pathologically large configs bloating every HTML byte —
      // those keep the network path.
      if (serialized.length < 262_144) {
        inlineConfigScript = `\n  <script type="application/json" id="__exepad_config" data-app-id="${escapeHtml(appId)}">${serialized}</script>`;
      }

      // Inline the compiled app CSS render-blocking in <head> so the first
      // paint is already styled — the largest CLS reducer (no unstyled-mount
      // reflow) and one fewer render-affecting fetch on the LCP path. Public
      // published only: CSS class inventories aren't sensitive, but this keeps
      // the inline surface consistent with the config inline above (preview
      // iterates too fast to cache; auth-gated HTML must not embed app payload).
      inlineAppCssTag = await buildInlineAppCss(config, appId, c.env);
    }
  }

  let html = await indexResponse.text();

  // Inject appId hint for SPA subdomain routing — the SPA reads this to know which
  // app to load when the browser URL has no /a/{appId}/ prefix (subdomain access).
  if (appId) {
    const mode = isPreview ? 'preview' : 'published';
    // When we know the visitor is unauthenticated on an auth-required published
    // app, stamp that on the root so the SPA can seed the auth store without
    // waiting for the /api/{appId}/auth_me round trip. Prevents a loading
    // flash before the default login page renders.
    const authAttrs = unauthedForAuthRequired
      ? ' data-auth-required="1" data-auth-status="unauthenticated"'
      : '';
    const prerenderAttr = prerender ? ' data-exepad-prerendered="1"' : '';
    html = html.replace(
      '<div id="root"',
      `<div id="root" data-app-id="${escapeHtml(appId)}" data-app-mode="${mode}" data-route-mode="${routeMode}"${authAttrs}${prerenderAttr}`,
    );
    // Inject the prerendered first-fold HTML INTO the (empty) #root. A replacer
    // function is used so the artifact's `<!--$-->` Suspense markers aren't
    // interpreted as `$`-replacement patterns.
    if (prerender) {
      html = html.replace(
        /(<div id="root"[^>]*>)<\/div>/,
        (_m, open: string) => `${open}${prerender!.html}</div>`,
      );
    }
  }

  // If app-specific favicon was injected, remove the default one from index.html
  if (metaTags.includes('rel="icon"')) {
    html = html.replace(/<link rel="icon"[^>]*href="\/favicon\.svg"[^>]*\/?>/, '');
  }

  // Preload goes BEFORE metaTags so the browser encounters the hint as
  // early as possible in the head (Chrome's preload scanner is line-order
  // sensitive — earlier hints queue first). The inlined app CSS goes last so
  // it cascades after the SPA bundle stylesheet that already sits in <head>.
  const headParts = [preloadTags, metaTags, buildSourceOfferLink()]
    .filter(Boolean)
    .join('\n    ');
  const headInjection = `    ${headParts}${inlineAppCssTag}`;
  html = html.replace('</head>', `${headInjection}\n  </head>`);

  // `__exepad_prerender` carries the base path + first-fold module URLs that
  // main.tsx imports + primes before hydrateRoot (so the client's first render
  // matches the injected markup). type="application/json" is inert data → no nonce.
  let prerenderScript = '';
  if (prerender) {
    const payload = JSON.stringify({ basePath: prerender.basePath, modules: prerender.modules }).replace(/</g, '\\u003c');
    prerenderScript = `\n  <script type="application/json" id="__exepad_prerender">${payload}</script>`;
  }

  if (seoContent || inlineConfigScript || prerenderScript) {
    html = html.replace('</body>', `${seoContent}${inlineConfigScript}${prerenderScript}\n</body>`);
  }

  const nonce = c.get('cspNonce' as never) as string | undefined;
  if (nonce) {
    html = html.replace(/<script(?=[^>]*(?:type="module"|type='module'|src=))/g, `<script nonce="${nonce}"`);
    html = html.replace(/<script(?![^>]*nonce=)(?![^>]*src=)/g, `<script nonce="${nonce}"`);
  }

  const response = c.html(html);

  // Cache-Control for the app HTML shell.
  //
  // Public published apps: `private, max-age=0, must-revalidate` — crucially NOT
  // `no-store`, which is the one directive that disqualifies a page from the
  // back/forward cache (the bf-cache Lighthouse failure). `private` keeps the
  // per-request CSP nonce out of any shared/CDN cache (each response still
  // carries a unique nonce until Stage 1 moves to a nonce-free cached body +
  // HTMLRewriter stamping). The browser revalidates on navigation but can still
  // restore instantly from bf-cache on back/forward.
  //
  // Preview and auth-required apps: keep `private, no-store` — preview content
  // is per-session and must never be restored from bf-cache, and auth-gated
  // HTML must not linger in any cache.
  if (appId) {
    response.headers.set(
      'Cache-Control',
      isPublicHtml ? 'private, max-age=0, must-revalidate' : 'private, no-store',
    );
  }

  // Set a preview access cookie only after preview access is verified.
  // import() cannot send custom auth headers, so this bridges the initial
  // preview navigation to follow-up asset and API requests.
  //
  // Path=/ is intentional: the SPA fetches config from /api/preview-{appId}/...
  // while the HTML lives under /a/preview-{appId}/, so a narrower path would
  // prevent the browser from sending the cookie to the API. Cross-app leakage
  // is not a concern — validatePreviewAccessToken enforces payload.appId === appId,
  // so presenting this cookie on a different preview page will still be rejected.
  //
  // Gated on `shouldRefreshPreviewCookie` so we only re-stamp Set-Cookie when
  // bootstrapping from `?pt=` or slide-renewing a near-expiry token. Re-stamping
  // on every cookie-auth'd HTML reload with the same token would keep the
  // browser-side cookie expiry in sync with the original token exp (Max-Age
  // is recalculated from "now"), which is the existing pre-sliding behavior we
  // no longer need now that the TTL matches a typical session length.
  if (
    appId &&
    isPreview &&
    previewIdentity?.previewAccessToken &&
    previewIdentity.shouldRefreshPreviewCookie
  ) {
    for (const header of buildPreviewAccessCookieHeaders(previewIdentity.previewAccessToken, appId, c.req.raw)) {
      response.headers.append('Set-Cookie', header);
    }
  }

  return response;
}
