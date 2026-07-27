/**
 * Admin API client (per-app management from the builder UI).
 *
 * Talks to the runtime worker's `/api/admin/:appId/*` routes. Those routes
 * authenticate the operator via the same `exepad_platform_session` cookie the
 * rest of the Studio uses (the worker checks app ownership server-side), so every
 * call just needs `credentials: 'include'` — no deploy secret in the browser.
 *
 * `mode` selects which database/config the call targets: 'preview' (the draft
 * the iframe shows) or 'published' (the live app's real data).
 */

export type AdminMode = 'preview' | 'published';

interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T;
}

async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(url, { credentials: 'include', ...init });
  let data: T;
  try {
    data = (await res.json()) as T;
  } catch {
    data = {} as T;
  }
  return { ok: res.ok, status: res.status, data };
}

function base(appId: string): string {
  return `/api/admin/${encodeURIComponent(appId)}`;
}

function modeQuery(mode: AdminMode, extra?: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams({ mode });
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== '') params.set(k, String(v));
    }
  }
  return `?${params.toString()}`;
}

// ─── Database ────────────────────────────────────────────────────────────────

export interface DbTable {
  name: string;
  rowCount: number;
}

export interface DbColumn {
  cid: number;
  name: string;
  type: string;
  notnull: boolean;
  dflt_value: string | null;
  pk: boolean;
}

export interface DbIndex {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type DbRow = Record<string, unknown>;

export async function listTables(appId: string, mode: AdminMode): Promise<DbTable[]> {
  const { ok, data } = await api<{ success?: boolean; data?: DbTable[] }>(
    `${base(appId)}/database/tables${modeQuery(mode)}`,
  );
  return ok && data.data ? data.data : [];
}

export async function getTableSchema(
  appId: string,
  table: string,
  mode: AdminMode,
): Promise<{ columns: DbColumn[]; indexes: DbIndex[] } | null> {
  const { ok, data } = await api<{
    success?: boolean;
    data?: { name: string; columns: DbColumn[]; indexes: DbIndex[] };
  }>(`${base(appId)}/database/tables/${encodeURIComponent(table)}/schema${modeQuery(mode)}`);
  return ok && data.data ? { columns: data.data.columns, indexes: data.data.indexes } : null;
}

export async function listRows(
  appId: string,
  table: string,
  mode: AdminMode,
  opts: { page?: number; pageSize?: number; search?: string } = {},
): Promise<{ ok: boolean; rows: DbRow[]; columns: DbColumn[]; pagination: Pagination; error?: string }> {
  const { ok, data } = await api<{
    success?: boolean;
    data?: DbRow[];
    columns?: DbColumn[];
    pagination?: Pagination;
    error?: string;
  }>(
    `${base(appId)}/database/tables/${encodeURIComponent(table)}/rows${modeQuery(mode, {
      page: opts.page,
      pageSize: opts.pageSize,
      search: opts.search,
    })}`,
  );
  return {
    ok: ok && Boolean(data.success),
    rows: data.data ?? [],
    columns: data.columns ?? [],
    pagination: data.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    error: data.error,
  };
}

export async function insertRow(
  appId: string,
  table: string,
  mode: AdminMode,
  rowData: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await api<{ success?: boolean; error?: string }>(
    `${base(appId)}/database/tables/${encodeURIComponent(table)}/rows${modeQuery(mode)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: rowData }) },
  );
  return { ok: ok && Boolean(data.success), error: data.error };
}

export async function updateRow(
  appId: string,
  table: string,
  mode: AdminMode,
  rowId: string | number,
  rowData: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await api<{ success?: boolean; error?: string }>(
    `${base(appId)}/database/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(String(rowId))}${modeQuery(mode)}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: rowData }) },
  );
  return { ok: ok && Boolean(data.success), error: data.error };
}

export async function deleteRow(
  appId: string,
  table: string,
  mode: AdminMode,
  rowId: string | number,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await api<{ success?: boolean; error?: string }>(
    `${base(appId)}/database/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(String(rowId))}${modeQuery(mode)}`,
    { method: 'DELETE' },
  );
  return { ok: ok && Boolean(data.success), error: data.error };
}

// ─── Users ───────────────────────────────────────────────────────────────────

export interface AppUser {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  roles: string;
  email_verified: number;
  created_at: string;
  updated_at: string;
  sessions?: number;
}

export interface UserSession {
  id: string;
  created_at: string;
  expires_at: string;
}

export async function listUsers(
  appId: string,
  mode: AdminMode,
  opts: { page?: number; pageSize?: number; search?: string } = {},
): Promise<{ users: AppUser[]; pagination: Pagination }> {
  const { ok, data } = await api<{ success?: boolean; data?: AppUser[]; pagination?: Pagination }>(
    `${base(appId)}/users${modeQuery(mode, { page: opts.page, pageSize: opts.pageSize, search: opts.search })}`,
  );
  return {
    users: ok && data.data ? data.data : [],
    pagination: data.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  };
}

export async function createUser(
  appId: string,
  mode: AdminMode,
  input: { email: string; password: string; name?: string; roles?: string },
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await api<{ success?: boolean; error?: string }>(
    `${base(appId)}/users${modeQuery(mode)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
  );
  return { ok: ok && Boolean(data.success), error: data.error };
}

export async function updateUser(
  appId: string,
  mode: AdminMode,
  userId: string,
  input: Partial<{ name: string; email: string; roles: string; email_verified: boolean; avatar_url: string }>,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await api<{ success?: boolean; error?: string }>(
    `${base(appId)}/users/${encodeURIComponent(userId)}${modeQuery(mode)}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
  );
  return { ok: ok && Boolean(data.success), error: data.error };
}

export async function deleteUser(
  appId: string,
  mode: AdminMode,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await api<{ success?: boolean; error?: string }>(
    `${base(appId)}/users/${encodeURIComponent(userId)}${modeQuery(mode)}`,
    { method: 'DELETE' },
  );
  return { ok: ok && Boolean(data.success), error: data.error };
}

export async function resetPassword(
  appId: string,
  mode: AdminMode,
  userId: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await api<{ success?: boolean; error?: string }>(
    `${base(appId)}/users/${encodeURIComponent(userId)}/reset-password${modeQuery(mode)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword }) },
  );
  return { ok: ok && Boolean(data.success), error: data.error };
}

export async function revokeSessions(
  appId: string,
  mode: AdminMode,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await api<{ success?: boolean; error?: string }>(
    `${base(appId)}/users/${encodeURIComponent(userId)}/sessions${modeQuery(mode)}`,
    { method: 'DELETE' },
  );
  return { ok: ok && Boolean(data.success), error: data.error };
}

// ─── Files ───────────────────────────────────────────────────────────────────

export interface AppFile {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  visibility: string;
  ownerId: string;
  modelName: string | null;
  recordId: string | null;
  fieldName: string | null;
  createdAt: string;
}

export async function listFiles(
  appId: string,
  mode: AdminMode,
  opts: { page?: number; pageSize?: number; search?: string } = {},
): Promise<{ items: AppFile[]; total: number; page: number; limit: number }> {
  const { ok, data } = await api<{
    success?: boolean;
    data?: { items: AppFile[]; total: number; page: number; limit: number };
  }>(`${base(appId)}/files${modeQuery(mode, { page: opts.page, pageSize: opts.pageSize, search: opts.search })}`);
  return ok && data.data ? data.data : { items: [], total: 0, page: 1, limit: 20 };
}

export function fileDownloadUrl(appId: string, fileId: string, mode: AdminMode): string {
  return `${base(appId)}/files/${encodeURIComponent(fileId)}/download${modeQuery(mode)}`;
}

export async function deleteFile(
  appId: string,
  mode: AdminMode,
  fileId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await api<{ success?: boolean; error?: string }>(
    `${base(appId)}/files/${encodeURIComponent(fileId)}${modeQuery(mode)}`,
    { method: 'DELETE' },
  );
  return { ok: ok && Boolean(data.success), error: data.error };
}

// ─── Security settings ───────────────────────────────────────────────────────

export type AuthProvider = 'email' | 'google' | 'exepad';

export interface AppSecurity {
  enabled?: boolean;
  authProviders?: Array<{ provider: AuthProvider }>;
  sessionDuration?: number;
  requireVerification?: boolean;
  allowSignup?: boolean;
  passwordPolicy?: { minLength?: number; requireUppercase?: boolean; requireNumber?: boolean };
  roles?: string[];
  defaultRole?: string;
  defaultAccess?: 'public' | 'authenticated' | 'owner' | 'none';
}

export async function getSecurity(
  appId: string,
  mode: AdminMode,
): Promise<{ ok: boolean; security: AppSecurity | null; models: string[]; error?: string }> {
  const { ok, data } = await api<{
    success?: boolean;
    data?: { security: AppSecurity | null; models: string[] };
    error?: string;
  }>(`${base(appId)}/settings${modeQuery(mode)}`);
  return {
    ok: ok && Boolean(data.success),
    security: data.data?.security ?? null,
    models: data.data?.models ?? [],
    error: data.error,
  };
}

export async function saveSecurity(
  appId: string,
  mode: AdminMode,
  security: AppSecurity,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await api<{ success?: boolean; error?: string }>(
    `${base(appId)}/settings${modeQuery(mode)}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ security }) },
  );
  return { ok: ok && Boolean(data.success), error: data.error };
}

// ─── Source code (read-only) ───────────────────────────────────────────────────
//
// The source routes are NOT mode-scoped: "source" is the app's generated code
// (the latest preview/draft working set), independent of the preview/published
// data split the rest of the admin API uses.

export interface SourceFileEntry {
  path: string;
  size: number;
}

export async function listSource(
  appId: string,
): Promise<{ ok: boolean; status: number; files: SourceFileEntry[]; appName: string; error?: string }> {
  const { ok, status, data } = await api<{
    success?: boolean;
    data?: { files: SourceFileEntry[]; appName: string };
    error?: string;
  }>(`${base(appId)}/source`);
  return {
    ok: ok && Boolean(data.success),
    status,
    files: data.data?.files ?? [],
    appName: data.data?.appName ?? 'app',
    error: data.error,
  };
}

export async function getSourceFile(
  appId: string,
  path: string,
): Promise<{ ok: boolean; status: number; content: string; error?: string }> {
  const res = await fetch(`${base(appId)}/source/file?path=${encodeURIComponent(path)}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    let error = `Failed to load file (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) error = j.error;
    } catch {
      /* non-JSON error body */
    }
    return { ok: false, status: res.status, content: '', error };
  }
  return { ok: true, status: res.status, content: await res.text() };
}

export function sourceZipUrl(appId: string): string {
  return `${base(appId)}/source/download`;
}

/** Export-kit download URLs (owner-gated, server-built zips). */
export type ExportKind = 'handover' | 'source' | 'deployable';

export function exportZipUrl(appId: string, kind: ExportKind): string {
  return `${base(appId)}/export/${kind}`;
}
