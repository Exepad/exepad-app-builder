/**
 * Platform Bridge Auth — fetch interceptor token injection
 *
 * Covers `installPlatformAuthInterceptor` (the global fetch wrapper) plus the
 * supporting token plumbing (`getPlatformAuthHeaders`, `getPlatformToken`).
 *
 * Security-critical invariants exercised here:
 *  - The X-Platform-Token header is injected ONLY on same-origin /api/* calls.
 *  - Cross-origin requests (incl. cross-origin /api/ paths) NEVER receive the
 *    token — leaking the HMAC bridge token to a third-party would defeat the
 *    whole cross-domain auth model.
 *  - Install is idempotent: calling twice must not double-wrap fetch.
 *  - Self-host mode (VITE_BACKEND_URL unset or '/') short-circuits the bridge.
 *
 * Because platformAuth.ts keeps module-level state (cached token, "already
 * installed" flag, and a build-time-captured BACKEND_URL), tests that need a
 * clean slate or a different env re-import the module via vi.resetModules() +
 * dynamic import(). The global window.fetch is saved/restored every test so a
 * leaked interceptor can't bleed into a sibling test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const STORAGE_KEY = 'exepad_platform_token';
const STORAGE_EXPIRY_KEY = 'exepad_platform_token_exp';

/** Seed sessionStorage with a valid (non-expired) bridge token. */
function seedToken(token: string, expiresInSec = 300): void {
  const expiry = Math.floor(Date.now() / 1000 + expiresInSec);
  window.sessionStorage.setItem(STORAGE_KEY, token);
  window.sessionStorage.setItem(STORAGE_EXPIRY_KEY, String(expiry));
}

/**
 * Import a pristine copy of the module. resetModules() drops module-level
 * caches/flags so each suite that needs isolation gets a fresh interceptor and
 * a freshly-captured BACKEND_URL (which is read from import.meta.env at load).
 */
async function freshModule() {
  vi.resetModules();
  return import('@/lib/platformAuth');
}

describe('platformAuth', () => {
  let originalFetch: typeof window.fetch;

  beforeEach(() => {
    originalFetch = window.fetch;
    window.sessionStorage.clear();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore the global fetch the interceptor may have monkey-patched.
    window.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // ── getPlatformAuthHeaders (synchronous token surfacing) ─────────────

  describe('getPlatformAuthHeaders', () => {
    it('returns the X-Platform-Token header when a valid token is cached', async () => {
      seedToken('bridge-token-abc');
      const { getPlatformAuthHeaders } = await freshModule();

      expect(getPlatformAuthHeaders()).toEqual({
        'X-Platform-Token': 'bridge-token-abc',
      });
    });

    it('returns an empty object when no token is present', async () => {
      const { getPlatformAuthHeaders } = await freshModule();

      expect(getPlatformAuthHeaders()).toEqual({});
    });

    it('ignores a token that is within the 30-second expiry buffer', async () => {
      // Expires in 20s — inside the 30s safety margin, so it must NOT be used.
      seedToken('soon-expiring', 20);
      const { getPlatformAuthHeaders } = await freshModule();

      expect(getPlatformAuthHeaders()).toEqual({});
    });

    it('ignores an already-expired token in storage', async () => {
      seedToken('expired-token', -300);
      const { getPlatformAuthHeaders } = await freshModule();

      expect(getPlatformAuthHeaders()).toEqual({});
    });
  });

  // ── installPlatformAuthInterceptor — header injection rules ──────────

  describe('installPlatformAuthInterceptor — injection', () => {
    it('injects X-Platform-Token on a relative /api/ request', async () => {
      seedToken('inject-me');
      const inner = vi.fn(async () => new Response('ok'));
      window.fetch = inner as unknown as typeof window.fetch;

      const { installPlatformAuthInterceptor } = await freshModule();
      installPlatformAuthInterceptor();

      await window.fetch('/api/users');

      expect(inner).toHaveBeenCalledTimes(1);
      const [, init] = inner.mock.calls[0] as [unknown, RequestInit];
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Platform-Token')).toBe('inject-me');
    });

    it('injects on an absolute same-origin /api/ URL', async () => {
      seedToken('same-origin-token');
      const inner = vi.fn(async () => new Response('ok'));
      window.fetch = inner as unknown as typeof window.fetch;

      const { installPlatformAuthInterceptor } = await freshModule();
      installPlatformAuthInterceptor();

      await window.fetch(`${location.origin}/api/data`);

      const [, init] = inner.mock.calls[0] as [unknown, RequestInit];
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Platform-Token')).toBe('same-origin-token');
    });

    it('handles a URL object pointing at a same-origin /api/ path', async () => {
      seedToken('url-object-token');
      const inner = vi.fn(async () => new Response('ok'));
      window.fetch = inner as unknown as typeof window.fetch;

      const { installPlatformAuthInterceptor } = await freshModule();
      installPlatformAuthInterceptor();

      await window.fetch(new URL('/api/widgets', location.origin));

      const [, init] = inner.mock.calls[0] as [unknown, RequestInit];
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Platform-Token')).toBe('url-object-token');
    });

    it('preserves existing headers when adding the platform token', async () => {
      seedToken('merge-token');
      const inner = vi.fn(async () => new Response('ok'));
      window.fetch = inner as unknown as typeof window.fetch;

      const { installPlatformAuthInterceptor } = await freshModule();
      installPlatformAuthInterceptor();

      await window.fetch('/api/data', {
        headers: { 'Content-Type': 'application/json', 'X-Custom': 'keep' },
      });

      const [, init] = inner.mock.calls[0] as [unknown, RequestInit];
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Platform-Token')).toBe('merge-token');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('X-Custom')).toBe('keep');
    });

    it('does NOT overwrite a caller-supplied X-Platform-Token', async () => {
      seedToken('cached-token');
      const inner = vi.fn(async () => new Response('ok'));
      window.fetch = inner as unknown as typeof window.fetch;

      const { installPlatformAuthInterceptor } = await freshModule();
      installPlatformAuthInterceptor();

      await window.fetch('/api/data', {
        headers: { 'X-Platform-Token': 'explicit-override' },
      });

      const [, init] = inner.mock.calls[0] as [unknown, RequestInit];
      const headers = new Headers(init?.headers);
      // Caller intent wins; the interceptor must not clobber it.
      expect(headers.get('X-Platform-Token')).toBe('explicit-override');
    });

    it('does NOT inject when no token is available, even on /api/', async () => {
      // No seedToken — interceptor should pass the request through untouched.
      const inner = vi.fn(async () => new Response('ok'));
      window.fetch = inner as unknown as typeof window.fetch;

      const { installPlatformAuthInterceptor } = await freshModule();
      installPlatformAuthInterceptor();

      await window.fetch('/api/data', { headers: { 'X-Custom': 'v' } });

      const [, init] = inner.mock.calls[0] as [unknown, RequestInit];
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Platform-Token')).toBeNull();
      // It also must not gratuitously rewrite init when there's nothing to add.
      expect(headers.get('X-Custom')).toBe('v');
    });
  });

  // ── installPlatformAuthInterceptor — NON-injection (security) ────────

  describe('installPlatformAuthInterceptor — token must NOT leak', () => {
    it('does NOT inject on a cross-origin /api/ request', async () => {
      seedToken('secret-token');
      const inner = vi.fn(async () => new Response('ok'));
      window.fetch = inner as unknown as typeof window.fetch;

      const { installPlatformAuthInterceptor } = await freshModule();
      installPlatformAuthInterceptor();

      // Same /api/ path but a different origin — the token must stay home.
      await window.fetch('https://evil.example.com/api/steal');

      const [, init] = inner.mock.calls[0] as [unknown, RequestInit];
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Platform-Token')).toBeNull();
    });

    it('does NOT inject on a same-origin NON-/api/ path', async () => {
      seedToken('secret-token');
      const inner = vi.fn(async () => new Response('ok'));
      window.fetch = inner as unknown as typeof window.fetch;

      const { installPlatformAuthInterceptor } = await freshModule();
      installPlatformAuthInterceptor();

      await window.fetch('/assets/logo.png');

      const [, init] = inner.mock.calls[0] as [unknown, RequestInit];
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Platform-Token')).toBeNull();
    });

    it('does NOT inject on a cross-origin non-/api/ request', async () => {
      seedToken('secret-token');
      const inner = vi.fn(async () => new Response('ok'));
      window.fetch = inner as unknown as typeof window.fetch;

      const { installPlatformAuthInterceptor } = await freshModule();
      installPlatformAuthInterceptor();

      await window.fetch('https://cdn.example.com/script.js');

      const [, init] = inner.mock.calls[0] as [unknown, RequestInit];
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Platform-Token')).toBeNull();
    });

    it('does NOT match a deceptive host whose path merely contains /api/', async () => {
      // A cross-origin URL like https://x.com/redirect?to=/api/ must not be
      // treated as same-origin. startsWith('/api/') is false and the absolute
      // form is cross-origin, so no token is injected.
      seedToken('secret-token');
      const inner = vi.fn(async () => new Response('ok'));
      window.fetch = inner as unknown as typeof window.fetch;

      const { installPlatformAuthInterceptor } = await freshModule();
      installPlatformAuthInterceptor();

      await window.fetch('https://attacker.test/redirect?next=/api/users');

      const [, init] = inner.mock.calls[0] as [unknown, RequestInit];
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Platform-Token')).toBeNull();
    });
  });

  // ── Idempotency / install semantics ─────────────────────────────────

  describe('installPlatformAuthInterceptor — install semantics', () => {
    it('is idempotent: calling install twice does not double-wrap fetch', async () => {
      seedToken('once-token');
      const inner = vi.fn(async () => new Response('ok'));
      window.fetch = inner as unknown as typeof window.fetch;

      const { installPlatformAuthInterceptor } = await freshModule();
      const afterFirst = (() => {
        installPlatformAuthInterceptor();
        return window.fetch;
      })();
      // Second install must be a no-op — same wrapped reference, no re-wrap.
      installPlatformAuthInterceptor();
      expect(window.fetch).toBe(afterFirst);

      await window.fetch('/api/data');

      // If double-wrapped, the inner spy would still fire once, but the header
      // set would have been applied twice. A single Headers.set is idempotent
      // anyway, so the strongest signal is the stable wrapper identity above.
      expect(inner).toHaveBeenCalledTimes(1);
    });

    it('does not re-wrap fetch on a second install even across module API calls', async () => {
      const inner = vi.fn(async () => new Response('ok'));
      window.fetch = inner as unknown as typeof window.fetch;

      const { installPlatformAuthInterceptor } = await freshModule();
      installPlatformAuthInterceptor();
      const wrapped = window.fetch;
      expect(wrapped).not.toBe(inner); // it did wrap once

      installPlatformAuthInterceptor();
      installPlatformAuthInterceptor();
      expect(window.fetch).toBe(wrapped);
    });

    it('forwards the original input argument unchanged to the underlying fetch', async () => {
      seedToken('fwd-token');
      const inner = vi.fn(async () => new Response('ok'));
      window.fetch = inner as unknown as typeof window.fetch;

      const { installPlatformAuthInterceptor } = await freshModule();
      installPlatformAuthInterceptor();

      const url = new URL('/api/items', location.origin);
      await window.fetch(url);

      // The first positional arg must be the exact same input object.
      expect(inner.mock.calls[0][0]).toBe(url);
    });

    it('returns the underlying response from the wrapped fetch', async () => {
      seedToken('resp-token');
      const sentinel = new Response('payload', { status: 201 });
      const inner = vi.fn(async () => sentinel);
      window.fetch = inner as unknown as typeof window.fetch;

      const { installPlatformAuthInterceptor } = await freshModule();
      installPlatformAuthInterceptor();

      const res = await window.fetch('/api/data');
      expect(res).toBe(sentinel);
      expect(res.status).toBe(201);
    });
  });

  // ── getPlatformToken — self-host short-circuit + fetch path ──────────

  describe('getPlatformToken — self-host short-circuit', () => {
    it('returns null without any network call when VITE_BACKEND_URL is unset', async () => {
      // Default test env has VITE_BACKEND_URL undefined → self-host mode.
      vi.stubEnv('VITE_BACKEND_URL', '');
      const fetchSpy = vi.fn(async () => new Response('{}'));
      window.fetch = fetchSpy as unknown as typeof window.fetch;
      vi.stubGlobal('fetch', fetchSpy);

      const { getPlatformToken } = await freshModule();
      const token = await getPlatformToken();

      expect(token).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns null without a network call when VITE_BACKEND_URL is '/'", async () => {
      vi.stubEnv('VITE_BACKEND_URL', '/');
      const fetchSpy = vi.fn(async () => new Response('{}'));
      window.fetch = fetchSpy as unknown as typeof window.fetch;
      vi.stubGlobal('fetch', fetchSpy);

      const { getPlatformToken } = await freshModule();
      const token = await getPlatformToken();

      expect(token).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('getPlatformToken — cloud mode fetch path', () => {
    it('fetches the bridge token credentialed from the configured backend', async () => {
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      const fetchSpy = vi.fn(async () =>
        new Response(JSON.stringify({ token: 'fresh-token', expires_in: 300 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      window.fetch = fetchSpy as unknown as typeof window.fetch;
      vi.stubGlobal('fetch', fetchSpy);

      const { getPlatformToken } = await freshModule();
      const token = await getPlatformToken();

      expect(token).toBe('fresh-token');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [reqUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(reqUrl).toBe('https://backend.exepad.com/api/auth/platform-bridge/');
      expect(init.credentials).toBe('include');
      // Token should now be persisted for the synchronous header path.
      expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe('fresh-token');
    });

    it('returns null on a non-ok backend response', async () => {
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      const fetchSpy = vi.fn(async () => new Response('nope', { status: 401 }));
      window.fetch = fetchSpy as unknown as typeof window.fetch;
      vi.stubGlobal('fetch', fetchSpy);

      const { getPlatformToken } = await freshModule();
      const token = await getPlatformToken();

      expect(token).toBeNull();
      expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('returns null when the backend fetch throws (network/CORS failure)', async () => {
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      const fetchSpy = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      window.fetch = fetchSpy as unknown as typeof window.fetch;
      vi.stubGlobal('fetch', fetchSpy);

      const { getPlatformToken } = await freshModule();
      const token = await getPlatformToken();

      expect(token).toBeNull();
    });

    it('deduplicates concurrent in-flight requests into a single fetch', async () => {
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      let resolveFetch: (r: Response) => void = () => {};
      const fetchSpy = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      );
      window.fetch = fetchSpy as unknown as typeof window.fetch;
      vi.stubGlobal('fetch', fetchSpy);

      const { getPlatformToken } = await freshModule();
      const p1 = getPlatformToken();
      const p2 = getPlatformToken();

      resolveFetch(
        new Response(JSON.stringify({ token: 'dedup-token', expires_in: 300 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const [t1, t2] = await Promise.all([p1, p2]);
      expect(t1).toBe('dedup-token');
      expect(t2).toBe('dedup-token');
      // Only ONE network request despite two callers.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('serves a subsequent call from the in-memory cache without re-fetching', async () => {
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      const fetchSpy = vi.fn(async () =>
        new Response(JSON.stringify({ token: 'cached', expires_in: 300 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      window.fetch = fetchSpy as unknown as typeof window.fetch;
      vi.stubGlobal('fetch', fetchSpy);

      const { getPlatformToken } = await freshModule();
      await getPlatformToken();
      const second = await getPlatformToken();

      expect(second).toBe('cached');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
