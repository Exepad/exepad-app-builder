/**
 * useLifecycle Tests
 * Tests for lifecycle management hooks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLifecycle, useTimeout, useInterval } from '@/hooks/useLifecycle';

describe('useLifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should return a LifecycleManager instance', () => {
    const { result } = renderHook(() => useLifecycle());

    expect(result.current).toBeDefined();
    expect(typeof result.current.add).toBe('function');
    expect(typeof result.current.cleanup).toBe('function');
    expect(typeof result.current.setTimeout).toBe('function');
    expect(typeof result.current.setInterval).toBe('function');
  });

  it('should use provided name', () => {
    const { result } = renderHook(() => useLifecycle({ name: 'TestComponent' }));

    const state = result.current.getState();
    expect(state.name).toBe('TestComponent');
  });

  it('should return same instance on re-render', () => {
    const { result, rerender } = renderHook(() => useLifecycle());

    const firstInstance = result.current;
    rerender();
    
    expect(result.current).toBe(firstInstance);
  });

  it('should cleanup on unmount', () => {
    const cleanupFn = vi.fn();
    const { result, unmount } = renderHook(() => useLifecycle());

    act(() => {
      result.current.add(cleanupFn);
    });

    unmount();

    expect(cleanupFn).toHaveBeenCalled();
  });

  it('should clear timeouts on unmount', () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useLifecycle());

    act(() => {
      result.current.setTimeout(callback, 5000);
    });

    unmount();

    // Advance time - callback should NOT be called because cleanup happened
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('should clear intervals on unmount', () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useLifecycle());

    act(() => {
      result.current.setInterval(callback, 1000);
    });

    // First tick
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    unmount();

    // Further ticks should not call callback
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should track cleanup count', () => {
    const { result } = renderHook(() => useLifecycle());

    const cleanup1 = vi.fn();
    const cleanup2 = vi.fn();

    act(() => {
      result.current.add(cleanup1);
      result.current.add(cleanup2);
    });

    const state = result.current.getState();
    expect(state.cleanupCount).toBeGreaterThanOrEqual(2);
  });

  describe('setTimeout', () => {
    it('should execute callback after delay', () => {
      const callback = vi.fn();
      const { result } = renderHook(() => useLifecycle());

      act(() => {
        result.current.setTimeout(callback, 1000);
      });

      expect(callback).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should allow manual clearing', () => {
      const callback = vi.fn();
      const { result } = renderHook(() => useLifecycle());

      let timerId: NodeJS.Timeout;
      act(() => {
        timerId = result.current.setTimeout(callback, 1000);
      });

      act(() => {
        result.current.clearTimeout(timerId);
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('setInterval', () => {
    it('should execute callback repeatedly', () => {
      const callback = vi.fn();
      const { result } = renderHook(() => useLifecycle());

      act(() => {
        result.current.setInterval(callback, 500);
      });

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(callback).toHaveBeenCalledTimes(3);
    });

    it('should allow manual clearing', () => {
      const callback = vi.fn();
      const { result } = renderHook(() => useLifecycle());

      let intervalId: NodeJS.Timeout;
      act(() => {
        intervalId = result.current.setInterval(callback, 500);
      });

      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(callback).toHaveBeenCalledTimes(1);

      act(() => {
        result.current.clearInterval(intervalId);
      });

      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroyed state', () => {
    it('should track destroyed state', () => {
      const { result, unmount } = renderHook(() => useLifecycle());

      expect(result.current.destroyed).toBe(false);

      unmount();

      // After unmount, the lifecycle should be destroyed
      expect(result.current.destroyed).toBe(true);
    });
  });

  describe('debug mode', () => {
    it('should log when debug is enabled', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      renderHook(() => useLifecycle({ debug: true, name: 'DebugTest' }));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[LifecycleManager:DebugTest]')
      );

      consoleSpy.mockRestore();
    });
  });
});

describe('useTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return a setTimeout function', () => {
    const { result } = renderHook(() => useTimeout());

    expect(typeof result.current).toBe('function');
  });

  it('should execute callback after delay', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useTimeout());

    act(() => {
      result.current(callback, 1000);
    });

    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should cleanup on unmount', () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useTimeout());

    act(() => {
      result.current(callback, 5000);
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(callback).not.toHaveBeenCalled();
  });
});

describe('useInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return a setInterval function', () => {
    const { result } = renderHook(() => useInterval());

    expect(typeof result.current).toBe('function');
  });

  it('should execute callback repeatedly', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useInterval());

    act(() => {
      result.current(callback, 1000);
    });

    act(() => {
      vi.advanceTimersByTime(3500);
    });

    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('should cleanup on unmount', () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useInterval());

    act(() => {
      result.current(callback, 1000);
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    unmount();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe('LifecycleManager - edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should handle multiple cleanup functions', () => {
    const cleanup1 = vi.fn();
    const cleanup2 = vi.fn();
    const cleanup3 = vi.fn();

    const { result, unmount } = renderHook(() => useLifecycle());

    act(() => {
      result.current.add(cleanup1);
      result.current.add(cleanup2);
      result.current.add(cleanup3);
    });

    unmount();

    expect(cleanup1).toHaveBeenCalled();
    expect(cleanup2).toHaveBeenCalled();
    expect(cleanup3).toHaveBeenCalled();
  });

  it('should handle removing cleanup functions', () => {
    const cleanup = vi.fn();

    const { result, unmount } = renderHook(() => useLifecycle());

    act(() => {
      result.current.add(cleanup);
      result.current.remove(cleanup);
    });

    unmount();

    expect(cleanup).not.toHaveBeenCalled();
  });

  it('should warn when adding to destroyed instance', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result, unmount } = renderHook(() => useLifecycle());

    unmount();

    act(() => {
      result.current.add(() => {});
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('destroyed instance')
    );

    warnSpy.mockRestore();
  });

  it('should handle cleanup errors gracefully', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const goodCleanup = vi.fn();
    const badCleanup = vi.fn(() => {
      throw new Error('Cleanup failed');
    });

    const { result, unmount } = renderHook(() => useLifecycle());

    act(() => {
      result.current.add(badCleanup);
      result.current.add(goodCleanup);
    });

    unmount();

    // Both cleanups should be called, even if one throws
    expect(badCleanup).toHaveBeenCalled();
    expect(goodCleanup).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('should report correct state', () => {
    const { result } = renderHook(() => useLifecycle({ name: 'StateTest' }));

    act(() => {
      result.current.add(() => {});
      result.current.setTimeout(() => {}, 1000);
      result.current.setInterval(() => {}, 1000);
    });

    const state = result.current.getState();

    expect(state.name).toBe('StateTest');
    expect(state.isDestroyed).toBe(false);
    expect(state.cleanupCount).toBeGreaterThanOrEqual(3); // at least 3 cleanups
    expect(state.timerCount).toBe(1);
    expect(state.intervalCount).toBe(1);
  });
});
