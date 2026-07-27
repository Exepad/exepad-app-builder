/**
 * Platform Bridge Auth
 *
 * Cross-domain authentication for published apps on .exepad.app.
 * Users authenticated on .exepad.com (platform) can prove their identity
 * to published apps via a short-lived HMAC-signed bridge token.
 *
 * Flow:
 * 1. On page load, fetch a bridge token from the backend (credentialed cross-origin)
 * 2. Cache the token in sessionStorage
 * 3. Include it as X-Platform-Token header on API requests to the app's worker
 */

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || 'https://backend.exepad.com';

const STORAGE_KEY = 'exepad_platform_token';
const STORAGE_EXPIRY_KEY = 'exepad_platform_token_exp';

/** Cached in-memory so we don't read sessionStorage on every fetch */
let _cachedToken: string | null = null;
let _cachedExpiry = 0;

/** Whether a fetch is already in-flight (prevent parallel requests) */
let _fetching: Promise<string | null> | null = null;

/**
 * Attempt to obtain a platform bridge token.
 * Returns the token string or null if the user is not logged into the platform.
 *
 * Safe to call multiple times — deduplicates in-flight requests and caches the result.
 */
export async function getPlatformToken(): Promise<string | null> {
  // 0. Self-host mode: there is no cloud platform-bridge endpoint. When
  // VITE_BACKEND_URL is unset or '/', skip the fetch entirely and return null.
  if (!import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_BACKEND_URL === '/') {
    console.debug('[Exepad] Platform bridge disabled (self-host mode)');
    return null;
  }

  // 1. In-memory cache (hot path)
  if (_cachedToken && Date.now() / 1000 < _cachedExpiry - 30) {
    return _cachedToken;
  }

  // 2. sessionStorage cache (survives soft navigations)
  if (typeof sessionStorage !== 'undefined') {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      const storedExp = Number(sessionStorage.getItem(STORAGE_EXPIRY_KEY) || 0);
      if (stored && Date.now() / 1000 < storedExp - 30) {
        _cachedToken = stored;
        _cachedExpiry = storedExp;
        return stored;
      }
    } catch {
      /* SSR or private browsing — ignore */
    }
  }

  // 3. Fetch from backend (deduplicated)
  if (_fetching) return _fetching;

  _fetching = (async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/platform-bridge/`, {
        method: 'GET',
        credentials: 'include', // sends exepad_session cookie (SameSite=None)
      });
      if (!res.ok) return null;

      const data = await res.json();
      const token: string = data.token;
      const expiresIn: number = data.expires_in || 300;

      // Cache
      const expiry = Date.now() / 1000 + expiresIn;
      _cachedToken = token;
      _cachedExpiry = expiry;

      try {
        sessionStorage.setItem(STORAGE_KEY, token);
        sessionStorage.setItem(STORAGE_EXPIRY_KEY, String(Math.floor(expiry)));
      } catch {
        /* ignore */
      }

      return token;
    } catch {
      // Network error, backend down, or CORS rejection — user not on platform
      return null;
    } finally {
      _fetching = null;
    }
  })();

  return _fetching;
}

/**
 * Build auth headers for API requests.
 * Returns an object with X-Platform-Token if available, empty otherwise.
 */
export function getPlatformAuthHeaders(): Record<string, string> {
  // Synchronous — only returns if already cached
  if (_cachedToken && Date.now() / 1000 < _cachedExpiry - 30) {
    return { 'X-Platform-Token': _cachedToken };
  }

  // Try sessionStorage
  if (typeof sessionStorage !== 'undefined') {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      const storedExp = Number(sessionStorage.getItem(STORAGE_EXPIRY_KEY) || 0);
      if (stored && Date.now() / 1000 < storedExp - 30) {
        _cachedToken = stored;
        _cachedExpiry = storedExp;
        return { 'X-Platform-Token': stored };
      }
    } catch {
      /* ignore */
    }
  }

  return {};
}

/**
 * Install a global fetch interceptor that automatically injects the
 * X-Platform-Token header on same-origin /api/* requests.
 *
 * Call once on app startup (e.g., in useRuntimeStore or a top-level effect).
 * Idempotent — safe to call multiple times.
 */
let _interceptorInstalled = false;

export function installPlatformAuthInterceptor(): void {
  if (_interceptorInstalled) return;
  if (typeof window === 'undefined') return;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // Only inject on same-origin /api/ requests
    const url = typeof input === 'string'
      ? input
      : input instanceof URL ? input.href : (input as Request).url;
    const isApiCall =
      url.startsWith('/api/') ||
      (typeof location !== 'undefined' && url.startsWith(location.origin + '/api/'));

    if (isApiCall) {
      const authHeaders = getPlatformAuthHeaders();
      if (authHeaders['X-Platform-Token']) {
        const headers = new Headers(init?.headers);
        if (!headers.has('X-Platform-Token')) {
          headers.set('X-Platform-Token', authHeaders['X-Platform-Token']);
        }
        init = { ...init, headers };
      }
    }

    return originalFetch(input, init);
  };

  _interceptorInstalled = true;
}
