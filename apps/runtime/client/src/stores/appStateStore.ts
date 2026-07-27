/**
 * App State Store
 * Unified Zustand-based state management for code components.
 *
 * Features:
 * - Single store for all shared state
 * - $persist support for localStorage persistence
 * - Same API for all CodeComponents via SDK hooks
 *
 * Type definitions live in ./types/appStateTypes.ts — this file contains
 * only the Zustand store creation, middleware wiring, and module-level vars.
 */

import { create } from 'zustand';
import { devtools, persist, createJSONStorage } from 'zustand/middleware';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';

// All types are defined in the types module and re-exported here for
// backwards-compatibility — consumers can import from either location.
export type {
  StateSchema,
  AppConfig,
  RouterInterface,
  AppStateStore,
} from './types/appStateTypes';

import type {
  AppConfig,
  RouterInterface,
  AppStateStore,
} from './types/appStateTypes';

/**
 * Per-app localStorage scoping.
 * Set before store initialization so the persist middleware writes to
 * `exepad-app-state:<appId>` instead of a single global key.
 */
let _currentAppId = '';

/**
 * App ID used for API routing (public_id / slug).
 * For domain-based apps this differs from _currentAppId (UUID used for localStorage).
 */
let _apiAppId = '';

export function setCurrentAppId(appId: string): void {
  _currentAppId = appId;
}

export function setApiAppId(apiAppId: string): void {
  _apiAppId = apiAppId;
}

/**
 * Create the Zustand store with persistence
 */
export const useAppStateStore = create<AppStateStore>()(
  devtools(
    persist(
      (set, get) => ({
        // Internal state
        _state: {},
        _router: null,
        _basePath: '',
        _initialized: false,
        _persistKeys: new Set<string>(),
        _userModifiedKeys: new Set<string>(),
        _editingRecord: null,
        _setEditingRecord: (record) => set({ _editingRecord: record }),

        /**
         * Initialize the store from app config.
         * Detects $persist config on state entries and performs smart merge:
         * - User-modified keys keep their existing value
         * - Config-sourced keys are updated from the new config
         */
        initialize: (config: AppConfig, router?: RouterInterface, basePath?: string) => {
          const store = get();
          const rawState = config.state || {};

          // Process state definitions: detect $persist flags, extract initial values
          const persistKeys = new Set<string>();
          const initialState: Record<string, unknown> = {};

          for (const [key, value] of Object.entries(rawState)) {
            if (
              value !== null &&
              typeof value === 'object' &&
              !Array.isArray(value) &&
              '$persist' in (value as Record<string, unknown>)
            ) {
              const cfg = value as { $persist: boolean | string; initial: unknown };
              initialState[key] = cfg.initial;
              if (cfg.$persist) {
                persistKeys.add(key);
              }
            } else {
              initialState[key] = value;
            }
          }

          // Smart merge strategy:
          // - Rehydration (page reload): _userModifiedKeys is empty because it's not
          //   persisted, but _initialized is true from persistence. In this case,
          //   preserve ALL existing (persisted) values — they were the user's
          //   previous-session modifications.
          // - Re-initialization (HMR/config push): _userModifiedKeys tracks what the
          //   user changed during this session. Only preserve those keys; apply new
          //   config values for everything else.
          const existingState = store._state;
          const userModified = store._userModifiedKeys;
          const isRehydration = store._initialized && userModified.size === 0;
          const mergedState: Record<string, unknown> = {};

          for (const [key, value] of Object.entries(initialState)) {
            if (key === 'auth') {
              // Auth state must come from the live session check, not localStorage.
              // This avoids stale persisted auth causing refresh-time redirects.
              mergedState[key] = value;
            } else if (isRehydration && key in existingState) {
              // Rehydration: preserve persisted values from previous session
              mergedState[key] = existingState[key];
            } else if (userModified.has(key) && key in existingState) {
              // Re-init: preserve user-modified values from current session
              mergedState[key] = existingState[key];
            } else {
              mergedState[key] = value;
            }
          }

          // Keep user-modified keys that aren't in new config (dynamic runtime keys)
          for (const key of userModified) {
            if (!(key in mergedState) && key in existingState) {
              mergedState[key] = existingState[key];
            }
          }

          // Preserve scaffold-injected state (prefixed with _scaffold_)
          for (const [key, value] of Object.entries(existingState)) {
            if (key.startsWith('_scaffold_') && !(key in mergedState)) {
              mergedState[key] = value;
            }
          }

          set({
            _state: mergedState,
            _persistKeys: persistKeys,
            _router: router || null,
            _basePath: basePath || '',
            _initialized: true,
          });

        },

      /**
       * Reset the store to initial state
       */
      reset: () => {
        set({
          _state: {},
          _router: null,
          _basePath: '',
          _initialized: false,
          _persistKeys: new Set<string>(),
          _userModifiedKeys: new Set<string>(),
          _editingRecord: null,
        });
      },

      /**
       * Get a state value by key
       */
      get: <T = unknown>(key: string): T => {
        const state = get()._state;

        // Support dot notation for nested access
        if (key.includes('.')) {
          const parts = key.split('.');
          let value: unknown = state;
          for (const part of parts) {
            if (value === null || value === undefined) return undefined as T;
            value = (value as Record<string, unknown>)[part];
          }
          return value as T;
        }

        return state[key] as T;
      },

      /**
       * Set a state value by key
       */
      set: (key: string, value: unknown) => {
        set((store) => {
          const newState = { ...store._state };
          const rootKey = key.includes('.') ? key.split('.')[0] : key;

          // Track that this key was explicitly modified by a user action
          const updatedModified = new Set(store._userModifiedKeys);
          updatedModified.add(rootKey);

          // Support dot notation for nested updates
          if (key.includes('.')) {
            const parts = key.split('.');
            let current: Record<string, unknown> = newState;

            for (let i = 0; i < parts.length - 1; i++) {
              const part = parts[i];
              if (current[part] === undefined || current[part] === null) {
                current[part] = {};
              }
              // Preserve arrays — clone with [...] instead of {...} which destroys them
              if (Array.isArray(current[part])) {
                current[part] = [...(current[part] as unknown[])];
              } else {
                current[part] = { ...(current[part] as Record<string, unknown>) };
              }
              current = current[part] as Record<string, unknown>;
            }

            current[parts[parts.length - 1]] = value;
          } else {
            newState[key] = value;
          }

          return { _state: newState, _userModifiedKeys: updatedModified };
        });
      },

      /**
       * Update a state value with a function
       */
      update: <T = unknown>(key: string, updater: (prev: T) => T) => {
        const current = get().get<T>(key);
        get().set(key, updater(current));
      },

      /**
       * Push an item to an array state
       */
      push: (key: string, item: unknown) => {
        const current = get().get<unknown[]>(key) || [];
        get().set(key, [...current, item]);
      },

      /**
       * Remove an item from an array state
       */
      remove: (key: string, predicate: ((item: unknown, index: number) => boolean) | number) => {
        const current = get().get<unknown[]>(key) || [];

        if (typeof predicate === 'number') {
          // Remove by index
          get().set(key, current.filter((_, i) => i !== predicate));
        } else {
          // Remove by predicate
          get().set(key, current.filter((item, i) => !predicate(item, i)));
        }
      },

      /**
       * Update an item in an array state
       */
      updateItem: (key: string, predicate: ((item: unknown, index: number) => boolean) | number, updates: unknown) => {
        const current = get().get<unknown[]>(key) || [];

        const newArray = current.map((item, i) => {
          const shouldUpdate = typeof predicate === 'number' ? i === predicate : predicate(item, i);
          if (shouldUpdate) {
            if (typeof item === 'object' && item !== null && typeof updates === 'object' && updates !== null) {
              return { ...item, ...updates };
            }
            return updates;
          }
          return item;
        });

        get().set(key, newArray);
      },

      /**
       * Clear an array state
       */
      clear: (key: string) => {
        get().set(key, []);
      },

      /**
       * Check if store is initialized
       */
      isInitialized: () => get()._initialized,
    }),
    {
      name: 'exepad-app-state',
      storage: createJSONStorage(() => {
        if (typeof window === 'undefined') {
          // No-op storage for SSR
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        // Custom adapter that scopes localStorage keys per app
        return {
          getItem: (name: string) => {
            const key = _currentAppId ? `${name}:${_currentAppId}` : name;
            let value = localStorage.getItem(key);
            // One-time migration from legacy global key.
            if (!value && _currentAppId) {
              const legacyValue = localStorage.getItem(name);
              if (legacyValue) {
                try {
                  const parsed = JSON.parse(legacyValue);
                  if (parsed?.state?._initialized) {
                    localStorage.setItem(key, legacyValue);
                    localStorage.removeItem(name);
                    value = legacyValue;
                  }
                } catch {
                  // Legacy value is not valid JSON — skip migration
                }
              }
            }
            return value;
          },
          setItem: (name: string, value: string) => {
            const key = _currentAppId ? `${name}:${_currentAppId}` : name;
            localStorage.setItem(key, value);
          },
          removeItem: (name: string) => {
            const key = _currentAppId ? `${name}:${_currentAppId}` : name;
            localStorage.removeItem(key);
          },
        };
      }),
      // Persist state values, filtered by $persist config or naming heuristics
      partialize: (state) => ({
        _state: Object.fromEntries(
          Object.entries(state._state).filter(([key]) => {
            // Auth is derived from the session cookie via auth_me and should
            // never be restored from localStorage.
            if (key === 'auth') {
              return false;
            }
            // If $persist keys are explicitly defined, use them exclusively
            if (state._persistKeys.size > 0) {
              return state._persistKeys.has(key);
            }
            // Fallback: legacy naming convention heuristics (backward compat)
            if (key.startsWith('show') || key.includes('Modal') || key.includes('Confirm')) {
              return false;
            }
            if (key.startsWith('editing') || key.startsWith('selected')) {
              return false;
            }
            if (key.startsWith('isLoading') || key.endsWith('Loading')) {
              return false;
            }
            return true;
          })
        ),
        _initialized: state._initialized,
      }),
      // Skip automatic hydration at module-import time: `_currentAppId` is still
      // '' then, so the persist storage adapter would read/write the UNSCOPED
      // `exepad-app-state` key. Instead, useRuntimeStore sets the per-app id via
      // setCurrentAppId() and then calls `useAppStateStore.persist.rehydrate()`,
      // so hydration reads the correct `exepad-app-state:<appId>` key. Without
      // this, per-app $persist state written under the scoped key was never read
      // back on reload and was overwritten with config initial values.
      skipHydration: true,
      // Handle hydration to merge persisted state with initial state
      onRehydrateStorage: () => {
        return (_state, error) => {
          if (error) {
            console.error('[AppStateStore] Hydration error:', error);
          }
        };
      },
    }
  ),
  {
    name: 'AppStateStore',
    enabled: import.meta.env.MODE === 'development',
  }
  )
);

/**
 * SSR-safe shallow selector for the app state store.
 * Uses `useSyncExternalStoreWithSelector` (via zustand/traditional) which properly
 * caches the server snapshot result with custom equality functions.
 */
export function useAppStateShallow<U>(
  selector: (state: AppStateStore) => U
): U {
  return useStoreWithEqualityFn(useAppStateStore, selector, shallow);
}

/**
 * Export store instance for direct access (useful for CodeComponents)
 */
export const getAppStateStore = () => useAppStateStore.getState();

/**
 * Subscribe to store changes
 */
export const subscribeToAppState = useAppStateStore.subscribe;
