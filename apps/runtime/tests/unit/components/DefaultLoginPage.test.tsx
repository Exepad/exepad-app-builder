/**
 * DefaultLoginPage Tests (Unit)
 *
 * Covers the platform default auth gate's security-relevant seams:
 *  - login / signup RPC success → full-document navigation target
 *  - verification_required (signup) + EMAIL_NOT_VERIFIED (signin) branching
 *  - returnUrl OPEN-REDIRECT guard (// and external absolute must not be used
 *    as the redirect target when basePath is a real, non-empty prefix)
 *  - error text shows a SAFE message and does not leak server internals on
 *    non-ok HTTP responses
 *  - disabled/loading state during submit
 *
 * Harness mirrors the sibling component tests: @testing-library/react render
 * under happy-dom, react-router mocked by tests/setup.ts (useNavigate →
 * mockNavigate), and module-level vi.mock for the Zustand store + a stubbed
 * global fetch / window.location.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { SecurityProps } from '@exepad/types';
import { mockNavigate } from '../../setup';

// ── Mock the app-state store ────────────────────────────────────────
// The component subscribes via useAppStateStore((s) => ...). We expose a
// controllable auth flag and run the selector against a minimal fake state.
let mockIsAuthenticated = false;
vi.mock('@/stores/appStateStore', () => ({
  useAppStateStore: (selector: (s: any) => unknown) =>
    selector({
      _state: { 'auth.isAuthenticated': mockIsAuthenticated },
    }),
}));

const { DefaultLoginPage } = await import('@/components/DefaultLoginPage');

// ── Helpers ─────────────────────────────────────────────────────────

const baseSecurity: SecurityProps = {
  authProviders: [{ provider: 'email' }],
} as SecurityProps;

function mockFetchJson(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

/** Replace window.location with a stub exposing assign/href + a search string. */
function stubLocation(search = '', origin = 'https://app.example.com') {
  const assign = vi.fn();
  const hrefSetter = vi.fn();
  const loc = {
    search,
    origin,
    pathname: '/login',
    assign,
    get href() {
      return `${origin}/login${search}`;
    },
    set href(v: string) {
      hrefSetter(v);
    },
  };
  Object.defineProperty(window, 'location', {
    value: loc,
    writable: true,
    configurable: true,
  });
  return { assign, hrefSetter };
}

function setGoogleConfigured(on: boolean) {
  let root = document.querySelector('#root') as HTMLElement | null;
  if (!root) {
    root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
  }
  if (on) root.setAttribute('data-google-configured', '1');
  else root.removeAttribute('data-google-configured');
}

function renderPage(overrides: Partial<Parameters<typeof DefaultLoginPage>[0]> = {}) {
  return render(
    <DefaultLoginPage
      security={overrides.security ?? baseSecurity}
      basePath={overrides.basePath ?? '/a/my-app'}
      apiAppId={overrides.apiAppId ?? 'my-app'}
      appName={overrides.appName}
      initialMode={overrides.initialMode}
    />,
  );
}

beforeEach(() => {
  mockIsAuthenticated = false;
  mockNavigate.mockReset();
  stubLocation('');
  setGoogleConfigured(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // remove the #root node between tests
  document.querySelector('#root')?.remove();
});

// ────────────────────────────────────────────────────────────────────
// Login / signup RPC success
// ────────────────────────────────────────────────────────────────────

describe('DefaultLoginPage — login RPC', () => {
  it('calls auth_signin and full-document navigates to redirectAfterLogin on success', async () => {
    const { assign } = stubLocation('');
    const fetchMock = mockFetchJson({ success: true, data: {} });
    vi.stubGlobal('fetch', fetchMock);

    renderPage({
      security: { authProviders: [{ provider: 'email' }], redirectAfterLogin: '/dashboard' } as SecurityProps,
    });

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(assign).toHaveBeenCalled());

    // RPC shape
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/my-app/rpc');
    expect(JSON.parse(init.body)).toMatchObject({ method: 'auth_signin', params: { email: 'a@b.com', password: 'pw' } });
    expect(init.credentials).toBe('include');

    // Navigates to basePath + redirectAfterLogin, NOT a client-side navigate()
    expect(assign).toHaveBeenCalledWith('/a/my-app/dashboard');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('defaults redirect target to basePath + "/" when redirectAfterLogin is absent', async () => {
    const { assign } = stubLocation('');
    vi.stubGlobal('fetch', mockFetchJson({ success: true, data: {} }));

    renderPage();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/a/my-app/'));
  });

  it('signup posts auth_signup with a name derived from the email local-part when name is blank', async () => {
    const { assign } = stubLocation('');
    const fetchMock = mockFetchJson({ success: true, data: {} });
    vi.stubGlobal('fetch', fetchMock);

    renderPage({ initialMode: 'signup' });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'alice@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => expect(assign).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.method).toBe('auth_signup');
    expect(body.params.name).toBe('alice');
  });
});

// ────────────────────────────────────────────────────────────────────
// Verification branching
// ────────────────────────────────────────────────────────────────────

describe('DefaultLoginPage — verification branching', () => {
  it('shows "Check your email" (no navigation) when signup returns verification_required', async () => {
    const { assign } = stubLocation('');
    vi.stubGlobal('fetch', mockFetchJson({ success: true, data: { verification_required: true } }));

    renderPage({ initialMode: 'signup' });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'v@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument());
    expect(screen.getByText('v@b.com')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows "Check your email" when signin fails with EMAIL_NOT_VERIFIED (no error banner leak)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchJson({ success: false, error: { code: 'EMAIL_NOT_VERIFIED', message: 'internal: user row 42 unverified' } }),
    );

    renderPage();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'x@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument());
    // The raw server message must not be surfaced in this state.
    expect(screen.queryByText(/internal: user row 42/)).not.toBeInTheDocument();
  });

  it('resend verification posts auth_request_verification for the pending email', async () => {
    const fetchMock = mockFetchJson({ success: true, data: { verification_required: true } });
    vi.stubGlobal('fetch', fetchMock);

    renderPage({ initialMode: 'signup' });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'r@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Resend verification email/ }));
    await waitFor(() => expect(screen.getByText(/Verification email sent/)).toBeInTheDocument());

    const last = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const body = JSON.parse(last[1].body);
    expect(body.method).toBe('auth_request_verification');
    expect(body.params.email).toBe('r@b.com');
  });
});

// ────────────────────────────────────────────────────────────────────
// returnUrl OPEN-REDIRECT guard
// ────────────────────────────────────────────────────────────────────

describe('DefaultLoginPage — returnUrl open-redirect guard', () => {
  it('uses a same-origin returnUrl that starts with basePath verbatim', async () => {
    const { assign } = stubLocation('?returnUrl=%2Fa%2Fmy-app%2Fsettings');
    vi.stubGlobal('fetch', mockFetchJson({ success: true, data: {} }));

    renderPage();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/a/my-app/settings'));
  });

  it('does NOT navigate to a protocol-relative //evil.com returnUrl (falls back to basePath)', async () => {
    const { assign } = stubLocation('?returnUrl=%2F%2Fevil.com%2Fphish');
    vi.stubGlobal('fetch', mockFetchJson({ success: true, data: {} }));

    renderPage();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(assign).toHaveBeenCalled());
    const target = assign.mock.calls[0][0] as string;
    expect(target).not.toContain('evil.com');
    expect(target).toBe('/a/my-app/'); // safe fallback
  });

  it('does NOT navigate to an absolute external https returnUrl (falls back to basePath)', async () => {
    const { assign } = stubLocation('?returnUrl=https%3A%2F%2Fevil.com%2Fphish');
    vi.stubGlobal('fetch', mockFetchJson({ success: true, data: {} }));

    renderPage();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(assign).toHaveBeenCalled());
    const target = assign.mock.calls[0][0] as string;
    expect(target).not.toContain('evil.com');
    expect(target).toBe('/a/my-app/');
  });

  it('auto-redirect effect reconstructs from basePath and ignores a malicious returnUrl', async () => {
    mockIsAuthenticated = true;
    stubLocation('?returnUrl=%2F%2Fevil.com%2Fx');
    vi.stubGlobal('fetch', mockFetchJson({ success: true, data: {} }));

    renderPage();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    const [target] = mockNavigate.mock.calls[0];
    expect(String(target)).not.toContain('evil.com');
    expect(String(target).startsWith('/a/my-app')).toBe(true);
  });

  // Regression: returnUrl is sanitized at read time to a same-origin root path,
  // so even with an empty basePath a protocol-relative or external-absolute
  // returnUrl is rejected and never reaches window.location.assign — the login
  // still redirects, but to the safe in-app fallback, never off-origin.
  it('SECURE: empty basePath must still block //evil.com open redirect', async () => {
    const { assign } = stubLocation('?returnUrl=%2F%2Fevil.com%2Fphish');
    vi.stubGlobal('fetch', mockFetchJson({ success: true, data: {} }));

    render(
      <DefaultLoginPage
        security={baseSecurity}
        basePath=""
        apiAppId="my-app"
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(assign).toHaveBeenCalled());
    const target = assign.mock.calls[0][0] as string;
    expect(target).not.toContain('evil.com'); // currently FAILS — open redirect
  });
});

// ────────────────────────────────────────────────────────────────────
// Error text — safe message, no leak
// ────────────────────────────────────────────────────────────────────

describe('DefaultLoginPage — error handling does not leak internals', () => {
  it('shows a generic "Service temporarily unavailable" on a non-ok HTTP response (no body leak)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'stacktrace: at db.ts:42 secret-token=abc' } }),
      }),
    );

    renderPage();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() =>
      expect(screen.getByText('Service temporarily unavailable. Please try again later.')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/stacktrace|secret-token/)).not.toBeInTheDocument();
  });

  it('shows a generic network error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED 10.0.0.1:8080')));

    renderPage();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(screen.getByText('Network error. Please try again.')).toBeInTheDocument());
    expect(screen.queryByText(/ECONNREFUSED|10\.0\.0\.1/)).not.toBeInTheDocument();
  });

  it('surfaces only the server-provided message (not codes/internal fields) on a success:false auth failure', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchJson({ success: false, error: { code: 'BAD_CREDENTIALS', message: 'Invalid email or password' } }),
    );

    renderPage();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(screen.getByText('Invalid email or password')).toBeInTheDocument());
    expect(screen.queryByText(/BAD_CREDENTIALS/)).not.toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────────────
// Loading / disabled state during submit
// ────────────────────────────────────────────────────────────────────

describe('DefaultLoginPage — loading/disabled state', () => {
  it('disables the submit button while the auth RPC is in flight, then re-enables on failure', async () => {
    let resolveFetch!: (v: any) => void;
    const pending = new Promise((res) => (resolveFetch = res));
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending));

    renderPage();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });

    const submit = screen.getByRole('button', { name: 'Sign In' });
    fireEvent.click(submit);

    // In flight → disabled
    await waitFor(() => expect(submit).toBeDisabled());

    // Resolve with an auth failure → button re-enables (finally { setLoading(false) })
    resolveFetch({ ok: true, status: 200, json: async () => ({ success: false, error: { message: 'nope' } }) });
    await waitFor(() => expect(submit).not.toBeDisabled());
  });
});

// ────────────────────────────────────────────────────────────────────
// Google OAuth seam — origin passthrough + redirect
// ────────────────────────────────────────────────────────────────────

describe('DefaultLoginPage — Google OAuth', () => {
  it('hides the Google button unless data-google-configured="1" is present', () => {
    setGoogleConfigured(false);
    renderPage({ security: { authProviders: [{ provider: 'email' }, { provider: 'google' }] } as SecurityProps });
    expect(screen.queryByRole('button', { name: /Continue with Google/ })).not.toBeInTheDocument();
  });

  it('posts auth_social_login with the live window.origin and follows the returned redirect_url', async () => {
    setGoogleConfigured(true);
    const { hrefSetter } = stubLocation('', 'https://app.example.com');
    setGoogleConfigured(true);
    const fetchMock = mockFetchJson({ success: true, data: { redirect_url: 'https://accounts.google.com/o/oauth2/x' } });
    vi.stubGlobal('fetch', fetchMock);

    renderPage({ security: { authProviders: [{ provider: 'google' }] } as SecurityProps });

    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }));

    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/x'));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.method).toBe('auth_social_login');
    expect(body.params.origin).toBe('https://app.example.com');
    expect(body.params.provider).toBe('google');
  });
});

// ────────────────────────────────────────────────────────────────────
// Verify banner + legacy provider normalization (light render seams)
// ────────────────────────────────────────────────────────────────────

describe('DefaultLoginPage — config normalization & banners', () => {
  it('renders the email form for legacy bare-string authProviders shape', () => {
    renderPage({ security: { authProviders: ['email'] as any } as SecurityProps });
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
  });

  it('shows the verified banner when ?verified=1 is present', () => {
    stubLocation('?verified=1');
    renderPage();
    expect(screen.getByText(/Email verified/)).toBeInTheDocument();
  });

  it('shows the invalid-link banner when ?verify_error=invalid is present', () => {
    stubLocation('?verify_error=invalid');
    renderPage();
    expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument();
  });

  it('hides the sign-up toggle when security.allowSignup === false', () => {
    renderPage({ security: { authProviders: [{ provider: 'email' }], allowSignup: false } as SecurityProps });
    expect(screen.queryByRole('button', { name: 'Sign up' })).not.toBeInTheDocument();
  });
});
