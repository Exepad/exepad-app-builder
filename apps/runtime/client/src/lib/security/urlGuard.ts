/**
 * URL Security Guards
 *
 * Shared utilities for validating URLs before navigation, redirects, and iframe loading.
 * Used by DynamicRenderer, actionExecutor, service-call, and embed components.
 *
 * Design: All dangerous-scheme checks are always enforced (no dev bypass).
 * Protocol checks (https-only) are relaxed when the page itself is served over http (dev mode).
 */

const DANGEROUS_SCHEMES = ['javascript:', 'data:', 'vbscript:'];

/**
 * Normalize a URL string for scheme comparison.
 * Strips control characters (tabs, newlines, null bytes) that some parsers
 * may silently ignore, then URL-decodes and lowercases for comparison.
 */
function normalizeForSchemeCheck(url: string): string {
  // Strip ASCII control characters (0x00-0x1F) and DEL (0x7F) that parsers may ignore
  // eslint-disable-next-line no-control-regex
  let cleaned = url.replace(/[\x00-\x1f\x7f]/g, '');

  // Attempt URL decoding (repeat to catch double-encoding)
  try {
    let prev = cleaned;
    for (let i = 0; i < 3; i++) {
      cleaned = decodeURIComponent(cleaned);
      if (cleaned === prev) break;
      prev = cleaned;
    }
  } catch {
    // decodeURIComponent throws on malformed sequences — use the cleaned version
  }

  return cleaned.toLowerCase().trim();
}

/**
 * Check if a URL uses a dangerous scheme that could execute code.
 * Always enforced regardless of environment.
 */
export function isDangerousScheme(url: string): boolean {
  const normalized = normalizeForSchemeCheck(url);
  return DANGEROUS_SCHEMES.some(scheme => normalized.startsWith(scheme));
}

/**
 * Check if a URL is safe for navigation (window.location assignment, router.push, etc.)
 * Blocks dangerous schemes. Allows all other URLs.
 */
export function isSafeNavigationUrl(url: string): boolean {
  return !isDangerousScheme(url);
}

/**
 * Check if a URL is safe for use as an iframe src.
 * Blocks dangerous schemes and blob: URLs.
 * In production (https), also blocks http:// URLs.
 * In development (http), allows http:// URLs for local testing.
 */
export function isSafeIframeSrc(url: string): boolean {
  const normalized = normalizeForSchemeCheck(url);

  // Always block dangerous schemes
  if (DANGEROUS_SCHEMES.some(scheme => normalized.startsWith(scheme))) return false;

  // Block blob: for iframes (could bypass CSP)
  if (normalized.startsWith('blob:')) return false;

  // In production, block http:// (only allow https://)
  // In development (page served over http), allow http://
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    if (normalized.startsWith('http://')) return false;
  }

  return true;
}

/**
 * Check if a redirect URL is same-origin (always allowed) or matches an allowlist.
 * Relative URLs are always considered safe.
 */
export function isSafeRedirectUrl(
  url: string,
  allowedDomains: string[] = []
): boolean {
  // Dangerous schemes are never allowed
  if (isDangerousScheme(url)) return false;

  // Relative URLs (starting with / but not //) are always safe
  if (url.startsWith('/') && !url.startsWith('//')) return true;

  // Hash-only URLs are safe
  if (url.startsWith('#')) return true;

  // Check same-origin
  if (typeof window !== 'undefined') {
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.origin === window.location.origin) return true;

      // Check against allowlist
      return allowedDomains.some(domain =>
        parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
      );
    } catch {
      // Invalid URL — block it
      return false;
    }
  }

  // SSR fallback: allow relative, block absolute
  return !url.includes('://');
}
