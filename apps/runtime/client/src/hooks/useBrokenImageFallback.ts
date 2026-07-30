import { useEffect } from 'react';

/**
 * Global broken-image safety net for rendered apps.
 *
 * Companion to the build-time "keep working image URLs when no stock-image
 * provider is configured" behavior: a kept hotlink that later 404s would
 * otherwise show the browser's broken-image glyph. This swaps any failed
 * content `<img>` to a neutral inline placeholder so the layout degrades
 * gracefully instead.
 *
 * - `<img>` `error` events do not bubble, so we listen in the CAPTURE phase.
 * - Idempotent + loop-safe: the placeholder is a `data:` URI, so once
 *   swapped the element never re-errors. An `<img data-no-fallback>` opts out.
 *
 * `ExepadImage` (the SDK component) handles its own failures in React via
 * `onError`; this covers raw `<img>` tags in generated component code.
 */

// Neutral light-surface placeholder with a subtle image glyph.
const FALLBACK_SVG =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='400'%20height='300'%3E%3Crect%20width='400'%20height='300'%20fill='%23eceff1'/%3E%3Cg%20fill='none'%20stroke='%2390a4ae'%20stroke-width='2'%3E%3Crect%20x='150'%20y='108'%20width='100'%20height='84'%20rx='6'/%3E%3Ccircle%20cx='176'%20cy='138'%20r='10'/%3E%3Cpath%20d='M156%20186l28-28%2024%2024%2018-18%2026%2026'/%3E%3C/g%3E%3C/svg%3E";

export function useBrokenImageFallback(): void {
  useEffect(() => {
    function onError(e: Event): void {
      const target = e.target as HTMLElement | null;
      if (!target || target.tagName !== 'IMG') return;
      const img = target as HTMLImageElement;
      // Opt-out hook + loop guard (the fallback is itself a data: URI).
      if (img.dataset.noFallback !== undefined) return;
      if (img.src.startsWith('data:')) return;
      img.src = FALLBACK_SVG;
    }
    document.addEventListener('error', onError, true);
    return () => document.removeEventListener('error', onError, true);
  }, []);
}
