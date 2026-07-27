import React from 'react';
import { useLocation } from 'react-router';
import { useAppConfig } from '@/context/AppConfigContext';
import PersistentHeader from '@/components/PersistentHeader';
import PersistentFooter from '@/components/PersistentFooter';
import { CodeFocusSidebarShell } from '@/components/CodeFocusSidebarShell';
import { PlatformAuthControl } from '@/components/PlatformAuthControl';
import { useAppStateStore } from '@/stores/appStateStore';
import { Toaster } from '@/runtime/components/ui/toaster';
import { ToastEventListener } from '@/components/ToastEventListener';
import { ExposeStateGlobal } from '@/components/ExposeStateGlobal';
import { ExposePlatformGlobal } from '@/components/ExposePlatformGlobal';
import { CodeFocusCssLoader } from '@/components/CodeFocusCssLoader';
import { useRuntimeStore } from '@/hooks/useRuntimeStore';
import { useCurrentPage } from '@/hooks/useCurrentPage';
import { installImageDimensionGuard } from '@/lib/imageDimensionGuard';

interface ClientLayoutRendererProps {
  children: React.ReactNode;
}

/**
 * Client Layout Renderer
 * Handles the application shell (Sidebar, Header, Footer) and global state.
 * This component persists across page navigations.
 *
 * The shell provides minimal structural containers — components own all
 * positioning, scroll behavior, and visual styling.
 */
export function ClientLayoutRenderer({ children }: ClientLayoutRendererProps) {
  return (
    <CodeFocusCssLoader>
      <ClientLayoutRendererInner>{children}</ClientLayoutRendererInner>
    </CodeFocusCssLoader>
  );
}

function ClientLayoutRendererInner({ children }: ClientLayoutRendererProps) {
  const { pathname } = useLocation();
  const { appConfig, basePath } = useAppConfig();

  // Access frontend config
  const frontend = appConfig.frontend;

  // Initialize the Zustand runtime store (shared state for code components)
  useRuntimeStore();

  // Auth page detection — render auth pages (login, signup, etc.) as standalone
  // full-page layouts without sidebar/header/footer when user is not authenticated.
  const security = appConfig.security;
  const isAuthenticated = useAppStateStore((s) =>
    security
      ? (s._state['auth.isAuthenticated'] as boolean) ?? (s._state['auth'] as any)?.isAuthenticated ?? false
      : false
  );
  // Per-page menuPosition override — falls back to app-level default
  // NOTE: All hooks must be called before any early returns (Rules of Hooks)
  const currentPage = useCurrentPage();

  // CLS guard: reserve aspect-ratio for unsized code-component images (agents
  // emit `<img class="w-full h-auto">` with dimensions only in the URL, which
  // otherwise reflows the page when the image loads). Scoped to the document
  // body for the lifetime of the app view; conservative + no-op for sized imgs.
  React.useEffect(() => installImageDimensionGuard(document.body), []);

  const isAuthPage = (() => {
    if (!security) return false;
    const loginPage = security.loginPage ?? '/login';
    const authPageSlugs = [loginPage, '/signup', '/forgot-password', '/reset-password'];
    // Strip basePath to get the page slug
    const pageSlug = pathname.startsWith(basePath)
      ? pathname.slice(basePath.length) || '/'
      : pathname;
    return authPageSlugs.includes(pageSlug);
  })();

  // Auth pages render as standalone full-page layouts (no shell)
  if (isAuthPage && !isAuthenticated) {
    return (
      <div>
        <div className={`app-container app-${appConfig.uuid}`}>
          {children}
        </div>
        <Toaster />
        <ToastEventListener />
        <ExposeStateGlobal />
        <ExposePlatformGlobal />
      </div>
    );
  }
  const effectiveMenuPosition = currentPage?.menuPosition ?? frontend?.menuPosition;

  // Layout configuration
  const isHeaderLayout = effectiveMenuPosition === 'HeaderMenuTop';
  const isSidebarLayout = effectiveMenuPosition === 'SidebarMenuLeft';

  // Header configuration
  const headerConfig = isHeaderLayout && frontend?.header && frontend.header.length > 0 ? {
    components: frontend.header,
  } : null;

  // Footer configuration
  const footerConfig = frontend?.footer && frontend.footer.length > 0 ? {
    components: frontend.footer
  } : null;

  // Check for CodeComponent sidebar (Code Focus mode)
  const hasCodeComponentSidebar = isSidebarLayout
    && frontend?.sidebar && frontend.sidebar.length > 0;

  // For sidebar layout with CodeComponent sidebar (Code Focus)
  if (hasCodeComponentSidebar) {
    return (
      <CodeFocusSidebarShell
        sidebar={frontend!.sidebar}
        footer={footerConfig && <PersistentFooter components={footerConfig.components} />}
        extras={
          <>
            <PlatformAuthControl />
            <Toaster />
            <ToastEventListener />
            <ExposeStateGlobal />
            <ExposePlatformGlobal />
          </>
        }
      >
        <div className={`app-container app-${appConfig.uuid}`}>
          {children}
        </div>
      </CodeFocusSidebarShell>
    );
  }

  // For header layout or no navigation: flat rendering
  return (
    <div>
      {/* Header */}
      {headerConfig && (
        <PersistentHeader components={headerConfig.components} />
      )}

      {/* Main Content Slot */}
      <div className={`app-container app-${appConfig.uuid}`}>
        {children}
      </div>

      {/* Footer */}
      {footerConfig && (
        <PersistentFooter components={footerConfig.components} />
      )}

      {/* Platform auth affordance (sign in / sign up / log out) — the
          discoverable entry point to the platform-provided auth pages, shown
          only for auth-enabled apps. */}
      <PlatformAuthControl />

      {/* Toast notifications system */}
      <Toaster />
      <ToastEventListener />

      {/* Expose state to window for CodeComponents */}
      <ExposeStateGlobal />
      <ExposePlatformGlobal />
    </div>
  );
}
