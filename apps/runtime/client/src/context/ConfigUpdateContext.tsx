/**
 * Config Update Context (Preview-Only - Refactored)
 * Thin provider for backward compatibility with existing components
 * 
 * IMPORTANT: This should only be used in preview mode
 * 
 * BEFORE: 275 lines with component indexing and update logic
 * AFTER: ~80 lines as thin wrapper around Zustand store and ConfigService
 */


import React, { createContext, useContext, useCallback, useEffect } from 'react';
import { WebAppProps } from '@/app_runtime/interfaces/apps/webapp';
import { ComponentProps } from '@/app_runtime/interfaces/components/common/core';
import { useAppStore } from '@/stores/appStore';
import { ConfigService, ComponentUpdate } from '@/services/ConfigService';

interface ConfigUpdateContextType {
  appConfig: WebAppProps | null;
  setAppConfig: (config: WebAppProps) => void;
  getComponent: (componentId: string) => ComponentProps | undefined;
  subscribeToComponent: (componentId: string, callback: (component: ComponentProps) => void) => () => void;
  handlePartialUpdate: (updates: ComponentUpdate[]) => void;
  getComponentEpoch: (componentId: string) => number | undefined;
}

const ConfigUpdateContext = createContext<ConfigUpdateContextType>({
  appConfig: null,
  setAppConfig: () => {},
  getComponent: () => undefined,
  subscribeToComponent: () => () => {},
  handlePartialUpdate: () => {},
  getComponentEpoch: () => undefined,
});

export const useConfigUpdate = () => useContext(ConfigUpdateContext);

interface ConfigUpdateProviderProps {
  children: React.ReactNode;
  initialConfig: WebAppProps | null;
}

export function ConfigUpdateProvider({ children, initialConfig }: ConfigUpdateProviderProps) {
  // Use Zustand store for config state
  const { appConfig, setAppConfig: setStoreConfig, getComponentById, clearUpdates } = useAppStore();

  // Initialize config if not already set — clear any stale edits from a previous session
  useEffect(() => {
    if (initialConfig && !appConfig) {
      setStoreConfig(initialConfig);
      clearUpdates();
    }
  }, [initialConfig, appConfig, setStoreConfig, clearUpdates]);

  // Set config wrapper
  const setAppConfig = useCallback(
    (config: WebAppProps) => {
      setStoreConfig(config);
    },
    [setStoreConfig]
  );

  // Get component by ID - use ConfigService for extraction
  const getComponent = useCallback(
    (componentId: string): ComponentProps | undefined => {
      if (!appConfig) return undefined;
      return getComponentById(componentId);
    },
    [appConfig, getComponentById]
  );

  // Subscribe to component updates
  const subscribeToComponent = useCallback(
    (componentId: string, callback: (component: ComponentProps) => void) => {
      // Simple implementation - can be enhanced with event emitter if needed
      console.log(`[ConfigUpdateContext] Subscribed to component: ${componentId}`);
      
      // Return unsubscribe function
      return () => {
        console.log(`[ConfigUpdateContext] Unsubscribed from component: ${componentId}`);
      };
    },
    []
  );

  // Handle partial config update
  const handlePartialUpdate = useCallback(
    (updates: ComponentUpdate[]) => {
      if (!appConfig) {
        console.warn('[ConfigUpdateContext] No config available for update');
        return;
      }

      console.log(`[ConfigUpdateContext] Processing ${updates.length} update(s)`);

      // For now, we rely on hot reload from WebSocket
      // The EditModeProvider handles fetching the new config
      // This is a simplified version - full implementation would merge updates

      // In the refactored architecture, we fetch the entire config
      // and let React handle the rendering updates
    },
    [appConfig]
  );

  // Get component epoch
  const getComponentEpoch = useCallback(
    (componentId: string): number | undefined => {
      const component = getComponent(componentId);
      return component?.lastUpdatedEpoch;
    },
    [getComponent]
  );

  const contextValue = React.useMemo(
    () => ({
      appConfig,
      setAppConfig,
      getComponent,
      subscribeToComponent,
      handlePartialUpdate,
      getComponentEpoch,
    }),
    [appConfig, setAppConfig, getComponent, subscribeToComponent, handlePartialUpdate, getComponentEpoch]
  );

  return (
    <ConfigUpdateContext.Provider value={contextValue}>
      {children}
    </ConfigUpdateContext.Provider>
  );
}

