/**
 * Extension Loader
 *
 * JS mappings are included in the static import map (see layout.tsx).
 * This module handles dynamic CSS loading for extensions that require
 * external stylesheets (e.g., AG Grid, Leaflet, xterm).
 */

import { resolveExtensionCssUrls } from './extensionRegistry';

/** Track which CSS URLs have already been injected to avoid duplicates. */
const loadedCssUrls = new Set<string>();

/**
 * Inject a CSS stylesheet link into <head> if not already present.
 */
function injectCssLink(url: string): void {
  if (loadedCssUrls.has(url)) return;
  if (typeof document === 'undefined') return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.dataset.exepadExt = 'true';
  document.head.appendChild(link);
  loadedCssUrls.add(url);
}

/**
 * Load CSS stylesheets for the given extensions.
 * JS resolution is handled by the static import map in layout.tsx.
 */
export function loadExtensionsIntoImportMap(extensionIds: string[]): void {
  for (const id of extensionIds) {
    const cssUrls = resolveExtensionCssUrls(id);
    for (const url of cssUrls) {
      injectCssLink(url);
    }
  }
}

/**
 * No-op: extensions are resolved via the static import map in layout.tsx.
 * Kept for API compatibility.
 */
export function preloadAppExtensions(_appConfig: Record<string, unknown>): void {
  // Static import map already contains all @exepad/ext-* mappings
}
