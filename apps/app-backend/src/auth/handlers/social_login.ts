/**
 * auth_social_login — Initiate OAuth flow for a social provider.
 *
 * ⚠️  INCOMPLETE IN THE SELF-HOSTED BUILD. Validates that the provider is
 * enabled, mints a single-use nonce, stores the OAuth state, and returns a
 * redirect URL pointing at `/api/auth/oauth/start` on the platform — an
 * endpoint the self-hosted runtime does NOT serve (the provider callback that
 * would hold the client credentials and complete the exchange was never ported
 * off Workers-for-Platforms and has been removed). The flow therefore cannot
 * complete; email/password is the supported per-app auth method. The default
 * login page never surfaces a social button on its own, so this method is only
 * reached by a client that calls it explicitly.
 */

import type { SecurityProps } from '@exepad/types';
import type { Env } from '../../types/env';
import { generateId, hashSessionToken, expiresAt } from '../utils';
import { ValidationError } from '../../utils/errors';

const OAUTH_STATE_TTL = 300; // 5 minutes

/**
 * Decide whether a browser-reported origin may be stored as the trusted
 * finalize base for the OAuth callback. Cloud `*.exepad.app` origins are
 * always honored. Under self-host (`ENVIRONMENT === 'selfhost'`), apps are
 * served same-origin under `/a/{appId}/`, so the live origin is the real
 * deployment URL — honor localhost / loopback / `.local` / `.internal` hosts
 * and any `http(s)` origin. This value is only ever a HINT: the provider
 * callback is the authority and must re-check it against the live request
 * origin before redirecting anywhere.
 */
function isTrustedOrigin(candidate: string, env: Env): boolean {
  if (!candidate) return false;

  // Cloud: any `https://<sub>.exepad.app` origin.
  if (/^https:\/\/[a-z0-9][a-z0-9-]*\.exepad\.app$/i.test(candidate)) return true;

  if (env.ENVIRONMENT !== 'selfhost') return false;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return true;
  }

  // Self-host single-origin deployment: the browser origin is the real
  // deployment URL (possibly behind a TLS-terminating reverse proxy). Preserve
  // it; the runtime callback is the authority that confirms it matches the
  // live request origin or the operator allowlist before redirecting.
  return true;
}

function extractProviderNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && 'provider' in entry) {
        return String((entry as { provider: unknown }).provider || '');
      }
      return '';
    })
    .filter(Boolean);
}

export async function authSocialLogin(
  params: Record<string, unknown>,
  db: D1Database,
  security: SecurityProps,
  env: Env
): Promise<{ redirect_url: string }> {
  const provider = params.provider as string | undefined;

  if (!provider) {
    throw new ValidationError('Provider is required', 'provider');
  }

  // Validate provider is enabled in security config. Normalize both the
  // canonical object shape (`[{provider:'google'}]`) and the legacy
  // bare-string shape (`['google']`) that older agent builds emitted.
  // Mirrors the client-side normalization in DefaultLoginPage.tsx so the
  // button and the server agree on which providers are enabled.
  const enabledProviders = extractProviderNames(security.authProviders);
  if (!enabledProviders.includes(provider)) {
    throw new ValidationError(`Provider '${provider}' is not enabled for this app`, 'provider');
  }

  // Only social providers are valid (not 'email')
  if (provider === 'email') {
    throw new ValidationError('Use auth_signin for email/password login', 'provider');
  }

  // Generate a nonce to link the OAuth state across redirects
  const nonce = generateId();
  const nonceHash = await hashSessionToken(nonce);

  // Determine return URL (where the user should land after auth)
  const returnUrl = typeof params.return_url === 'string' ? params.return_url : '/';

  // Capture the live origin the browser is on (e.g. `https://customer.com` or
  // `http://localhost:8080`). A provider callback would use this to redirect
  // back to the exact origin the user came from, rather than reconstructing one
  // from `env.APP_ALIAS` (which can differ from the live host — casing, dashes,
  // custom domains). Self-hosted apps are served same-origin under
  // `/a/{appId}/`, so the stored origin IS the live origin. It is stored as a
  // hint only; the callback applies the final trust check before using it.
  const rawOrigin = typeof params.origin === 'string' ? params.origin : '';
  const origin = isTrustedOrigin(rawOrigin, env) ? rawOrigin : '';

  // Store OAuth state in _auth_verification_tokens
  // user_id field is repurposed to store JSON metadata for oauth_state tokens
  const stateData = JSON.stringify({
    returnUrl,
    provider,
    appAlias: env.APP_ALIAS,
    origin,
  });

  await db
    .prepare(
      `INSERT INTO _auth_verification_tokens (token, user_id, type, expires_at)
       VALUES (?, ?, 'oauth_state', ?)`
    )
    .bind(nonceHash, stateData, expiresAt(OAUTH_STATE_TTL))
    .run();

  // Build redirect URL to the runtime's OAuth start endpoint
  const platformUrl = env.PLATFORM_URL || 'https://exepad.app';
  const startUrl = new URL('/api/auth/oauth/start', platformUrl);
  startUrl.searchParams.set('app', env.APP_ID);
  startUrl.searchParams.set('nonce', nonce);
  startUrl.searchParams.set('provider', provider);

  return { redirect_url: startUrl.toString() };
}
