/**
 * Gateway — Authentication and headers
 */

import type { Env } from '../../types/env';
import { constantTimeEqual } from '../../lib/crypto-utils';
import type { AppConfig, BridgePayload } from './types';
import { getCookieValue, getCookieValues } from './utils';
import { resolveSecret } from '../../lib/secrets';
import { getUserById } from '../../lib/meta-db';

const DEFAULT_PLATFORM_ROLES = ['admin', 'user'];
// 12 hours: long enough that a user who opens a preview in a top-level tab and
// spends the day client-side-navigating (no HTML reloads → no iframe-driven
// `__refresh` keep-alive) doesn't have their __exepad_pa cookie silently expire
// mid-session and start 401ing subresource fetches. Sliding renewal
// (shouldRefreshPreviewCookie) keeps truly long sessions alive beyond 12h.
export const PREVIEW_ACCESS_TTL_SECONDS = 60 * 60 * 12;
// Re-mint the token (and re-Set-Cookie) once the remaining lifetime drops below
// this fraction of the full TTL. At 12h TTL this is 3h — frequent enough that
// any active session renews well before expiry, infrequent enough that we're
// not HMAC-signing a new token on every request.
const PREVIEW_RENEWAL_THRESHOLD_RATIO = 0.25;

export interface PreviewAccessPayload {
  appId: string;
  email?: string;
  exp: number;
  type: 'preview_access';
  uid: string | number;
}

// Platform (builder/studio) session — self-host single-container. Distinct from
// the per-app `exepad_app_session` cookie (which is an end-user session inside a
// generated app, forwarded verbatim to the app-backend). The platform session
// identifies the operator who logged into the builder UI; when present it also
// grants owner identity to previews of their own apps. Signed with
// PLATFORM_BRIDGE_SECRET (= EXEPAD_SESSION_SECRET in self-host).
export const PLATFORM_SESSION_COOKIE = 'exepad_platform_session';
export const PLATFORM_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  type: 'app_session';
  uid: string;
  email?: string;
  roles: string[];
  exp: number;
  /**
   * Session-revocation generation: the operator's `users.session_generation`
   * value at mint time. The verify path rejects the token once the stored value
   * moves past this. Optional for backward-compat — a token minted before this
   * feature has no claim and is treated as generation 0.
   */
  gen?: number;
}

interface LegacyPreviewAccessPayload {
  app: string;
  email?: string;
  exp: number;
  uid: string | number;
}

export interface GatewayIdentity {
  headers: Headers;
  isAuthenticated: boolean;
  kind: 'api_key' | 'session' | 'platform_bridge' | 'preview_access' | 'none';
  previewAccessToken?: string;
  // Set when the caller should emit Set-Cookie for `__exepad_pa`. True on the
  // initial `?pt=` auth (no cookie yet) and when the existing cookie token was
  // slide-renewed because its remaining TTL fell below the renewal threshold.
  // Consumers that normally don't emit Set-Cookie (asset responses) gate on
  // this so typical subresource requests stay cookie-free.
  shouldRefreshPreviewCookie?: boolean;
  stateKey: string | null;
  userEmail?: string;
  userId?: string;
  userRoles: string[];
}

function base64UrlEncode(value: string): string {
  return btoa(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string {
  let padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = padded.length % 4;
  if (remainder) padded += '='.repeat(4 - remainder);
  return atob(padded);
}

async function signToken(payloadB64: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function parseSignedToken<T extends { exp: number; type: string }>(
  token: string,
  secret: string,
  expectedType: T['type'],
): Promise<T | null> {
  const payload = await parseSignedPayload<T>(token, secret);
  if (!payload || payload.type !== expectedType) return null;
  return payload;
}

async function parseSignedPayload<T extends { exp: number }>(
  token: string,
  secret: string,
): Promise<T | null> {
  if (!secret || !token) return null;

  try {
    const dotIdx = token.lastIndexOf('.');
    if (dotIdx === -1) return null;
    const payloadB64 = token.slice(0, dotIdx);
    const signature = token.slice(dotIdx + 1);
    const expectedSig = await signToken(payloadB64, secret);
    if (!constantTimeEqual(expectedSig, signature)) return null;

    const payload = JSON.parse(base64UrlDecode(payloadB64)) as T;
    if ((payload.exp || 0) < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

function setPlatformIdentityHeaders(
  headers: Headers,
  userId: string,
  userEmail?: string,
  userRoles: string[] = DEFAULT_PLATFORM_ROLES,
): void {
  headers.set('X-User-Id', userId);
  if (userEmail) headers.set('X-User-Email', userEmail);
  if (userRoles.length > 0) headers.set('X-User-Roles', userRoles.join(','));
}

async function hashIdentityValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

function decodePreviewCookie(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

type PreviewTokenSource = 'query' | 'cookie';

interface PreviewTokenCandidate {
  source: PreviewTokenSource;
  token: string;
}

/**
 * Candidate preview tokens for a request, in priority order:
 *   1. `?pt=` query parameter (initial navigation).
 *   2. Every `__exepad_pa` cookie value (more-specific Path first, per RFC 6265).
 *
 * Multiple cookie values can be present when the cookie's Path scope is
 * broadened over time — a stale narrow-path cookie may precede the current
 * broad-path one. Callers iterate to find the first that validates.
 *
 * The `source` discriminates query-first auth (which always needs a fresh
 * Set-Cookie so the bare `?pt=` navigation bootstraps the cookie) from
 * cookie-only auth (which only needs Set-Cookie when slide-renewing).
 */
function getPreviewTokenCandidates(request: Request): PreviewTokenCandidate[] {
  const candidates: PreviewTokenCandidate[] = [];
  const url = new URL(request.url);
  const previewQuery = url.searchParams.get('pt');
  if (previewQuery) candidates.push({ source: 'query', token: previewQuery });
  for (const value of getCookieValues(request, '__exepad_pa')) {
    candidates.push({ source: 'cookie', token: decodePreviewCookie(value) });
  }
  return candidates;
}

export async function mintPreviewAccessToken(
  appId: string,
  uid: string,
  email: string | undefined,
  bridgeSecret: string,
  ttlSeconds = PREVIEW_ACCESS_TTL_SECONDS,
): Promise<string> {
  const payload: PreviewAccessPayload = {
    type: 'preview_access',
    appId,
    uid,
    ...(email ? { email } : {}),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = await signToken(payloadB64, bridgeSecret);
  return `${payloadB64}.${signature}`;
}

export async function mintSessionToken(
  uid: string,
  email: string | undefined,
  roles: string[],
  secret: string,
  ttlSeconds = PLATFORM_SESSION_TTL_SECONDS,
  gen?: number,
): Promise<string> {
  // Embed the operator's CURRENT session generation so a later bump
  // (logout-all / password change) invalidates this token. Callers that already
  // hold the user row pass `gen` explicitly; otherwise resolve it from the meta
  // store. Fall back to 0 if the user is unknown or the store can't be read
  // (never fail token minting on a store hiccup).
  let generation = gen;
  if (generation === undefined) {
    try {
      generation = getUserById(String(uid))?.session_generation ?? 0;
    } catch {
      generation = 0;
    }
  }
  const payload: SessionPayload = {
    type: 'app_session',
    uid,
    ...(email ? { email } : {}),
    roles,
    gen: generation,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = await signToken(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

/**
 * Validate the platform session cookie. Returns the decoded payload or null.
 *
 * Beyond the HMAC + expiry check this also enforces session-generation
 * revocation: when the token's operator still exists in the meta store, the
 * token's `gen` claim (0 when absent, for pre-feature tokens) must match the
 * stored `session_generation`; a mismatch means the session was revoked
 * (logout-all / password change) and the token is rejected. If the user is not
 * in the meta store, or the store can't be read, we fall back to the pure token
 * result — a bare signed token is no worse than before this feature, and this
 * keeps callers that mint tokens for non-persisted identities working.
 */
export async function verifyPlatformSession(
  request: Request,
  secret: string,
): Promise<SessionPayload | null> {
  const cookie = getCookieValue(request, PLATFORM_SESSION_COOKIE);
  if (!cookie || !secret) return null;
  const payload = await parseSignedToken<SessionPayload>(cookie, secret, 'app_session');
  if (!payload) return null;
  try {
    const user = getUserById(String(payload.uid));
    if (user && (payload.gen ?? 0) !== (user.session_generation ?? 0)) {
      return null;
    }
  } catch {
    // Meta store unavailable — keep the cryptographically-valid token.
  }
  return payload;
}

export async function resolveGatewayIdentity(
  request: Request,
  appId: string,
  mode: 'preview' | 'published',
  env: Env,
): Promise<GatewayIdentity> {
  const bridgeSecret = await resolveSecret(env.PLATFORM_BRIDGE_SECRET);
  const headers = new Headers();
  headers.set('X-Request-Id', request.headers.get('X-Request-Id') || crypto.randomUUID());

  const origin = request.headers.get('Origin');
  if (origin) headers.set('Origin', origin);

  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer exepad_sk_')) {
    headers.set('Authorization', authHeader);
    return {
      headers,
      isAuthenticated: true,
      kind: 'api_key',
      stateKey: `api_key:${await hashIdentityValue(authHeader)}`,
      userRoles: [],
    };
  }

  // Platform (builder) session — self-host operator. Decode → emit X-User-*
  // identity so PREVIEWS of the operator's own apps are owner-scoped without the
  // `?pt=` preview-token dance. Checked before the per-app session cookie so the
  // operator's identity wins on their own previews; generated apps that mint
  // their own `exepad_app_session` still fall through to the branch below.
  //
  // PREVIEW ONLY: the published surface is the public view of the app, so the
  // operator's platform session must NOT bleed in as an admin identity there —
  // otherwise the owner sees a different (admin) app at `/a/{id}/` than every
  // real visitor does. On published, admin is reached only via an app-level
  // login (`exepad_app_session`) or an API key; the owner administers through
  // the studio/preview surface, where this branch still fires.
  const platformCookie = mode === 'preview' ? getCookieValue(request, PLATFORM_SESSION_COOKIE) : null;
  if (platformCookie && bridgeSecret) {
    // Route through verifyPlatformSession (not a bare parseSignedToken) so the
    // operator's preview owner-identity is dropped once their session generation
    // is bumped (logout-all / password change) — same revocation the control-
    // plane and admin surfaces enforce.
    const session = await verifyPlatformSession(request, bridgeSecret);
    if (session) {
      const userId = String(session.uid);
      const roles = session.roles?.length ? session.roles : DEFAULT_PLATFORM_ROLES;
      setPlatformIdentityHeaders(headers, userId, session.email, roles);
      const previewAccessToken =
        mode === 'preview'
          ? await mintPreviewAccessToken(appId, userId, session.email, bridgeSecret)
          : undefined;
      return {
        headers,
        isAuthenticated: true,
        kind: 'session',
        previewAccessToken,
        shouldRefreshPreviewCookie: mode === 'preview' ? true : undefined,
        stateKey: `platform_session:${userId}`,
        userEmail: session.email,
        userId,
        userRoles: roles,
      };
    }
  }

  const sessionCookie = getCookieValue(request, 'exepad_app_session');
  if (sessionCookie) {
    headers.set('X-Session-Token', sessionCookie);
    return {
      headers,
      isAuthenticated: true,
      kind: 'session',
      stateKey: `session:${await hashIdentityValue(sessionCookie)}`,
      userRoles: [],
    };
  }

  // PREVIEW ONLY, same rationale as the platform-cookie branch above: the SPA's
  // fetch interceptor injects `X-Platform-Token` on same-origin `/api/*`, so on
  // a published localhost view the operator's identity would otherwise arrive
  // via this header even though the cookie branch is now gated. Ignore it on the
  // published surface so the owner is treated as an anonymous visitor there.
  const bridgeToken = mode === 'preview' ? request.headers.get('X-Platform-Token') : null;
  if (bridgeToken && bridgeSecret) {
    const bridge = await validateBridgeToken(bridgeToken, bridgeSecret);
    if (bridge) {
      const userId = String(bridge.uid);
      setPlatformIdentityHeaders(headers, userId, bridge.email, DEFAULT_PLATFORM_ROLES);
      const previewAccessToken = mode === 'preview'
        ? await mintPreviewAccessToken(appId, userId, bridge.email, bridgeSecret)
        : undefined;
      return {
        headers,
        isAuthenticated: true,
        kind: 'platform_bridge',
        previewAccessToken,
        // A bridge-auth'd HTML load must bootstrap __exepad_pa so follow-up
        // subresource fetches (which can't send X-Platform-Token — the
        // client-side fetch interceptor only injects it on /api/*) are still
        // authenticated. Preserves the pre-sliding-renewal behavior where
        // platform_bridge always restamped the cookie on HTML responses.
        shouldRefreshPreviewCookie: mode === 'preview' ? true : undefined,
        stateKey: `platform_bridge:${userId}`,
        userEmail: bridge.email,
        userId,
        userRoles: DEFAULT_PLATFORM_ROLES,
      };
    }
  }

  if (mode === 'preview' && bridgeSecret) {
    for (const candidate of getPreviewTokenCandidates(request)) {
      const preview = await validatePreviewAccessToken(candidate.token, bridgeSecret, appId);
      if (preview) {
        const userId = String(preview.uid);
        setPlatformIdentityHeaders(headers, userId, preview.email, DEFAULT_PLATFORM_ROLES);
        // Flag preview callers so the app-backend can lazily provision an
        // `_auth_users` row when a handler writes owner-scoped data. FKs that
        // reference `_auth_users.id` otherwise reject the write because the
        // preview uid has never been seeded into `_auth_users`. This header is
        // advisory only — the app-backend must never use it for authorization
        // decisions.
        headers.set('X-Preview-Access', '1');

        // Sliding renewal: mint a fresh token (and flag for Set-Cookie) if
        // either (a) the request arrived via `?pt=` — the caller has no cookie
        // yet, so we always need to bootstrap one; or (b) the existing cookie
        // token's remaining lifetime has dropped below the renewal threshold.
        // Otherwise pass the validated token through unchanged so repeat
        // requests within the fresh-token window don't incur HMAC signing.
        //
        // Invariant: when shouldRefresh is true, outboundToken is always a
        // newly-minted full-TTL token — never a shorter-lived incoming one.
        // This keeps the browser-side cookie Max-Age aligned with the token's
        // exp claim so the cookie can't outlive its signed token.
        const nowSec = Math.floor(Date.now() / 1000);
        const remaining = preview.exp - nowSec;
        const threshold = PREVIEW_ACCESS_TTL_SECONDS * PREVIEW_RENEWAL_THRESHOLD_RATIO;
        const shouldRefresh = candidate.source === 'query' || remaining < threshold;
        const outboundToken = shouldRefresh
          ? await mintPreviewAccessToken(appId, userId, preview.email, bridgeSecret)
          : candidate.token;

        return {
          headers,
          isAuthenticated: true,
          kind: 'preview_access',
          previewAccessToken: outboundToken,
          shouldRefreshPreviewCookie: shouldRefresh,
          stateKey: `preview_access:${userId}`,
          userEmail: preview.email,
          userId,
          userRoles: DEFAULT_PLATFORM_ROLES,
        };
      }
    }
  }

  return {
    headers,
    isAuthenticated: false,
    kind: 'none',
    stateKey: null,
    userRoles: [],
  };
}

/**
 * Build auth/identity headers that are common to all dispatch paths (WfP and local).
 *
 * User-workers read their own config from R2 at cold start via `loadConfig`,
 * so the gateway never injects config via headers — it only emits the
 * platform identity + auth kill-switch signals below.
 */
export async function buildDispatchHeaders(
  request: Request,
  appId: string,
  mode: 'preview' | 'published',
  env: Env,
  opts?: {
    config?: AppConfig | null;
    identity?: GatewayIdentity;
  },
): Promise<Headers> {
  const identity = opts?.identity || await resolveGatewayIdentity(request, appId, mode, env);
  const headers = new Headers(identity.headers);
  const serviceToken = await resolveSecret(env.USER_WORKER_SERVICE_TOKEN);

  // Fail closed on a missing token in any real deployment env (the self-host
  // runtime always populates one in-process — see build-runtime-env.ts — so an
  // empty token here is a misconfiguration, not the normal case).
  if (
    !serviceToken &&
    (env.ENVIRONMENT === 'production' ||
      env.ENVIRONMENT === 'staging' ||
      env.ENVIRONMENT === 'selfhost')
  ) {
    throw new Error('USER_WORKER_SERVICE_TOKEN is not configured for gateway dispatch');
  }
  if (serviceToken) {
    headers.set('X-Service-Token', serviceToken);
  }

  // Preview is a shared demo sandbox. The deploy seeder writes demo rows under
  // `owner_id = preview-owner-{appId}` (packages/deploy-utils r2-seeder) — an
  // identity no real user is ever minted as. So an operator previewing their own
  // data app sees an EMPTY app: their real uid matches none of the seeded rows
  // (and dashboard handlers filtering `WHERE owner_id = ctx.user.id` render $0).
  // Route the app-backend DATA identity to the seed owner in preview so both
  // auto-CRUD lists AND handler SQL see the seeded rows (plus anything added
  // while previewing). The real operator identity is preserved where it matters:
  // preview ACCESS gating still uses the signed preview-access token's real uid,
  // and display still uses the operator's X-User-Email (the client re-enriches
  // the preview-owner id with it — see client hooks/useRuntimeStore.ts). Only
  // the platform-session / platform-bridge / preview-access paths set X-User-Id,
  // so api-key and generated-app end-user sessions are untouched. Published is
  // unaffected (its seed is owned by a real auth user).
  if (mode === 'preview' && identity.isAuthenticated && headers.has('X-User-Id')) {
    headers.set('X-User-Id', `preview-owner-${appId}`);
  }

  // Security kill-switch: admin toggled "Enable Authentication" off in the
  // fresh R2 config we just loaded. The app-backend's own `loadConfig` read
  // the same R2 object so this header is mostly redundant — but we still
  // emit it so isolates caching a pre-toggle version of the config can
  // honor the change without waiting for their ETag-based cache to expire.
  if (opts?.config?.security?.enabled === false) {
    headers.set('X-Exepad-Auth-Disabled', '1');
    if (!identity.isAuthenticated) {
      headers.set('X-User-Id', '_exepad_public_');
      headers.set(
        'X-User-Email',
        process.env.EXEPAD_PUBLIC_USER_EMAIL ||
          (env.ENVIRONMENT === 'selfhost' ? 'public@localhost' : 'public@exepad.app'),
      );
      headers.set('X-User-Roles', DEFAULT_PLATFORM_ROLES.join(','));
    }
  }

  return headers;
}

// ─── Bridge token validation (HMAC-SHA256, cross-domain auth) ───────────────

export async function validateBridgeToken(
  token: string,
  bridgeSecret: string,
): Promise<BridgePayload | null> {
  return parseSignedToken<BridgePayload>(token, bridgeSecret, 'platform_bridge');
}

export async function validatePreviewAccessToken(
  token: string,
  bridgeSecret: string,
  appId: string,
): Promise<PreviewAccessPayload | null> {
  const payload = await parseSignedPayload<PreviewAccessPayload | LegacyPreviewAccessPayload>(
    token,
    bridgeSecret,
  );
  if (!payload) return null;

  if ('type' in payload) {
    if (payload.type !== 'preview_access' || payload.appId !== appId) return null;
    return payload;
  }

  if (payload.app !== appId) return null;
  return {
    type: 'preview_access',
    appId,
    uid: payload.uid,
    ...(payload.email ? { email: payload.email } : {}),
    exp: payload.exp,
  };
}

// ─── Router secret validation ───────────────────────────────────────────────

export async function validateRouterSecret(request: Request, env: Env): Promise<boolean> {
  // The edge-router secret gate is a production (Cloudflare) concern. In any
  // non-production deployment — local dev and the self-hosted single container —
  // the gateway is reached same-origin with no fronting router, so allow it.
  if (env.ENVIRONMENT !== 'production') return true;

  // Accept requests that carry the router secret (injected by exepad-runtime-router
  // when it fronts a request from a custom domain / *.exepad.app).
  const expectedSecret = await resolveSecret(env.EXEPAD_ROUTER_SECRET);
  const edgeSecret = request.headers.get('x-exepad-secret');
  if (
    expectedSecret &&
    edgeSecret &&
    constantTimeEqual(edgeSecret, expectedSecret)
  ) {
    return true;
  }

  // Platform-domain bypass: requests that hit the platform worker directly on a
  // PLATFORM_DOMAINS host (e.g. p1.exepad.com) skip the edge-router check — the
  // browser can't inject x-exepad-secret, and there's no fronting router on
  // these hosts. Preview/session auth downstream still gates sensitive routes.
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const platformDomains = env.PLATFORM_DOMAINS || '';
  if (host && platformDomains.split(',').map((d) => d.trim()).includes(host)) {
    return true;
  }

  return false;
}
