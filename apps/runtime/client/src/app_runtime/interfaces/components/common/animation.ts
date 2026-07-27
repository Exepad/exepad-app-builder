// src/interfaces/animation.ts

/**
 * Animation Configuration System
 * 
 * Provides JSON-configurable animation support for components.
 * Follows the existing TransitionProps pattern from transitions.ts.
 */

// ═══════════════════════════════════════════════════════════════════════════
// ANIMATION PRESETS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Animation preset types that map to Framer Motion variants.
 * These match the existing TransitionType pattern from transitions.ts.
 */
export type AnimationPreset =
  | 'none'          // No animation
  | 'fadeIn'        // Simple fade in/out
  | 'slideUp'       // Slide from bottom with fade
  | 'slideDown'     // Slide from top with fade
  | 'slideLeft'     // Slide from right with fade
  | 'slideRight'    // Slide from left with fade
  | 'scale'         // Scale in/out with fade
  | 'zoom'          // Zoom in/out effect
  | 'flip';         // 3D flip effect

/**
 * Animation timing presets matching TransitionTiming.
 */
export type AnimationTiming = 'fast' | 'normal' | 'slow';

/**
 * Animation easing options.
 */
export type AnimationEasing = 
  | 'ease' 
  | 'easeIn' 
  | 'easeOut' 
  | 'easeInOut' 
  | 'linear' 
  | 'spring';

// ═══════════════════════════════════════════════════════════════════════════
// ANIMATION CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Base animation configuration for any component.
 * Can be applied to individual components via the `animation` prop.
 * 
 * @example
 * ```json
 * {
 *   "componentType": "CardProps",
 *   "animation": {
 *     "enter": "fadeIn",
 *     "timing": "normal",
 *     "whileInView": true,
 *     "once": true
 *   }
 * }
 * ```
 */
export interface AnimationProps {
  /**
   * The enter animation preset to use.
   * @default 'fadeIn'
   */
  enter?: AnimationPreset;

  /**
   * The exit animation preset to use.
   * If not specified, uses the reverse of enter animation.
   */
  exit?: AnimationPreset;

  /**
   * Animation speed preset.
   * @default 'normal'
   */
  timing?: AnimationTiming;

  /**
   * Easing function for the animation.
   * @default 'easeOut'
   */
  easing?: AnimationEasing;

  /**
   * Delay before animation starts in milliseconds.
   * @default 0
   */
  delay?: number;

  /**
   * Animate layout changes (position, size).
   * Set to true for smooth filtering/reordering animations.
   * - true: animate both position and size
   * - 'position': only animate position changes
   * - 'size': only animate size changes
   * @default false
   */
  layout?: boolean | 'position' | 'size';

  /**
   * Trigger animation when element enters viewport.
   * Useful for scroll-triggered animations.
   * @default false
   */
  whileInView?: boolean;

  /**
   * Only animate once when scrolling into view.
   * Only applies when whileInView is true.
   * @default true
   */
  once?: boolean;

  /**
   * Respect user's reduced motion preference.
   * When true, animations are disabled if user prefers reduced motion.
   * @default true
   */
  respectReducedMotion?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// LIST ANIMATION CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extended animation configuration for list containers (Grid, Flex).
 * Adds stagger support for child item animations.
 * 
 * @example
 * ```json
 * {
 *   "componentType": "GridProps",
 *   "datasetId": "products",
 *   "animation": {
 *     "enter": "fadeIn",
 *     "layout": true,
 *     "stagger": 50,
 *     "timing": "normal"
 *   }
 * }
 * ```
 */
export interface ListAnimationProps extends AnimationProps {
  /**
   * Delay between each child animation in milliseconds.
   * Creates a cascading/stagger effect.
   * @default 0
   */
  stagger?: number;

  /**
   * Whether to orchestrate child animations as a group.
   * When true, parent waits for children to complete.
   * @default false
   */
  staggerChildren?: boolean;
}
