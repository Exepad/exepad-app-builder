/**
 * Canonical backend type definitions for Exepad Platform
 *
 * These are the single source of truth for model, handler, and CRUD types
 * shared across app-backend, runtime, and deploy-utils packages.
 */

// ── Identifier Validation ────────────────────────────────────────

/** Pattern for valid SQL identifiers (model names, column names) */
export const VALID_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Check if a string is a valid SQL identifier (for model/column names) */
export function isValidIdentifier(name: string): boolean {
  return VALID_IDENTIFIER_PATTERN.test(name);
}

// ── Column & Index Types ────────────────────────────────────────

export type ColumnType = 'text' | 'integer' | 'real' | 'blob' | 'json';

export type OnDeleteAction = 'cascade' | 'set_null' | 'restrict' | 'no_action';

/** Configures a foreign key reference from one column to another model's column. */
export interface ForeignKeyRef {
  /** The name of the referenced model (table). */
  model: string;
  /** The column name in the referenced model to match against (typically 'id'). */
  column: string;
  /** The action to perform when the referenced row is deleted. @default 'cascade' */
  onDelete?: OnDeleteAction;
}

/** Configures a single column within a data model, including its type, constraints, and default value. */
export interface ColumnProps {
  /** The SQL column name, must match [a-zA-Z_][a-zA-Z0-9_]* pattern (e.g., 'first_name', 'created_at'). */
  name: string;
  /** The D1/SQLite storage type for this column. */
  type: ColumnType;
  /** Plain-English description of this column's purpose, used by the LLM for context. */
  summary?: string;
  /** If true, this column is the table's primary key. Only one per model. @default false */
  isPrimary?: boolean;
  /** If true, a UNIQUE constraint is added to this column. @default false */
  isUnique?: boolean;
  /** If true, the column accepts NULL values. @default false */
  isNullable?: boolean;
  /** The default value inserted when no value is provided, must match the column type. */
  defaultValue?: unknown;
  /** Foreign key reference linking this column to another model's column. */
  references?: ForeignKeyRef;
  /** Closed vocabulary for text columns (status, priority, tier, category). When set, seed data must use exactly these values and UI must render every entry. */
  enumValues?: string[];
}

/** Configures a database index on one or more columns for query optimization. */
export interface IndexProps {
  /** The index name, used in generated SQL CREATE INDEX statements. */
  name: string;
  /** The column names included in the index, in order. */
  columns: string[];
  /** If true, the index enforces uniqueness across the column combination. @default false */
  unique?: boolean;
}

// ── Auth Types ──────────────────────────────────────────────────

/**
 * Access level for pages, handlers, and CRUD operations.
 * - `'public'`: anyone can access
 * - `'authenticated'`: any logged-in user
 * - `'role:${string}'`: user must have the specified role (or a role that inherits it)
 * - `'owner'`: only the record owner (valid only in crudPolicy)
 * - `'none'`: permanently blocked (valid only in crudPolicy)
 */
export type AccessLevel = 'public' | 'authenticated' | `role:${string}` | 'owner' | 'none';

/** @deprecated Use AccessLevel instead. Kept for backward compatibility. */
export type AuthLevel = AccessLevel;

// ── Per-App Auth Configuration ──────────────────────────────────

/** Configures a single authentication provider for per-app user auth (Mode B). */
export type AuthProviderProps =
  | { provider: 'email' }
  | { provider: 'google' }
  | { provider: 'exepad' };

/** Configures per-app authentication, session behavior, and login UX. */
export interface SecurityProps {
  /**
   * Master kill-switch for app authentication. When `false`, the runtime
   * treats the app as fully public regardless of `authProviders`,
   * `defaultAccess`, or per-page access settings. Toggled from the admin
   * console's Auth Settings page. @default true
   */
  enabled?: boolean;
  /** Which login methods to enable for end-users. */
  authProviders?: AuthProviderProps[];
  /** Session timeout duration in seconds. @default 604800 (7 days) */
  sessionDuration?: number;
  /** If true, users must verify their email before gaining authenticated access. @default false */
  requireVerification?: boolean;
  /** If true, new users can self-register. @default true */
  allowSignup?: boolean;
  /** Password strength requirements (email provider). */
  passwordPolicy?: {
    /** Minimum password length. @default 8 */
    minLength?: number;
    /** Require at least one uppercase letter. */
    requireUppercase?: boolean;
    /** Require at least one digit. */
    requireNumber?: boolean;
  };
  /** Custom role names used by this app (e.g., ['admin', 'editor', 'viewer']). */
  roles?: string[];
  /** Role inheritance map. Each key's value lists the roles it inherits (e.g., { admin: ['editor'], editor: ['viewer'] }). */
  roleHierarchy?: Record<string, string[]>;
  /** Role assigned to new users on signup. @default first non-admin role, or 'user' */
  defaultRole?: string;
  /** Default access level for pages and handlers without an explicit `access` field. @default 'public' */
  defaultAccess?: AccessLevel;
  /** Route for the login page. @default '/login' */
  loginPage?: string;
  /** Route to redirect to after successful login. @default '/' */
  redirectAfterLogin?: string;
  /** Route to redirect to after logout. @default '/login' */
  redirectAfterLogout?: string;
}

/** Configures the required access level for each CRUD operation on a model. */
export interface CrudPolicyProps {
  /** Access level required to create new records. @default 'authenticated' */
  create?: AccessLevel;
  /** Access level required to read a single record by ID. @default 'authenticated' */
  read?: AccessLevel;
  /** Access level required to update existing records. @default 'authenticated' */
  update?: AccessLevel;
  /** Access level required to delete records. @default 'authenticated' */
  delete?: AccessLevel;
  /** Access level required to list/query multiple records. @default 'authenticated' */
  list?: AccessLevel;
}

// ── Model Types ─────────────────────────────────────────────────

/** Controls how owner_id filtering is applied to CRUD queries */
export type OwnerScope = 'user' | 'shared';

export type MigrationPolicy = 'safe' | 'destructive' | 'reset';

/** Defines a data model (database table) with its columns, indexes, access policies, and migration settings. */
export interface ModelProps {
  /** Unique identifier (UUID v4) for this model, used for migration tracking. */
  uuid: string;
  /** The table name in D1, must match [a-zA-Z_][a-zA-Z0-9_]* pattern (e.g., 'books', 'loan_records'). */
  name: string;
  /** Plain-English description of this model's purpose, used by the LLM for context. */
  summary?: string;
  /** The columns that make up this table's schema. System columns (id, owner_id, created_at, updated_at) are added automatically. */
  columns: ColumnProps[];
  /** Additional database indexes for optimizing queries on this model. */
  indexes?: IndexProps[];
  /** Per-operation authentication requirements for auto-CRUD endpoints. */
  crudPolicy?: CrudPolicyProps;
  /** Controls how schema migrations are handled: 'safe' (additive only), 'destructive' (allows drops), 'reset' (full rebuild). @default 'safe' */
  migrationPolicy?: MigrationPolicy;
  /** If true, deletes set a deleted_at timestamp instead of removing the row. Auto-adds a deleted_at column during schema generation. @default false */
  softDelete?: boolean;
  /**
   * Owner scoping mode (default: 'user').
   * - 'user': all queries filter by owner_id — each user sees only their own data
   * - 'shared': reads/lists return all records; writes still set owner_id for audit
   */
  ownerScope?: OwnerScope;
  /**
   * Whether `sys_list` should auto-expand foreign-key columns into joined sub-objects.
   * When `true` (default), every FK column whose name ends in `_id` and whose
   * `references.model` exists in the app's model list gets a sibling object on
   * each row (alias = column name minus `_id`). Set `false` to suppress for
   * cost-sensitive or privacy-sensitive parent models. @default true
   */
  autoExpandFKs?: boolean;
  /**
   * When this model is auto-expanded into a parent row, only return these
   * columns. Useful for sensitive joined models that shouldn't expose every
   * field through joins. Omit to expose all columns. Always implicitly includes
   * the primary key.
   */
  expandSelect?: string[];
}

// ── Handler Types ───────────────────────────────────────────────

/** Defines a single input parameter accepted by a custom handler. */
export interface InputProps {
  /** The parameter name, used as the key in ctx.params. */
  name: string;
  /** The expected data type for this input, used for validation before the handler runs. */
  type: 'string' | 'number' | 'boolean' | 'json';
  /** If true, the handler will reject requests missing this parameter. @default false */
  required?: boolean;
  /** Plain-English description of this parameter's purpose, used by the LLM for context. */
  summary?: string;
}

/** Defines a single field in a custom handler's response object. */
export interface OutputProps {
  /** The field name in the handler's response object. */
  name: string;
  /** The data type of this output field, used for documentation and client-side type hints. */
  type: 'string' | 'number' | 'boolean' | 'json' | 'array';
  /** When type is 'array', describes the item type within the array (e.g., 'string', 'json'). */
  items?: string;
  /** Plain-English description of this output field's contents, used by the LLM for context. */
  summary?: string;
}

/** Defines a custom backend handler function with its inputs, outputs, access control, and compiled method reference. */
export interface HandlerProps {
  /** Unique identifier (UUID v4) for this handler. */
  uuid: string;
  /** The handler name, used as the API route segment: POST /api/{appId}/{name}. */
  name: string;
  /** Plain-English description of what this handler does, used by the LLM for context. */
  summary?: string;
  /** The minimum access level required to invoke this handler. */
  authLevel: AccessLevel;
  /** The list of input parameters this handler accepts, validated before execution. */
  inputs: InputProps[];
  /** The list of fields returned in the handler's response object. */
  outputs: OutputProps[];
  /** Names of internal data sources (from backend.sources) this handler is allowed to access. */
  allowedSources?: string[];
  /** The name of the compiled method in repo.backend.handlers that implements this handler. */
  method: string;
  /**
   * Whether this handler performs reads or writes (default: 'write').
   * Read handlers respect the declared authLevel as-is (e.g., 'public' allows
   * unauthenticated access). Write handlers always require authentication
   * regardless of authLevel, to prevent empty owner_id on INSERTs (H8 guard).
   */
  handlerType?: 'read' | 'write';
}

// ── Handler Context ─────────────────────────────────────────────

/**
 * Logger interface available to handlers via ctx.log
 */
export interface HandlerLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Execution context passed to custom handler functions.
 *
 * This is the canonical type definition. Handler source files (.tsx) are
 * compiled standalone by esbuild and cannot import from packages, so they
 * should declare a local interface matching this shape. See the generated
 * _handler-context.d.ts in the compiled handlers directory.
 *
 * The db/batch fields use D1 types from @cloudflare/workers-types which
 * are globally available in the app-backend and handler compilation contexts.
 * In packages that lack those globals, use the HandlerContext type from
 * the app-backend's context/builder.ts instead.
 */
export interface HandlerContext {
  /** D1 Database access (D1Database from @cloudflare/workers-types) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;

  /**
   * Execute multiple D1 statements atomically as a batch.
   * If any statement fails the entire batch is rolled back.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  batch: (statements: any[]) => Promise<any[]>;

  /** Current authenticated user (always provided; id is '' if unauthenticated) */
  user: {
    id: string;
    email: string;
    roles: string[];
  };

  /** Input parameters passed to the handler */
  params: Record<string, unknown>;

  /** Structured logger */
  log: HandlerLogger;

  /** App configuration */
  config: {
    appId: string;
    appAlias: string;
  };

  /**
   * Model configurations keyed by model name.
   * Use this to check ownerScope, columns, softDelete, etc. when writing queries.
   *
   * @example
   * const isShared = ctx.models['books']?.ownerScope === 'shared';
   * const ownerFilter = isShared ? '' : ' AND owner_id = ?';
   */
  models: Record<string, ModelProps>;
}

// ── Injected Config ─────────────────────────────────────────────

/**
 * Subset of backend config injected into app-backend at deployment.
 * Used by both app-backend (runtime) and deploy-utils (bundling).
 */
export interface InjectedProps {
  /** The model configurations bundled into the deployed worker for runtime schema awareness. */
  models?: ModelProps[];
  /** The handler configurations bundled into the deployed worker for routing and validation. */
  handlers?: HandlerProps[];
  /** Per-app auth configuration. When present, enables Mode B (per-app user pool in D1). */
  security?: SecurityProps;
  /** Pre-resolved role hierarchy expansion map. Each role maps to all roles it effectively holds (including inherited). */
  roleExpansionMap?: Record<string, string[]>;
  /** MCP (Model Context Protocol) server configuration. */
  mcp?: McpProps;
  /** File storage configuration (R2-backed). When present and enabled, the worker gets R2_FILES binding. */
  storage?: StorageProps;
}

/**
 * Configuration for the per-app MCP server.
 */
export interface McpProps {
  /** Whether the MCP endpoint is enabled for this app. */
  enabled: boolean;
}

// ── File Storage Types ──────────────────────────────────────────

/**
 * Access control policy for file operations.
 * Each operation can require a different access level.
 */
export interface FilePolicyProps {
  /** Access level required to upload files. @default 'authenticated' */
  upload?: AccessLevel;
  /** Access level required to download/view files. @default 'authenticated' */
  download?: AccessLevel;
  /** Access level required to delete files. @default 'authenticated' */
  delete?: AccessLevel;
  /** Access level required to list files. @default 'authenticated' */
  list?: AccessLevel;
}

/**
 * Configuration for per-app file storage (R2-backed).
 * When `enabled: true`, the app-backend gets an R2_FILES binding and
 * a `_files` system table is auto-created in D1.
 */
export interface StorageProps {
  /** Whether file storage is enabled for this app. */
  enabled: boolean;
  /** Maximum file size in bytes. @default 10_485_760 (10 MB) */
  maxFileSize?: number;
  /** Allowed MIME types (supports wildcards like 'image/*'). When unset, all non-blocked types are allowed. */
  allowedMimeTypes?: string[];
  /** Maximum number of files per user. @default 1000 */
  maxFilesPerUser?: number;
  /** Maximum total storage per user in bytes. @default 524_288_000 (500 MB) */
  maxStoragePerUser?: number;
  /** Maximum total storage per app in bytes. @default 5_368_709_120 (5 GB) */
  maxStoragePerApp?: number;
  /** Whether to allow SVG uploads (XSS risk — requires sanitization). @default false */
  allowSvg?: boolean;
  /** Whether files are publicly accessible without authentication. @default false */
  publicAccess?: boolean;
  /** Per-operation access control policy. */
  filePolicy?: FilePolicyProps;
}
