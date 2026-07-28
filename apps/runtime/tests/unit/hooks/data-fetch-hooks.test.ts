/**
 * Data-fetch hooks tests — useModelData / useHandlerData
 *
 * Focus:
 *  - loading / error / empty states + aggregate result shape
 *  - paramsKey refetch stability (same params => no refetch, changed => refetch)
 *  - change-listener re-fetch (exepad:model:changed / exepad:handler:changed)
 *  - skip behavior (missing id/name, frontend-only example with no backend)
 *  - error branches (result.success=false, thrown/network error, malformed body)
 *
 * The RPC layer is the global `fetch`; we stub it per-test. The real
 * `dedupedFetch` cache (module-level, 3s TTL) is shared across tests, so every
 * test uses a unique appId/model/handler so cache keys never collide, and we
 * invalidate the cache between tests for good measure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useModelData } from '@/app_runtime/runtime/hooks/useModelData';
import { useHandlerData } from '@/app_runtime/runtime/hooks/useHandlerData';

// ---------------------------------------------------------------------------
// AppConfigContext mock — a mutable holder so each test can drive the context.
// ---------------------------------------------------------------------------
type Ctx = {
  appId?: string;
  apiAppId?: string;
  mode?: string;
  routeType?: string;
  appConfig?: any;
};

let currentCtx: Ctx | null = null;

vi.mock('@/context/AppConfigContext', () => ({
  useAppConfigOptional: () => currentCtx,
  useAppConfig: () => currentCtx,
}));

// A dynamic backend with at least one model => `hasBackend` is true.
const DYNAMIC_BACKEND = {
  mode: 'dynamic',
  models: [{ name: 'whatever' }],
  handlers: [{ name: 'whatever' }],
};

function dynamicCtx(over: Partial<Ctx> = {}): Ctx {
  return {
    apiAppId: 'app-default',
    mode: 'published',
    routeType: 'app',
    appConfig: { backend: DYNAMIC_BACKEND },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// fetch stubbing helpers
// ---------------------------------------------------------------------------
const originalFetch = globalThis.fetch;

/** A fetch mock whose `.json()` resolves to the supplied body. */
function okFetch(body: unknown) {
  return vi.fn(async () => ({ json: async () => body }) as any);
}

beforeEach(() => {
  currentCtx = dynamicCtx();
  vi.clearAllMocks();
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  // Drop any cached dedup entries so they cannot leak across tests within
  // the 3s TTL window.
  const { invalidateDedup } = await import('@/lib/fetchDedup');
  invalidateDedup('model:');
  invalidateDedup('handler:');
});

// ===========================================================================
// useModelData
// ===========================================================================
describe('useModelData', () => {
  it('fetches a model list, exposes data + totalCount, and is not loading when done', async () => {
    const rows = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
    globalThis.fetch = okFetch({ success: true, data: rows, pagination: { total: 42 } }) as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-list' });

    const { result } = renderHook(() => useModelData('contacts'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(rows);
    expect(result.current.totalCount).toBe(42);
    expect(result.current.error).toBeNull();
  });

  it('posts sys_list to /api/{appId}/{model} with default limit/offset and the model in the body', async () => {
    const fetchMock = okFetch({ success: true, data: [] });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-shape' });

    const { result } = renderHook(() => useModelData('tasks'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/m-shape/tasks');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.method).toBe('sys_list');
    expect(body.model).toBe('tasks');
    expect(body.params.limit).toBe(100);
    expect(body.params.offset).toBe(0);
  });

  it('falls back totalCount to data.length when pagination is absent', async () => {
    globalThis.fetch = okFetch({ success: true, data: [{ id: 1 }, { id: 2 }, { id: 3 }] }) as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-count' });

    const { result } = renderHook(() => useModelData('items'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.totalCount).toBe(3);
  });

  it('returns an empty list (not null) when the backend returns no data array', async () => {
    globalThis.fetch = okFetch({ success: true }) as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-empty' });

    const { result } = renderHook(() => useModelData('items'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('switches to sys_aggregate and forwards the aggregate spec when aggregate param is set', async () => {
    const fetchMock = okFetch({ success: true, data: [{ sum: 10 }] });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-agg' });

    const { result } = renderHook(() =>
      useModelData('orders', { aggregate: { fn: 'sum', of: 'total' } }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.method).toBe('sys_aggregate');
    expect(body.params.aggregate).toEqual({ fn: 'sum', of: 'total' });
  });

  it('forwards search + searchFields when provided', async () => {
    const fetchMock = okFetch({ success: true, data: [] });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-search' });

    const { result } = renderHook(() =>
      useModelData('docs', { search: 'hello', searchFields: ['title', 'body'] }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params.search).toBe('hello');
    expect(body.params.searchFields).toEqual(['title', 'body']);
  });

  it('surfaces a structured backend error (success=false) and nulls the data', async () => {
    globalThis.fetch = okFetch({ success: false, error: { message: 'boom from backend' } }) as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-err' });

    const { result } = renderHook(() => useModelData('items'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('boom from backend');
  });

  it('uses a default error message when success=false carries no error.message', async () => {
    globalThis.fetch = okFetch({ success: false }) as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-err2' });

    const { result } = renderHook(() => useModelData('items'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Failed to fetch model data');
  });

  it('catches a thrown/network error and reports its message', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('connection refused');
    }) as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-net' });

    const { result } = renderHook(() => useModelData('items'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('connection refused');
  });

  it('catches a malformed (non-JSON) response body via the json() rejection', async () => {
    globalThis.fetch = vi.fn(async () => ({
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    })) as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-bad' });

    const { result } = renderHook(() => useModelData('items'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('Unexpected token < in JSON');
  });

  it('does NOT fetch and resets to a neutral state when modelName is undefined', async () => {
    const fetchMock = okFetch({ success: true, data: [{ id: 1 }] });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-skip' });

    const { result } = renderHook(() => useModelData(undefined));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.totalCount).toBe(0);
  });

  it('does NOT fetch when there is no appId in context', async () => {
    const fetchMock = okFetch({ success: true, data: [{ id: 1 }] });
    globalThis.fetch = fetchMock as any;
    // No apiAppId and no appId on the context.
    currentCtx = { mode: 'published', routeType: 'app', appConfig: { backend: DYNAMIC_BACKEND } };

    const { result } = renderHook(() => useModelData('items'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it('returns empty data without fetching for a frontend-only example (no backend)', async () => {
    const fetchMock = okFetch({ success: true, data: [{ id: 1 }] });
    globalThis.fetch = fetchMock as any;
    currentCtx = {
      apiAppId: 'm-example',
      mode: 'published',
      routeType: 'example',
      appConfig: { backend: { mode: 'static' } }, // not dynamic => hasBackend false
    };

    const { result } = renderHook(() => useModelData('items'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('DOES fetch for an example route when a dynamic backend with models is present', async () => {
    const fetchMock = okFetch({ success: true, data: [] });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-example-dyn', routeType: 'example' });

    const { result } = renderHook(() => useModelData('items'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ---- paramsKey refetch stability -------------------------------------
  it('does NOT refetch when re-rendered with a fresh-but-equal params object', async () => {
    const fetchMock = okFetch({ success: true, data: [] });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-stable' });

    const { result, rerender } = renderHook(
      ({ p }) => useModelData('items', p),
      { initialProps: { p: { filters: { status: 'active' }, limit: 10 } } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // New object identity but value-equal — paramsKey is unchanged.
    rerender({ p: { filters: { status: 'active' }, limit: 10 } });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches when the params value actually changes', async () => {
    const fetchMock = okFetch({ success: true, data: [] });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-change' });

    const { result, rerender } = renderHook(
      ({ p }) => useModelData('items', p),
      { initialProps: { p: { filters: { status: 'active' } } } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ p: { filters: { status: 'archived' } } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // The second call carries the new filter value.
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.params.filters).toEqual({ status: 'archived' });
  });

  // ---- change-listener re-fetch ----------------------------------------
  it('refetches when an exepad:model:changed event matches the model name', async () => {
    const fetchMock = okFetch({ success: true, data: [] });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-evt' });

    const { result } = renderHook(() => useModelData('contacts'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('exepad:model:changed', { detail: { modelName: 'contacts' } }),
      );
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('ignores an exepad:model:changed event for a different model', async () => {
    const fetchMock = okFetch({ success: true, data: [] });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-evt2' });

    const { result } = renderHook(() => useModelData('contacts'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('exepad:model:changed', { detail: { modelName: 'orders' } }),
      );
    });

    // Give any (unwanted) async fetch a chance to run, then assert no refetch.
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetch() re-runs the fetch once the dedup cache is cleared', async () => {
    // refetch() bumps an internal trigger but that trigger is NOT part of the
    // dedup key, so a bare refetch() inside the 3s TTL legitimately returns the
    // cached response (the change-event path is the one that invalidates first).
    // Clearing the dedup cache makes the underlying fetch run again, proving the
    // refetch() -> useEffect -> fetch wiring is intact.
    const fetchMock = okFetch({ success: true, data: [] });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-refetch' });

    const { result } = renderHook(() => useModelData('contacts'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const { invalidateDedup } = await import('@/lib/fetchDedup');
    invalidateDedup('model:m-refetch:contacts');

    act(() => result.current.refetch());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('refetch() within the dedup TTL returns the cached response (no new fetch)', async () => {
    // Documents the deduplication contract: identical key inside CACHE_TTL is
    // served from cache without re-hitting the network.
    const fetchMock = okFetch({ success: true, data: [] });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-refetch-cached' });

    const { result } = renderHook(() => useModelData('contacts'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => result.current.refetch());
    // Let the refetch effect run; the dedup layer should short-circuit it.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('removes its change-listener on unmount (later events do not refetch)', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const fetchMock = okFetch({ success: true, data: [] });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'm-unmount' });

    const { result, unmount } = renderHook(() => useModelData('contacts'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('exepad:model:changed', expect.any(Function));

    fetchMock.mockClear();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('exepad:model:changed', { detail: { modelName: 'contacts' } }),
      );
    });
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    removeSpy.mockRestore();
  });
});

// ===========================================================================
// useHandlerData
// ===========================================================================
describe('useHandlerData', () => {
  it('calls the handler and exposes its result payload', async () => {
    globalThis.fetch = okFetch({ success: true, data: { count: 7 } }) as any;
    currentCtx = dynamicCtx({ apiAppId: 'h-ok' });

    const { result } = renderHook(() => useHandlerData('getStats'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual({ count: 7 });
    expect(result.current.error).toBeNull();
  });

  it('posts the params object (or {}) to /api/{appId}/{handler}', async () => {
    const fetchMock = okFetch({ success: true, data: null });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'h-shape' });

    const params = { startDate: '2024-01-01' };
    const { result } = renderHook(() => useHandlerData('calc', params));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/h-shape/calc');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(params);
  });

  it('preserves a falsy-but-valid handler result (data:null with success)', async () => {
    globalThis.fetch = okFetch({ success: true, data: null }) as any;
    currentCtx = dynamicCtx({ apiAppId: 'h-null' });

    const { result } = renderHook(() => useHandlerData('noop'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('surfaces a backend handler error (success=false)', async () => {
    globalThis.fetch = okFetch({ success: false, error: { message: 'handler exploded' } }) as any;
    currentCtx = dynamicCtx({ apiAppId: 'h-err' });

    const { result } = renderHook(() => useHandlerData('boom'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('handler exploded');
  });

  it('uses the default error message when success=false lacks error.message', async () => {
    globalThis.fetch = okFetch({ success: false }) as any;
    currentCtx = dynamicCtx({ apiAppId: 'h-err2' });

    const { result } = renderHook(() => useHandlerData('boom'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Handler call failed');
  });

  it('catches a thrown/network error', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('socket hang up');
    }) as any;
    currentCtx = dynamicCtx({ apiAppId: 'h-net' });

    const { result } = renderHook(() => useHandlerData('boom'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('socket hang up');
  });

  it('does NOT call when handlerName is undefined', async () => {
    const fetchMock = okFetch({ success: true, data: 1 });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'h-skip' });

    const { result } = renderHook(() => useHandlerData(undefined));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it('does NOT call for a frontend-only example with no backend', async () => {
    const fetchMock = okFetch({ success: true, data: 1 });
    globalThis.fetch = fetchMock as any;
    currentCtx = {
      apiAppId: 'h-example',
      mode: 'published',
      routeType: 'example',
      appConfig: { backend: { mode: 'static' } },
    };

    const { result } = renderHook(() => useHandlerData('getStats'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it('treats a dynamic backend with only handlers (no models) as having a backend', async () => {
    const fetchMock = okFetch({ success: true, data: 1 });
    globalThis.fetch = fetchMock as any;
    currentCtx = {
      apiAppId: 'h-handlers-only',
      mode: 'published',
      routeType: 'example',
      appConfig: { backend: { mode: 'dynamic', handlers: [{ name: 'x' }], models: [] } },
    };

    const { result } = renderHook(() => useHandlerData('getStats'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ---- paramsKey stability ---------------------------------------------
  it('does NOT refetch when re-rendered with a value-equal params object', async () => {
    const fetchMock = okFetch({ success: true, data: 1 });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'h-stable' });

    const { result, rerender } = renderHook(
      ({ p }) => useHandlerData('calc', p),
      { initialProps: { p: { a: 1, b: 2 } } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ p: { a: 1, b: 2 } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches when the params value changes', async () => {
    const fetchMock = okFetch({ success: true, data: 1 });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'h-change' });

    const { result, rerender } = renderHook(
      ({ p }) => useHandlerData('calc', p),
      { initialProps: { p: { a: 1 } } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ p: { a: 2 } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  // ---- change-listener -------------------------------------------------
  it('refetches on an exepad:handler:changed event matching the handler', async () => {
    const fetchMock = okFetch({ success: true, data: 1 });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'h-evt' });

    const { result } = renderHook(() => useHandlerData('getStats'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('exepad:handler:changed', { detail: { handlerName: 'getStats' } }),
      );
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('refetches on a wildcard exepad:handler:changed event (no handlerName in detail)', async () => {
    const fetchMock = okFetch({ success: true, data: 1 });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'h-evt-wild' });

    const { result } = renderHook(() => useHandlerData('getStats'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new CustomEvent('exepad:handler:changed', { detail: {} }));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('removes the handler change-listener on unmount', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const fetchMock = okFetch({ success: true, data: 1 });
    globalThis.fetch = fetchMock as any;
    currentCtx = dynamicCtx({ apiAppId: 'h-unmount' });

    const { result, unmount } = renderHook(() => useHandlerData('getStats'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('exepad:handler:changed', expect.any(Function));
    removeSpy.mockRestore();
  });
});
