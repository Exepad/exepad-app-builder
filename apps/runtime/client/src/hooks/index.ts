/**
 * Barrel export for custom hooks
 */

export { useIsMobile } from './useMobile';
export { useLifecycle } from './useLifecycle';

// State management hooks (from Zustand-based system)
export {
  useAppState,
  useIsInitialized as useIsStateful,
  useFullState,
} from './useAppStateHooks';
