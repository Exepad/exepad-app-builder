/**
 * Framer Motion fallback for {@link HybridPageTransition}.
 *
 * Code-split out of HybridPageTransition so the ~118KB framer-motion runtime
 * (`framer-motion` + `motion-dom` + `motion-utils`) only loads on browsers
 * WITHOUT the native View Transitions API. Modern engines (Chrome/Edge 111+,
 * Safari 18+ — the common case, and every Lighthouse run) take the native
 * `ViewTransitionWrapper` path and never import this module, keeping
 * framer-motion off the published-page LCP/parse path entirely.
 *
 * Default-exported so it can be `React.lazy(() => import(...))`-loaded.
 */
import React from 'react';
import { useLocation } from 'react-router';
import { AnimatePresence, motion, Variants, Easing } from 'framer-motion';
import { TransitionType, TransitionTiming } from '@/app_runtime/interfaces/apps/transitions';
import { cn } from '@/lib/utils';

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
  slideFade: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
  },
  slide: {
    initial: { x: '100%' },
    animate: { x: 0 },
    exit: { x: '-100%' },
  },
  slideUp: {
    initial: { y: '100%' },
    animate: { y: 0 },
    exit: { y: '100%' },
  },
  slideDown: {
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

const mapEasing = (ease?: string): Easing => {
  switch (ease) {
    case 'ease':
    case 'ease-in-out':
    case 'easeInOut':
      return 'easeInOut';
    case 'ease-in':
    case 'easeIn':
      return 'easeIn';
    case 'ease-out':
    case 'easeOut':
      return 'easeOut';
    case 'linear':
      return 'linear';
    default:
      return 'easeInOut';
  }
};

const getDurationMs = (timing: TransitionTiming): number => {
  switch (timing) {
    case 'fast': return 150;
    case 'slow': return 500;
    case 'normal':
    default: return 300;
  }
};

export interface FramerMotionFallbackProps {
  /** The content to be transitioned */
  children: React.ReactNode;
  /** Optional CSS classes for the wrapper */
  className?: string;
  transitionType: TransitionType;
  timing: TransitionTiming;
  /** Raw easing string from config; mapped to a framer `Easing` internally. */
  easing?: string;
  shouldSkip: boolean;
}

export default function FramerMotionFallback({
  children,
  className,
  transitionType,
  timing,
  easing,
  shouldSkip,
}: FramerMotionFallbackProps) {
  const { pathname } = useLocation();
  const durationSec = getDurationMs(timing) / 1000;
  const ease = mapEasing(easing);
  const selectedVariants = shouldSkip ? transitionVariants.none : transitionVariants[transitionType];

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
        mode="wait"
        onExitComplete={() => {
          // Don't scroll to top if there's a hash in the URL (anchor navigation)
          if (typeof window !== 'undefined' && !window.location.hash) {
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
            ease,
          }}
          style={{
            perspective: '1200px',
            transformStyle: 'preserve-3d',
            willChange: 'transform, opacity',
            minWidth: 0,
            // perspective + will-change:transform create a containing block
            // for position:fixed descendants. Without an explicit min-height,
            // the wrapper collapses to 0 and fixed children (e.g. fullscreen
            // canvases) collapse with it. Force viewport height so fixed
            // children always get the full screen as their containing block.
            minHeight: '100dvh',
            zIndex: 0,
          }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
