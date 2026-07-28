/**
 * Resolve the Studio "editor" origin for cross-window `postMessage` between a
 * preview iframe and its parent.
 *
 * In the Cloudflare cloud, the editor (app.exepad.com) and the preview iframe
 * live on different origins, so the targetOrigin had to be hardcoded. In the
 * self-hosted single container everything is served same-origin (e.g.
 * `http://localhost:8080`, a LAN IP, or a custom domain behind a proxy), so the
 * old `'https://app.exepad.com'` fallback caused every postMessage to be
 * silently dropped (component-selection / page-change / code-failure signals).
 *
 * Resolution order: an explicit `VITE_EDITOR_ORIGIN` build override (cloud), then
 * the current window origin (self-host), then the cloud host as a last resort
 * for non-browser contexts.
 */
export function getEditorOrigin(): string {
  const configured = import.meta.env.VITE_EDITOR_ORIGIN;
  if (configured) return configured;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'https://app.exepad.com';
}
