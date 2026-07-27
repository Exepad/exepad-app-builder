import type { LayoutOption } from '@/app_runtime/interfaces/apps/core';

export interface LayoutConfig {
  containerClasses: string;
  description: string;
  useCase: string;
  maxWidth: string;
}

export const LAYOUT_CONFIGS: Record<LayoutOption, LayoutConfig> = {
  'boxed': {
    containerClasses: 'container mx-auto max-w-boxed px-4 sm:px-6 lg:px-8',
    maxWidth: '1200px',
    description: 'Contained layout with consistent margins',
    useCase: 'General pages, forms, dashboards'
  },
  'full-width': {
    containerClasses: 'w-full',
    maxWidth: 'none',
    description: 'Full viewport width, no container constraints',
    useCase: 'Data viz, maps, immersive imagery'
  },
  'wide': {
    containerClasses: 'container mx-auto max-w-wide px-4 sm:px-6 lg:px-8',
    maxWidth: '1600px',
    description: 'Wide layout for large screens',
    useCase: 'Large screen layouts that still need containment'
  },
  'narrow': {
    containerClasses: 'container mx-auto max-w-narrow px-4 sm:px-6 lg:px-8',
    maxWidth: '800px',
    description: 'Narrow layout for focused content',
    useCase: 'Long-form reading (articles, docs)'
  }
};

/**
 * Resolve layout with inheritance:
 * 1. Use page.layout if specified
 * 2. Fall back to app.layout if specified  
 * 3. Default to 'boxed'
 */
export function resolveLayout(
  pageLayout?: LayoutOption, 
  appLayout?: LayoutOption
): LayoutOption {
  const resolved = pageLayout || appLayout || 'boxed';
  
  // Defensive check: ensure the resolved value exists in our configs
  if (!LAYOUT_CONFIGS[resolved as LayoutOption]) {
    console.warn(`Invalid layout value: "${resolved}". Falling back to "boxed".`);
    return 'boxed';
  }
  
  return resolved as LayoutOption;
}

/**
 * Get layout container classes with inheritance
 */
export function getLayoutClasses(
  pageLayout?: LayoutOption,
  appLayout?: LayoutOption
): string {
  const resolvedLayout = resolveLayout(pageLayout, appLayout);
  
  // Double-check that the config exists
  const config = LAYOUT_CONFIGS[resolvedLayout];
  if (!config) {
    console.error(`Layout config not found for: "${resolvedLayout}". Using boxed fallback.`);
    return LAYOUT_CONFIGS['boxed'].containerClasses;
  }
  
  return config.containerClasses;
}

/**
 * Get suggested layout for app types
 */
export function getSuggestedLayout(appType: string): LayoutOption {
  const suggestions: Record<string, LayoutOption> = {
    'dashboard': 'full-width',
    'blog': 'narrow',
    'portfolio': 'wide',
    'docs': 'narrow',
    'landing': 'boxed',
    'catalog': 'wide',
    'ecommerce-catalog': 'wide'
  };
  
  return suggestions[appType] || 'boxed';
}

/**
 * Get layout configuration
 */
export function getLayoutConfig(layout: LayoutOption): LayoutConfig {
  return LAYOUT_CONFIGS[layout];
} 