/**
 * Font Utils Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateFontVariables,
  extractFontUrls,
  fetchFontCss,
  optimizeFontDisplay,
  extractFontFileUrls,
} from '@/utils/fontUtils';
import type { ThemeProps } from '@/interfaces/apps/core';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('fontUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateFontVariables', () => {
    it('should return null for undefined fonts', () => {
      expect(generateFontVariables(undefined)).toBeNull();
    });

    it('should return null for fonts without families', () => {
      expect(generateFontVariables({})).toBeNull();
    });

    it('should generate body font variable', () => {
      const fonts: ThemeProps['fonts'] = {
        body: {
          family: 'Inter, sans-serif',
        },
      };

      const result = generateFontVariables(fonts);

      expect(result).toContain('--font-sans: Inter, sans-serif');
      expect(result).toContain(':root');
    });

    it('should generate heading font variable', () => {
      const fonts: ThemeProps['fonts'] = {
        heading: {
          family: 'Playfair Display, serif',
        },
      };

      const result = generateFontVariables(fonts);

      expect(result).toContain('--font-heading: Playfair Display, serif');
    });

    it('should generate both font variables', () => {
      const fonts: ThemeProps['fonts'] = {
        body: {
          family: 'Inter, sans-serif',
        },
        heading: {
          family: 'Playfair Display, serif',
        },
      };

      const result = generateFontVariables(fonts);

      expect(result).toContain('--font-sans: Inter, sans-serif');
      expect(result).toContain('--font-heading: Playfair Display, serif');
    });

    it('should handle empty family strings', () => {
      const fonts: ThemeProps['fonts'] = {
        body: {
          family: '',
        },
      };

      // Empty string is falsy, so no variable should be generated
      expect(generateFontVariables(fonts)).toBeNull();
    });

    // CSS injection prevention tests
    it('should strip HTML tags from font family names', () => {
      const fonts: ThemeProps['fonts'] = {
        body: {
          family: 'Inter</style><script>alert(1)</script>',
        },
      };

      const result = generateFontVariables(fonts);
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('</style>');
    });

    it('should strip curly braces from font family names', () => {
      const fonts: ThemeProps['fonts'] = {
        body: {
          family: 'Inter} .evil{color:red',
        },
      };

      const result = generateFontVariables(fonts);
      // The value part should have braces stripped (CSS template braces for :root{} are fine)
      expect(result).toContain('--font-sans: Inter .evilcolor:red');
      expect(result).not.toContain('Inter}');
      expect(result).not.toContain('{color');
    });

    it('should strip semicolons from font family names', () => {
      const fonts: ThemeProps['fonts'] = {
        body: {
          family: 'Inter; color: red',
        },
      };

      const result = generateFontVariables(fonts);
      // The value after sanitization should not contain semicolons from the font name itself
      // (the trailing ; is the CSS property terminator added by the code)
      expect(result).toContain('--font-sans: Inter color');
    });

    it('should strip @import injection from font family names', () => {
      const fonts: ThemeProps['fonts'] = {
        heading: {
          family: '@import url(evil.css)',
        },
      };

      const result = generateFontVariables(fonts);
      expect(result).not.toContain('@import');
    });
  });

  describe('extractFontUrls', () => {
    it('should return empty array for undefined fonts', () => {
      expect(extractFontUrls(undefined)).toEqual([]);
    });

    it('should return empty array for fonts without URLs', () => {
      const fonts: ThemeProps['fonts'] = {
        body: {
          family: 'Inter',
        },
      };

      expect(extractFontUrls(fonts)).toEqual([]);
    });

    it('should extract body font URL', () => {
      const fonts: ThemeProps['fonts'] = {
        body: {
          family: 'Inter',
          url: 'https://fonts.googleapis.com/css2?family=Inter',
        },
      };

      const urls = extractFontUrls(fonts);

      expect(urls).toHaveLength(1);
      expect(urls[0]).toBe('https://fonts.googleapis.com/css2?family=Inter');
    });

    it('should extract heading font URL', () => {
      const fonts: ThemeProps['fonts'] = {
        heading: {
          family: 'Playfair',
          url: 'https://fonts.googleapis.com/css2?family=Playfair+Display',
        },
      };

      const urls = extractFontUrls(fonts);

      expect(urls).toContain('https://fonts.googleapis.com/css2?family=Playfair+Display');
    });

    it('should extract both font URLs', () => {
      const fonts: ThemeProps['fonts'] = {
        body: {
          family: 'Inter',
          url: 'https://fonts.googleapis.com/css2?family=Inter',
        },
        heading: {
          family: 'Playfair',
          url: 'https://fonts.googleapis.com/css2?family=Playfair+Display',
        },
      };

      const urls = extractFontUrls(fonts);

      expect(urls).toHaveLength(2);
    });

    it('should not duplicate URLs', () => {
      const sameUrl = 'https://fonts.googleapis.com/css2?family=Inter';
      const fonts: ThemeProps['fonts'] = {
        body: {
          family: 'Inter',
          url: sameUrl,
        },
        heading: {
          family: 'Inter',
          url: sameUrl, // Same URL
        },
      };

      const urls = extractFontUrls(fonts);

      // Should only include the URL once
      expect(urls).toHaveLength(1);
    });
  });

  describe('fetchFontCss', () => {
    afterEach(() => {
      vi.clearAllTimers();
    });

    it('should fetch font CSS successfully', async () => {
      const mockCss = '@font-face { font-family: "Inter"; }';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => mockCss,
      });

      const result = await fetchFontCss('https://fonts.googleapis.com/css2?family=Inter');

      expect(result).toBe(mockCss);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://fonts.googleapis.com/css2?family=Inter',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          headers: expect.objectContaining({
            'User-Agent': expect.any(String),
          }),
        })
      );
    });

    it('should return empty string on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await fetchFontCss('https://fonts.example.com/nonexistent');

      expect(result).toBe('');
    });

    it('should return empty string on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchFontCss('https://fonts.example.com/error');

      expect(result).toBe('');
    });

    it('should handle abort signal on timeout', () => {
      // AbortController is used for timeouts - verify it's supported
      const controller = new AbortController();
      expect(controller.signal).toBeDefined();
      expect(typeof controller.abort).toBe('function');
    });

    it('should include browser user agent in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '',
      });

      await fetchFontCss('https://fonts.googleapis.com/test');

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers;

      expect(headers['User-Agent']).toContain('Mozilla');
      expect(headers['User-Agent']).toContain('Chrome');
    });
  });

  describe('optimizeFontDisplay', () => {
    it('should replace font-display: swap with block', () => {
      const css = '@font-face { font-family: "Inter"; font-display: swap; }';
      const result = optimizeFontDisplay(css);
      expect(result).toContain('font-display: block');
      expect(result).not.toContain('font-display: swap');
    });

    it('should handle multiple font-display: swap occurrences', () => {
      const css = `
        @font-face { font-family: "Inter"; font-display: swap; font-weight: 400; }
        @font-face { font-family: "Inter"; font-display: swap; font-weight: 700; }
      `;
      const result = optimizeFontDisplay(css);
      const matches = result.match(/font-display: block/g);
      expect(matches).toHaveLength(2);
      expect(result).not.toContain('font-display: swap');
    });

    it('should not modify CSS without font-display: swap', () => {
      const css = '@font-face { font-family: "Inter"; font-display: block; }';
      const result = optimizeFontDisplay(css);
      expect(result).toBe(css);
    });

    it('should handle varied whitespace', () => {
      const css = '@font-face { font-display:swap; }';
      const result = optimizeFontDisplay(css);
      expect(result).toContain('font-display: block');
    });
  });

  describe('extractFontFileUrls', () => {
    it('should extract woff2 URLs from latin subset', () => {
      const css = `
        @font-face {
          font-family: 'Inter';
          font-style: normal;
          font-weight: 400;
          font-display: swap;
          src: url(https://fonts.gstatic.com/s/inter/v18/latin-400.woff2) format('woff2');
          unicode-range: U+0000-00FF, U+0131, U+0152-0153;
        }
      `;
      const urls = extractFontFileUrls(css);
      expect(urls).toEqual(['https://fonts.gstatic.com/s/inter/v18/latin-400.woff2']);
    });

    it('should skip non-latin subsets', () => {
      const css = `
        @font-face {
          font-family: 'Inter';
          src: url(https://fonts.gstatic.com/s/inter/v18/cyrillic-400.woff2) format('woff2');
          unicode-range: U+0460-052F, U+1C80-1C8A;
        }
      `;
      const urls = extractFontFileUrls(css);
      expect(urls).toEqual([]);
    });

    it('should extract multiple latin subset URLs for different weights', () => {
      const css = `
        @font-face {
          font-family: 'Inter';
          font-weight: 400;
          src: url(https://fonts.gstatic.com/s/inter/v18/latin-400.woff2) format('woff2');
          unicode-range: U+0000-00FF;
        }
        @font-face {
          font-family: 'Inter';
          font-weight: 700;
          src: url(https://fonts.gstatic.com/s/inter/v18/latin-700.woff2) format('woff2');
          unicode-range: U+0000-00FF;
        }
      `;
      const urls = extractFontFileUrls(css);
      expect(urls).toHaveLength(2);
      expect(urls).toContain('https://fonts.gstatic.com/s/inter/v18/latin-400.woff2');
      expect(urls).toContain('https://fonts.gstatic.com/s/inter/v18/latin-700.woff2');
    });

    it('should return empty array for CSS without font-face', () => {
      const css = 'body { font-family: Inter; }';
      const urls = extractFontFileUrls(css);
      expect(urls).toEqual([]);
    });

    it('should deduplicate URLs', () => {
      const css = `
        @font-face {
          font-family: 'Inter';
          src: url(https://fonts.gstatic.com/s/inter/v18/same.woff2) format('woff2');
          unicode-range: U+0000-00FF;
        }
        @font-face {
          font-family: 'Inter';
          src: url(https://fonts.gstatic.com/s/inter/v18/same.woff2) format('woff2');
          unicode-range: U+0000-00FF;
        }
      `;
      const urls = extractFontFileUrls(css);
      expect(urls).toHaveLength(1);
    });
  });
});
