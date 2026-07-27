import React from 'react';

/**
 * Component Registry System
 * Maps componentType strings to their corresponding React components.
 * After the UI component removal, only CodeComponentProps remains.
 */
export const componentRegistry: Record<string, () => Promise<React.ComponentType<any>>> = {
  // =================================================================
  // CODE COMPONENTS
  // =================================================================
  'CodeComponentProps': () => import('../app_runtime/runtime/components/custom/code/CodeComponent').then(m => m.CodeComponent),
};

// Cache for loaded components
const componentCache = new Map<string, React.ComponentType<any>>();

/**
 * Get a component from the registry by componentType (async)
 * @param componentType - The component type string
 * @returns Promise that resolves to the React component or null if not found
 */
export const getComponent = async (componentType: string): Promise<React.ComponentType<any> | null> => {
  // Check cache first
  if (componentCache.has(componentType)) {
    return componentCache.get(componentType) as React.ComponentType<any>;
  }

  const componentLoader = componentRegistry[componentType];
  if (!componentLoader) {
    console.error(`[Registry] Component type "${componentType}" not found in registry`);
    return null;
  }

  try {
    const module = await componentLoader();

    if (!module) {
      console.error(`[Registry] Component loader returned null for: ${componentType}`);
      return null;
    }

    const anyModule = module as any;

    let isValidComponent = false;
    if (typeof anyModule === 'function') {
      isValidComponent = true;
    } else if (anyModule && typeof anyModule === 'object') {
      if (anyModule.$$typeof) {
        isValidComponent = true;
      } else if (anyModule._payload && (anyModule as any)._init) {
        isValidComponent = true;
      } else if (typeof anyModule.render === 'function') {
        isValidComponent = true;
      }
    }

    if (!isValidComponent) {
      console.error(`[Registry] Loaded module is not a valid React component for: ${componentType}`);
      return null;
    }

    componentCache.set(componentType, anyModule as React.ComponentType<any>);
    return anyModule as React.ComponentType<any>;
  } catch (error) {
    console.error(`[Registry] Failed to load component: ${componentType}`, error);
    return null;
  }
}

/**
 * Get a component from the registry synchronously (for cached components)
 */
export function getComponentSync(componentType: string): React.ComponentType<any> | null {
  return componentCache.get(componentType) || null;
}

/**
 * Preload a component into the cache
 */
export async function preloadComponent(componentType: string): Promise<void> {
  await getComponent(componentType);
}

/**
 * Preload multiple components into the cache
 */
export async function preloadComponents(componentTypes: string[]): Promise<void> {
  await Promise.all(componentTypes.map(type => preloadComponent(type)));
}

/**
 * Check if a component type is registered
 */
export function isComponentRegistered(componentType: string): boolean {
  return componentType in componentRegistry;
}

/**
 * Check if a component is already loaded in cache
 */
export function isComponentCached(componentType: string): boolean {
  return componentCache.has(componentType);
}

/**
 * Get all registered component types
 */
export function getRegisteredComponentTypes(): string[] {
  return Object.keys(componentRegistry);
}

/**
 * Clear the component cache
 */
export function clearComponentCache(): void {
  componentCache.clear();
}
