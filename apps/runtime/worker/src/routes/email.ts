/**
 * Platform Email Send Route (Hono / Cloudflare Workers)
 *
 * Ported from: apps/runtime/src/app/api/platform/email/send/route.ts
 *
 * Internal endpoint that proxies email sends to Resend. This is the security
 * boundary — the RESEND_API_KEY exists only in the Runtime environment, never
 * in app-backend isolates where custom handler code runs.
 *
 * Reachable via:
 *   - a PLATFORM service binding, where one exists
 *   - direct HTTP fetch against PLATFORM_URL — the self-host path, where the
 *     in-process app-backend calls back into this same server over loopback
 *     (see the runtime's server/build-user-env.ts)
 *
 * The route IS mounted on the public router, so X-Platform-Secret is the only
 * thing gating it: unset secret outside development fails closed with 503, and
 * a wrong secret is rejected 403 via a constant-time compare.
 */

import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../types/env';
import { constantTimeEqual } from '../lib/crypto-utils';
import { resolveSecret } from '../lib/secrets';

interface EmailSendRequest {
  to: string | string[];
  from: { email: string; name?: string };
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
}

interface EmailSendResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  statusCode?: number;
}

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Allowed sender domains for the platform email proxy. Defaults to the Exepad
 * cloud domains; self-host overrides via `EXEPAD_EMAIL_SENDER_DOMAINS`
 * (comma-separated, e.g. `mail.company.com,company.com`). Setting the env var to
 * an empty string explicitly disables the domain restriction (allow any domain)
 * — useful when the operator's Resend account validates the domains itself.
 *
 * Returns `null` to mean "allow any domain", or an array of lowercased domains.
 */
function resolveAllowedSenderDomains(): string[] | null {
  const raw = process.env.EXEPAD_EMAIL_SENDER_DOMAINS;
  if (raw === undefined) return ['exepad.com', 'exepad.app'];
  // Explicit empty string → allow any domain.
  if (raw.trim() === '') return null;
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export const email = new Hono<{ Bindings: Env }>();

// ── POST /send — Validate secret, validate from domain, call Resend ───

email.post('/send', async (c) => {
  const internalSecret = await resolveSecret(c.env.PLATFORM_INTERNAL_SECRET);
  const isDev = c.env.ENVIRONMENT === 'development';

  if (!isDev && !internalSecret) {
    console.error('[Platform/Email] PLATFORM_INTERNAL_SECRET is not configured');
    return c.json(
      { success: false, error: 'Service misconfigured' } satisfies EmailSendResponse,
      503,
    );
  }

  if (internalSecret) {
    const provided = c.req.header('X-Platform-Secret');
    if (!provided || !constantTimeEqual(provided, internalSecret)) {
      return c.json(
        { success: false, error: 'Unauthorized' } satisfies EmailSendResponse,
        403,
      );
    }
  }

  let body: EmailSendRequest;
  try {
    body = await c.req.json<EmailSendRequest>();
  } catch {
    return c.json(
      { success: false, error: 'Invalid JSON body' } satisfies EmailSendResponse,
      400,
    );
  }

  if (!body.to || !body.subject || (!body.html && !body.text)) {
    return c.json(
      { success: false, error: 'Missing required fields: to, subject, and html or text' } satisfies EmailSendResponse,
      400,
    );
  }

  if (!body.from?.email) {
    return c.json(
      { success: false, error: 'Missing required field: from.email' } satisfies EmailSendResponse,
      400,
    );
  }

  const allowedSenderDomains = resolveAllowedSenderDomains();
  if (allowedSenderDomains !== null) {
    const fromDomain = body.from.email.split('@')[1]?.toLowerCase() || '';
    if (!allowedSenderDomains.includes(fromDomain)) {
      return c.json(
        {
          success: false,
          error: `Invalid from address: ${body.from.email}. Must be @${allowedSenderDomains.join(' / @')}`,
        } satisfies EmailSendResponse,
        400,
      );
    }
  }

  let apiKey: string;
  try {
    const raw = c.env.RESEND_API_KEY;
    // SecretStoreSecret in production (.get()), plain string in local dev via .dev.vars
    const resolved = typeof raw === 'string' ? raw : await raw.get();
    apiKey = resolved || '';
  } catch {
    console.error('[Platform/Email] RESEND_API_KEY is not configured');
    return c.json(
      { success: false, error: 'Email provider not configured' } satisfies EmailSendResponse,
      500,
    );
  }
  if (!apiKey) {
    console.error('[Platform/Email] RESEND_API_KEY is empty');
    return c.json(
      { success: false, error: 'Email provider not configured' } satisfies EmailSendResponse,
      500,
    );
  }

  const resendPayload: Record<string, unknown> = {
    from: body.from.name ? `${body.from.name} <${body.from.email}>` : body.from.email,
    to: Array.isArray(body.to) ? body.to : [body.to],
    subject: body.subject,
    ...(body.html ? { html: body.html } : {}),
    ...(body.text ? { text: body.text } : {}),
    ...(body.replyTo ? { reply_to: body.replyTo } : {}),
    ...(body.cc?.length ? { cc: body.cc } : {}),
    ...(body.bcc?.length ? { bcc: body.bcc } : {}),
  };

  try {
    const resendResponse = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendPayload),
    });

    if (resendResponse.ok) {
      const result = await resendResponse.json<{ id: string }>();
      return c.json({
        success: true,
        messageId: result.id || undefined,
      } satisfies EmailSendResponse);
    }

    const errorBody = await resendResponse.text();
    console.error(`[Platform/Email] Resend error ${resendResponse.status}:`, errorBody);

    // Surface the failure as a non-2xx HTTP status so callers keying on
    // response.ok see the send failed (Hono defaults to 200 with no status arg,
    // which would report a hard delivery failure as success).
    const upstream = (resendResponse.status >= 400 ? resendResponse.status : 502) as ContentfulStatusCode;
    return c.json(
      {
        success: false,
        error: errorBody,
        statusCode: resendResponse.status,
      } satisfies EmailSendResponse,
      upstream,
    );
  } catch (err) {
    console.error('[Platform/Email] Resend request failed:', err);
    return c.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Resend request failed',
      } satisfies EmailSendResponse,
      502,
    );
  }
});
