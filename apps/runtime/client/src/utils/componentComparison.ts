/**
 * Component Comparison Utilities
 * Fast, epoch-based comparison to avoid expensive JSON.stringify operations
 */

import { ComponentProps } from '@/app_runtime/interfaces/components/common/core';

/**
 * Compare components array using epoch-based detection
 * Much faster than JSON.stringify comparison
 * 
 * @param prevComponents - Previous components array
 * @param nextComponents - Next components array
 * @returns true if components are equal, false otherwise
 */
export function areComponentsEqual(
  prevComponents: ComponentProps[] | undefined,
  nextComponents: ComponentProps[] | undefined
): boolean {
  // Handle undefined/null cases
  if (prevComponents === nextComponents) return true;
  if (!prevComponents || !nextComponents) return false;
  
  // Quick length check
  if (prevComponents.length !== nextComponents.length) return false;
  
  // Fast epoch-based comparison
  for (let i = 0; i < prevComponents.length; i++) {
    const prev = prevComponents[i];
    const next = nextComponents[i];
    
    // Compare UUIDs first (fastest)
    if (prev.uuid !== next.uuid) return false;
    
    // Compare lastUpdatedEpoch if available (epoch-based change detection)
    if (prev.lastUpdatedEpoch !== undefined && next.lastUpdatedEpoch !== undefined) {
      if (prev.lastUpdatedEpoch !== next.lastUpdatedEpoch) return false;
    }
    
    // Compare componentType (structural change)
    if (prev.componentType !== next.componentType) return false;
    
    // For components without epoch, do shallow prop comparison
    if (prev.lastUpdatedEpoch === undefined) {
      if (!shallowPropsEqual(prev, next)) return false;
    }
  }
  
  return true;
}

/**
 * Shallow comparison of component props
 * Faster than deep comparison, sufficient for most cases
 */
function shallowPropsEqual(prev: ComponentProps, next: ComponentProps): boolean {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  
  if (prevKeys.length !== nextKeys.length) return false;
  
  for (const key of prevKeys) {
    // Skip nested objects and arrays for shallow comparison
    const prevValue = (prev as any)[key];
    const nextValue = (next as any)[key];
    
    // Use Object.is for primitive comparison
    if (!Object.is(prevValue, nextValue)) {
      // Allow nested objects to be considered equal if they're the same reference
      if (typeof prevValue === 'object' && typeof nextValue === 'object') {
        if (prevValue === nextValue) continue;
        
        // For arrays, compare EVERY element by reference. The previous heuristic
        // only checked the first 3 elements, so a config update that replaced an
        // element at index >= 3 (e.g. a nav `items` or gallery `images` entry)
        // with the same-length array passed as "equal" and the memoized list
        // rendered stale content. Referential comparison is O(n) and cheap — the
        // expensive operation being avoided here is a deep/JSON compare, not a
        // full single-pass iteration.
        if (Array.isArray(prevValue) && Array.isArray(nextValue)) {
          if (prevValue.length !== nextValue.length) return false;
          for (let i = 0; i < prevValue.length; i++) {
            if (prevValue[i] !== nextValue[i]) return false;
          }
          continue;
        }
      }
      return false;
    }
  }
  
  return true;
}

/**
 * Compare single component for equality
 * Useful for individual component memoization
 */
export function isComponentEqual(
  prev: ComponentProps | undefined,
  next: ComponentProps | undefined
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  
  // UUID check
  if (prev.uuid !== next.uuid) return false;
  
  // Epoch check (primary change detection)
  if (prev.lastUpdatedEpoch !== undefined && next.lastUpdatedEpoch !== undefined) {
    return prev.lastUpdatedEpoch === next.lastUpdatedEpoch;
  }
  
  // Fallback to shallow comparison
  return shallowPropsEqual(prev, next);
}

/**
 * Get a hash of the components array for quick comparison
 * Combines UUIDs and epochs into a single string
 */
export function getComponentsHash(components: ComponentProps[] | undefined): string {
  if (!components || components.length === 0) return '';
  
  return components
    .map(c => `${c.uuid}:${c.lastUpdatedEpoch ?? 0}`)
    .join('|');
}

/**
 * Performance monitoring wrapper for comparison functions
 */
export function createComparisonMonitor() {
  let totalCalls = 0;
  let totalTime = 0;
  
  return {
    wrap<T extends any[], R>(
      fn: (...args: T) => R,
      name: string
    ): (...args: T) => R {
      return (...args: T): R => {
        const start = performance.now();
        const result = fn(...args);
        const end = performance.now();
        
        totalCalls++;
        totalTime += (end - start);
        
        if (totalCalls % 100 === 0) {
          console.log(`[ComparisonMonitor] ${name}: ${totalCalls} calls, avg ${(totalTime / totalCalls).toFixed(2)}ms`);
        }
        
        return result;
      };
    },
    
    getStats() {
      return {
        totalCalls,
        totalTime,
        averageTime: totalCalls > 0 ? totalTime / totalCalls : 0,
      };
    },
    
    reset() {
      totalCalls = 0;
      totalTime = 0;
    },
  };
}

