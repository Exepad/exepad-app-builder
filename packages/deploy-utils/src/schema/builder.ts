/**
 * Schema Builder - Generate D1 SQL from model definitions
 */

import {
  ModelProps,
  ColumnProps,
  GeneratedSchema,
  SQLITE_TYPE_MAP,
  SYSTEM_COLUMNS,
  DEFAULT_PRIMARY_KEY,
} from './types';
import { isValidIdentifier } from '@exepad/types';

/**
 * Escape SQL identifier
 */
function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Generate column definition SQL
 */
function generateColumnDef(column: ColumnProps): string {
  const parts: string[] = [];
  
  // Column name
  parts.push(escapeIdentifier(column.name));
  
  // SQLite type
  const sqliteType = SQLITE_TYPE_MAP[column.type] || 'TEXT';
  parts.push(sqliteType);
  
  // Primary key
  if (column.isPrimary) {
    parts.push('PRIMARY KEY');
    if (column.type === 'integer') {
      parts.push('AUTOINCREMENT');
    }
  }
  
  // NOT NULL constraint
  // INTEGER PRIMARY KEY is implicitly NOT NULL in SQLite, but TEXT/REAL/BLOB
  // PRIMARY KEY columns are NOT — so we must add NOT NULL explicitly for non-integer PKs.
  if (!column.isNullable && !column.isPrimary) {
    parts.push('NOT NULL');
  } else if (column.isPrimary && column.type !== 'integer' && !column.isNullable) {
    parts.push('NOT NULL');
  }
  
  // UNIQUE constraint
  if (column.isUnique && !column.isPrimary) {
    parts.push('UNIQUE');
  }
  
  // DEFAULT value
  if (column.defaultValue !== undefined) {
    const defaultVal = formatDefaultValue(column.defaultValue, column.type);
    parts.push(`DEFAULT ${defaultVal}`);
  }
  
  return parts.join(' ');
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
 * Generate CREATE TABLE statement
 */
export function generateCreateTableSQL(model: ModelProps): string {
  // Validate model name before generating SQL
  if (!isValidIdentifier(model.name)) {
    throw new Error(
      `Invalid model name '${model.name}' — must match /^[a-zA-Z_][a-zA-Z0-9_]*$/`
    );
  }

  // Reserve the '_' prefix for platform-owned tables (_auth_*, _files,
  // _user_settings, _notifications, _bookings, _forms, _blog_*, etc.).
  // User-declared models must not collide with these.
  if (model.name.startsWith('_')) {
    throw new Error(
      `Model name '${model.name}' is reserved — names starting with '_' are platform-owned. Choose a name without the leading underscore.`
    );
  }

  // Validate column names
  for (const col of model.columns) {
    if (!isValidIdentifier(col.name)) {
      throw new Error(
        `Invalid column name '${col.name}' in model '${model.name}' — must match /^[a-zA-Z_][a-zA-Z0-9_]*$/`
      );
    }
  }

  const tableName = escapeIdentifier(model.name);

  // Combine user columns with system columns
  const allColumns: ColumnProps[] = [...model.columns];

  // Auto-add default primary key (id INTEGER PRIMARY KEY AUTOINCREMENT)
  // when no user-defined column has isPrimary: true
  const hasPrimary = allColumns.some((c) => c.isPrimary);
  if (!hasPrimary) {
    allColumns.unshift(DEFAULT_PRIMARY_KEY);
  }

  // Add system columns if not already present
  for (const sysCol of SYSTEM_COLUMNS) {
    if (!allColumns.some((c) => c.name === sysCol.name)) {
      allColumns.push(sysCol);
    }
  }

  // Auto-add deleted_at column when softDelete is enabled
  if (model.softDelete && !allColumns.some((c) => c.name === 'deleted_at')) {
    allColumns.push({ name: 'deleted_at', type: 'text', isNullable: true });
  }
  
  // Generate column definitions
  const columnDefs = allColumns.map(generateColumnDef);
  
  // Generate foreign key constraints
  const foreignKeys: string[] = [];
  for (const column of model.columns) {
    if (column.references) {
      let fk = `FOREIGN KEY (${escapeIdentifier(column.name)}) REFERENCES ${escapeIdentifier(column.references.model)}(${escapeIdentifier(column.references.column)})`;
      // Default to CASCADE for user-defined models so deleting a parent
      // record automatically removes dependent rows instead of failing
      // with a FOREIGN KEY constraint error.
      const onDelete = column.references.onDelete || 'cascade';
      const actionMap: Record<string, string> = {
        cascade: 'CASCADE',
        set_null: 'SET NULL',
        restrict: 'RESTRICT',
        no_action: 'NO ACTION',
      };
      fk += ` ON DELETE ${actionMap[onDelete]}`;
      foreignKeys.push(fk);
    }
  }
  
  // Combine all parts
  const allParts = [...columnDefs, ...foreignKeys];
  
  return `CREATE TABLE IF NOT EXISTS ${tableName} (\n  ${allParts.join(',\n  ')}\n)`;
}

/**
 * Generate CREATE INDEX statements
 */
export function generateIndexSQL(model: ModelProps): string[] {
  const statements: string[] = [];
  const tableName = escapeIdentifier(model.name);
  
  // Always create index on owner_id
  const ownerIndexName = `idx_${model.name}_owner_id`;
  statements.push(
    `CREATE INDEX IF NOT EXISTS ${escapeIdentifier(ownerIndexName)} ON ${tableName} ("owner_id")`
  );
  
  // Create user-defined indexes
  if (model.indexes) {
    for (const index of model.indexes) {
      const indexName = escapeIdentifier(index.name);
      const columns = index.columns.map(escapeIdentifier).join(', ');
      const unique = index.unique ? 'UNIQUE ' : '';
      
      statements.push(
        `CREATE ${unique}INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columns})`
      );
    }
  }
  
  return statements;
}

/**
 * Generate complete schema for all models
 */
export function generateSchema(models: ModelProps[]): GeneratedSchema {
  const createTables: string[] = [];
  const createIndexes: string[] = [];
  
  for (const model of models) {
    createTables.push(generateCreateTableSQL(model));
    createIndexes.push(...generateIndexSQL(model));
  }
  
  return {
    createTables,
    createIndexes,
    all: [...createTables, ...createIndexes],
  };
}

/**
 * Generate schema SQL as a single string
 */
export function generateSchemaSQL(models: ModelProps[]): string {
  const schema = generateSchema(models);
  return schema.all.join(';\n\n') + ';';
}

/**
 * Generate CREATE TABLE + INDEX statements for the _files system table.
 * Auto-created during deployment when storage.enabled = true.
 * Uses CREATE TABLE IF NOT EXISTS for idempotency.
 */
export function generateFilesDDL(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS "_files" (
  "id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL,
  "app_id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "r2_key" TEXT NOT NULL UNIQUE,
  "visibility" TEXT NOT NULL DEFAULT 'private',
  "model_name" TEXT,
  "record_id" TEXT,
  "field_name" TEXT,
  "metadata" TEXT,
  "thumbnail_r2_key" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT
)`,
    `CREATE INDEX IF NOT EXISTS "idx_files_owner" ON "_files"("owner_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_files_model" ON "_files"("model_name", "record_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_files_created" ON "_files"("created_at")`,
  ];
}

/**
 * Generate CREATE TABLE + INDEX statements for the per-app API keys table.
 * Uses CREATE TABLE IF NOT EXISTS for idempotency.
 * Requires _auth_users table (from generateAuthDDL) to exist first.
 */
export function generateApiKeysDDL(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS "_auth_api_keys" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "key_hash" TEXT UNIQUE NOT NULL,
  "key_prefix" TEXT NOT NULL,
  "user_id" TEXT NOT NULL REFERENCES "_auth_users"("id") ON DELETE CASCADE,
  "scopes" TEXT NOT NULL DEFAULT '[]',
  "expires_at" TEXT,
  "last_used_at" TEXT,
  "revoked_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
)`,
    `CREATE INDEX IF NOT EXISTS "idx_auth_api_keys_key_hash" ON "_auth_api_keys"("key_hash")`,
    `CREATE INDEX IF NOT EXISTS "idx_auth_api_keys_user_id" ON "_auth_api_keys"("user_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_auth_api_keys_key_prefix" ON "_auth_api_keys"("key_prefix")`,
  ];
}

/**
 * Generate CREATE TABLE + INDEX statements for the per-app auth system tables.
 * Uses CREATE TABLE IF NOT EXISTS for idempotency.
 */
export function generateAuthDDL(): string[] {
  return [
    // Users table
    `CREATE TABLE IF NOT EXISTS "_auth_users" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT UNIQUE NOT NULL,
  "password_hash" TEXT,
  "email_verified" INTEGER DEFAULT 0,
  "name" TEXT,
  "avatar_url" TEXT,
  "roles" TEXT DEFAULT 'user',
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
)`,
    `CREATE INDEX IF NOT EXISTS "idx_auth_users_email" ON "_auth_users"("email")`,

    // Sessions table
    `CREATE TABLE IF NOT EXISTS "_auth_sessions" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "_auth_users"("id") ON DELETE CASCADE,
  "expires_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL
)`,
    `CREATE INDEX IF NOT EXISTS "idx_auth_sessions_user_id" ON "_auth_sessions"("user_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_auth_sessions_expires_at" ON "_auth_sessions"("expires_at")`,

    // Provider accounts table
    `CREATE TABLE IF NOT EXISTS "_auth_accounts" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "_auth_users"("id") ON DELETE CASCADE,
  "provider" TEXT NOT NULL,
  "provider_account_id" TEXT NOT NULL,
  "access_token" TEXT,
  "refresh_token" TEXT,
  "expires_at" TEXT,
  UNIQUE("provider", "provider_account_id")
)`,
    `CREATE INDEX IF NOT EXISTS "idx_auth_accounts_user_id" ON "_auth_accounts"("user_id")`,

    // Verification tokens table
    `CREATE TABLE IF NOT EXISTS "_auth_verification_tokens" (
  "token" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL
)`,
    `CREATE INDEX IF NOT EXISTS "idx_auth_verification_tokens_user_id" ON "_auth_verification_tokens"("user_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_auth_verification_tokens_expires_at" ON "_auth_verification_tokens"("expires_at")`,
  ];
}

