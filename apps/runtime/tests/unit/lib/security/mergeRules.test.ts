/**
 * Security Rules Merge + Apply Headers Tests
 *
 * Tests for resolveSecurityRules (merge logic, locked rules, validation)
 * and buildSecurityHeaders (header generation, nonce replacement).
 */

import { describe, it, expect } from 'vitest';
import { resolveSecurityRules } from '@/lib/security/mergeRules';
import { buildSecurityHeaders } from '@/lib/security/applyHeaders';
import { DEFAULT_SECURITY_RULES } from '@/lib/security/defaults';

describe('resolveSecurityRules', () => {
  it('should return defaults when no overrides are provided', () => {
    expect(resolveSecurityRules()).toEqual(DEFAULT_SECURITY_RULES);
    expect(resolveSecurityRules(undefined)).toEqual(DEFAULT_SECURITY_RULES);
  });

  it('should return defaults when empty overrides are provided', () => {
    const result = resolveSecurityRules({});
    expect(result).toEqual(DEFAULT_SECURITY_RULES);
  });

  // --- CSP directive merging ---
  describe('CSP directive merging', () => {
    it('should additively merge CSP sources', () => {
      const result = resolveSecurityRules({
        headers: {
          csp: {
            directives: {
              'connect-src': ['https://api.custom.com'],
            },
          },
        },
      });
      expect(result.headers.csp.directives['connect-src']).toContain("'self'");
      expect(result.headers.csp.directives['connect-src']).toContain('https://api.custom.com');
      expect(result.headers.csp.directives['connect-src']).toContain('https://backend.exepad.com');
    });

    it('should deduplicate CSP sources', () => {
      const result = resolveSecurityRules({
        headers: {
          csp: {
            directives: {
              'connect-src': ["'self'"], // already in defaults
            },
          },
        },
      });
      const selfCount = result.headers.csp.directives['connect-src'].filter(s => s === "'self'").length;
      expect(selfCount).toBe(1);
    });

    it('should add new directive not in defaults', () => {
      const result = resolveSecurityRules({
        headers: {
          csp: {
            directives: {
              'worker-src': ["'self'", 'blob:'],
            },
          },
        },
      });
      expect(result.headers.csp.directives['worker-src']).toEqual(["'self'", 'blob:']);
    });

    it('should block wildcard * in script-src', () => {
      const result = resolveSecurityRules({
        headers: {
          csp: {
            directives: {
              'script-src': ['*', 'https://safe.cdn.com'],
            },
          },
        },
      });
      expect(result.headers.csp.directives['script-src']).not.toContain('*');
      expect(result.headers.csp.directives['script-src']).toContain('https://safe.cdn.com');
    });

    it('should block unsafe-eval in script-src', () => {
      const result = resolveSecurityRules({
        headers: {
          csp: {
            directives: {
              'script-src': ["'unsafe-eval'"],
            },
          },
        },
      });
      expect(result.headers.csp.directives['script-src']).not.toContain("'unsafe-eval'");
    });

    it('should block wildcard in default-src', () => {
      const result = resolveSecurityRules({
        headers: {
          csp: {
            directives: {
              'default-src': ['*'],
            },
          },
        },
      });
      expect(result.headers.csp.directives['default-src']).not.toContain('*');
    });

    it('should allow wildcard in non-sensitive directives like img-src', () => {
      const result = resolveSecurityRules({
        headers: {
          csp: {
            directives: {
              'img-src': ['*'],
            },
          },
        },
      });
      expect(result.headers.csp.directives['img-src']).toContain('*');
    });

    it('should skip non-array directive values', () => {
      const result = resolveSecurityRules({
        headers: {
          csp: {
            directives: {
              'script-src': 'invalid' as any,
            },
          },
        },
      });
      // Should keep defaults unchanged
      expect(result.headers.csp.directives['script-src']).toEqual(
        DEFAULT_SECURITY_RULES.headers.csp.directives['script-src']
      );
    });

    it('should ignore __proto__ directive to prevent prototype pollution', () => {
      // Simulate a malicious app config with __proto__ as a CSP directive key
      const malicious = {
        headers: {
          csp: {
            directives: JSON.parse('{"__proto__": ["evil.com"], "img-src": ["cdn.example.com"]}'),
          },
        },
      };
      // Should not throw and should still merge legitimate directives
      const result = resolveSecurityRules(malicious);
      expect(result.headers.csp.directives['img-src']).toContain('cdn.example.com');
      // __proto__ should not appear as an own property on directives
      expect(Object.prototype.hasOwnProperty.call(result.headers.csp.directives, '__proto__')).toBe(false);
    });

    it('should ignore constructor and prototype directive keys', () => {
      const result = resolveSecurityRules({
        headers: {
          csp: {
            directives: {
              'constructor': ['evil.com'],
              'prototype': ['evil.com'],
            } as any,
          },
        },
      });
      expect(Object.prototype.hasOwnProperty.call(result.headers.csp.directives, 'constructor')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(result.headers.csp.directives, 'prototype')).toBe(false);
    });
  });

  // --- Locked rules ---
  describe('locked rules', () => {
    it('should not allow disabling forceSanitize', () => {
      const result = resolveSecurityRules({
        content: {
          forceSanitize: { enabled: false },
        },
      });
      expect(result.content.forceSanitize.enabled).toBe(true);
    });

    it('should not allow disabling blockDangerousSchemes', () => {
      const result = resolveSecurityRules({
        content: {
          blockDangerousSchemes: { enabled: false },
        },
      });
      expect(result.content.blockDangerousSchemes.enabled).toBe(true);
    });

    it('should not allow disabling contentTypeOptions', () => {
      const result = resolveSecurityRules({
        headers: {
          contentTypeOptions: { enabled: false },
        },
      });
      expect(result.headers.contentTypeOptions.enabled).toBe(true);
    });
  });

  // --- Frame protection ---
  describe('frame protection overrides', () => {
    it('should additively merge allowed origins', () => {
      const result = resolveSecurityRules({
        headers: {
          frameProtection: {
            allowedOrigins: ['https://custom.com'],
          },
        },
      });
      expect(result.headers.frameProtection.allowedOrigins).toContain('https://app.exepad.com');
      expect(result.headers.frameProtection.allowedOrigins).toContain('https://custom.com');
    });

    it('should reject wildcard * in frame origins', () => {
      const result = resolveSecurityRules({
        headers: {
          frameProtection: {
            allowedOrigins: ['*', 'https://valid.com'],
          },
        },
      });
      expect(result.headers.frameProtection.allowedOrigins).not.toContain('*');
      expect(result.headers.frameProtection.allowedOrigins).toContain('https://valid.com');
    });
  });

  // --- Navigation ---
  describe('navigation overrides', () => {
    it('should additively merge redirect domains', () => {
      const result = resolveSecurityRules({
        navigation: {
          allowedRedirectDomains: ['custom.com'],
        },
      });
      expect(result.navigation.allowedRedirectDomains).toContain('exepad.com');
      expect(result.navigation.allowedRedirectDomains).toContain('custom.com');
    });

    it('should filter out empty domain strings', () => {
      const result = resolveSecurityRules({
        navigation: {
          allowedRedirectDomains: ['', 'valid.com', ''],
        },
      });
      expect(result.navigation.allowedRedirectDomains).not.toContain('');
      expect(result.navigation.allowedRedirectDomains).toContain('valid.com');
    });
  });

  // --- Expression limits ---
  describe('expression limit overrides', () => {
    it('should allow tightening maxExpressionLength', () => {
      const result = resolveSecurityRules({
        expression: { maxExpressionLength: 500 },
      });
      expect(result.expression.maxExpressionLength).toBe(500);
    });

    it('should not allow loosening maxExpressionLength', () => {
      const result = resolveSecurityRules({
        expression: { maxExpressionLength: 9999 },
      });
      expect(result.expression.maxExpressionLength).toBe(DEFAULT_SECURITY_RULES.expression.maxExpressionLength);
    });

    it('should allow tightening maxAstDepth', () => {
      const result = resolveSecurityRules({
        expression: { maxAstDepth: 10 },
      });
      expect(result.expression.maxAstDepth).toBe(10);
    });

    it('should not allow loosening maxAstDepth', () => {
      const result = resolveSecurityRules({
        expression: { maxAstDepth: 200 },
      });
      expect(result.expression.maxAstDepth).toBe(DEFAULT_SECURITY_RULES.expression.maxAstDepth);
    });

    it('should reject negative expression limits', () => {
      const result = resolveSecurityRules({
        expression: { maxExpressionLength: -1, maxAstDepth: -5 },
      });
      // Should keep defaults (negative values are not finite > 0)
      expect(result.expression.maxExpressionLength).toBe(DEFAULT_SECURITY_RULES.expression.maxExpressionLength);
      expect(result.expression.maxAstDepth).toBe(DEFAULT_SECURITY_RULES.expression.maxAstDepth);
    });

    it('should reject zero expression limits', () => {
      const result = resolveSecurityRules({
        expression: { maxExpressionLength: 0, maxAstDepth: 0 },
      });
      expect(result.expression.maxExpressionLength).toBe(DEFAULT_SECURITY_RULES.expression.maxExpressionLength);
      expect(result.expression.maxAstDepth).toBe(DEFAULT_SECURITY_RULES.expression.maxAstDepth);
    });

    it('should reject NaN expression limits', () => {
      const result = resolveSecurityRules({
        expression: { maxExpressionLength: NaN as any },
      });
      expect(result.expression.maxExpressionLength).toBe(DEFAULT_SECURITY_RULES.expression.maxExpressionLength);
    });
  });

  // --- Deduplication ---
  describe('deduplication', () => {
    it('should deduplicate frame protection origins', () => {
      const result = resolveSecurityRules({
        headers: {
          frameProtection: {
            allowedOrigins: ['https://app.exepad.com', 'https://custom.com', 'https://custom.com'],
          },
        },
      });
      const origins = result.headers.frameProtection.allowedOrigins;
      expect(origins.filter(o => o === 'https://app.exepad.com')).toHaveLength(1);
      expect(origins.filter(o => o === 'https://custom.com')).toHaveLength(1);
    });

    it('should deduplicate navigation redirect domains', () => {
      const result = resolveSecurityRules({
        navigation: {
          allowedRedirectDomains: ['exepad.com', 'custom.com', 'custom.com'],
        },
      });
      const domains = result.navigation.allowedRedirectDomains;
      expect(domains.filter(d => d === 'exepad.com')).toHaveLength(1);
      expect(domains.filter(d => d === 'custom.com')).toHaveLength(1);
    });
  });

  // --- Immutability ---
  it('should not mutate DEFAULT_SECURITY_RULES', () => {
    const originalScriptSrc = [...DEFAULT_SECURITY_RULES.headers.csp.directives['script-src']];
    resolveSecurityRules({
      headers: {
        csp: {
          directives: {
            'script-src': ['https://injected.cdn.com'],
          },
        },
      },
    });
    expect(DEFAULT_SECURITY_RULES.headers.csp.directives['script-src']).toEqual(originalScriptSrc);
  });
});

describe('buildSecurityHeaders', () => {
  it('should build CSP header in report-only mode', () => {
    const headers = buildSecurityHeaders(DEFAULT_SECURITY_RULES);
    expect(headers['Content-Security-Policy-Report-Only']).toBeDefined();
    expect(headers['Content-Security-Policy']).toBeUndefined();
  });

  it('should build CSP header in enforce mode', () => {
    const rules = structuredClone(DEFAULT_SECURITY_RULES);
    rules.headers.csp.reportOnly = false;
    const headers = buildSecurityHeaders(rules);
    expect(headers['Content-Security-Policy']).toBeDefined();
    expect(headers['Content-Security-Policy-Report-Only']).toBeUndefined();
  });

  it('should include all CSP directives', () => {
    const headers = buildSecurityHeaders(DEFAULT_SECURITY_RULES);
    const csp = headers['Content-Security-Policy-Report-Only'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('script-src');
    expect(csp).toContain('style-src');
    expect(csp).toContain('img-src');
    expect(csp).toContain('connect-src');
    expect(csp).toContain('frame-src');
    expect(csp).toContain("object-src 'none'");
  });

  it('should replace unsafe-inline with nonce in script-src', () => {
    const nonce = 'test-nonce-123';
    const headers = buildSecurityHeaders(DEFAULT_SECURITY_RULES, nonce);
    const csp = headers['Content-Security-Policy-Report-Only'];
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it('should keep unsafe-inline in style-src even with nonce', () => {
    const nonce = 'test-nonce-123';
    const headers = buildSecurityHeaders(DEFAULT_SECURITY_RULES, nonce);
    const csp = headers['Content-Security-Policy-Report-Only'];
    // style-src should still have unsafe-inline (needed for Tailwind)
    expect(csp).toMatch(/style-src[^;]*'unsafe-inline'/);
  });

  it('should set X-Frame-Options', () => {
    const headers = buildSecurityHeaders(DEFAULT_SECURITY_RULES);
    expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
  });

  it('should set X-Content-Type-Options', () => {
    const headers = buildSecurityHeaders(DEFAULT_SECURITY_RULES);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('should set Referrer-Policy', () => {
    const headers = buildSecurityHeaders(DEFAULT_SECURITY_RULES);
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('should set Permissions-Policy', () => {
    const headers = buildSecurityHeaders(DEFAULT_SECURITY_RULES);
    const pp = headers['Permissions-Policy'];
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('geolocation=()');
  });

  it('should not set headers when rules are disabled', () => {
    const rules = structuredClone(DEFAULT_SECURITY_RULES);
    rules.headers.csp.enabled = false;
    rules.headers.frameProtection.enabled = false;
    rules.headers.contentTypeOptions.enabled = false;
    rules.headers.referrerPolicy.enabled = false;
    rules.headers.permissionsPolicy.enabled = false;
    const headers = buildSecurityHeaders(rules);
    expect(Object.keys(headers)).toHaveLength(0);
  });

  it('should set X-Frame-Options to DENY when mode is deny', () => {
    const rules = structuredClone(DEFAULT_SECURITY_RULES);
    rules.headers.frameProtection.mode = 'deny';
    const headers = buildSecurityHeaders(rules);
    expect(headers['X-Frame-Options']).toBe('DENY');
  });
});
