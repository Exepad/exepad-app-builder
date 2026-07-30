/**
 * useRuntimeStore Hook Tests (Unit)
 *
 * Focus: per-app auth bootstrap.
 *  - auth_me success/failure mapping into the store
 *  - catch path forces unauthenticated
 *  - AbortController teardown on unmount (signal aborted; no late writes)
 *  - skip guard + public-app (auth-not-configured) no-auth_me path
 *  - exepad:auth:changed handling (user / signout / fallback re-fetch)
 *
 * Harness mirrors useCurrentPage.test.tsx: module-level vi.mock + dynamic
 * import after the mocks are installed. The Zustand store, react-router,
 * AppConfigContext and the auth/registry helper modules are all mocked so the
 * hook runs in isolation and we can assert exactly which store writes happen.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mutable mock state (read lazily via getters in the mocks) ---------------
let mockAppConfig: any = {};
let mockBasePath = '/a/test-app';
let mockApiAppId = 'test-app';

// Store mocks — `set`, `initialize` are spies; `getState()` returns a stable
// object exposing `set`.
const mockSet = vi.fn();
const mockInitialize = vi.fn();
const mockSetCurrentAppId = vi.fn();
const mockSetApiAppId = vi.fn();

// jwt-helper / platformAuth / registry spies
const mockGetPlatformUser = vi.fn();
const mockGetJWTTokenFromCookieAPI = vi.fn();
const mockInstallInterceptor = vi.fn();
const mockInitRegistry = vi.fn();

// react-router
vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/context/AppConfigContext', () => ({
  useAppConfig: () => ({
    get appConfig() { return mockAppConfig; },
    get basePath() { return mockBasePath; },
    get apiAppId() { return mockApiAppId; },
  }),
}));

// The hook uses both `useAppStateStore((s) => s.initialize)` (selector form)
// and `useAppStateStore.getState()` (static form). Support both.
const storeState = { initialize: mockInitialize, set: mockSet };
const useAppStateStoreMock: any = (selector?: (s: any) => unknown) =>
  selector ? selector(storeState) : storeState;
useAppStateStoreMock.getState = () => storeState;
// The hook rehydrates the persist middleware after scoping the app id. The real
// store is wrapped in zustand's `persist` (skipHydration: true), which exposes
// `.persist.rehydrate()`; mirror that shape so the effect doesn't throw.
useAppStateStoreMock.persist = { rehydrate: () => {} };

vi.mock('@/stores/appStateStore', () => ({
  useAppStateStore: useAppStateStoreMock,
  setCurrentAppId: (id: string) => mockSetCurrentAppId(id),
  setApiAppId: (id: string) => mockSetApiAppId(id),
}));

vi.mock('@/app_runtime/interfaces/backend', () => ({
  isStaticBackend: (b: any) => !!b && b.mode === 'static',
}));

vi.mock('@/lib/componentRegistry', () => ({
  initializeComponentRegistry: (...args: any[]) => mockInitRegistry(...args),
}));

vi.mock('@/lib/platformAuth', () => ({
  installPlatformAuthInterceptor: () => mockInstallInterceptor(),
}));

vi.mock('@/lib/jwt-helper', () => ({
  getPlatformUser: () => mockGetPlatformUser(),
  getJWTTokenFromCookieAPI: () => mockGetJWTTokenFromCookieAPI(),
}));

// Dynamic imports after mocks are installed
const { renderHook, waitFor } = await import('@testing-library/react');
const { useRuntimeStore } = await import('@/hooks/useRuntimeStore');

// --- Helpers -----------------------------------------------------------------

/** A security block that makes `authConfigured` true. */
const SECURE_CONFIG = {
  uuid: 'app-uuid-1',
  frontend: { logic: { state: { count: 0 } } },
  backend: { mode: 'dynamic' },
  security: { enabled: true, authProviders: ['email'] },
};

/** Mock a single fetch JSON response. */
function mockFetchOnce(body: unknown, ok = true) {
  (globalThis.fetch as any).mockImplementationOnce(async (_url: string, init?: RequestInit) => {
    return {
      ok,
      json: async () => body,
      // expose the signal so abort tests can inspect it if needed
      _signal: init?.signal,
    };
  });
}

/** Returns store writes for a given key prefix. */
function setCallsFor(key: string) {
  return mockSet.mock.calls.filter((c) => c[0] === key);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAppConfig = { ...SECURE_CONFIG };
  mockBasePath = '/a/test-app';
  mockApiAppId = 'test-app';
  // Default platform-user/cookie behavior: no enrichment needed
  mockGetPlatformUser.mockReturnValue(null);
  mockGetJWTTokenFromCookieAPI.mockResolvedValue(undefined);
  // Default fetch: never resolves unless a test arms it (avoids accidental hits)
  globalThis.fetch = vi.fn(() => new Promise(() => {})) as any;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useRuntimeStore — initialization', () => {
  it('scopes the app id, sets api id, installs interceptor, inits registry', () => {
    mockAppConfig = { ...SECURE_CONFIG, repo: { components: [] } };
    renderHook(() => useRuntimeStore());

    expect(mockSetCurrentAppId).toHaveBeenCalledWith('app-uuid-1');
    expect(mockSetApiAppId).toHaveBeenCalledWith('test-app');
    expect(mockInstallInterceptor).toHaveBeenCalledTimes(1);
    expect(mockInitRegistry).toHaveBeenCalledWith({ components: [] }, '/a/test-app');
  });

  it('passes uuid="" to setCurrentAppId when uuid is missing', () => {
    mockAppConfig = { ...SECURE_CONFIG, uuid: undefined };
    renderHook(() => useRuntimeStore());
    expect(mockSetCurrentAppId).toHaveBeenCalledWith('');
  });

  it('seeds the $auth namespace (isLoading) when auth is configured', () => {
    renderHook(() => useRuntimeStore());

    expect(mockInitialize).toHaveBeenCalledTimes(1);
    const stateConfig = mockInitialize.mock.calls[0][0];
    expect(stateConfig.state.auth).toEqual({
      isAuthenticated: false,
      isLoading: true,
      user: null,
      roles: [],
      error: null,
    });
    // UI state from config is preserved
    expect(stateConfig.state.count).toBe(0);
  });

  it('injects static datasets into initial state', () => {
    mockAppConfig = {
      ...SECURE_CONFIG,
      backend: {
        mode: 'static',
        data: {
          datasets: {
            products: { type: 'static', records: [{ id: 1 }, { id: 2 }] },
            // non-static / non-array datasets are ignored
            broken: { type: 'static', records: 'not-an-array' },
            other: { type: 'dynamic', records: [{ id: 9 }] },
          },
        },
      },
    };
    renderHook(() => useRuntimeStore());

    const state = mockInitialize.mock.calls[0][0].state;
    expect(state.products).toEqual([{ id: 1 }, { id: 2 }]);
    expect(state.broken).toBeUndefined();
    expect(state.other).toBeUndefined();
  });
});

describe('useRuntimeStore — skip guard', () => {
  it('does nothing when skip=true (parent already initialized the store)', () => {
    renderHook(() => useRuntimeStore(true));

    expect(mockSetCurrentAppId).not.toHaveBeenCalled();
    expect(mockInitialize).not.toHaveBeenCalled();
    expect(mockInstallInterceptor).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('useRuntimeStore — public app (auth NOT configured)', () => {
  it('does not seed $auth and does not call auth_me when no providers', () => {
    mockAppConfig = {
      uuid: 'pub',
      frontend: { logic: { state: {} } },
      backend: { mode: 'dynamic' },
      security: { enabled: true, authProviders: [], defaultAccess: 'public' },
    };
    renderHook(() => useRuntimeStore());

    const state = mockInitialize.mock.calls[0][0].state;
    expect(state.auth).toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not seed $auth when security block is entirely absent', () => {
    mockAppConfig = {
      uuid: 'pub2',
      frontend: { logic: { state: {} } },
      backend: { mode: 'dynamic' },
    };
    renderHook(() => useRuntimeStore());

    expect(mockInitialize.mock.calls[0][0].state.auth).toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not call auth_me when security.enabled === false even with providers', () => {
    mockAppConfig = {
      ...SECURE_CONFIG,
      security: { enabled: false, authProviders: ['email'] },
    };
    renderHook(() => useRuntimeStore());

    expect(mockInitialize.mock.calls[0][0].state.auth).toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not call auth_me when auth configured but apiAppId is empty', () => {
    mockApiAppId = '';
    renderHook(() => useRuntimeStore());

    // $auth IS seeded (auth configured), but the session check is skipped.
    expect(mockInitialize.mock.calls[0][0].state.auth).toBeDefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('useRuntimeStore — auth_me success/failure mapping', () => {
  it('maps a successful auth_me into authenticated store writes', async () => {
    mockFetchOnce({
      success: true,
      data: {
        user: { id: 'u1', email: 'a@b.com', name: 'Ann', roles: ['admin'] },
      },
    });

    renderHook(() => useRuntimeStore());

    await waitFor(() => {
      expect(setCallsFor('auth.isLoading').length).toBeGreaterThan(0);
    });

    // Correct endpoint + POST + credentials + auth_me method body
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('/api/test-app/auth_me');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({ method: 'auth_me', params: {} });

    expect(setCallsFor('auth.isAuthenticated').at(-1)?.[1]).toBe(true);
    expect(setCallsFor('auth.user').at(-1)?.[1]).toEqual({
      id: 'u1', email: 'a@b.com', name: 'Ann', roles: ['admin'],
    });
    expect(setCallsFor('auth.roles').at(-1)?.[1]).toEqual(['admin']);
    expect(setCallsFor('auth.isLoading').at(-1)?.[1]).toBe(false);
  });

  it('treats a non-array roles field as empty roles', async () => {
    mockFetchOnce({
      success: true,
      data: { user: { id: 'u2', email: 'x@y.com', roles: 'admin' } },
    });

    renderHook(() => useRuntimeStore());

    await waitFor(() => {
      expect(setCallsFor('auth.user').length).toBeGreaterThan(0);
    });
    expect(setCallsFor('auth.user').at(-1)?.[1].roles).toEqual([]);
  });

  it('forces unauthenticated when success=false', async () => {
    mockFetchOnce({ success: false, data: null });

    renderHook(() => useRuntimeStore());

    await waitFor(() => {
      expect(setCallsFor('auth.isLoading').length).toBeGreaterThan(0);
    });
    expect(setCallsFor('auth.isAuthenticated').at(-1)?.[1]).toBe(false);
    expect(setCallsFor('auth.user').at(-1)?.[1]).toBeNull();
    expect(setCallsFor('auth.isLoading').at(-1)?.[1]).toBe(false);
  });

  it('forces unauthenticated when success=true but no user payload', async () => {
    mockFetchOnce({ success: true, data: null });

    renderHook(() => useRuntimeStore());

    await waitFor(() => {
      expect(setCallsFor('auth.isLoading').length).toBeGreaterThan(0);
    });
    expect(setCallsFor('auth.isAuthenticated').at(-1)?.[1]).toBe(false);
    expect(setCallsFor('auth.user').at(-1)?.[1]).toBeNull();
  });

  it('catch path (network/JSON throw) forces unauthenticated', async () => {
    (globalThis.fetch as any).mockImplementationOnce(async () => {
      throw new Error('network down');
    });

    renderHook(() => useRuntimeStore());

    await waitFor(() => {
      expect(setCallsFor('auth.isLoading').length).toBeGreaterThan(0);
    });
    expect(setCallsFor('auth.isAuthenticated').at(-1)?.[1]).toBe(false);
    expect(setCallsFor('auth.user').at(-1)?.[1]).toBeNull();
    expect(setCallsFor('auth.isLoading').at(-1)?.[1]).toBe(false);
  });

  it('catch path on a rejected res.json() still forces unauthenticated', async () => {
    (globalThis.fetch as any).mockImplementationOnce(async () => ({
      ok: true,
      json: async () => { throw new Error('bad json'); },
    }));

    renderHook(() => useRuntimeStore());

    await waitFor(() => {
      expect(setCallsFor('auth.isLoading').at(-1)?.[1]).toBe(false);
    });
    expect(setCallsFor('auth.isAuthenticated').at(-1)?.[1]).toBe(false);
  });
});

describe('useRuntimeStore — preview identity enrichment', () => {
  it('enriches a preview-owner identity with the platform user', async () => {
    mockFetchOnce({
      success: true,
      data: { user: { id: 'preview-owner-123', email: null, roles: [] } },
    });
    mockGetPlatformUser.mockReturnValue({ id: 'p1', email: 'real@me.com', name: 'Real' });

    renderHook(() => useRuntimeStore());

    await waitFor(() => {
      expect(setCallsFor('auth.user').length).toBeGreaterThan(0);
    });
    const user = setCallsFor('auth.user').at(-1)?.[1];
    expect(user.email).toBe('real@me.com');
    expect(user.id).toBe('p1');
    expect(user.name).toBe('Real');
  });

  it('falls back to the cookie API when no cached platform user', async () => {
    mockFetchOnce({
      success: true,
      data: { user: { id: 'u9', email: null, roles: [] } },
    });
    // First call: no user; after cookie API: user present
    mockGetPlatformUser
      .mockReturnValueOnce(null)
      .mockReturnValue({ id: 'p2', email: 'late@me.com', name: 'Late' });
    mockGetJWTTokenFromCookieAPI.mockResolvedValue('tok');

    renderHook(() => useRuntimeStore());

    await waitFor(() => {
      expect(setCallsFor('auth.user').length).toBeGreaterThan(0);
    });
    expect(mockGetJWTTokenFromCookieAPI).toHaveBeenCalled();
    expect(setCallsFor('auth.user').at(-1)?.[1].email).toBe('late@me.com');
  });

  it('swallows a cookie-API rejection and stays authenticated with original user', async () => {
    mockFetchOnce({
      success: true,
      data: { user: { id: 'u10', email: null, roles: [] } },
    });
    mockGetPlatformUser.mockReturnValue(null);
    mockGetJWTTokenFromCookieAPI.mockRejectedValue(new Error('not on platform'));

    renderHook(() => useRuntimeStore());

    await waitFor(() => {
      expect(setCallsFor('auth.isAuthenticated').length).toBeGreaterThan(0);
    });
    // user object had no email but is still a valid object → authenticated true
    expect(setCallsFor('auth.isAuthenticated').at(-1)?.[1]).toBe(true);
    expect(setCallsFor('auth.user').at(-1)?.[1].id).toBe('u10');
  });
});

describe('useRuntimeStore — AbortController teardown on unmount', () => {
  it('aborts the in-flight auth_me signal on unmount', () => {
    let capturedSignal: AbortSignal | undefined;
    (globalThis.fetch as any).mockImplementation((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal;
      return new Promise(() => {}); // never resolves
    });

    const { unmount } = renderHook(() => useRuntimeStore());
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('does not write to the store after unmount when the response resolves late', async () => {
    let resolveFetch!: (v: unknown) => void;
    (globalThis.fetch as any).mockImplementation((_url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      return new Promise((resolve) => {
        resolveFetch = () =>
          resolve({
            ok: true,
            // mimic that the signal is now aborted
            json: async () => {
              // `signal?.aborted` is checked after json() in the source
              void signal;
              return { success: true, data: { user: { id: 'u', email: 'e@x', roles: [] } } };
            },
          });
      });
    });

    const { unmount } = renderHook(() => useRuntimeStore());
    unmount();

    // Resolve after unmount → source sees signal.aborted and returns early.
    resolveFetch();
    await Promise.resolve();
    await Promise.resolve();

    // No auth.isAuthenticated write should have happened from the aborted fetch.
    expect(setCallsFor('auth.isAuthenticated').length).toBe(0);
  });
});

describe('useRuntimeStore — exepad:auth:changed event', () => {
  // Arm the initial auth_me to never resolve so it can't race the event writes.
  beforeEach(() => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as any;
  });

  it('applies a user from the event synchronously (login)', () => {
    renderHook(() => useRuntimeStore());

    window.dispatchEvent(
      new CustomEvent('exepad:auth:changed', {
        detail: { user: { id: 'evt1', email: 'evt@x.com', roles: ['editor'] } },
      }),
    );

    expect(setCallsFor('auth.isAuthenticated').at(-1)?.[1]).toBe(true);
    expect(setCallsFor('auth.user').at(-1)?.[1]).toEqual({
      id: 'evt1', email: 'evt@x.com', name: null, roles: ['editor'],
    });
    expect(setCallsFor('auth.roles').at(-1)?.[1]).toEqual(['editor']);
    expect(setCallsFor('auth.isLoading').at(-1)?.[1]).toBe(false);
  });

  it('clears auth on a signout event', () => {
    renderHook(() => useRuntimeStore());

    window.dispatchEvent(
      new CustomEvent('exepad:auth:changed', { detail: { action: 'signout' } }),
    );

    expect(setCallsFor('auth.isAuthenticated').at(-1)?.[1]).toBe(false);
    expect(setCallsFor('auth.user').at(-1)?.[1]).toBeNull();
    expect(setCallsFor('auth.roles').at(-1)?.[1]).toEqual([]);
    expect(setCallsFor('auth.isLoading').at(-1)?.[1]).toBe(false);
  });

  it('re-fetches auth_me when the event carries no user and no signout action', () => {
    renderHook(() => useRuntimeStore());

    const beforeCalls = (globalThis.fetch as any).mock.calls.length;
    window.dispatchEvent(
      new CustomEvent('exepad:auth:changed', { detail: {} }),
    );
    // A new auth_me fetch should be issued (the fallback branch).
    expect((globalThis.fetch as any).mock.calls.length).toBe(beforeCalls + 1);
    expect((globalThis.fetch as any).mock.calls.at(-1)[0]).toBe('/api/test-app/auth_me');
  });

  it('removes the event listener on unmount (no store writes after)', () => {
    const { unmount } = renderHook(() => useRuntimeStore());
    unmount();
    mockSet.mockClear();

    window.dispatchEvent(
      new CustomEvent('exepad:auth:changed', {
        detail: { user: { id: 'late', email: 'l@x', roles: [] } },
      }),
    );
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('does not register the listener for public (auth-not-configured) apps', () => {
    mockAppConfig = {
      uuid: 'pub',
      frontend: { logic: { state: {} } },
      backend: { mode: 'dynamic' },
      security: { enabled: true, authProviders: [] },
    };
    renderHook(() => useRuntimeStore());
    mockSet.mockClear();

    window.dispatchEvent(
      new CustomEvent('exepad:auth:changed', {
        detail: { user: { id: 'x', email: 'x@x', roles: [] } },
      }),
    );
    expect(mockSet).not.toHaveBeenCalled();
  });
});
