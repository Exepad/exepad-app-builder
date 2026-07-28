/**
 * origin.ts — the credentialed-CORS trust boundary.
 *
 * `resolveAllowedOrigin` decides which Origin gets echoed back into
 * `Access-Control-Allow-Origin` *together with*
 * `Access-Control-Allow-Credentials: true`. A regression here is a
 * cross-origin credential-theft hole, so coverage MUST nail the
 * allowlist anchoring (suffix-confusion like `exepad.com.evil.io`),
 * the never-echo-credentials-with-`*` invariant, the
 * `EXEPAD_ALLOWED_ORIGINS` parser (commas/pipes/whitespace/empty),
 * and null/empty/malformed Origin handling.
 *
 * NOTE: the effective allowlist is now read LAZILY (per call) from net-config —
 * the operator's `net.allowed_origins` store override, falling back to
 * `process.env.EXEPAD_ALLOWED_ORIGINS`. The env-driven cases therefore use a
 * `loadWithEnv()` helper that sets the var, `vi.resetModules()`, and re-imports
 * the module fresh; because the parse is lazy, the var must stay set THROUGH the
 * assertions and is cleared in `afterEach`. Env-independent behavior uses the
 * top-level static import. (No DB is configured here, so store reads are empty and
 * the env seed governs — exactly the pre-store behavior.)
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  resolveAllowedOrigin,
  applyCorsHeaders,
  buildCorsHeaders,
} from '../../../../worker/src/lib/origin';

/**
 * Re-import origin.ts with a specific EXEPAD_ALLOWED_ORIGINS value. The var is left
 * SET (cleared by afterEach) because origin.ts reads it lazily on each call, not at
 * import time. Returns the fresh module exports.
 */
async function loadWithEnv(raw: string | undefined) {
  vi.resetModules();
  if (raw === undefined) {
    delete process.env.EXEPAD_ALLOWED_ORIGINS;
  } else {
    process.env.EXEPAD_ALLOWED_ORIGINS = raw;
  }
  return import('../../../../worker/src/lib/origin');
}

describe('resolveAllowedOrigin — built-in HTTPS allowlist', () => {
  // The vendor-origin allowance is CLOUD-ONLY. Exepad's hosted product is a
  // separate codebase, so a self-hosted instance must not extend credentialed
  // CORS to exepad.com / *.exepad.app. `ENVIRONMENT` is read live, and unset
  // means self-host (matching docker/entrypoint.sh and build-runtime-env.ts).
  const asCloud = () => {
    process.env.ENVIRONMENT = 'production';
  };
  afterEach(() => {
    delete process.env.ENVIRONMENT;
  });

  // ── Exact configured origins ─────────────────────────────────────
  it('accepts the exact https://exepad.com origin on cloud', () => {
    asCloud();
    expect(resolveAllowedOrigin('https://exepad.com')).toBe('https://exepad.com');
  });

  it('accepts the exact https://app.exepad.com origin on cloud', () => {
    asCloud();
    expect(resolveAllowedOrigin('https://app.exepad.com')).toBe('https://app.exepad.com');
  });

  // ── Subdomain suffix matching (legitimate) ───────────────────────
  it('accepts arbitrary *.exepad.com subdomains on cloud', () => {
    asCloud();
    expect(resolveAllowedOrigin('https://myapp.exepad.com')).toBe('https://myapp.exepad.com');
    expect(resolveAllowedOrigin('https://a.b.exepad.com')).toBe('https://a.b.exepad.com');
  });

  it('accepts *.exepad.app subdomains on cloud', () => {
    asCloud();
    expect(resolveAllowedOrigin('https://demo.exepad.app')).toBe('https://demo.exepad.app');
  });

  it('preserves an explicit port on an accepted origin', () => {
    asCloud();
    // URL.origin keeps the port; the allowlist matches on hostname.
    expect(resolveAllowedOrigin('https://app.exepad.com:8443')).toBe(
      'https://app.exepad.com:8443',
    );
  });

  // ── Self-host rejects every vendor origin ────────────────────────
  it('rejects all vendor origins on self-host (the shipped default)', () => {
    // ENVIRONMENT unset — self-host by default.
    expect(resolveAllowedOrigin('https://exepad.com')).toBeNull();
    expect(resolveAllowedOrigin('https://app.exepad.com')).toBeNull();
    expect(resolveAllowedOrigin('https://myapp.exepad.com')).toBeNull();
    expect(resolveAllowedOrigin('https://demo.exepad.app')).toBeNull();
  });

  it('rejects vendor origins when ENVIRONMENT is explicitly selfhost', () => {
    process.env.ENVIRONMENT = 'selfhost';
    expect(resolveAllowedOrigin('https://exepad.com')).toBeNull();
    expect(resolveAllowedOrigin('https://demo.exepad.app')).toBeNull();
  });

  // ── Suffix / anchoring confusion (the core attack) ───────────────
  it('REJECTS suffix-confusion host exepad.com.evil.io', () => {
    expect(resolveAllowedOrigin('https://exepad.com.evil.io')).toBeNull();
  });

  it('REJECTS a domain that merely ends with the literal "exepad.com" without a dot boundary', () => {
    // `notexepad.com` must not be treated as a subdomain of exepad.com.
    expect(resolveAllowedOrigin('https://notexepad.com')).toBeNull();
    expect(resolveAllowedOrigin('https://evilexepad.com')).toBeNull();
  });

  it('REJECTS exepad.app suffix confusion (exepad.app.evil.io)', () => {
    expect(resolveAllowedOrigin('https://exepad.app.evil.io')).toBeNull();
  });

  it('REJECTS an attacker domain that prefixes the allowlisted host as a path/userinfo trick', () => {
    // userinfo-style trick: real host is evil.io, not exepad.com.
    expect(resolveAllowedOrigin('https://exepad.com@evil.io')).toBeNull();
  });

  it('REJECTS unrelated external origins', () => {
    expect(resolveAllowedOrigin('https://evil.com')).toBeNull();
    expect(resolveAllowedOrigin('https://google.com')).toBeNull();
  });

  // ── Protocol enforcement for cloud hosts ─────────────────────────
  it('REJECTS http:// for an otherwise-allowed cloud subdomain (no plaintext credentials)', () => {
    expect(resolveAllowedOrigin('http://app.exepad.com')).toBeNull();
    expect(resolveAllowedOrigin('http://myapp.exepad.com')).toBeNull();
  });

  it('REJECTS non-http(s) schemes outright', () => {
    expect(resolveAllowedOrigin('ftp://app.exepad.com')).toBeNull();
    expect(resolveAllowedOrigin('file:///etc/passwd')).toBeNull();
  });
});

describe('resolveAllowedOrigin — localhost loopback', () => {
  it('accepts http://localhost with a port', () => {
    expect(resolveAllowedOrigin('http://localhost:3001')).toBe('http://localhost:3001');
  });

  it('accepts http://127.0.0.1', () => {
    expect(resolveAllowedOrigin('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
  });

  it('does NOT treat https://localhost as a loopback short-circuit (falls through to https rules and is rejected)', () => {
    // isAllowedLocalOrigin only matches http:; https://localhost is not on the
    // cloud allowlist, so it must be rejected.
    expect(resolveAllowedOrigin('https://localhost:3001')).toBeNull();
  });

  it('REJECTS a host that merely contains "localhost" as a substring', () => {
    expect(resolveAllowedOrigin('http://localhost.evil.io')).toBeNull();
    expect(resolveAllowedOrigin('http://notlocalhost')).toBeNull();
  });

  it('REJECTS other loopback-ish addresses not in the loopback allowlist', () => {
    // Only 127.0.0.1 / localhost are loopback-allowed by name.
    expect(resolveAllowedOrigin('http://0.0.0.0:8080')).toBeNull();
    expect(resolveAllowedOrigin('http://[::1]:8080')).toBeNull();
  });
});

describe('resolveAllowedOrigin — null / empty / malformed input', () => {
  it('returns null for null Origin', () => {
    expect(resolveAllowedOrigin(null)).toBeNull();
  });

  it('returns null for undefined Origin', () => {
    expect(resolveAllowedOrigin(undefined)).toBeNull();
  });

  it('returns null for empty-string Origin', () => {
    expect(resolveAllowedOrigin('')).toBeNull();
  });

  it('returns null for the literal "null" origin (sandboxed iframe / opaque origin)', () => {
    // Browsers send `Origin: null` for opaque origins; it must never be echoed.
    expect(resolveAllowedOrigin('null')).toBeNull();
  });

  it('returns null for a non-URL garbage string', () => {
    expect(resolveAllowedOrigin('not a url')).toBeNull();
    expect(resolveAllowedOrigin('://missing-scheme')).toBeNull();
  });

  it('returns null and does not throw on a wildcard string', () => {
    expect(resolveAllowedOrigin('*')).toBeNull();
  });
});

describe('resolveAllowedOrigin — EXEPAD_ALLOWED_ORIGINS self-host allowlist', () => {
  beforeEach(() => {
    process.env.ENVIRONMENT = 'production';
  });
  afterEach(() => {
    delete process.env.ENVIRONMENT;
    delete process.env.EXEPAD_ALLOWED_ORIGINS;
    vi.resetModules();
  });

  it('accepts a configured full https origin (both the host echoes back exactly)', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv('https://app.company.com');
    expect(resolve('https://app.company.com')).toBe('https://app.company.com');
  });

  it('accepts a configured host over BOTH http and https (LAN / TLS-terminating proxy)', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv('https://app.company.com');
    // Env-listed hosts are matched by host[:port] for either protocol.
    expect(resolve('http://app.company.com')).toBe('http://app.company.com');
    expect(resolve('https://app.company.com')).toBe('https://app.company.com');
  });

  it('accepts a bare host:port entry against the request host', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv('192.168.1.10:8080');
    expect(resolve('http://192.168.1.10:8080')).toBe('http://192.168.1.10:8080');
    expect(resolve('https://192.168.1.10:8080')).toBe('https://192.168.1.10:8080');
  });

  it('does NOT match a bare-host entry when the request carries a different port', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv('192.168.1.10:8080');
    // host includes the port — a different port is a different host.
    expect(resolve('http://192.168.1.10:9090')).toBeNull();
  });

  it('accepts a *.suffix wildcard entry for subdomains', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv('*.company.com');
    expect(resolve('https://app.company.com')).toBe('https://app.company.com');
    expect(resolve('http://intranet.company.com')).toBe('http://intranet.company.com');
  });

  it('REJECTS suffix-confusion against a *.suffix wildcard (company.com.evil.io)', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv('*.company.com');
    // The leading dot anchors the suffix: `.company.com` must end the host.
    expect(resolve('https://app.company.com.evil.io')).toBeNull();
    expect(resolve('https://evilcompany.com')).toBeNull();
  });

  it('REJECTS a host not present in the env allowlist', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv('https://app.company.com');
    expect(resolve('https://other.company.com')).toBeNull();
    expect(resolve('https://evil.io')).toBeNull();
  });

  it('still honors the built-in cloud allowlist when env is set', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv('https://app.company.com');
    expect(resolve('https://app.exepad.com')).toBe('https://app.exepad.com');
  });

  it('matches env hosts case-insensitively', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv('App.Company.COM');
    // Rule host is lowercased; request host is lowercased before compare.
    expect(resolve('https://app.company.com')).toBe('https://app.company.com');
  });
});

describe('parseEnvAllowedOrigins — parsing (commas / pipes / whitespace / empty)', () => {
  beforeEach(() => {
    process.env.ENVIRONMENT = 'production';
  });
  afterEach(() => {
    delete process.env.ENVIRONMENT;
    delete process.env.EXEPAD_ALLOWED_ORIGINS;
    vi.resetModules();
  });

  it('treats an unset env var as an empty allowlist (only built-ins apply)', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv(undefined);
    expect(resolve('https://app.company.com')).toBeNull();
    // Built-ins still work.
    expect(resolve('https://exepad.com')).toBe('https://exepad.com');
  });

  it('treats an empty-string env var as an empty allowlist', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv('');
    expect(resolve('https://app.company.com')).toBeNull();
  });

  it('treats a whitespace-only env var as an empty allowlist', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv('   ');
    expect(resolve('https://app.company.com')).toBeNull();
  });

  it('parses comma-separated entries', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv(
      'https://a.company.com,https://b.company.com',
    );
    expect(resolve('https://a.company.com')).toBe('https://a.company.com');
    expect(resolve('https://b.company.com')).toBe('https://b.company.com');
    expect(resolve('https://c.company.com')).toBeNull();
  });

  it('parses pipe-separated entries', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv(
      'https://a.company.com|https://b.company.com',
    );
    expect(resolve('https://a.company.com')).toBe('https://a.company.com');
    expect(resolve('https://b.company.com')).toBe('https://b.company.com');
  });

  it('parses a mix of commas and pipes', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv(
      'https://a.company.com|https://b.company.com,*.lan.local',
    );
    expect(resolve('https://a.company.com')).toBe('https://a.company.com');
    expect(resolve('https://b.company.com')).toBe('https://b.company.com');
    expect(resolve('http://box.lan.local')).toBe('http://box.lan.local');
  });

  it('trims surrounding whitespace around each entry', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv(
      '  https://a.company.com  ,  https://b.company.com  ',
    );
    expect(resolve('https://a.company.com')).toBe('https://a.company.com');
    expect(resolve('https://b.company.com')).toBe('https://b.company.com');
  });

  it('skips empty entries from doubled/leading/trailing separators', async () => {
    const { resolveAllowedOrigin: resolve } = await loadWithEnv(
      ',,https://a.company.com,,|,https://b.company.com,,',
    );
    expect(resolve('https://a.company.com')).toBe('https://a.company.com');
    expect(resolve('https://b.company.com')).toBe('https://b.company.com');
    // An empty entry must NOT become a catch-all that allows everything.
    expect(resolve('https://evil.io')).toBeNull();
  });

  it('silently ignores a malformed full-origin entry but still honors valid siblings', async () => {
    // `https://` with no host throws in new URL(); that entry is dropped.
    const { resolveAllowedOrigin: resolve } = await loadWithEnv(
      'https://,https://good.company.com',
    );
    expect(resolve('https://good.company.com')).toBe('https://good.company.com');
  });

  it('an empty entry never matches an empty / opaque request host', async () => {
    // Defensive: even with junk separators, `Origin: null` stays rejected.
    const { resolveAllowedOrigin: resolve } = await loadWithEnv(', , ,');
    expect(resolve('null')).toBeNull();
    expect(resolve('')).toBeNull();
  });
});

describe('applyCorsHeaders — credentialed echo + wildcard safety', () => {
  // These exercise CORS mechanics using a vendor origin as a known-allowed
  // origin, so they need the cloud environment — on self-host (the default)
  // vendor origins are no longer allowlisted. See the built-in allowlist block.
  beforeEach(() => {
    process.env.ENVIRONMENT = 'production';
  });
  afterEach(() => {
    delete process.env.ENVIRONMENT;
  });

  it('echoes an allowed origin with Allow-Credentials:true and Vary:Origin', () => {
    const headers = new Headers();
    applyCorsHeaders(headers, 'https://app.exepad.com');
    expect(headers.get('Access-Control-Allow-Origin')).toBe('https://app.exepad.com');
    expect(headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(headers.get('Vary')).toContain('Origin');
  });

  it('omits Allow-Credentials when allowCredentials:false even for an allowed origin', () => {
    const headers = new Headers();
    applyCorsHeaders(headers, 'https://app.exepad.com', { allowCredentials: false });
    expect(headers.get('Access-Control-Allow-Origin')).toBe('https://app.exepad.com');
    expect(headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('does NOT set Allow-Origin (and no credentials) for a rejected origin without wildcard', () => {
    const headers = new Headers();
    applyCorsHeaders(headers, 'https://evil.com');
    expect(headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(headers.get('Access-Control-Allow-Credentials')).toBeNull();
    // Vary:Origin is still set so caches don't poison across origins.
    expect(headers.get('Vary')).toContain('Origin');
  });

  it('SECURITY: wildcard fallback for a rejected origin is NEVER paired with credentials', () => {
    const headers = new Headers();
    applyCorsHeaders(headers, 'https://evil.com', { allowWildcard: true });
    expect(headers.get('Access-Control-Allow-Origin')).toBe('*');
    // `*` + credentials is the forbidden combination — must be absent.
    expect(headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('SECURITY: never emits a wildcard for the suffix-confusion host exepad.com.evil.io', () => {
    const headers = new Headers();
    applyCorsHeaders(headers, 'https://exepad.com.evil.io');
    expect(headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('prefers the specific allowed origin over wildcard even when allowWildcard:true', () => {
    const headers = new Headers();
    applyCorsHeaders(headers, 'https://app.exepad.com', { allowWildcard: true });
    // An allowlisted origin gets the credentialed specific echo, not `*`.
    expect(headers.get('Access-Control-Allow-Origin')).toBe('https://app.exepad.com');
    expect(headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('handles null / empty origin without setting an Allow-Origin header', () => {
    for (const origin of [null, undefined, '']) {
      const headers = new Headers();
      applyCorsHeaders(headers, origin);
      expect(headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(headers.get('Access-Control-Allow-Credentials')).toBeNull();
      expect(headers.get('Vary')).toContain('Origin');
    }
  });

  it('merges Origin into a pre-existing Vary header without duplicating it', () => {
    const headers = new Headers({ Vary: 'Accept-Encoding' });
    applyCorsHeaders(headers, 'https://app.exepad.com');
    const vary = headers.get('Vary') || '';
    expect(vary).toContain('Accept-Encoding');
    expect(vary).toContain('Origin');
    // Idempotent: applying again must not add a second `Origin`.
    applyCorsHeaders(headers, 'https://app.exepad.com');
    const occurrences = (headers.get('Vary') || '').split(',').filter((p) => p.trim() === 'Origin');
    expect(occurrences).toHaveLength(1);
  });

  it('clears a stale Allow-Credentials when a later rejected origin is applied to the same headers', () => {
    const headers = new Headers();
    applyCorsHeaders(headers, 'https://app.exepad.com');
    expect(headers.get('Access-Control-Allow-Credentials')).toBe('true');
    // Re-applying with a rejected origin must scrub the credential header.
    applyCorsHeaders(headers, 'https://evil.com');
    expect(headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('buildCorsHeaders — record shape', () => {
  // These exercise CORS mechanics using a vendor origin as a known-allowed
  // origin, so they need the cloud environment — on self-host (the default)
  // vendor origins are no longer allowlisted. See the built-in allowlist block.
  beforeEach(() => {
    process.env.ENVIRONMENT = 'production';
  });
  afterEach(() => {
    delete process.env.ENVIRONMENT;
  });

  // buildCorsHeaders drains the Headers via forEach; under the configured
  // happy-dom environment that yields canonical (title-cased) header names.
  it('returns a plain object with the credentialed echo for an allowed origin', () => {
    const result = buildCorsHeaders('https://app.exepad.com');
    expect(result['Access-Control-Allow-Origin']).toBe('https://app.exepad.com');
    expect(result['Access-Control-Allow-Credentials']).toBe('true');
    expect(result['Vary']).toContain('Origin');
  });

  it('SECURITY: wildcard record never includes Allow-Credentials', () => {
    const result = buildCorsHeaders('https://evil.com', { allowWildcard: true });
    expect(result['Access-Control-Allow-Origin']).toBe('*');
    expect(result['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('omits Allow-Origin entirely for a rejected origin with no wildcard', () => {
    const result = buildCorsHeaders('https://evil.com');
    expect(result['Access-Control-Allow-Origin']).toBeUndefined();
    expect(result['Access-Control-Allow-Credentials']).toBeUndefined();
    expect(result['Vary']).toContain('Origin');
  });
});
