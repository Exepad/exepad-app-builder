/**
 * Seed Data Validator
 *
 * Validates seed CSV / JSON headers against the model schema BEFORE insert.
 * Without this, a seed loader silently drops unknown columns and the insert
 * fails at runtime with an opaque "no column named X" error, or inserts NULLs
 * into columns the agent expected to be populated.
 */

import type { SeedData } from './loader';
import type { ColumnProps, ModelProps } from '../schema/types';
import { SYSTEM_COLUMNS } from '../schema/types';

// Columns the platform always auto-populates; CSV may contain them or not.
const AUTO_COLUMN_NAMES: readonly string[] = [
  'id',
  'owner_id',
  'created_at',
  'updated_at',
  'deleted_at',
  ...SYSTEM_COLUMNS.map((c) => c.name),
];

const AUTO_SET = new Set(AUTO_COLUMN_NAMES);

export interface SeedValidationIssue {
  /** Human-readable message describing the issue. */
  message: string;
  /** Whether this issue blocks the insert (true) or is informational (false). */
  blocking: boolean;
}

export interface SeedValidationResult {
  modelName: string;
  issues: SeedValidationIssue[];
  /** True when no blocking issues were found. */
  valid: boolean;
}

function columnIsRequired(col: ColumnProps): boolean {
  // Required iff NOT NULL, no default, not primary key, not system-managed.
  if (AUTO_SET.has(col.name)) return false;
  if (col.isPrimary) return false;
  if (col.defaultValue !== undefined && col.defaultValue !== null) return false;
  return col.isNullable === false;
}

/**
 * Compare parsed seed data against a model schema.
 *
 * @param seed Parsed seed rows + detected columns.
 * @param model Model definition the seed is intended to populate.
 */
export function validateSeedAgainstModel(
  seed: SeedData,
  model: ModelProps
): SeedValidationResult {
  const issues: SeedValidationIssue[] = [];

  const modelColumnNames = new Set(model.columns.map((c) => c.name));
  const seedColumnNames = new Set(seed.columns);

  // 1. Extra columns in CSV that the model doesn't declare — blocking.
  //    Agent-authored CSVs should match the model; silently dropping columns
  //    hides the drift (which is exactly the task-001 HIGH bug).
  const extras: string[] = [];
  for (const colName of seed.columns) {
    if (AUTO_SET.has(colName)) continue;
    if (!modelColumnNames.has(colName)) extras.push(colName);
  }
  if (extras.length > 0) {
    issues.push({
      blocking: true,
      message:
        `Seed for model '${model.name}' contains columns not declared in the ` +
        `schema: [${extras.join(', ')}]. Regenerate the seed from the model ` +
        `schema or add the missing columns to the model.`,
    });
  }

  // 2. Required columns that the CSV is missing — blocking.
  const missing: string[] = [];
  for (const col of model.columns) {
    if (!columnIsRequired(col)) continue;
    if (!seedColumnNames.has(col.name)) missing.push(col.name);
  }
  if (missing.length > 0) {
    issues.push({
      blocking: true,
      message:
        `Seed for model '${model.name}' is missing required columns: ` +
        `[${missing.join(', ')}]. Every NOT NULL column without a default ` +
        `must appear in the CSV header.`,
    });
  }

  // 3. Optional columns the CSV omits — informational only.
  const optionalMissing: string[] = [];
  for (const col of model.columns) {
    if (columnIsRequired(col)) continue;
    if (AUTO_SET.has(col.name)) continue;
    if (!seedColumnNames.has(col.name)) optionalMissing.push(col.name);
  }
  if (optionalMissing.length > 0) {
    issues.push({
      blocking: false,
      message:
        `Seed for '${model.name}' omits optional columns: ` +
        `[${optionalMissing.join(', ')}]. Inserted rows will use column defaults.`,
    });
  }

  const blocking = issues.some((i) => i.blocking);
  return {
    modelName: model.name,
    issues,
    valid: !blocking,
  };
}

/**
 * Format a SeedValidationResult as a multi-line error suitable for throwing.
 */
export function formatSeedValidationError(result: SeedValidationResult): string {
  const blockingIssues = result.issues.filter((i) => i.blocking);
  if (blockingIssues.length === 0) {
    return `Seed validation passed for '${result.modelName}'`;
  }
  const lines = [
    `Seed validation failed for model '${result.modelName}':`,
    ...blockingIssues.map((i) => `  - ${i.message}`),
  ];
  return lines.join('\n');
}
