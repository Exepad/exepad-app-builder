/**
 * JWT Helper — async / cross-window half
 *
 * Covers the network + postMessage surfaces of `client/src/lib/jwt-helper.ts`
 * that the existing `jwt-helper.test.ts` (sync getters) does not touch:
 *
 *   - requestJWTTokenFromParent  — the postMessage round-trip and, crucially,
 *     the ORIGIN guard: a `message` whose `event.origin !== getEditorOrigin()`
 *     must be IGNORED (no token accepted, no storage write). This is the
 *     security seam — a malicious frame must not be able to inject a JWT.
 *   - exchangePreviewToken       — cleans the `?pt=` token from the URL on
 *     failure / missing-jwt / success (anti-retry-loop) and the self-host skip.
 *   - getJWTTokenFromCookieAPI   — preview-skip (iframe / `?pt=` / __exepad_pa
 *     cookie) and self-host skip (no VITE_BACKEND_URL).
 *
 * Harness mirrors the sibling jwt-helper.test.ts + platformAuth.test.ts:
 * happy-dom globals, vi.stubEnv for VITE_BACKEND_URL, window.fetch swapped per
 * test and restored in afterEach. `window.parent`, `window.location.search`,
 * `document.cookie`, and `window.history.replaceState` are overridden via
 * Object.defineProperty / spies and reset between tests because happy-dom
 * shares one window/location across a file.
 *
 * NOTE on env: under real vitest (not the global shim) `import.meta.env.MODE`
 * is 'test' and `VITE_BACKEND_URL` is undefined (self-host mode). Tests that
 * need the cloud network path stub VITE_BACKEND_URL explicitly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  requestJWTTokenFromParent,
  exchangePreviewToken,
  getJWTTokenFromCookieAPI,
  cleanPreviewTokenFromURL,
} from '@/lib/jwt-helper';

const EDITOR_ORIGIN = 'http://localhost:3000'; // == window.location.origin in happy-dom

let originalFetch: typeof window.fetch;

// Captured ONCE, before any test mutates them. happy-dom shares a single
// window/location/document across the file, and our setSearch/setCookie helpers
// install `configurable: true` accessor descriptors. If we re-captured these in
// each beforeEach we'd snapshot the *previous test's* override as "original" and
// leak it forward (e.g. a stale __exepad_pa cookie wrongly tripping the
// preview-skip). So restore to the pristine descriptors every time instead.
const pristineParent = Object.getOwnPropertyDescriptor(window, 'parent');
const pristineSearch = Object.getOwnPropertyDescriptor(window.location, 'search');
const pristineCookie = Object.getOwnPropertyDescriptor(document, 'cookie');

/** Pretend the SPA is embedded as an editor preview iframe. */
function makeIframe(): { postMessage: ReturnType<typeof vi.fn> } {
  const fakeParent = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { value: fakeParent, configurable: true });
  return fakeParent;
}

/** Restore the top-level (parent === self) browsing context. */
function makeTopLevel(): void {
  Object.defineProperty(window, 'parent', { value: window, configurable: true });
}

/** Override the current location query string (e.g. '?pt=token123'). */
function setSearch(search: string): void {
  Object.defineProperty(window.location, 'search', { value: search, configurable: true });
}

/** Override document.cookie (read-only stub for the preview-cookie probe). */
function setCookie(value: string): void {
  Object.defineProperty(document, 'cookie', {
    get: () => value,
    set: () => {},
    configurable: true,
  });
}

/** Dispatch a window `message` event with a controllable origin + data. */
function dispatchMessage(origin: string, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { origin, data }));
}

describe('jwt-helper (async / cross-window)', () => {
  beforeEach(() => {
    originalFetch = window.fetch;

    vi.unstubAllEnvs();
    vi.clearAllMocks();
    try {
      window.sessionStorage.clear();
    } catch {
      /* ignore */
    }
    setSearch('');
  });

  afterEach(() => {
    window.fetch = originalFetch;
    // Always restore the pristine (pre-test) descriptors so an override from one
    // test can never bleed into the next.
    if (pristineParent) Object.defineProperty(window, 'parent', pristineParent);
    if (pristineSearch) Object.defineProperty(window.location, 'search', pristineSearch);
    // `document.cookie` lives on the prototype (no own descriptor to snapshot);
    // setCookie() installs an OWN accessor that would shadow it forever. Restore
    // the pristine descriptor if there was one, else drop the override so the
    // real prototype getter (empty string in happy-dom) shows through again.
    if (pristineCookie) {
      Object.defineProperty(document, 'cookie', pristineCookie);
    } else if (Object.getOwnPropertyDescriptor(document, 'cookie')) {
      delete (document as unknown as Record<string, unknown>).cookie;
    }
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // ── requestJWTTokenFromParent ──────────────────────────────────────────

  describe('requestJWTTokenFromParent', () => {
    it('resolves undefined immediately when NOT in an iframe (parent === self)', async () => {
      makeTopLevel();

      const token = await requestJWTTokenFromParent(50);

      expect(token).toBeUndefined();
    });

    it('posts a request to the parent at the trusted editor origin', async () => {
      const parent = makeIframe();

      // Fire and let it time out fast; we only assert the outbound request.
      const p = requestJWTTokenFromParent(50);

      expect(parent.postMessage).toHaveBeenCalledTimes(1);
      const [msg, targetOrigin] = parent.postMessage.mock.calls[0];
      expect(msg).toEqual({ type: 'request_jwt_token' });
      expect(targetOrigin).toBe(EDITOR_ORIGIN);

      await p; // drain the timeout
    });

    it('resolves with the token on a valid response from the trusted origin', async () => {
      makeIframe();

      const p = requestJWTTokenFromParent(1000);
      dispatchMessage(EDITOR_ORIGIN, { type: 'jwt_token_response', token: 'good-jwt' });

      await expect(p).resolves.toBe('good-jwt');
    });

    it('stores the received token in session storage for reuse', async () => {
      makeIframe();

      const p = requestJWTTokenFromParent(1000);
      dispatchMessage(EDITOR_ORIGIN, { type: 'jwt_token_response', token: 'stored-jwt' });
      await p;

      expect(window.sessionStorage.getItem('jwt_token')).toBe('stored-jwt');
    });

    it('SECURITY: REJECTS a token whose event.origin !== getEditorOrigin()', async () => {
      makeIframe();

      const p = requestJWTTokenFromParent(80);
      // A malicious frame supplies a well-formed response from a foreign origin.
      dispatchMessage('https://evil.example.com', {
        type: 'jwt_token_response',
        token: 'attacker-jwt',
      });

      // Origin mismatch → message ignored → falls through to timeout (undefined).
      await expect(p).resolves.toBeUndefined();
      // And the attacker's token must NEVER be persisted.
      expect(window.sessionStorage.getItem('jwt_token')).toBeNull();
    });

    it('SECURITY: a foreign-origin message does not pre-empt a later trusted one', async () => {
      makeIframe();

      const p = requestJWTTokenFromParent(1000);
      dispatchMessage('https://evil.example.com', {
        type: 'jwt_token_response',
        token: 'attacker-jwt',
      });
      // The legitimate parent then answers from the trusted origin.
      dispatchMessage(EDITOR_ORIGIN, { type: 'jwt_token_response', token: 'real-jwt' });

      await expect(p).resolves.toBe('real-jwt');
      expect(window.sessionStorage.getItem('jwt_token')).toBe('real-jwt');
    });

    it('ignores a trusted-origin message with the wrong type', async () => {
      makeIframe();

      const p = requestJWTTokenFromParent(80);
      dispatchMessage(EDITOR_ORIGIN, { type: 'some_other_event', token: 'ignored' });

      await expect(p).resolves.toBeUndefined();
      expect(window.sessionStorage.getItem('jwt_token')).toBeNull();
    });

    it('ignores a trusted-origin response that carries no token field', async () => {
      makeIframe();

      const p = requestJWTTokenFromParent(80);
      dispatchMessage(EDITOR_ORIGIN, { type: 'jwt_token_response' });

      await expect(p).resolves.toBeUndefined();
    });

    it('resolves undefined on timeout when the parent never answers', async () => {
      makeIframe();

      const token = await requestJWTTokenFromParent(40);

      expect(token).toBeUndefined();
    });

    it('only resolves once — a late trusted message after timeout is a no-op', async () => {
      makeIframe();

      const token = await requestJWTTokenFromParent(40);
      expect(token).toBeUndefined();

      // Arrives after the listener was (or should have been) torn down.
      dispatchMessage(EDITOR_ORIGIN, { type: 'jwt_token_response', token: 'late-jwt' });

      // The promise already settled to undefined; the late token is not adopted
      // as the resolution. (It may write storage as a side effect, but the gate
      // result stands.)
      expect(token).toBeUndefined();
    });
  });

  // ── exchangePreviewToken ───────────────────────────────────────────────

  describe('exchangePreviewToken', () => {
    it('returns undefined (no fetch) when there is no ?pt= in the URL', async () => {
      setSearch('');
      const fetchSpy = vi.fn(async () => new Response('{}'));
      window.fetch = fetchSpy as unknown as typeof window.fetch;

      const token = await exchangePreviewToken();

      expect(token).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('self-host skip: with ?pt= but no VITE_BACKEND_URL, returns undefined and does NOT fetch', async () => {
      setSearch('?pt=preview123');
      // Default env: VITE_BACKEND_URL undefined → self-host.
      const fetchSpy = vi.fn(async () => new Response('{}'));
      window.fetch = fetchSpy as unknown as typeof window.fetch;

      const token = await exchangePreviewToken();

      expect(token).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('exchanges the preview token and returns the jwt on success', async () => {
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      setSearch('?pt=preview123');
      const fetchSpy = vi.fn(async () =>
        new Response(JSON.stringify({ jwt: 'exchanged-jwt', user: { email: 'a@b.c' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      window.fetch = fetchSpy as unknown as typeof window.fetch;

      const token = await exchangePreviewToken();

      expect(token).toBe('exchanged-jwt');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://backend.exepad.com/api/auth/exchange-preview-token/');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ token: 'preview123' });
      // Token persisted for reuse.
      expect(window.sessionStorage.getItem('jwt_token')).toBe('exchanged-jwt');
    });

    it('cleans the ?pt= token from the URL on SUCCESS (anti-retry-loop)', async () => {
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      setSearch('?pt=preview123&keep=1');
      const replaceSpy = vi.spyOn(window.history, 'replaceState');
      window.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ jwt: 'ok-jwt' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ) as unknown as typeof window.fetch;

      await exchangePreviewToken();

      expect(replaceSpy).toHaveBeenCalled();
      const newUrl = replaceSpy.mock.calls[replaceSpy.mock.calls.length - 1][2] as string;
      expect(newUrl).not.toContain('pt=');
      expect(newUrl).toContain('keep=1');
    });

    it('cleans the ?pt= token from the URL on a NON-OK backend response', async () => {
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      setSearch('?pt=preview123');
      const replaceSpy = vi.spyOn(window.history, 'replaceState');
      window.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof window.fetch;

      const token = await exchangePreviewToken();

      expect(token).toBeUndefined();
      expect(replaceSpy).toHaveBeenCalled();
      const newUrl = replaceSpy.mock.calls[replaceSpy.mock.calls.length - 1][2] as string;
      expect(newUrl).not.toContain('pt=');
    });

    it('cleans the ?pt= token from the URL when the fetch THROWS (network error)', async () => {
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      setSearch('?pt=preview123');
      const replaceSpy = vi.spyOn(window.history, 'replaceState');
      window.fetch = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof window.fetch;

      const token = await exchangePreviewToken();

      expect(token).toBeUndefined();
      expect(replaceSpy).toHaveBeenCalled();
      const newUrl = replaceSpy.mock.calls[replaceSpy.mock.calls.length - 1][2] as string;
      expect(newUrl).not.toContain('pt=');
    });

    it('cleans the URL and returns undefined when the 200 response is missing the jwt field', async () => {
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      setSearch('?pt=preview123');
      const replaceSpy = vi.spyOn(window.history, 'replaceState');
      window.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ user: { email: 'a@b.c' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ) as unknown as typeof window.fetch;

      const token = await exchangePreviewToken();

      expect(token).toBeUndefined();
      expect(window.sessionStorage.getItem('jwt_token')).toBeNull();
      expect(replaceSpy).toHaveBeenCalled();
      const newUrl = replaceSpy.mock.calls[replaceSpy.mock.calls.length - 1][2] as string;
      expect(newUrl).not.toContain('pt=');
    });
  });

  // ── cleanPreviewTokenFromURL (pure helper) ─────────────────────────────

  describe('cleanPreviewTokenFromURL', () => {
    it('strips only the pt param and preserves the rest of the query', () => {
      setSearch('?pt=secret&a=1&b=2');
      const replaceSpy = vi.spyOn(window.history, 'replaceState');

      cleanPreviewTokenFromURL();

      expect(replaceSpy).toHaveBeenCalledTimes(1);
      const newUrl = replaceSpy.mock.calls[0][2] as string;
      expect(newUrl).not.toContain('pt=');
      expect(newUrl).toContain('a=1');
      expect(newUrl).toContain('b=2');
    });

    it('is a no-op-safe call when there is no query string', () => {
      setSearch('');
      expect(() => cleanPreviewTokenFromURL()).not.toThrow();
    });
  });

  // ── getJWTTokenFromCookieAPI ───────────────────────────────────────────

  describe('getJWTTokenFromCookieAPI — preview-mode skip', () => {
    it('SKIPS the fetch (returns undefined) when running inside an iframe', async () => {
      makeIframe();
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      const fetchSpy = vi.fn(async () => new Response('{}'));
      window.fetch = fetchSpy as unknown as typeof window.fetch;

      const token = await getJWTTokenFromCookieAPI();

      expect(token).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('SKIPS the fetch when a ?pt= preview token is present in the URL', async () => {
      makeTopLevel();
      setSearch('?pt=preview123');
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      const fetchSpy = vi.fn(async () => new Response('{}'));
      window.fetch = fetchSpy as unknown as typeof window.fetch;

      const token = await getJWTTokenFromCookieAPI();

      expect(token).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('SKIPS the fetch when the __exepad_pa preview cookie is set on this origin', async () => {
      makeTopLevel();
      setSearch('');
      setCookie('foo=bar; __exepad_pa=1; baz=qux');
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      const fetchSpy = vi.fn(async () => new Response('{}'));
      window.fetch = fetchSpy as unknown as typeof window.fetch;

      const token = await getJWTTokenFromCookieAPI();

      expect(token).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('getJWTTokenFromCookieAPI — self-host + network paths', () => {
    it('self-host skip: returns undefined without fetch when VITE_BACKEND_URL is unset', async () => {
      makeTopLevel();
      setSearch('');
      // Default env (no VITE_BACKEND_URL) is self-host. No preview signals.
      const fetchSpy = vi.fn(async () => new Response('{}'));
      window.fetch = fetchSpy as unknown as typeof window.fetch;

      const token = await getJWTTokenFromCookieAPI();

      expect(token).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('fetches the ws-token credentialed and returns the token on success', async () => {
      makeTopLevel();
      setSearch('');
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      const fetchSpy = vi.fn(async () =>
        new Response(JSON.stringify({ token: 'cookie-jwt', user: { email: 'x@y.z' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      window.fetch = fetchSpy as unknown as typeof window.fetch;

      const token = await getJWTTokenFromCookieAPI();

      expect(token).toBe('cookie-jwt');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://backend.exepad.com/api/auth/ws-token/');
      expect(init.credentials).toBe('include');
      expect(window.sessionStorage.getItem('jwt_token')).toBe('cookie-jwt');
    });

    it('returns undefined on a 401 (no valid session cookie) and stores nothing', async () => {
      makeTopLevel();
      setSearch('');
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      const fetchSpy = vi.fn(async () => new Response('unauthorized', { status: 401 }));
      window.fetch = fetchSpy as unknown as typeof window.fetch;

      const token = await getJWTTokenFromCookieAPI();

      expect(token).toBeUndefined();
      expect(window.sessionStorage.getItem('jwt_token')).toBeNull();
    });

    it('returns undefined when the fetch throws (network/CORS failure)', async () => {
      makeTopLevel();
      setSearch('');
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      const fetchSpy = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      window.fetch = fetchSpy as unknown as typeof window.fetch;

      const token = await getJWTTokenFromCookieAPI();

      expect(token).toBeUndefined();
    });

    it('returns undefined when the 200 response omits the token field', async () => {
      makeTopLevel();
      setSearch('');
      vi.stubEnv('VITE_BACKEND_URL', 'https://backend.exepad.com');
      const fetchSpy = vi.fn(async () =>
        new Response(JSON.stringify({ user: { email: 'x@y.z' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      window.fetch = fetchSpy as unknown as typeof window.fetch;

      const token = await getJWTTokenFromCookieAPI();

      expect(token).toBeUndefined();
      expect(window.sessionStorage.getItem('jwt_token')).toBeNull();
    });
  });
});
