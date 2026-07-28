/**
 * Component Comparison Utilities Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  areComponentsEqual,
  isComponentEqual,
  getComponentsHash,
  createComparisonMonitor,
} from '@/utils/componentComparison';
import type { ComponentProps } from '@/app_runtime/interfaces/components/common/core';

describe('componentComparison', () => {
  describe('areComponentsEqual', () => {
    it('should return true for identical references', () => {
      const components: ComponentProps[] = [
        { uuid: '1', componentType: 'Text' } as ComponentProps,
      ];
      expect(areComponentsEqual(components, components)).toBe(true);
    });

    it('should return true for both undefined', () => {
      expect(areComponentsEqual(undefined, undefined)).toBe(true);
    });

    it('should return false when one is undefined', () => {
      const components: ComponentProps[] = [
        { uuid: '1', componentType: 'Text' } as ComponentProps,
      ];
      expect(areComponentsEqual(components, undefined)).toBe(false);
      expect(areComponentsEqual(undefined, components)).toBe(false);
    });

    it('should return false for different lengths', () => {
      const prev: ComponentProps[] = [
        { uuid: '1', componentType: 'Text' } as ComponentProps,
      ];
      const next: ComponentProps[] = [
        { uuid: '1', componentType: 'Text' } as ComponentProps,
        { uuid: '2', componentType: 'Button' } as ComponentProps,
      ];
      expect(areComponentsEqual(prev, next)).toBe(false);
    });

    it('should return false for different UUIDs', () => {
      const prev: ComponentProps[] = [
        { uuid: '1', componentType: 'Text' } as ComponentProps,
      ];
      const next: ComponentProps[] = [
        { uuid: '2', componentType: 'Text' } as ComponentProps,
      ];
      expect(areComponentsEqual(prev, next)).toBe(false);
    });

    it('should return false for different epochs', () => {
      const prev: ComponentProps[] = [
        { uuid: '1', componentType: 'Text', lastUpdatedEpoch: 1000 } as ComponentProps,
      ];
      const next: ComponentProps[] = [
        { uuid: '1', componentType: 'Text', lastUpdatedEpoch: 2000 } as ComponentProps,
      ];
      expect(areComponentsEqual(prev, next)).toBe(false);
    });

    it('should return true for same epochs', () => {
      const prev: ComponentProps[] = [
        { uuid: '1', componentType: 'Text', lastUpdatedEpoch: 1000 } as ComponentProps,
      ];
      const next: ComponentProps[] = [
        { uuid: '1', componentType: 'Text', lastUpdatedEpoch: 1000 } as ComponentProps,
      ];
      expect(areComponentsEqual(prev, next)).toBe(true);
    });

    it('should return false for different componentTypes', () => {
      const prev: ComponentProps[] = [
        { uuid: '1', componentType: 'Text', lastUpdatedEpoch: 1000 } as ComponentProps,
      ];
      const next: ComponentProps[] = [
        { uuid: '1', componentType: 'Button', lastUpdatedEpoch: 1000 } as ComponentProps,
      ];
      expect(areComponentsEqual(prev, next)).toBe(false);
    });

    it('should use shallow props comparison when epoch is undefined', () => {
      const prev: ComponentProps[] = [
        { uuid: '1', componentType: 'Text', label: 'Hello' } as ComponentProps,
      ];
      const next: ComponentProps[] = [
        { uuid: '1', componentType: 'Text', label: 'Hello' } as ComponentProps,
      ];
      expect(areComponentsEqual(prev, next)).toBe(true);
    });

    it('should detect shallow prop changes', () => {
      const prev: ComponentProps[] = [
        { uuid: '1', componentType: 'Text', label: 'Hello' } as ComponentProps,
      ];
      const next: ComponentProps[] = [
        { uuid: '1', componentType: 'Text', label: 'World' } as ComponentProps,
      ];
      expect(areComponentsEqual(prev, next)).toBe(false);
    });
  });

  describe('isComponentEqual', () => {
    it('should return true for identical references', () => {
      const component = { uuid: '1', componentType: 'Text' } as ComponentProps;
      expect(isComponentEqual(component, component)).toBe(true);
    });

    it('should return true for both undefined', () => {
      expect(isComponentEqual(undefined, undefined)).toBe(true);
    });

    it('should return false when one is undefined', () => {
      const component = { uuid: '1', componentType: 'Text' } as ComponentProps;
      expect(isComponentEqual(component, undefined)).toBe(false);
      expect(isComponentEqual(undefined, component)).toBe(false);
    });

    it('should return false for different UUIDs', () => {
      const prev = { uuid: '1', componentType: 'Text' } as ComponentProps;
      const next = { uuid: '2', componentType: 'Text' } as ComponentProps;
      expect(isComponentEqual(prev, next)).toBe(false);
    });

    it('should compare by epoch when both have epochs', () => {
      const prev = { uuid: '1', componentType: 'Text', lastUpdatedEpoch: 1000 } as ComponentProps;
      const next = { uuid: '1', componentType: 'Text', lastUpdatedEpoch: 1000 } as ComponentProps;
      expect(isComponentEqual(prev, next)).toBe(true);

      const updated = { uuid: '1', componentType: 'Text', lastUpdatedEpoch: 2000 } as ComponentProps;
      expect(isComponentEqual(prev, updated)).toBe(false);
    });

    it('should fallback to shallow comparison when no epochs', () => {
      const prev = { uuid: '1', componentType: 'Text', label: 'Test' } as ComponentProps;
      const next = { uuid: '1', componentType: 'Text', label: 'Test' } as ComponentProps;
      expect(isComponentEqual(prev, next)).toBe(true);
    });
  });

  describe('getComponentsHash', () => {
    it('should return empty string for undefined', () => {
      expect(getComponentsHash(undefined)).toBe('');
    });

    it('should return empty string for empty array', () => {
      expect(getComponentsHash([])).toBe('');
    });

    it('should generate hash from UUIDs and epochs', () => {
      const components: ComponentProps[] = [
        { uuid: 'abc', componentType: 'Text', lastUpdatedEpoch: 1000 } as ComponentProps,
        { uuid: 'def', componentType: 'Button', lastUpdatedEpoch: 2000 } as ComponentProps,
      ];

      const hash = getComponentsHash(components);

      expect(hash).toBe('abc:1000|def:2000');
    });

    it('should use 0 for undefined epochs', () => {
      const components: ComponentProps[] = [
        { uuid: 'abc', componentType: 'Text' } as ComponentProps,
      ];

      const hash = getComponentsHash(components);

      expect(hash).toBe('abc:0');
    });

    it('should produce different hashes for different components', () => {
      const components1: ComponentProps[] = [
        { uuid: 'a', componentType: 'Text', lastUpdatedEpoch: 100 } as ComponentProps,
      ];
      const components2: ComponentProps[] = [
        { uuid: 'b', componentType: 'Text', lastUpdatedEpoch: 100 } as ComponentProps,
      ];

      expect(getComponentsHash(components1)).not.toBe(getComponentsHash(components2));
    });
  });

  describe('createComparisonMonitor', () => {
    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('should create monitor with initial stats at zero', () => {
      const monitor = createComparisonMonitor();
      const stats = monitor.getStats();

      expect(stats.totalCalls).toBe(0);
      expect(stats.totalTime).toBe(0);
      expect(stats.averageTime).toBe(0);
    });

    it('should wrap function and track calls', () => {
      const monitor = createComparisonMonitor();
      const fn = vi.fn().mockReturnValue(true);

      const wrapped = monitor.wrap(fn, 'testFn');

      wrapped(1, 2, 3);
      wrapped(4, 5, 6);

      expect(fn).toHaveBeenCalledTimes(2);
      expect(monitor.getStats().totalCalls).toBe(2);
    });

    it('should return correct result from wrapped function', () => {
      const monitor = createComparisonMonitor();
      const fn = (a: number, b: number) => a + b;

      const wrapped = monitor.wrap(fn, 'add');

      expect(wrapped(2, 3)).toBe(5);
    });

    it('should track execution time', () => {
      const monitor = createComparisonMonitor();
      const fn = () => {
        // Simulate some work
        let sum = 0;
        for (let i = 0; i < 1000; i++) sum += i;
        return sum;
      };

      const wrapped = monitor.wrap(fn, 'work');
      wrapped();

      expect(monitor.getStats().totalTime).toBeGreaterThanOrEqual(0);
    });

    it('should log stats every 100 calls', () => {
      const monitor = createComparisonMonitor();
      const fn = vi.fn().mockReturnValue(true);
      const wrapped = monitor.wrap(fn, 'loggingTest');

      // Call 100 times
      for (let i = 0; i < 100; i++) {
        wrapped();
      }

      expect(console.log).toHaveBeenCalled();
    });

    it('should reset stats', () => {
      const monitor = createComparisonMonitor();
      const fn = vi.fn();
      const wrapped = monitor.wrap(fn, 'resetTest');

      wrapped();
      wrapped();

      expect(monitor.getStats().totalCalls).toBe(2);

      monitor.reset();

      expect(monitor.getStats().totalCalls).toBe(0);
      expect(monitor.getStats().totalTime).toBe(0);
    });
  });
});
