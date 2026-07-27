// @vitest-environment node
/**
 * routes/email.ts — the auth-internal Resend proxy (email verification +
 * password reset transport). It is the security boundary that keeps the
 * RESEND_API_KEY out of app-backend isolates, so its secret gate, sender-domain
 * allowlist, and upstream-failure surfacing must hold. Previously untested.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { email } from '../../../worker/src/routes/email';
import type { Env } from '../../../worker/src/types/env';

const SECRET = 'internal-secret-123';

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    PLATFORM_INTERNAL_SECRET: SECRET,
    RESEND_API_KEY: 're_test_key',
    ENVIRONMENT: 'production',
    ...overrides,
  } as unknown as Env;
}

function send(body: unknown, headers: Record<string, string> = {}, env: Env = makeEnv()) {
  return email.request(
    '/send',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    },
    env,
  );
}

const validBody = {
  to: 'user@customer.example',
  from: { email: 'noreply@exepad.com', name: 'Exepad' },
  subject: 'Verify your email',
  html: '<p>hi</p>',
};

beforeEach(() => {
  // Force the default sender allowlist (exepad.com / exepad.app).
  delete process.env.EXEPAD_EMAIL_SENDER_DOMAINS;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /send — auth gate', () => {
  it('rejects a missing/incorrect internal secret with 403', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const noHeader = await send(validBody);
    expect(noHeader.status).toBe(403);

    const wrong = await send(validBody, { 'X-Platform-Secret': 'nope' });
    expect(wrong.status).toBe(403);

    // The upstream Resend API must never be called on an auth failure.
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('returns 503 when the internal secret is unset in production (fail closed)', async () => {
    const res = await send(validBody, {}, makeEnv({ PLATFORM_INTERNAL_SECRET: '' }));
    expect(res.status).toBe(503);
  });
});

describe('POST /send — validation', () => {
  it('rejects a sender outside the allowlist (no arbitrary-relay) with 400', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await send(
      { ...validBody, from: { email: 'attacker@evil.example' } },
      { 'X-Platform-Secret': SECRET },
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a body missing required fields with 400', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const res = await send(
      { to: 'user@customer.example', from: { email: 'noreply@exepad.com' } },
      { 'X-Platform-Secret': SECRET },
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /send — upstream behavior', () => {
  it('surfaces a Resend failure as a non-2xx status (not a 200 success)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"invalid"}', { status: 422 })),
    );
    const res = await send(validBody, { 'X-Platform-Secret': SECRET });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(422);
    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(false);
  });

  it('relays an allowed send and returns the Resend message id', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await send(validBody, { 'X-Platform-Secret': SECRET });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; messageId?: string };
    expect(json.success).toBe(true);
    expect(json.messageId).toBe('msg_1');
    // Bearer-authenticated call to Resend was made exactly once.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
