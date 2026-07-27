/**
 * Schema types for D1 database generation
 */

import type {
  ColumnType,
  ColumnProps,
  ModelProps,
  IndexProps,
  CrudPolicyProps,
  AuthLevel,
  ForeignKeyRef,
  MigrationPolicy,
} from '@exepad/types';

// Re-export core types for backward compatibility
export type {
  ColumnType,
  ColumnProps,
  ModelProps,
  IndexProps,
  CrudPolicyProps,
  AuthLevel,
  ForeignKeyRef,
  MigrationPolicy,
};

/**
 * SQLite type mapping
 */
export const SQLITE_TYPE_MAP: Record<ColumnType, string> = {
  text: 'TEXT',
  integer: 'INTEGER',
  real: 'REAL',
  blob: 'BLOB',
  json: 'TEXT', // JSON stored as TEXT in SQLite
};

/**
 * Auto-added primary key column.
 * Injected when no user-defined column has isPrimary: true.
 */
export const DEFAULT_PRIMARY_KEY: ColumnProps = {
  name: 'id', type: 'integer', isPrimary: true,
};

/**
 * System columns that are auto-managed
 */
export const SYSTEM_COLUMNS: ColumnProps[] = [
  { name: 'owner_id', type: 'text', isNullable: false },
  { name: 'created_at', type: 'text', isNullable: false },
  { name: 'updated_at', type: 'text', isNullable: false },
];

/**
 * Generated SQL statements
 */
export interface GeneratedSchema {
  /** CREATE TABLE statements */
  createTables: string[];

  /** CREATE INDEX statements */
  createIndexes: string[];

  /** All statements combined */
  all: string[];
}

/**
 * Migration result
 */
export interface MigrationResult {
  /** Statements to execute */
  statements: string[];

  /** Warnings about potential issues */
  warnings: string[];

  /** Whether this is a destructive migration */
  isDestructive: boolean;
}

/**
 * Existing table schema (from D1 introspection)
 */
export interface ExistingTable {
  name: string;
  columns: ExistingColumn[];
  indexes: ExistingIndex[];
}

export interface ExistingColumn {
  name: string;
  type: string;
  notnull: boolean;
  dflt_value: string | null;
  pk: boolean;
}

export interface ExistingIndex {
  name: string;
  unique: boolean;
  columns: string[];
}
