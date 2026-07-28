/**
 * useLifecycle Hook Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Use vi.hoisted to define mocks that will be available in vi.mock factory
const { mockCleanup, mockSetTimeout, mockSetInterval, mockAdd } = vi.hoisted(() => ({
  mockCleanup: vi.fn(),
  mockSetTimeout: vi.fn().mockReturnValue(1),
  mockSetInterval: vi.fn().mockReturnValue(2),
  mockAdd: vi.fn(),
}));

// Mock LifecycleManager - class must be defined inside factory
vi.mock('@/utils/LifecycleManager', () => {
  return {
    LifecycleManager: class {
      cleanup = () => mockCleanup();
      setTimeout = (cb: Function, ms: number) => mockSetTimeout(cb, ms);
      setInterval = (cb: Function, ms: number) => mockSetInterval(cb, ms);
      add = (fn: Function) => mockAdd(fn);
      
      constructor(_options?: any) {
        // Constructor doesn't need to do anything for tests
      }
    },
  };
});

import { useLifecycle, useTimeout, useInterval } from '@/hooks/useLifecycle';

describe('useLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('useLifecycle', () => {
    it('should return lifecycle manager', () => {
      const { result } = renderHook(() => useLifecycle());
      
      expect(result.current).toBeDefined();
      expect(result.current.cleanup).toBeDefined();
      expect(result.current.setTimeout).toBeDefined();
      expect(result.current.setInterval).toBeDefined();
    });

    it('should accept name option', () => {
      const { result } = renderHook(() => useLifecycle({ name: 'TestComponent' }));
      
      expect(result.current).toBeDefined();
    });

    it('should accept debug option', () => {
      const { result } = renderHook(() => useLifecycle({ debug: true }));
      
      expect(result.current).toBeDefined();
    });

    it('should cleanup on unmount', () => {
      const { unmount } = renderHook(() => useLifecycle());
      
      unmount();
      
      expect(mockCleanup).toHaveBeenCalled();
    });

    it('should return same instance across rerenders', () => {
      const { result, rerender } = renderHook(() => useLifecycle());
      
      const firstInstance = result.current;
      
      rerender();
      
      expect(result.current).toBe(firstInstance);
    });
  });

  describe('useTimeout', () => {
    it('should return setTimeout function', () => {
      const { result } = renderHook(() => useTimeout());
      
      expect(typeof result.current).toBe('function');
    });

    it('should call lifecycle setTimeout', () => {
      const { result } = renderHook(() => useTimeout());
      
      const callback = vi.fn();
      result.current(callback, 1000);
      
      expect(mockSetTimeout).toHaveBeenCalledWith(callback, 1000);
    });

    it('should return timeout id', () => {
      const { result } = renderHook(() => useTimeout());
      
      const timeoutId = result.current(() => {}, 1000);
      
      expect(timeoutId).toBe(1);
    });
  });

  describe('useInterval', () => {
    it('should return setInterval function', () => {
      const { result } = renderHook(() => useInterval());
      
      expect(typeof result.current).toBe('function');
    });

    it('should call lifecycle setInterval', () => {
      const { result } = renderHook(() => useInterval());
      
      const callback = vi.fn();
      result.current(callback, 5000);
      
      expect(mockSetInterval).toHaveBeenCalledWith(callback, 5000);
    });

    it('should return interval id', () => {
      const { result } = renderHook(() => useInterval());
      
      const intervalId = result.current(() => {}, 5000);
      
      expect(intervalId).toBe(2);
    });
  });

  describe('cleanup behavior', () => {
    it('should cleanup timeout on unmount', () => {
      const { unmount } = renderHook(() => {
        const setTimeout = useTimeout();
        setTimeout(() => {}, 1000);
        return null;
      });
      
      unmount();
      
      expect(mockCleanup).toHaveBeenCalled();
    });

    it('should cleanup interval on unmount', () => {
      const { unmount } = renderHook(() => {
        const setInterval = useInterval();
        setInterval(() => {}, 5000);
        return null;
      });
      
      unmount();
      
      expect(mockCleanup).toHaveBeenCalled();
    });
  });
});
