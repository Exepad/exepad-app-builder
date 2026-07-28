
import React, { useEffect, useMemo } from 'react';
import { useAppConfig } from '@/context/AppConfigContext';

const STYLE_ID = 'exepad-codefocus-css';
const ROOT_VARS_ID = 'exepad-codefocus-root-vars';

/**
 * Strip build-time-only directives that must never be injected into the live
 * document. Tailwind v4 source CSS (theme.css) starts with bare-specifier
 * `@import "tailwindcss"` / `@import "tw-animate-css"` and `@source "..."` —
 * meant to be expanded by the compiler. `repo.frontend.styles` carries both the
 * raw theme.css and the compiled.css; when the raw one reaches this <style>
 * injector, the browser resolves those bare `@import`s against the page URL
 * (e.g. `/a/<id>/tailwindcss`), 404s to the SPA shell, and logs "Refused to
 * apply style" for the wrong MIME type. A correctly compiled sheet has none of
 * these, so this is a no-op there. URL/relative `@import`s are preserved.
 */
function stripBuildTimeCssDirectives(css: string): string {
  return css
    .replace(/^[ \t]*@source\b[^;]*;[ \t]*$\n?/gim, '')
    .replace(/^[ \t]*@import\s+["']([^"']+)["'][^;]*;[ \t]*$\n?/gim, (match, spec) =>
      /^(?:url\(|https?:|\.{0,2}\/)/i.test(String(spec).trim()) ? match : '',
    );
}

/**
 * CodeFocusCssLoader — Fetches compiled CSS from repo.frontend.styles once
 * at app init and injects it into the document <head> as a global <style> tag.
 *
 * With all components rendering in light DOM (no Shadow DOM), the compiled
 * Tailwind CSS is scoped via @layer exepad-app, so it can safely
 * live in the document head without colliding with host styles.
 */
export function CodeFocusCssLoader({ children }: { children: React.ReactNode }) {
  const { appConfig, basePath } = useAppConfig();

  const stylesKey = useMemo(() => {
    const styles = appConfig.repo?.frontend?.styles;
    if (!styles || typeof styles !== 'object') return '';
    return Object.values(styles)
      .map((s: any) => s?.compiled)
      .filter(Boolean)
      .join('|');
  }, [appConfig.repo?.frontend?.styles]);

  useEffect(() => {
    if (!stylesKey) return;

    // Fast path: the worker already inlined the compiled CSS render-blocking
    // as <style id="exepad-codefocus-css-ssr"> (public published apps), so the
    // page painted styled. Reuse that text to feed the SDK bridge + fire
    // `exepad:css-ready`, and skip the network fetch and re-inject entirely —
    // re-fetching would duplicate ~50KB and risk a reflow. The SSR element is
    // server-owned, so this path installs no cleanup that removes it.
    const ssrEl = document.getElementById('exepad-codefocus-css-ssr');
    const ssrCss = ssrEl?.textContent;
    if (ssrCss && ssrCss.trim().length > 0) {
      (window as any).__EXEPAD_CODEFOCUS_CSS__ = ssrCss;
      window.dispatchEvent(new CustomEvent('exepad:css-ready'));
      return;
    }

    const styles = appConfig.repo?.frontend?.styles;
    if (!styles) return;

    const urls = Object.values(styles)
      .map((s: any) => s?.compiled)
      .filter(Boolean)
      .map((compiled: string) => `${basePath}/repo/${compiled}`);

    if (urls.length === 0) return;

    let cancelled = false;

    Promise.all(
      urls.map((url: string) =>
        fetch(url)
          .then(r => {
            if (!r.ok) throw new Error(`CSS fetch failed: ${r.status} ${r.statusText} for ${url}`);
            return r.text();
          })
          .catch(err => {
            console.warn(`[CodeFocusCssLoader] Failed to fetch CSS: ${url}`, err);
            return '';
          })
      )
    )
      .then(sheets => {
        if (cancelled) return;
        const joined = sheets.map(stripBuildTimeCssDirectives).join('\n');

        // Inject the full compiled CSS into document <head>
        let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = STYLE_ID;
          document.head.appendChild(styleEl);
        }
        styleEl.textContent = joined;

        // Also publish to window global for SDK's useSyncExternalStore bridge
        (window as any).__EXEPAD_CODEFOCUS_CSS__ = joined;
        window.dispatchEvent(new CustomEvent('exepad:css-ready'));

        // Extract :root CSS variables and inject separately
        const rootMatch = joined.match(/:root\s*\{([^}]+)\}/);
        if (rootMatch) {
          let rootEl = document.getElementById(ROOT_VARS_ID) as HTMLStyleElement | null;
          if (!rootEl) {
            rootEl = document.createElement('style');
            rootEl.id = ROOT_VARS_ID;
            document.head.appendChild(rootEl);
          }
          rootEl.textContent = `:root { ${rootMatch[1]} }`;
        }
      })
      .catch(err => {
        console.error('[CodeFocusCssLoader] Failed to process CSS sheets:', err);
      });

    return () => {
      cancelled = true;
      const styleEl = document.getElementById(STYLE_ID);
      if (styleEl) styleEl.remove();
      const rootEl = document.getElementById(ROOT_VARS_ID);
      if (rootEl) rootEl.remove();
      delete (window as any).__EXEPAD_CODEFOCUS_CSS__;
    };
  }, [stylesKey, basePath]);

  return <>{children}</>;
}
