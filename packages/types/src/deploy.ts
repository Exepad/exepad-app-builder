/**
 * Deploy contract types shared between Runtime and Backend.
 */

/** Deploy endpoint request body (Backend → Runtime) */
export interface DeployRequest {
  mode: 'preview' | 'published';
  appAlias: string;
  correlationId?: string;
  /** R2 key for versioned config, relative to appId (e.g., "repo/app_configs/app_config_{hash}.json").
   *  Required for preview mode. Published mode reads from published/app-config.json instead. */
  configPath?: string;
  /**
   * Explicit operator confirmation to allow DESTRUCTIVE schema migrations
   * (`reset` / `destructive` policy: table rebuilds and column drops that can
   * lose data). Defaults to false — destructive plans are downgraded to safe
   * unless the authenticated operator opts in per deploy. The UI is responsible
   * for surfacing the confirmation before setting this.
   */
  allowDestructive?: boolean;
}

/** Deploy endpoint success response */
export interface DeployResponse {
  success: boolean;
  workerName?: string;
  d1Id?: string;
  duration?: number;
  templateSha?: string;
  configPath?: string;
  migrations?: number;
  seeded?: number;
  /** Seed errors that occurred during D1 data seeding (non-fatal — deploy succeeds, data may be incomplete) */
  seedErrors?: string[];
  /**
   * Schema-migration warnings surfaced to operators/agents: a required column
   * whose default was synthesized, a column that could not be added, or
   * type/nullability drift between the live table and the deployed config.
   */
  migrationWarnings?: string[];
  /** True when the applied migration plan contained destructive operations. */
  schemaDestructive?: boolean;
  /** Filesystem path of the pre-migration byte-level DB backup, when one was
   *  taken (destructive or any-statement migrations). Used for restore-on-rollback. */
  backupPath?: string;
  idempotent?: boolean;
  /** Error fields (when success=false) */
  step?: string;
  error?: string;
  rolledBack?: boolean;
}

/** R2 deployment-status.json schema (written by Runtime, read by GET endpoint).
 *  This is the canonical R2 schema used by both `saveDeploymentStatus` and
 *  `loadDeploymentStatus`. The idempotency check in the deploy pipeline reads
 *  `lastCorrelationId` from this stored status to detect duplicate deploys. */
export interface DeploymentStatus {
  appId: string;
  mode: 'preview' | 'published';
  status: 'success' | 'failed' | 'in_progress';
  lastCorrelationId?: string;
  workerName?: string;
  d1Id?: string;
  duration?: number;
  templateSha?: string;
  configPath?: string;
  migrations?: number;
  seeded?: number;
  /**
   * Per-model / per-row seed errors emitted during deploy. Populated when
   * the r2-seeder's per-row tolerance dropped rows for malformed tokens,
   * FK violations, or batch INSERT failures. Empty/absent on a clean
   * deploy. Surfaced here so operators can spot partial seed failures
   * without probing D1 directly. Added 2026-05-15 after the alo48zsn
   * incident where one `__TODAY__+8h` row silently dropped a whole table.
   */
  seedErrors?: string[];
  /** Schema-migration warnings (synthesized defaults, unaddable columns, drift). */
  migrationWarnings?: string[];
  /** True when the applied migration plan contained destructive operations. */
  schemaDestructive?: boolean;
  /** Filesystem path of the pre-migration byte-level DB backup, when taken. */
  backupPath?: string;
  error?: string;
  step?: string;
  updatedAt: string;
}

/** R2 published/_manifest.json schema (written + validated by Runtime) */
export interface PublishedManifest {
  version: number;
  appId: string;
  mode: 'published';
  configSource: string;
  createdAt: string;
  files: Record<string, { hash: string; size: number }>;
}

/** R2 _system/worker-template-latest.json pointer */
export interface WorkerTemplatePointer {
  path: string;
  sha: string;
  builtAt: string;
}
