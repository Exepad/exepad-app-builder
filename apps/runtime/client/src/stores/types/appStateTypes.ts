/**
 * App State Store — Type Definitions
 *
 * All types and interfaces for the app state store.
 * Simplified to state-only: no computed, no actions, no expression engine.
 * Code components use SDK primitives (useModel, useHandler, navigate, toast) directly.
 */

// ─── Schema Types ─────────────────────────────────────────────────────────────

/**
 * State schema - simplified key-value format
 * Types are inferred from initial values
 */
export type StateSchema = Record<string, unknown>;

// ─── Config & Context Types ────────────────────────────────────────────────────

/**
 * App configuration — state only.
 * Code components handle logic directly via SDK hooks
 * (useModel, useHandler, navigate, toast, etc.).
 */
export interface AppConfig {
  state?: StateSchema;
}

/**
 * Router interface for navigation
 */
export interface RouterInterface {
  push: (url: string) => void;
  replace: (url: string) => void;
}

// ─── Store Interface ───────────────────────────────────────────────────────────

/**
 * App State Store interface
 */
export interface AppStateStore {
  // Internal state
  _state: Record<string, unknown>;
  _router: RouterInterface | null;
  _basePath: string;
  _initialized: boolean;
  /** Keys explicitly configured with $persist in state config */
  _persistKeys: Set<string>;
  /** Keys explicitly modified by user actions (set/push/remove/updateItem) */
  _userModifiedKeys: Set<string>;
  /** Row data stored by DataTable row actions for automatic id injection in CRUD forms */
  _editingRecord: Record<string, unknown> | null;
  _setEditingRecord: (record: Record<string, unknown> | null) => void;

  // Initialization
  initialize: (config: AppConfig, router?: RouterInterface, basePath?: string) => void;
  reset: () => void;

  // State access
  get: <T = unknown>(key: string) => T;
  set: (key: string, value: unknown) => void;
  update: <T = unknown>(key: string, updater: (prev: T) => T) => void;

  // Array helpers
  push: (key: string, item: unknown) => void;
  remove: (key: string, predicate: ((item: unknown, index: number) => boolean) | number) => void;
  updateItem: (key: string, predicate: ((item: unknown, index: number) => boolean) | number, updates: unknown) => void;
  clear: (key: string) => void;

  // Check if initialized
  isInitialized: () => boolean;
}
