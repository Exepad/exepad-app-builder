/**
 * AdminApi client tests — mode scoping + encoding.
 *
 * Verifies that the per-app admin API client:
 *  - scopes every call to the correct database via `?mode=preview|published`
 *    (a destructive op MUST target the DB the caller asked for),
 *  - encodeURIComponent-escapes app/table/row/user/file path segments so a
 *    malicious id cannot break out of the intended route,
 *  - computes `ok` as `res.ok && Boolean(data.success)` (an HTTP 200 with
 *    `success:false` is NOT a success), and
 *  - returns safe empty/default shapes (empty arrays, zeroed pagination) when
 *    the request fails or the body is malformed.
 *
 * fetch is stubbed; no network is touched.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as AdminApi from '@/services/AdminApi';

/** Build a Response-like stub for the client's `await res.json()` path. */
function jsonResponse(body: unknown, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

/** A response whose body is not valid JSON (json() throws). */
function nonJsonResponse({ ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
    text: async () => 'not json',
  } as unknown as Response;
}

describe('AdminApi', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  /** URL of the Nth (default last) fetch call. */
  function calledUrl(idx = -1): string {
    const calls = mockFetch.mock.calls;
    const call = idx < 0 ? calls[calls.length + idx] : calls[idx];
    return String(call[0]);
  }
  function calledInit(idx = -1): RequestInit {
    const calls = mockFetch.mock.calls;
    const call = idx < 0 ? calls[calls.length + idx] : calls[idx];
    return (call[1] ?? {}) as RequestInit;
  }

  // ─── mode scoping ──────────────────────────────────────────────────────────

  describe('mode scoping (preview vs published)', () => {
    it('targets the preview DB when mode=preview', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: [] }));
      await AdminApi.listTables('app1', 'preview');
      const url = new URL(calledUrl(), 'http://x');
      expect(url.searchParams.get('mode')).toBe('preview');
    });

    it('targets the published DB when mode=published', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: [] }));
      await AdminApi.listTables('app1', 'published');
      const url = new URL(calledUrl(), 'http://x');
      expect(url.searchParams.get('mode')).toBe('published');
    });

    it('a destructive delete on published data targets the PUBLISHED db, not preview', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));
      await AdminApi.deleteRow('app1', 'orders', 'published', 42);
      const url = calledUrl();
      // Critical: deleting a published row must not silently hit the preview DB.
      expect(url).toContain('mode=published');
      expect(url).not.toContain('mode=preview');
      expect(calledInit().method).toBe('DELETE');
    });

    it('a destructive delete on preview data targets the PREVIEW db, not published', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));
      await AdminApi.deleteUser('app1', 'preview', 'u-9');
      const url = calledUrl();
      expect(url).toContain('mode=preview');
      expect(url).not.toContain('mode=published');
      expect(calledInit().method).toBe('DELETE');
    });

    it('carries the mode through write ops (insert/update/save)', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ success: true }))
        .mockResolvedValueOnce(jsonResponse({ success: true }))
        .mockResolvedValueOnce(jsonResponse({ success: true }));

      await AdminApi.insertRow('app1', 't', 'published', { a: 1 });
      expect(calledUrl()).toContain('mode=published');

      await AdminApi.updateRow('app1', 't', 'preview', 5, { a: 2 });
      expect(calledUrl()).toContain('mode=preview');

      await AdminApi.saveSecurity('app1', 'published', { enabled: true });
      expect(calledUrl()).toContain('mode=published');
    });

    it('builds the download URL with the requested mode (no fetch, pure string)', () => {
      const u = AdminApi.fileDownloadUrl('app1', 'file-7', 'published');
      expect(u).toBe('/api/admin/app1/files/file-7/download?mode=published');
    });

    it('mode is always present even when extra pagination params are appended', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: [] }));
      await AdminApi.listRows('app1', 't', 'preview', { page: 3, pageSize: 50, search: 'x' });
      const url = new URL(calledUrl(), 'http://x');
      expect(url.searchParams.get('mode')).toBe('preview');
      expect(url.searchParams.get('page')).toBe('3');
      expect(url.searchParams.get('pageSize')).toBe('50');
      expect(url.searchParams.get('search')).toBe('x');
    });

    it('omits empty-string and undefined extra params but keeps mode', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: [] }));
      await AdminApi.listRows('app1', 't', 'published', { search: '', page: undefined });
      const url = new URL(calledUrl(), 'http://x');
      expect(url.searchParams.get('mode')).toBe('published');
      expect(url.searchParams.has('search')).toBe(false);
      expect(url.searchParams.has('page')).toBe(false);
    });

    it('does not append a mode query to the non-mode-scoped source routes', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: { files: [], appName: 'app' } }));
      await AdminApi.listSource('app1');
      expect(calledUrl()).toBe('/api/admin/app1/source');
      expect(calledUrl()).not.toContain('mode=');
    });
  });

  // ─── credentials ────────────────────────────────────────────────────────────

  describe('auth / credentials', () => {
    it('sends cookies via credentials:include on every call', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: [] }));
      await AdminApi.listTables('app1', 'preview');
      expect(calledInit().credentials).toBe('include');
    });

    it('does not embed any deploy secret in the URL or headers', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));
      await AdminApi.deleteRow('app1', 't', 'published', 1);
      expect(calledUrl().toLowerCase()).not.toContain('secret');
      const headers = (calledInit().headers ?? {}) as Record<string, string>;
      expect(Object.keys(headers).join(' ').toLowerCase()).not.toContain('secret');
    });

    it('preserves credentials:include even when the call sets a JSON body/method', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));
      await AdminApi.insertRow('app1', 't', 'preview', { a: 1 });
      const init = calledInit();
      expect(init.credentials).toBe('include');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });
  });

  // ─── encodeURIComponent on path segments ─────────────────────────────────────

  describe('path-segment encoding', () => {
    it('encodes the appId in the base path', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: [] }));
      await AdminApi.listTables('app/../secret', 'preview');
      // The slash that would escape the /api/admin/<id> segment must be encoded.
      expect(calledUrl()).toContain('/api/admin/app%2F..%2Fsecret/');
      expect(calledUrl()).not.toContain('/api/admin/app/../secret/');
    });

    it('encodes the table name segment', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));
      await AdminApi.insertRow('app1', 'we ird/t', 'preview', {});
      expect(calledUrl()).toContain('/tables/we%20ird%2Ft/rows');
    });

    it('encodes a numeric and a string rowId segment', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ success: true }))
        .mockResolvedValueOnce(jsonResponse({ success: true }));

      await AdminApi.deleteRow('app1', 't', 'preview', 'a b/c');
      expect(calledUrl()).toContain('/rows/a%20b%2Fc?');

      await AdminApi.updateRow('app1', 't', 'preview', 100, {});
      expect(calledUrl()).toContain('/rows/100?');
    });

    it('encodes the userId in user routes', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));
      await AdminApi.resetPassword('app1', 'preview', 'id with#hash', 'pw');
      expect(calledUrl()).toContain('/users/id%20with%23hash/reset-password');
    });

    it('encodes the fileId in the (pure-string) download URL', () => {
      const u = AdminApi.fileDownloadUrl('app1', 'a/b c', 'preview');
      expect(u).toContain('/files/a%2Fb%20c/download');
    });

    it('encodes the source-file path as a query param, not a path segment', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse('contents'));
      await AdminApi.getSourceFile('app1', '../../etc/passwd');
      expect(calledUrl()).toBe('/api/admin/app1/source/file?path=..%2F..%2Fetc%2Fpasswd');
    });
  });

  // ─── ok = res.ok && Boolean(data.success) ────────────────────────────────────

  describe('ok = res.ok && Boolean(data.success)', () => {
    it('is false when HTTP 200 but success:false', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: false, error: 'nope' }, { ok: true, status: 200 }));
      const r = await AdminApi.deleteRow('app1', 't', 'published', 1);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('nope');
    });

    it('is false when success is missing entirely', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: 'whatever' }, { ok: true, status: 200 }));
      const r = await AdminApi.insertRow('app1', 't', 'preview', {});
      expect(r.ok).toBe(false);
    });

    it('is false when HTTP not-ok even if body says success:true', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }, { ok: false, status: 500 }));
      const r = await AdminApi.updateUser('app1', 'published', 'u1', { name: 'X' });
      expect(r.ok).toBe(false);
    });

    it('is true only when res.ok AND success:true', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }, { ok: true, status: 200 }));
      const r = await AdminApi.deleteFile('app1', 'preview', 'f1');
      expect(r.ok).toBe(true);
      expect(r.error).toBeUndefined();
    });

    it('treats a truthy-but-non-boolean success as boolean true', async () => {
      // Boolean(data.success) coerces; documents the intended coercion.
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: 1 }, { ok: true, status: 200 }));
      const r = await AdminApi.revokeSessions('app1', 'preview', 'u1');
      expect(r.ok).toBe(true);
    });

    it('getSecurity surfaces ok and nested security/models on success', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ success: true, data: { security: { enabled: true }, models: ['posts'] } }),
      );
      const r = await AdminApi.getSecurity('app1', 'published');
      expect(r.ok).toBe(true);
      expect(r.security).toEqual({ enabled: true });
      expect(r.models).toEqual(['posts']);
    });
  });

  // ─── safe defaults / empty pagination / malformed bodies ─────────────────────

  describe('safe empty defaults', () => {
    it('listTables returns [] on HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'x' }, { ok: false, status: 500 }));
      expect(await AdminApi.listTables('app1', 'preview')).toEqual([]);
    });

    it('listTables returns [] when data.data is absent', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));
      expect(await AdminApi.listTables('app1', 'preview')).toEqual([]);
    });

    it('getTableSchema returns null when there is no data', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }, { ok: true }));
      expect(await AdminApi.getTableSchema('app1', 't', 'preview')).toBeNull();
    });

    it('listRows returns zeroed pagination + empty rows/columns on failure', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 503 }));
      const r = await AdminApi.listRows('app1', 't', 'published');
      expect(r.ok).toBe(false);
      expect(r.rows).toEqual([]);
      expect(r.columns).toEqual([]);
      expect(r.pagination).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
    });

    it('listRows passes through real pagination when present', async () => {
      const pagination = { page: 2, pageSize: 10, total: 35, totalPages: 4 };
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ success: true, data: [{ id: 1 }], columns: [], pagination }),
      );
      const r = await AdminApi.listRows('app1', 't', 'preview', { page: 2, pageSize: 10 });
      expect(r.ok).toBe(true);
      expect(r.rows).toEqual([{ id: 1 }]);
      expect(r.pagination).toEqual(pagination);
    });

    it('listUsers returns empty users + zeroed pagination on failure', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 }));
      const r = await AdminApi.listUsers('app1', 'published');
      expect(r.users).toEqual([]);
      expect(r.pagination).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
    });

    it('listFiles returns the safe default envelope on failure', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));
      const r = await AdminApi.listFiles('app1', 'preview');
      expect(r).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    });

    it('getSecurity returns null security + [] models on failure', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));
      const r = await AdminApi.getSecurity('app1', 'preview');
      expect(r.ok).toBe(false);
      expect(r.security).toBeNull();
      expect(r.models).toEqual([]);
    });

    it('tolerates a non-JSON body and falls back to {} → safe defaults', async () => {
      mockFetch.mockResolvedValueOnce(nonJsonResponse({ ok: true, status: 200 }));
      // success ends up undefined → ok must be false despite HTTP 200.
      const r = await AdminApi.deleteRow('app1', 't', 'preview', 1);
      expect(r.ok).toBe(false);
      expect(r.error).toBeUndefined();
    });

    it('listTables tolerates a non-JSON body → []', async () => {
      mockFetch.mockResolvedValueOnce(nonJsonResponse({ ok: true }));
      expect(await AdminApi.listTables('app1', 'preview')).toEqual([]);
    });
  });

  // ─── source code routes (read-only, not mode-scoped) ─────────────────────────

  describe('source routes', () => {
    it('getSourceFile returns text content on success', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse('file body here', { ok: true, status: 200 }));
      const r = await AdminApi.getSourceFile('app1', 'index.tsx');
      expect(r.ok).toBe(true);
      expect(r.content).toBe('file body here');
      expect(r.status).toBe(200);
    });

    it('getSourceFile surfaces server error message on failure', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'forbidden path' }, { ok: false, status: 403 }));
      const r = await AdminApi.getSourceFile('app1', '../secret');
      expect(r.ok).toBe(false);
      expect(r.status).toBe(403);
      expect(r.content).toBe('');
      expect(r.error).toBe('forbidden path');
    });

    it('getSourceFile falls back to a generic message on a non-JSON error body', async () => {
      mockFetch.mockResolvedValueOnce(nonJsonResponse({ ok: false, status: 502 }));
      const r = await AdminApi.getSourceFile('app1', 'x');
      expect(r.ok).toBe(false);
      expect(r.error).toBe('Failed to load file (502)');
    });

    it('listSource returns safe defaults on failure (appName falls back to "app")', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));
      const r = await AdminApi.listSource('app1');
      expect(r.ok).toBe(false);
      expect(r.files).toEqual([]);
      expect(r.appName).toBe('app');
    });

    it('exportZipUrl / sourceZipUrl build the expected static URLs', () => {
      expect(AdminApi.sourceZipUrl('app1')).toBe('/api/admin/app1/source/download');
      expect(AdminApi.exportZipUrl('app1', 'handover')).toBe('/api/admin/app1/export/handover');
    });
  });
});
