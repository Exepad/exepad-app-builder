// src/app_runtime/interfaces/state/index.ts
// State schema interfaces for app state management

/**
 * Defines the initial state of an app as a key-value map where types are inferred from the initial values.
 *
 * @example
 * {
 *   "currentStep": 0,
 *   "selectedService": null,
 *   "cartItems": [],
 *   "isLoading": false,
 *   "theme": { "$persist": true, "initial": "light" }
 * }
 */
export type StateSchema = Record<string, unknown>;

/**
 * Configures a state variable to be automatically persisted to storage, surviving page reloads.
 *
 * @example { "$persist": true, "initial": "light" }
 * @example { "$persist": "custom.cart.items", "initial": [], "$debounce": 1000 }
 */
export interface PersistentStateProps {
  /** Enables persistence. Use true for automatic key naming, or a custom path string for explicit storage location. */
  $persist: boolean | string;
  /** The initial value used when no persisted value exists yet. */
  initial: unknown;
  /** Debounce delay in milliseconds for frequent state updates, preventing excessive writes to storage. */
  $debounce?: number;
}

/**
 * The actual runtime state values (resolved data, not the schema definition).
 */
export type AppStateValues = Record<string, unknown>;
