/**
 * Schema Rollback
 *
 * Attempts to reverse schema changes by comparing current schema to the
 * previous snapshot. Only works for safe (additive) changes — destructive
 * operations like dropped columns cannot be reversed.
 */

import type { DeploymentConfig } from './types';
import type { ExistingTable, ExistingColumn } from '../schema/types';
import { introspectTableREST } from './d1-introspect';
import { executeD1DDL, executeD1DDLBatch } from './d1';

export interface RollbackResult {
  success: boolean;
  statements: string[];
  details: string[];
}

/**
 * Attempt to rollback the schema to a previous state.
 *
 * Strategy:
 * - Columns that were added (not in previous) can be dropped
 * - Tables that were created (not in previous) can be dropped
 * - Columns that were dropped (in previous but not in current) CANNOT be restored (data is lost)
 * - Index changes are handled by dropping new indexes and recreating previous ones
 *
 * Note: This only handles safe rollbacks. If data was lost due to destructive
 * migrations, it cannot be recovered.
 */
export async function rollbackSchema(
  config: DeploymentConfig,
  dbId: string,
  previousSchema: ExistingTable[],
  /**
   * The set of model table names this deploy could legitimately have created.
   * When provided, the "drop newly created tables" cleanup ONLY drops tables in
   * this set — so a table for a model that was merely REMOVED from the config
   * (which may hold live user data) is never dropped. When omitted, the cleanup
   * falls back to the previous-snapshot check alone. Platform/system tables
   * (any `_`-prefixed name) are NEVER dropped, regardless of this list.
   */
  createdTableAllowList?: Iterable<string>
): Promise<RollbackResult> {
  const statements: string[] = [];
  const details: string[] = [];
  let success = true;

  const previousTableNames = new Set(previousSchema.map((t) => t.name));

  // Get current state of all tables that existed previously
  for (const prevTable of previousSchema) {
    const currentTable = await introspectTableREST(config, dbId, prevTable.name);

    if (!currentTable) {
      // Table was somehow dropped — we can't recover it without data
      details.push(`[${prevTable.name}] Table missing — cannot restore without data`);
      continue;
    }

    // Find columns that were added (in current but not in previous)
    const prevColNames = new Set(prevTable.columns.map((c) => c.name));
    const addedColumns = currentTable.columns.filter((c) => !prevColNames.has(c.name));

    for (const col of addedColumns) {
      // Skip system columns — they should always be present
      if (['owner_id', 'created_at', 'updated_at'].includes(col.name)) continue;

      const sql = `ALTER TABLE "${escapeDoubleQuote(prevTable.name)}" DROP COLUMN "${escapeDoubleQuote(col.name)}"`;
      statements.push(sql);
      details.push(`[${prevTable.name}] Dropping added column: ${col.name}`);
    }

    // Restore indexes: drop new ones, recreate missing previous ones
    const prevIndexNames = new Set(prevTable.indexes.map((i) => i.name));
    const currentIndexNames = new Set(currentTable.indexes.map((i) => i.name));

    // Drop indexes that were added
    for (const idx of currentTable.indexes) {
      if (!prevIndexNames.has(idx.name)) {
        statements.push(`DROP INDEX IF EXISTS "${escapeDoubleQuote(idx.name)}"`);
        details.push(`[${prevTable.name}] Dropping added index: ${idx.name}`);
      }
    }

    // Recreate indexes that were removed
    for (const idx of prevTable.indexes) {
      if (!currentIndexNames.has(idx.name)) {
        const uniqueKeyword = idx.unique ? 'UNIQUE ' : '';
        const cols = idx.columns.map((c) => `"${escapeDoubleQuote(c)}"`).join(', ');
        statements.push(
          `CREATE ${uniqueKeyword}INDEX IF NOT EXISTS "${escapeDoubleQuote(idx.name)}" ON "${escapeDoubleQuote(prevTable.name)}" (${cols})`
        );
        details.push(`[${prevTable.name}] Recreating removed index: ${idx.name}`);
      }
    }
  }

  // Check for tables that were newly created (not in previous snapshot)
  // We'll introspect sqlite_master to find all user tables
  const allowSet = createdTableAllowList ? new Set(createdTableAllowList) : null;
  try {
    // Exclude ALL platform/system tables. The previous `NOT LIKE '_exepad_%'`
    // was broken: `_` is a single-char LIKE wildcard, so that pattern did NOT
    // exclude per-app system tables like `_auth_users`, `_auth_sessions`,
    // `_auth_api_keys`, `_files` — dropping those on a rollback wipes live
    // end-user auth + file metadata. The builder reserves the leading `_` for
    // platform tables, so exclude every `_`-prefixed name outright.
    const allTablesResult = await executeD1DDL(
      config,
      dbId,
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND substr(name, 1, 1) != '_'`
    );

    const currentTableNames = (allTablesResult.results as Record<string, unknown>[]).map(
      (r) => r.name as string
    );

    for (const tableName of currentTableNames) {
      if (previousTableNames.has(tableName)) continue;
      // When an allow-list is supplied, ONLY drop tables this deploy could have
      // created. A table for a model that was merely REMOVED from the config
      // (which may still hold live user rows) is not in the allow-list, so it
      // is preserved rather than dropped.
      if (allowSet && !allowSet.has(tableName)) {
        details.push(`Preserving table outside this deploy's model set: ${tableName}`);
        continue;
      }
      statements.push(`DROP TABLE IF EXISTS "${escapeDoubleQuote(tableName)}"`);
      details.push(`Dropping newly created table: ${tableName}`);
    }
  } catch (error) {
    details.push(`Failed to list tables for cleanup: ${error instanceof Error ? error.message : error}`);
  }

  // Execute rollback statements
  if (statements.length === 0) {
    details.push('No rollback actions needed — schema unchanged or changes are irreversible');
    return { success: true, statements, details };
  }

  // Execute the whole rollback ATOMICALLY. The prior per-statement loop could
  // leave the schema half-reverted (some drops applied, others not) and still
  // report success at the call site — e.g. a DROP COLUMN that fails because the
  // column is indexed. A single transactional batch either fully reverts or
  // leaves the schema exactly as it was.
  try {
    await executeD1DDLBatch(config, dbId, statements);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    details.push(`Rollback batch failed (no statements applied): ${msg}`);
    success = false;
  }

  return { success, statements, details };
}

function escapeDoubleQuote(s: string): string {
  return s.replace(/"/g, '""');
}
