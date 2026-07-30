/**
 * Tests for gateway JWT auth — verifies HS256 tokens from dev service.
 */

import { describe, it, expect } from 'vitest';
import { verifyGatewayToken } from '../../src/mcp/gateway-auth';

// Helper: create a valid HS256 JWT using Web Crypto API
async function createTestJwt(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  const sigB64 = base64UrlEncode(new Uint8Array(signature));

  return `${signingInput}.${sigB64}`;
}

function base64UrlEncode(data: string | Uint8Array): string {
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const TEST_SECRET = 'test-gateway-secret';

function makePayload(overrides?: Record<string, unknown>) {
  return {
    sub: 'user-123',
    email: 'test@example.com',
    app_id: 'app-abc',
    scopes: ['*'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    iss: 'exepad-gateway',
    ...overrides,
  };
}

describe('verifyGatewayToken', () => {
  it('verifies a valid token and returns UserContext', async () => {
    const token = await createTestJwt(makePayload(), TEST_SECRET);
    const user = await verifyGatewayToken(token, TEST_SECRET);

    expect(user).not.toBeNull();
    expect(user!.id).toBe('user-123');
    expect(user!.email).toBe('test@example.com');
    expect(user!.isAuthenticated).toBe(true);
    expect(user!.authMethod).toBe('api_key');
    expect(user!.apiKeyScopes).toEqual(['*']);
    expect(user!.apiKeyId).toBe('gateway');
  });

  it('returns null for missing secret', async () => {
    const token = await createTestJwt(makePayload(), TEST_SECRET);
    const user = await verifyGatewayToken(token, undefined);
    expect(user).toBeNull();
  });

  it('returns null for empty secret', async () => {
    const token = await createTestJwt(makePayload(), TEST_SECRET);
    const user = await verifyGatewayToken(token, '');
    expect(user).toBeNull();
  });

  it('returns null for wrong secret', async () => {
    const token = await createTestJwt(makePayload(), TEST_SECRET);
    const user = await verifyGatewayToken(token, 'wrong-secret');
    expect(user).toBeNull();
  });

  it('returns null for expired token', async () => {
    const token = await createTestJwt(
      makePayload({ exp: Math.floor(Date.now() / 1000) - 60 }),
      TEST_SECRET,
    );
    const user = await verifyGatewayToken(token, TEST_SECRET);
    expect(user).toBeNull();
  });

  it('returns null for wrong issuer', async () => {
    const token = await createTestJwt(
      makePayload({ iss: 'wrong-issuer' }),
      TEST_SECRET,
    );
    const user = await verifyGatewayToken(token, TEST_SECRET);
    expect(user).toBeNull();
  });

  it('returns null for malformed token', async () => {
    expect(await verifyGatewayToken('not-a-jwt', TEST_SECRET)).toBeNull();
    expect(await verifyGatewayToken('a.b', TEST_SECRET)).toBeNull();
    expect(await verifyGatewayToken('', TEST_SECRET)).toBeNull();
  });

  it('returns null for tampered payload', async () => {
    const token = await createTestJwt(makePayload(), TEST_SECRET);
    const parts = token.split('.');
    // Tamper with payload
    const tampered = `${parts[0]}.${base64UrlEncode('{"sub":"hacker"}')}.${parts[2]}`;
    const user = await verifyGatewayToken(tampered, TEST_SECRET);
    expect(user).toBeNull();
  });

  it('preserves scopes from token', async () => {
    const token = await createTestJwt(
      makePayload({ scopes: ['model:contacts:read', 'model:contacts:list'] }),
      TEST_SECRET,
    );
    const user = await verifyGatewayToken(token, TEST_SECRET);
    expect(user).not.toBeNull();
    expect(user!.apiKeyScopes).toEqual(['model:contacts:read', 'model:contacts:list']);
  });

  describe('app_id binding (cross-app replay defense)', () => {
    it('accepts a token whose app_id matches the served app', async () => {
      const token = await createTestJwt(makePayload({ app_id: 'app-abc' }), TEST_SECRET);
      const user = await verifyGatewayToken(token, TEST_SECRET, 'app-abc');
      expect(user).not.toBeNull();
    });

    it('rejects a token minted for another app (mismatched app_id)', async () => {
      const token = await createTestJwt(makePayload({ app_id: 'app-abc' }), TEST_SECRET);
      const user = await verifyGatewayToken(token, TEST_SECRET, 'app-other');
      expect(user).toBeNull();
    });

    it('fails closed on a token that omits app_id when an app id is expected', async () => {
      const p = makePayload();
      delete (p as Record<string, unknown>).app_id;
      const token = await createTestJwt(p, TEST_SECRET);
      // Shared signing secret ⇒ an app_id-less token must NOT be a wildcard.
      const user = await verifyGatewayToken(token, TEST_SECRET, 'app-abc');
      expect(user).toBeNull();
    });

    it('still verifies when no expected app id is passed (no binding requested)', async () => {
      const p = makePayload();
      delete (p as Record<string, unknown>).app_id;
      const token = await createTestJwt(p, TEST_SECRET);
      const user = await verifyGatewayToken(token, TEST_SECRET);
      expect(user).not.toBeNull();
    });
  });
});
