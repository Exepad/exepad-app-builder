import { useLocation } from 'react-router';
import { AnimatePresence, motion, Variants, Easing } from 'framer-motion';
import { TransitionProps, PageTransitionProps as PageTransitionOverride, TransitionType, TransitionTiming } from '@/interfaces/apps/transitions';
import { cn } from '@/lib/utils';

// --- Component-Specific Interfaces ---

/**
 * Props for the PageTransition component, which wraps page content
 * to provide animated transitions on navigation.
 */
export interface PageTransitionProps {
  /** The content of the page to be transitioned. */
  children: React.ReactNode;

  /** Optional CSS classes to apply to the transition wrapper. */
  className?: string;

  /** The global transition configuration for the application. */
  globalConfig?: TransitionProps;

  /** Page-specific overrides for the transition. */
  pageOverride?: PageTransitionOverride;

  // --- Legacy Props (for backward compatibility) ---

  /**
   * @deprecated Use `globalConfig.type` or `pageOverride.type` instead.
   */
  transitionType?: TransitionType;

  /**
   * @deprecated This prop is no longer used. Use `timing` in `globalConfig` or `pageOverride` instead.
   */
  duration?: number;
}


// --- Animation Variants ---
// Defines the animation properties for each transition type.
const transitionVariants: Record<TransitionType, Variants> = {
  none: {
    initial: { opacity: 1 },
    animate: { opacity: 1 },
    exit: { opacity: 1 },
  },
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
  'slideFade': {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -16 },
  },
  slide: {
    initial: { x: '100%' },
    animate: { x: 0 },
    exit: { x: '-100%' },
  },
  'slideUp': {
    initial: { y: '100%' },
    animate: { y: 0 },
    exit: { y: '100%' },
  },
  'slideDown': {
    initial: { y: '-100%' },
    animate: { y: 0 },
    exit: { y: '-100%' },
  },
  scale: {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
  },
  zoom: {
    initial: { opacity: 0, scale: 1.05 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 1.05 },
  },
  flip: {
    initial: { opacity: 0, rotateY: 90 },
    animate: { opacity: 1, rotateY: 0 },
    exit: { opacity: 0, rotateY: -90 },
  },
};

/**
 * A component to handle page transitions with enter and exit animations.
 * Uses Framer Motion's AnimatePresence to correctly handle component lifecycles.
 */
export function PageTransition({
  children,
  className,
  globalConfig,
  pageOverride,
  // Legacy props
  transitionType: legacyType,
}: PageTransitionProps) {
  const { pathname } = useLocation();

  // --- Configuration Resolution ---
  const isEnabled = globalConfig?.enabled ?? true;
  const isDisabledByPageOverride = pageOverride?.disabled === true;
  const finalEnabled = isEnabled && !isDisabledByPageOverride;

  const shouldRespectReducedMotion = globalConfig?.respectReducedMotion !== false;
  const prefersReducedMotion = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  const type = pageOverride?.type || globalConfig?.type || legacyType || 'slideFade';
  const timing = pageOverride?.timing || globalConfig?.timing || 'normal';

  // --- Easing Mapping ---
  // This function translates standard CSS easing names to the format Framer Motion expects.
  const mapEasing = (ease?: string): Easing => {
    switch (ease) {
      case 'ease':
      case 'ease-in-out':
        return 'easeInOut';
      case 'ease-in':
        return 'easeIn';
      case 'ease-out':
        return 'easeOut';
      case 'linear':
        return 'linear';
      default:
        return 'easeInOut'; // A safe default.
    }
  };

  const easingValue = pageOverride?.easing || globalConfig?.easing;
  const easing = mapEasing(easingValue);

  // Calculate duration based on timing settings.
  const getDuration = (timingValue: TransitionTiming) => {
    switch (timingValue) {
      case 'fast': return 150;
      case 'slow': return 500;
      case 'normal':
      default: return 300;
    }
  };

  const durationMs = getDuration(timing);
  // Framer Motion expects duration in seconds.
  const durationSec = durationMs / 1000;

  // Determine if transitions should be completely skipped.
  const shouldSkipTransition = !finalEnabled || type === 'none' || (shouldRespectReducedMotion && prefersReducedMotion);

  const selectedVariants = shouldSkipTransition ? transitionVariants.none : transitionVariants[type];

  return (
    <div
      className={cn(className)}
      style={{
        overflow: 'hidden',
        position: 'relative',
        isolation: 'isolate',
      }}
    >
      <AnimatePresence
        // 'wait' mode ensures the exiting page finishes its animation before the new one enters.
        mode="wait"
        // Scrolls the new page to the top after the transition completes, unless there's a hash anchor
        onExitComplete={() => {
          // Don't scroll to top if there's a hash in the URL (anchor navigation)
          if (!window.location.hash) {
            window.scrollTo(0, 0);
          }
        }}
      >
        {/* Keep animated route frames inside this boundary so transforms don't create transient page scrollbars. */}
        <motion.div
          key={pathname}
          variants={selectedVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{
            duration: durationSec,
            ease: easing,
          }}
          style={{
            perspective: '1200px',
            transformStyle: 'preserve-3d',
            // perspective + will-change:transform + contain:layout all create
            // a containing block for position:fixed descendants. Use min-height
            // so fixed children (fullscreen canvases, modals) always get the
            // full viewport as their containing block instead of collapsing.
            minHeight: '100dvh',
            willChange: 'transform, opacity',
            contain: 'layout',
            minWidth: 0,
            zIndex: 0,
          }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
