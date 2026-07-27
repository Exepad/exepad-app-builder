/**
 * LifecycleManager Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LifecycleManager } from '@/utils/LifecycleManager';

describe('LifecycleManager', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create manager with default name', () => {
      const manager = new LifecycleManager();
      const state = manager.getState();
      
      expect(state.name).toBe('Anonymous');
      expect(state.isDestroyed).toBe(false);
    });

    it('should create manager with custom name', () => {
      const manager = new LifecycleManager({ name: 'TestComponent' });
      const state = manager.getState();
      
      expect(state.name).toBe('TestComponent');
    });

    it('should log initialization in debug mode', () => {
      new LifecycleManager({ name: 'DebugComponent', debug: true });
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[LifecycleManager:DebugComponent] Initialized'
      );
    });

    it('should not log in non-debug mode', () => {
      new LifecycleManager({ name: 'QuietComponent', debug: false });
      
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('add', () => {
    it('should add cleanup function', () => {
      const manager = new LifecycleManager();
      const cleanup = vi.fn();
      
      manager.add(cleanup);
      
      expect(manager.getState().cleanupCount).toBe(1);
    });

    it('should add multiple cleanup functions', () => {
      const manager = new LifecycleManager();
      
      manager.add(vi.fn());
      manager.add(vi.fn());
      manager.add(vi.fn());
      
      expect(manager.getState().cleanupCount).toBe(3);
    });

    it('should warn when adding to destroyed manager', () => {
      const manager = new LifecycleManager({ name: 'DestroyedManager' });
      
      manager.cleanup();
      manager.add(vi.fn());
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Attempting to add cleanup to destroyed instance')
      );
    });

    it('should log in debug mode', () => {
      const manager = new LifecycleManager({ debug: true });
      
      manager.add(vi.fn());
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Added cleanup')
      );
    });
  });

  describe('remove', () => {
    it('should remove specific cleanup function', () => {
      const manager = new LifecycleManager();
      const cleanup = vi.fn();
      
      manager.add(cleanup);
      expect(manager.getState().cleanupCount).toBe(1);
      
      manager.remove(cleanup);
      expect(manager.getState().cleanupCount).toBe(0);
    });

    it('should log removal in debug mode', () => {
      const manager = new LifecycleManager({ debug: true });
      const cleanup = vi.fn();
      
      manager.add(cleanup);
      consoleLogSpy.mockClear();
      
      manager.remove(cleanup);
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Removed cleanup')
      );
    });

    it('should not throw when removing non-existent cleanup', () => {
      const manager = new LifecycleManager();
      
      expect(() => manager.remove(vi.fn())).not.toThrow();
    });
  });

  describe('setTimeout', () => {
    it('should create managed timeout', () => {
      const manager = new LifecycleManager();
      const callback = vi.fn();
      
      manager.setTimeout(callback, 1000);
      
      expect(manager.getState().timerCount).toBe(1);
      expect(callback).not.toHaveBeenCalled();
      
      vi.advanceTimersByTime(1000);
      
      expect(callback).toHaveBeenCalled();
    });

    it('should remove timer from set after execution', () => {
      const manager = new LifecycleManager();
      
      manager.setTimeout(vi.fn(), 1000);
      
      vi.advanceTimersByTime(1000);
      
      // Timer should be removed after execution
      // Note: cleanup function is still there
      expect(manager.getState().timerCount).toBe(0);
    });

    it('should warn when called on destroyed manager', () => {
      const manager = new LifecycleManager({ name: 'TimerTest' });
      
      manager.cleanup();
      manager.setTimeout(vi.fn(), 1000);
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Attempting to set timeout on destroyed instance')
      );
    });

    it('should return timer id', () => {
      const manager = new LifecycleManager();
      
      const timerId = manager.setTimeout(vi.fn(), 1000);
      
      expect(timerId).toBeDefined();
    });
  });

  describe('setInterval', () => {
    it('should create managed interval', () => {
      const manager = new LifecycleManager();
      const callback = vi.fn();
      
      manager.setInterval(callback, 1000);
      
      expect(manager.getState().intervalCount).toBe(1);
      
      vi.advanceTimersByTime(3000);
      
      expect(callback).toHaveBeenCalledTimes(3);
    });

    it('should warn when called on destroyed manager', () => {
      const manager = new LifecycleManager({ name: 'IntervalTest' });
      
      manager.cleanup();
      manager.setInterval(vi.fn(), 1000);
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Attempting to set interval on destroyed instance')
      );
    });

    it('should return interval id', () => {
      const manager = new LifecycleManager();
      
      const intervalId = manager.setInterval(vi.fn(), 1000);
      
      expect(intervalId).toBeDefined();
    });
  });

  describe('clearTimeout', () => {
    it('should clear specific timeout', () => {
      const manager = new LifecycleManager();
      const callback = vi.fn();
      
      const timerId = manager.setTimeout(callback, 1000);
      manager.clearTimeout(timerId);
      
      vi.advanceTimersByTime(1000);
      
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('clearInterval', () => {
    it('should clear specific interval', () => {
      const manager = new LifecycleManager();
      const callback = vi.fn();
      
      const intervalId = manager.setInterval(callback, 1000);
      
      vi.advanceTimersByTime(2000);
      expect(callback).toHaveBeenCalledTimes(2);
      
      manager.clearInterval(intervalId);
      
      vi.advanceTimersByTime(2000);
      expect(callback).toHaveBeenCalledTimes(2); // No additional calls
    });
  });

  describe('cleanup', () => {
    it('should execute all cleanup functions', () => {
      const manager = new LifecycleManager();
      const cleanup1 = vi.fn();
      const cleanup2 = vi.fn();
      const cleanup3 = vi.fn();
      
      manager.add(cleanup1);
      manager.add(cleanup2);
      manager.add(cleanup3);
      
      manager.cleanup();
      
      expect(cleanup1).toHaveBeenCalled();
      expect(cleanup2).toHaveBeenCalled();
      expect(cleanup3).toHaveBeenCalled();
    });

    it('should clear all timers', () => {
      const manager = new LifecycleManager();
      const callback = vi.fn();
      
      manager.setTimeout(callback, 1000);
      manager.setTimeout(callback, 2000);
      
      manager.cleanup();
      
      vi.advanceTimersByTime(3000);
      
      expect(callback).not.toHaveBeenCalled();
    });

    it('should clear all intervals', () => {
      const manager = new LifecycleManager();
      const callback = vi.fn();
      
      manager.setInterval(callback, 1000);
      
      manager.cleanup();
      
      vi.advanceTimersByTime(5000);
      
      expect(callback).not.toHaveBeenCalled();
    });

    it('should mark manager as destroyed', () => {
      const manager = new LifecycleManager();
      
      expect(manager.destroyed).toBe(false);
      
      manager.cleanup();
      
      expect(manager.destroyed).toBe(true);
    });

    it('should warn when called twice', () => {
      const manager = new LifecycleManager({ name: 'DoubleCleanup' });
      
      manager.cleanup();
      manager.cleanup();
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[LifecycleManager:DoubleCleanup] Already destroyed'
      );
    });

    it('should handle errors in cleanup functions', () => {
      const manager = new LifecycleManager({ name: 'ErrorTest' });
      const error = new Error('Cleanup failed');
      
      manager.add(() => { throw error; });
      manager.add(vi.fn()); // This should still run
      
      manager.cleanup();
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[LifecycleManager:ErrorTest] Cleanup error:',
        error
      );
    });

    it('should log in debug mode', () => {
      const manager = new LifecycleManager({ debug: true });
      
      manager.add(vi.fn());
      manager.add(vi.fn());
      
      manager.cleanup();
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cleaning up 2 resources')
      );
    });

    it('should log success in debug mode', () => {
      const manager = new LifecycleManager({ name: 'SuccessTest', debug: true });
      
      manager.cleanup();
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Destroyed successfully')
      );
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      const manager = new LifecycleManager({ name: 'StateTest' });
      
      manager.add(vi.fn());
      manager.add(vi.fn());
      manager.setTimeout(vi.fn(), 1000);
      manager.setInterval(vi.fn(), 1000);
      
      const state = manager.getState();
      
      expect(state).toEqual({
        name: 'StateTest',
        isDestroyed: false,
        cleanupCount: 4, // 2 added + 2 from timers
        timerCount: 1,
        intervalCount: 1,
      });
    });
  });

  describe('destroyed property', () => {
    it('should return false before cleanup', () => {
      const manager = new LifecycleManager();
      expect(manager.destroyed).toBe(false);
    });

    it('should return true after cleanup', () => {
      const manager = new LifecycleManager();
      manager.cleanup();
      expect(manager.destroyed).toBe(true);
    });
  });
});
