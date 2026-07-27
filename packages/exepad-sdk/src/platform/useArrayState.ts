/**
 * useArrayState — Array state hook with helper methods.
 *
 * Bridges to window.ExepadState.useArrayState(key, initialValue).
 * Returns { items, push, remove, updateItem, clear, set }.
 */

import { getExepadState } from '../helpers/stateBridge';

const noop = () => {};

export interface UseArrayStateReturn<T> {
  items: T[];
  push: (item: T) => void;
  remove: (predicate: ((item: T, index: number) => boolean) | number) => void;
  updateItem: (predicate: ((item: T, index: number) => boolean) | number, updates: Partial<T>) => void;
  clear: () => void;
  set: (newItems: T[]) => void;
}

export function useArrayState<T = unknown>(
  key: string,
  initialValue?: T[]
): UseArrayStateReturn<T> {
  const es = getExepadState();
  if (es?.useArrayState) {
    return es.useArrayState(key, initialValue);
  }
  return {
    items: initialValue || [],
    push: noop,
    remove: noop,
    updateItem: noop,
    clear: noop,
    set: noop,
  };
}
