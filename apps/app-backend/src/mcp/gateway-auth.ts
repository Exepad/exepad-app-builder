/**
 * Gateway JWT verification for MCP transport.
 *
 * Verifies HS256 JWTs issued by the dev service gateway.
 * Uses Web Crypto API (available in Cloudflare Workers).
 */

import type { UserContext } from '../rpc/types';

export interface GatewayJwtPayload {
  sub: string;
  email: string;
  app_id: string;
  scopes: string[];
  iat: number;
  exp: number;
  iss: string;
}

/**
 * Verify a gateway JWT and return a UserContext.
 *
 * Returns null if the token is invalid, expired, or the secret is not set.
 *
 * When ``expectedAppId`` is supplied (the id of the app currently being
 * served), the token MUST carry a matching ``app_id`` claim — this binds a
 * token minted for app A to app A only, so it cannot be replayed against app
 * B's ``/mcp``. Because the same ``GATEWAY_JWT_SECRET`` is shared across every
 * app in the container, a token that OMITS ``app_id`` would otherwise verify
 * against — and be replayable on — any app, so we fail closed on a missing
 * claim rather than treating it as a wildcard.
 */
export async function verifyGatewayToken(
  token: string,
  secret: string | undefined,
  expectedAppId?: string,
): Promise<UserContext | null> {
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    // Import HMAC key
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    // Verify signature
    const signatureBytes = base64UrlDecode(parts[2]);
    const data = encoder.encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, data);
    if (!valid) return null;

    // Decode payload
    const payload: GatewayJwtPayload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(parts[1])),
    );

    // Check expiry — fail closed on a missing/non-numeric exp. `undefined < n`
    // is false, so a token that omits exp would otherwise never expire.
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;

    // Check issuer
    if (payload.iss !== 'exepad-gateway') return null;

    // Bind the token to this app. A token minted for app A must not be
    // accepted by app B's /mcp. When the caller passes the current app id we
    // REQUIRE the app_id claim and fail closed if it is missing or mismatched:
    // the signing secret is shared across apps, so an app_id-less token would
    // otherwise be replayable against every app's MCP surface.
    if (expectedAppId && payload.app_id !== expectedAppId) {
      return null;
    }

    // Build UserContext (treated as API key auth for scope enforcement).
    // roles is empty: gateway JWT auth only supports scope-based access control
    // (e.g. model:posts:read), not role-based CRUD policies (e.g. role:editor).
    // To grant role-based access, use per-app API keys which carry the user's roles.
    return {
      id: payload.sub,
      email: payload.email,
      roles: [],
      isAuthenticated: true,
      authMethod: 'api_key',
      apiKeyScopes: payload.scopes,
      apiKeyId: 'gateway',
    };
  } catch {
    return null;
  }
}

function base64UrlDecode(s: string): Uint8Array {
  // Add padding
  let padded = s;
  const remainder = padded.length % 4;
  if (remainder === 2) padded += '==';
  else if (remainder === 3) padded += '=';

  // Convert base64url to base64
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
