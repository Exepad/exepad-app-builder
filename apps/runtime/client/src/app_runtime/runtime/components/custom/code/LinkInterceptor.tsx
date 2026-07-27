import React, { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useAppContext } from '@/context/AppContext';
import { logger } from '@/lib/logger';

interface LinkInterceptorProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Known top-level route prefixes. Paths starting with these are already
 * fully-qualified SPA routes (possibly to a different app) and must not
 * have the current basePath prepended.
 */
const ROUTE_PREFIXES = ['/example/', '/a/', '/demo/'];

/**
 * Checks if a URL is an internal path that should be intercepted and
 * rewritten with the current basePath.
 *
 * Returns false for:
 * - absolute URLs, protocols, hashes, blobs, data URIs
 * - paths that already include the current basePath
 * - paths that already target a known top-level route (cross-app navigation)
 */
function isInternalPath(href: string, basePath: string): boolean {
  if (
    !href ||
    href.startsWith('http://') ||
    href.startsWith('https://') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href.startsWith('javascript:') ||
    href.startsWith('#') ||
    href.startsWith('blob:') ||
    href.startsWith('data:')
  ) {
    return false;
  }

  if (basePath && href.startsWith(basePath)) {
    return false;
  }

  if (ROUTE_PREFIXES.some(prefix => href.startsWith(prefix))) {
    return false;
  }

  return href.startsWith('/');
}

/**
 * LinkInterceptor
 *
 * Intercepts clicks on anchor tags within CodeFocus components and rewrites
 * internal paths to include the basePath, then performs SPA navigation via
 * Next.js router. This allows LLM-generated components to use simple paths
 * like "/about" without knowing the actual base path.
 *
 * If the component's own onClick handler already called e.preventDefault()
 * (e.g. CodeFocus components that use the SDK navigate() function), the
 * interceptor bails out so it doesn't double-handle the navigation.
 *
 * Features:
 * - Skips events already handled by the component (defaultPrevented check)
 * - Automatically prepends basePath to internal links
 * - Uses Next.js router for client-side SPA navigation
 * - Respects target="_blank" for new window links
 * - Preserves hash fragments and query strings
 * - Passes through external URLs, mailto:, tel:, etc.
 *
 * Set NEXT_PUBLIC_SPA_NAVIGATION=false to force full page reloads (debug only).
 */
export const LinkInterceptor: React.FC<LinkInterceptorProps> = ({
  children,
  className
}) => {
  const { basePath } = useAppContext();
  const navigate = useNavigate();
  const forceFullReload = import.meta.env.VITE_SPA_NAVIGATION === 'false';
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // If the component already handled this event (e.g. CodeFocus components
    // that call e.preventDefault() + SDK navigate()), don't double-handle it.
    if (e.defaultPrevented) return;

    const target = (e.target as HTMLElement).closest('a');
    if (!target) return;

    const href = target.getAttribute('href');
    if (!href) return;

    if (!isInternalPath(href, basePath)) {
      return;
    }

    e.preventDefault();

    const newPath = `${basePath}${href}`;

    const shouldOpenNewWindow =
      target.target === '_blank' ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey;

    if (shouldOpenNewWindow) {
      window.open(newPath, '_blank');
      return;
    }

    if (forceFullReload) {
      window.location.href = newPath;
      logger.log(`[LinkInterceptor] Full reload: ${href} → ${newPath}`);
    } else {
      navigate(newPath);
      logger.log(`[LinkInterceptor] SPA navigation: ${href} → ${newPath}`);
    }
  }, [basePath, navigate, forceFullReload]);

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      className={className}
      style={{ display: 'contents' }}
    >
      {children}
    </div>
  );
};

export default LinkInterceptor;

