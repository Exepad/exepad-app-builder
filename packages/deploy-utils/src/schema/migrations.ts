/**
 * Migration Generator - Generate safe migrations for D1 schema changes
 */

import {
  ModelProps,
  ColumnProps,
  MigrationResult,
  ExistingTable,
  ExistingColumn,
  ColumnType,
  MigrationPolicy,
  SQLITE_TYPE_MAP,
  SYSTEM_COLUMNS,
  DEFAULT_PRIMARY_KEY,
} from './types';
import { generateCreateTableSQL, generateIndexSQL } from './builder';

/**
 * Escape SQL identifier
 */
function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Compare column types (normalize for comparison)
 */
function normalizeType(type: string): string {
  return type.toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * Introspect existing table schema via D1
 */
export async function introspectTable(
  db: D1Database,
  tableName: string
): Promise<ExistingTable | null> {
  // The existence check is separate from the PRAGMA introspection below: only a
  // genuinely-missing table returns null. If the table EXISTS but a later PRAGMA
  // fails, we must NOT map that to "table missing" — that would make callers
  // (generateModelMigration) emit CREATE TABLE IF NOT EXISTS (a no-op) and a
  // silently wrong diff. Rethrow instead so the deploy fails loudly. Matches the
  // hardened REST variant in d1-introspect.ts.
  let exists: unknown;
  try {
    exists = await db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
      )
      .bind(tableName)
      .first();
  } catch (error) {
    console.error(`Failed to check existence of table ${tableName}:`, error);
    throw error instanceof Error ? error : new Error(String(error));
  }

  if (!exists) {
    return null;
  }

  try {
    // Get column info
    const columnsResult = await db
      .prepare(`PRAGMA table_info(${escapeIdentifier(tableName)})`)
      .all();
    
    const columns: ExistingColumn[] = (columnsResult.results || []).map(
      (row: Record<string, unknown>) => ({
        name: row.name as string,
        type: row.type as string,
        notnull: (row.notnull as number) === 1,
        dflt_value: row.dflt_value as string | null,
        pk: (row.pk as number) === 1,
      })
    );
    
    // Get index info
    const indexListResult = await db
      .prepare(`PRAGMA index_list(${escapeIdentifier(tableName)})`)
      .all();
    
    const indexes: ExistingTable['indexes'] = [];
    
    for (const indexRow of indexListResult.results || []) {
      const indexName = indexRow.name as string;
      const isUnique = (indexRow.unique as number) === 1;
      
      // Get columns in this index
      const indexInfoResult = await db
        .prepare(`PRAGMA index_info(${escapeIdentifier(indexName)})`)
        .all();
      
      const indexColumns = (indexInfoResult.results || [])
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) => 
          (a.seqno as number) - (b.seqno as number)
        )
        .map((row: Record<string, unknown>) => row.name as string);
      
      indexes.push({
        name: indexName,
        unique: isUnique,
        columns: indexColumns,
      });
    }
    
    return { name: tableName, columns, indexes };
  } catch (error) {
    // Table exists (checked above) but introspection failed — surface it rather
    // than pretending the table is absent.
    console.error(`Failed to introspect existing table ${tableName}:`, error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Generate migration for a single model
 */
export async function generateModelMigration(
  model: ModelProps,
  db: D1Database,
  policy: MigrationPolicy = 'safe'
): Promise<MigrationResult> {
  const existing = await introspectTable(db, model.name);
  
  // Table doesn't exist - create it
  if (!existing) {
    return {
      statements: [
        generateCreateTableSQL(model),
        ...generateIndexSQL(model),
      ],
      warnings: [],
      isDestructive: false,
    };
  }
  
  // Table exists - compute diff
  return computeMigration(model, existing, policy);
}

/**
 * Compute migration between model and existing table
 */
export function computeMigration(
  model: ModelProps,
  existing: ExistingTable,
  policy: MigrationPolicy
): MigrationResult {
  const statements: string[] = [];
  const warnings: string[] = [];
  // Reaching the final return means only additive/no-op changes were planned;
  // the destructive paths (reset, rebuild) each return early with isDestructive
  // set explicitly.
  const isDestructive = false;

  // Handle reset policy
  if (policy === 'reset') {
    statements.push(`DROP TABLE IF EXISTS ${escapeIdentifier(model.name)}`);
    statements.push(generateCreateTableSQL(model));
    statements.push(...generateIndexSQL(model));
    return { statements, warnings, isDestructive: true };
  }
  
  // Get all expected columns (user + system)
  const expectedColumns = [...model.columns];
  for (const sysCol of SYSTEM_COLUMNS) {
    if (!expectedColumns.some((c) => c.name === sysCol.name)) {
      expectedColumns.push(sysCol);
    }
  }
  
  const existingColNames = new Set(existing.columns.map((c) => c.name));
  const existingByName = new Map(existing.columns.map((c) => [c.name, c]));

  // The full column set the target CREATE TABLE actually produces — including
  // the auto-injected 'id' primary key and the softDelete 'deleted_at' column,
  // neither of which lives in `model.columns`. Drop detection MUST use this set,
  // not `model.columns`, so those auto-added columns are never misread as
  // "removed" and dropped.
  const targetColNames = computeTargetColumnNames(model);

  // ── Destructive table rebuild ────────────────────────────────────────────
  // SQLite cannot DROP COLUMN (before 3.35.0) nor change a column's declared
  // type / NOT-NULL constraint in place — both need the documented 12-step
  // table rebuild (create new table with the target schema, copy the
  // intersecting columns, drop the old table, rename, recreate indexes). We
  // emit that as ordered statements that run inside the existing atomic
  // `executeD1DDLBatch` transaction. This runs ONLY under the explicit
  // `destructive` policy: the migration orchestrator downgrades
  // reset/destructive → safe unless the caller passed `allowDestructive`, so a
  // safe or unconfirmed (e.g. published) deploy never reaches this branch.
  if (policy === 'destructive') {
    const columnsToDrop = existing.columns.filter((c) => !targetColNames.has(c.name));
    const changedColumns = expectedColumns.filter((col) => {
      const cur = existingByName.get(col.name);
      if (!cur) return false;
      const expectedType = normalizeType(SQLITE_TYPE_MAP[col.type] || 'TEXT');
      const actualType = normalizeType(cur.type || '');
      const typeDiff = !!actualType && expectedType !== actualType;
      const nullDiff = !col.isPrimary && cur.notnull !== !col.isNullable;
      return typeDiff || nullDiff;
    });
    if (columnsToDrop.length > 0 || changedColumns.length > 0) {
      return rebuildTable(model, existing, targetColNames, columnsToDrop, changedColumns);
    }
  }

  // Find columns to add
  for (const col of expectedColumns) {
    if (!existingColNames.has(col.name)) {
      // A NOT-NULL column without a default cannot be added by a bare ALTER TABLE
      // ADD COLUMN. Previously safe mode SKIPPED it (leaving the live table
      // diverged from the deployed config, so every sys_create against the model
      // then failed with "no column named X" while the deploy still reported
      // success). Instead of skipping, synthesize a type-appropriate default so
      // the column is actually added and the table stays aligned with the config.
      let effectiveDefault = col.defaultValue;
      if (!col.isNullable && col.defaultValue === undefined && !col.isPrimary) {
        effectiveDefault = synthesizeDefaultValue(col.type);
        warnings.push(
          `Column '${col.name}' is NOT NULL without a default — added with a synthesized ` +
          `default (${formatDefaultValue(effectiveDefault, col.type)}) to keep the live table ` +
          `aligned with the config. Backfill real values as needed.`
        );
      }

      const sqliteType = SQLITE_TYPE_MAP[col.type] || 'TEXT';
      let colDef = `${escapeIdentifier(col.name)} ${sqliteType}`;

      // Emit NOT NULL for required (non-primary) columns that carry a (real or
      // synthesized) non-null default, so the live constraint matches the config
      // instead of silently drifting nullable.
      if (
        !col.isNullable &&
        !col.isPrimary &&
        effectiveDefault !== undefined &&
        effectiveDefault !== null
      ) {
        colDef += ' NOT NULL';
      }

      if (effectiveDefault !== undefined) {
        const defaultVal = formatDefaultValue(effectiveDefault, col.type);
        colDef += ` DEFAULT ${defaultVal}`;
      }

      statements.push(
        `ALTER TABLE ${escapeIdentifier(model.name)} ADD COLUMN ${colDef}`
      );
    }
  }

  // Surface type / nullability drift on columns that exist in BOTH the config and
  // the live table. SQLite cannot change a column's type or NOT-NULL constraint
  // in place without a full table rebuild, so the diff engine cannot fix these —
  // but silently ignoring them (the prior behavior, which compared column NAMES
  // only) left the live schema permanently drifted with no signal. At minimum
  // warn so operators/agents see the divergence.
  for (const col of expectedColumns) {
    const cur = existingByName.get(col.name);
    if (!cur) continue;
    const expectedType = normalizeType(SQLITE_TYPE_MAP[col.type] || 'TEXT');
    const actualType = normalizeType(cur.type || '');
    if (actualType && expectedType !== actualType) {
      warnings.push(
        `Column '${col.name}' type differs (live '${cur.type}', config '${SQLITE_TYPE_MAP[col.type]}') ` +
        `— SQLite cannot alter a column type in place; NOT applied.`
      );
    }
    if (!col.isPrimary) {
      const expectedNotNull = !col.isNullable;
      if (cur.notnull !== expectedNotNull) {
        warnings.push(
          `Column '${col.name}' nullability differs (live NOT NULL=${cur.notnull}, ` +
          `config NOT NULL=${expectedNotNull}) — requires a table rebuild; NOT applied.`
        );
      }
    }
  }
  
  // Find columns to drop. In `destructive` mode any real drop was already
  // handled by the table rebuild above (which returns early), so reaching here
  // means there is nothing to drop — this loop only warns in non-destructive
  // modes, where SQLite can't remove the column without a rebuild.
  for (const col of existing.columns) {
    if (!targetColNames.has(col.name)) {
      warnings.push(
        `Unused column '${col.name}' exists. Use destructive mode to remove.`
      );
    }
  }
  
  // Handle indexes
  const existingIndexNames = new Set(existing.indexes.map((i) => i.name));
  
  // Add missing indexes
  for (const indexSql of generateIndexSQL(model)) {
    // Extract index name from SQL
    const match = indexSql.match(/CREATE.*INDEX.*"([^"]+)"/);
    if (match && !existingIndexNames.has(match[1])) {
      statements.push(indexSql);
    }
  }
  
  return { statements, warnings, isDestructive };
}

/**
 * Column names the target CREATE TABLE will produce for a model — the user
 * columns plus everything the builder auto-injects: the default `id` primary
 * key (when no user column is primary), the three system columns, and
 * `deleted_at` when softDelete is on. Kept in lock-step with
 * {@link generateCreateTableSQL}'s column assembly so drop detection never
 * mistakes an auto-added column for a removed one.
 */
function computeTargetColumnNames(model: ModelProps): Set<string> {
  const names = new Set<string>();
  const hasPrimary = model.columns.some((c) => c.isPrimary);
  if (!hasPrimary) names.add(DEFAULT_PRIMARY_KEY.name);
  for (const c of model.columns) names.add(c.name);
  for (const s of SYSTEM_COLUMNS) names.add(s.name);
  if (model.softDelete) names.add('deleted_at');
  return names;
}

/**
 * Return a copy of the model where every required (NOT NULL, non-primary)
 * column that lacks an explicit default gets a synthesized one. Used only for
 * the rebuild's CREATE TABLE so that copying existing rows into the new table
 * can never fail a NOT NULL constraint (mirrors the additive ADD COLUMN path).
 */
function withSynthesizedDefaults(model: ModelProps): ModelProps {
  return {
    ...model,
    columns: model.columns.map((col) =>
      !col.isNullable && col.defaultValue === undefined && !col.isPrimary
        ? { ...col, defaultValue: synthesizeDefaultValue(col.type) }
        : col,
    ),
  };
}

/**
 * Emit the SQLite 12-step table rebuild that applies destructive schema changes
 * a bare ALTER TABLE cannot: real DROP COLUMN and column type / NOT-NULL
 * constraint changes. The statements are ordered to run inside ONE transaction
 * (executeD1DDLBatch), so the whole rebuild is atomic — it either fully applies
 * or fully rolls back.
 *
 * Data safety: only columns present in BOTH the old table and the new schema
 * are copied (`INSERT ... SELECT`), so intersecting-column data is preserved
 * while dropped columns fall away. `PRAGMA defer_foreign_keys = ON` defers FK
 * enforcement to commit time — `foreign_keys` itself can't be toggled inside a
 * transaction, but `defer_foreign_keys` can, which makes the drop/rename legal
 * mid-transaction and still integrity-checks at commit.
 *
 * LIMITATION: a table that OTHER tables reference by an inbound foreign key is
 * not specially rewritten here beyond the deferred-FK check; the common case
 * (no inbound FKs, or self-references) is handled. Pair with the pre-migration
 * byte-level backup for full recoverability of destructive changes.
 */
function rebuildTable(
  model: ModelProps,
  existing: ExistingTable,
  targetColNames: Set<string>,
  columnsToDrop: ExistingColumn[],
  changedColumns: ColumnProps[],
): MigrationResult {
  const warnings: string[] = [];
  const tempName = `${model.name}__exepad_migrate_new`;
  const tempModel = withSynthesizedDefaults({ ...model, name: tempName });

  // Copy only columns that exist in BOTH the old table and the new schema.
  const intersecting = existing.columns
    .filter((c) => targetColNames.has(c.name))
    .map((c) => escapeIdentifier(c.name));
  const colList = intersecting.join(', ');

  const statements: string[] = [
    'PRAGMA defer_foreign_keys = ON',
    // Defensive: clear any stale temp table from a previously-aborted rebuild
    // (the whole batch is atomic, so within one run this is a no-op).
    `DROP TABLE IF EXISTS ${escapeIdentifier(tempName)}`,
    generateCreateTableSQL(tempModel),
    `INSERT INTO ${escapeIdentifier(tempName)} (${colList}) SELECT ${colList} FROM ${escapeIdentifier(model.name)}`,
    `DROP TABLE ${escapeIdentifier(model.name)}`,
    `ALTER TABLE ${escapeIdentifier(tempName)} RENAME TO ${escapeIdentifier(model.name)}`,
    ...generateIndexSQL(model),
  ];

  for (const col of columnsToDrop) {
    warnings.push(
      `Column '${col.name}' dropped via table rebuild — its data is discarded.`,
    );
  }
  for (const col of changedColumns) {
    warnings.push(
      `Column '${col.name}' rebuilt to apply a type/nullability change to ` +
      `'${SQLITE_TYPE_MAP[col.type] || 'TEXT'}'${col.isNullable ? '' : ' NOT NULL'}; ` +
      `existing values were copied into the new column.`,
    );
  }

  return { statements, warnings, isDestructive: true };
}

/**
 * Synthesize a type-appropriate, non-null default for a required column that the
 * config declared without one. Used so a NOT NULL ADD COLUMN can succeed instead
 * of being silently skipped (which diverges the live table from the config).
 * Mirrors the app-backend's json-default fallbacks (empty string / 0 / '{}').
 */
function synthesizeDefaultValue(type: ColumnType): unknown {
  switch (type) {
    case 'integer':
    case 'real':
      return 0;
    case 'json':
      return {};
    case 'blob':
    case 'text':
    default:
      return '';
  }
}

/**
 * Format default value for SQL
 */
function formatDefaultValue(value: unknown, type: string): string {
  if (value === null) {
    return 'NULL';
  }
  
  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`;
  }
  
  if (typeof value === 'number') {
    return String(value);
  }
  
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  
  if (type === 'json') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Generate migrations for all models
 */
export async function generateMigrations(
  models: ModelProps[],
  db: D1Database,
  policy: MigrationPolicy = 'safe'
): Promise<MigrationResult> {
  const allStatements: string[] = [];
  const allWarnings: string[] = [];
  let anyDestructive = false;
  
  for (const model of models) {
    const result = await generateModelMigration(model, db, policy);
    allStatements.push(...result.statements);
    allWarnings.push(...result.warnings);
    if (result.isDestructive) {
      anyDestructive = true;
    }
  }
  
  return {
    statements: allStatements,
    warnings: allWarnings,
    isDestructive: anyDestructive,
  };
}
