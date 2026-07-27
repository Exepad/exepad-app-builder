/**
 * Remote-Import Allowlist Tests (RCE gate)
 *
 * `isAllowedUrl` / `validateRemoteUrl` are the ONLY gate before the runtime
 * performs a dynamic `import()` of remote JavaScript. A false-accept here is a
 * remote-code-execution vector, so the bias is: over-reject, never over-accept.
 *
 * Default vitest env reports `import.meta.env.MODE === 'test'`, which the
 * validator treats as production (HTTPS-only, no localhost/dev domains). Tests
 * that need the development branch flip MODE via `vi.stubEnv` and restore it in
 * an afterEach.
 *
 * Source: client/src/app_runtime/runtime/components/custom/code/urlValidator.ts
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isAllowedUrl,
  validateRemoteUrl,
  getAllowedDomainsList,
  RemoteUrlValidationError,
} from '@/runtime/components/custom/code/urlValidator';

// Restore any MODE stub after every test so the "production" default holds.
afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// ACCEPT — legitimate remote sources
// ---------------------------------------------------------------------------
describe('isAllowedUrl — accepts legitimate CDN sources (production)', () => {
  it('accepts the exact allowed domain over https with a .js path', () => {
    const r = isAllowedUrl('https://cdn.exepad.com/components/hero.js');
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.parsedUrl?.hostname).toBe('cdn.exepad.com');
  });

  it('accepts a .mjs ES-module path on the allowed domain', () => {
    expect(isAllowedUrl('https://cdn.exepad.com/components/hero.mjs').allowed).toBe(true);
  });

  it('accepts a legitimate subdomain of an allowed domain', () => {
    // sub.cdn.exepad.com is genuinely under cdn.exepad.com per the policy.
    const r = isAllowedUrl('https://sub.cdn.exepad.com/x.js');
    expect(r.allowed).toBe(true);
    expect(r.parsedUrl?.hostname).toBe('sub.cdn.exepad.com');
  });

  it('rejects the shared multi-tenant GCS host (removed from the allowlist)', () => {
    // storage.googleapis.com was dropped from the default allowlist: it is a
    // shared host, so allowlisting it (with subdomain suffix matching) trusted
    // any GCS bucket for arbitrary dynamic import(). Remote CDNs are now an
    // explicit operator opt-in.
    expect(isAllowedUrl('https://storage.googleapis.com/bucket/x.js').allowed).toBe(false);
  });

  it('accepts a uppercase-scheme/host URL (URL parser lowercases them)', () => {
    expect(isAllowedUrl('HTTPS://CDN.EXEPAD.COM/x.js').allowed).toBe(true);
  });

  it('accepts an uppercase .JS extension (extension check is case-insensitive)', () => {
    expect(isAllowedUrl('https://cdn.exepad.com/x.JS').allowed).toBe(true);
  });

  it('accepts a .js path with a query string or fragment (pathname-based check)', () => {
    expect(isAllowedUrl('https://cdn.exepad.com/x.js?v=1').allowed).toBe(true);
    expect(isAllowedUrl('https://cdn.exepad.com/x.js#frag').allowed).toBe(true);
  });

  it('accepts a same-origin relative .js / .mjs path', () => {
    expect(isAllowedUrl('/runtime_assets/compiled/hero.js').allowed).toBe(true);
    expect(isAllowedUrl('/runtime_assets/compiled/hero.mjs').allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REJECT — domain spoofing / allowlist bypass vectors
// ---------------------------------------------------------------------------
describe('isAllowedUrl — rejects domain-spoofing vectors', () => {
  it('rejects a lookalike prefix domain (evilcdn.exepad.com)', () => {
    // Must NOT match cdn.exepad.com via a naive substring/prefix check.
    const r = isAllowedUrl('https://evilcdn.exepad.com/x.js');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/not in the allowed list/);
  });

  it('rejects an allowed-domain-as-prefix suffix attack (cdn.exepad.com.attacker.net)', () => {
    const r = isAllowedUrl('https://cdn.exepad.com.attacker.net/x.js');
    expect(r.allowed).toBe(false);
    expect(r.parsedUrl?.hostname).toBe('cdn.exepad.com.attacker.net');
  });

  it('rejects a bare apex that is only a parent of the allowed domain (exepad.com)', () => {
    // exepad.com is NOT allowlisted; only cdn.exepad.com is.
    expect(isAllowedUrl('https://exepad.com/x.js').allowed).toBe(false);
    expect(isAllowedUrl('https://exepad.com.evil.net/x.js').allowed).toBe(false);
  });

  it('rejects the userinfo-host confusion trick (real host is evil.com)', () => {
    // https://cdn.exepad.com@evil.com/x.js — the URL parser resolves the host
    // to evil.com; the allowlist must key off the parsed hostname, not the raw
    // string before the @.
    const r = isAllowedUrl('https://cdn.exepad.com@evil.com/x.js');
    expect(r.allowed).toBe(false);
    expect(r.parsedUrl?.hostname).toBe('evil.com');
  });

  it('rejects a protocol-relative URL (//evil.com/x.js) — not treated as same-origin', () => {
    // isSameOriginPath explicitly excludes "//" so this falls through to URL
    // parsing, which throws without a base → rejected.
    const r = isAllowedUrl('//evil.com/x.js');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Invalid URL format/);
  });

  it('rejects a completely foreign domain', () => {
    expect(isAllowedUrl('https://evil.com/malware.js').allowed).toBe(false);
  });

  it('rejects a trailing-dot FQDN form of the allowed domain (cdn.exepad.com.)', () => {
    // Over-rejection is the safe outcome: the trailing-dot host does not match
    // the allowlist entry. (A false-accept here would be a bypass.)
    const r = isAllowedUrl('https://cdn.exepad.com./x.js');
    expect(r.allowed).toBe(false);
    expect(r.parsedUrl?.hostname).toBe('cdn.exepad.com.');
  });
});

// ---------------------------------------------------------------------------
// REJECT — protocol / scheme vectors
// ---------------------------------------------------------------------------
describe('isAllowedUrl — rejects dangerous and non-https schemes (production)', () => {
  it('rejects plain http on an otherwise-allowed domain in production', () => {
    const r = isAllowedUrl('http://cdn.exepad.com/x.js');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Only HTTPS URLs are allowed in production/);
  });

  it('rejects javascript: scheme', () => {
    expect(isAllowedUrl('javascript:import("https://evil.com/x.js")').allowed).toBe(false);
  });

  it('rejects data: scheme', () => {
    expect(isAllowedUrl('data:text/javascript,alert(1)').allowed).toBe(false);
  });

  it('rejects blob: scheme even when the inner URL names an allowed host', () => {
    expect(isAllowedUrl('blob:https://cdn.exepad.com/uuid-here').allowed).toBe(false);
  });

  it('rejects file: scheme', () => {
    expect(isAllowedUrl('file:///etc/passwd.js').allowed).toBe(false);
  });

  it('rejects ftp: scheme', () => {
    expect(isAllowedUrl('ftp://cdn.exepad.com/x.js').allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REJECT — extension gate
// ---------------------------------------------------------------------------
describe('isAllowedUrl — enforces the .js/.mjs extension gate', () => {
  it('rejects an html resource on an allowed domain', () => {
    const r = isAllowedUrl('https://cdn.exepad.com/evil.html');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/must point to a JavaScript file/);
  });

  it('rejects an extensionless path on an allowed domain', () => {
    expect(isAllowedUrl('https://cdn.exepad.com/components/hero').allowed).toBe(false);
  });

  it('rejects a .json (data, not module) path', () => {
    expect(isAllowedUrl('https://cdn.exepad.com/manifest.json').allowed).toBe(false);
  });

  it('rejects a same-origin path without a .js/.mjs extension', () => {
    const r = isAllowedUrl('/runtime_assets/compiled/hero');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/must point to a JavaScript file/);
  });

  it('does NOT let a query-string suffix smuggle a fake extension on absolute URLs', () => {
    // pathname is /evil.html; the ?x=.js must not satisfy the .js check.
    expect(isAllowedUrl('https://cdn.exepad.com/evil.html?x=.js').allowed).toBe(false);
  });

  // Regression: the same-origin branch must resolve the pathname before the
  // extension check so a query/fragment cannot fake the extension. Previously
  // the raw string was tested, so /evil.html?x=.js was wrongly accepted and the
  // fetched resource (evil.html) would have been dynamic-import()ed.
  it('rejects a same-origin .html path whose extension is faked via the query string', () => {
    expect(isAllowedUrl('/evil.html?x=.js').allowed).toBe(false);
  });

  it('rejects a same-origin .html path whose extension is faked via the fragment', () => {
    expect(isAllowedUrl('/evil.html#x.js').allowed).toBe(false);
  });

  it('still accepts a genuine same-origin .js path with a cache-busting query', () => {
    // pathname is /assets/hero.js → the ?v=1 must not change the verdict.
    expect(isAllowedUrl('/assets/hero.js?v=1').allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REJECT — empty / malformed / non-string input (must never throw)
// ---------------------------------------------------------------------------
describe('isAllowedUrl — handles empty/malformed input without throwing', () => {
  it('rejects an empty string', () => {
    const r = isAllowedUrl('');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it('rejects a whitespace-only string', () => {
    const r = isAllowedUrl('   \t\n  ');
    expect(r.allowed).toBe(false);
  });

  it('rejects null without throwing', () => {
    expect(() => isAllowedUrl(null as unknown as string)).not.toThrow();
    expect(isAllowedUrl(null as unknown as string).allowed).toBe(false);
  });

  it('rejects undefined without throwing', () => {
    expect(() => isAllowedUrl(undefined as unknown as string)).not.toThrow();
    expect(isAllowedUrl(undefined as unknown as string).allowed).toBe(false);
  });

  it('rejects a non-string value without throwing', () => {
    expect(() => isAllowedUrl(42 as unknown as string)).not.toThrow();
    expect(isAllowedUrl(42 as unknown as string).allowed).toBe(false);
    expect(isAllowedUrl({} as unknown as string).allowed).toBe(false);
  });

  it('rejects a garbage non-URL string', () => {
    expect(isAllowedUrl('not a url at all').allowed).toBe(false);
  });

  it('trims surrounding whitespace before validating a real URL', () => {
    expect(isAllowedUrl('  https://cdn.exepad.com/x.js  ').allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Development-mode behavior (MODE === 'development')
// ---------------------------------------------------------------------------
describe('isAllowedUrl — development mode relaxations', () => {
  it('exposes localhost dev domains only in development', () => {
    expect(getAllowedDomainsList()).not.toContain('localhost');
    vi.stubEnv('MODE', 'development');
    expect(getAllowedDomainsList()).toContain('localhost');
  });

  it('allows http://localhost in development', () => {
    vi.stubEnv('MODE', 'development');
    expect(isAllowedUrl('http://localhost:3001/x.js').allowed).toBe(true);
  });

  it('still rejects a foreign domain in development', () => {
    vi.stubEnv('MODE', 'development');
    expect(isAllowedUrl('http://evil.com/x.js').allowed).toBe(false);
  });

  it('still rejects javascript: scheme in development', () => {
    vi.stubEnv('MODE', 'development');
    const r = isAllowedUrl('javascript:alert(1)');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Only HTTP and HTTPS protocols are allowed/);
  });

  it('still enforces the .js extension on localhost in development', () => {
    vi.stubEnv('MODE', 'development');
    expect(isAllowedUrl('http://localhost:3001/evil.html').allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateRemoteUrl — throwing variant
// ---------------------------------------------------------------------------
describe('validateRemoteUrl — throwing wrapper', () => {
  it('returns the parsed URL for an allowed input', () => {
    const url = validateRemoteUrl('https://cdn.exepad.com/x.js');
    expect(url).toBeInstanceOf(URL);
    expect(url.hostname).toBe('cdn.exepad.com');
  });

  it('throws RemoteUrlValidationError for a disallowed domain', () => {
    expect(() => validateRemoteUrl('https://evil.com/x.js')).toThrow(RemoteUrlValidationError);
  });

  it('carries the offending url and reason on the thrown error', () => {
    try {
      validateRemoteUrl('https://evil.com/x.js');
      throw new Error('expected validateRemoteUrl to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RemoteUrlValidationError);
      const e = err as RemoteUrlValidationError;
      expect(e.url).toBe('https://evil.com/x.js');
      expect(e.reason).toMatch(/not in the allowed list/);
      expect(e.name).toBe('RemoteUrlValidationError');
    }
  });

  it('throws (does not silently return undefined) for empty input', () => {
    expect(() => validateRemoteUrl('')).toThrow(RemoteUrlValidationError);
  });

  it('throws for the userinfo-host spoofing trick', () => {
    expect(() => validateRemoteUrl('https://cdn.exepad.com@evil.com/x.js')).toThrow(
      RemoteUrlValidationError,
    );
  });
});
