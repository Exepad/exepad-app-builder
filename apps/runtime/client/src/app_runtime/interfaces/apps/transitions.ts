// src/interfaces/transitions.ts

/**
 * Defines the available visual effects for page navigation.
 */
export type TransitionType =
  | 'none'          // No transition effect.
  | 'fade'          // Simple fade in/out.
  | 'slide'         // Slide from right to left.
  | 'slideUp'      // Slide from bottom to top.
  | 'slideDown'    // Slide from top to bottom.
  | 'scale'         // Scale in/out with a fade.
  | 'slideFade'    // A combination of a slide up and a fade.
  | 'zoom'          // A zoom in/out effect.
  | 'flip';         // A 3D flip effect.

/**
 * Defines preset transition speed options.
 */
export type TransitionTiming = 'fast' | 'normal' | 'slow';

/**
 * Defines the global configuration for all page transitions in the application.
 * This is typically set once in the main application configuration.
 */
export interface TransitionProps {
  /**
   * Enables or disables all page transitions globally.
   * @default true
   */
  enabled: boolean;

  /**
   * The default transition effect to use for all pages.
   * This can be overridden on a per-page basis.
   * @default 'slideFade'
   */
  type: TransitionType;

  /**
   * The default speed of the transition.
   * @default 'normal'
   */
  timing: TransitionTiming;

  /**
   * The easing function to apply to the animation, controlling its acceleration curve.
   * These correspond to standard CSS/Framer Motion easing functions.
   * @default 'easeInOut'
   */
  easing?: 'ease' | 'easeIn' | 'easeOut' | 'easeInOut' | 'linear';

  /**
   * If true, animations will be disabled if the user has requested reduced motion
   * in their operating system settings.
   * @default true
   */
  respectReducedMotion?: boolean;

  /**
   * When true, prefers the native View Transitions API when available.
   * Falls back to Framer Motion for unsupported browsers.
   * @default true
   */
  preferNative?: boolean;

  /**
   * The CSS view-transition-name for the animated element.
   * Used for targeting specific elements with View Transitions API.
   * @default 'page-content'
   */
  viewTransitionName?: string;
}

/**
 * Defines the transition settings for a specific page, allowing for overrides.
 * This allows for customizing or disabling transitions for individual pages.
 */
export interface PageTransitionProps {
  /**
   * If true, transitions are disabled for this specific page,
   * ignoring the global `enabled` setting.
   */
  disabled?: boolean;

  /**
   * Overrides the default transition effect for this page.
   */
  type?: TransitionType;

  /**
   * Overrides the default transition speed for this page.
   */
  timing?: TransitionTiming;

  /**
   * Overrides the default easing function for this page.
   */
  easing?: 'ease' | 'easeIn' | 'easeOut' | 'easeInOut' | 'linear';

  /**
   * Override to use or not use the native View Transitions API for this page.
   */
  preferNative?: boolean;

  /**
   * Override the CSS view-transition-name for this specific page.
   */
  viewTransitionName?: string;
}
