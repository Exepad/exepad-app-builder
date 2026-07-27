/**
 * Migration Orchestrator (REST-based)
 *
 * Applies schema migrations using the Cloudflare D1 REST API.
 * Replaces the simple "CREATE TABLE IF NOT EXISTS" approach with
 * proper introspection + diff-based migration.
 */

import type { DeploymentConfig } from './types';
import type { ModelProps, MigrationPolicy, MigrationResult } from '../schema/types';
import { introspectTableREST } from './d1-introspect';
import { computeMigration } from '../schema/migrations';
import { generateCreateTableSQL, generateIndexSQL } from '../schema/builder';
import { executeD1DDLBatch } from './d1';

/** Options controlling how migrations are planned/applied. */
export interface MigrationOptions {
  /**
   * Allow destructive migration policies (`reset` / `destructive`) to run.
   *
   * When false (the default), any model requesting `reset` or `destructive` is
   * DOWNGRADED to `safe` and a warning is emitted. `reset` emits an unconditional
   * `DROP TABLE` on every deploy, so the LLM-authored `migrationPolicy: "reset"`
   * would otherwise silently wipe a live (e.g. published) table's rows. Callers
   * that have an explicit operator confirmation pass `allowDestructive: true`.
   */
  allowDestructive?: boolean;
}

/** Resolve the effective policy for a model, downgrading destructive ones unless allowed. */
function resolvePolicy(
  model: ModelProps,
  defaultPolicy: MigrationPolicy,
  options: MigrationOptions,
): { policy: MigrationPolicy; warning?: string } {
  const requested = model.migrationPolicy ?? defaultPolicy;
  if (!options.allowDestructive && (requested === 'reset' || requested === 'destructive')) {
    return {
      policy: 'safe',
      warning:
        `migrationPolicy '${requested}' downgraded to 'safe' — destructive schema ` +
        `changes require explicit operator confirmation. No data was dropped.`,
    };
  }
  return { policy: requested };
}

/**
 * Compute migration plan for all models without executing anything (M3).
 *
 * Returns the same MigrationResult as applyMigrations but with no side effects.
 * Use this to preview what changes will be made before committing.
 */
export async function planMigrations(
  config: DeploymentConfig,
  dbId: string,
  models: ModelProps[],
  defaultPolicy: MigrationPolicy = 'safe',
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const allStatements: string[] = [];
  const allWarnings: string[] = [];
  let anyDestructive = false;

  for (const model of models) {
    const { policy, warning } = resolvePolicy(model, defaultPolicy, options);
    if (warning) allWarnings.push(`[${model.name}] ${warning}`);
    const existing = await introspectTableREST(config, dbId, model.name);

    let result: MigrationResult;

    if (!existing) {
      // New table — would CREATE TABLE
      result = {
        statements: [generateCreateTableSQL(model), ...generateIndexSQL(model)],
        warnings: [],
        isDestructive: false,
      };
    } else {
      // Existing table — compute diff
      result = computeMigration(model, existing, policy);
    }

    allStatements.push(...result.statements);
    allWarnings.push(...result.warnings.map((w) => `[${model.name}] ${w}`));
    if (result.isDestructive) anyDestructive = true;
  }

  return {
    statements: allStatements,
    warnings: allWarnings,
    isDestructive: anyDestructive,
  };
}

/**
 * Apply migrations for all models via the Cloudflare REST API.
 *
 * For each model:
 * - If table doesn't exist → CREATE TABLE + indexes
 * - If table exists → introspect + diff → ALTER TABLE statements
 *
 * Returns a combined MigrationResult.
 */
export async function applyMigrations(
  config: DeploymentConfig,
  dbId: string,
  models: ModelProps[],
  defaultPolicy: MigrationPolicy = 'safe',
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  // Plan first (reuse the same logic)
  const plan = await planMigrations(config, dbId, models, defaultPolicy, options);

  // Execute ALL statements ATOMICALLY in a single transaction. SQLite DDL is
  // transactional, so if any statement fails the whole set rolls back — a
  // mid-migration failure never leaves a half-applied / corrupt schema. It
  // either fully applies or not at all, and the orchestrator can then roll back
  // to the pre-migration snapshot from a known-consistent starting point.
  if (plan.statements.length > 0) {
    try {
      await executeD1DDLBatch(config, dbId, plan.statements);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Migration failed and was rolled back (${plan.statements.length} statement(s)): ${msg}`
      );
    }
  }

  return plan;
}
