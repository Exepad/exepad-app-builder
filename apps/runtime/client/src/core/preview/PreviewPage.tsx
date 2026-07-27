/**
 * Preview Page Component (Preview-Only)
 * Full-featured rendering with edit capabilities
 * 
 * This component is used for preview/editing mode and includes:
 * - WebSocket connection for live updates
 * - Zustand store for state management
 * - Edit mode components and toolbar
 * - Debugging tools
 * - Real-time collaboration features
 * 
 * IMPORTANT: This should only be loaded in preview mode
 * 
 * NOTE: Config is now provided via AppConfigContext from the layout
 * This component no longer fetches config - it uses the cached config from context
 */

import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router';
import { useAppStateStore } from '@/stores/appStateStore';
import { ForbiddenPage } from '@/components/ForbiddenPage';
import { checkPageAccess, type AuthState } from '@/utils/authAccess';
import { DynamicRendererList } from '@/components/DynamicRenderer';
import { PageUuidTracker } from '@/components/PageUuidTracker';
import { getEditorOrigin } from '@/lib/editor-origin';
import { UnifiedErrorDisplay } from '@/app_shared/components/AppErrorDisplay';
import { HybridPageTransition } from '@/components/HybridPageTransition';
import { getLayoutClasses } from '@/utils/layoutPatterns';
import { HashScrollHandler } from '@/components/HashScrollHandler';
import { getJWTTokenAsync, setJWTTokenInStorage, cleanPreviewTokenFromURL } from '@/lib/jwt-helper';
import { logger } from '@/lib/logger';
import { useAppConfig } from '@/context/AppConfigContext';
import { useCurrentPage } from '@/hooks/useCurrentPage';
import { useDocumentMeta } from '@/hooks/useDocumentMeta';
import { useRuntimeStore } from '@/hooks/useRuntimeStore';


// Lazy load preview-only components to optimize bundle
const EditModeToolbar = lazy(() => import('@/components/editable/EditModeToolbar'));

// Module-level redirect counter — survives component re-mounts that reset useRef.
// Keyed by basePath to avoid cross-app interference in the same browser session.
const redirectCounts = new Map<string, number>();
const MAX_REDIRECTS = 2;

/**
 * PreviewPage - Full-featured rendering for editing
 * Includes WebSocket, state management, and edit tools
 * 
 * Config is now provided via AppConfigContext from the layout
 */
interface PreviewPageProps {
  initialJWT?: string;
}

export default function PreviewPage({ initialJWT }: PreviewPageProps) {
  // =========================================================================
  // Get config from context (provided by layout)
  // =========================================================================
  const { appConfig, basePath, appId, apiAppId } = useAppConfig();
  const currentPage = useCurrentPage();

  // Initialize the Zustand runtime store (shared state for code components).
  useRuntimeStore();
  // Keep document.title and meta tags in sync with the current page.
  useDocumentMeta();

  // Access frontend config
  const frontend = appConfig?.frontend;
  const security = appConfig?.security;
  const roleExpansionMap = (appConfig as any)?._roleExpansionMap as Record<string, string[]> | undefined;

  // =========================================================================
  // ALL HOOKS MUST BE AT THE TOP - React Rules of Hooks
  // =========================================================================
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  const navigate = useNavigate();

  // ── App-level auth state (for generated app's end-user access control) ──
  const EMPTY_ROLES: string[] = [];
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

  // Client-side authentication check (defense-in-depth)
  // This runs in addition to middleware protection
  useEffect(() => {
    (async () => {
      // If server-side token exchange already provided a JWT,
      // store it and skip the async auth check entirely.
      if (initialJWT) {
        logger.log('[PreviewPage] Using server-provided JWT');
        setJWTTokenInStorage(initialJWT);
        cleanPreviewTokenFromURL();
        setIsAuthenticated(true);
        setAuthChecking(false);
        return;
      }

      try {
        const token = await getJWTTokenAsync();

        if (token) {
          setIsAuthenticated(true);
        } else {
          logger.warn('[PreviewPage] ❌ No authentication token available');
          setIsAuthenticated(false);
        }
      } catch (error) {
        logger.error('[PreviewPage] Authentication check failed:', error);
        setIsAuthenticated(false);
      } finally {
        setAuthChecking(false);
      }
    })();
  }, [initialJWT]);

  // Silent preview session refresh. The parent Agent editor periodically
  // mints a fresh preview token and posts it here; we fetch the runtime's
  // own /__refresh endpoint so Set-Cookie rolls __exepad_pa forward without
  // reloading the iframe. Same-origin fetch sidesteps SameSite=Lax blocking
  // that would kill a cross-origin credentialed request from the parent.
  useEffect(() => {
    if (!appId) return;
    const trustedOrigin = getEditorOrigin();
    const handler = async (event: MessageEvent) => {
      if (event.origin !== trustedOrigin) return;
      if (event.data?.type !== 'refresh_preview_token') return;
      const token = event.data?.token;
      if (typeof token !== 'string' || !token) return;
      try {
        const resp = await fetch(
          `/a/preview-${encodeURIComponent(appId)}/__refresh?pt=${encodeURIComponent(token)}`,
          { credentials: 'include', cache: 'no-store' },
        );
        if (!resp.ok) {
          logger.warn('[PreviewPage] preview session refresh rejected:', resp.status);
        }
      } catch (err) {
        logger.warn('[PreviewPage] preview session refresh failed:', err);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [appId]);

  // Handle missing page navigation - redirect to home after a brief delay.
  // Uses a module-level counter (not useRef) to survive component re-mounts
  // that would otherwise reset the guard and cause infinite redirect loops.
  useEffect(() => {
    if (appConfig && !currentPage && !authChecking) {
      const currentPath = window.location.pathname;
      if (currentPath === basePath || currentPath === basePath + '/') {
        return; // Already at home — wait for pages to hydrate
      }
      const count = redirectCounts.get(basePath) ?? 0;
      if (count >= MAX_REDIRECTS) {
        logger.warn('[PreviewPage] Max redirects reached, stopping redirect loop');
        return;
      }
      const timer = setTimeout(() => {
        if (window.location.pathname === currentPath) {
          redirectCounts.set(basePath, count + 1);
          logger.log('[PreviewPage] Page not found, redirecting to:', basePath);
          navigate(basePath, { replace: true });
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [currentPage, basePath, navigate, appConfig, authChecking]);

  // Reset redirect counter once a page resolves successfully
  useEffect(() => {
    if (currentPage) {
      redirectCounts.delete(basePath);
    }
  }, [currentPage, basePath]);

  // Track mount state for SSR safety
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // ── App-level page access guard ─────────────────────────────────────────
  // This is separate from the platform auth check above. The platform check
  // verifies the Exepad developer can view the preview. This guard enforces
  // the generated app's page-level access (e.g., access: "authenticated")
  // so end-users are redirected to the app's login page before seeing
  // protected content.
  const authGuardResult = useMemo<
    | { type: 'none' }
    | { type: 'loading' }
    | { type: 'redirect'; url: string }
    | { type: 'forbidden' }
  >(() => {
    if (!security || !authState || !isMounted || !currentPage) {
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

  // Execute app-level auth redirects in an effect (not during render)
  useEffect(() => {
    if (authGuardResult.type === 'redirect') {
      navigate(authGuardResult.url, { replace: true });
    }
  }, [authGuardResult, navigate]);

  // =========================================================================
  // CONDITIONAL RETURNS - Safe to return early after all hooks
  // =========================================================================

  // Show loading while checking authentication
  if (authChecking) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background px-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-muted-foreground/20 border-t-primary mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">Verifying authentication...</p>
        </div>
      </div>
    );
  }

  // Show auth required message if not authenticated
  if (isAuthenticated === false) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-md">
          <div className="bg-card text-card-foreground flex flex-col gap-6 rounded-2xl border-0 py-6 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.08)]">
            <div className="px-6 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <svg className="h-7 w-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-foreground">Authentication Required</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Preview mode requires authentication. Please sign in to continue.
              </p>
            </div>
            <div className="px-6">
              <a
                href={`/login?returnUrl=${encodeURIComponent(window.location.href)}`}
                className="flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
              >
                Go to Login
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // App-level auth guard renders (after platform auth passes)
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

  // Handle missing config (should not happen if layout works correctly)
  if (!appConfig) {
    return (
      <UnifiedErrorDisplay
        type="config-missing"
        appId={appId}
        appType="preview"
        homeUrl="/"
        showRetry
        onRetry={() => window.location.reload()}
      />
    );
  }

  // Handle missing page (show nothing while redirecting)
  if (!currentPage) {
    return null;
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

  // Both sidebar and header layouts share the same page content rendering.
  // EditModeProvider is now provided by AppLayout (wraps ClientLayoutRenderer),
  // so header/footer/sidebar all have edit mode context.
  return (
    <>
      <HashScrollHandler />

      <HybridPageTransition
        globalConfig={frontend?.transitions}
        pageOverride={currentPage.transitions}
      >
        <main className={`app-main flex-1 ${currentPage.classes || ''}`}>
          <div className={getLayoutClasses(currentPage.layout, frontend?.layout)}>
            {renderPageContent()}
          </div>
        </main>
      </HybridPageTransition>

      <PageUuidTracker pageUuid={currentPage.uuid} appId={appConfig.uuid} />

      <Suspense fallback={null}>
        <EditModeToolbar />
      </Suspense>
    </>
  );
}
