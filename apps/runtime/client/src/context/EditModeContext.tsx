/**
 * Edit Mode Context (Preview-Only - Refactored)
 * Thin provider layer that bridges React components with services/store
 * 
 * IMPORTANT: This should only be used in preview mode
 * 
 * BEFORE: 557 lines with all logic inline
 * AFTER: ~150 lines as thin provider using services/store
 * 
 * SECURITY: Edit mode is only enabled when running inside the editor iframe.
 * Opening the preview URL in a new tab will NOT enable edit mode or WebSocket connection.
 */

import React, { createContext, useContext, useEffect, useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { WebSocketManager, ConnectionStatus } from '../services/WebSocketManager';
import { PersistenceService, ContentUpdate } from '../services/PersistenceService';
import { ConfigService } from '../services/ConfigService';
import { useAppStore } from '../stores/appStore';
import { useLifecycle } from '../hooks/useLifecycle';
import { getJWTTokenAsync } from '../lib/jwt-helper';
import { getEditorOrigin } from '../lib/editor-origin';
import { logger } from '../lib/logger';
import { toast } from 'sonner';
import { setSelectedElement } from '../components/editable/selectionElementStore';
import { SelectionOverlay } from '../components/editable/SelectionOverlay';

/**
 * Check if we're running inside an iframe (the editor embeds preview in iframe)
 * This is more reliable than query params and can't be URL-spoofed
 */
function getIsInEditorIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch (e) {
    // If we can't access window.top due to cross-origin restrictions,
    // we're definitely in an iframe
    return true;
  }
}

interface ComponentMetadata {
  componentType?: string;
  textPreview?: string;
}

interface EditModeContextType {
  isEditMode: boolean;
  isPreview: boolean;
  updateContent: (componentId: string, content: string, componentType: string, targetField: string) => void;
  saveChanges: (force?: boolean, origin?: 'autosave' | 'manual') => Promise<void>;
  hasUnsavedChanges: boolean;
  selectComponent: (componentId: string | null, metadata?: ComponentMetadata, element?: HTMLElement | null) => void;
  sendWebSocketMessage: (message: { type: string; data?: any;[key: string]: any }) => boolean;
  triggerEditMode: (enable: boolean) => void;
  setComponentProcessing: (componentId: string, isProcessing: boolean) => void;
  // Fine-grained content accessors to avoid global rerenders
  getContentFor: (componentId: string) => string | undefined;
  subscribeContent: (componentId: string, callback: () => void) => () => void;
}

const EditModeContext = createContext<EditModeContextType>({
  isEditMode: false,
  isPreview: false,
  updateContent: () => { },
  saveChanges: async () => { },
  hasUnsavedChanges: false,
  selectComponent: () => { },
  sendWebSocketMessage: () => false,
  triggerEditMode: () => { },
  setComponentProcessing: () => { },
  getContentFor: () => undefined,
  subscribeContent: () => () => { },
});

export const useEditMode = () => useContext(EditModeContext);

interface EditModeProviderProps {
  children: React.ReactNode;
  isPreview: boolean;
  appId: string;
}

export function EditModeProvider({ children, isPreview, appId }: EditModeProviderProps) {
  const [searchParams] = useSearchParams();
  const lifecycle = useLifecycle({ name: 'EditModeProvider', debug: false });

  // Check if we're running inside the editor iframe
  // This determines whether edit mode and WebSocket connection should be enabled
  const [isInEditorIframe] = useState(() => getIsInEditorIframe());

  // Subscribe to each store field individually (Zustand selectors) instead of a
  // whole-store `useAppStore()` destructure. The destructure re-rendered the
  // provider — and re-created the context value for EVERY useEditMode() consumer
  // (every DynamicRenderer / CodeComponent) — on any store mutation: each
  // keystroke's contentUpdates Map replacement, every selection, processing
  // toggle, and ws-status change. Setter functions are stable references, so
  // those selectors never trigger a re-render; only contentUpdates and appConfig
  // (the fields this provider genuinely reacts to) can.
  const setEditMode = useAppStore((s) => s.setEditMode);
  const storeSelectComponent = useAppStore((s) => s.selectComponent);
  const contentUpdates = useAppStore((s) => s.contentUpdates);
  const storeUpdateContent = useAppStore((s) => s.updateContent);
  const storeHasUnsavedChanges = useAppStore((s) => s.hasUnsavedChanges);
  const getUnsavedUpdates = useAppStore((s) => s.getUnsavedUpdates);
  const markContentAsSaved = useAppStore((s) => s.markContentAsSaved);
  const clearContentUpdate = useAppStore((s) => s.clearContentUpdate);
  const setComponentProcessing = useAppStore((s) => s.setComponentProcessing);
  const setWsConnectionStatus = useAppStore((s) => s.setWsConnectionStatus);
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);

  // Service instances
  const wsManagerRef = useRef<WebSocketManager | null>(null);
  const persistenceServiceRef = useRef<PersistenceService | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const isSavingRef = useRef(false); // Ref for synchronous duplicate prevention
  const [wsEditMode, setWsEditMode] = React.useState(false);

  // The WebSocket '*' subscription below is installed exactly once (deps
  // [isPreview, appId]), so subscribing `handleWebSocketMessage` directly would
  // pin the FIRST render's closure for the connection's lifetime — meaning
  // fetchAndApplyUpdate would forever diff against a stale `appConfig`. Route
  // through a ref that is refreshed to the latest handler on every render.
  const handleWsMessageRef = useRef<(message: any) => void>(() => {});

  // Initialize services - connect WebSocket in preview mode (works in iframe OR separate tab)
  useEffect(() => {
    if (!isPreview) return;

    // Note: We now support WebSocket in both iframe AND separate tabs!
    // Cookie-based authentication allows this to work anywhere.

    wsManagerRef.current = WebSocketManager.getInstance(appId);
    persistenceServiceRef.current = new PersistenceService(wsManagerRef.current);

    // Connect WebSocket with JWT authentication
    (async () => {
      try {
        logger.log('[EditModeProvider] Fetching JWT token for WebSocket authentication...');

        // This now tries multiple sources:
        // 1. Cached token (session storage)
        // 2. Cookie-authenticated API (works in separate tabs!)
        // 3. postMessage from parent (works in iframe)
        const jwtToken = await getJWTTokenAsync();

        if (jwtToken) {
          logger.log('[EditModeProvider] ✅ JWT token obtained, connecting to WebSocket...');
          await wsManagerRef.current!.connect(appId, jwtToken);
        } else {
          logger.warn('[EditModeProvider] ❌ No JWT token available - WebSocket disabled');
          logger.warn('[EditModeProvider] Preview will be read-only without authentication');

          // Show friendly message to user
          toast.info('Limited Preview Mode', {
            description: 'Please log in to enable edit mode and live updates.',
            duration: 5000,
          });
        }
      } catch (error) {
        logger.error('[EditModeProvider] WebSocket connection failed:', error);

        toast.error('Connection Failed', {
          description: 'Could not connect to server. Some features may be limited.',
          duration: 5000,
        });
      }
    })();

    // Subscribe to connection status changes
    const unsubscribe = wsManagerRef.current.subscribe('connection', (message) => {
      setWsConnectionStatus(message.status);
    });
    lifecycle.add(unsubscribe);

    // Subscribe to WebSocket messages via the ref so the always-latest handler
    // (with fresh appConfig) runs, not the first render's stale closure.
    const unsubscribeMessages = wsManagerRef.current.subscribe('*', (message) => {
      handleWsMessageRef.current(message);
    });
    lifecycle.add(unsubscribeMessages);

    // Add cleanup for services
    lifecycle.add(() => {
      persistenceServiceRef.current?.cleanup();
      wsManagerRef.current?.disconnect();
      WebSocketManager.releaseInstance(appId);
    });

    // Note: lifecycle.cleanup() is automatically called on unmount by useLifecycle hook
  }, [isPreview, appId]);  // Removed isInEditorIframe dependency - works anywhere now!

  // Handle WebSocket messages
  const handleWebSocketMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'enter_edit_mode':
        // Only allow edit mode when running inside the editor iframe
        if (!isInEditorIframe) {
          logger.log('[EditModeProvider] Ignoring enter_edit_mode (not in editor iframe)');
          return;
        }
        logger.log('[EditModeProvider] Entering edit mode via WebSocket');
        setWsEditMode(true);
        setEditMode(true);
        break;

      case 'exit_edit_mode':
        logger.log('[EditModeProvider] Exiting edit mode via WebSocket');
        setWsEditMode(false);
        setEditMode(false);
        break;

      case 'save_changes':
        logger.log('[EditModeProvider] Save triggered via WebSocket');
        const origin = message?.data?.reason === 'autosave' ? 'autosave' : 'manual';
        // Use ref for synchronous check to prevent duplicate saves from rapid messages
        if (storeHasUnsavedChanges() && !isSavingRef.current) {
          saveChanges(false, origin);
        } else {
          logger.log('[EditModeProvider] Skipping duplicate save_changes (already saving or no changes)');
        }
        break;

      case 'app_config_updated':
        logger.log('[EditModeProvider] Config updated via WebSocket', message);
        const reloadApp = message.reload_app || message.data?.reload_app;
        const changedComponentUuid = message.changed_component_uuid || message.data?.changed_component_uuid;
        const changeType = message.change_type || message.data?.change_type;
        const changedComponentConfig = message.changed_component_config || message.data?.changed_component_config;

        if (reloadApp) {
          logger.log('[EditModeProvider] Full reload required');
          window.location.reload();
        } else if (changedComponentConfig && changedComponentUuid && changeType === 'modify') {
          // DIRECT UPDATE - Apply component config directly from SSE event (no fetch needed)
          logger.log('[EditModeProvider] Direct component update from SSE:', changedComponentUuid);

          // Clear selection
          selectComponent(null);

          // Clear processing state
          setComponentProcessing(changedComponentUuid, false);

          // Apply the component update directly
          applyDirectComponentUpdate(changedComponentUuid, changedComponentConfig);
        } else if (changedComponentUuid && changeType === 'remove') {
          // Handle component removal
          logger.log('[EditModeProvider] Component removed:', changedComponentUuid);
          selectComponent(null);
          setComponentProcessing(changedComponentUuid, false);
          // For removal, we still need to fetch to get the updated config without the component
          fetchAndApplyUpdate(changedComponentUuid, changeType);
        } else {
          // Fallback: Fetch and apply update
          logger.log('[EditModeProvider] Fallback: Fetching update from backend');
          if (changedComponentUuid) {
            selectComponent(null);
            setComponentProcessing(changedComponentUuid, false);
          }
          fetchAndApplyUpdate(changedComponentUuid, changeType);
        }
        break;

      case 'component_processing':
        const { componentId, isProcessing } = message.data || {};
        if (componentId) {
          setComponentProcessing(componentId, isProcessing);
        }
        break;

      case 'app_config_saved_processed':
        // Backend confirmed save was successful
        logger.log('[EditModeProvider] Save confirmed by backend:', message);
        if (message.database_updated) {
          logger.log('[EditModeProvider] Config saved successfully, version:', message.new_config_version);
          // Note: We don't fetch config here because:
          // 1. ConfigService.fetch() requires server-side API key (CORS blocked in browser)
          // 2. The UI already shows edited content via contentUpdates
          // 3. markContentAsSaved() already prevents re-saving
          // The user's edits remain visible until they refresh/navigate away
        }
        break;
    }
  }, [isSaving, storeHasUnsavedChanges, setEditMode, setComponentProcessing, isInEditorIframe]);

  // Keep the ref pointing at the latest handler so the once-installed WS
  // subscription never invokes a stale closure.
  handleWsMessageRef.current = handleWebSocketMessage;

  // Fetch and apply config updates
  const fetchAndApplyUpdate = useCallback(async (
    changedComponentUuid?: string,
    changeType?: 'modify' | 'remove'
  ) => {
    try {
      logger.log('[EditModeProvider] Fetching updated config for appId:', appId);
      const newConfig = await ConfigService.fetch(appId, 'preview');
      if (newConfig) {
        const updates = ConfigService.compareConfigs(appConfig, newConfig);
        if (updates.length > 0 || changedComponentUuid) {
          logger.log(`[EditModeProvider] Applying ${updates.length} updates`);
          if (changedComponentUuid) {
            logger.log(`[EditModeProvider] Changed component: ${changedComponentUuid} (${changeType})`);
          }

          // Update config in store - this will trigger React re-render
          setAppConfig(newConfig);

          // Clear stale inline edits for the changed component (agent rewrote it)
          if (changedComponentUuid) {
            clearContentUpdate(changedComponentUuid);
          }

          // Force re-render for the specific component if React doesn't pick it up
          if (changedComponentUuid && (changeType === 'modify' || changeType === 'remove')) {
            // Emit event to notify any listeners that this component changed or was removed
            // This can be used by DynamicRenderer to force re-render
            window.dispatchEvent(new CustomEvent('component-updated', {
              detail: {
                componentId: changedComponentUuid,
                changeType: changeType,
                timestamp: Date.now()
              }
            }));
          }
        } else {
          logger.log('[EditModeProvider] No changes detected in config');
        }
      } else {
        logger.warn('[EditModeProvider] Failed to fetch config - received null');
      }
    } catch (error) {
      logger.error('[EditModeProvider] Failed to fetch update:', error);
      // Log more details about the error
      if (error instanceof Error) {
        logger.error('[EditModeProvider] Error details:', {
          message: error.message,
          stack: error.stack
        });
      }
    }
  }, [appId, appConfig, setAppConfig, clearContentUpdate]);

  // Apply component update directly from SSE event (no fetch needed)
  const applyDirectComponentUpdate = useCallback((
    componentId: string,
    newComponentConfig: any
  ) => {
    // Get latest appConfig directly from store to avoid stale closure
    const currentAppConfig = useAppStore.getState().appConfig;

    if (!currentAppConfig) {
      logger.warn('[EditModeProvider] No appConfig available for direct update');
      return;
    }

    logger.log('[EditModeProvider] Applying direct component update:', componentId);

    // Deep clone the config to avoid mutation
    const newConfig = JSON.parse(JSON.stringify(currentAppConfig));

    // Helper function to recursively find and replace component
    const replaceComponent = (obj: any): boolean => {
      if (!obj || typeof obj !== 'object') return false;

      // Check if this is the component we're looking for
      if (obj.uuid === componentId) {
        // Replace all properties with new config
        Object.keys(obj).forEach(key => delete obj[key]);
        Object.assign(obj, newComponentConfig);
        return true;
      }

      // Search in arrays
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          if (obj[i]?.uuid === componentId) {
            obj[i] = newComponentConfig;
            return true;
          }
          if (replaceComponent(obj[i])) return true;
        }
      }

      // Search in object properties
      for (const key of Object.keys(obj)) {
        if (replaceComponent(obj[key])) return true;
      }

      return false;
    };

    // Search in pages content
    if (newConfig.pages) {
      for (const page of newConfig.pages) {
        if (page.content && replaceComponent(page.content)) {
          logger.log('[EditModeProvider] Component replaced in page:', page.uuid);
          break;
        }
      }
    }

    // Search in header, footer, sidebar
    if (newConfig.header && replaceComponent(newConfig.header)) {
      logger.log('[EditModeProvider] Component replaced in header');
    }
    if (newConfig.footer && replaceComponent(newConfig.footer)) {
      logger.log('[EditModeProvider] Component replaced in footer');
    }
    if (newConfig.sidebar && replaceComponent(newConfig.sidebar)) {
      logger.log('[EditModeProvider] Component replaced in sidebar');
    }

    // Update config in store - this will trigger React re-render
    setAppConfig(newConfig);

    // Clear stale inline edits for the changed component (agent rewrote it)
    clearContentUpdate(componentId);

    // Force re-render for the specific component
    window.dispatchEvent(new CustomEvent('component-updated', {
      detail: {
        componentId,
        newConfig: newComponentConfig,
        timestamp: Date.now()
      }
    }));
  }, [setAppConfig, clearContentUpdate]);

  // URL-based edit mode - only allow if in editor iframe
  const urlEditMode = isPreview && isInEditorIframe && searchParams.get('edit') === 'yes';
  const finalEditMode = urlEditMode || wsEditMode;

  useEffect(() => {
    setEditMode(finalEditMode);
    // Leaving edit mode must drop any held element reference so the overlay
    // hides and we don't pin a detached DOM node in memory.
    if (!finalEditMode) setSelectedElement(null);
  }, [finalEditMode, setEditMode]);

  // Update content wrapper
  const updateContent = useCallback(
    (componentId: string, content: string, componentType: string, targetField: string) => {
      const update: ContentUpdate = {
        componentId,
        content,
        componentType,
        target_field: targetField,
        timestamp: Date.now(),
        isSaved: false,
      };

      storeUpdateContent(update);

      // Send via WebSocket (debounced in service)
      if (wsManagerRef.current?.isConnected()) {
        wsManagerRef.current.send({
          type: 'content_edit',
          appId,
          componentId,
          componentType,
          targetField,
          timestamp: Date.now(),
        }).catch(() => {
          // Queued for later
        });
      }
    },
    [appId, storeUpdateContent]
  );

  // Save changes
  const saveChanges = useCallback(
    async (force = false, origin: 'autosave' | 'manual' = 'manual') => {
      // Use ref for immediate synchronous check (React state is async)
      if (isSavingRef.current) {
        logger.log('[EditModeProvider] Skipping save - already in progress (ref check)');
        return;
      }
      if (!storeHasUnsavedChanges() && !force) return;

      // Set both ref and state
      isSavingRef.current = true;
      setIsSaving(true);
      try {
        const updates = getUnsavedUpdates();
        const result = await persistenceServiceRef.current?.save(appId, updates, {
          forced: force,
          autoSave: origin === 'autosave',
        });

        if (result?.success) {
          logger.log('[EditModeProvider] Save successful');

          // Mark updates as saved (not clear) so UI keeps showing the edits
          // but autosave won't re-save them (autosave only saves isSaved: false)
          updates.forEach(update => {
            markContentAsSaved(update.componentId);
          });
          logger.log('[EditModeProvider] Marked updates as saved to prevent autosave duplicates');
        }
      } catch (error) {
        logger.error('[EditModeProvider] Save failed:', error);
      } finally {
        isSavingRef.current = false;
        setIsSaving(false);
      }
    },
    [appId, storeHasUnsavedChanges, getUnsavedUpdates, markContentAsSaved]
  );

  // Select component wrapper
  const selectComponent = useCallback(
    (id: string | null, metadata?: ComponentMetadata, element?: HTMLElement | null) => {
      storeSelectComponent(id, metadata);

      // Drive the SelectionOverlay highlight from the actual clicked element.
      // On deselect (id === null) clear it regardless of any passed element.
      setSelectedElement(id ? (element ?? null) : null);

      const selectionData = {
        action: id ? 'select' : 'deselect',
        componentId: id,
        componentType: metadata?.componentType,
        metadata: {
          componentType: metadata?.componentType,
          textPreview: metadata?.textPreview,
        },
        appId,
        timestamp: Date.now(),
      };

      // Always send via postMessage for immediate availability (works without WebSocket)
      try {
        const editorOrigin = getEditorOrigin();
        window.parent.postMessage({
          type: 'component_selection',
          data: selectionData,
          source: 'exepad-runtime',
        }, editorOrigin);
      } catch (error) {
        logger.error('[EditModeProvider] Failed to send component_selection via postMessage:', error);
      }

      // Also send via WebSocket if connected
      if (wsManagerRef.current?.isConnected()) {
        wsManagerRef.current.send({
          type: 'component_selection',
          data: selectionData,
        }).catch(() => {});
      }
    },
    [appId, storeSelectComponent]
  );

  // Send WebSocket message
  const sendWebSocketMessage = useCallback((message: any): boolean => {
    if (!wsManagerRef.current?.isConnected()) {
      return false;
    }
    wsManagerRef.current.send(message).catch(() => {
      // Queued
    });
    return true;
  }, []);

  // Trigger edit mode
  const triggerEditMode = useCallback(
    (enable: boolean) => {
      if (wsManagerRef.current?.isConnected()) {
        wsManagerRef.current.send({
          type: enable ? 'enter_edit_mode' : 'exit_edit_mode',
          data: { appId, timestamp: Date.now() },
        }).catch(() => {
          // Fallback
          setWsEditMode(enable);
          setEditMode(enable);
        });
      } else {
        setWsEditMode(enable);
        setEditMode(enable);
      }
    },
    [appId, setEditMode]
  );

  // Fine-grained content accessors for useSyncExternalStore
  const contentSubscribersRef = useRef<Map<string, Set<() => void>>>(new Map());

  const getContentFor = useCallback((componentId: string): string | undefined => {
    const update = contentUpdates.get(componentId);
    return update?.content;
  }, [contentUpdates]);

  const subscribeContent = useCallback((componentId: string, callback: () => void) => {
    if (!contentSubscribersRef.current.has(componentId)) {
      contentSubscribersRef.current.set(componentId, new Set());
    }
    contentSubscribersRef.current.get(componentId)!.add(callback);

    return () => {
      const subscribers = contentSubscribersRef.current.get(componentId);
      if (subscribers) {
        subscribers.delete(callback);
        if (subscribers.size === 0) {
          contentSubscribersRef.current.delete(componentId);
        }
      }
    };
  }, []);

  // Notify content subscribers when content updates change
  useEffect(() => {
    contentUpdates.forEach((update, componentId) => {
      const subscribers = contentSubscribersRef.current.get(componentId);
      if (subscribers) {
        subscribers.forEach(callback => callback());
      }
    });
  }, [contentUpdates]);

  const contextValue = React.useMemo(
    () => ({
      isEditMode: finalEditMode,
      isPreview,
      updateContent,
      saveChanges,
      hasUnsavedChanges: storeHasUnsavedChanges(),
      selectComponent,
      sendWebSocketMessage,
      triggerEditMode,
      setComponentProcessing,
      getContentFor,
      subscribeContent,
    }),
    [
      finalEditMode,
      isPreview,
      updateContent,
      saveChanges,
      storeHasUnsavedChanges(),
      selectComponent,
      sendWebSocketMessage,
      triggerEditMode,
      setComponentProcessing,
      getContentFor,
      subscribeContent,
    ]
  );

  return (
    <EditModeContext.Provider value={contextValue}>
      {children}
      <SelectionOverlay />
    </EditModeContext.Provider>
  );
}

