/**
 * Error Reporting Service
 * Centralized error tracking and reporting with Sentry integration
 */

import { RuntimeMode } from '../core/RuntimeMode';

export interface ErrorContext {
  componentType?: string;
  componentId?: string;
  appId?: string;
  errorCount?: number;
  userAction?: string;
  stackTrace?: string;
  mode: RuntimeMode;
  timestamp: number;
  url?: string;
  userAgent?: string;
}

export interface ErrorStats {
  totalErrors: number;
  componentErrors: [string, number][];
  recentErrors: ErrorLog[];
}

interface ErrorLog {
  error: Error;
  context: ErrorContext;
  timestamp: number;
}

/**
 * ErrorReportingService - Centralized error tracking and reporting
 * 
 * Features:
 * - Sentry integration for production
 * - Local error tracking
 * - Error frequency monitoring
 * - Recovery decision logic
 * - Debug logging in development
 */
export class ErrorReportingService {
  private static errorCounts = new Map<string, number>();
  private static errorLogs: ErrorLog[] = [];
  private static maxLogs = 100; // Keep last 100 errors
  private static sentryInitialized = false;

  /**
   * Initialize Sentry (call once on app start)
   */
  static initSentry(): void {
    if (this.sentryInitialized) return;

    // Sentry is not bundled in this build; there is no SDK to initialize.
    // Leave sentryInitialized = false so report() skips the Sentry path, and
    // do NOT emit a success log for an initialization that never happened.
    // Wire real init here (gated behind VITE_ENABLE_SENTRY) if/when the SDK is added.
  }

  /**
   * Report an error with context
   */
  static report(error: Error, context: Partial<ErrorContext> = {}): void {
    const fullContext: ErrorContext = {
      ...context,
      mode: context.mode || 'published',
      timestamp: Date.now(),
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : undefined,
      stackTrace: error.stack,
    };

    // Track error count
    const key = fullContext.componentId || fullContext.componentType || 'unknown';
    this.errorCounts.set(key, (this.errorCounts.get(key) || 0) + 1);
    fullContext.errorCount = this.errorCounts.get(key);

    // Add to error logs
    this.errorLogs.push({ error, context: fullContext, timestamp: Date.now() });
    if (this.errorLogs.length > this.maxLogs) {
      this.errorLogs.shift(); // Remove oldest
    }

    // Console logging (always in development, only critical in production)
    if (import.meta.env.MODE === 'development') {
      console.error('[ErrorReporting] Error reported:', {
        message: error.message,
        context: fullContext,
        stack: error.stack,
      });
    } else if (fullContext.errorCount && fullContext.errorCount >= 3) {
      console.error('[ErrorReporting] Critical error (3+ occurrences):', error.message);
    }

    // Send to Sentry in production
    if (import.meta.env.MODE === 'production' && this.sentryInitialized) {
      try {
        // Sentry SDK will be available via global scope after initialization
        if (typeof window !== 'undefined' && (window as any).Sentry) {
          const Sentry = (window as any).Sentry;
          Sentry.captureException(error, {
            contexts: {
              runtime: fullContext,
            },
            tags: {
              componentType: fullContext.componentType,
              componentId: fullContext.componentId,
              mode: fullContext.mode,
              errorCount: fullContext.errorCount?.toString(),
            },
          });
        }
      } catch (sentryError) {
        console.error('[ErrorReporting] Failed to send to Sentry:', sentryError);
      }
    }

    // Emit custom event for monitoring tools
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('runtime-error', {
          detail: { error, context: fullContext },
        })
      );
    }
  }

  /**
   * Determine if component should attempt recovery
   * Based on error frequency
   */
  static shouldRecover(context: Partial<ErrorContext>): boolean {
    const key = context.componentId || context.componentType || 'unknown';
    const count = this.errorCounts.get(key) || 0;
    
    // Allow up to 3 recovery attempts
    return count < 3;
  }

  /**
   * Clear error count for a component (after successful recovery)
   */
  static clearErrors(componentId: string): void {
    this.errorCounts.delete(componentId);
    console.log(`[ErrorReporting] Cleared errors for: ${componentId}`);
  }

  /**
   * Get error statistics
   */
  static getErrorStats(): ErrorStats {
    return {
      totalErrors: Array.from(this.errorCounts.values()).reduce((a, b) => a + b, 0),
      componentErrors: Array.from(this.errorCounts.entries()),
      recentErrors: this.errorLogs.slice(-20), // Last 20 errors
    };
  }

  /**
   * Get error count for specific component
   */
  static getErrorCount(componentId: string): number {
    return this.errorCounts.get(componentId) || 0;
  }

  /**
   * Check if component has critical errors (3+)
   */
  static hasCriticalErrors(componentId: string): boolean {
    return this.getErrorCount(componentId) >= 3;
  }

  /**
   * Reset all error tracking (useful for testing)
   */
  static reset(): void {
    this.errorCounts.clear();
    this.errorLogs = [];
    console.log('[ErrorReporting] All error tracking reset');
  }

  /**
   * Export error logs for debugging
   */
  static exportLogs(): string {
    return JSON.stringify({
      errorCounts: Array.from(this.errorCounts.entries()),
      recentErrors: this.errorLogs.map(log => ({
        message: log.error.message,
        context: log.context,
        timestamp: new Date(log.timestamp).toISOString(),
      })),
      stats: this.getErrorStats(),
    }, null, 2);
  }
}

// Auto-initialize on import
if (typeof window !== 'undefined') {
  ErrorReportingService.initSentry();
}

