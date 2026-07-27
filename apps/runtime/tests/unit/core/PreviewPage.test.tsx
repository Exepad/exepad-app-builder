/**
 * PreviewPage Tests (Unit)
 *
 * High-value, security-relevant seams of the preview auth guard:
 *   - refresh_preview_token postMessage ORIGIN check (cross-window token spoof guard)
 *   - app-level auth guard memo decisions:
 *       unauthenticated -> login redirect (with returnUrl)
 *       authenticated-on-login-page -> inverse redirect
 *       forbidden role -> ForbiddenPage render
 *   - MAX_REDIRECTS loop-breaker for missing-page navigation
 *
 * Strategy: PreviewPage is a large, coupled component. We mock the heavy leaf
 * collaborators (renderers, edit toolbar, transitions, error display, lifecycle
 * hooks) and the app-config context / router / jwt-helper, while using the REAL
 * Zustand `useAppStateStore` and the REAL pure `checkPageAccess` so the guard
 * logic under test runs unmocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mutable mock controls (set per-test before render) ───────────────────────
let mockAppConfig: any = null;
let mockBasePath = '/a/preview-app1';
let mockAppId: string | undefined = 'app1';
let mockApiAppId: string | undefined = 'app1';
let mockCurrentPage: any = null;
let mockEditorOrigin = 'https://editor.example.com';
let mockPathname = '/a/preview-app1/dashboard';

const mockNavigate = vi.fn();
const mockGetJWTTokenAsync = vi.fn();
const mockSetJWTTokenInStorage = vi.fn();
const mockCleanPreviewTokenFromURL = vi.fn();
const mockFetch = vi.fn();

// ── Module mocks (must precede dynamic imports) ──────────────────────────────
vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/context/AppConfigContext', () => ({
  useAppConfig: () => ({
    get appConfig() { return mockAppConfig; },
    get basePath() { return mockBasePath; },
    get appId() { return mockAppId; },
    get apiAppId() { return mockApiAppId; },
  }),
}));

vi.mock('@/hooks/useCurrentPage', () => ({
  useCurrentPage: () => mockCurrentPage,
}));

vi.mock('@/lib/editor-origin', () => ({
  getEditorOrigin: () => mockEditorOrigin,
}));

vi.mock('@/lib/jwt-helper', () => ({
  getJWTTokenAsync: (...a: any[]) => mockGetJWTTokenAsync(...a),
  setJWTTokenInStorage: (...a: any[]) => mockSetJWTTokenInStorage(...a),
  cleanPreviewTokenFromURL: (...a: any[]) => mockCleanPreviewTokenFromURL(...a),
}));

vi.mock('@/lib/logger', () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Lifecycle hooks — no-op so they don't touch real stores / DOM side effects.
vi.mock('@/hooks/useRuntimeStore', () => ({ useRuntimeStore: () => {} }));
vi.mock('@/hooks/useDocumentMeta', () => ({ useDocumentMeta: () => {} }));

// Heavy leaf components — replaced with identifiable stubs.
vi.mock('@/components/DynamicRenderer', () => ({
  DynamicRendererList: () => <div data-testid="page-content" />,
}));
vi.mock('@/components/PageUuidTracker', () => ({
  PageUuidTracker: () => null,
}));
vi.mock('@/components/HashScrollHandler', () => ({
  HashScrollHandler: () => null,
}));
vi.mock('@/components/HybridPageTransition', () => ({
  HybridPageTransition: ({ children }: any) => <>{children}</>,
}));
vi.mock('@/components/editable/EditModeToolbar', () => ({
  default: () => null,
}));
vi.mock('@/components/ForbiddenPage', () => ({
  ForbiddenPage: ({ redirectUrl, basePath }: any) => (
    <div data-testid="forbidden" data-redirect={redirectUrl} data-basepath={basePath} />
  ),
}));
vi.mock('@/app_shared/components/AppErrorDisplay', () => ({
  UnifiedErrorDisplay: () => <div data-testid="config-error" />,
}));
vi.mock('@/utils/layoutPatterns', () => ({
  getLayoutClasses: () => '',
}));

// ── Dynamic imports after mocks are registered ───────────────────────────────
const { render, screen, act, waitFor, cleanup } = await import('@testing-library/react');
const { useAppStateStore } = await import('@/stores/appStateStore');
const PreviewPage = (await import('@/core/preview/PreviewPage')).default;

// ── Helpers ──────────────────────────────────────────────────────────────────
function setAuthState(partial: Record<string, unknown>) {
  act(() => {
    useAppStateStore.setState((s: any) => ({ _state: { ...s._state, ...partial } }));
  });
}

/** Render and wait for the async platform-auth check to settle. */
async function renderPreview(props: { initialJWT?: string } = {}) {
  const utils = render(<PreviewPage {...props} />);
  // Platform-auth check flips authChecking=false; wait until the loading spinner clears.
  await waitFor(() => {
    expect(document.querySelector('.animate-spin')).toBeNull();
  });
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: a security-enabled app, a resolved protected page, platform-auth OK.
  mockAppConfig = {
    uuid: 'cfg-uuid',
    frontend: { layout: 'header', transitions: {} },
    security: { enabled: true, loginPage: '/login', redirectAfterLogin: '/home' },
    _roleExpansionMap: { admin: ['admin', 'editor'] },
  };
  mockBasePath = '/a/preview-app1';
  mockAppId = 'app1';
  mockApiAppId = 'app1';
  mockCurrentPage = { uuid: 'pg1', slug: '/dashboard', content: [], access: 'authenticated' };
  mockEditorOrigin = 'https://editor.example.com';
  mockPathname = '/a/preview-app1/dashboard';

  // Platform auth: a token is present by default => isAuthenticated true.
  mockGetJWTTokenAsync.mockResolvedValue('platform-token');

  // Reset the real auth store to a clean authenticated baseline.
  useAppStateStore.setState({
    _state: {
      'auth.isAuthenticated': true,
      'auth.isLoading': false,
      'auth.user': { id: 'u1', email: 'u1@x.com' },
      'auth.roles': ['user'],
    },
  } as any);

  // Stub window.fetch and pathname.
  (globalThis as any).fetch = mockFetch;
  mockFetch.mockResolvedValue({ ok: true, status: 200 });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      pathname: mockPathname,
      href: `https://preview.example.com${mockPathname}`,
      origin: 'https://preview.example.com',
    },
  });
});

afterEach(() => {
  cleanup();
});

// =============================================================================
// postMessage origin check for refresh_preview_token
// =============================================================================
describe('PreviewPage — refresh_preview_token postMessage origin guard', () => {
  function postRefresh(origin: string, data: unknown) {
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { origin, data }));
    });
  }

  it('rejects a refresh_preview_token from a NON-editor origin (no fetch)', async () => {
    await renderPreview();
    mockFetch.mockClear();

    postRefresh('https://evil.example.com', {
      type: 'refresh_preview_token',
      token: 'attacker-token',
    });
    // Let any (incorrectly-scheduled) async fetch microtasks flush.
    await act(async () => { await Promise.resolve(); });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('accepts a refresh_preview_token from the trusted editor origin', async () => {
    await renderPreview();
    mockFetch.mockClear();

    postRefresh('https://editor.example.com', {
      type: 'refresh_preview_token',
      token: 'good-token',
    });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    const url = mockFetch.mock.calls[0][0] as string;
    // Hits the same-origin runtime refresh endpoint with the app id + token.
    expect(url).toContain('/a/preview-app1/__refresh');
    expect(url).toContain('pt=good-token');
    // Credentialed, no-store request.
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store' });
  });

  it('ignores a trusted-origin message whose type is not refresh_preview_token', async () => {
    await renderPreview();
    mockFetch.mockClear();

    postRefresh('https://editor.example.com', { type: 'some_other_event', token: 'x' });
    await act(async () => { await Promise.resolve(); });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('ignores a trusted-origin refresh with a non-string / empty token', async () => {
    await renderPreview();
    mockFetch.mockClear();

    postRefresh('https://editor.example.com', { type: 'refresh_preview_token', token: 12345 });
    postRefresh('https://editor.example.com', { type: 'refresh_preview_token', token: '' });
    await act(async () => { await Promise.resolve(); });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('url-encodes the token so it cannot break out of the query string', async () => {
    await renderPreview();
    mockFetch.mockClear();

    postRefresh('https://editor.example.com', {
      type: 'refresh_preview_token',
      token: 'a&b=c d/e',
    });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain(`pt=${encodeURIComponent('a&b=c d/e')}`);
    expect(url).not.toContain('a&b=c d/e');
  });
});

// =============================================================================
// App-level auth guard decisions
// =============================================================================
describe('PreviewPage — app-level auth guard', () => {
  it('unauthenticated user on a protected page -> redirect to login with returnUrl', async () => {
    setAuthState({ 'auth.isAuthenticated': false, 'auth.isLoading': false });

    await renderPreview();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    const [url, opts] = mockNavigate.mock.calls[mockNavigate.mock.calls.length - 1];
    expect(url).toBe(`/a/preview-app1/login?returnUrl=${encodeURIComponent('/a/preview-app1/dashboard')}`);
    expect(opts).toEqual({ replace: true });
    // Guard returns null (no page content) while redirecting.
    expect(screen.queryByTestId('page-content')).toBeNull();
  });

  it('authenticated user ON the login page -> inverse redirect to redirectAfterLogin', async () => {
    mockCurrentPage = { uuid: 'login', slug: '/login', content: [], access: 'public' };
    setAuthState({ 'auth.isAuthenticated': true, 'auth.isLoading': false });

    await renderPreview();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    const [url, opts] = mockNavigate.mock.calls[mockNavigate.mock.calls.length - 1];
    expect(url).toBe('/a/preview-app1/home');
    expect(opts).toEqual({ replace: true });
  });

  it('authenticated user lacking a required role -> ForbiddenPage render (no redirect)', async () => {
    mockCurrentPage = { uuid: 'admin', slug: '/admin', content: [], access: 'role:admin' };
    setAuthState({
      'auth.isAuthenticated': true,
      'auth.isLoading': false,
      'auth.roles': ['user'],
    });

    await renderPreview();

    await waitFor(() => expect(screen.queryByTestId('forbidden')).not.toBeNull());
    const el = screen.getByTestId('forbidden');
    expect(el.getAttribute('data-redirect')).toBe('/home');
    expect(el.getAttribute('data-basepath')).toBe('/a/preview-app1');
    // Forbidden is a render, not a navigation.
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('page-content')).toBeNull();
  });

  it('authenticated user WITH the required role -> renders page content, no redirect', async () => {
    mockCurrentPage = { uuid: 'admin', slug: '/admin', content: [], access: 'role:admin' };
    setAuthState({
      'auth.isAuthenticated': true,
      'auth.isLoading': false,
      'auth.roles': ['admin'],
    });

    await renderPreview();

    await waitFor(() => expect(screen.queryByTestId('page-content')).not.toBeNull());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('forbidden')).toBeNull();
  });

  it('does not redirect while auth state is still loading', async () => {
    mockCurrentPage = { uuid: 'pg1', slug: '/dashboard', content: [], access: 'authenticated' };
    setAuthState({ 'auth.isAuthenticated': false, 'auth.isLoading': true });

    await renderPreview();
    await act(async () => { await Promise.resolve(); });

    // reason === 'loading' -> guard returns null, must NOT navigate anywhere.
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('forbidden')).toBeNull();
  });

  it('no app-level guard runs when the app has no security config', async () => {
    mockAppConfig = {
      uuid: 'cfg-uuid',
      frontend: { layout: 'header' },
      // no `security`
    };
    mockCurrentPage = { uuid: 'pg1', slug: '/dashboard', content: [], access: 'authenticated' };
    setAuthState({ 'auth.isAuthenticated': false, 'auth.isLoading': false });

    await renderPreview();
    await waitFor(() => expect(screen.queryByTestId('page-content')).not.toBeNull());

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('forbidden')).toBeNull();
  });
});

// =============================================================================
// Platform-auth gate (defense-in-depth, independent of app-level guard)
// =============================================================================
describe('PreviewPage — platform auth gate', () => {
  it('renders the "Authentication Required" wall when no platform token is available', async () => {
    mockGetJWTTokenAsync.mockResolvedValue(null);

    await renderPreview();

    expect(screen.getByText('Authentication Required')).toBeTruthy();
    // returnUrl on the login link is encoded from the full href (no raw scheme).
    const link = document.querySelector('a[href^="/login?returnUrl="]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toContain(encodeURIComponent(window.location.href));
  });

  it('a server-provided initialJWT is stored and skips the async token check', async () => {
    await renderPreview({ initialJWT: 'server-jwt' });

    expect(mockSetJWTTokenInStorage).toHaveBeenCalledWith('server-jwt');
    expect(mockCleanPreviewTokenFromURL).toHaveBeenCalled();
    // The async getJWTTokenAsync path is bypassed entirely.
    expect(mockGetJWTTokenAsync).not.toHaveBeenCalled();
  });
});

// =============================================================================
// MAX_REDIRECTS loop-breaker for missing-page navigation
// =============================================================================
describe('PreviewPage — missing-page redirect loop-breaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Drive the platform-auth effect to completion under fake timers.
  async function renderWithFakeTimers(props: { initialJWT?: string } = {}) {
    let utils: any;
    await act(async () => {
      utils = render(<PreviewPage {...props} />);
    });
    // initialJWT path resolves synchronously inside the effect's async IIFE.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    return utils;
  }

  it('stops navigating after MAX_REDIRECTS (2) for a persistently-missing page', async () => {
    // No security => no app-level guard interference; missing page; off the home path.
    mockAppConfig = { uuid: 'cfg', frontend: { layout: 'header' } };
    mockCurrentPage = null; // page does not resolve
    mockBasePath = '/a/preview-loopapp';
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        pathname: '/a/preview-loopapp/ghost',
        href: 'https://preview.example.com/a/preview-loopapp/ghost',
        origin: 'https://preview.example.com',
      },
    });

    // Render + advance the 300ms timer repeatedly. Each fire that actually
    // navigates increments the module-level counter for this basePath.
    for (let i = 0; i < 5; i++) {
      const utils = await renderWithFakeTimers({ initialJWT: 'jwt' });
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });
      utils.unmount();
    }

    // The module-level counter is keyed by basePath and survives remounts, so
    // navigation must be capped at MAX_REDIRECTS regardless of how many mounts.
    expect(mockNavigate.mock.calls.length).toBeLessThanOrEqual(2);
    expect(mockNavigate.mock.calls.length).toBeGreaterThan(0);
  });

  it('does not redirect when already at the home (base) path', async () => {
    mockAppConfig = { uuid: 'cfg', frontend: { layout: 'header' } };
    mockCurrentPage = null;
    mockBasePath = '/a/preview-homeapp';
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        pathname: '/a/preview-homeapp', // exactly the base path
        href: 'https://preview.example.com/a/preview-homeapp',
        origin: 'https://preview.example.com',
      },
    });

    await renderWithFakeTimers({ initialJWT: 'jwt' });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
