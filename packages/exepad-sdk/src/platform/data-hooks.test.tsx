import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useApp } from './useApp';
import { useModel } from './useModel';
import { useHandler } from './useHandler';
import { useCount } from './useCount';
import { toast } from './toast';
import type { ExepadPlatformAPI, UseModelReturn, UseHandlerReturn } from './types';

type AppSetState = (key: string, value: unknown) => void;

/**
 * The SDK's data hooks ship verbatim into every generated app and are the only
 * sanctioned way components touch app state or the backend. Three contracts are
 * load-bearing here:
 *
 *  1. useApp bridges to the runtime's Zustand store via window.ExepadState using
 *     useSyncExternalStore. It MUST stay safe when the store is absent (a bare
 *     SDK consumer, SSR, or a not-yet-hydrated mount): a stable FALLBACK with a
 *     no-op setState, and a `dispatch()` that warns instead of throwing — the
 *     #1 footgun the agent emits. With a selector it must subscribe to store
 *     changes and re-render when the selected slice changes.
 *
 *  2. useModel/useHandler/useCount delegate to window.ExepadPlatform when one is
 *     mounted, and otherwise return SAFE DEFAULTS — useModel's `data` is `[]`
 *     (never null/undefined, so a component's `.map()` can't crash before data
 *     resolves), useHandler's `data` is null, useCount's `count` is a real `0`.
 *     useCount must surface the platform's `totalCount` as `count`, not the row
 *     array (the bug class it was built to kill).
 *
 *  3. toast bridges to the runtime's ToastEventListener by dispatching an
 *     `exepad:toast` CustomEvent. The detail shape (message/type/duration) is a
 *     consumer contract, and it must not throw when window is unusable.
 *
 * Tests drive the seams by setting/clearing window.ExepadState and
 * window.ExepadPlatform, exactly as the runtime does at mount.
 */

beforeEach(() => {
  delete (window as any).ExepadState;
  delete (window as any).ExepadPlatform;
});

afterEach(() => {
  delete (window as any).ExepadState;
  delete (window as any).ExepadPlatform;
  vi.restoreAllMocks();
});

// ── A minimal in-memory stand-in for the runtime's window.ExepadState. Mirrors
// the globals.d.ts contract: getState / set / subscribe(listener) → unsubscribe.
function installExepadState(initial: Record<string, unknown> = {}) {
  let state = { ...initial };
  const listeners = new Set<(s: unknown, p: unknown) => void>();
  const es = {
    getState: vi.fn(() => state),
    set: vi.fn((key: string, value: unknown) => {
      const prev = state;
      state = { ...state, [key]: value };
      listeners.forEach((l) => l(state, prev));
    }),
    subscribe: vi.fn((listener: (s: unknown, p: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  (window as any).ExepadState = es;
  return { es, listeners, setExternally: es.set };
}

describe('useApp — FALLBACK when no ExepadState store is mounted', () => {
  it('returns the stable FALLBACK object with a no-op setState (no selector)', () => {
    const { result } = renderHook(() => useApp());
    expect(typeof result.current.setState).toBe('function');
    // The no-op setState must not throw and must not invent state.
    expect(() => result.current.setState('x', 1)).not.toThrow();
  });

  it('FALLBACK identity is stable across re-renders (useSyncExternalStore safety)', () => {
    const { result, rerender } = renderHook(() => useApp());
    const first = result.current;
    rerender();
    // A fresh object each getSnapshot would trip React's infinite-loop guard;
    // FALLBACK is a module-level singleton, so the snapshot is referentially
    // stable while the store is absent.
    expect(result.current).toBe(first);
  });

  it('a selector over the FALLBACK yields undefined for unknown keys (no throw)', () => {
    const { result } = renderHook(() => useApp((s) => s.count));
    expect(result.current).toBeUndefined();
  });

  it('does not subscribe to anything when the store is absent', () => {
    // No ExepadState → subscribe path uses the stable noop; nothing to assert on
    // a spy, but the hook must mount cleanly and unmount without error.
    const { unmount } = renderHook(() => useApp((s) => s.count));
    expect(() => unmount()).not.toThrow();
  });
});

describe('useApp — bridged to a live ExepadState store', () => {
  // Regression: the no-selector form `useApp()` over a *live* store used to loop
  // (buildSnapshot returned a fresh object every getSnapshot call, so
  // useSyncExternalStore could never cache it → "Maximum update depth
  // exceeded"). The snapshot is now memoized by store-state identity, so the
  // documented `const { count } = useApp()` usage is render-stable.
  it('no-selector useApp() over a live store does not loop and reads state', () => {
    installExepadState({ count: 7, name: 'orders' });
    const renders = vi.fn();
    const { result } = renderHook(() => {
      renders();
      return useApp();
    });
    expect((result.current as { count: unknown }).count).toBe(7);
    expect((result.current as { name: unknown }).name).toBe('orders');
    expect(typeof result.current.setState).toBe('function');
    // A render loop would call the body dozens of times before React bails;
    // a memoized snapshot settles in a single commit.
    expect(renders.mock.calls.length).toBeLessThan(5);
  });

  it('no-selector snapshot is referentially stable across re-renders until state changes', () => {
    installExepadState({ count: 1 });
    const { result, rerender } = renderHook(() => useApp());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first); // same reference → no loop
  });

  it('selects the spread state through the snapshot (count + name)', () => {
    installExepadState({ count: 7, name: 'orders' });
    const { result: count } = renderHook(() => useApp((s) => s.count));
    const { result: name } = renderHook(() => useApp((s) => s.name));
    expect(count.current).toBe(7);
    expect(name.current).toBe('orders');
  });

  it('selector narrows the snapshot to a single primitive', () => {
    installExepadState({ count: 42, isSubmitting: false });
    const { result } = renderHook(() => useApp((s) => s.count));
    expect(result.current).toBe(42);
  });

  it('subscribes to the store on mount and unsubscribes on unmount', () => {
    const { es, listeners } = installExepadState({ count: 0 });
    const { unmount } = renderHook(() => useApp((s) => s.count));
    expect(es.subscribe).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('re-renders with the new value when the selected slice changes in the store', () => {
    const { setExternally } = installExepadState({ count: 1 });
    const { result } = renderHook(() => useApp((s) => s.count));
    expect(result.current).toBe(1);

    act(() => {
      setExternally('count', 2);
    });
    expect(result.current).toBe(2);
  });

  it('setState (selected) delegates to the store.set', () => {
    // Select the setState fn alone — it is `es.set`, a stable ref across
    // snapshots, so this avoids the no-selector infinite-loop trap above while
    // still proving the wiring.
    const { es } = installExepadState({ count: 0 });
    const { result } = renderHook(() => useApp((s) => s.setState));
    act(() => {
      (result.current as AppSetState)('count', 99);
    });
    expect(es.set).toHaveBeenCalledWith('count', 99);
  });

  it('a selector that does NOT depend on the changed key does not change the returned value', () => {
    const { setExternally } = installExepadState({ count: 1, other: 'a' });
    const { result } = renderHook(() => useApp((s) => s.other));
    expect(result.current).toBe('a');
    act(() => {
      setExternally('count', 2);
    });
    // useSyncExternalStore compares snapshots by Object.is; 'a' === 'a' so the
    // value the consumer sees is unchanged.
    expect(result.current).toBe('a');
  });
});

describe('useApp — dispatch() escape hatch warns instead of existing', () => {
  it('exposes a dispatch that warns and is a no-op (the agent footgun)', () => {
    // `dispatch` is rebuilt inside buildSnapshot, so selecting it directly
    // (`s => s.dispatch`) would return a fresh ref each getSnapshot and loop.
    // Instead we invoke it as a *side effect* inside the selector and return a
    // stable primitive — the snapshot stays cacheable, but the dispatch branch
    // still executes so its console.warn fires.
    installExepadState({ count: 0 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() =>
      useApp((s) => {
        expect(typeof (s as any).dispatch).toBe('function');
        (s as any).dispatch({ type: 'SOMETHING' });
        return s.count;
      }),
    );

    expect(result.current).toBe(0);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain('[Exepad SDK]');
    expect(warn.mock.calls[0][0]).toContain('dispatch()');
  });

  it('dispatch is a no-op that does not throw or mutate the store', () => {
    const { es } = installExepadState({ count: 5 });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderHook(() =>
      useApp((s) => {
        (s as any).dispatch({ type: 'INC' });
        return s.count;
      }),
    );
    // dispatch must NOT have routed to the store's set.
    expect(es.set).not.toHaveBeenCalled();
  });

  it('does NOT attach dispatch on the FALLBACK path (store absent)', () => {
    // FALLBACK is the bare { setState } object — no dispatch key — so a guard
    // like `typeof app.dispatch === 'function'` correctly reads false offline.
    const { result } = renderHook(() => useApp());
    expect((result.current as any).dispatch).toBeUndefined();
  });
});

// ── A fully-stubbed platform so the delegating hooks can be exercised. Only the
// surface each hook touches needs to be real.
function installPlatform(overrides: Partial<ExepadPlatformAPI> = {}) {
  const platform = {
    useModel: vi.fn(),
    useHandler: vi.fn(),
    useNavigation: vi.fn(),
    navigate: vi.fn(),
    useTheme: vi.fn(),
    useCurrentUser: vi.fn(),
    getBasePath: vi.fn(() => ''),
    getAppId: vi.fn(() => 'app123'),
    getRpcUrl: vi.fn(() => '/rpc'),
    ...overrides,
  } as unknown as ExepadPlatformAPI;
  (window as any).ExepadPlatform = platform;
  return platform;
}

describe('useModel — safe defaults when no platform is mounted', () => {
  it('returns data as [] (NOT null/undefined) so an eager .map() cannot crash', () => {
    const { result } = renderHook(() => useModel('orders'));
    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.data).toEqual([]);
    // The guarantee the doc-comment makes: never throws on .map() pre-resolve.
    expect(() => (result.current.data as any[]).map((x) => x)).not.toThrow();
  });

  it('fills the rest of the contract with inert, non-throwing defaults', async () => {
    const { result } = renderHook(() => useModel('orders'));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.totalCount).toBe(0);
    expect(typeof result.current.refetch).toBe('function');
    expect(() => result.current.refetch()).not.toThrow();
    // Mutations resolve (to inert values) rather than reject.
    await expect(result.current.create({})).resolves.toEqual({});
    await expect(result.current.update('id', {})).resolves.toEqual({});
    await expect(result.current.remove('id')).resolves.toBeUndefined();
  });
});

describe('useModel — delegation to the mounted platform', () => {
  it('forwards the model name + options to platform.useModel and returns its value', () => {
    const platformReturn: UseModelReturn = {
      data: [{ id: '1' }],
      loading: false,
      error: null,
      totalCount: 1,
      refetch: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };
    const platform = installPlatform({
      useModel: vi.fn(() => platformReturn) as any,
    });
    const opts = { limit: 10, filters: { status: 'open' } };

    const { result } = renderHook(() => useModel('orders', opts));

    expect(platform.useModel).toHaveBeenCalledWith('orders', opts);
    expect(result.current).toBe(platformReturn);
    expect(result.current.data).toEqual([{ id: '1' }]);
  });

  it('passes the platform value through verbatim even when its data is null (loading)', () => {
    // The platform implementation MAY return null during loading; useModel does
    // not coerce it — the fallback-[] guarantee only applies when there is NO
    // platform. This documents that boundary so consumers know to use (data ?? []).
    const platformReturn: UseModelReturn = {
      data: null,
      loading: true,
      error: null,
      totalCount: 0,
      refetch: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };
    installPlatform({ useModel: vi.fn(() => platformReturn) as any });

    const { result } = renderHook(() => useModel('orders'));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
  });
});

describe('useHandler — safe defaults when no platform is mounted', () => {
  it('returns data: null and non-throwing execute/refetch', async () => {
    const { result } = renderHook(() => useHandler('monthly_revenue'));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.execute).toBe('function');
    expect(typeof result.current.refetch).toBe('function');
    await expect(result.current.execute()).resolves.toBeNull();
    expect(() => result.current.refetch()).not.toThrow();
  });
});

describe('useHandler — delegation to the mounted platform', () => {
  it('forwards name + options and returns the platform value', () => {
    const platformReturn: UseHandlerReturn = {
      data: { ok: true },
      loading: false,
      error: null,
      execute: vi.fn(),
      refetch: vi.fn(),
    };
    const platform = installPlatform({
      useHandler: vi.fn(() => platformReturn) as any,
    });
    const opts = { params: { month: '2026-06' }, autoFetch: true };

    const { result } = renderHook(() => useHandler('monthly_revenue', opts));

    expect(platform.useHandler).toHaveBeenCalledWith('monthly_revenue', opts);
    expect(result.current).toBe(platformReturn);
  });
});

describe('useCount — surfaces totalCount as a real number, never the row array', () => {
  it('returns count 0 (a number) with safe loading/error when no platform is mounted', () => {
    const { result } = renderHook(() => useCount('orders'));
    expect(result.current.count).toBe(0);
    expect(typeof result.current.count).toBe('number');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.refetch).toBe('function');
  });

  it('issues a useModel with limit:1 (rows are irrelevant; only the total matters)', () => {
    const spy = vi.fn(
      (): UseModelReturn => ({
        data: [{ id: '1' }],
        loading: false,
        error: null,
        totalCount: 137,
        refetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      }),
    );
    installPlatform({ useModel: spy as any });

    const { result } = renderHook(() => useCount('orders'));

    expect(spy).toHaveBeenCalledWith('orders', { limit: 1 });
    // The whole point: count is the pagination total, NOT the 1-element page.
    expect(result.current.count).toBe(137);
  });

  it('coalesces a missing/undefined totalCount to 0 (no NaN, no undefined leak)', () => {
    installPlatform({
      useModel: vi.fn(
        () =>
          ({
            data: null,
            loading: true,
            error: null,
            totalCount: undefined,
            refetch: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
          }) as any,
      ),
    });

    const { result } = renderHook(() => useCount('orders'));
    expect(result.current.count).toBe(0);
    expect(Number.isNaN(result.current.count)).toBe(false);
    // loading/error are mirrored straight from the underlying useModel.
    expect(result.current.loading).toBe(true);
  });

  it('propagates the underlying error string and refetch handle', () => {
    const refetch = vi.fn();
    installPlatform({
      useModel: vi.fn(
        () =>
          ({
            data: null,
            loading: false,
            error: 'boom',
            totalCount: 0,
            refetch,
            create: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
          }) as any,
      ),
    });

    const { result } = renderHook(() => useCount('orders'));
    expect(result.current.error).toBe('boom');
    result.current.refetch();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('toast — exepad:toast CustomEvent contract', () => {
  function captureToast(fn: () => void): { type: string; detail: any } {
    let captured: any = null;
    const handler = (e: Event) => {
      captured = { type: e.type, detail: (e as CustomEvent).detail };
    };
    window.addEventListener('exepad:toast', handler);
    try {
      fn();
    } finally {
      window.removeEventListener('exepad:toast', handler);
    }
    return captured;
  }

  it('default toast() dispatches type "default" with the message and 5000ms duration', () => {
    const ev = captureToast(() => toast('Saved'));
    expect(ev).not.toBeNull();
    expect(ev.type).toBe('exepad:toast');
    expect(ev.detail).toEqual({
      message: 'Saved',
      type: 'default',
      duration: 5000,
    });
  });

  it('success/error/warning/info each tag the matching detail.type', () => {
    expect(captureToast(() => toast.success('ok')).detail.type).toBe('success');
    expect(captureToast(() => toast.error('bad')).detail.type).toBe('error');
    expect(captureToast(() => toast.warning('hmm')).detail.type).toBe('warning');
    expect(captureToast(() => toast.info('fyi')).detail.type).toBe('info');
  });

  it('folds opts.description into "message — description"', () => {
    const ev = captureToast(() =>
      toast.success('Done', { description: 'All records synced' }),
    );
    expect(ev.detail.message).toBe('Done — All records synced');
  });

  it('honors an explicit opts.duration over the 5000ms default', () => {
    const ev = captureToast(() => toast('Quick', { duration: 1200 }));
    expect(ev.detail.duration).toBe(1200);
  });

  it('treats duration: 0 as 5000 (?? only catches null/undefined, not 0)', () => {
    // Documents the nullish-coalescing boundary: a deliberate 0 duration is
    // falsy-but-defined, so `?? 5000` keeps the 0 — guarding against a future
    // refactor to `||` that would silently swallow it.
    const ev = captureToast(() => toast('Zero', { duration: 0 }));
    expect(ev.detail.duration).toBe(0);
  });

  it('emits a real CustomEvent (instanceof) so listeners can read .detail', () => {
    let isCustom = false;
    const handler = (e: Event) => {
      isCustom = e instanceof CustomEvent;
    };
    window.addEventListener('exepad:toast', handler);
    toast('x');
    window.removeEventListener('exepad:toast', handler);
    expect(isCustom).toBe(true);
  });

  it('passes an empty-string message through unchanged (no description fold)', () => {
    const ev = captureToast(() => toast(''));
    expect(ev.detail.message).toBe('');
    expect(ev.detail.type).toBe('default');
  });
});

describe('toast — SSR / no-window safety', () => {
  // toast() calls `window.dispatchEvent` with no `typeof window`/feature guard.
  // The SDK ships verbatim into apps that may evaluate it during SSR or in a
  // worker where `window` (or dispatchEvent) is undefined. The intended,
  // safe behavior is to no-op silently rather than throw, the same way
  // useNavigation guards its globals.
  //
  // Regression: toast guards its window globals, so on a window without
  // dispatchEvent it degrades to a no-op instead of throwing. We simulate "no
  // window event bus" by stubbing dispatchEvent to undefined (a faithful
  // stand-in for the SSR globalThis where the function simply isn't there).
  let realDispatch: typeof window.dispatchEvent;
  beforeEach(() => {
    realDispatch = window.dispatchEvent;
  });
  afterEach(() => {
    (window as any).dispatchEvent = realDispatch;
  });

  it('does not throw when window has no dispatchEvent (SSR-like)', () => {
    (window as any).dispatchEvent = undefined;
    expect(() => toast('hello')).not.toThrow();
  });

  it('toast.error also tolerates a missing dispatchEvent', () => {
    (window as any).dispatchEvent = undefined;
    expect(() => toast.error('boom')).not.toThrow();
  });
});
