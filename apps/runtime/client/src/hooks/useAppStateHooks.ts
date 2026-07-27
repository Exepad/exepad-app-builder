
/**
 * App State Hooks
 * Unified hooks API for state management using Zustand
 *
 * These hooks work identically for all CodeComponents.
 */

import { useCallback, useMemo, useEffect, useRef } from 'react';
import {
  useAppStateStore,
  useAppStateShallow,
} from '@/stores/appStateStore';

/** Stable empty array — avoids new [] references in selectors (breaks Object.is) */
const EMPTY_ARRAY: unknown[] = [];

/** Helper to read a possibly dot-notation key from a flat state object */
function getNestedStateValue(state: Record<string, unknown>, key: string): unknown {
  if (!key.includes('.')) return state[key];
  const parts = key.split('.');
  let value: unknown = state;
  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/**
 * Main hook for single value state access
 *
 * @example
 * ```tsx
 * function KanbanBoard() {
 *   const [dragged, setDragged] = useAppState('kanban_dragged', null);
 *   return <Board dragged={dragged} onDragStart={setDragged} />;
 * }
 * ```
 */
export function useAppState<T = unknown>(
  key: string,
  initialValue?: T
): [T, (value: T) => void, (updater: (prev: T) => T) => void] {
  // Get current value from store with dot-notation support, falling back to initialValue
  const value = useAppStateStore((state) => {
    const stateValue = getNestedStateValue(state._state, key);
    return (stateValue !== undefined ? stateValue : initialValue) as T;
  });

  // Stabilize initialValue ref so object/array literals don't re-trigger the effect
  const initialValueRef = useRef(initialValue);

  // Register initial value if key doesn't exist (for CodeComponent dynamic state)
  // Uses getState() for a non-reactive snapshot to avoid re-render loops
  useEffect(() => {
    if (initialValueRef.current !== undefined) {
      const current = useAppStateStore.getState().get(key);
      if (current === undefined) {
        useAppStateStore.getState().set(key, initialValueRef.current);
      }
    }
  }, [key]);

  // Setter function — uses getState() to avoid subscribing to entire store
  const setValue = useCallback((newValue: T) => {
    useAppStateStore.getState().set(key, newValue);
  }, [key]);

  // Updater function (for functional updates)
  const updateValue = useCallback((updater: (prev: T) => T) => {
    useAppStateStore.getState().update(key, updater);
  }, [key]);

  return [value, setValue, updateValue];
}

/**
 * Hook for array state with helper methods
 *
 * @example
 * ```tsx
 * function CartItems() {
 *   const { items, push, remove, clear } = useArrayState<CartItem>('cartItems');
 *   return (
 *     <div>
 *       {items.map((item, i) => (
 *         <CartRow key={i} item={item} onRemove={() => remove(i)} />
 *       ))}
 *       <button onClick={clear}>Clear Cart</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useArrayState<T = unknown>(key: string, initialValue?: T[]): {
  items: T[];
  push: (item: T) => void;
  remove: (predicate: ((item: T, index: number) => boolean) | number) => void;
  updateItem: (predicate: ((item: T, index: number) => boolean) | number, updates: Partial<T>) => void;
  clear: () => void;
  set: (newItems: T[]) => void;
} {
  // Get current array value with dot-notation support
  const items = useAppStateStore((state) => {
    const stateValue = getNestedStateValue(state._state, key);
    return (Array.isArray(stateValue) ? stateValue : initialValue || EMPTY_ARRAY) as T[];
  });

  // Stabilize initialValue ref so array literals don't re-trigger the effect
  const initialValueRef = useRef(initialValue);

  // Register initial value if key doesn't exist
  useEffect(() => {
    if (initialValueRef.current !== undefined) {
      const current = useAppStateStore.getState().get(key);
      if (current === undefined) {
        useAppStateStore.getState().set(key, initialValueRef.current);
      }
    }
  }, [key]);

  // Push an item
  const push = useCallback((item: T) => {
    useAppStateStore.getState().push(key, item);
  }, [key]);

  // Remove an item by predicate or index
  const remove = useCallback((predicate: ((item: T, index: number) => boolean) | number) => {
    useAppStateStore.getState().remove(key, predicate as (item: unknown, index: number) => boolean);
  }, [key]);

  // Update an item
  const updateItem = useCallback((
    predicate: ((item: T, index: number) => boolean) | number,
    updates: Partial<T>
  ) => {
    useAppStateStore.getState().updateItem(key, predicate as (item: unknown, index: number) => boolean, updates);
  }, [key]);

  // Clear array
  const clear = useCallback(() => {
    useAppStateStore.getState().clear(key);
  }, [key]);

  // Set entire array
  const set = useCallback((newItems: T[]) => {
    useAppStateStore.getState().set(key, newItems);
  }, [key]);

  return { items, push, remove, updateItem, clear, set };
}

/**
 * Hook for getting the full state object
 * Use sparingly - prefer useAppState for specific keys
 */
export function useFullState(): Record<string, unknown> {
  const state = useAppStateShallow((s) => s._state);
  return state;
}

/**
 * Hook to check if state management is initialized
 */
export function useIsInitialized(): boolean {
  const initialized = useAppStateStore((state) => state._initialized);
  return initialized;
}

/**
 * Combined hook that returns common state utilities
 */
export function useAppStateAll() {
  const store = useAppStateStore();

  return useMemo(() => ({
    // State access
    state: store._state,
    get: store.get,
    set: store.set,

    // Array helpers
    push: store.push,
    remove: store.remove,
    updateItem: store.updateItem,
    clear: store.clear,

    // Status
    isInitialized: store._initialized,
  }), [store]);
}

// Default export
export default useAppState;
