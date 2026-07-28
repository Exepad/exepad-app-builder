/**
 * JWT Token Helper for Runtime
 * Handles fetching JWT tokens for WebSocket authentication in preview mode
 */

import { logger } from './logger';
import { getEditorOrigin } from './editor-origin';

/**
 * Get JWT token from environment variable
 * This should be set when the runtime is loaded in preview mode
 */
export function getJWTTokenFromEnv(): string | undefined {
  if (import.meta.env.VITE_JWT_TOKEN) {
    return import.meta.env.VITE_JWT_TOKEN;
  }
  return undefined;
}

/**
 * Get JWT token from window global (set by parent iframe)
 * The frontend can inject the token via postMessage or script injection
 */
export function getJWTTokenFromWindow(): string | undefined {
  if (typeof window !== 'undefined' && (window as any).__JWT_TOKEN) {
    return (window as any).__JWT_TOKEN;
  }
  return undefined;
}

/**
 * Get JWT token from session storage
 * For preview mode, the token might be stored in session storage
 */
export function getJWTTokenFromStorage(): string | undefined {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      return window.sessionStorage.getItem('jwt_token') || undefined;
    } catch (e) {
      logger.warn('[JWT Helper] Cannot access session storage:', e);
    }
  }
  return undefined;
}

/**
 * Set JWT token in session storage
 */
export function setJWTTokenInStorage(token: string): void {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.setItem('jwt_token', token);
    } catch (e) {
      logger.warn('[JWT Helper] Cannot write to session storage:', e);
    }
  }
}

/**
 * Store the platform user identity obtained during JWT exchange.
 * This is used by useCurrentUser() when the bridge token flow is unavailable.
 */
export function setPlatformUser(user: { id?: string | number; email?: string; name?: string } | null): void {
  if (!user || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem('exepad_platform_user', JSON.stringify(user));
  } catch { /* ignore */ }
}

/**
 * Retrieve the stored platform user identity.
 */
export function getPlatformUser(): { id: string | null; email: string | null; name: string | null } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem('exepad_platform_user');
    if (!raw) return null;
    const u = JSON.parse(raw);
    return {
      id: u.id != null ? String(u.id) : null,
      email: u.email || null,
      name: u.name || null,
    };
  } catch { return null; }
}

/**
 * Clear JWT token from session storage
 */
export function clearJWTToken(): void {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem('jwt_token');
    } catch (e) {
      logger.warn('[JWT Helper] Cannot clear session storage:', e);
    }
  }
}

/**
 * Check if a JWT token is expired or about to expire
 * Returns true if the token is expired or will expire within 60 seconds
 */
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // Consider expired if less than 60 seconds remaining
    return payload.exp * 1000 < Date.now() + 60_000;
  } catch {
    return true;
  }
}

/**
 * Get JWT token with fallback chain
 * Priority: window global > session storage > environment variable
 * Expired tokens are cleared and skipped.
 */
export function getJWTToken(): string | undefined {
  // Try window global first (fastest, set by parent)
  const windowToken = getJWTTokenFromWindow();
  if (windowToken) {
    if (isTokenExpired(windowToken)) {
      logger.warn('[JWT Helper] Window global token is expired, clearing');
      if (typeof window !== 'undefined') {
        delete (window as any).__JWT_TOKEN;
      }
    } else {
      logger.log('[JWT Helper] Using token from window global');
      return windowToken;
    }
  }

  // Try session storage
  const storageToken = getJWTTokenFromStorage();
  if (storageToken) {
    if (isTokenExpired(storageToken)) {
      logger.warn('[JWT Helper] Session storage token is expired, clearing');
      clearJWTToken();
    } else {
      return storageToken;
    }
  }

  // Try environment variable (for local development)
  const envToken = getJWTTokenFromEnv();
  if (envToken) {
    if (isTokenExpired(envToken)) {
      logger.warn('[JWT Helper] Environment token is expired');
    } else {
      logger.log('[JWT Helper] Using token from environment');
      return envToken;
    }
  }

  const isEditorPreview = typeof window !== 'undefined' && window.parent !== window;
  if (isEditorPreview) {
    logger.debug('[JWT Helper] No JWT token found (preview mode - expected)');
  } else {
    logger.warn('[JWT Helper] No JWT token found in any location');
  }
  return undefined;
}

/**
 * Fetch JWT from backend using cookie authentication
 * This allows separate tabs to authenticate without postMessage
 * 
 * How it works:
 * - Browser automatically sends session cookies with the request
 * - Backend validates the session cookie
 * - Backend returns a fresh JWT for WebSocket authentication
 * 
 * Benefits:
 * - Works in separate tabs (cookies shared across tabs)
 * - Works across subdomains (if cookie domain is set to .exepad.com)
 * - No need for postMessage or parent window
 */
export async function getJWTTokenFromCookieAPI(): Promise<string | undefined> {
  // In any preview-mode context the SPA has no session cookie for the
  // backend origin, so the cookie-authenticated fallback is guaranteed
  // to 401. Skip the fetch to avoid noisy console errors — preview auth
  // flows through exchangePreviewToken / requestJWTTokenFromParent
  // instead.
  //
  // Three preview-mode signals; any one is sufficient:
  //   1. iframe context (editor preview tab embedded in the dashboard)
  //   2. ``?pt=`` URL parameter on the current location (preview-tab
  //      opened from the dashboard's "Open in new tab" button or an
  //      automation script)
  //   3. ``__exepad_pa`` cookie (set on this origin by the runtime
  //      gateway after the first ``?pt=`` exchange — survives intra-tab
  //      navigations)
  // Without the (2)/(3) extension the bare-tab preview path (the most
  // common automation flow + the one users hit when sharing a preview
  // URL) double-401s on every navigation: once for the page, once for
  // ws-token. Caught on app r3hfcgx5 (2026-05-14).
  if (typeof window !== 'undefined') {
    const isIframe = window.parent !== window;
    const hasPreviewToken =
      typeof window.location !== 'undefined' &&
      new URLSearchParams(window.location.search).has('pt');
    const hasPreviewCookie =
      typeof document !== 'undefined' &&
      /(?:^|;\s*)__exepad_pa=/.test(document.cookie || '');
    if (isIframe || hasPreviewToken || hasPreviewCookie) {
      logger.debug(
        '[JWT Helper] Skipping cookie API fetch in preview mode',
        { isIframe, hasPreviewToken, hasPreviewCookie },
      );
      return undefined;
    }
  }

  try {
    logger.log('[JWT Helper] Fetching JWT via cookie-authenticated API...');

    const backendUrl = import.meta.env.VITE_BACKEND_URL;
    if (!backendUrl) {
      // Self-host: operator auth flows through the same-origin /auth/me path
      // (getSelfHostOperatorToken). No cloud ws-token endpoint exists, so skip
      // rather than issue a cross-origin request that fails.
      logger.log('[JWT Helper] No VITE_BACKEND_URL (self-host) — skipping cloud ws-token.');
      return undefined;
    }
    const response = await fetch(`${backendUrl}/api/auth/ws-token/`, {
      method: 'GET',
      credentials: 'include',  // CRITICAL: Include cookies in request
      headers: {
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        logger.warn('[JWT Helper] Not authenticated (no valid session cookie)');
      } else {
        logger.warn('[JWT Helper] Cookie auth failed:', response.status, response.statusText);
      }
      return undefined;
    }
    
    const data = await response.json();
    
    if (data.token) {
      logger.log('[JWT Helper] ✅ Got JWT via cookie authentication');
      logger.log('[JWT Helper] User:', data.user?.email || 'unknown');

      // Store for future use (faster than API call)
      setJWTTokenInStorage(data.token);
      if (data.user) setPlatformUser(data.user);

      return data.token;
    }
    
    logger.warn('[JWT Helper] API response missing token field');
    return undefined;
    
  } catch (error) {
    logger.warn('[JWT Helper] Failed to fetch JWT via cookies:', error);
    return undefined;
  }
}

/**
 * Exchange a preview token (from URL) for a JWT
 * This is used when preview is opened in a new browser tab
 * 
 * The preview token is a short-lived, signed token that can be
 * exchanged for a full JWT for WebSocket authentication.
 */
export async function exchangePreviewToken(): Promise<string | undefined> {
  if (typeof window === 'undefined') return undefined;
  
  const urlParams = new URLSearchParams(window.location.search);
  const previewToken = urlParams.get('pt');
  
  if (!previewToken) return undefined;
  
  try {
    logger.log('[JWT Helper] Found preview token in URL, exchanging...');
    
    const backendUrl = import.meta.env.VITE_BACKEND_URL;
    if (!backendUrl) {
      logger.log('[JWT Helper] No VITE_BACKEND_URL (self-host) — skipping cloud preview-token exchange.');
      return undefined;
    }
    const response = await fetch(`${backendUrl}/api/auth/exchange-preview-token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: previewToken }),
    });
    
    if (!response.ok) {
      logger.warn('[JWT Helper] Preview token exchange failed:', response.status);
      // In non-production builds, surface the response body so the failure
      // is debuggable. Without this, a Django 500 (e.g. token uid not a real
      // user) silently falls through to the generic "Authentication Required"
      // gate with no actionable signal in the dev console.
      if (import.meta.env.MODE !== 'production') {
        try {
          const body = await response.text();
          // eslint-disable-next-line no-console
          console.error(
            `[Preview Auth] Backend rejected the preview token (HTTP ${response.status}). ` +
            `Body: ${body.slice(0, 300)}`,
          );
        } catch {
          // body unreadable — at least the status is logged above
        }
      }
      // Clean URL even on failure to prevent retry loops
      cleanPreviewTokenFromURL();
      return undefined;
    }
    
    const data = await response.json();
    
    if (data.jwt) {
      logger.log('[JWT Helper] ✅ Got JWT from preview token');
      logger.log('[JWT Helper] User:', data.user?.email || 'unknown');

      // Store for future use
      setJWTTokenInStorage(data.jwt);
      if (data.user) setPlatformUser(data.user);

      // Clean URL - remove the preview token parameter
      cleanPreviewTokenFromURL();

      return data.jwt;
    }
    
    logger.warn('[JWT Helper] Preview token response missing jwt field');
    cleanPreviewTokenFromURL();
    return undefined;
    
  } catch (error) {
    logger.warn('[JWT Helper] Preview token exchange error:', error);
    cleanPreviewTokenFromURL();
    return undefined;
  }
}

/**
 * Remove the preview token from the URL without reloading the page
 */
export function cleanPreviewTokenFromURL(): void {
  if (typeof window === 'undefined') return;
  
  try {
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.delete('pt');
    const newSearch = urlParams.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);
    logger.log('[JWT Helper] Cleaned preview token from URL');
  } catch (e) {
    logger.warn('[JWT Helper] Could not clean URL:', e);
  }
}

/**
 * Request JWT token from parent window via postMessage
 * Returns a promise that resolves when the token is received
 */
export function requestJWTTokenFromParent(timeout: number = 5000): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || window.parent === window) {
      logger.log('[JWT Helper] Not in iframe, cannot request token from parent');
      resolve(undefined);
      return;
    }

    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        logger.warn('[JWT Helper] Token request timed out');
        resolve(undefined);
      }
    }, timeout);

    const handleMessage = (event: MessageEvent) => {
      // Validate origin before accepting tokens
      const trustedOrigin = getEditorOrigin();
      if (event.origin !== trustedOrigin) return;

      if (event.data?.type === 'jwt_token_response' && event.data?.token) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          window.removeEventListener('message', handleMessage);
          logger.log('[JWT Helper] Received JWT token from parent');
          
          // Store the token for future use
          setJWTTokenInStorage(event.data.token);
          
          resolve(event.data.token);
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Request token from parent
    logger.log('[JWT Helper] Requesting JWT token from parent window');
    const editorOrigin = getEditorOrigin();
    window.parent.postMessage({ type: 'request_jwt_token' }, editorOrigin);
  });
}

/**
 * Self-host preview auth: confirm the operator's same-origin platform session via
 * /auth/me. Returns a non-empty sentinel token when authenticated (sufficient for
 * the PreviewPage gate; API calls authorize via the session cookie at the
 * gateway), or undefined otherwise (cloud build, logged-out, or network error).
 */
export async function getSelfHostOperatorToken(): Promise<string | undefined> {
  if (typeof window === 'undefined') return undefined;
  try {
    const res = await fetch('/auth/me', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    if (data && data.success && data.user) {
      logger.log('[JWT Helper] ✅ Operator authenticated via same-origin platform session');
      return 'platform-session';
    }
  } catch {
    /* not self-host, or not authenticated — fall through to other sources */
  }
  return undefined;
}

/**
 * Get JWT token with async parent request fallback
 * First checks immediate sources, then requests from parent if needed
 * 
 * Fallback chain (in order):
 * 1. Memory/session storage (instant)
 * 2. Preview token in URL (new tab with ?pt= parameter)
 * 3. postMessage from parent (works in iframe)
 * 4. Cookie-authenticated API (fallback)
 */
export async function getJWTTokenAsync(): Promise<string | undefined> {
  // 1. Try immediate sources first (fastest - no network call)
  const immediateToken = getJWTToken();
  if (immediateToken) {
    return immediateToken;
  }

  // 1b. Self-host: the preview is same-origin with the runtime, so the operator's
  // HttpOnly platform-session cookie (set by /auth/login) already authorizes the
  // preview's API calls at the gateway — but JS can't read that cookie, and the
  // cloud token flows below (preview-token exchange / postMessage to
  // app.exepad.com / backend.exepad.com cookie API) don't exist here. Confirm the
  // session via the same-origin /auth/me endpoint; if the operator is logged in,
  // return a non-empty sentinel so the PreviewPage gate passes. It is NOT sent as
  // a Bearer token — runtime API/RPC calls are cookie-authenticated — so the
  // sentinel only satisfies the client-side gate. Checked early to avoid waiting
  // on the (dead, in self-host) cloud fallbacks. In the cloud build /auth/me
  // doesn't exist (404) so this is a fast no-op there.
  const operatorToken = await getSelfHostOperatorToken();
  if (operatorToken) {
    return operatorToken;
  }

  // 2. Try preview token exchange (new tab opened with ?pt= parameter)
  logger.log('[JWT Helper] No cached token, checking for preview token in URL...');
  const previewTokenJWT = await exchangePreviewToken();
  if (previewTokenJWT) {
    return previewTokenJWT;
  }

  // 3. If in iframe, try postMessage from parent
  if (typeof window !== 'undefined' && window.parent !== window) {
    logger.log('[JWT Helper] No preview token, trying postMessage from parent iframe...');
    const parentToken = await requestJWTTokenFromParent();
    if (parentToken) {
      return parentToken;
    }
  }

  // 4. Try cookie-authenticated API (fallback for direct navigation)
  logger.log('[JWT Helper] Trying cookie-authenticated API...');
  const cookieToken = await getJWTTokenFromCookieAPI();
  if (cookieToken) {
    return cookieToken;
  }

  logger.error('[JWT Helper] ❌ Could not obtain JWT token from any source');
  logger.error('[JWT Helper] Tried: cached storage → preview token → postMessage → cookie API');
  return undefined;
}

