/**
 * Auth Email Transport
 *
 * This is NOT a platform service. It is the minimal email transport used
 * exclusively by per-app auth (password reset + email verification). It
 * resolves a template, interpolates variables, and POSTs the rendered
 * message to the Runtime's email proxy (which owns RESEND_API_KEY, so the key
 * never reaches app-backend code). In self-host that proxy is reached over
 * loopback via PLATFORM_URL. No D1 logging, no service registry.
 *
 * Access pattern:
 *   - createEmailService(deps).send()  — from auth handlers only
 */

import type { Env } from '../types/env';
import { resolveTemplate, interpolate } from './email.templates';

const DEFAULT_FROM_ADDRESS = 'noreply@exepad.com';
const PLATFORM_EMAIL_PATH = '/api/platform/email/send';

// ── Types (self-contained — no @exepad/types dependency) ────────

/** Minimal email config consumed by the auth transport. */
export interface EmailServiceProps {
  /** Sender address. Defaults to noreply@exepad.com. */
  fromAddress?: string;
  /** Sender display name. Defaults to the app name/id. */
  fromName?: string;
  /** Reply-to address. */
  replyTo?: string;
  /** App-defined inline templates, keyed by template name. */
  templates?: Record<string, { subject: string; html: string }>;
}

/** Parameters accepted by the send() method. */
export interface EmailSendParams {
  to: string;
  subject?: string;
  html?: string;
  template?: string;
  data?: Record<string, unknown>;
}

/** Result returned by the send() method. */
export interface EmailSendResult {
  success: boolean;
  messageId?: string;
}

/** Minimal client surface used by the auth handlers. */
export interface EmailServiceClient {
  send(params: EmailSendParams): Promise<EmailSendResult>;
}

export interface EmailServiceDeps {
  config: EmailServiceProps;
  platform: PlatformFetcher;
  appId: string;
  appName?: string;
  /** Shared secret for Runtime RPC authentication (optional, defense-in-depth). */
  platformSecret?: string;
}

interface PlatformFetcher {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

interface RuntimeEmailResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  statusCode?: number;
}

// ── Factory ─────────────────────────────────────────────────────

/**
 * Create the auth email transport.
 *
 * Resolves a template/interpolates inline HTML, then POSTs the rendered
 * message to the Runtime email proxy. Returns success + messageId.
 */
export function createEmailService(deps: EmailServiceDeps): EmailServiceClient {
  const { config, platform, appId, appName, platformSecret } = deps;
  const fromAddress = config.fromAddress || DEFAULT_FROM_ADDRESS;
  const fromName = config.fromName || appName || appId;

  return {
    async send(params) {
      // 1. Resolve template → HTML + subject
      let html = params.html || '';
      let subject = params.subject;

      if (params.template) {
        try {
          const resolved = resolveTemplate(
            params.template,
            params.data || {},
            config.templates
          );
          html = resolved.html;
          if (resolved.subject) subject = resolved.subject;
        } catch (err) {
          console.error(`[${appId}/email] Template resolution failed:`, err);
          return { success: false };
        }
      } else if (params.data && html) {
        // Inline HTML with {{variable}} interpolation
        html = interpolate(html, params.data);
      }

      if (!subject) {
        console.error(`[${appId}/email] No subject provided and no template subject`);
        return { success: false };
      }

      // 2. Call Runtime via PLATFORM service binding → Resend
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (platformSecret) {
          headers['X-Platform-Secret'] = platformSecret;
        }

        const response = await platform.fetch(`http://platform${PLATFORM_EMAIL_PATH}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            to: params.to,
            from: { email: fromAddress, name: fromName },
            subject,
            html: html || undefined,
            replyTo: config.replyTo,
          }),
        });

        const result: RuntimeEmailResponse = await response.json();

        if (result.success) {
          return { success: true, messageId: result.messageId };
        }

        console.error(`[${appId}/email] Send failed:`, result.error);
        return { success: false };
      } catch (err) {
        console.error(`[${appId}/email] Platform RPC failed:`, err);
        return { success: false };
      }
    },
  };
}

// ── Platform Fetcher Builder ────────────────────────────────────

/**
 * Build a platform fetcher from app-backend environment bindings.
 *
 * Uses a PLATFORM Fetcher binding when one is provided; otherwise falls back to
 * an HTTP fetch against PLATFORM_URL. Self-host takes the PLATFORM_URL path —
 * the runtime's build-user-env.ts points it at its own loopback listener, since
 * the app-backend runs in-process and there is no service binding to hand it.
 */
export function buildPlatformFetcher(env: Env): PlatformFetcher {
  if (env.PLATFORM) {
    return env.PLATFORM;
  }

  const platformUrl = env.PLATFORM_URL || 'http://localhost:3000';
  return {
    fetch(url: string, init?: RequestInit): Promise<Response> {
      // Rewrite the http://platform/... sentinel origin to the real base URL.
      const rewritten = url.replace('http://platform', platformUrl);
      return globalThis.fetch(rewritten, init);
    },
  };
}
