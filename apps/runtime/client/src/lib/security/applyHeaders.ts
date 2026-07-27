/**
 * HTTP Security Header Builder
 *
 * Converts a SecurityRuleSet into HTTP response headers.
 * Used by the middleware to set CSP, XFO, XCTO, etc.
 */

import type { SecurityRuleSet } from './types';

/**
 * Build a map of security headers from the resolved rule set.
 * Optionally accepts a nonce for CSP script-src.
 */
export function buildSecurityHeaders(
  rules: SecurityRuleSet,
  nonce?: string
): Record<string, string> {
  const headers: Record<string, string> = {};

  // --- CSP ---
  if (rules.headers.csp.enabled) {
    const directives = Object.entries(rules.headers.csp.directives)
      .map(([key, values]) => {
        const resolved = nonce
          ? values.map(v => (v === "'unsafe-inline'" && key === 'script-src' ? `'nonce-${nonce}'` : v))
          : values;
        return `${key} ${resolved.join(' ')}`;
      })
      .join('; ');

    const headerName = rules.headers.csp.reportOnly
      ? 'Content-Security-Policy-Report-Only'
      : 'Content-Security-Policy';
    headers[headerName] = directives;
  }

  // --- X-Frame-Options (legacy fallback; CSP frame-ancestors takes precedence) ---
  if (rules.headers.frameProtection.enabled) {
    headers['X-Frame-Options'] =
      rules.headers.frameProtection.mode === 'deny' ? 'DENY' : 'SAMEORIGIN';
  }

  // --- X-Content-Type-Options ---
  if (rules.headers.contentTypeOptions.enabled) {
    headers['X-Content-Type-Options'] = 'nosniff';
  }

  // --- Referrer-Policy ---
  if (rules.headers.referrerPolicy.enabled) {
    headers['Referrer-Policy'] = rules.headers.referrerPolicy.policy;
  }

  // --- Permissions-Policy ---
  if (rules.headers.permissionsPolicy.enabled) {
    const policy = Object.entries(rules.headers.permissionsPolicy.directives)
      .map(([feature, allowlist]) => {
        if (allowlist.length === 0) return `${feature}=()`;
        return `${feature}=(${allowlist.join(' ')})`;
      })
      .join(', ');
    headers['Permissions-Policy'] = policy;
  }

  return headers;
}
