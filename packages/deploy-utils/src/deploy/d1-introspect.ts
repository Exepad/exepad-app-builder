/**
 * REST-based D1 introspection
 *
 * Mirrors the D1Database-based introspectTable() from schema/migrations.ts
 * but uses the Cloudflare REST API (executeD1DDL) instead of a D1 binding.
 *
 * Important: PRAGMA queries must be supported by the D1 REST API.
 * If they are not, introspection will throw (not silently return null),
 * so the caller knows the table exists but couldn't be introspected.
 */

import type { DeploymentConfig } from './types';
import type { ExistingTable, ExistingColumn, ExistingIndex } from '../schema/types';
import { executeD1DDL } from './d1';

/**
 * Introspect a table via the Cloudflare D1 REST API.
 * Returns null only if the table genuinely doesn't exist.
 * Throws if the table exists but introspection fails (e.g., PRAGMA unsupported).
 */
export async function introspectTableREST(
  config: DeploymentConfig,
  dbId: string,
  tableName: string
): Promise<ExistingTable | null> {
  // 1. Check if table exists (SELECT from sqlite_master — always supported)
  let tableCheck;
  try {
    tableCheck = await executeD1DDL(
      config,
      dbId,
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${escapeSingleQuote(tableName)}'`
    );
  } catch (error) {
    // If we can't even query sqlite_master, something is fundamentally wrong
    throw new Error(
      `[introspect] Cannot query sqlite_master for table "${tableName}": ${error instanceof Error ? error.message : error}`
    );
  }

  if (!tableCheck.results || tableCheck.results.length === 0) {
    return null; // Table genuinely doesn't exist
  }

  // Table exists — introspection failures below are errors, NOT "table not found"

  // 2. Get column info via PRAGMA
  let columnsResult;
  try {
    columnsResult = await executeD1DDL(
      config,
      dbId,
      `PRAGMA table_info("${escapeDoubleQuote(tableName)}")`
    );
  } catch (error) {
    throw new Error(
      `[introspect] PRAGMA table_info failed for "${tableName}". ` +
      `The D1 REST API may not support PRAGMA queries. ` +
      `Error: ${error instanceof Error ? error.message : error}`
    );
  }

  // Validate we got meaningful results (empty PRAGMA result = API returned OK but no data)
  if (!columnsResult.results || columnsResult.results.length === 0) {
    throw new Error(
      `[introspect] PRAGMA table_info returned no columns for "${tableName}". ` +
      `The D1 REST API may not support PRAGMA queries or the table is corrupt.`
    );
  }

  const columns: ExistingColumn[] = (columnsResult.results as Record<string, unknown>[]).map(
    (row) => ({
      name: row.name as string,
      type: row.type as string,
      notnull: (row.notnull as number) === 1,
      dflt_value: row.dflt_value as string | null,
      pk: (row.pk as number) === 1,
    })
  );

  // 3. Get index list via PRAGMA
  let indexListResult;
  try {
    indexListResult = await executeD1DDL(
      config,
      dbId,
      `PRAGMA index_list("${escapeDoubleQuote(tableName)}")`
    );
  } catch (error) {
    // Index introspection failure is non-fatal — return table with empty indexes
    console.warn(
      `[introspect] PRAGMA index_list failed for "${tableName}", proceeding without index info: ${error instanceof Error ? error.message : error}`
    );
    return { name: tableName, columns, indexes: [] };
  }

  const indexes: ExistingIndex[] = [];

  for (const indexRow of indexListResult.results as Record<string, unknown>[]) {
    const indexName = indexRow.name as string;
    const isUnique = (indexRow.unique as number) === 1;

    // Skip sqlite auto-indexes
    if (indexName.startsWith('sqlite_autoindex_')) continue;

    try {
      const indexInfoResult = await executeD1DDL(
        config,
        dbId,
        `PRAGMA index_info("${escapeDoubleQuote(indexName)}")`
      );

      const indexColumns = (indexInfoResult.results as Record<string, unknown>[])
        .sort((a, b) => (a.seqno as number) - (b.seqno as number))
        .map((row) => row.name as string);

      indexes.push({ name: indexName, unique: isUnique, columns: indexColumns });
    } catch (error) {
      console.warn(
        `[introspect] PRAGMA index_info failed for index "${indexName}", skipping: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  return { name: tableName, columns, indexes };
}

function escapeSingleQuote(s: string): string {
  return s.replace(/'/g, "''");
}

function escapeDoubleQuote(s: string): string {
  return s.replace(/"/g, '""');
}
