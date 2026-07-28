import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Env } from '../types/env';
import { hstsEnabledForHost, normalizeHost } from './custom-domains';

/**
 * Whether the runtime is serving an Exepad-cloud deployment (vs self-host).
 * Cloud emits a CSP that allow-lists the shared CDN + the *.exepad.com builder
 * as a frame-ancestor; self-host emits a clean same-origin CSP (no external CDN,
 * `frame-ancestors 'self'`) since there is no shared CDN and no cross-origin
 * builder embedding the preview.
 */
function isCloudEnvironment(environment: string | undefined): boolean {
  const env = (environment || '').toLowerCase();
  return env === 'production' || env === 'cloud';
}

/**
 * Build the Content-Security-Policy header value for the given nonce and
 * environment. Cloud keeps the existing policy (CDN + *.exepad.com ancestors);
 * self-host drops `https://cdn.exepad.com` from script-src/style-src (relies on
 * `'self'`) and uses `frame-ancestors 'self'`.
 */
export function buildCsp(nonce: string, environment: string | undefined): string {
  const cloud = isCloudEnvironment(environment);

  // Optional overrides let an operator point at a custom CDN / builder domain
  // without code changes; default to the Exepad cloud values for cloud.
  const cdnDomain = process.env.EXEPAD_CDN_DOMAIN || (cloud ? 'https://cdn.exepad.com' : '');
  const appDomain = process.env.EXEPAD_APP_DOMAIN || (cloud ? 'https://app.exepad.com https://*.exepad.com' : '');

  const cdnSuffix = cdnDomain ? ` ${cdnDomain}` : '';
  const frameAncestors = appDomain ? `'self' ${appDomain}` : `'self'`;

  // `esm.sh` serves arbitrary npm packages (effectively arbitrary JavaScript),
  // so allow-listing it in script-src lets any agent-emitted / prompt-injected
  // component pull executable code from a third party. Cloud relies on it for
  // runtime npm imports; self-host components load only from `'self'`, so it is
  // dropped there unless an operator explicitly opts back in with
  // EXEPAD_ALLOW_ESM_CDN=1. Keeps the XSS/supply-chain surface off by default
  // for LLM-generated code.
  const allowEsm =
    cloud || /^(1|true|yes|on)$/i.test((process.env.EXEPAD_ALLOW_ESM_CDN || '').trim());
  const esmSuffix = allowEsm ? ' https://esm.sh' : '';

  // Self-host drops plain `http:` from img-src so a malicious component can't
  // beacon stolen data out over cleartext (https images still render). Cloud is
  // left unchanged.
  const imgSrc = cloud
    ? `img-src 'self' data: blob: https: http:`
    : `img-src 'self' data: blob: https:`;

  // `connect-src 'self' https: wss:` lets a component fetch/beacon to ANY https
  // host — an exfiltration channel for an agent-emitted / prompt-injected
  // component. It stays the default because apps legitimately call third-party
  // APIs from the browser, but a security-conscious self-host operator can set
  // EXEPAD_STRICT_CONNECT_SRC=1 to narrow it to same-origin (plus an optional
  // operator-configured allowlist via EXEPAD_CONNECT_SRC_ALLOW, space-separated
  // origins). Cloud is left unchanged.
  const strictConnect =
    !cloud && /^(1|true|yes|on)$/i.test((process.env.EXEPAD_STRICT_CONNECT_SRC || '').trim());
  const connectAllow = strictConnect
    ? (process.env.EXEPAD_CONNECT_SRC_ALLOW || '').trim().replace(/\s+/g, ' ')
    : '';
  const connectSrc = strictConnect
    ? `connect-src 'self'${connectAllow ? ` ${connectAllow}` : ''}`
    : `connect-src 'self' https: wss:`;

  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'${esmSuffix}${cdnSuffix}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com${cdnSuffix}`,
    `font-src 'self' https://fonts.gstatic.com`,
    imgSrc,
    connectSrc,
    `frame-src 'self' https:`,
    `frame-ancestors ${frameAncestors}`,
    `worker-src 'self' blob:`,
  ].join('; ');
}

/**
 * Applies security headers to all responses.
 * Stores a CSP nonce on the context for use by the meta-injector.
 */
export function securityHeaders() {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const nonce = crypto.randomUUID();
    c.set('cspNonce' as never, nonce);

    await next();

    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-XSS-Protection', '1; mode=block');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    c.header(
      'Content-Security-Policy',
      buildCsp(nonce, c.env.ENVIRONMENT ?? process.env.ENVIRONMENT),
    );

    // HSTS is OFF by default and deliberately so: a self-signed/mkcert LAN cert
    // plus HSTS hard-pins browsers to HTTPS and would brick later plain-HTTP
    // access, and HSTS is ignored on a bare IP anyway. It is opt-in for stable
    // public domains only — enabled globally via EXEPAD_HSTS=1, or per-domain in
    // the Custom Domains panel — and only ever sent over a secure request.
    if (isSecureRequest(c)) {
      if (process.env.EXEPAD_HSTS === '1') {
        // Global opt-in: the operator owns the whole zone, so includeSubDomains
        // is intended.
        c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      } else if (hstsEnabledForHost(normalizeHost(c.req.header('host')))) {
        // Per-domain opt-in: only THIS host opted in, not its subtree — so NO
        // includeSubDomains (it would force HSTS onto sibling subdomains the
        // operator never enabled it for).
        c.header('Strict-Transport-Security', 'max-age=31536000');
      }
    }
  });
}

/** True when the original request reached the edge over HTTPS (direct TLS or via
 *  a TLS-terminating proxy's X-Forwarded-Proto/Scheme). */
function isSecureRequest(c: Context<{ Bindings: Env }>): boolean {
  try {
    if (new URL(c.req.url).protocol === 'https:') return true;
  } catch {
    /* ignore */
  }
  return (
    c.req.header('x-forwarded-proto') === 'https' ||
    c.req.header('x-forwarded-scheme') === 'https'
  );
}
