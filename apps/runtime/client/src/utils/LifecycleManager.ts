/**
 * LifecycleManager
 * Utility for managing component lifecycles and preventing memory leaks
 */

type CleanupFunction = () => void;

interface LifecycleOptions {
  name?: string;
  debug?: boolean;
}

/**
 * LifecycleManager
 * 
 * A utility class for managing subscriptions, timers, and other resources
 * that need cleanup to prevent memory leaks.
 * 
 * @example
 * ```tsx
 * const lifecycle = new LifecycleManager({ name: 'MyComponent', debug: true });
 * 
 * // Add cleanup functions
 * lifecycle.add(ws.subscribe('channel', handler));
 * lifecycle.add(() => clearInterval(intervalId));
 * 
 * // Clean up all at once (in useEffect cleanup or componentWillUnmount)
 * lifecycle.cleanup();
 * ```
 */
export class LifecycleManager {
  private cleanups: Set<CleanupFunction> = new Set();
  private timers: Set<NodeJS.Timeout> = new Set();
  private intervals: Set<NodeJS.Timeout> = new Set();
  private isDestroyed = false;
  private readonly name: string;
  private readonly debug: boolean;

  constructor(options: LifecycleOptions = {}) {
    this.name = options.name || 'Anonymous';
    this.debug = options.debug || false;

    if (this.debug) {
      console.log(`[LifecycleManager:${this.name}] Initialized`);
    }
  }

  /**
   * Add a cleanup function to be called on destroy
   */
  add(cleanup: CleanupFunction): void {
    if (this.isDestroyed) {
      console.warn(
        `[LifecycleManager:${this.name}] Attempting to add cleanup to destroyed instance`
      );
      return;
    }

    this.cleanups.add(cleanup);

    if (this.debug) {
      console.log(
        `[LifecycleManager:${this.name}] Added cleanup (total: ${this.cleanups.size})`
      );
    }
  }

  /**
   * Remove a specific cleanup function
   */
  remove(cleanup: CleanupFunction): void {
    const removed = this.cleanups.delete(cleanup);

    if (this.debug && removed) {
      console.log(
        `[LifecycleManager:${this.name}] Removed cleanup (remaining: ${this.cleanups.size})`
      );
    }
  }

  /**
   * Create a managed setTimeout
   */
  setTimeout(callback: () => void, delay: number): NodeJS.Timeout {
    if (this.isDestroyed) {
      console.warn(
        `[LifecycleManager:${this.name}] Attempting to set timeout on destroyed instance`
      );
      return {} as NodeJS.Timeout;
    }

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);

    this.timers.add(timer);

    // Add cleanup function
    this.add(() => {
      clearTimeout(timer);
      this.timers.delete(timer);
    });

    return timer;
  }

  /**
   * Create a managed setInterval
   */
  setInterval(callback: () => void, delay: number): NodeJS.Timeout {
    if (this.isDestroyed) {
      console.warn(
        `[LifecycleManager:${this.name}] Attempting to set interval on destroyed instance`
      );
      return {} as NodeJS.Timeout;
    }

    const interval = setInterval(callback, delay);
    this.intervals.add(interval);

    // Add cleanup function
    this.add(() => {
      clearInterval(interval);
      this.intervals.delete(interval);
    });

    return interval;
  }

  /**
   * Clear a specific timer
   */
  clearTimeout(timer: NodeJS.Timeout): void {
    clearTimeout(timer);
    this.timers.delete(timer);
  }

  /**
   * Clear a specific interval
   */
  clearInterval(interval: NodeJS.Timeout): void {
    clearInterval(interval);
    this.intervals.delete(interval);
  }

  /**
   * Execute all cleanup functions and clear resources
   */
  cleanup(): void {
    if (this.isDestroyed) {
      console.warn(`[LifecycleManager:${this.name}] Already destroyed`);
      return;
    }

    if (this.debug) {
      console.log(
        `[LifecycleManager:${this.name}] Cleaning up ${this.cleanups.size} resources`
      );
    }

    // Clear all timers
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();

    // Clear all intervals
    this.intervals.forEach((interval) => clearInterval(interval));
    this.intervals.clear();

    // Execute all cleanup functions
    const errors: Error[] = [];
    this.cleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch (error) {
        console.error(`[LifecycleManager:${this.name}] Cleanup error:`, error);
        errors.push(error as Error);
      }
    });

    this.cleanups.clear();
    this.isDestroyed = true;

    if (this.debug) {
      console.log(
        `[LifecycleManager:${this.name}] Destroyed ${errors.length ? `with ${errors.length} errors` : 'successfully'}`
      );
    }

    if (errors.length > 0) {
      console.warn(
        `[LifecycleManager:${this.name}] Cleanup completed with errors:`,
        errors
      );
    }
  }

  /**
   * Get the current state of the lifecycle manager
   */
  getState() {
    return {
      name: this.name,
      isDestroyed: this.isDestroyed,
      cleanupCount: this.cleanups.size,
      timerCount: this.timers.size,
      intervalCount: this.intervals.size,
    };
  }

  /**
   * Check if the lifecycle manager has been destroyed
   */
  get destroyed(): boolean {
    return this.isDestroyed;
  }
}

