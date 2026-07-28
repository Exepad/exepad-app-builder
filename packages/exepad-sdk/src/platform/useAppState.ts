/**
 * useAppState — Single-value state hook.
 *
 * Bridges to window.ExepadState.useAppState(key, initialValue).
 * Returns [value, setValue, updateValue] tuple (like useState with a key).
 */

import { getExepadState } from '../helpers/stateBridge';

const noop = () => {};

export function useAppState<T = unknown>(
  key: string,
  initialValue?: T
): [T, (value: T) => void, (updater: (prev: T) => T) => void] {
  const es = getExepadState();
  if (es?.useAppState) {
    return es.useAppState(key, initialValue);
  }
  return [initialValue as T, noop, noop];
}
