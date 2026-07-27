/**
 * Platform Auth Control
 *
 * Infrastructure chrome rendered by ClientLayoutRenderer for any app that has
 * per-app auth configured (`security.authProviders` present and
 * `security.enabled !== false`). It is the discoverable ENTRY POINT to the
 * platform-provided auth pages: the DefaultLoginPage at `/login` + `/signup`
 * and the LogoutHandler at `/logout`.
 *
 * Why this exists: the agent is explicitly told NOT to build login/signup forms
 * ("the platform provides auth pages automatically", auth guide rule 1), and the
 * platform DOES auto-provide those pages — but nothing ever linked to them. So an
 * auth-enabled app (e.g. a shop with per-user wishlists/orders) shipped with a
 * fully-working `/login` that no visitor could discover, and no way to sign out.
 * This control closes that gap without depending on what the agent generated.
 *
 * Placement: a fixed bottom-right overlay so it is layout-agnostic — it appears
 * for header, sidebar, and flat layouts alike, and regardless of whatever custom
 * header a code component emits. Left-side corners are ruled out because a
 * SidebarMenuLeft app fills the whole left column (its own header + footer/
 * account chip live there and would intercept clicks); the top-right corner is
 * where carts/FABs gravitate. Bottom-right is the corner clear of both. Elevated
 * z-index so it stays clickable above app content. Self-contained, no SDK
 * dependency; inherits the app theme via CSS variables from DynamicTheme (same
 * token classes the DefaultLoginPage uses).
 */

import React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAppConfig } from '@/context/AppConfigContext';
import { useAppStateStore } from '@/stores/appStateStore';

// Slugs that ARE the auth destinations — never render the control on them
// (it would point at the page you are already on). `/logout` is included so the
// control disappears while the LogoutHandler's signout RPC is in flight.
const AUTH_PAGE_SLUGS = new Set([
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/logout',
]);

function UserIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function PlatformAuthControl() {
  const navigate = useNavigate();
  // Subscribe to the router location so onAuthPage/returnUrl refresh on every
  // client-side navigation (a plain window.location read in a memo would go
  // stale — the deps never change on navigation).
  const { pathname } = useLocation();
  const { appConfig, basePath } = useAppConfig();
  const security = appConfig.security;

  // Auth state — individual primitive selectors (mirrors ClientPageRenderer;
  // avoids the "getServerSnapshot should be cached" error a new object triggers).
  const isAuthenticated = useAppStateStore((s) =>
    (s._state['auth.isAuthenticated'] as boolean) ??
    (s._state['auth'] as any)?.isAuthenticated ??
    false,
  );
  const isLoading = useAppStateStore((s) =>
    (s._state['auth.isLoading'] as boolean) ??
    (s._state['auth'] as any)?.isLoading ??
    false,
  );
  const userLabel = useAppStateStore((s) => {
    const user = (s._state['auth.user'] ?? (s._state['auth'] as any)?.user) as
      | { name?: string | null; email?: string | null }
      | null
      | undefined;
    return user ? user.name ?? user.email ?? null : null;
  });

  const authConfigured = !!(
    security &&
    security.enabled !== false &&
    Array.isArray(security.authProviders) &&
    security.authProviders.length > 0
  );
  const allowSignup = security?.allowSignup !== false;
  const loginPage = security?.loginPage ?? '/login';

  // Current in-app slug, derived from the reactive router pathname.
  const slug = pathname.startsWith(basePath) ? pathname.slice(basePath.length) || '/' : pathname;
  const normalizedSlug = slug.startsWith('/') ? slug : `/${slug}`;
  const onAuthPage = AUTH_PAGE_SLUGS.has(normalizedSlug) || normalizedSlug === loginPage;
  const returnUrl = pathname;

  if (!authConfigured || onAuthPage) return null;
  // Suppress until the auth_me session check resolves — avoids a flash of
  // "Sign in" for a user who turns out to be logged in.
  if (isLoading) return null;

  const encodedReturn = encodeURIComponent(returnUrl);
  const goLogin = () => navigate(`${basePath}${loginPage}?returnUrl=${encodedReturn}`);
  const goSignup = () => navigate(`${basePath}/signup?returnUrl=${encodedReturn}`);
  const goLogout = () => navigate(`${basePath}/logout`);

  const chip =
    'rounded-md border border-border bg-background/80 px-3 py-1.5 text-sm font-medium ' +
    'text-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent ' +
    'focus:outline-hidden focus:ring-2 focus:ring-ring';

  return (
    <nav
      aria-label="Account"
      className="exepad-auth-control fixed bottom-4 right-4 z-50 flex items-center gap-2"
    >
      {isAuthenticated ? (
        <>
          {userLabel && (
            <span
              className="flex max-w-[11rem] items-center gap-1.5 rounded-md border border-border bg-background/80 px-3 py-1.5 text-sm text-muted-foreground shadow-sm backdrop-blur"
              title={userLabel}
            >
              <UserIcon className="shrink-0" />
              <span className="truncate">{userLabel}</span>
            </span>
          )}
          <button type="button" onClick={goLogout} className={chip}>
            Log out
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={goLogin} className={chip}>
            Sign in
          </button>
          {allowSignup && (
            <button
              type="button"
              onClick={goSignup}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus:outline-hidden focus:ring-2 focus:ring-ring"
            >
              Sign up
            </button>
          )}
        </>
      )}
    </nav>
  );
}

export default PlatformAuthControl;
