/**
 * Client Page Renderer
 * Renders page content using cached config from AppConfigContext
 * 
 * This component enables client-side page navigation without server fetches:
 * - Uses useCurrentPage() to derive current page from pathname
 * - Renders main content based on app config
 * - Handles 404 cases gracefully
 */

import React, { useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router';
import { useAppConfig, RouteType } from '@/context/AppConfigContext';
import { useCurrentPage } from '@/hooks/useCurrentPage';
import { useDocumentMeta } from '@/hooks/useDocumentMeta';
import { useAppStateStore } from '@/stores/appStateStore';
import { DynamicRendererList } from '@/components/DynamicRenderer';
import { HybridPageTransition } from '@/components/HybridPageTransition';
import { UnifiedErrorDisplay } from '@/app_shared/components/AppErrorDisplay';
import { ForbiddenPage } from '@/components/ForbiddenPage';
import { PageUuidTracker } from '@/components/PageUuidTracker';
import { getLayoutClasses } from '@/utils/layoutPatterns';
import { checkPageAccess, type AuthState } from '@/utils/authAccess';

// Lazy-load feature-specific components to avoid loading them for apps that don't use them
const DefaultLoginPage = lazy(() => import('@/components/DefaultLoginPage').then(m => ({ default: m.DefaultLoginPage })));
const LogoutHandler = lazy(() => import('@/components/LogoutHandler').then(m => ({ default: m.LogoutHandler })));

const EMPTY_ROLES: string[] = [];

interface ClientPageRendererProps {
  /** Override route type (if not provided, uses context) */
  routeType?: RouteType;
  /** Additional class names for the main content */
  className?: string;
  /** Whether to show the PageUuidTracker (for editor integration) */
  showPageTracker?: boolean;
}

/**
 * Client-side page renderer that uses cached config from context
 * Eliminates server fetches on page navigation within an app
 */
export function ClientPageRenderer({
  routeType: routeTypeOverride,
  className = '',
  showPageTracker = true
}: ClientPageRendererProps) {
  const navigate = useNavigate();
  const { appConfig, basePath, appId, apiAppId, routeType: contextRouteType } = useAppConfig();
  const currentPage = useCurrentPage();
  const routeType = routeTypeOverride || contextRouteType;
  useDocumentMeta();
  const [isMounted, setIsMounted] = React.useState(false);

  // Access frontend config
  const frontend = appConfig.frontend;
  const security = appConfig.security;
  const roleExpansionMap = (appConfig as any)._roleExpansionMap as Record<string, string[]> | undefined;

  // Read auth state from store — individual primitive selectors avoid the
  // "getServerSnapshot should be cached" SSR error (new objects fail Object.is).
  const authIsAuthenticated = useAppStateStore((s) =>
    security
      ? (s._state['auth.isAuthenticated'] as boolean) ?? (s._state['auth'] as any)?.isAuthenticated ?? false
      : false
  );
  const authIsLoading = useAppStateStore((s) =>
    security
      ? (s._state['auth.isLoading'] as boolean) ?? (s._state['auth'] as any)?.isLoading ?? true
      : true
  );
  const authUser = useAppStateStore((s) =>
    security
      ? ((s._state['auth.user'] ?? (s._state['auth'] as any)?.user ?? null) as AuthState['user'])
      : null
  );
  const authRoles = useAppStateStore((s) =>
    security
      ? (s._state['auth.roles'] as string[]) ?? (s._state['auth'] as any)?.roles ?? EMPTY_ROLES
      : EMPTY_ROLES
  );
  const authState = useMemo<AuthState | null>(() => {
    if (!security) return null;
    return { isAuthenticated: authIsAuthenticated, isLoading: authIsLoading, user: authUser, roles: authRoles, error: null };
  }, [security, authIsAuthenticated, authIsLoading, authUser, authRoles]);

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  // Handle missing page - redirect to home after a brief delay
  // The delay prevents premature redirects during client-side navigation
  React.useEffect(() => {
    if (!currentPage) {
      const currentPath = window.location.pathname;
      // Only redirect if we're not already at the basePath
      if (currentPath !== basePath && currentPath !== basePath + '/') {
        // Don't redirect if this is an auth page that will show the platform default login
        if (security?.enabled !== false && security?.authProviders?.length) {
          const slug = currentPath.startsWith(basePath)
            ? currentPath.slice(basePath.length) || '/'
            : '/';
          const normalized = slug.startsWith('/') ? slug : `/${slug}`;
          const loginPage = security.loginPage ?? '/login';
          if (normalized === loginPage || normalized === '/signup' || normalized === '/logout') {
            return; // DefaultLoginPage / LogoutHandler will render instead
          }
        }
        const timer = setTimeout(() => {
          console.log('[ClientPageRenderer] Page not found, redirecting to:', basePath);
          navigate(basePath, { replace: true });
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [currentPage, basePath, navigate, security]);

  // ── Auth Guards (computed) ──────────────────────────────────────────────
  // Derive the auth guard decision as data, then execute redirects in useEffect.
  const authGuardResult = useMemo<
    | { type: 'none' }
    | { type: 'loading' }
    | { type: 'redirect'; url: string }
    | { type: 'forbidden' }
  >(() => {
    if (!security || !authState || !isMounted || !currentPage) {
      return { type: 'none' };
    }

    // Master kill-switch: admin toggled "Enable Authentication" off. Skip all
    // guard logic and render every page as if it were public, even if the
    // config still carries legacy authProviders / defaultAccess values.
    if (security.enabled === false) {
      return { type: 'none' };
    }

    const loginPage = security.loginPage ?? '/login';
    const currentSlug = currentPage.slug?.startsWith('/') ? currentPage.slug : `/${currentPage.slug}`;
    const authPageSlugs = new Set([loginPage, '/signup', '/forgot-password', '/reset-password']);

    // Inverse guard: redirect authenticated users away from auth pages
    if (authPageSlugs.has(currentSlug) && !authState.isLoading && authState.isAuthenticated) {
      const redirectUrl = security.redirectAfterLogin ?? '/';
      return { type: 'redirect', url: `${basePath}${redirectUrl}` };
    }

    // Main guard: check page access level
    const explicitAccess = (currentPage as any).access as string | undefined;
    const pageAccess = explicitAccess
      ?? (authPageSlugs.has(currentSlug) ? 'public' : 'authenticated');
    if (pageAccess !== 'public') {
      const accessResult = checkPageAccess(pageAccess, authState, roleExpansionMap);

      if (!accessResult.allowed) {
        if (accessResult.reason === 'loading') {
          return { type: 'loading' };
        }
        if (accessResult.reason === 'unauthenticated') {
          const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
          const returnUrl = encodeURIComponent(currentPath);
          return { type: 'redirect', url: `${basePath}${loginPage}?returnUrl=${returnUrl}` };
        }
        if (accessResult.reason === 'forbidden') {
          return { type: 'forbidden' };
        }
      }
    }

    return { type: 'none' };
  }, [security, authState, isMounted, currentPage, basePath, roleExpansionMap]);

  // Execute auth redirects in an effect (not during render)
  React.useEffect(() => {
    if (authGuardResult.type === 'redirect') {
      navigate(authGuardResult.url, { replace: true });
    }
  }, [authGuardResult, navigate]);

  // Show 404 if no page found and we're at the base path
  // Only after mount to avoid hydration mismatch (window is unavailable on server)
  if (!currentPage) {
    if (!isMounted) return null;
    const currentPath = window.location.pathname;

    // Platform default login: render when auth is configured but no custom login page exists
    if (security?.enabled !== false && security?.authProviders?.length) {
      const slug = currentPath.startsWith(basePath)
        ? currentPath.slice(basePath.length) || '/'
        : '/';
      const normalizedSlug = slug.startsWith('/') ? slug : `/${slug}`;
      const loginPage = security.loginPage ?? '/login';
      if (normalizedSlug === loginPage || normalizedSlug === '/signup') {
        return (
          <Suspense fallback={null}>
            <DefaultLoginPage
              security={security}
              basePath={basePath}
              apiAppId={apiAppId}
              appName={appConfig.name}
              initialMode={normalizedSlug === '/signup' ? 'signup' : 'login'}
            />
          </Suspense>
        );
      }
      if (normalizedSlug === '/logout') {
        return (
          <Suspense fallback={null}>
            <LogoutHandler
              basePath={basePath}
              apiAppId={apiAppId}
              loginPage={loginPage}
            />
          </Suspense>
        );
      }
    }

    // If we're at basePath but still no page, show error
    if (currentPath === basePath || currentPath === basePath + '/') {
      return (
        <UnifiedErrorDisplay
          type="config-missing"
          appId={appId}
          appType={routeType}
          homeUrl="/"
        />
      );
    }
    // Otherwise show loading while redirecting
    return null;
  }

  // Render guards: show blank during loading/redirect, or forbidden page
  if (authGuardResult.type === 'loading' || authGuardResult.type === 'redirect') {
    return null;
  }
  if (authGuardResult.type === 'forbidden') {
    return (
      <ForbiddenPage
        redirectUrl={security?.redirectAfterLogin ?? '/'}
        basePath={basePath}
      />
    );
  }

  // Render page content
  const renderPageContent = () => {
    return (
      <DynamicRendererList
        components={currentPage.content}
        pageLayout={frontend?.layout}
      />
    );
  };

  // Main content wrapper
  const MainContent = (
    <main className={`app-main flex-1 ${currentPage.classes || ''} ${className}`}>
      <div className={getLayoutClasses(currentPage.layout, frontend?.layout)}>
        {renderPageContent()}
      </div>
    </main>
  );

  // Wrap MainContent with page transitions
  const TransitionedMainContent = (
    <HybridPageTransition
      globalConfig={frontend?.transitions}
      pageOverride={currentPage.transitions}
    >
      {MainContent}
    </HybridPageTransition>
  );

  return (
    <>
      {TransitionedMainContent}

      {/* Page UUID tracker - sends page changes to parent window (editor) */}
      {showPageTracker && (
        <PageUuidTracker pageUuid={currentPage.uuid} appId={appConfig.uuid} />
      )}
    </>
  );
}

export default ClientPageRenderer;
