/**
 * Dynamic Font Loader
 * Fetches and inlines font CSS with optimized loading strategy:
 * - Inlines @font-face CSS to eliminate render-blocking external requests
 * - Preloads critical font files (latin subset woff2) for instant availability
 * - Uses font-display: block to prevent Flash of Unstyled Text (FOUT)
 */

import { useState, useEffect } from 'react';
import { ThemeProps } from '@/interfaces/apps/core';
import { extractFontUrls, fetchFontCss, optimizeFontDisplay, extractFontFileUrls } from '@/utils/fontUtils';
import { sanitizeCss } from '@/lib/cssSanitizer';

interface DynamicFontLoaderProps {
  fonts?: ThemeProps['fonts'];
  extraFontUrls?: string[];
}

/**
 * Client-side font loader
 * Fetches font stylesheets on mount, optimizes font-display, and preloads font files.
 * Gracefully falls back to system fonts if fetching fails.
 */
const DynamicFontLoader = ({ fonts, extraFontUrls }: DynamicFontLoaderProps) => {
  const [fontData, setFontData] = useState<{ css: string; preloadUrls: string[] } | null>(null);

  const fontUrls = [
    ...extractFontUrls(fonts),
    ...(extraFontUrls?.filter(Boolean) ?? []),
  ];

  useEffect(() => {
    if (fontUrls.length === 0) return;

    let cancelled = false;

    Promise.all(fontUrls.map(url => fetchFontCss(url)))
      .then(fontCssArray => {
        if (cancelled) return;

        const rawCss = fontCssArray.filter(css => css).join('\n');
        if (!rawCss) return;

        // Remote font CSS is fetched from a config-specified (agent-injectable)
        // URL and injected into a live <style> via dangerouslySetInnerHTML.
        // Sanitize it first so a hostile/compromised font host cannot break out
        // of the <style> RAWTEXT context with `</style><img onerror=...>` etc.
        const optimizedCss = sanitizeCss(optimizeFontDisplay(rawCss));
        const fontFileUrls = extractFontFileUrls(rawCss);

        setFontData({ css: optimizedCss, preloadUrls: fontFileUrls });
      })
      .catch(() => {
        // Silent fallback — fonts couldn't be fetched, app will use system fonts
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontUrls.join(',')]);

  if (!fontData) return null;

  return (
    <>
      {/* Preload critical font files — browser starts downloading immediately */}
      {fontData.preloadUrls.map((url) => (
        <link
          key={url}
          rel="preload"
          as="font"
          type="font/woff2"
          href={url}
          crossOrigin="anonymous"
        />
      ))}
      {/* Inlined @font-face CSS with optimized font-display */}
      <style dangerouslySetInnerHTML={{ __html: fontData.css }} />
    </>
  );
};

export default DynamicFontLoader;
