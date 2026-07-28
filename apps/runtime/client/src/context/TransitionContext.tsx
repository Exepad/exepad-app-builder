/**
 * Transition Context
 * Provides page transition configuration and browser capability detection
 * 
 * This context enables:
 * - Detection of View Transitions API support
 * - Global transition configuration from app config
 * - Reduced motion preference detection
 * - Shared transition state across components
 */


import {
  createContext,
  useContext,
  ReactNode,
  useMemo,
  useState,
  useEffect
} from 'react';
import {
  TransitionProps,
  PageTransitionProps,
  TransitionType,
  TransitionTiming
} from '@/app_runtime/interfaces/apps/transitions';

// ============================================================================
// Types
// ============================================================================

export interface TransitionContextValue {
  /** Global transition configuration from app config */
  globalConfig: TransitionProps | undefined;
  /** Whether transitions are enabled (respects global config and reduced motion) */
  isEnabled: boolean;
  /** Whether the browser supports the View Transitions API */
  supportsViewTransitions: boolean;
  /** Whether the user prefers reduced motion */
  prefersReducedMotion: boolean;
  /** Resolve effective transition type (considering page overrides) */
  getEffectiveType: (pageOverride?: PageTransitionProps) => TransitionType;
  /** Resolve effective timing (considering page overrides) */
  getEffectiveTiming: (pageOverride?: PageTransitionProps) => TransitionTiming;
  /** Get duration in milliseconds based on timing */
  getDurationMs: (timing: TransitionTiming) => number;
  /** Check if transitions should be skipped for a specific page */
  shouldSkipTransition: (pageOverride?: PageTransitionProps) => boolean;
}

// ============================================================================
// Context
// ============================================================================

const TransitionContext = createContext<TransitionContextValue | null>(null);

// ============================================================================
// Provider Props
// ============================================================================

export interface TransitionProviderProps {
  children: ReactNode;
  /** Global transition config from app configuration */
  globalConfig?: TransitionProps;
}

// ============================================================================
// Duration mapping
// ============================================================================

const TIMING_DURATION_MAP: Record<TransitionTiming, number> = {
  fast: 150,
  normal: 300,
  slow: 500,
};

// ============================================================================
// Provider Component
// ============================================================================

/**
 * TransitionProvider - Provides transition configuration and capabilities
 * Should be placed in route layouts to enable page transitions
 */
export function TransitionProvider({
  children,
  globalConfig
}: TransitionProviderProps) {
  // Detect View Transitions API support (client-side only)
  const [supportsViewTransitions, setSupportsViewTransitions] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  // Detect capabilities on mount (client-side)
  useEffect(() => {
    // Check for View Transitions API support
    // FORCE FALSE: Use Framer Motion for consistent, reliable transitions
    // The native API implementation is currently causing issues with Next.js App Router
    const hasViewTransitions = false;
    setSupportsViewTransitions(hasViewTransitions);

    // Check for reduced motion preference
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mediaQuery.matches);

      // Listen for changes to reduced motion preference
      const handleChange = (e: MediaQueryListEvent) => {
        setPrefersReducedMotion(e.matches);
      };

      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, []);

  // Calculate if transitions are enabled
  const isEnabled = useMemo(() => {
    // Check global config
    if (globalConfig?.enabled === false) return false;

    // Check reduced motion preference if configured to respect it
    if (globalConfig?.respectReducedMotion !== false && prefersReducedMotion) {
      return false;
    }

    return true;
  }, [globalConfig, prefersReducedMotion]);

  // Get effective transition type (considering page overrides)
  const getEffectiveType = useMemo(() => {
    return (pageOverride?: PageTransitionProps): TransitionType => {
      return pageOverride?.type || globalConfig?.type || 'slideFade';
    };
  }, [globalConfig]);

  // Get effective timing (considering page overrides)
  const getEffectiveTiming = useMemo(() => {
    return (pageOverride?: PageTransitionProps): TransitionTiming => {
      return pageOverride?.timing || globalConfig?.timing || 'normal';
    };
  }, [globalConfig]);

  // Get duration in milliseconds
  const getDurationMs = useMemo(() => {
    return (timing: TransitionTiming): number => {
      return TIMING_DURATION_MAP[timing] || TIMING_DURATION_MAP.normal;
    };
  }, []);

  // Check if transitions should be skipped for a specific page
  const shouldSkipTransition = useMemo(() => {
    return (pageOverride?: PageTransitionProps): boolean => {
      // Check page-level disable
      if (pageOverride?.disabled) return true;

      // Check global enable state
      if (!isEnabled) return true;

      // Check if type is 'none'
      const effectiveType = getEffectiveType(pageOverride);
      if (effectiveType === 'none') return true;

      return false;
    };
  }, [isEnabled, getEffectiveType]);

  // Memoize context value
  const value = useMemo<TransitionContextValue>(() => ({
    globalConfig,
    isEnabled,
    supportsViewTransitions,
    prefersReducedMotion,
    getEffectiveType,
    getEffectiveTiming,
    getDurationMs,
    shouldSkipTransition,
  }), [
    globalConfig,
    isEnabled,
    supportsViewTransitions,
    prefersReducedMotion,
    getEffectiveType,
    getEffectiveTiming,
    getDurationMs,
    shouldSkipTransition,
  ]);

  return (
    <TransitionContext.Provider value={value}>
      {children}
    </TransitionContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to access transition configuration and capabilities
 * Must be used within a TransitionProvider
 */
export function useTransition(): TransitionContextValue {
  const context = useContext(TransitionContext);
  if (!context) {
    throw new Error('useTransition must be used within a TransitionProvider');
  }
  return context;
}

/**
 * Hook to check if we're inside a TransitionProvider
 * Returns default values if not within a provider (graceful fallback)
 */
export function useTransitionOptional(): TransitionContextValue {
  const context = useContext(TransitionContext);

  // Return default values if no provider
  if (!context) {
    return {
      globalConfig: undefined,
      isEnabled: true,
      supportsViewTransitions: false,
      prefersReducedMotion: false,
      getEffectiveType: () => 'slideFade',
      getEffectiveTiming: () => 'normal',
      getDurationMs: (timing) => TIMING_DURATION_MAP[timing] || 300,
      shouldSkipTransition: () => false,
    };
  }

  return context;
}

export default TransitionProvider;

