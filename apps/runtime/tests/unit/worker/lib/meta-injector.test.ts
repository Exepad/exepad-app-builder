// @vitest-environment node
/**
 * Tests for the worker meta-injector (`lib/meta-injector.ts`) and the gateway
 * static-file/MCP dispatch (`routes/gateway/services.ts`).
 *
 * Security focus:
 *  - meta-injector: a config title/description carrying `</style>`, `</script>`
 *    or a bare `"` must be HTML-neutralized so it cannot break out of the
 *    `<title>` / meta `content="…"` attribute and inject markup. The inlined
 *    config `<script type="application/json">` must likewise have its `</`
 *    sequences escaped so it cannot close the script element early.
 *  - cookie: `__exepad_pa` must always be `HttpOnly` + `SameSite=Lax`, and
 *    `Secure` must track the request scheme / proxy header / env flag — never
 *    emitted over plain HTTP (which the browser would silently drop) and always
 *    emitted over HTTPS.
 *  - services: a streamed binary file response must carry `X-Content-Type-Options:
 *    nosniff` and a `script-src 'none'` CSP fallback so a user-uploaded HTML/SVG
 *    file can never be sniffed-and-executed in the app origin. No path-segment is
 *    re-resolved by services.ts, so traversal cannot widen the served path.
 *
 * Harness: a real Hono app routes to `injectMeta` so `c` is a genuine Context
 * (matching the `app.request` pattern used across the server tests); the heavy
 * storage seams (`loadAppConfig`, `resolveGatewayIdentity`, the app-backend
 * dispatch) are `vi.mock`-stubbed so the assertions isolate the injector's own
 * escaping + header stamping.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

// ─── Module stubs ─────────────────────────────────────────────────────────────
// Keep every pure helper from app-config real (extractAppId / extractPageSlug /
// escapeHtml / isAuthRequired) and only replace the storage-backed loader so we
// can feed a controlled config straight into the meta builder.
let mockConfig: unknown = null;
vi.mock('../../../../worker/src/lib/app-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../worker/src/lib/app-config')>();
  return {
    ...actual,
    loadAppConfig: vi.fn(async () => mockConfig),
  };
});

// Identity: default authenticated published, controllable per-test.
let mockIdentity: { isAuthenticated: boolean; previewAccessToken?: string; shouldRefreshPreviewCookie?: boolean } = {
  isAuthenticated: true,
};
vi.mock('../../../../worker/src/routes/gateway/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../worker/src/routes/gateway/auth')>();
  return {
    ...actual,
    // Used by injectMeta (preview/published gate) AND by services.ts (header build).
    resolveGatewayIdentity: vi.fn(async () => mockIdentity),
    buildDispatchHeaders: vi.fn(async () => new Headers()),
  };
});

// services.dispatchFiles/dispatchMcp delegate to the app-backend over an
// in-process call. Stub that seam so the assertions isolate the header stamping
// (nosniff / CSP / CORS) that services.ts adds on the way back.
const mockAppBackend = vi.fn();
vi.mock('../../../../worker/src/routes/gateway/dispatch-local', () => ({
  fetchAppBackendInProcess: (...args: unknown[]) => mockAppBackend(...args),
  dispatchRpcInProcess: vi.fn(async () => new Response('{}', { status: 200 })),
}));

import {
  buildPreviewAccessCookieHeaders,
  extractSpaStylesheets,
  resolveCanonicalBase,
  injectMeta,
} from '../../../../worker/src/lib/meta-injector';
import { PREVIEW_ACCESS_TTL_SECONDS } from '../../../../worker/src/routes/gateway/auth';
import type { Env } from '../../../../worker/src/types/env';

// Minimal index.html the ASSETS binding returns; injectMeta rewrites <head> +
// the #root div + </body> into this shell.
const INDEX_HTML = `<!DOCTYPE html>
<html>
  <head>
    <link rel="icon" href="/favicon.svg" />
    <link rel="stylesheet" href="/assets/index-abc123.css" />
    <title>Default</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/index-abc123.js"></script>
  </body>
</html>`;

/**
 * A fake Env where ASSETS always returns the SPA shell and CONFIG_CACHE is an
 * empty store (so the inline-CSS / prerender / seo-snapshot best-effort paths
 * all miss and return '' — they are exercised separately by their own modules).
 */
function makeEnv(): Env {
  return {
    ASSETS: {
      fetch: vi.fn(async () => new Response(INDEX_HTML, { status: 200, headers: { 'content-type': 'text/html' } })),
    },
    CONFIG_CACHE: {
      get: vi.fn(async () => null),
    },
    ENVIRONMENT: 'selfhost',
  } as unknown as Env;
}

/** Drive injectMeta through a real Hono context and return the HTML body + response. */
async function render(url: string, env: Env = makeEnv()): Promise<{ html: string; res: Response }> {
  const app = new Hono<{ Bindings: Env }>();
  app.get('*', (c) => injectMeta(c));
  const res = await app.request(url, {}, env);
  const html = await res.text();
  return { html, res };
}

const ORIG_COOKIE_SECURE = process.env.EXEPAD_COOKIE_SECURE;
const ORIG_SINGLE_APP = process.env.EXEPAD_SINGLE_APP_ID;
const ORIG_PRERENDER = process.env.EXEPAD_PRERENDER;

beforeEach(() => {
  mockConfig = null;
  mockIdentity = { isAuthenticated: true };
  delete process.env.EXEPAD_COOKIE_SECURE;
  delete process.env.EXEPAD_SINGLE_APP_ID;
  delete process.env.EXEPAD_PRERENDER;
});

afterEach(() => {
  if (ORIG_COOKIE_SECURE === undefined) delete process.env.EXEPAD_COOKIE_SECURE;
  else process.env.EXEPAD_COOKIE_SECURE = ORIG_COOKIE_SECURE;
  if (ORIG_SINGLE_APP === undefined) delete process.env.EXEPAD_SINGLE_APP_ID;
  else process.env.EXEPAD_SINGLE_APP_ID = ORIG_SINGLE_APP;
  if (ORIG_PRERENDER === undefined) delete process.env.EXEPAD_PRERENDER;
  else process.env.EXEPAD_PRERENDER = ORIG_PRERENDER;
  vi.restoreAllMocks();
});

// ─── meta-injector: title / description tag breakout ──────────────────────────

describe('injectMeta — title/description neutralization', () => {
  it('escapes a </script> breakout in the app title across <title>, og:title and twitter:title', async () => {
    mockConfig = {
      name: 'Evil',
      frontend: {
        metadata: { title: 'Pwn</title><script>alert(1)</script>' },
        // Page title 'Home' makes the rendered title `Home | Pwn…`.
        pages: [{ slug: '/', title: 'Home' }],
      },
    };
    const { html } = await render('https://app.example.com/a/abc123/');

    // The escapeHtml-based meta tags entity-encode the closing tags.
    expect(html).toContain('&lt;/title&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // The rendered <title> stays a single well-formed element.
    expect(html).toMatch(/<title>Home \| Pwn&lt;\/title&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/title>/);
    // og:title / twitter:title carry the same escaped value (no attribute breakout).
    expect(html).toContain('property="og:title" content="Home | Pwn&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(html).toContain('name="twitter:title" content="Home | Pwn&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
  });

  // Regression: the JSON-LD structured-data block now escapes `<`/`>`/`&` in the
  // serialized JSON (meta-injector.ts), so a title of
  // `…</script><script>alert(1)</script>` cannot close the
  // `<script type="application/ld+json">` element and inject a live script. The
  // app title is attacker/agent-controlled config, so this is a stored-XSS sink.
  it('escapes </script> inside the JSON-LD island so the title cannot inject a live script', async () => {
    mockConfig = {
      name: 'Evil',
      frontend: {
        metadata: { title: 'Pwn</title><script>alert(1)</script>' },
        pages: [{ slug: '/', title: 'Home' }],
      },
    };
    const { html } = await render('https://app.example.com/a/abc123/');

    // No live injected <script>alert(1)</script> element may exist anywhere in
    // the document (currently it survives verbatim inside the ld+json block).
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('escapes </style> in the page title (cannot close an inline <style>)', async () => {
    mockConfig = {
      name: 'App',
      frontend: {
        metadata: { title: 'Brand' },
        pages: [{ slug: '/', title: 'Hero</style><img src=x onerror=alert(1)>' }],
      },
    };
    const { html } = await render('https://app.example.com/a/abc123/');

    expect(html).toContain('&lt;/style&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });

  it('escapes a bare double-quote in the description so the meta content="" attribute cannot be broken', async () => {
    mockConfig = {
      name: 'App',
      frontend: {
        metadata: {
          title: 'App',
          description: 'Say "hi"><script>steal()</script>',
        },
        pages: [{ slug: '/', title: 'Home' }],
      },
    };
    const { html } = await render('https://app.example.com/a/abc123/');

    // The quote that would terminate content="…" is encoded.
    expect(html).toContain('&quot;hi&quot;');
    expect(html).toContain('&gt;&lt;script&gt;steal()&lt;/script&gt;');
    // No attribute breakout: the raw injected script is absent.
    expect(html).not.toContain('"><script>steal()</script>');
    // The og:description / twitter:description carry the same escaped value.
    expect(html).toMatch(/name="description" content="Say &quot;hi&quot;/);
    expect(html).toMatch(/property="og:description" content="Say &quot;hi&quot;/);
  });

  it('escapes keywords (array) and og:site_name (config.name) too', async () => {
    mockConfig = {
      name: 'Acme "&" <Co>',
      frontend: {
        metadata: { title: 'App', keywords: ['a"b', 'c<d>'] },
        pages: [{ slug: '/', title: 'Home' }],
      },
    };
    const { html } = await render('https://app.example.com/a/abc123/');

    expect(html).toContain('content="a&quot;b, c&lt;d&gt;"');
    expect(html).toContain('property="og:site_name" content="Acme &quot;&amp;&quot; &lt;Co&gt;"');
    expect(html).not.toContain('<Co>');
  });

  it('falls back to a static, non-injectable title when no app config loads', async () => {
    mockConfig = null;
    // No /a/ prefix → no appId → the early static title path.
    const { html } = await render('https://app.example.com/');
    expect(html).toContain('<title>Exepad App Studio - Self-hosted App Container</title>');
  });
});

// ─── meta-injector: inline config <script> breakout ───────────────────────────

describe('injectMeta — inline JSON config script defuse', () => {
  it('escapes </ in the serialized public config so a string field cannot close the script', async () => {
    // Public published app (no security) → config is inlined as application/json.
    mockConfig = {
      name: 'App',
      frontend: {
        metadata: { title: 'App', description: '</script><script>pwn()</script>' },
        pages: [{ slug: '/', title: 'Home' }],
      },
    };
    const { html } = await render('https://app.example.com/a/abc123/');

    // The inline config block exists…
    expect(html).toContain('id="__exepad_config"');
    // …and every `<` inside the JSON is escaped to <, so no `</script>`
    // token survives inside the data island.
    const island = html.slice(html.indexOf('id="__exepad_config"'));
    const scriptOpen = island.indexOf('>') + 1;
    const scriptClose = island.indexOf('</script>', scriptOpen);
    const jsonBody = island.slice(scriptOpen, scriptClose);
    expect(jsonBody).not.toContain('</script>');
    expect(jsonBody).not.toContain('<script>');
    expect(jsonBody).toContain('\\u003c');
  });
});

// ─── meta-injector: inline app-CSS memoization ────────────────────────────────

describe('injectMeta — inline app CSS is memoized per config object', () => {
  it('reads the compiled Tailwind sheet from storage once across repeated requests for the same warm config', async () => {
    const cssKey = 'abc123/compiled/frontend/styles/compiled.css';
    // Public published app with a compiled stylesheet → CSS is inlined in <head>.
    mockConfig = {
      name: 'App',
      frontend: { metadata: { title: 'App' }, pages: [{ slug: '/', title: 'Home' }] },
      repo: { frontend: { styles: { theme: { compiled: 'compiled/frontend/styles/compiled.css' } } } },
    };

    const get = vi.fn(async (key: string) =>
      key === cssKey ? { text: async () => '.exepad-app{color:red}' } : null,
    );
    const env = {
      ASSETS: { fetch: vi.fn(async () => new Response(INDEX_HTML, { status: 200, headers: { 'content-type': 'text/html' } })) },
      CONFIG_CACHE: { get },
      ENVIRONMENT: 'selfhost',
    } as unknown as Env;

    const first = await render('https://app.example.com/a/abc123/', env);
    // The compiled sheet made it into the inline <style>.
    expect(first.html).toContain('.exepad-app{color:red}');

    const cssReadsAfterFirst = get.mock.calls.filter(([k]) => k === cssKey).length;
    expect(cssReadsAfterFirst).toBe(1);

    // A second request for the SAME config object must NOT re-read the sheet.
    const second = await render('https://app.example.com/a/abc123/', env);
    expect(second.html).toContain('.exepad-app{color:red}');
    const cssReadsTotal = get.mock.calls.filter(([k]) => k === cssKey).length;
    expect(cssReadsTotal).toBe(1);
  });
});

// ─── meta-injector: root data attributes / favicon ────────────────────────────

describe('injectMeta — #root attributes', () => {
  it('stamps an escaped data-app-id and the resolved route/app mode on #root', async () => {
    mockConfig = { name: 'App', frontend: { metadata: { title: 'App' }, pages: [{ slug: '/', title: 'Home' }] } };
    // localhost is an internal runtime host → path route mode.
    const { html } = await render('http://localhost:8080/a/abc123/');
    expect(html).toContain('data-app-id="abc123"');
    expect(html).toContain('data-app-mode="published"');
    expect(html).toContain('data-route-mode="path"');
  });

  it('treats a /a/preview- request as preview mode + noindex', async () => {
    mockConfig = { name: 'App', frontend: { metadata: { title: 'App' }, pages: [{ slug: '/', title: 'Home' }] } };
    const { html, res } = await render('http://localhost:8080/a/preview-abc123/');
    expect(html).toContain('data-app-mode="preview"');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    // Preview HTML must never be cached.
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});

// ─── meta-injector: preview auth gate ─────────────────────────────────────────

describe('injectMeta — unauthenticated preview gate', () => {
  it('renders the static 401 auth-gate (no app payload leaked) when preview identity is unauthenticated', async () => {
    mockIdentity = { isAuthenticated: false };
    mockConfig = { name: 'Secret', frontend: { metadata: { title: 'Secret App' }, pages: [{ slug: '/', title: 'Home' }] } };
    const { html, res } = await render('http://localhost:8080/a/preview-abc123/');

    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(html).toContain('Authentication Required');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    // The private config title must NOT appear in the gate HTML.
    expect(html).not.toContain('Secret App');
    expect(html).not.toContain('id="__exepad_config"');
  });
});

// ─── buildPreviewAccessCookieHeaders: flags ───────────────────────────────────

describe('buildPreviewAccessCookieHeaders — cookie flags', () => {
  it('always sets HttpOnly + SameSite=Lax + Path=/ on the live cookie', () => {
    const [fresh, clear] = buildPreviewAccessCookieHeaders('tok-123', 'abc123');
    expect(fresh).toContain('__exepad_pa=tok-123');
    expect(fresh).toContain('Path=/');
    expect(fresh).toContain('HttpOnly');
    expect(fresh).toContain('SameSite=Lax');
    expect(fresh).toContain(`Max-Age=${PREVIEW_ACCESS_TTL_SECONDS}`);
    // The second header clears any legacy narrow-Path cookie (Max-Age=0).
    expect(clear).toContain('__exepad_pa=;');
    expect(clear).toContain('Path=/a/preview-abc123/');
    expect(clear).toContain('Max-Age=0');
    expect(clear).toContain('HttpOnly');
  });

  it('URL-encodes the token so a malicious token value cannot inject cookie attributes', () => {
    // A token with `;` and ` ` could otherwise forge extra cookie directives.
    const [fresh] = buildPreviewAccessCookieHeaders('a;Domain=evil.com b', 'abc123');
    expect(fresh).not.toContain(';Domain=evil.com');
    expect(fresh).toContain('__exepad_pa=a%3BDomain%3Devil.com%20b');
  });

  it('omits Secure over plain HTTP (browser would drop a Secure cookie on http://)', () => {
    const req = new Request('http://localhost:8080/a/preview-abc123/');
    const [fresh, clear] = buildPreviewAccessCookieHeaders('tok', 'abc123', req);
    expect(fresh).not.toContain('Secure');
    expect(clear).not.toContain('Secure');
  });

  it('adds Secure when the request itself is HTTPS', () => {
    const req = new Request('https://app.example.com/a/preview-abc123/');
    const [fresh, clear] = buildPreviewAccessCookieHeaders('tok', 'abc123', req);
    expect(fresh).toContain('; Secure');
    expect(clear).toContain('; Secure');
  });

  it('adds Secure when a TLS-terminating proxy sets x-forwarded-proto: https', () => {
    const req = new Request('http://internal/a/preview-abc123/', {
      headers: { 'x-forwarded-proto': 'https' },
    });
    const [fresh] = buildPreviewAccessCookieHeaders('tok', 'abc123', req);
    expect(fresh).toContain('; Secure');
  });

  it('adds Secure when EXEPAD_COOKIE_SECURE=1 even over plain HTTP', () => {
    process.env.EXEPAD_COOKIE_SECURE = '1';
    const req = new Request('http://localhost:8080/a/preview-abc123/');
    const [fresh] = buildPreviewAccessCookieHeaders('tok', 'abc123', req);
    expect(fresh).toContain('; Secure');
  });
});

// ─── extractSpaStylesheets ────────────────────────────────────────────────────

describe('extractSpaStylesheets', () => {
  it('extracts every /assets stylesheet link and ignores non-asset / non-stylesheet links', () => {
    const html = `<head>
      <link rel="icon" href="/favicon.svg" />
      <link rel="stylesheet" href="/assets/index-abc.css" />
      <link rel="stylesheet" href="/assets/extra-def.css" />
      <link rel="preload" href="/assets/index-abc.js" />
      <link rel="stylesheet" href="https://cdn.example.com/x.css" />
    </head>`;
    const out = extractSpaStylesheets(html);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('/assets/index-abc.css');
    expect(out[1]).toContain('/assets/extra-def.css');
    // Cross-origin stylesheet (not under /assets/) is not matched.
    expect(out.join()).not.toContain('cdn.example.com');
  });

  it('returns [] when there are no stylesheet links', () => {
    expect(extractSpaStylesheets('<head><title>x</title></head>')).toEqual([]);
  });
});

// ─── resolveCanonicalBase ─────────────────────────────────────────────────────

describe('resolveCanonicalBase', () => {
  it('uses the configured openGraph.url (trailing slashes stripped) when set', () => {
    const config = { frontend: { metadata: { openGraph: { url: 'https://my.brand.com/' } } } } as never;
    const url = new URL('https://abc123.exepad.app/a/abc123/');
    expect(resolveCanonicalBase(config, 'abc123', url)).toBe('https://my.brand.com');
  });

  it('falls back to same-origin for non-cloud hosts (self-host) so canonical never points at a domain it does not own', () => {
    const url = new URL('http://192.168.1.10:8080/a/abc123/');
    expect(resolveCanonicalBase(null, 'abc123', url)).toBe('http://192.168.1.10:8080');
  });

  it('falls back to the {appId}.exepad.app domain on a genuine cloud host', () => {
    const url = new URL('https://app.exepad.com/a/abc123/');
    expect(resolveCanonicalBase(null, 'abc123', url)).toBe('https://abc123.exepad.app');
  });
});

// ─── services.ts: static file serving headers + dispatch ──────────────────────
// dispatchFiles/dispatchMcp delegate to the app-backend over an in-process call.
// We stub that seam and the auth header-builder so the assertions isolate the
// header stamping (nosniff / CSP / CORS) that services.ts adds on the way back.

import { dispatchFiles, dispatchMcp } from '../../../../worker/src/routes/gateway/services';

describe('services.dispatchFiles — static file response hardening', () => {
  beforeEach(() => {
    mockAppBackend.mockReset();
  });

  it('forces X-Content-Type-Options: nosniff + script-src none CSP on a streamed GET file', async () => {
    // User-uploaded file the app-backend streams back — e.g. an SVG with no CSP.
    mockAppBackend.mockResolvedValue(
      new Response('<svg onload="alert(1)"></svg>', {
        status: 200,
        headers: { 'Content-Type': 'image/svg+xml' },
      }),
    );
    const req = new Request('http://gw/api/abc123/_files/42/logo.svg', { method: 'GET' });
    const res = await dispatchFiles(req, 'abc123', '42/logo.svg', {} as Env, 'published', null);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    // CSP fallback neutralizes inline/script execution for an HTML-ish upload.
    expect(res.headers.get('Content-Security-Policy')).toBe("script-src 'none'");
    // The upstream content-type is preserved (we do not let the browser sniff).
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
  });

  it('does not clobber a CSP the app-backend already set, but still adds nosniff', async () => {
    mockAppBackend.mockResolvedValue(
      new Response('data', {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Security-Policy': "default-src 'none'" },
      }),
    );
    const req = new Request('http://gw/api/abc123/_files/9/x.bin', { method: 'GET' });
    const res = await dispatchFiles(req, 'abc123', '9/x.bin', {} as Env, 'published', null);
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('forwards the GET fileSubPath verbatim to the app-backend (no re-resolution that could widen the path)', async () => {
    mockAppBackend.mockResolvedValue(new Response('ok', { status: 200 }));
    const req = new Request('http://gw/api/abc123/_files/a/b.txt', { method: 'GET' });
    await dispatchFiles(req, 'abc123', 'a/b.txt', {} as Env, 'published', null);
    // services.ts builds `files/${fileSubPath}` and hands the routing to the
    // app-backend; the path passed is exactly the caller's sub-path, with no
    // `..`-collapsing or join that the gateway performs itself.
    expect(mockAppBackend).toHaveBeenCalledTimes(1);
    const passedPath = mockAppBackend.mock.calls[0][1];
    expect(passedPath).toBe('files/a/b.txt');
  });

  it('propagates the upstream status (e.g. 404) for a missing file while still hardening headers', async () => {
    mockAppBackend.mockResolvedValue(new Response('not found', { status: 404 }));
    const req = new Request('http://gw/api/abc123/_files/missing.png', { method: 'GET' });
    const res = await dispatchFiles(req, 'abc123', 'missing.png', {} as Env, 'published', null);
    expect(res.status).toBe(404);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('returns 405 for an unsupported method without touching the app-backend', async () => {
    const req = new Request('http://gw/api/abc123/_files/x', { method: 'DELETE' });
    const res = await dispatchFiles(req, 'abc123', 'x', {} as Env, 'published', null);
    expect(res.status).toBe(405);
    expect(mockAppBackend).not.toHaveBeenCalled();
  });

  it('returns a structured WORKER_ERROR 500 when the app-backend throws', async () => {
    mockAppBackend.mockRejectedValue(new Error('boom'));
    const req = new Request('http://gw/api/abc123/_files/x.txt', { method: 'GET' });
    const res = await dispatchFiles(req, 'abc123', 'x.txt', {} as Env, 'published', null);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('WORKER_ERROR');
  });
});

describe('services.dispatchMcp — failure path', () => {
  it('returns 503 MCP-unavailable when the in-process dispatch throws', async () => {
    mockAppBackend.mockRejectedValue(new Error('worker down'));
    const req = new Request('http://gw/api/abc123/mcp', { method: 'POST' });
    const res = await dispatchMcp(req, 'abc123', {} as Env, 'published', null);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('MCP endpoint unavailable');
  });
});
