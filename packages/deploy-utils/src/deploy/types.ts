/**
 * Deployment types
 */

/**
 * D1 database info
 */
export interface D1DatabaseInfo {
  /** Database UUID */
  uuid: string;
  
  /** Database name */
  name: string;
  
  /** Account ID */
  accountId: string;
  
  /** Created at timestamp */
  createdAt: string;
}

/**
 * R2 bucket info
 */
export interface R2BucketInfo {
  /** Bucket name */
  name: string;

  /** Creation date */
  creation_date: string;

  /** Bucket location hint */
  location?: string;
}

/**
 * Workers for Platforms namespace info
 */
export interface WfPNamespaceInfo {
  /** Namespace ID */
  id: string;
  
  /** Namespace name */
  name: string;
  
  /** Account ID */
  accountId: string;
}

/**
 * Deployment configuration
 */
export interface DeploymentConfig {
  /** App ID */
  appId: string;
  
  /** App alias */
  appAlias: string;

  /**
   * Deploy mode — selects the app's SQLite file (`{appId}/{mode}.sqlite`).
   * Optional: when omitted it is inferred from `d1NamingPattern`
   * (`exepad-preview-*` → preview, else published).
   */
  mode?: 'preview' | 'published';

  /** Cloudflare account ID */
  accountId: string;
  
  /** Cloudflare API token */
  apiToken: string;
  
  /** WfP namespace name */
  wfpNamespace: string;
  
  /** D1 database naming pattern */
  d1NamingPattern?: string;

  /** KV namespace ID for rate limiting (opt-in) */
  rateLimitKvNamespaceId?: string;

  /** Analytics Engine dataset name (opt-in) */
  analyticsDatasetId?: string;

  /** R2 bucket name for file storage (opt-in, e.g. 'exepad-user-files') */
  r2BucketName?: string;

  /** R2 bucket name for app-config.json storage (defaults to 'exepad-published') */
  configBucketName?: string;
}

/**
 * Deployment result
 */
export interface DeploymentResult {
  /** Whether deployment succeeded */
  success: boolean;

  /** D1 database info */
  database?: D1DatabaseInfo;

  /** Worker script name */
  workerName?: string;

  /** Migration results */
  migrations?: {
    executed: number;
    warnings: string[];
  };

  /** Seed results */
  seeding?: {
    inserted: number;
    skipped: number;
  };

  /** Schema version timestamp (set after migration snapshot) */
  schemaVersion?: string;

  /** Whether a rollback is available for this deployment */
  rollbackAvailable?: boolean;

  /** Errors */
  errors?: string[];
}

/**
 * Cloudflare API response wrapper
 */
export interface CFApiResponse<T> {
  success: boolean;
  result: T;
  errors: { code: number; message: string }[];
  messages: string[];
}
