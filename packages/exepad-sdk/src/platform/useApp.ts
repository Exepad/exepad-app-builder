/**
 * useApp — Unified selector hook over the app's Zustand state store.
 *
 * Provides access to `frontend.logic.state` and a `setState` helper
 * in a single flat object that can be narrowed with a selector for
 * efficient re-renders.
 *
 * Uses `useSyncExternalStore` for concurrent-mode safety.
 *
 * @example
 * // Select everything (re-renders on ANY state change — use sparingly)
 * const { count, setState } = useApp();
 *
 * // Select specific values (re-renders only when selected values change)
 * const count = useApp(s => s.count);
 * const isSubmitting = useApp(s => s.isSubmitting);
 *
 * // WARNING: NEVER return an object literal from the selector.
 * // useApp(s => ({ a: s.a })) creates a new ref every render → infinite loop.
 */

import { React } from '../core';

const { useSyncExternalStore, useCallback, useRef } = React;

// ── Types ──

export interface AppState {
  /** All keys from frontend.logic.state */
  [key: string]: unknown;
  /** Set a single state key imperatively. */
  setState: (key: string, value: unknown) => void;
}

// ── Helpers ──

function getExepadState() {
  return typeof window !== 'undefined' ? window.ExepadState : undefined;
}

const noopSetState: AppState['setState'] = () => {};
const FALLBACK: AppState = { setState: noopSetState };

// Stable dispatch identity so selecting it (or the whole snapshot) does not
// change reference every render. dispatch() is a no-op escape hatch that warns.
const stableDispatch = (..._args: unknown[]) => {
  console.warn(
    '[Exepad SDK] dispatch() does not exist. ' +
    'For contact forms use fetch("/_forms/submit"). ' +
    'For CRUD use useModel(). See docs.',
  );
};

// Memoize the built snapshot by the store's state identity. The runtime store
// (Zustand) and the test stand-in both REPLACE state on set(), so getState()
// returns a new reference exactly when the state changes. Without this,
// buildSnapshot() returned a fresh object on every getSnapshot() call, so
// useSyncExternalStore could never satisfy its Object.is cache and the
// no-selector form `const { count } = useApp()` looped ("getSnapshot should be
// cached" → "Maximum update depth exceeded").
let cachedState: unknown;
let cachedSnapshot: AppState | undefined;

function buildSnapshot(es: NonNullable<ReturnType<typeof getExepadState>>): AppState {
  const state = es.getState();
  if (state !== cachedState || cachedSnapshot === undefined) {
    cachedState = state;
    cachedSnapshot = {
      ...(state as Record<string, unknown>),
      setState: es.set,
      dispatch: stableDispatch,
    };
  }
  return cachedSnapshot;
}

// Stable subscribe function for when ExepadState is not available
const noopSubscribe = () => () => {};

// ── Hook ──

export function useApp(): AppState;
export function useApp<T>(selector: (state: AppState) => T): T;
export function useApp<T = AppState>(selector?: (state: AppState) => T): T | AppState {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const subscribe = useCallback((onStoreChange: () => void) => {
    const es = getExepadState();
    if (!es?.subscribe) return noopSubscribe();
    return es.subscribe(onStoreChange);
  }, []);

  const getSnapshot = useCallback(() => {
    const es = getExepadState();
    if (!es) {
      return selectorRef.current ? selectorRef.current(FALLBACK) : FALLBACK;
    }
    const snapshot = buildSnapshot(es);
    return selectorRef.current ? selectorRef.current(snapshot) : snapshot;
  }, []);

  // Server snapshot — same as client fallback
  const getServerSnapshot = useCallback(() => {
    return selectorRef.current ? selectorRef.current(FALLBACK) : FALLBACK;
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
