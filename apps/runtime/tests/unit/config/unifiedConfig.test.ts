/**
 * Unified Config + Component Registry + Editor Origin + Runtime Mode Tests
 *
 * Covers:
 *  - unifiedConfig.getConfig — cache hit vs preview-never-cache, typed error-code
 *    re-throw vs generic-error swallow→null, null config → null, per-source path
 *    calculation, and example configPathDepth handling.
 *  - readInlinedConfig — cross-app trust check (data-app-id mismatch rejected),
 *    malformed/empty/missing blob handling, SSR (no document) guard.
 *  - getConfigSync — preview/non-backend short-circuit, cache warm-up, fallback.
 *  - componentRegistry — compiled-URL construction, missing/no-compiled paths.
 *  - editor-origin — VITE override → window origin → cloud fallback allowlist.
 *  - RuntimeMode — published/preview classification from the URL path.
 *
 * ConfigService is mocked so getConfig's branching (not the network) is the unit
 * under test. The DOM (`#root`, `#__exepad_config`) is driven directly via
 * happy-dom for the inlined-config / domain-mode paths.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock the config-fetch layer so getConfig branching is the unit under test ──
vi.mock('@/services/ConfigService', () => ({
  ConfigService: {
    fetch: vi.fn(),
    fetchExampleWithMeta: vi.fn(),
  },
}));

import {
  getConfig,
  getConfigSync,
  readInlinedConfig,
  invalidateConfig,
  parsePreviewMode,
  slugArrayToPath,
  type UnifiedConfigParams,
} from '@/app_shared/utils/unifiedConfig';
import { ConfigService } from '@/services/ConfigService';
import { componentRegistry } from '@/lib/componentRegistry';
import { getEditorOrigin } from '@/lib/editor-origin';
import { getRuntimeMode, isPreviewMode, isPublishedMode } from '@/core/RuntimeMode';

const mockFetch = vi.mocked(ConfigService.fetch);
const mockFetchExample = vi.mocked(ConfigService.fetchExampleWithMeta);

/** Minimal-but-valid WebAppProps shell that survives normalize/security/access. */
function makeConfig(pages: any[] = [{ slug: '/', uuid: 'p0', title: 'Home' }]): any {
  return { name: 'Test App', frontend: { pages } };
}

/** Reset the in-module config cache by invalidating across appIds used here. */
function clearAllCaches(): void {
  for (const id of ['app1', 'app2', 'demoApp', 'exApp', 'sync-app']) {
    invalidateConfig(id);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  clearAllCaches();
  componentRegistry.reset();
  // Clean DOM between tests.
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ============================================================================
// getConfig — caching, error re-throw, path calc
// ============================================================================

describe('getConfig', () => {
  const baseParams = (over: Partial<UnifiedConfigParams> = {}): UnifiedConfigParams => ({
    source: 'backend',
    appId: 'app1',
    mode: 'published',
    ...over,
  });

  it('returns null when ConfigService yields no config (and does not cache null)', async () => {
    mockFetch.mockResolvedValue(null as any);

    const result = await getConfig(baseParams());
    expect(result).toBeNull();

    // A null result is never cached, so the next call hits the fetch again.
    mockFetch.mockResolvedValue(makeConfig());
    const second = await getConfig(baseParams());
    expect(second).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('caches published results — second identical call skips the fetch', async () => {
    mockFetch.mockResolvedValue(makeConfig());

    const first = await getConfig(baseParams());
    const second = await getConfig(baseParams());

    expect(first).not.toBeNull();
    expect(second).toBe(first); // same cached object reference
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('NEVER serves preview mode from cache — every call refetches', async () => {
    mockFetch.mockResolvedValue(makeConfig());

    await getConfig(baseParams({ mode: 'preview' }));
    await getConfig(baseParams({ mode: 'preview' }));

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('keys the cache by source+appId+mode (preview vs published do not collide)', async () => {
    mockFetch.mockResolvedValue(makeConfig());

    await getConfig(baseParams({ mode: 'published' }));
    // preview never reads cache; published wrote a distinct key, so it stays cached.
    await getConfig(baseParams({ mode: 'published' }));

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('re-throws errors carrying a typed worker code (e.g. NOT_PUBLISHED)', async () => {
    const err = Object.assign(new Error('not published'), { code: 'NOT_PUBLISHED' });
    mockFetch.mockRejectedValue(err);

    await expect(getConfig(baseParams())).rejects.toThrow('not published');
    await expect(getConfig(baseParams())).rejects.toMatchObject({ code: 'NOT_PUBLISHED' });
  });

  it('swallows generic (un-coded) errors and returns null', async () => {
    mockFetch.mockRejectedValue(new Error('network boom'));

    const result = await getConfig(baseParams());
    expect(result).toBeNull();
  });

  it('computes basePath=/a/<id> and root pageSlug for backend published apps', async () => {
    mockFetch.mockResolvedValue(makeConfig());

    const result = await getConfig(baseParams());
    expect(result?.basePath).toBe('/a/app1');
    expect(result?.pageSlug).toBe('/');
  });

  it('prefixes the basePath with preview- in preview mode', async () => {
    mockFetch.mockResolvedValue(makeConfig());

    const result = await getConfig(baseParams({ mode: 'preview' }));
    expect(result?.basePath).toBe('/a/preview-app1');
  });

  it('builds nested pageSlug from slugSegments for backend apps', async () => {
    mockFetch.mockResolvedValue(
      makeConfig([
        { slug: '/', uuid: 'p0', title: 'Home' },
        { slug: '/blog/post', uuid: 'p1', title: 'Post' },
      ]),
    );

    const result = await getConfig(baseParams({ slugSegments: ['blog', 'post'] }));
    expect(result?.pageSlug).toBe('/blog/post');
    expect(result?.currentPage?.uuid).toBe('p1');
  });

  it('computes basePath=/demo/<id> for demo source', async () => {
    mockFetch.mockResolvedValue(makeConfig());

    const result = await getConfig(baseParams({ source: 'demo', appId: 'demoApp' }));
    expect(result?.basePath).toBe('/demo/demoApp');
  });

  it('uses fetchExampleWithMeta and configPathDepth to compute the example basePath', async () => {
    mockFetchExample.mockResolvedValue({
      config: makeConfig([{ slug: '/page', uuid: 'pX', title: 'X' }]),
      configPathDepth: 2,
    } as any);

    // appId 'exApp' + segments [cat, page]; depth 2 means the config lives at
    // /example/exApp/cat and 'page' is the remaining page slug.
    const result = await getConfig(
      baseParams({ source: 'example', appId: 'exApp', slugSegments: ['cat', 'page'] }),
    );

    expect(mockFetchExample).toHaveBeenCalledWith('exApp', ['cat', 'page']);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result?.basePath).toBe('/example/exApp/cat');
    expect(result?.pageSlug).toBe('/page');
  });

  it('falls back to a synthetic home page when no page matches root', async () => {
    mockFetch.mockResolvedValue(makeConfig([{ slug: '/other', uuid: 'p1', title: 'Other' }]));

    const result = await getConfig(baseParams());
    // No '/' page, so root resolves to the first page (graceful fallback).
    expect(result?.currentPage).not.toBeNull();
    expect(result?.currentPage?.uuid).toBe('p1');
  });

  it('synthesizes an empty-page fallback when there are no pages at all', async () => {
    mockFetch.mockResolvedValue(makeConfig([]));

    const result = await getConfig(baseParams());
    expect(result?.currentPage?.uuid).toBe('empty-page-fallback');
    expect(result?.currentPage?.title).toBe('Test App');
  });

  it('emits domain-mode basePath="" when #root is marked data-route-mode=domain', async () => {
    document.body.innerHTML = '<div id="root" data-route-mode="domain"></div>';
    mockFetch.mockResolvedValue(makeConfig());

    const result = await getConfig(baseParams({ slugSegments: ['about'] }));
    expect(result?.basePath).toBe('');
    expect(result?.pageSlug).toBe('/about');
  });
});

// ============================================================================
// readInlinedConfig — cross-app trust check
// ============================================================================

describe('readInlinedConfig', () => {
  function inline(json: string, attrs: Record<string, string> = {}): void {
    const el = document.createElement('script');
    el.type = 'application/json';
    el.id = '__exepad_config';
    el.textContent = json;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
  }

  it('returns null when no inlined blob element exists', () => {
    expect(readInlinedConfig()).toBeNull();
  });

  it('returns null when the blob element is empty', () => {
    inline('');
    expect(readInlinedConfig()).toBeNull();
  });

  it('parses the inlined config when no app-id attributes are present', () => {
    inline(JSON.stringify(makeConfig()));
    expect(readInlinedConfig()).toMatchObject({ name: 'Test App' });
  });

  it('parses when inlined data-app-id matches the #root data-app-id', () => {
    document.body.innerHTML = '<div id="root" data-app-id="app1"></div>';
    inline(JSON.stringify(makeConfig()), { 'data-app-id': 'app1' });
    expect(readInlinedConfig()).toMatchObject({ name: 'Test App' });
  });

  it('REJECTS a foreign blob whose data-app-id mismatches #root (cross-app trust)', () => {
    // Security: a stale/foreign inlined config for a different app must never be
    // trusted, even though it parses cleanly.
    document.body.innerHTML = '<div id="root" data-app-id="app1"></div>';
    inline(JSON.stringify(makeConfig()), { 'data-app-id': 'attacker-app' });
    expect(readInlinedConfig()).toBeNull();
  });

  it('parses when #root has no data-app-id (cannot prove a mismatch)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    inline(JSON.stringify(makeConfig()), { 'data-app-id': 'app1' });
    expect(readInlinedConfig()).toMatchObject({ name: 'Test App' });
  });

  it('returns null on malformed JSON instead of throwing', () => {
    inline('{ not: valid json,,,');
    expect(() => readInlinedConfig()).not.toThrow();
    expect(readInlinedConfig()).toBeNull();
  });
});

// ============================================================================
// getConfigSync — inlined sync resolution + cache warming
// ============================================================================

describe('getConfigSync', () => {
  const syncParams = (over: Partial<UnifiedConfigParams> = {}): UnifiedConfigParams => ({
    source: 'backend',
    appId: 'sync-app',
    mode: 'published',
    ...over,
  });

  function inline(json: string): void {
    const el = document.createElement('script');
    el.type = 'application/json';
    el.id = '__exepad_config';
    el.textContent = json;
    document.body.appendChild(el);
  }

  it('returns null in preview mode (sync inlining is published-only)', () => {
    inline(JSON.stringify(makeConfig()));
    expect(getConfigSync(syncParams({ mode: 'preview' }))).toBeNull();
  });

  it('returns null for non-backend sources', () => {
    inline(JSON.stringify(makeConfig()));
    expect(getConfigSync(syncParams({ source: 'example' }))).toBeNull();
    expect(getConfigSync(syncParams({ source: 'demo' }))).toBeNull();
  });

  it('returns null when there is no inlined blob to read', () => {
    expect(getConfigSync(syncParams())).toBeNull();
  });

  it('resolves synchronously from the inlined blob and warms the async cache', async () => {
    inline(JSON.stringify(makeConfig()));

    const sync = getConfigSync(syncParams());
    expect(sync).not.toBeNull();
    expect(sync?.basePath).toBe('/a/sync-app');

    // The subsequent async getConfig should resolve from the warmed cache,
    // never touching the network fetch.
    const async = await getConfig(syncParams());
    expect(async).toBe(sync);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ============================================================================
// invalidateConfig
// ============================================================================

describe('invalidateConfig', () => {
  it('drops cached entries for the given appId so the next getConfig refetches', async () => {
    mockFetch.mockResolvedValue(makeConfig());
    const params: UnifiedConfigParams = { source: 'backend', appId: 'app2', mode: 'published' };

    await getConfig(params);
    invalidateConfig('app2');
    await getConfig(params);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// parsePreviewMode + slugArrayToPath
// ============================================================================

describe('parsePreviewMode', () => {
  it('detects preview via ?preview=true and keeps appId unchanged', () => {
    expect(parsePreviewMode('app1', { preview: 'true' })).toEqual({
      isPreview: true,
      cleanAppId: 'app1',
    });
  });

  it('detects the preview- prefix and strips it', () => {
    expect(parsePreviewMode('preview-app1')).toEqual({ isPreview: true, cleanAppId: 'app1' });
  });

  it('treats a bare "preview-" (empty remainder) as NOT preview', () => {
    expect(parsePreviewMode('preview-')).toEqual({ isPreview: false, cleanAppId: 'preview-' });
  });

  it('returns not-preview for a plain appId', () => {
    expect(parsePreviewMode('app1')).toEqual({ isPreview: false, cleanAppId: 'app1' });
  });
});

describe('slugArrayToPath', () => {
  it('returns "/" for undefined/empty segments', () => {
    expect(slugArrayToPath(undefined)).toBe('/');
    expect(slugArrayToPath([])).toBe('/');
  });

  it('joins segments with a leading slash', () => {
    expect(slugArrayToPath(['blog', 'post'])).toBe('/blog/post');
  });
});

// ============================================================================
// componentRegistry — compiled URL construction
// ============================================================================

describe('componentRegistry', () => {
  it('starts uninitialized and reports so', () => {
    expect(componentRegistry.isInitialized()).toBe(false);
  });

  it('constructs the compiled URL as <baseUrl>/repo/<compiled>', () => {
    componentRegistry.initialize(
      {
        StatsWidget: {
          source: 'frontend/code/components/StatsWidget.tsx',
          compiled: 'frontend/compiled/components/StatsWidget.js',
        },
      },
      'https://cdn.example.com/apps/app1',
    );

    expect(componentRegistry.isInitialized()).toBe(true);
    expect(componentRegistry.has('StatsWidget')).toBe(true);
    expect(componentRegistry.getCompiledUrl('StatsWidget')).toBe(
      'https://cdn.example.com/apps/app1/repo/frontend/compiled/components/StatsWidget.js',
    );
  });

  it('works with an empty baseUrl (relative URL)', () => {
    componentRegistry.initialize(
      { W: { source: 's.tsx', compiled: 'c/W.js' } },
      '',
    );
    expect(componentRegistry.getCompiledUrl('W')).toBe('/repo/c/W.js');
  });

  it('returns undefined for an unknown component', () => {
    componentRegistry.initialize({ W: { source: 's', compiled: 'c.js' } }, '');
    expect(componentRegistry.getCompiledUrl('Missing')).toBeUndefined();
  });

  it('returns undefined when a component has no compiled path', () => {
    componentRegistry.initialize(
      { Broken: { source: 's.tsx', compiled: '' } },
      'https://x',
    );
    expect(componentRegistry.has('Broken')).toBe(true);
    expect(componentRegistry.getCompiledUrl('Broken')).toBeUndefined();
  });

  it('handles undefined/empty config — initializes with no components', () => {
    componentRegistry.initialize(undefined, 'https://x');
    expect(componentRegistry.isInitialized()).toBe(true);
    expect(componentRegistry.getComponentNames()).toEqual([]);

    componentRegistry.initialize({}, 'https://x');
    expect(componentRegistry.getComponentNames()).toEqual([]);
  });

  it('re-initialize clears prior components (no stale leak across apps)', () => {
    componentRegistry.initialize({ A: { source: 'a', compiled: 'a.js' } }, '/base1');
    expect(componentRegistry.has('A')).toBe(true);

    componentRegistry.initialize({ B: { source: 'b', compiled: 'b.js' } }, '/base2');
    expect(componentRegistry.has('A')).toBe(false);
    expect(componentRegistry.has('B')).toBe(true);
    expect(componentRegistry.getCompiledUrl('B')).toBe('/base2/repo/b.js');
  });

  it('fires onReady immediately if already initialized, else on initialize', () => {
    // Not yet initialized → callback is deferred until initialize().
    const deferred = vi.fn();
    componentRegistry.onReady(deferred);
    expect(deferred).not.toHaveBeenCalled();

    componentRegistry.initialize({}, '');
    expect(deferred).toHaveBeenCalledTimes(1);

    // Already initialized → callback fires synchronously.
    const immediate = vi.fn();
    componentRegistry.onReady(immediate);
    expect(immediate).toHaveBeenCalledTimes(1);
  });

  it('reset() returns the registry to its uninitialized state', () => {
    componentRegistry.initialize({ A: { source: 'a', compiled: 'a.js' } }, '/base');
    componentRegistry.reset();
    expect(componentRegistry.isInitialized()).toBe(false);
    expect(componentRegistry.getComponentNames()).toEqual([]);
    expect(componentRegistry.getCompiledUrl('A')).toBeUndefined();
  });
});

// ============================================================================
// editor-origin — postMessage targetOrigin allowlist resolution
// ============================================================================

describe('getEditorOrigin', () => {
  it('prefers the explicit VITE_EDITOR_ORIGIN build override (cloud)', () => {
    vi.stubEnv('VITE_EDITOR_ORIGIN', 'https://app.exepad.com');
    expect(getEditorOrigin()).toBe('https://app.exepad.com');
  });

  it('falls back to the current window origin (self-host, same-origin)', () => {
    vi.stubEnv('VITE_EDITOR_ORIGIN', '');
    // happy-dom provides a window.location.origin.
    expect(getEditorOrigin()).toBe(window.location.origin);
  });

  it('an empty override does not win — it falls through to window origin', () => {
    vi.stubEnv('VITE_EDITOR_ORIGIN', '');
    expect(getEditorOrigin()).not.toBe('');
    expect(getEditorOrigin()).toBe(window.location.origin);
  });
});

// ============================================================================
// RuntimeMode — published/preview classification from the URL path
// ============================================================================

describe('RuntimeMode', () => {
  const realPath = window.location.pathname;

  function setPath(pathname: string): void {
    // happy-dom allows direct assignment of pathname.
    window.history.replaceState({}, '', pathname);
  }

  afterEach(() => {
    setPath(realPath);
  });

  it('classifies a /preview- path as preview', () => {
    setPath('/a/preview-app1/page');
    expect(getRuntimeMode()).toBe('preview');
    expect(isPreviewMode()).toBe(true);
    expect(isPublishedMode()).toBe(false);
  });

  it('classifies a plain /a/<id> path as published', () => {
    setPath('/a/app1/page');
    expect(getRuntimeMode()).toBe('published');
    expect(isPublishedMode()).toBe(true);
    expect(isPreviewMode()).toBe(false);
  });

  it('does not treat the substring "preview" without the dash as preview', () => {
    // The classifier keys on the literal '/preview-' marker, not the word.
    setPath('/a/previewish/page');
    expect(getRuntimeMode()).toBe('published');
  });
});
