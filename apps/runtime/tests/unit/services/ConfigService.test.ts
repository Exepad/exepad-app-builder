/**
 * ConfigService Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigService } from '@/services/ConfigService';

// Mock import.meta.env
vi.stubEnv('VITE_BACKEND_URL', 'http://localhost:8000');

describe('ConfigService', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    await ConfigService.clearCache();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
    await ConfigService.clearCache();
  });

  describe('fetch', () => {
    it('should fetch published config directly from the runtime worker', async () => {
      const mockConfig = { uuid: 'test-app', name: 'Test App' };
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockConfig,
      } as any);

      globalThis.fetch = mockFetch as any;

      const config = await ConfigService.fetch('test-app', 'published');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith('/api/test-app/app-config', {});
      expect(mockFetch.mock.calls.some(([url]) => url === '/api/runtime/app-config/')).toBe(false);
      expect(config).toBeDefined();
      expect(config?.uuid).toBe('test-app');
      expect(config?.name).toBe('Test App');
    });

    it('should fetch preview config from the runtime worker with no-store caching', async () => {
      const mockConfig = { uuid: 'test-app', name: 'Preview App' };

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockConfig,
        } as any);

      const config = await ConfigService.fetch('test-app', 'preview');

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/preview-test-app/app-config', {
        cache: 'no-store',
      });
      expect(config).toBeDefined();
      expect(config?.uuid).toBe('test-app');
      expect(config?.name).toBe('Preview App');
    });

    it('should handle fetch failures with retries', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const config = await ConfigService.fetch('test-app', 'preview', { retries: 2 });

      expect(config).toBeNull();
    });
  });

  describe('extractComponents', () => {
    it('should extract all components from config', () => {
      const mockConfig = {
        frontend: {
          header: [{ uuid: 'header-1', componentType: 'CodeComponentProps' }],
          footer: [{ uuid: 'footer-1', componentType: 'CodeComponentProps' }],
          pages: [
            {
              content: [
                { uuid: 'page-1', componentType: 'CodeComponentProps' },
                { uuid: 'page-2', componentType: 'CodeComponentProps' },
              ],
            },
          ],
        },
      } as any;

      const components = ConfigService.extractComponents(mockConfig);

      expect(components.size).toBe(4);
      expect(components.has('header-1')).toBe(true);
      expect(components.has('footer-1')).toBe(true);
      expect(components.has('page-1')).toBe(true);
      expect(components.has('page-2')).toBe(true);
    });
  });

  describe('compareConfigs', () => {
    it('should detect changed components', () => {
      const oldConfig = {
        frontend: {
          pages: [
            {
              content: [
                { uuid: 'comp-1', componentType: 'CodeComponentProps', lastUpdatedEpoch: 100 },
                { uuid: 'comp-2', componentType: 'CodeComponentProps', lastUpdatedEpoch: 200 },
              ],
            },
          ],
        },
      } as any;

      const newConfig = {
        frontend: {
          pages: [
            {
              content: [
                { uuid: 'comp-1', componentType: 'CodeComponentProps', lastUpdatedEpoch: 150 },
                { uuid: 'comp-2', componentType: 'CodeComponentProps', lastUpdatedEpoch: 200 },
              ],
            },
          ],
        },
      } as any;

      const updates = ConfigService.compareConfigs(oldConfig, newConfig);

      expect(updates).toHaveLength(1);
      expect(updates[0].componentId).toBe('comp-1');
      expect(updates[0].lastUpdatedEpoch).toBe(150);
    });
  });

  // ── Fix 4: worker config 404 / 503 retry ─────────────────────────────────

  describe('fetchFromWorker retry on transient failures', () => {
    beforeEach(() => {
      // Patch setTimeout to resolve immediately so the exponential-backoff
      // loop runs in zero real time. Otherwise each test would wait ~1.75s.
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries a 404 until success, up to 3 attempts', async () => {
      const mockConfig = { uuid: 'warming-app', name: 'Warming' };
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404 } as any)
        .mockResolvedValueOnce({ ok: false, status: 404 } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockConfig,
        } as any);

      globalThis.fetch = mockFetch as any;

      const config = await ConfigService.fetch('warming-app', 'published');

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(config?.uuid).toBe('warming-app');
    });

    it('retries a 503 until success', async () => {
      const mockConfig = { uuid: 'cold-cache', name: 'Cold' };
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503 } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockConfig,
        } as any);

      globalThis.fetch = mockFetch as any;

      const config = await ConfigService.fetch('cold-cache', 'published');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(config?.uuid).toBe('cold-cache');
    });

    it('does NOT retry a 401 (genuine auth failure)', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue({ ok: false, status: 401 } as any);
      globalThis.fetch = mockFetch as any;

      // Suppress ConfigService.fetch's outer retry loop so we observe only
      // the inner fetchFromWorker behaviour.
      await ConfigService.fetch('no-auth', 'published', { retries: 1 });

      const workerCalls = mockFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('/app-config'),
      );
      // Exactly one call — no retry for non-retryable status codes.
      expect(workerCalls).toHaveLength(1);
    });

    it('gives up after 4 attempts (1 initial + 3 retries) on persistent 404', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue({ ok: false, status: 404 } as any);
      globalThis.fetch = mockFetch as any;

      await ConfigService.fetch('missing', 'published', { retries: 1 });

      const workerCalls = mockFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('/app-config'),
      );
      expect(workerCalls.length).toBe(4);
    });
  });

  // ── Fix 3.2: NOT_PUBLISHED short-circuit ─────────────────────────────────

  describe('fetchFromWorker NOT_PUBLISHED short-circuit', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('throws a typed NOT_PUBLISHED error immediately when the worker reports preview-only', async () => {
      // The worker emits `{error: "not_published", preview_available: true}`
      // for the published-mode URL when only a preview deploy exists. Retry
      // would never resolve, so the SPA must surface it on the first hit.
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        clone() {
          return {
            json: async () => ({ error: 'not_published', preview_available: true }),
          };
        },
      } as any);
      globalThis.fetch = mockFetch as any;

      await expect(
        ConfigService.fetch('preview-only-app', 'published', { retries: 1 }),
      ).rejects.toMatchObject({ code: 'NOT_PUBLISHED' });

      // Exactly ONE fetch — no retry, no exponential backoff burned.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('still retries plain 404s (body has no not_published code)', async () => {
      // Body is the generic `{error: "Config not found"}` shape — should
      // retry like before. Confirms the NOT_PUBLISHED detection doesn't
      // catch every 404.
      const mockResp = {
        ok: false,
        status: 404,
        clone() {
          return { json: async () => ({ error: 'Config not found' }) };
        },
      };
      const mockFetch = vi.fn().mockResolvedValue(mockResp as any);
      globalThis.fetch = mockFetch as any;

      await ConfigService.fetch('still-warming', 'published', { retries: 1 });

      const workerCalls = mockFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('/app-config'),
      );
      // 4 attempts (1 + 3 retries) — same as plain-404 behaviour.
      expect(workerCalls.length).toBe(4);
    });

    it('falls through to retry when the 404 body is not JSON', async () => {
      // Body unreadable / not JSON — must not raise NOT_PUBLISHED and
      // must continue with the regular retry path.
      const mockResp = {
        ok: false,
        status: 404,
        clone() {
          return {
            json: async () => {
              throw new SyntaxError('not json');
            },
          };
        },
      };
      const mockFetch = vi.fn().mockResolvedValue(mockResp as any);
      globalThis.fetch = mockFetch as any;

      await ConfigService.fetch('html-404', 'published', { retries: 1 });

      const workerCalls = mockFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('/app-config'),
      );
      expect(workerCalls.length).toBe(4);
    });
  });

  // ── Item 3 (2026-05-19): DEPLOY_FAILED short-circuit ────────────────────
  // The gateway emits `503 { error: { code: 'DEPLOY_FAILED', retryable: false } }`
  // when `deployment-status-preview.json::status === "failed"`. Retrying
  // won't help — surface the typed error immediately so AppLayout can
  // render a real "build failed" card instead of spinning. 1ybz1p4n
  // (2026-05-19) was the canonical case.

  describe('fetchFromWorker DEPLOY_FAILED short-circuit', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('throws a typed DEPLOY_FAILED error immediately on 503 + code=DEPLOY_FAILED', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 503,
        clone() {
          return {
            json: async () => ({
              success: false,
              error: {
                code: 'DEPLOY_FAILED',
                message: "Preview build for 'broken-app' failed at step 'provision'.",
                retryable: false,
                underlyingError: 'Handler not found in R2: …updateLibrarySettings.js',
                step: 'provision',
              },
            }),
          };
        },
      } as any);
      globalThis.fetch = mockFetch as any;

      await expect(
        ConfigService.fetch('broken-app', 'preview', { retries: 1 }),
      ).rejects.toMatchObject({
        code: 'DEPLOY_FAILED',
        message: 'Handler not found in R2: …updateLibrarySettings.js',
        step: 'provision',
      });

      // Exactly ONE fetch — no retry, no exponential backoff burned.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('still retries plain 503s (body has no DEPLOY_FAILED code)', async () => {
      // Body is the existing DEPLOY_IN_PROGRESS shape — should retry
      // like before. Confirms the DEPLOY_FAILED detection doesn't catch
      // every 503.
      const mockResp = {
        ok: false,
        status: 503,
        clone() {
          return {
            json: async () => ({
              success: false,
              error: {
                code: 'DEPLOY_IN_PROGRESS',
                message: "Preview for 'app' is not ready yet.",
                retryable: true,
              },
            }),
          };
        },
      };
      const mockFetch = vi.fn().mockResolvedValue(mockResp as any);
      globalThis.fetch = mockFetch as any;

      await ConfigService.fetch('still-deploying', 'preview', { retries: 1 });

      const workerCalls = mockFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('/app-config'),
      );
      // Multiple attempts — DEPLOY_FAILED detection didn't short-circuit
      // a DEPLOY_IN_PROGRESS 503.
      expect(workerCalls.length).toBeGreaterThan(1);
    });

    it('falls through to retry when the 503 body is not JSON', async () => {
      const mockResp = {
        ok: false,
        status: 503,
        clone() {
          return {
            json: async () => {
              throw new SyntaxError('not json');
            },
          };
        },
      };
      const mockFetch = vi.fn().mockResolvedValue(mockResp as any);
      globalThis.fetch = mockFetch as any;

      await ConfigService.fetch('html-503', 'preview', { retries: 1 });

      const workerCalls = mockFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('/app-config'),
      );
      // Falls through to normal retry path, NOT a short-circuit.
      expect(workerCalls.length).toBeGreaterThan(1);
    });
  });
});
