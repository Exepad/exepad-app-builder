/**
 * Production-safe logger utility.
 * 
 * In development: All logs are shown.
 * In production: Only errors are logged, other levels are suppressed.
 * 
 * Usage:
 * ```ts
 * import { logger } from '@/lib/logger';
 * 
 * logger.log('[Component] Debug info');      // Only in development
 * logger.warn('[Component] Warning');        // Only in development  
 * logger.error('[Component] Error:', error); // Always logged
 * logger.debug('[Component] Verbose');       // Only in development
 * ```
 */

const isDev = import.meta.env.MODE === 'development';

type LogArgs = unknown[];

interface Logger {
  log: (...args: LogArgs) => void;
  warn: (...args: LogArgs) => void;
  error: (...args: LogArgs) => void;
  debug: (...args: LogArgs) => void;
  info: (...args: LogArgs) => void;
}

// No-op function for production
const noop = () => {};

export const logger: Logger = {
  /**
   * General logging - development only
   */
  log: isDev ? (...args: LogArgs) => console.log(...args) : noop,
  
  /**
   * Warning messages - development only
   */
  warn: isDev ? (...args: LogArgs) => console.warn(...args) : noop,
  
  /**
   * Error messages - always logged (important for debugging production issues)
   */
  error: (...args: LogArgs) => console.error(...args),
  
  /**
   * Debug/verbose logging - development only
   */
  debug: isDev ? (...args: LogArgs) => console.debug(...args) : noop,
  
  /**
   * Info messages - development only
   */
  info: isDev ? (...args: LogArgs) => console.info(...args) : noop,
};

export default logger;

