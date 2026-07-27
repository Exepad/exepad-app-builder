/**
 * Logger Utility Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('logger', () => {
  // Store original console methods
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    info: console.info,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Mock console methods
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
    console.debug = vi.fn();
    console.info = vi.fn();
  });

  afterEach(() => {
    // Restore original console methods
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
    vi.unstubAllEnvs();
  });

  describe('in development mode', () => {
    beforeEach(() => {
      vi.stubEnv('MODE', 'development');
    });

    it('should log messages in development', async () => {
      const { logger } = await import('@/lib/logger');
      
      logger.log('Test message');
      
      expect(console.log).toHaveBeenCalledWith('Test message');
    });

    it('should log warnings in development', async () => {
      const { logger } = await import('@/lib/logger');
      
      logger.warn('Warning message');
      
      expect(console.warn).toHaveBeenCalledWith('Warning message');
    });

    it('should log errors in development', async () => {
      const { logger } = await import('@/lib/logger');
      
      logger.error('Error message');
      
      expect(console.error).toHaveBeenCalledWith('Error message');
    });

    it('should log debug messages in development', async () => {
      const { logger } = await import('@/lib/logger');
      
      logger.debug('Debug message');
      
      expect(console.debug).toHaveBeenCalledWith('Debug message');
    });

    it('should log info messages in development', async () => {
      const { logger } = await import('@/lib/logger');
      
      logger.info('Info message');
      
      expect(console.info).toHaveBeenCalledWith('Info message');
    });

    it('should handle multiple arguments', async () => {
      const { logger } = await import('@/lib/logger');
      
      logger.log('Message', { data: 'test' }, 123);
      
      expect(console.log).toHaveBeenCalledWith('Message', { data: 'test' }, 123);
    });
  });

  describe('in production mode', () => {
    beforeEach(() => {
      vi.stubEnv('MODE', 'production');
    });

    it('should suppress log in production', async () => {
      const { logger } = await import('@/lib/logger');
      
      logger.log('Test message');
      
      expect(console.log).not.toHaveBeenCalled();
    });

    it('should suppress warn in production', async () => {
      const { logger } = await import('@/lib/logger');
      
      logger.warn('Warning message');
      
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('should still log errors in production', async () => {
      const { logger } = await import('@/lib/logger');
      
      logger.error('Error message');
      
      expect(console.error).toHaveBeenCalledWith('Error message');
    });

    it('should suppress debug in production', async () => {
      const { logger } = await import('@/lib/logger');
      
      logger.debug('Debug message');
      
      expect(console.debug).not.toHaveBeenCalled();
    });

    it('should suppress info in production', async () => {
      const { logger } = await import('@/lib/logger');
      
      logger.info('Info message');
      
      expect(console.info).not.toHaveBeenCalled();
    });
  });
});
