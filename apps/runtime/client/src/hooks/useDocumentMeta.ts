/**
 * useDocumentMeta Hook
 * Updates document.title and meta tags when the current page changes.
 *
 * On initial page load the worker injects SSR-style meta tags into index.html.
 * After that, client-side navigation (React Router) doesn't hit the worker, so
 * the SPA must keep the document head in sync with the active page.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useAppConfig, RouteType } from '@/context/AppConfigContext';
import { useCurrentPage, useCurrentPageSlug } from '@/hooks/useCurrentPage';
import { generateAppMetadata, type RouteType as MetaRouteType } from '@/app_shared/utils/metadataGenerator';

function toMetaRouteType(rt: RouteType): MetaRouteType {
  if (rt === 'example') return 'example';
  if (rt === 'preview') return 'preview';
  if (rt === 'demo') return 'demo';
  return 'production';
}

/**
 * Keeps document.title and key <meta> tags in sync with the current page.
 * Call once inside the layout/page renderer — it reacts to route changes.
 */
export function useDocumentMeta() {
  const { pathname } = useLocation();
  const { appConfig, appId, routeType } = useAppConfig();
  const currentPage = useCurrentPage();
  const pageSlug = useCurrentPageSlug();

  // Use pathname as the primary trigger — it's a primitive string that
  // always changes on navigation, unlike object references which may
  // be referentially stable across React Router transitions.
  useEffect(() => {
    if (!appConfig?.name) return;

    const metadata = generateAppMetadata({
      appConfig,
      currentPage: currentPage ?? null,
      pageSlug,
      routeType: toMetaRouteType(routeType),
      appId,
      security: appConfig.security ?? null,
    });

    // Update document title
    if (metadata.title) {
      document.title = metadata.title;
    }

    // Update <meta name="description">
    updateMeta('description', metadata.description);

    // Update Open Graph tags
    if (metadata.openGraph) {
      updateMetaProperty('og:title', metadata.openGraph.title);
      updateMetaProperty('og:description', metadata.openGraph.description);
      updateMetaProperty('og:url', metadata.openGraph.url);
      if (metadata.openGraph.images?.[0]) {
        updateMetaProperty('og:image', metadata.openGraph.images[0]);
      }
    }
  }, [pathname, appConfig, appId, routeType]);
}

/** Upsert a <meta name="..."> tag. */
function updateMeta(name: string, content: string | undefined) {
  if (!content) return;
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}

/** Upsert a <meta property="..."> tag (Open Graph). */
function updateMetaProperty(property: string, content: string | undefined) {
  if (!content) return;
  let el = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('property', property);
    document.head.appendChild(el);
  }
  el.content = content;
}
