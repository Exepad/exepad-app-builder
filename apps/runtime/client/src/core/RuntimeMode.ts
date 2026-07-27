/**
 * Runtime Mode Detection
 * Determines whether the app is running in published or preview mode
 */

export type RuntimeMode = 'published' | 'preview';

/**
 * Get the current runtime mode based on the route
 * Preview mode is indicated by URL paths containing 'preview-' prefix
 */
export const getRuntimeMode = (): RuntimeMode => {
  // Server-side: default to published
  if (typeof window === 'undefined') {
    return 'published';
  }
  
  // Client-side: check URL path
  return window.location.pathname.includes('/preview-') ? 'preview' : 'published';
};

/**
 * Check if currently in preview mode
 */
export const isPreviewMode = (): boolean => {
  return getRuntimeMode() === 'preview';
};

/**
 * Check if currently in published mode
 */
export const isPublishedMode = (): boolean => {
  return getRuntimeMode() === 'published';
};

