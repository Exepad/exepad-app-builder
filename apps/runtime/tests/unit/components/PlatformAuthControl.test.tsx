/**
 * PlatformAuthControl Tests (Unit)
 *
 * The platform-injected auth affordance rendered in the app chrome
 * (ClientLayoutRenderer) for auth-enabled apps. It is the discoverable entry
 * point to the platform's own /login, /signup, /logout pages — the gap that
 * left auth-enabled apps (working /login, but nothing linking to it) with no
 * visible way to sign in / sign up / sign out.
 *
 * Seams covered:
 *  - renders Sign in / Sign up only when auth is CONFIGURED + resolved
 *  - navigates to basePath-prefixed /login, /signup (with returnUrl), /logout
 *  - authenticated → Log out (+ identity label), not Sign in
 *  - suppressed when auth not configured, disabled (enabled:false), still
 *    loading, on the auth pages themselves, and when allowSignup is false
 *
 * Harness: @testing-library/react under happy-dom, react-router mocked locally
 * (controllable useLocation pathname + an rr.navigate spy), module-level vi.mock
 * for the app-config context + the Zustand store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ── Mock react-router (controllable location + navigate) ────────────
// The component now derives its slug/returnUrl from useLocation() (reactive on
// navigation), so the test drives the pathname through the router mock rather
// than window.location.
const rr = vi.hoisted(() => ({ navigate: vi.fn(), pathname: '/a/my-app/' }));
vi.mock('react-router', () => ({
  useNavigate: () => rr.navigate,
  useLocation: () => ({ pathname: rr.pathname, search: '', hash: '', state: null, key: 'test' }),
}));

// ── Mock the app-config context ─────────────────────────────────────
let mockSecurity: any = { authProviders: [{ provider: 'email' }], allowSignup: true };
let mockBasePath = '/a/my-app';
vi.mock('@/context/AppConfigContext', () => ({
  useAppConfig: () => ({
    appConfig: { security: mockSecurity, name: 'My App' },
    basePath: mockBasePath,
    appId: 'my-app',
    apiAppId: 'my-app',
    routeType: 'production',
  }),
}));

// ── Mock the app-state store ────────────────────────────────────────
let mockState: Record<string, unknown> = {};
vi.mock('@/stores/appStateStore', () => ({
  useAppStateStore: (selector: (s: any) => unknown) => selector({ _state: mockState }),
}));

const { PlatformAuthControl } = await import('@/components/PlatformAuthControl');

// ── Helpers ─────────────────────────────────────────────────────────

function stubLocation(pathname = '/a/my-app/') {
  rr.pathname = pathname;
}

function setAuth(opts: {
  authenticated?: boolean;
  loading?: boolean;
  user?: { name?: string | null; email?: string | null } | null;
}) {
  mockState = {
    'auth.isAuthenticated': opts.authenticated ?? false,
    'auth.isLoading': opts.loading ?? false,
    'auth.user': opts.user ?? null,
  };
}

beforeEach(() => {
  mockSecurity = { authProviders: [{ provider: 'email' }], allowSignup: true };
  mockBasePath = '/a/my-app';
  setAuth({ authenticated: false, loading: false });
  stubLocation('/a/my-app/');
  rr.navigate.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ────────────────────────────────────────────────────────────────────
// Anonymous — sign in / sign up entry points
// ────────────────────────────────────────────────────────────────────

describe('PlatformAuthControl — anonymous', () => {
  it('renders Sign in + Sign up when auth is configured and resolved', () => {
    render(<PlatformAuthControl />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
  });

  it('Sign in navigates to basePath + loginPage with an encoded returnUrl', () => {
    stubLocation('/a/my-app/wishlist');
    render(<PlatformAuthControl />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(rr.navigate).toHaveBeenCalledWith(
      '/a/my-app/login?returnUrl=' + encodeURIComponent('/a/my-app/wishlist'),
    );
  });

  it('Sign up navigates to basePath + /signup with an encoded returnUrl', () => {
    stubLocation('/a/my-app/wishlist');
    render(<PlatformAuthControl />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(rr.navigate).toHaveBeenCalledWith(
      '/a/my-app/signup?returnUrl=' + encodeURIComponent('/a/my-app/wishlist'),
    );
  });

  it('honors a custom security.loginPage for the Sign in target', () => {
    mockSecurity = { authProviders: [{ provider: 'email' }], loginPage: '/enter' };
    render(<PlatformAuthControl />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(rr.navigate).toHaveBeenCalledWith(
      '/a/my-app/enter?returnUrl=' + encodeURIComponent('/a/my-app/'),
    );
  });

  it('works in domain (bare-root) mode with an empty basePath', () => {
    mockBasePath = '';
    stubLocation('/');
    render(<PlatformAuthControl />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(rr.navigate).toHaveBeenCalledWith('/login?returnUrl=' + encodeURIComponent('/'));
  });

  it('hides Sign up when security.allowSignup === false', () => {
    mockSecurity = { authProviders: [{ provider: 'email' }], allowSignup: false };
    render(<PlatformAuthControl />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign up' })).not.toBeInTheDocument();
  });

  it('reacts to route changes — no stale onAuthPage/returnUrl across navigation', () => {
    // Regression for the stale-useMemo bug: onAuthPage + returnUrl must track the
    // live route, not a value captured once at mount.
    const { rerender } = render(<PlatformAuthControl />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();

    // Navigate onto the /login page → control must suppress itself.
    stubLocation('/a/my-app/login');
    rerender(<PlatformAuthControl />);
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();

    // Navigate to a deeper page → returnUrl must reflect the NEW path.
    stubLocation('/a/my-app/cart');
    rerender(<PlatformAuthControl />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(rr.navigate).toHaveBeenCalledWith(
      '/a/my-app/login?returnUrl=' + encodeURIComponent('/a/my-app/cart'),
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// Authenticated — identity + log out
// ────────────────────────────────────────────────────────────────────

describe('PlatformAuthControl — authenticated', () => {
  it('renders Log out (+ identity label) instead of Sign in when authenticated', () => {
    setAuth({ authenticated: true, user: { name: 'Alex Doe', email: 'alex@b.com' } });
    render(<PlatformAuthControl />);
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    expect(screen.getByText('Alex Doe')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign up' })).not.toBeInTheDocument();
  });

  it('falls back to email when the user has no name', () => {
    setAuth({ authenticated: true, user: { name: null, email: 'noname@b.com' } });
    render(<PlatformAuthControl />);
    expect(screen.getByText('noname@b.com')).toBeInTheDocument();
  });

  it('Log out navigates to basePath + /logout', () => {
    setAuth({ authenticated: true, user: { email: 'a@b.com' } });
    render(<PlatformAuthControl />);
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(rr.navigate).toHaveBeenCalledWith('/a/my-app/logout');
  });
});

// ────────────────────────────────────────────────────────────────────
// Suppression — must render nothing
// ────────────────────────────────────────────────────────────────────

describe('PlatformAuthControl — suppressed states', () => {
  it('renders nothing when the app has no security config', () => {
    mockSecurity = undefined;
    const { container } = render(<PlatformAuthControl />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when auth is explicitly disabled (enabled:false), even with providers', () => {
    mockSecurity = { enabled: false, authProviders: [{ provider: 'email' }] };
    const { container } = render(<PlatformAuthControl />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there are no auth providers', () => {
    mockSecurity = { authProviders: [] };
    const { container } = render(<PlatformAuthControl />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while the auth_me session check is still loading', () => {
    setAuth({ authenticated: false, loading: true });
    const { container } = render(<PlatformAuthControl />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on the /login page itself', () => {
    stubLocation('/a/my-app/login');
    const { container } = render(<PlatformAuthControl />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on the /logout page (while signout is in flight)', () => {
    setAuth({ authenticated: true, user: { email: 'a@b.com' } });
    stubLocation('/a/my-app/logout');
    const { container } = render(<PlatformAuthControl />);
    expect(container).toBeEmptyDOMElement();
  });
});
