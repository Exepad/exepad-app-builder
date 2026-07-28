/**
 * App Config Context
 * Provides app configuration across all pages within a route layout
 * 
 * This context enables:
 * - Single config fetch in layout (not on every page navigation)
 * - Client-side page resolution without server roundtrips
 * - Shared config state between all pages in an app
 * 
 * ARCHITECTURE:
 * - Layout fetches config once and wraps children with this provider
 * - Page components use useAppConfig() to access config
 * - useCurrentPage() hook derives current page from pathname
 */


import { createContext, useContext, ReactNode, useMemo, useCallback } from 'react';
import { WebAppProps } from '@/app_runtime/interfaces/apps/webapp';

import { PageProps as AppPageProps } from '@/app_runtime/interfaces/apps/page';
import type { ComponentProps } from '@/app_runtime/interfaces/components/common/core';

export type RouteType = 'demo' | 'example' | 'production' | 'preview';
export type AppMode = 'preview' | 'published';

export interface AppConfigContextValue {
  /** Full app configuration */
  appConfig: WebAppProps;
  /** Base path for navigation (e.g., /demo/beauty-center, /a/my-app) */
  basePath: string;
  /** Clean app ID without prefixes */
  appId: string;
  /** App ID for API routing — includes 'preview-' prefix when in preview mode */
  apiAppId: string;
  /** Current mode: preview or published */
  mode: AppMode;
  /** Route type for conditional rendering */
  routeType: RouteType;
  /** Find a page by its slug (e.g., '/about', '/services') */
  getPageBySlug: (slug: string) => AppPageProps | undefined;
  /** Find a page by its UUID */
  getPageById: (uuid: string) => AppPageProps | undefined;
  /** Get the home/root page */
  getHomePage: () => AppPageProps | undefined;
}

const AppConfigContext = createContext<AppConfigContextValue | null>(null);

export interface AppConfigProviderProps {
  children: ReactNode;
  appConfig: WebAppProps;
  basePath: string;
  appId: string;
  mode?: AppMode;
  routeType?: RouteType;
}

// ─── Slug normalisation ────────────────────────────────────────────────────────

/**
 * Normalize slug to always start with / and not end with / (except root)
 */
function normalizeSlug(slug: string | undefined): string {
  if (!slug) return '/';
  // Trim whitespace first
  let normalized = slug.trim();
  if (normalized === '' || normalized === '/') return '/';
  normalized = normalized.startsWith('/') ? normalized : `/${normalized}`;
  // Remove trailing slash except for root
  if (normalized !== '/' && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Provider component that holds app configuration
 * Should be placed in route layouts to share config across page navigations
 */
export function AppConfigProvider({
  children,
  appConfig,
  basePath,
  appId,
  mode = 'published',
  routeType = 'production'
}: AppConfigProviderProps) {

  // Access pages from the config
  const pages = appConfig.frontend?.pages;

  // Memoize page lookup by slug
  const getPageBySlug = useCallback((slug: string): AppPageProps | undefined => {
    const normalizedSlug = normalizeSlug(slug);

    // Try exact match first
    let page = pages?.find(p => {
      const pageSlug = normalizeSlug(p.slug);
      return pageSlug === normalizedSlug;
    });

    // If no exact match and looking for root, try first page
    if (!page && normalizedSlug === '/') {
      page = pages?.[0];
    }

    // Fallback: create empty page for root when no pages exist
    // This supports layout-only configs (e.g., header/sidebar block examples)
    if (!page && normalizedSlug === '/' && (!pages || pages.length === 0)) {
      return {
        uuid: 'empty-page-fallback',
        pageType: 'WebPageProps',
        title: appConfig.name || 'Home',
        slug: '/',
        summary: '',
        shortSummary: '',
        lastUpdatedEpoch: Date.now() / 1000,
        content: []
      } as AppPageProps;
    }

    return page;
  }, [pages, appConfig.name]);

  // Memoize page lookup by UUID
  const getPageById = useCallback((uuid: string): AppPageProps | undefined => {
    return pages?.find(p => p.uuid === uuid);
  }, [pages]);

  // Memoize home page getter
  const getHomePage = useCallback((): AppPageProps | undefined => {
    // Try to find page with slug '/'
    const homePage = pages?.find(p => normalizeSlug(p.slug) === '/');
    // Fall back to first page
    const fallback = homePage || pages?.[0];
    // If no pages exist, create empty fallback for layout-only configs
    if (!fallback && (!pages || pages.length === 0)) {
      return {
        uuid: 'empty-page-fallback',
        pageType: 'WebPageProps',
        title: appConfig.name || 'Home',
        slug: '/',
        summary: '',
        shortSummary: '',
        lastUpdatedEpoch: Date.now() / 1000,
        content: []
      } as AppPageProps;
    }
    return fallback;
  }, [pages, appConfig.name]);

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo<AppConfigContextValue>(() => ({
    appConfig: appConfig,
    basePath,
    appId,
    apiAppId: mode === 'preview' ? `preview-${appId}` : appId,
    mode,
    routeType,
    getPageBySlug,
    getPageById,
    getHomePage,
  }), [appConfig, basePath, appId, mode, routeType, getPageBySlug, getPageById, getHomePage]);

  return (
    <AppConfigContext.Provider value={value}>
      {children}
    </AppConfigContext.Provider>
  );
}

/**
 * Hook to access app configuration
 * Must be used within an AppConfigProvider
 */
export function useAppConfig(): AppConfigContextValue {
  const context = useContext(AppConfigContext);
  if (!context) {
    throw new Error('useAppConfig must be used within an AppConfigProvider');
  }
  return context;
}

/**
 * Hook to check if we're inside an AppConfigProvider
 * Useful for components that need to work both with and without the provider
 */
export function useAppConfigOptional(): AppConfigContextValue | null {
  return useContext(AppConfigContext);
}

export default AppConfigProvider;

