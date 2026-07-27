/**
 * Per-App API Keys — generation, validation, scope checking, and RPC handlers.
 *
 * Key format: exepad_sk_ + 48 hex chars (24 random bytes)
 * Storage: SHA-256 hash in _auth_api_keys D1 table
 * Scopes: "model:{name}:{op}", "handler:{name}", or "*" (wildcard)
 */

import type { UserContext } from '../rpc/types';
import {
  hashSessionToken,
  generateId,
  now,
  expiresAt,
  parseRoles,
} from './utils';
import {
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
} from '../utils/errors';

// ── Types ───────────────────────────────────────────────────────

export interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreateApiKeyResult {
  key: ApiKeyInfo;
  /** The raw API key — ONLY returned on creation, never retrievable again */
  rawKey: string;
}

export interface ValidatedApiKey {
  id: string;
  userId: string;
  scopes: string[];
  email: string;
  name: string | null;
  roles: string;
}

// ── Key Generation ──────────────────────────────────────────────

/** Generate a raw API key: "exepad_sk_" + 48 hex chars */
export function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `exepad_sk_${hex}`;
}

/** Extract display prefix from a raw key (first 14 chars: "exepad_sk_xxxx") */
export function getKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 14);
}

/** SHA-256 hash an API key for storage (delegates to existing session token hasher) */
export async function hashApiKey(rawKey: string): Promise<string> {
  return hashSessionToken(rawKey);
}

// ── Scope Checking ──────────────────────────────────────────────

/** Scope format regex: model:{name}:{op} or handler:{name} */
const SCOPE_PATTERN = /^(model:[a-zA-Z_]\w*:(create|read|list|update|delete)|handler:[a-zA-Z_]\w*|\*)$/;

export function isValidScope(scope: string): boolean {
  return SCOPE_PATTERN.test(scope);
}

/**
 * Check if a set of scopes allows a specific operation.
 * Wildcard "*" grants everything. Otherwise, exact match only.
 */
export function hasScope(scopes: string[], requiredScope: string): boolean {
  if (scopes.includes('*')) return true;
  return scopes.includes(requiredScope);
}

/** Build the required scope string for a CRUD operation */
export function buildCrudScope(
  modelName: string,
  operation: 'create' | 'read' | 'list' | 'update' | 'delete',
): string {
  return `model:${modelName}:${operation}`;
}

/** Build the required scope string for a handler invocation */
export function buildHandlerScope(handlerName: string): string {
  return `handler:${handlerName}`;
}

/**
 * Enforce API key scope for a given required scope string.
 * Throws ForbiddenError if the user is authenticated via API key and the
 * key's scopes do not include the required scope.
 * No-op for non-API-key auth methods.
 */
export function enforceApiKeyScope(
  user: UserContext,
  requiredScope: string,
): void {
  if (user.authMethod === 'api_key' && user.apiKeyScopes) {
    if (!hasScope(user.apiKeyScopes, requiredScope)) {
      throw new ForbiddenError(`API key lacks scope: ${requiredScope}`);
    }
  }
}

// ── Validation ──────────────────────────────────────────────────

/**
 * Validate a raw API key against D1.
 * Returns key metadata if valid, null if invalid/expired/revoked.
 * Updates last_used_at as fire-and-forget.
 */
export async function validateApiKey(
  rawKey: string,
  db: D1Database,
): Promise<ValidatedApiKey | null> {
  const keyHash = await hashApiKey(rawKey);

  const row = await db
    .prepare(
      `SELECT ak.id, ak.user_id, ak.scopes, ak.expires_at, ak.revoked_at,
              u.email, u.name, u.roles
       FROM "_auth_api_keys" ak
       JOIN "_auth_users" u ON ak.user_id = u.id
       WHERE ak.key_hash = ?`,
    )
    .bind(keyHash)
    .first<{
      id: string;
      user_id: string;
      scopes: string;
      expires_at: string | null;
      revoked_at: string | null;
      email: string;
      name: string | null;
      roles: string;
    }>();

  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at) {
    const expiry = new Date(row.expires_at);
    if (isNaN(expiry.getTime()) || expiry < new Date()) return null;
  }

  // Parse scopes safely — treat corrupted data as invalid key
  let scopes: string[];
  try {
    scopes = JSON.parse(row.scopes || '[]');
  } catch {
    return null;
  }

  // Fire-and-forget last_used_at update
  db.prepare('UPDATE "_auth_api_keys" SET last_used_at = ? WHERE id = ?')
    .bind(now(), row.id)
    .run()
    .catch((err) => console.warn('Failed to update api_key last_used_at:', err));

  return {
    id: row.id,
    userId: row.user_id,
    scopes,
    email: row.email,
    name: row.name,
    roles: row.roles,
  };
}

/**
 * Build a UserContext from a validated API key.
 */
export function buildApiKeyUserContext(key: ValidatedApiKey): UserContext {
  return {
    id: key.userId,
    email: key.email,
    name: key.name ?? undefined,
    roles: parseRoles(key.roles),
    isAuthenticated: true,
    authMethod: 'api_key',
    apiKeyScopes: key.scopes,
    apiKeyId: key.id,
  };
}

// ── RPC Handlers ────────────────────────────────────────────────

/**
 * auth_create_api_key — Create a new API key for the authenticated user.
 * The raw key is returned ONCE and never stored.
 */
export async function authCreateApiKey(
  params: Record<string, unknown>,
  db: D1Database,
  user: UserContext,
): Promise<CreateApiKeyResult> {
  if (!user.isAuthenticated) {
    throw new UnauthorizedError('Authentication required to create API keys');
  }

  const name = params.name;
  const scopes = params.scopes;
  const expiresInDays = params.expiresInDays;

  // Validate name
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('API key name is required', 'name');
  }

  // Validate scopes
  if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
    throw new ValidationError('At least one scope is required', 'scopes');
  }
  for (const scope of scopes) {
    if (typeof scope !== 'string' || !isValidScope(scope)) {
      throw new ValidationError(`Invalid scope format: '${scope}'`, 'scopes');
    }
  }

  // Validate expiresInDays
  if (expiresInDays !== undefined && (typeof expiresInDays !== 'number' || expiresInDays <= 0)) {
    throw new ValidationError('expiresInDays must be a positive number', 'expiresInDays');
  }

  const rawKey = generateApiKey();
  const keyHash = await hashApiKey(rawKey);
  const keyPrefix = getKeyPrefix(rawKey);
  const keyId = generateId();
  const timestamp = now();
  const expiresAtValue = expiresInDays ? expiresAt(expiresInDays * 86400) : null;

  await db
    .prepare(
      `INSERT INTO "_auth_api_keys"
       (id, name, key_hash, key_prefix, user_id, scopes, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      keyId,
      name.trim(),
      keyHash,
      keyPrefix,
      user.id,
      JSON.stringify(scopes),
      expiresAtValue,
      timestamp,
      timestamp,
    )
    .run();

  return {
    key: {
      id: keyId,
      name: name.trim(),
      keyPrefix,
      scopes: scopes as string[],
      expiresAt: expiresAtValue,
      lastUsedAt: null,
      createdAt: timestamp,
      revokedAt: null,
    },
    rawKey,
  };
}

/**
 * auth_list_api_keys — List all API keys for the authenticated user.
 * Never returns raw keys or hashes.
 */
export async function authListApiKeys(
  _params: Record<string, unknown>,
  db: D1Database,
  user: UserContext,
): Promise<ApiKeyInfo[]> {
  if (!user.isAuthenticated) {
    throw new UnauthorizedError('Authentication required');
  }

  const rows = await db
    .prepare(
      `SELECT id, name, key_prefix, scopes, expires_at, last_used_at, created_at, revoked_at
       FROM "_auth_api_keys"
       WHERE user_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(user.id)
    .all();

  return (rows.results || []).map((row: Record<string, unknown>) => {
    let scopes: string[];
    try {
      scopes = JSON.parse((row.scopes as string) || '[]');
    } catch {
      scopes = [];
    }
    return {
      id: row.id as string,
      name: row.name as string,
      keyPrefix: row.key_prefix as string,
      scopes,
      expiresAt: (row.expires_at as string) || null,
      lastUsedAt: (row.last_used_at as string) || null,
      createdAt: row.created_at as string,
      revokedAt: (row.revoked_at as string) || null,
    };
  });
}

/**
 * auth_revoke_api_key — Immediately revoke an API key. Irreversible.
 */
export async function authRevokeApiKey(
  params: Record<string, unknown>,
  db: D1Database,
  user: UserContext,
): Promise<{ revoked: boolean }> {
  if (!user.isAuthenticated) {
    throw new UnauthorizedError('Authentication required');
  }

  const keyId = params.keyId;
  if (!keyId || typeof keyId !== 'string') {
    throw new ValidationError('keyId is required', 'keyId');
  }

  const timestamp = now();
  const result = await db
    .prepare(
      `UPDATE "_auth_api_keys" SET revoked_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .bind(timestamp, timestamp, keyId, user.id)
    .run();

  if (result.meta.changes === 0) {
    throw new NotFoundError('API key', keyId);
  }

  return { revoked: true };
}

/**
 * auth_rotate_api_key — Revoke old key and create a new one with the same name/scopes.
 */
export async function authRotateApiKey(
  params: Record<string, unknown>,
  db: D1Database,
  user: UserContext,
): Promise<CreateApiKeyResult> {
  if (!user.isAuthenticated) {
    throw new UnauthorizedError('Authentication required');
  }

  const keyId = params.keyId;
  if (!keyId || typeof keyId !== 'string') {
    throw new ValidationError('keyId is required', 'keyId');
  }

  // Fetch existing key
  const existing = await db
    .prepare(
      `SELECT id, name, scopes, user_id, expires_at
       FROM "_auth_api_keys"
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .bind(keyId, user.id)
    .first<{
      id: string;
      name: string;
      scopes: string;
      user_id: string;
      expires_at: string | null;
    }>();

  if (!existing) {
    throw new NotFoundError('API key', keyId);
  }

  // Revoke old + create new atomically
  const rawKey = generateApiKey();
  const keyHash = await hashApiKey(rawKey);
  const keyPrefix = getKeyPrefix(rawKey);
  const newKeyId = generateId();
  const timestamp = now();
  const scopes: string[] = JSON.parse(existing.scopes || '[]');

  await db.batch([
    db
      .prepare('UPDATE "_auth_api_keys" SET revoked_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL')
      .bind(timestamp, timestamp, keyId),
    db
      .prepare(
        `INSERT INTO "_auth_api_keys"
         (id, name, key_hash, key_prefix, user_id, scopes, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newKeyId,
        existing.name,
        keyHash,
        keyPrefix,
        user.id,
        existing.scopes,
        existing.expires_at,
        timestamp,
        timestamp,
      ),
  ]);

  return {
    key: {
      id: newKeyId,
      name: existing.name,
      keyPrefix,
      scopes,
      expiresAt: existing.expires_at,
      lastUsedAt: null,
      createdAt: timestamp,
      revokedAt: null,
    },
    rawKey,
  };
}
