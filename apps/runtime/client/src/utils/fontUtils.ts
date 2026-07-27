/**
 * Font Loading Utilities
 * Shared utilities for consistent font loading across server and client components
 */

import { ThemeProps } from '@/interfaces/apps/core';

/** Sanitize a CSS value to prevent injection via font family names from LLM config. */
function sanitizeCssValue(value: string): string {
  return value.replace(/[<>{}\\;@]/g, '');
}

/**
 * Generate CSS custom properties for fonts
 * Works for both server and client components
 */
export function generateFontVariables(fonts?: ThemeProps['fonts']): string | null {
  if (!fonts) return null;

  const variables: string[] = [];

  if (fonts.body?.family) {
    variables.push(`--font-sans: ${sanitizeCssValue(fonts.body.family)};`);
  }

  if (fonts.heading?.family) {
    variables.push(`--font-heading: ${sanitizeCssValue(fonts.heading.family)};`);
  }

  if (variables.length === 0) return null;

  return `
    :root {
      ${variables.join('\n      ')}
    }
  `.trim();
}

/**
 * Extract font URLs from theme fonts configuration
 */
export function extractFontUrls(fonts?: ThemeProps['fonts']): string[] {
  if (!fonts) return [];

  const urls: string[] = [];

  if (fonts.body?.url) urls.push(fonts.body.url);
  if (fonts.heading?.url && fonts.heading.url !== fonts.body?.url) {
    urls.push(fonts.heading.url);
  }

  return urls;
}

/**
 * Fetch font CSS from URL
 * Includes timeout and graceful error handling
 * Silently fails and returns empty string to allow fallback to system fonts
 */
export async function fetchFontCss(url: string): Promise<string> {
  try {
    // Add timeout to prevent hanging indefinitely
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Mimic a browser user agent to get the correct font file format (woff2)
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Silently fail - return empty string to trigger fallback fonts
      return '';
    }

    return await response.text();
  } catch (error) {
    // Silently fail - font fetching is non-critical, app will use system fonts as fallback
    return '';
  }
}

/**
 * Optimize font-display in CSS to prevent FOUT (Flash of Unstyled Text)
 * Changes font-display: swap → font-display: block
 *
 * With 'block': browser renders text invisibly (reserving space) for up to 3s
 * while the font loads. Combined with preload hints, fonts arrive in <200ms,
 * so the invisible period is negligible and overlaps with page transition
 * animations. The result: text always appears with the correct font, never
 * flashing a fallback.
 *
 * Why not 'optional': too aggressive — only ~100ms window, causing random
 * fallback/custom font depending on load timing.
 * Why not 'swap': shows fallback font then visibly swaps — the original bug.
 */
export function optimizeFontDisplay(css: string): string {
  return css.replace(/font-display:\s*swap/g, 'font-display: block');
}

/**
 * Extract woff2 font file URLs from @font-face CSS for preloading
 * Only extracts the latin subset URLs to avoid over-fetching
 * Returns unique URLs for the most critical font files
 */
export function extractFontFileUrls(css: string): string[] {
  const urls: string[] = [];

  // Split CSS into @font-face blocks
  const fontFaceBlocks = css.split('@font-face');

  for (const block of fontFaceBlocks) {
    // Only preload latin subset (most commonly needed, avoids bloat)
    // Latin range typically includes: U+0000-00FF, U+0131, U+0152-0153, etc.
    const isLatinSubset = /unicode-range:.*U\+0000/.test(block);
    if (!isLatinSubset) continue;

    // Extract the woff2 URL from the src descriptor
    const urlMatch = block.match(/url\((https?:\/\/[^)]+\.woff2)\)/);
    if (urlMatch && urlMatch[1]) {
      urls.push(urlMatch[1]);
    }
  }

  // Return unique URLs
  return [...new Set(urls)];
}
