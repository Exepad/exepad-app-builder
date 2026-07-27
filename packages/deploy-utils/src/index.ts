/**
 * @exepad/deploy-utils
 *
 * Deployment utilities for Exepad Platform Phase 2
 *
 * - Schema generation and migrations for D1
 * - Worker bundling with config injection
 * - Seed data processing
 * - D1 and WfP deployment via Cloudflare API
 */

// Schema utilities
export {
  // Types
  type ModelProps,
  type ColumnProps,
  type IndexProps,
  type GeneratedSchema,
  type MigrationResult,
  type MigrationPolicy,
  SQLITE_TYPE_MAP,
  SYSTEM_COLUMNS,
  // Builder
  generateCreateTableSQL,
  generateIndexSQL,
  generateSchema,
  generateSchemaSQL,
  generateAuthDDL,
  generateApiKeysDDL,
  generateFilesDDL,
  // Migrations
  introspectTable,
  computeMigration,
  generateModelMigration,
  generateMigrations,
} from './schema';

// Bundle utilities
export {
  // Types
  type InjectedAppConfig,
  type HandlerMethod,
  // Config
  extractBackendProps,
  resolveRoleHierarchy,
  validateInjectedConfig,
  // Handlers
  compileHandler,
  compileHandlers,
  // Entry generator
  generateEntryModule,
  // Component compilation
  compileComponent,
} from './bundle';

// Seed utilities
export {
  // Types
  type SeedData,
  type SeedFromR2Options,
  type SeedFromR2Result,
  // R2-based seeder
  seedFromR2,
  // Static seed resolver
  type ResolveStaticSeedsOptions,
  type ResolveStaticSeedsResult,
  resolveStaticSeeds,
} from './seed';

// Deploy utilities
export {
  // Types
  type DeploymentConfig,
  type DeploymentResult,
  type D1DatabaseInfo,
  type R2BucketInfo,
  type WfPNamespaceInfo,
  // D1
  listD1Databases,
  getD1Database,
  createD1Database,
  deleteD1Database,
  executeD1DDL,
  executeD1DDLBatch,
  executeD1Query,
  provisionD1Database,
  // Local SQLite execution primitives (handle-based)
  executeLocalDDL,
  executeLocalQuery,
  executeLocalBatch,
  type LocalExecResult,
  // D1 introspection (REST-based)
  introspectTableREST,
  // Migration orchestrator
  applyMigrations,
  planMigrations,
  // Deployment lock
  acquireDeployLock,
  releaseDeployLock,
  // Versioning & rollback
  saveDeploymentSnapshot,
  getPreviousSchema,
  getSchemaVersion,
  backupAppDatabase,
  listAppDatabaseBackups,
  pruneAppDatabaseBackups,
  restoreAppDatabase,
  KEEP_DB_BACKUPS,
  type DbBackupResult,
  rollbackSchema,
  type RollbackResult,
  // WfP
  uploadWorkerScript,
  deleteWorkerScript,
  listWorkerScripts,
  createAppBackendBindings,
  type WorkerBinding,
  type WorkerModule,
  type WorkerManifest,
  // R2 bucket provisioning
  getR2Bucket,
  createR2Bucket,
  provisionR2Bucket,
  deleteR2Bucket,
  bucketDir,
  // R2 path helpers
  R2_PATHS,
  CONTENT_HASH_LENGTH,
  CONTENT_HASH_PREFIX,
} from './deploy';
