/**
 * Component Registry - Custom Component Loading from repo.frontend.components
 *
 * Manages custom React components defined in the app's repo.frontend.components configuration.
 * These components are compiled ES modules that can be dynamically loaded via CodeComponentProps.
 *
 * Usage in config:
 * {
 *   "repo": {
 *     "frontend": {
 *       "components": {
 *         "StatsWidget": {
 *           "source": "frontend/code/components/StatsWidget.tsx",
 *           "compiled": "frontend/compiled/components/StatsWidget.js",
 *           "summary": "KPI stats widget with sparklines"
 *         }
 *       }
 *     }
 *   }
 * }
 * 
 * Usage in page content:
 * {
 *   "componentType": "CodeComponentProps",
 *   "component": "StatsWidget",
 *   "uuid": "stats-1"
 * }
 */

export interface RepoComponentProps {
  /** Source file path (for reference/editing, not loaded at runtime) */
  source: string;
  /** Compiled JavaScript file path relative to repo folder */
  compiled: string;
  /** Description for documentation */
  summary?: string;
}

/**
 * Component Registry singleton
 */
class ComponentRegistry {
  private components: Map<string, RepoComponentProps> = new Map();
  private baseUrl: string = '';
  private initialized: boolean = false;
  private listeners: Set<() => void> = new Set();

  /**
   * Initialize the registry with config from repo.components
   */
  initialize(config: Record<string, RepoComponentProps> | undefined, baseUrl: string): void {
    this.baseUrl = baseUrl;
    this.components.clear();
    this.initialized = true;

    if (!config || Object.keys(config).length === 0) {
      console.log('[ComponentRegistry] No components configured');
      this.notifyListeners();
      return;
    }

    Object.entries(config).forEach(([name, cfg]) => {
      this.components.set(name, cfg);
    });

    this.notifyListeners();
  }

  /**
   * Subscribe to registry initialization. Returns unsubscribe function.
   */
  onReady(callback: () => void): () => void {
    if (this.initialized) {
      callback();
      return () => {};
    }
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    this.listeners.forEach(cb => cb());
    this.listeners.clear();
  }

  /**
   * Check if a component exists in the registry
   */
  has(name: string): boolean {
    return this.components.has(name);
  }

  /**
   * Get the compiled module URL for a component
   */
  getCompiledUrl(name: string): string | undefined {
    const config = this.components.get(name);
    if (!config) {
      console.warn(`[ComponentRegistry] Component "${name}" not found`);
      return undefined;
    }
    if (!config.compiled) {
      console.error(`[ComponentRegistry] Component "${name}" has no compiled path`);
      return undefined;
    }
    // Construct URL: baseUrl + /repo/ + compiled path
    return `${this.baseUrl}/repo/${config.compiled}`;
  }

  /**
   * Get component config by name
   */
  getConfig(name: string): RepoComponentProps | undefined {
    return this.components.get(name);
  }

  /**
   * Get all registered component names
   */
  getComponentNames(): string[] {
    return Array.from(this.components.keys());
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Reset the registry
   */
  reset(): void {
    this.components.clear();
    this.baseUrl = '';
    this.initialized = false;
  }
}

// Export singleton instance
export const componentRegistry = new ComponentRegistry();

/**
 * Initialize the component registry from WebApp config.
 * Reads components from `repo.frontend.components`.
 */
export function initializeComponentRegistry(
  repoConfig: {
    frontend?: { components?: Record<string, RepoComponentProps> };
  } | undefined,
  baseUrl: string
): void {
  componentRegistry.initialize(repoConfig?.frontend?.components, baseUrl);
}
