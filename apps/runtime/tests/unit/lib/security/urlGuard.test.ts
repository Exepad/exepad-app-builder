/**
 * URL Security Guard Tests
 *
 * Tests for isDangerousScheme, isSafeNavigationUrl, isSafeIframeSrc, isSafeRedirectUrl.
 * Covers bypass vectors: URL encoding, control characters, case mixing, unicode tricks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isDangerousScheme,
  isSafeNavigationUrl,
  isSafeIframeSrc,
  isSafeRedirectUrl,
} from '@/lib/security/urlGuard';

describe('isDangerousScheme', () => {
  // --- Basic scheme detection ---
  it('should detect javascript: scheme', () => {
    expect(isDangerousScheme('javascript:alert(1)')).toBe(true);
  });

  it('should detect data: scheme', () => {
    expect(isDangerousScheme('data:text/html,<script>alert(1)</script>')).toBe(true);
  });

  it('should detect vbscript: scheme', () => {
    expect(isDangerousScheme('vbscript:MsgBox("XSS")')).toBe(true);
  });

  // --- Case insensitivity ---
  it('should detect mixed case javascript: scheme', () => {
    expect(isDangerousScheme('JavaScript:alert(1)')).toBe(true);
    expect(isDangerousScheme('JAVASCRIPT:alert(1)')).toBe(true);
    expect(isDangerousScheme('JaVaScRiPt:alert(1)')).toBe(true);
  });

  // --- Whitespace handling ---
  it('should detect schemes with leading/trailing whitespace', () => {
    expect(isDangerousScheme('  javascript:alert(1)  ')).toBe(true);
    expect(isDangerousScheme('\tjavascript:alert(1)')).toBe(true);
    expect(isDangerousScheme('\njavascript:alert(1)')).toBe(true);
  });

  // --- URL encoding bypass attempts ---
  it('should detect URL-encoded javascript: scheme', () => {
    // java%73cript: -> javascript:
    expect(isDangerousScheme('java%73cript:alert(1)')).toBe(true);
  });

  it('should detect fully URL-encoded javascript: scheme', () => {
    // %6a%61%76%61%73%63%72%69%70%74%3a -> javascript:
    expect(isDangerousScheme('%6a%61%76%61%73%63%72%69%70%74%3aalert(1)')).toBe(true);
  });

  it('should detect double URL-encoded javascript: scheme', () => {
    // %256a -> %6a -> j (after two rounds of decoding)
    expect(isDangerousScheme('%256aavascript:alert(1)')).toBe(true);
  });

  it('should detect URL-encoded data: scheme', () => {
    expect(isDangerousScheme('%64ata:text/html,test')).toBe(true);
  });

  // --- Control character injection ---
  it('should detect schemes with embedded null bytes', () => {
    expect(isDangerousScheme('java\x00script:alert(1)')).toBe(true);
  });

  it('should detect schemes with embedded tabs', () => {
    expect(isDangerousScheme('java\tscript:alert(1)')).toBe(true);
  });

  it('should detect schemes with embedded newlines', () => {
    expect(isDangerousScheme('java\nscript:alert(1)')).toBe(true);
    expect(isDangerousScheme('java\rscript:alert(1)')).toBe(true);
  });

  // --- Safe URLs ---
  it('should allow https: URLs', () => {
    expect(isDangerousScheme('https://example.com')).toBe(false);
  });

  it('should allow http: URLs', () => {
    expect(isDangerousScheme('http://example.com')).toBe(false);
  });

  it('should allow relative URLs', () => {
    expect(isDangerousScheme('/path/to/page')).toBe(false);
    expect(isDangerousScheme('#section')).toBe(false);
  });

  it('should allow empty string', () => {
    expect(isDangerousScheme('')).toBe(false);
  });
});

describe('isSafeNavigationUrl', () => {
  it('should block javascript: URLs', () => {
    expect(isSafeNavigationUrl('javascript:alert(1)')).toBe(false);
  });

  it('should block data: URLs', () => {
    expect(isSafeNavigationUrl('data:text/html,test')).toBe(false);
  });

  it('should allow normal URLs', () => {
    expect(isSafeNavigationUrl('https://example.com')).toBe(true);
    expect(isSafeNavigationUrl('/path')).toBe(true);
    expect(isSafeNavigationUrl('#hash')).toBe(true);
  });

  it('should block encoded javascript: URLs', () => {
    expect(isSafeNavigationUrl('java%73cript:void(0)')).toBe(false);
  });
});

describe('isSafeIframeSrc', () => {
  it('should block javascript: URLs', () => {
    expect(isSafeIframeSrc('javascript:alert(1)')).toBe(false);
  });

  it('should block data: URLs', () => {
    expect(isSafeIframeSrc('data:text/html,test')).toBe(false);
  });

  it('should block vbscript: URLs', () => {
    expect(isSafeIframeSrc('vbscript:test')).toBe(false);
  });

  it('should block blob: URLs', () => {
    expect(isSafeIframeSrc('blob:https://example.com/uuid')).toBe(false);
  });

  it('should allow https: URLs', () => {
    expect(isSafeIframeSrc('https://www.youtube.com/embed/abc')).toBe(true);
  });

  it('should block encoded dangerous schemes', () => {
    expect(isSafeIframeSrc('java%73cript:alert(1)')).toBe(false);
    expect(isSafeIframeSrc('%64ata:text/html,test')).toBe(false);
  });

  describe('protocol enforcement in production', () => {
    const originalWindow = globalThis.window;

    beforeEach(() => {
      // Simulate production (https)
      Object.defineProperty(globalThis, 'window', {
        value: { location: { protocol: 'https:', origin: 'https://example.com' } },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        writable: true,
        configurable: true,
      });
    });

    it('should block http: URLs in production', () => {
      expect(isSafeIframeSrc('http://example.com/embed')).toBe(false);
    });

    it('should allow https: URLs in production', () => {
      expect(isSafeIframeSrc('https://example.com/embed')).toBe(true);
    });
  });
});

describe('isSafeRedirectUrl', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: { location: { protocol: 'https:', origin: 'https://myapp.exepad.app' } },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      writable: true,
      configurable: true,
    });
  });

  it('should block dangerous schemes', () => {
    expect(isSafeRedirectUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeRedirectUrl('data:text/html,test')).toBe(false);
  });

  it('should allow relative URLs', () => {
    expect(isSafeRedirectUrl('/about')).toBe(true);
    expect(isSafeRedirectUrl('/products/123')).toBe(true);
  });

  it('should allow hash-only URLs', () => {
    expect(isSafeRedirectUrl('#section')).toBe(true);
  });

  it('should block protocol-relative URLs to untrusted domains', () => {
    expect(isSafeRedirectUrl('//evil.com/phishing')).toBe(false);
  });

  it('should allow same-origin absolute URLs', () => {
    expect(isSafeRedirectUrl('https://myapp.exepad.app/page')).toBe(true);
  });

  it('should block external domains not in allowlist', () => {
    expect(isSafeRedirectUrl('https://evil.com', ['exepad.com'])).toBe(false);
  });

  it('should allow domains in the allowlist', () => {
    expect(isSafeRedirectUrl('https://exepad.com/path', ['exepad.com'])).toBe(true);
  });

  it('should allow subdomains of allowlisted domains', () => {
    expect(isSafeRedirectUrl('https://app.exepad.com/path', ['exepad.com'])).toBe(true);
    expect(isSafeRedirectUrl('https://sub.exepad.app/path', ['exepad.app'])).toBe(true);
  });

  it('should treat plain text as relative (same-origin) URLs', () => {
    // 'not a valid url' is parsed as a relative path against window.location.origin
    // This is the browser's standard URL parsing behavior
    expect(isSafeRedirectUrl('not a valid url')).toBe(true);
  });

  it('should block URLs with unknown protocol schemes', () => {
    expect(isSafeRedirectUrl('ftp://evil.com/file')).toBe(false);
  });

  it('should block encoded dangerous schemes in redirects', () => {
    expect(isSafeRedirectUrl('java%73cript:void(0)')).toBe(false);
  });
});
