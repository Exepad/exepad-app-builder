// src/interfaces/apps/webapp.ts
// WebApp root schema following the design documentation

import { LayoutOption, ThemeProps, MenuPosition, LanguageOptionProps, AppProps, MetadataProps } from './core';
import { ComponentProps } from '../components/common/core';
import { CodeComponentProps } from '../code_components/code_component';
import { TransitionProps } from './transitions';
import { WebPageProps } from './page';
import { StateSchema } from '../state';
import { RepoProps } from '../repo';
import { BackendProps, SecretProps } from '../backend';
import { OfflineProps } from '../offline';
import type { SecurityProps } from '@exepad/types';

export * from './core';

// ============================================================================
// Head Tags — external resources for Code Focus designs
// ============================================================================

/**
 * A resource to inject into the document `<head>`.
 * Supports external stylesheets, external scripts, inline styles, and inline scripts.
 * Used by Code Focus designs to load custom Tailwind configs, icon fonts, and typography.
 */
export interface HeadTagProps {
  /** Tag type to render:
   *  - 'stylesheet': renders `<link rel="stylesheet" href="src">`
   *  - 'script': renders `<script src="src">` or inline `<script>content</script>`
   *  - 'style': renders `<style>content</style>` (sanitized)
   */
  type: 'stylesheet' | 'script' | 'style';

  /** URL for external resources (`<link href>` or `<script src>`). */
  src?: string;

  /** Inline content for `<style>` or `<script>` blocks. */
  content?: string;
}

// ============================================================================
// Root Schema
// ============================================================================

/**
 * WebAppProps - Root configuration schema for Exepad web applications
 * 
 * Extends AppProps with web-specific configuration:
 * - frontend: All UI configuration (theme, pages, logic, etc.)
 * - backend: All server configuration (models, handlers, etc.)
 * - repo: Custom code registry (Tier 2 methods)
 * 
 * @example
 * {
 *   "uuid": "app-uuid",
 *   "alias": "my-crm",
 *   "version": "1.0.0",
 *   "appType": "WebAppProps",
 *   "appSecondaryType": "dataapp",
 *   "name": "My CRM",
 *   "summary": "Customer relationship management",
 *   "shortSummary": "CRM app",
 *   "lastUpdatedEpoch": 1738540800,
 *   "frontend": { "layout": "wide", "theme": {...}, "pages": [...] },
 *   "backend": { "models": [...], "handlers": [...] }
 * }
 */
export interface WebAppProps extends AppProps {

  // =========================================================================
  // FRONTEND - UI Configuration
  // =========================================================================
  
  /** Frontend config. Omit for backend-only apps. */
  frontend?: FrontendProps;

  // =========================================================================
  // BACKEND - Server Configuration
  // =========================================================================
  
  /** Backend config. Omit for frontend-only (static) apps. */
  backend?: BackendProps;

  // =========================================================================
  // REPO - Custom Code Registry (Tier 2 code files)
  // =========================================================================
  
  /**
   * Central registry for all custom code files (Tier 2).
   * All handlers, tasks, computed functions, actions, etc. reference methods by name.
   */
  repo?: RepoProps;

  // =========================================================================
  // APP-LEVEL CONCERNS
  // =========================================================================

  /** Authentication and authorization configuration. */
  security?: SecurityProps;

  /** Required secrets (API keys, tokens) stored in KV. */
  secrets?: SecretProps[];

}

// ============================================================================
// Frontend Configuration
// ============================================================================

/**
 * Configures all frontend UI and client-side behavior settings for a web application.
 */
export interface FrontendProps {
  // -------------------------------------------------------------------------
  // PRESENTATION
  // -------------------------------------------------------------------------

  /** Content width strategy: 'boxed' (centered max-width), 'wide' (larger max-width), 'narrow' (compact), or 'full-width' (edge to edge). */
  layout: LayoutOption;

  /** Primary navigation placement: 'HeaderMenuTop' for horizontal navbar, 'SidebarMenuLeft' for vertical sidebar. */
  menuPosition: MenuPosition;

  /** Theme configuration including color palettes, fonts, spacing, and border radius. */
  theme: ThemeProps;

  /** Site-wide default metadata for SEO and social sharing, overridden per-page if set. */
  metadata?: MetadataProps;

  /** List of supported languages for internationalization. At least one must have isDefault set to true. */
  languages: LanguageOptionProps[];

  /** External resources to inject into `<head>`. Used for Code Focus designs
   *  that need custom stylesheets (icon fonts, typography), scripts (Tailwind CDN),
   *  or inline config (Tailwind config). Rendered in order. */
  headTags?: HeadTagProps[];

  /** Override scroll behavior for the header. Useful when header is a
   *  CodeComponent instead of NavbarProps (which carries its own scrollBehavior). */
  headerScrollBehavior?: 'static' | 'fixed' | 'sticky' | 'hide' | 'shrink';

  /** URLs of compiled CSS files for Code Focus components.
   *  Fetched once at app init and injected into the document head. */
  cssUrls?: string[];

  // -------------------------------------------------------------------------
  // STRUCTURE
  // -------------------------------------------------------------------------
  
  /** Ordered list of pages in the application, each defining a route and content tree. */
  pages: WebPageProps[];

  /** Component trees rendered in the global header above every page. */
  header: (ComponentProps | CodeComponentProps)[];

  /** Component trees rendered in the global sidebar (only visible when menuPosition is 'SidebarMenuLeft'). */
  sidebar: (ComponentProps | CodeComponentProps)[];

  /** Component trees rendered in the global footer below every page. */
  footer: (ComponentProps | CodeComponentProps)[];

  // -------------------------------------------------------------------------
  // LOGIC - Client-side reactivity
  // -------------------------------------------------------------------------
  
  /**
   * Client-side state and logic configuration
   */
  logic?: LogicProps;

  /** Global page transition animations applied when navigating between pages. */
  transitions?: TransitionProps;

  // -------------------------------------------------------------------------
  // OFFLINE - Progressive Web App support
  // -------------------------------------------------------------------------
  
  /**
   * Offline support configuration.
   * Enables Service Worker, IndexedDB caching, and background sync.
   */
  offline?: OfflineProps;
}

/**
 * Logic configuration for client-side reactivity
 */
export interface LogicProps {
  /**
   * Reactive state variables
   * @example { "currentStep": 0, "cartItems": [], "isLoading": false }
   */
  state: StateSchema;
}
