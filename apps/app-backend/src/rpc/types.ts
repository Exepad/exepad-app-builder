/**
 * RPC Request/Response types for App Backend
 */

/**
 * RPC Request structure
 */
export interface RpcRequest {
  /** RPC method name (sys_create, sys_list, or custom handler name) */
  method: string;

  /** Method parameters */
  params?: Record<string, unknown>;

  /** Target model name (for CRUD operations) */
  model?: string;
}

/**
 * RPC Response structure
 */
export interface RpcResponse<T = unknown> {
  /** Whether the request succeeded */
  success: boolean;

  /** Response data (on success) */
  data?: T;

  /** Pagination info (for list operations) */
  pagination?: PaginationInfo;

  /** Error details (on failure) */
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    field?: string;
  };
}

/**
 * Pagination information
 */
export interface PaginationInfo {
  /** Total number of records (offset mode; omitted in cursor mode) */
  total?: number;

  /** Current page offset (offset mode only) */
  offset?: number;

  /** Page size limit */
  limit: number;

  /** Whether more records exist */
  hasMore: boolean;

  /** Next cursor for keyset pagination (cursor mode only) */
  nextCursor?: string;
}

/**
 * User context — populated from platform headers (Mode A) or per-app session (Mode B)
 */
export interface UserContext {
  /** User ID */
  id: string;

  /** User email */
  email: string;

  /** User display name */
  name?: string;

  /** User roles */
  roles: string[];

  /** Whether user is authenticated */
  isAuthenticated: boolean;

  /** How the identity was established */
  authMethod: 'session' | 'api_key' | 'platform_header';

  /** API key scopes (only set when authMethod === 'api_key') */
  apiKeyScopes?: string[];

  /** API key ID (only set when authMethod === 'api_key') */
  apiKeyId?: string;

  /**
   * True when the caller is a preview viewer (gateway forwarded the
   * `X-Preview-Access: 1` header on a `preview_access` identity). Only
   * populated on Mode A (platform headers); session and api_key modes
   * leave this false. Used as an advisory flag — writes that depend on
   * the presence of an `_auth_users` row can lazily provision one when
   * `isPreview` is true. Never used for authorization decisions.
   */
  isPreview?: boolean;
}

/**
 * CRUD operation parameters
 */
export interface CreateParams {
  /** Record data */
  data: Record<string, unknown>;
}

export interface ReadParams {
  /** Record ID */
  id: string | number;
}

export interface ListParams {
  /** Filter conditions */
  filters?: Record<string, unknown>;

  /** Sort order */
  orderBy?: Record<string, 'asc' | 'desc'>;

  /** Page size limit (default: 50, max: 500) */
  limit?: number;

  /** Page offset (offset mode only) */
  offset?: number;

  /** Columns to select (default: all) */
  select?: string[];

  /** Opaque cursor for keyset pagination (cursor mode only) */
  cursor?: string;

  /** Pagination strategy — 'offset' (default) or 'cursor' */
  paginationMode?: 'offset' | 'cursor';

  /** Multi-field text search term */
  search?: string;

  /** Columns to search across (default: all text columns) */
  searchFields?: string[];
}

export interface UpdateParams {
  /** Record ID */
  id: string | number;

  /** Fields to update */
  data: Record<string, unknown>;
}

export interface DeleteParams {
  /** Record ID */
  id: string | number;

  /** Soft delete (set deleted_at) vs hard delete */
  soft?: boolean;
}

/**
 * System CRUD method names
 */
export type CrudMethod =
  | 'sys_create'
  | 'sys_read'
  | 'sys_list'
  | 'sys_update'
  | 'sys_delete'
  | 'sys_upsert';

/**
 * Check if method is a CRUD method
 */
export function isCrudMethod(method: string): method is CrudMethod {
  return [
    'sys_create',
    'sys_read',
    'sys_list',
    'sys_update',
    'sys_delete',
    'sys_upsert',
  ].includes(method);
}
