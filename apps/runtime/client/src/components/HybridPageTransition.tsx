/**
 * Hybrid Page Transition Component
 * 
 * Provides smooth page transitions using:
 * - Native View Transitions API for modern browsers (Chrome 111+, Edge 111+, Safari 18+)
 * - Framer Motion fallback for older browsers (Firefox, older Safari/Chrome)
 * 
 * Benefits:
 * - Best-in-class performance with native API when available
 * - Wide browser compatibility with Framer Motion fallback
 * - Consistent configuration API across both methods
 * - Respects user's reduced motion preferences
 */

import React, { useRef, useEffect, useState, lazy, Suspense } from 'react';
import { useLocation } from 'react-router';
import {
  TransitionProps,
  PageTransitionProps as PageTransitionOverride,
  TransitionType,
  TransitionTiming
} from '@/app_runtime/interfaces/apps/transitions';
import { useTransitionOptional } from '@/context/TransitionContext';
import { cn } from '@/lib/utils';

/**
 * Framer Motion fallback (~118KB: framer-motion + motion-dom + motion-utils),
 * code-split + lazy so only browsers WITHOUT the native View Transitions API
 * ever fetch + parse it. Modern engines take the `ViewTransitionWrapper` path
 * below and never load this — keeping framer-motion off the published-page
 * LCP/parse path (and out of every Lighthouse run, which uses Chromium ≥111).
 */
const FramerMotionFallback = lazy(() => import('./HybridPageTransitionMotionFallback'));

// ============================================================================
// Props Interface
// ============================================================================

export interface HybridPageTransitionProps {
  /** The content to be transitioned */
  children: React.ReactNode;
  /** Optional CSS classes for the wrapper */
  className?: string;
  /** Global transition configuration (optional if using TransitionProvider) */
  globalConfig?: TransitionProps;
  /** Page-specific transition overrides */
  pageOverride?: PageTransitionOverride;
  /** View transition name for CSS targeting (default: 'page-content') */
  viewTransitionName?: string;
}

// ============================================================================
// Duration Mapping
// ============================================================================

const getDurationMs = (timing: TransitionTiming): number => {
  switch (timing) {
    case 'fast': return 150;
    case 'slow': return 500;
    case 'normal':
    default: return 300;
  }
};

// ============================================================================
// View Transitions Wrapper (Native API)
// ============================================================================

interface ViewTransitionWrapperProps {
  children: React.ReactNode;
  className?: string;
  viewTransitionName: string;
  transitionType: TransitionType;
  timing: TransitionTiming;
}

function ViewTransitionWrapper({ 
  children, 
  className,
  viewTransitionName,
  transitionType,
  timing,
}: ViewTransitionWrapperProps) {
  const { pathname } = useLocation();
  const prevPathname = useRef(pathname);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip transition on first render
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevPathname.current = pathname;
      return;
    }

    // Only trigger transition if pathname actually changed
    if (pathname === prevPathname.current) return;

    // Check if View Transitions API is available
    if (!document.startViewTransition) {
      prevPathname.current = pathname;
      return;
    }

    // Set the transition type as a data attribute for CSS targeting
    document.documentElement.dataset.transitionType = transitionType;
    document.documentElement.dataset.transitionTiming = timing;

    // The transition is triggered by Next.js when using viewTransition: true
    // We just need to update our tracking
    prevPathname.current = pathname;

    // Clean up data attributes after transition
    const cleanup = setTimeout(() => {
      delete document.documentElement.dataset.transitionType;
      delete document.documentElement.dataset.transitionTiming;
    }, getDurationMs(timing) + 100);

    return () => clearTimeout(cleanup);
  }, [pathname, transitionType, timing]);

  return (
    <div 
      className={cn(className)}
      style={{ 
        viewTransitionName,
        contain: 'layout',
        isolation: 'isolate',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {children}
    </div>
  );
}

// ============================================================================
// Static (non-animated) wrapper
// ============================================================================

/**
 * Layout box geometrically identical to FramerMotionFallback's `motion.div`
 * box, MINUS the animation. Used for the first paint and as the Suspense
 * fallback so the wrapper's geometry — height reservation (`minHeight:100dvh`)
 * and the containing block (`position/perspective`) that anchors
 * absolutely-positioned children — is the same whether or not framer-motion has
 * loaded. Without this parity, deferring framer-motion shifts layout: content
 * collapses upward and `position:absolute` hero elements jump (measured CLS
 * regression of ~0.24).
 */
function StaticTransitionBox({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(className)}
      style={{ overflow: 'hidden', position: 'relative', isolation: 'isolate' }}
    >
      <div
        style={{
          perspective: '1200px',
          transformStyle: 'preserve-3d',
          minWidth: 0,
          minHeight: '100dvh',
          zIndex: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * HybridPageTransition - Automatic View Transitions API with Framer Motion fallback
 * 
 * Usage:
 * ```tsx
 * <HybridPageTransition
 *   globalConfig={appConfig.frontend?.transitions}
 *   pageOverride={currentPage.transitions}
 * >
 *   <PageContent />
 * </HybridPageTransition>
 * ```
 */
export function HybridPageTransition({
  children,
  className,
  globalConfig: propConfig,
  pageOverride,
  viewTransitionName = 'page-content',
}: HybridPageTransitionProps) {
  // Get transition context (if available)
  const transitionContext = useTransitionOptional();
  
  // Use prop config or context config
  const globalConfig = propConfig || transitionContext.globalConfig;
  
  // Resolve configuration
  const isEnabled = globalConfig?.enabled ?? true;
  const isDisabledByPageOverride = pageOverride?.disabled === true;
  const finalEnabled = isEnabled && !isDisabledByPageOverride;

  const shouldRespectReducedMotion = globalConfig?.respectReducedMotion !== false;
  const prefersReducedMotion = transitionContext.prefersReducedMotion;

  const transitionType = pageOverride?.type || globalConfig?.type || 'slideFade';
  const timing = pageOverride?.timing || globalConfig?.timing || 'normal';
  // Raw easing string — mapped to a framer `Easing` inside the lazy fallback,
  // so this component carries no framer-motion type dependency.
  const easing = pageOverride?.easing || globalConfig?.easing;

  // Determine if transitions should be skipped
  const shouldSkip = !finalEnabled || 
    transitionType === 'none' || 
    (shouldRespectReducedMotion && prefersReducedMotion);

  // Check for View Transitions API support
  const supportsViewTransitions = transitionContext.supportsViewTransitions;

  // Defer the framer-motion fallback until the first client navigation. The
  // initial paint never transitions (nothing to animate from), so loading the
  // ~118KB framer-motion chunk then is pure waste on the LCP path. We render
  // children plain until the route first changes; that navigation mounts the
  // fallback and lazy-loads its chunk. Since `supportsViewTransitions` is
  // currently force-disabled in TransitionContext (so every browser would
  // otherwise take the framer path), this gate is what actually keeps
  // framer-motion off every initial published-page load — the LCP-critical one.
  const { pathname } = useLocation();
  const initialPathRef = useRef(pathname);
  const [hasNavigated, setHasNavigated] = useState(false);
  useEffect(() => {
    if (!hasNavigated && pathname !== initialPathRef.current) {
      setHasNavigated(true);
    }
  }, [pathname, hasNavigated]);

  // If transitions are disabled, render children directly
  if (shouldSkip) {
    return <div className={cn(className)}>{children}</div>;
  }

  // Use View Transitions API for modern browsers
  if (supportsViewTransitions) {
    return (
      <ViewTransitionWrapper
        className={className}
        viewTransitionName={viewTransitionName}
        transitionType={transitionType}
        timing={timing}
      >
        {children}
      </ViewTransitionWrapper>
    );
  }

  // Before the first navigation, render the static (non-animated) box so the
  // framer-motion chunk never loads on the initial paint / LCP window. The box
  // matches the animated wrapper's geometry, so there's no layout shift versus
  // the post-navigation animated render. (First paint has no transition.)
  if (!hasNavigated) {
    return <StaticTransitionBox className={className}>{children}</StaticTransitionBox>;
  }

  // Framer Motion path (also taken when View Transitions are disabled). The
  // chunk loads lazily on this first post-navigation render; the Suspense
  // fallback reuses the identical static box so the geometry never changes
  // while the chunk resolves.
  return (
    <Suspense fallback={<StaticTransitionBox className={className}>{children}</StaticTransitionBox>}>
      <FramerMotionFallback
        className={className}
        transitionType={transitionType}
        timing={timing}
        easing={easing}
        shouldSkip={shouldSkip}
      >
        {children}
      </FramerMotionFallback>
    </Suspense>
  );
}

export default HybridPageTransition;
