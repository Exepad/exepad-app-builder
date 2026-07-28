// src/app_runtime/runtime/components/custom/remote/urlValidator.ts

/**
 * URL Validator for Remote Components
 * 
 * Implements an allowlist-based security model to ensure only
 * trusted CDN domains can be used for loading remote components.
 */

// ============================================================================
// Configuration
// ============================================================================

/**
 * Approved domains for remote component loading.
 * Only URLs from these domains will be accepted.
 *
 * NOTE: `storage.googleapis.com` was removed — it is a shared multi-tenant
 * host, and the suffix-based `matchesDomain` match would trust ANY GCS bucket
 * for arbitrary dynamic import(). Additional remote-CDN hosts should be an
 * explicit operator opt-in, not a baked-in default, for the self-hosted OSS
 * build.
 */
const ALLOWED_DOMAINS: string[] = [
  'cdn.exepad.com',
];

/**
 * Additional domains allowed in development mode only.
 */
const DEV_ALLOWED_DOMAINS: string[] = [
  'localhost',
  '127.0.0.1',
  'localhost:3001',
  'localhost:3000',
  'localhost:5173',
  'exepad.local:3001'
];

// ============================================================================
// Types
// ============================================================================

export interface UrlValidationResult {
  allowed: boolean;
  reason?: string;
  parsedUrl?: URL;
}

export class RemoteUrlValidationError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly reason: string
  ) {
    super(message);
    this.name = 'RemoteUrlValidationError';
  }
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Check if the current environment is development
 */
function isDevelopment(): boolean {
  return import.meta.env.MODE === 'development';
}

/**
 * Get all allowed domains based on current environment
 */
function getAllowedDomains(): string[] {
  const domains = [...ALLOWED_DOMAINS];
  
  if (isDevelopment()) {
    domains.push(...DEV_ALLOWED_DOMAINS);
  }
  
  return domains;
}

/**
 * Check if a hostname matches any allowed domain
 * Supports exact match and subdomain matching
 */
function matchesDomain(hostname: string, port: string | null): boolean {
  const allowedDomains = getAllowedDomains();
  const hostWithPort = port ? `${hostname}:${port}` : hostname;
  
  for (const domain of allowedDomains) {
    // Exact match (with or without port)
    if (hostname === domain || hostWithPort === domain) {
      return true;
    }
    
    // Subdomain match (e.g., sub.cdn.exepad.com matches cdn.exepad.com)
    if (hostname.endsWith(`.${domain}`)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a URL is a same-origin relative path
 */
function isSameOriginPath(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//');
}

/**
 * Get the current origin for resolving relative URLs
 */
function getCurrentOrigin(): string {
  if (typeof window !== 'undefined' && window.location) {
    return window.location.origin;
  }
  // Fallback for SSR/Node.js
  return 'http://localhost:3000';
}

/**
 * Validates a URL against the allowlist.
 * Returns a result object with validation status and details.
 * 
 * Supports:
 * - Absolute URLs (https://cdn.exepad.com/...)
 * - Same-origin relative paths (/runtime_assets/compiled/...)
 * 
 * @param url - The URL to validate
 * @returns UrlValidationResult with allowed status and reason if rejected
 * 
 * @example
 * const result = isAllowedUrl('https://cdn.exepad.com/components/hero.js');
 * if (!result.allowed) {
 *   console.error('Blocked:', result.reason);
 * }
 */
export function isAllowedUrl(url: string): UrlValidationResult {
  // Check for empty or invalid input
  if (!url || typeof url !== 'string') {
    return {
      allowed: false,
      reason: 'URL is empty or invalid',
    };
  }

  // Trim whitespace
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return {
      allowed: false,
      reason: 'URL is empty',
    };
  }

  // Handle same-origin relative paths (e.g., /runtime_assets/compiled/hero.js)
  if (isSameOriginPath(trimmedUrl)) {
    // Resolve against the current origin FIRST so the extension gate keys off
    // the pathname only. Checking the raw string lets a query/fragment fake the
    // extension (e.g. `/evil.html?x=.js` or `/evil.html#x.js`), bypassing the
    // gate before dynamic import(). Mirror the absolute-URL branch below.
    let fullUrl: URL;
    try {
      fullUrl = new URL(trimmedUrl, getCurrentOrigin());
    } catch {
      return {
        allowed: false,
        reason: 'Failed to resolve relative URL',
      };
    }

    const pathname = fullUrl.pathname.toLowerCase();
    if (!pathname.endsWith('.js') && !pathname.endsWith('.mjs')) {
      return {
        allowed: false,
        reason: 'Remote component URL must point to a JavaScript file (.js or .mjs)',
      };
    }

    // Same-origin paths are allowed (browser will handle same-origin policy)
    return {
      allowed: true,
      parsedUrl: fullUrl,
    };
  }

  // Parse the URL (absolute URLs)
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return {
      allowed: false,
      reason: 'Invalid URL format',
    };
  }

  // Enforce HTTPS in production
  if (!isDevelopment()) {
    if (parsedUrl.protocol !== 'https:') {
      return {
        allowed: false,
        reason: 'Only HTTPS URLs are allowed in production',
        parsedUrl,
      };
    }
  } else {
    // In development, allow http and https
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      return {
        allowed: false,
        reason: 'Only HTTP and HTTPS protocols are allowed',
        parsedUrl,
      };
    }
  }

  // Check against allowlist
  const port = parsedUrl.port || null;
  if (!matchesDomain(parsedUrl.hostname, port)) {
    return {
      allowed: false,
      reason: `Domain "${parsedUrl.hostname}" is not in the allowed list`,
      parsedUrl,
    };
  }

  // Validate file extension (should be .js or .mjs for ES modules)
  const pathname = parsedUrl.pathname.toLowerCase();
  if (!pathname.endsWith('.js') && !pathname.endsWith('.mjs')) {
    return {
      allowed: false,
      reason: 'Remote component URL must point to a JavaScript file (.js or .mjs)',
      parsedUrl,
    };
  }

  return {
    allowed: true,
    parsedUrl,
  };
}

/**
 * Validates a URL and throws an error if validation fails.
 * Use this when you want to enforce validation with exceptions.
 * 
 * @param url - The URL to validate
 * @throws RemoteUrlValidationError if validation fails
 * 
 * @example
 * try {
 *   validateRemoteUrl('https://evil.com/malware.js');
 * } catch (error) {
 *   if (error instanceof RemoteUrlValidationError) {
 *     console.error('Blocked:', error.reason);
 *   }
 * }
 */
export function validateRemoteUrl(url: string): URL {
  const result = isAllowedUrl(url);
  
  if (!result.allowed) {
    throw new RemoteUrlValidationError(
      `Remote component URL validation failed: ${result.reason}`,
      url,
      result.reason || 'Unknown validation error'
    );
  }
  
  return result.parsedUrl!;
}

/**
 * Get the list of allowed domains (for debugging/display purposes)
 */
export function getAllowedDomainsList(): string[] {
  return getAllowedDomains();
}

