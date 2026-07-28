/**
 * useCurrentPage Hook
 * Derives the current page from pathname using the app config context
 * 
 * This hook enables client-side page resolution without server fetches:
 * - Reads current pathname from Next.js router
 * - Extracts page slug by removing basePath
 * - Looks up page in cached config via context
 */

import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { useAppConfig } from '@/context/AppConfigContext';
import { PageProps as AppPageProps } from '@/app_runtime/interfaces/apps/page';

/**
 * Hook to get the current page based on the URL pathname
 * 
 * @returns The current page from app config, or undefined if not found
 * 
 * @example
 * ```tsx
 * function MyPage() {
 *   const currentPage = useCurrentPage();
 *   if (!currentPage) return <NotFound />;
 *   return <PageContent page={currentPage} />;
 * }
 * ```
 */
export function useCurrentPage(): AppPageProps | undefined {
  const { pathname } = useLocation();
  const { basePath, getPageBySlug } = useAppConfig();
  
  return useMemo(() => {
    // Extract page slug from pathname by removing basePath
    // e.g., /demo/beauty-center/about -> /about
    // e.g., /a/preview-xyz/services -> /services
    let pageSlug = pathname;
    
    if (basePath && basePath !== '/' && pathname.startsWith(basePath)) {
      pageSlug = pathname.slice(basePath.length) || '/';
    }
    
    // Ensure slug starts with /
    if (!pageSlug.startsWith('/')) {
      pageSlug = '/' + pageSlug;
    }
    
    return getPageBySlug(pageSlug);
  }, [pathname, basePath, getPageBySlug]);
}

/**
 * Hook to get the current page slug from pathname
 * Useful when you need just the slug without looking up the page
 */
export function useCurrentPageSlug(): string {
  const { pathname } = useLocation();
  const { basePath } = useAppConfig();
  
  return useMemo(() => {
    let pageSlug = pathname;
    
    if (basePath && basePath !== '/' && pathname.startsWith(basePath)) {
      pageSlug = pathname.slice(basePath.length) || '/';
    }
    
    if (!pageSlug.startsWith('/')) {
      pageSlug = '/' + pageSlug;
    }
    
    return pageSlug;
  }, [pathname, basePath]);
}

export default useCurrentPage;

