/**
 * ErrorReportingService Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorReportingService } from '@/services/ErrorReportingService';

// Mock RuntimeMode
vi.mock('@/core/RuntimeMode', () => ({
  RuntimeMode: 'published',
}));

describe('ErrorReportingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the service before each test
    ErrorReportingService.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('report', () => {
    it('should track error counts by componentId', () => {
      const error = new Error('Test error');
      
      ErrorReportingService.report(error, { componentId: 'comp-1' });
      
      expect(ErrorReportingService.getErrorCount('comp-1')).toBe(1);
    });

    it('should increment error count on multiple reports', () => {
      const error = new Error('Test error');
      
      ErrorReportingService.report(error, { componentId: 'comp-2' });
      ErrorReportingService.report(error, { componentId: 'comp-2' });
      ErrorReportingService.report(error, { componentId: 'comp-2' });
      
      expect(ErrorReportingService.getErrorCount('comp-2')).toBe(3);
    });

    it('should track separate counts for different components', () => {
      const error = new Error('Test error');
      
      ErrorReportingService.report(error, { componentId: 'comp-a' });
      ErrorReportingService.report(error, { componentId: 'comp-a' });
      ErrorReportingService.report(error, { componentId: 'comp-b' });
      
      expect(ErrorReportingService.getErrorCount('comp-a')).toBe(2);
      expect(ErrorReportingService.getErrorCount('comp-b')).toBe(1);
    });

    it('should use componentType as key when componentId not provided', () => {
      const error = new Error('Test error');
      
      ErrorReportingService.report(error, { componentType: 'Button' });
      
      expect(ErrorReportingService.getErrorCount('Button')).toBe(1);
    });

    it('should add error to logs', () => {
      const error = new Error('Logged error');
      
      ErrorReportingService.report(error, { componentId: 'comp-log' });
      
      const stats = ErrorReportingService.getErrorStats();
      expect(stats.recentErrors.length).toBeGreaterThan(0);
    });

    it('should dispatch custom event', () => {
      const eventHandler = vi.fn();
      window.addEventListener('runtime-error', eventHandler);
      
      const error = new Error('Event error');
      ErrorReportingService.report(error, { componentId: 'comp-event' });
      
      expect(eventHandler).toHaveBeenCalled();
      
      window.removeEventListener('runtime-error', eventHandler);
    });
  });

  describe('shouldRecover', () => {
    it('should return true when error count is less than 3', () => {
      const error = new Error('Test error');
      
      ErrorReportingService.report(error, { componentId: 'comp-recover' });
      
      expect(ErrorReportingService.shouldRecover({ componentId: 'comp-recover' })).toBe(true);
    });

    it('should return true when error count is 2', () => {
      const error = new Error('Test error');
      
      ErrorReportingService.report(error, { componentId: 'comp-recover-2' });
      ErrorReportingService.report(error, { componentId: 'comp-recover-2' });
      
      expect(ErrorReportingService.shouldRecover({ componentId: 'comp-recover-2' })).toBe(true);
    });

    it('should return false when error count is 3 or more', () => {
      const error = new Error('Test error');
      
      ErrorReportingService.report(error, { componentId: 'comp-no-recover' });
      ErrorReportingService.report(error, { componentId: 'comp-no-recover' });
      ErrorReportingService.report(error, { componentId: 'comp-no-recover' });
      
      expect(ErrorReportingService.shouldRecover({ componentId: 'comp-no-recover' })).toBe(false);
    });

    it('should return true for components with no errors', () => {
      expect(ErrorReportingService.shouldRecover({ componentId: 'new-component' })).toBe(true);
    });
  });

  describe('clearErrors', () => {
    it('should reset error count for component', () => {
      const error = new Error('Test error');
      
      ErrorReportingService.report(error, { componentId: 'comp-clear' });
      ErrorReportingService.report(error, { componentId: 'comp-clear' });
      
      expect(ErrorReportingService.getErrorCount('comp-clear')).toBe(2);
      
      ErrorReportingService.clearErrors('comp-clear');
      
      expect(ErrorReportingService.getErrorCount('comp-clear')).toBe(0);
    });

    it('should allow recovery after clearing errors', () => {
      const error = new Error('Test error');
      
      // Exhaust recovery attempts
      ErrorReportingService.report(error, { componentId: 'comp-retry' });
      ErrorReportingService.report(error, { componentId: 'comp-retry' });
      ErrorReportingService.report(error, { componentId: 'comp-retry' });
      
      expect(ErrorReportingService.shouldRecover({ componentId: 'comp-retry' })).toBe(false);
      
      // Clear and should be able to recover again
      ErrorReportingService.clearErrors('comp-retry');
      
      expect(ErrorReportingService.shouldRecover({ componentId: 'comp-retry' })).toBe(true);
    });
  });

  describe('getErrorCount', () => {
    it('should return 0 for unknown component', () => {
      expect(ErrorReportingService.getErrorCount('unknown')).toBe(0);
    });

    it('should return correct count for tracked component', () => {
      const error = new Error('Test error');
      
      ErrorReportingService.report(error, { componentId: 'comp-count' });
      ErrorReportingService.report(error, { componentId: 'comp-count' });
      
      expect(ErrorReportingService.getErrorCount('comp-count')).toBe(2);
    });
  });

  describe('hasCriticalErrors', () => {
    it('should return false for components with less than 3 errors', () => {
      const error = new Error('Test error');
      
      ErrorReportingService.report(error, { componentId: 'comp-critical' });
      ErrorReportingService.report(error, { componentId: 'comp-critical' });
      
      expect(ErrorReportingService.hasCriticalErrors('comp-critical')).toBe(false);
    });

    it('should return true for components with 3 or more errors', () => {
      const error = new Error('Test error');
      
      ErrorReportingService.report(error, { componentId: 'comp-crit-3' });
      ErrorReportingService.report(error, { componentId: 'comp-crit-3' });
      ErrorReportingService.report(error, { componentId: 'comp-crit-3' });
      
      expect(ErrorReportingService.hasCriticalErrors('comp-crit-3')).toBe(true);
    });

    it('should return false for unknown component', () => {
      expect(ErrorReportingService.hasCriticalErrors('unknown-comp')).toBe(false);
    });
  });

  describe('getErrorStats', () => {
    it('should return total error count', () => {
      const error = new Error('Test error');
      
      ErrorReportingService.report(error, { componentId: 'comp-a' });
      ErrorReportingService.report(error, { componentId: 'comp-a' });
      ErrorReportingService.report(error, { componentId: 'comp-b' });
      
      const stats = ErrorReportingService.getErrorStats();
      
      expect(stats.totalErrors).toBe(3);
    });

    it('should return component error counts', () => {
      const error = new Error('Test error');
      
      ErrorReportingService.report(error, { componentId: 'stat-comp-1' });
      ErrorReportingService.report(error, { componentId: 'stat-comp-2' });
      
      const stats = ErrorReportingService.getErrorStats();
      
      expect(stats.componentErrors).toHaveLength(2);
    });

    it('should return recent errors (max 20)', () => {
      const error = new Error('Test error');
      
      for (let i = 0; i < 25; i++) {
        ErrorReportingService.report(error, { componentId: `stat-many-${i}` });
      }
      
      const stats = ErrorReportingService.getErrorStats();
      
      expect(stats.recentErrors.length).toBeLessThanOrEqual(20);
    });
  });

  describe('reset', () => {
    it('should clear all error counts', () => {
      const error = new Error('Test error');
      
      ErrorReportingService.report(error, { componentId: 'reset-a' });
      ErrorReportingService.report(error, { componentId: 'reset-b' });
      
      ErrorReportingService.reset();
      
      expect(ErrorReportingService.getErrorCount('reset-a')).toBe(0);
      expect(ErrorReportingService.getErrorCount('reset-b')).toBe(0);
    });

    it('should clear error logs', () => {
      const error = new Error('Test error');
      
      ErrorReportingService.report(error, { componentId: 'reset-log' });
      
      ErrorReportingService.reset();
      
      const stats = ErrorReportingService.getErrorStats();
      expect(stats.recentErrors).toHaveLength(0);
    });

    it('should reset total errors to 0', () => {
      const error = new Error('Test error');
      
      ErrorReportingService.report(error, { componentId: 'reset-total' });
      ErrorReportingService.report(error, { componentId: 'reset-total' });
      
      ErrorReportingService.reset();
      
      const stats = ErrorReportingService.getErrorStats();
      expect(stats.totalErrors).toBe(0);
    });
  });

  describe('exportLogs', () => {
    it('should return valid JSON', () => {
      const error = new Error('Export test');
      
      ErrorReportingService.report(error, { componentId: 'export-comp' });
      
      const exported = ErrorReportingService.exportLogs();
      
      expect(() => JSON.parse(exported)).not.toThrow();
    });

    it('should include error counts in export', () => {
      const error = new Error('Export test');
      
      ErrorReportingService.report(error, { componentId: 'export-count' });
      
      const exported = JSON.parse(ErrorReportingService.exportLogs());
      
      expect(exported.errorCounts).toBeDefined();
      expect(exported.errorCounts.length).toBeGreaterThan(0);
    });

    it('should include recent errors in export', () => {
      const error = new Error('Export test');
      
      ErrorReportingService.report(error, { componentId: 'export-recent' });
      
      const exported = JSON.parse(ErrorReportingService.exportLogs());
      
      expect(exported.recentErrors).toBeDefined();
    });

    it('should include stats in export', () => {
      const error = new Error('Export test');
      
      ErrorReportingService.report(error, { componentId: 'export-stats' });
      
      const exported = JSON.parse(ErrorReportingService.exportLogs());
      
      expect(exported.stats).toBeDefined();
      expect(exported.stats.totalErrors).toBeGreaterThan(0);
    });
  });
});
