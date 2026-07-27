/**
 * useLifecycle Hook
 * React hook wrapper for LifecycleManager
 */

import { useEffect, useRef } from 'react';
import { LifecycleManager } from '../utils/LifecycleManager';

interface UseLifecycleOptions {
  name?: string;
  debug?: boolean;
}

/**
 * useLifecycle
 * 
 * A React hook that provides a LifecycleManager instance with automatic cleanup.
 * Automatically cleans up all registered resources when the component unmounts.
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const lifecycle = useLifecycle({ name: 'MyComponent', debug: true });
 *   
 *   useEffect(() => {
 *     // Subscribe to WebSocket
 *     const unsubscribe = ws.subscribe('updates', handleUpdate);
 *     lifecycle.add(unsubscribe);
 *     
 *     // Set up polling
 *     lifecycle.setInterval(() => {
 *       fetchData();
 *     }, 5000);
 *     
 *     // No manual cleanup needed - handled by lifecycle manager
 *   }, []);
 *   
 *   return <div>...</div>;
 * }
 * ```
 */
export function useLifecycle(options: UseLifecycleOptions = {}): LifecycleManager {
  const lifecycleRef = useRef<LifecycleManager | null>(null);

  // Initialize lifecycle manager once
  if (!lifecycleRef.current) {
    lifecycleRef.current = new LifecycleManager(options);
  }

  // Cleanup on unmount
  useEffect(() => {
    const lifecycle = lifecycleRef.current;

    return () => {
      lifecycle?.cleanup();
    };
  }, []);

  return lifecycleRef.current;
}

/**
 * useTimeout
 * 
 * A safer setTimeout hook that automatically clears the timeout on unmount.
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const setTimeout = useTimeout();
 *   
 *   const handleClick = () => {
 *     setTimeout(() => {
 *       console.log('Delayed action');
 *     }, 1000);
 *   };
 *   
 *   return <button onClick={handleClick}>Click me</button>;
 * }
 * ```
 */
export function useTimeout() {
  const lifecycle = useLifecycle({ name: 'useTimeout' });

  return (callback: () => void, delay: number): NodeJS.Timeout => {
    return lifecycle.setTimeout(callback, delay);
  };
}

/**
 * useInterval
 * 
 * A safer setInterval hook that automatically clears the interval on unmount.
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const setInterval = useInterval();
 *   
 *   useEffect(() => {
 *     setInterval(() => {
 *       console.log('Polling...');
 *     }, 5000);
 *   }, []);
 *   
 *   return <div>...</div>;
 * }
 * ```
 */
export function useInterval() {
  const lifecycle = useLifecycle({ name: 'useInterval' });

  return (callback: () => void, delay: number): NodeJS.Timeout => {
    return lifecycle.setInterval(callback, delay);
  };
}

