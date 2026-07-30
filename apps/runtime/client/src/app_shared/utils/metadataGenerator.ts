/**
 * Metadata Generator
 * Unified metadata generation for all application routes.
 * Used by the worker-side meta injector and client-side document.title updates.
 */

import { WebAppProps } from '@/interfaces/apps/webapp';
import { PageProps as AppPageProps } from '@/interfaces/apps/page';

export interface Metadata {
  title?: string;
  description?: string;
  keywords?: string | string[];
  icons?: { icon?: string };
  openGraph?: {
    title?: string;
    description?: string;
    images?: string[];
    url?: string;
    siteName?: string;
    type?: string;
  };
  robots?: {
    index?: boolean;
    follow?: boolean;
    nocache?: boolean;
    googleBot?: { index?: boolean; follow?: boolean; nocache?: boolean };
  };
  verification?: Record<string, unknown>;
  alternates?: Record<string, unknown>;
}

export type RouteType = 'example' | 'production' | 'preview' | 'demo';

export interface MetadataOptions {
  appConfig: WebAppProps | null;
  currentPage?: AppPageProps | null;
  pageSlug?: string;
  routeType: RouteType;
  appId: string;
  security?: { enabled?: boolean; defaultAccess?: string; authProviders?: any[] } | null;
}

/**
 * Generate metadata for application pages
 * Handles all route types with consistent formatting
 * Enhanced with validation and error handling
 */
export function generateAppMetadata(options: MetadataOptions): Metadata {
  const { appConfig, currentPage, pageSlug = '/', routeType, appId, security } = options;

  // Handle missing config
  if (!appConfig) {
    console.warn(`[MetadataGenerator] Config missing for app: ${appId}, route: ${routeType}`);
    return generateErrorMetadata(appId, routeType);
  }

  // Validate required fields
  if (!appConfig.uuid) {
    console.warn(`[MetadataGenerator] Config missing uuid for app: ${appId}`);
  }

  if (!appConfig.name && !appConfig.frontend?.metadata?.title) {
    console.warn(`[MetadataGenerator] Config missing name and metadata title for app: ${appId}`);
  }

  try {
    // Extract metadata from various sources with safe access
    const siteMetadata = appConfig.frontend?.metadata || {};
    const pageMetadata = currentPage?.metadata || {};

  // Determine title prefix based on route type
  const titlePrefix = getTitlePrefix(routeType);

  // Build final metadata values — format: "Page Title | App Name"
  const appName = appConfig.name || siteMetadata.title;
  const finalTitle = buildTitle(
    titlePrefix,
    appName,
    pageMetadata.title,
    currentPage?.title,
    siteMetadata.title,
  );

  const finalDescription = buildDescription(
    pageMetadata.description,
    currentPage?.summary,
    siteMetadata.description
  );

  // Build OpenGraph metadata
  const openGraph = buildOpenGraph(
    pageMetadata,
    siteMetadata,
    finalTitle,
    finalDescription,
    pageSlug,
    appConfig.name
  );

  // Determine robots settings based on route type and auth config
  const robots = getRobotsSettings(routeType, security);

  // Resolve favicon — supports inline SVG strings and URL strings
  const rawFavicon = pageMetadata.favicon || siteMetadata.favicon;
  const iconValue = resolveFaviconUrl(rawFavicon);

  const baseMetadata: Metadata = {
    title: finalTitle,
    description: finalDescription,
    keywords: pageMetadata.keywords || siteMetadata.keywords,
    icons: {
      icon: iconValue
    },
    openGraph,
    robots,
  };

  // Add optional production-only metadata if available
  if (routeType === 'production' && (siteMetadata as any).verification) {
    (baseMetadata as any).verification = (siteMetadata as any).verification;
  }

  if (routeType === 'production' && (siteMetadata as any).alternates) {
    (baseMetadata as any).alternates = (siteMetadata as any).alternates;
  }

    return baseMetadata;
  } catch (error) {
    console.error(`[MetadataGenerator] Error generating metadata for ${appId}:`, error);
    return generateErrorMetadata(appId, routeType);
  }
}

/**
 * Generate error metadata for missing configurations
 */
function generateErrorMetadata(appId: string, routeType: RouteType): Metadata {
  const prefix = getTitlePrefix(routeType);
  return {
    title: `${prefix} Error: ${appId} Not Found`,
    description: `Could not load configuration for application: ${appId}`,
    robots: {
      index: false,
      follow: false,
      nocache: true
    }
  };
}

/**
 * Get title prefix based on route type
 */
function getTitlePrefix(routeType: RouteType): string {
  switch (routeType) {
    case 'example':
      return '[Preview]';
    case 'preview':
      return '[Preview]';
    case 'demo':
      return '[Demo]';
    case 'production':
      return '';
    default:
      return '';
  }
}

/**
 * Build final title with "Page Title | App Name" format.
 *
 * @param prefix - Route-type prefix (e.g. "[Preview]")
 * @param appName - The application name (used as suffix)
 * @param titles - Page-level title candidates in priority order
 */
function buildTitle(
  prefix: string,
  appName: string | undefined,
  ...titles: (string | undefined)[]
): string {
  const pageTitle = titles.find(t => t);

  // If the page title is the same as the app name, avoid "App | App"
  const base = pageTitle && pageTitle !== appName
    ? `${pageTitle} | ${appName || 'App'}`
    : (pageTitle || appName || 'Application');

  return prefix ? `${prefix} ${base}` : base;
}

/**
 * Build description with fallbacks
 */
function buildDescription(...descriptions: (string | undefined)[]): string {
  return descriptions.find(d => d) || 'No description provided.';
}

/**
 * Build OpenGraph metadata
 */
function buildOpenGraph(
  pageMetadata: any,
  siteMetadata: any,
  title: string,
  description: string,
  pageSlug: string,
  siteName?: string
): Metadata['openGraph'] {
  const ogTitle = pageMetadata.openGraph?.title || title;
  const ogDescription = pageMetadata.openGraph?.description || description;
  const ogImage = pageMetadata.openGraph?.image || siteMetadata.openGraph?.image;
  const ogUrl = siteMetadata.openGraph?.url;

  return {
    title: ogTitle,
    description: ogDescription,
    ...(ogImage && { images: [ogImage] }),
    ...(ogUrl && { url: `${ogUrl}${pageSlug === '/' ? '' : pageSlug}` }),
    ...(siteName && { siteName }),
    type: 'website'
  };
}

/**
 * Get robots settings based on route type and security config
 * Auth-required apps are blocked from indexing to prevent crawlers
 * from seeing auth-gated content
 */
function getRobotsSettings(
  routeType: RouteType,
  security?: { enabled?: boolean; defaultAccess?: string; authProviders?: any[] } | null
): Metadata['robots'] {
  // Production routes can be indexed — unless they require authentication
  if (routeType === 'production') {
    const requiresAuth = security?.enabled !== false
      && security?.authProviders?.length
      && security.defaultAccess
      && security.defaultAccess !== 'public';

    if (requiresAuth) {
      return {
        index: false,
        follow: false,
        googleBot: {
          index: false,
          follow: false
        }
      };
    }

    return {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true
      }
    };
  }

  // All other routes should not be indexed
  return {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      nocache: true
    }
  };
}

/**
 * Resolve a favicon value to a URL string.
 * Supports: inline SVG strings and URL strings.
 */
function resolveFaviconUrl(favicon: string | undefined): string {
  if (!favicon) return '/favicon.svg';
  if (favicon.startsWith('<svg')) {
    return `data:image/svg+xml,${encodeURIComponent(favicon)}`;
  }
  return favicon || '/favicon.svg';
}

