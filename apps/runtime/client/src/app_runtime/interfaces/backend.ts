// src/app_runtime/interfaces/backend.ts
// Backend configuration interfaces

// Core backend types — canonical source is @exepad/types
export type {
  ModelProps,
  ColumnProps,
  ColumnType,
  IndexProps,
  AccessLevel,
  AuthLevel,
  CrudPolicyProps,
  ForeignKeyRef,
  MigrationPolicy,
  HandlerProps,
  InputProps,
  OutputProps,
  InjectedProps,
  AuthProviderProps,
  SecurityProps,
  SecretProps,
} from '@exepad/types';

import type {
  ModelProps,
  HandlerProps,
  AuthLevel,
} from '@exepad/types';

import type { StaticDatasetProps } from './data';

// ============================================================================
// Backend Config — Discriminated Union
// ============================================================================

/**
 * Backend configuration is a discriminated union on `mode`:
 * - "static"  → Self-contained JSON artifact. No server, no database.
 * - "dynamic" → Deployed application with a provisioned database + backend.
 * - "none"    → Explicitly no backend. Frontend-only app.
 */
export type BackendProps = StaticBackend | DynamicBackend | NoneBackend;

// ─── None Mode ──────────────────────────────────────────────────────────────
// Explicitly marks an app as having no backend. Frontend-only.

export interface NoneBackend {
  mode: 'none';
}

// ─── Static Mode ────────────────────────────────────────────────────────────
// Self-contained JSON artifact. No server, no database.
// Use case: micro UI, chart, report, preview, MCP artifact response.

export interface StaticBackend {
  mode: 'static';

  /** Inline data layer */
  data: {
    /** Map of dataset names to static dataset definitions. Components reference via 'dataset.' prefix. */
    datasets: Record<string, StaticDatasetProps>;
  };
}

// ─── Dynamic Mode ───────────────────────────────────────────────────────────
// Deployed application with a provisioned SQLite database, auto-CRUD models,
// custom handlers, and file storage.

export interface DynamicBackend {
  mode: 'dynamic';

  /** Data models with automatic CRUD endpoints */
  models?: ModelProps[];

  /** Custom JavaScript handlers for complex logic */
  handlers?: HandlerProps[];

  // The following fields are defined in @exepad/types and used by deploy-utils/app-backend.
  // The runtime passes them through but does not interpret them.
  sources?: Record<string, unknown>;
  storage?: unknown;
  queues?: unknown[];
  tasks?: unknown[];
  pipelines?: unknown[];
  realtime?: unknown;
}

// ============================================================================
// Type Guards
// ============================================================================

/** Type guard: checks if backend config is static mode */
export function isStaticBackend(config: BackendProps | undefined | null): config is StaticBackend {
  return config?.mode === 'static';
}

/** Type guard: checks if backend config is dynamic mode */
export function isDynamicBackend(config: BackendProps | undefined | null): config is DynamicBackend {
  return config?.mode === 'dynamic';
}

/** Type guard: checks if backend config is none mode (no backend) */
export function isNoneBackend(config: BackendProps | undefined | null): config is NoneBackend {
  return config?.mode === 'none';
}

// Additional backend types (Sources, Storage, Queues, Tasks, Pipelines, Realtime)
// are defined in @exepad/types and used by deploy-utils and app-backend.
// The runtime does not use them directly.

