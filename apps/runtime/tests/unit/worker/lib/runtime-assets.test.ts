/**
 * runtime-assets.ts — cache-control for the SPA's own static bundle.
 *
 * The boundary: CONTENT-HASHED files (Vite `name-<hash>.ext`) are immutable
 * (a content change yields a new name); FIXED-NAME bundles overwritten in
 * place on every rebuild (the `exepad-sdk*` SDK bundles) MUST revalidate, or a
 * browser that cached an old SDK never receives a fix.
 *
 * Regression guard (found live 2026-06-22): the hash regex's char class
 * includes `-`, so `exepad-sdk-core.js` read as `name=exepad`,
 * `hash=sdk-core` (8 chars) and got wrongly pinned `immutable` — the
 * SelectItem fix couldn't reach a warm cache. All 6 hyphenated SDK subpath
 * bundles were affected.
 */

import { describe, it, expect } from 'vitest';
import { cacheControlForRuntimeAsset } from '../../../../worker/src/lib/runtime-assets';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'public, max-age=3600, must-revalidate';

describe('cacheControlForRuntimeAsset', () => {
  it('pins genuinely content-hashed bundles immutable', () => {
    expect(cacheControlForRuntimeAsset('/assets/index-BX-LvDyr.js')).toBe(IMMUTABLE);
    expect(cacheControlForRuntimeAsset('/assets/ClientPageRenderer-BcrI_g5E.js')).toBe(IMMUTABLE);
    // Hashed icon chunk in the SDK dist dir.
    expect(cacheControlForRuntimeAsset('/runtime_assets/dist/a-arrow-down-D5DNCYrz.js')).toBe(IMMUTABLE);
  });

  it('revalidates fixed-name SDK bundles (the regression)', () => {
    for (const name of [
      'exepad-sdk.js',
      'exepad-sdk-core.js',
      'exepad-sdk-icons.js',
      'exepad-sdk-charts.js',
      'exepad-sdk-forms.js',
      'exepad-sdk-motion.js',
      'exepad-sdk-overlays.js',
    ]) {
      expect(cacheControlForRuntimeAsset(`/runtime_assets/dist/${name}`)).toBe(REVALIDATE);
    }
  });

  it('still pins a hashed chunk that merely SHARES the exepad-sdk prefix', () => {
    // Mixed-case/digit hash → not a lowercase-word segment → immutable.
    expect(cacheControlForRuntimeAsset('/runtime_assets/dist/exepad-sdk-core-BX-LvDyr.js')).toBe(IMMUTABLE);
  });

  it('revalidates other unhashed fixed-name assets', () => {
    expect(cacheControlForRuntimeAsset('/assets/style.css')).toBe(REVALIDATE);
  });

  it('returns null for non-runtime-static paths', () => {
    expect(cacheControlForRuntimeAsset('/a/some-app/repo/compiled/x.js')).toBeNull();
    expect(cacheControlForRuntimeAsset('/api/foo')).toBeNull();
  });
});
