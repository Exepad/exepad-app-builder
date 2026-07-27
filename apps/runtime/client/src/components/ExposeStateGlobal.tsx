
/**
 * ExposeStateGlobal
 * Exposes state management hooks to the window object for CodeComponents
 *
 * CodeComponents can access state via:
 * - window.ExepadState.useAppState(key, initialValue)
 * - window.ExepadState.useArrayState(key)
 * - window.ExepadState.getState() - for non-hook access
 *
 * IMPORTANT: The global is set eagerly at module-load time (not inside a
 * useEffect) so that code components loaded via dynamic import() can call
 * useAppState/useAppActions during their very first render without hitting
 * the "ExepadState not available" fallback.
 */

import { useEffect } from 'react';
import {
  useAppState,
  useArrayState,
  useFullState,
  useIsInitialized,
  useAppStateAll,
} from '@/hooks/useAppStateHooks';
import { useAppStateStore, getAppStateStore, subscribeToAppState } from '@/stores/appStateStore';

/**
 * Types for the global ExepadState object
 */
export interface ExepadStateGlobal {
  // Hooks (must be used within React components)
  useAppState: typeof useAppState;
  useArrayState: typeof useArrayState;
  useFullState: typeof useFullState;
  useIsInitialized: typeof useIsInitialized;
  useAppStateAll: typeof useAppStateAll;

  // Direct store access (for non-React or imperative code)
  getState: () => Record<string, unknown>;
  set: (key: string, value: unknown) => void;
  subscribe: typeof subscribeToAppState;

  // Store instance
  store: typeof useAppStateStore;
}

// Declare global type
declare global {
  interface Window {
    ExepadState?: ExepadStateGlobal;
  }
}

// ---------------------------------------------------------------------------
// Eager initialisation — runs once when this module is first imported on the
// client.  All referenced hooks and store accessors are module-level imports
// that are already available synchronously, so there is no reason to defer
// this behind a useEffect (which fires after paint and creates a timing gap
// where code-component hooks see window.ExepadState as undefined).
// ---------------------------------------------------------------------------
function initExepadState(): void {
  if (typeof window === 'undefined') return; // SSR guard

  window.ExepadState = {
    // Hooks
    useAppState,
    useArrayState,
    useFullState,
    useIsInitialized,
    useAppStateAll,

    // Direct store access
    getState: () => getAppStateStore()._state,
    set: (key: string, value: unknown) => getAppStateStore().set(key, value),
    subscribe: subscribeToAppState,

    // Store instance for advanced usage
    store: useAppStateStore,
  };
}

// Run immediately on module load (client only).
initExepadState();

/**
 * Component that exposes state hooks to window for CodeComponents.
 * Should be rendered once at the app root level.
 *
 * The actual assignment happens eagerly at module-load time above.
 * This component only handles cleanup on unmount (e.g. when the
 * entire app shell unmounts during hot-reload or navigation away).
 */
export function ExposeStateGlobal(): null {
  useEffect(() => {
    // Re-assign in case the module-level init ran before window was ready
    initExepadState();

    return () => {
      delete window.ExepadState;
    };
  }, []);

  return null;
}

export default ExposeStateGlobal;
