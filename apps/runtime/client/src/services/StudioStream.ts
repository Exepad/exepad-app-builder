/**
 * Studio client (self-hosted builder UI).
 *
 * Talks to the runtime worker's local auth (`/auth/*`) and orchestration
 * (`/api/orchestrate/*`) routes. The platform session is an HttpOnly cookie set
 * by `/auth/login`, so requests just need `credentials: 'include'`; there is no
 * token for JS to read.
 *
 * `runBuild` POSTs a prompt and streams the agent's Server-Sent Events back —
 * `EventSource` is GET-only, so we use `fetch` streaming and parse the
 * `text/event-stream` body chunk by chunk.
 */

export interface StudioUser {
  id: string;
  email: string;
  role: string;
}

export interface StudioApp {
  id: string;
  name: string;
  /** The app's alias — its `<slug>.yourdomain.com` label under a wildcard custom domain. */
  slug: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  previewUrl: string;
  publishedUrl: string | null;
  /** Dashboard preview image captured by the maintenance cron; null until one
   *  exists (the card falls back to a placeholder). */
  thumbnailUrl: string | null;
}

/** Parsed SSE payload. Agent events (progress/chat_message/app_config_updated/
 * backend_response/page_reload) plus the orchestrator's own `deploy_status`. */
export interface StudioEvent {
  type?: string;
  [key: string]: unknown;
}

export interface RunHandle {
  appId: string | null;
  sessionId: string | null;
  done: Promise<void>;
}

async function jsonFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, { credentials: 'include', ...init });
  let data: T;
  try {
    data = (await res.json()) as T;
  } catch {
    data = {} as T;
  }
  return { ok: res.ok, status: res.status, data };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function authStatus(): Promise<{ needsSetup: boolean; setupTokenRequired: boolean }> {
  const { ok, data } = await jsonFetch<{ needsSetup?: boolean; setupTokenRequired?: boolean }>(
    '/auth/status',
  );
  return {
    needsSetup: ok ? Boolean(data.needsSetup) : false,
    setupTokenRequired: ok ? Boolean(data.setupTokenRequired) : false,
  };
}

// Dedupe /auth/me: it's checked independently by several components across a
// single navigation (HomePage redirect → StudioShell guard → page), which fired
// the request 2–3× on every dashboard load. Collapse concurrent calls onto one
// in-flight promise plus a short result cache; invalidate on any auth transition
// (login/setup/logout) so a freshly changed session is never served stale.
const AUTH_ME_TTL_MS = 1500;
let authMeInflight: Promise<StudioUser | null> | null = null;
let authMeCache: { user: StudioUser | null; at: number } | null = null;

export function invalidateAuthMe(): void {
  authMeInflight = null;
  authMeCache = null;
}

export async function authMe(): Promise<StudioUser | null> {
  if (authMeInflight) return authMeInflight;
  if (authMeCache && Date.now() - authMeCache.at < AUTH_ME_TTL_MS) {
    return authMeCache.user;
  }
  authMeInflight = (async () => {
    const { ok, data } = await jsonFetch<{ success?: boolean; user?: StudioUser }>('/auth/me');
    const user = ok && data.user ? data.user : null;
    authMeCache = { user, at: Date.now() };
    return user;
  })().finally(() => {
    authMeInflight = null;
  });
  return authMeInflight;
}

export async function login(
  email: string,
  password: string,
): Promise<{ ok: boolean; user?: StudioUser; error?: string }> {
  const { ok, data } = await jsonFetch<{ success?: boolean; user?: StudioUser; error?: string }>(
    '/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
  );
  if (ok && data.success) invalidateAuthMe();
  return { ok: ok && Boolean(data.success), user: data.user, error: data.error };
}

export async function setup(
  email: string,
  password: string,
  setupToken?: string,
): Promise<{ ok: boolean; user?: StudioUser; error?: string }> {
  const { ok, data } = await jsonFetch<{ success?: boolean; user?: StudioUser; error?: string }>(
    '/auth/setup',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, setupToken: setupToken || undefined }),
    },
  );
  if (ok && data.success) invalidateAuthMe();
  return { ok: ok && Boolean(data.success), user: data.user, error: data.error };
}

export async function logout(): Promise<void> {
  invalidateAuthMe();
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await jsonFetch<{ success?: boolean; error?: string }>(
    '/auth/change-password',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    },
  );
  return { ok: ok && Boolean(data.success), error: data.error };
}

// ─── Apps ─────────────────────────────────────────────────────────────────────

export interface StudioAppsPage {
  apps: StudioApp[];
  /** Opaque token for the next page, or null when this is the last page. */
  nextCursor: string | null;
}

/** One keyset page of the operator's apps, newest first. Pass the previous
 *  page's `nextCursor` to continue. Prefer this over {@link listApps} for the
 *  dashboard — it keeps each response bounded regardless of app count. */
export async function listAppsPage(
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<StudioAppsPage> {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.cursor) params.set('cursor', opts.cursor);
  const qs = params.toString();
  const { ok, data } = await jsonFetch<{ apps?: StudioApp[]; nextCursor?: string | null }>(
    `/api/orchestrate/apps${qs ? `?${qs}` : ''}`,
  );
  return {
    apps: ok && data.apps ? data.apps : [],
    nextCursor: ok ? data.nextCursor ?? null : null,
  };
}

/** Every app the operator owns, fetched page-by-page. Convenience loader for
 *  callers that genuinely need the full set (e.g. the addresses settings list);
 *  the dashboard should page with {@link listAppsPage} instead. */
export async function listApps(): Promise<StudioApp[]> {
  const all: StudioApp[] = [];
  let cursor: string | null = null;
  // Bounded to avoid an unbounded loop if the server ever returns a stuck cursor.
  for (let guard = 0; guard < 1000; guard++) {
    const page = await listAppsPage({ cursor });
    all.push(...page.apps);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return all;
}

/** Rename an app's alias — its `<alias>.yourdomain.com` wildcard subdomain label.
 *  Validated + uniqueness-checked server-side; returns the stored slug on success. */
export async function renameAppAlias(
  appId: string,
  alias: string,
): Promise<{ ok: boolean; slug?: string; error?: string }> {
  const { ok, data } = await jsonFetch<{ success?: boolean; slug?: string; error?: string }>(
    `/api/orchestrate/apps/${encodeURIComponent(appId)}/alias`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alias }) },
  );
  return { ok: ok && Boolean(data.success), slug: data.slug, error: data.error };
}

export async function getApp(
  appId: string,
): Promise<{ app: StudioApp; preview: unknown; published: unknown } | null> {
  const { ok, data } = await jsonFetch<{
    success?: boolean;
    app?: StudioApp;
    preview?: unknown;
    published?: unknown;
  }>(`/api/orchestrate/apps/${encodeURIComponent(appId)}`);
  return ok && data.app
    ? { app: data.app, preview: data.preview, published: data.published }
    : null;
}

export async function publishApp(
  appId: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const { ok, data } = await jsonFetch<{ success?: boolean; url?: string; error?: string }>(
    `/api/orchestrate/apps/${encodeURIComponent(appId)}/publish`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } },
  );
  return { ok: ok && Boolean(data.success), url: data.url, error: data.error };
}

/**
 * Take a published app offline (soft unpublish — keeps the preview build so it
 * can be re-published cheaply). Hits the orchestrate endpoint, which accepts the
 * operator's platform session cookie. Returns `ok` + the new status
 * ('preview' | 'draft') so the caller can reset its published-URL state.
 */
export async function unpublishApp(
  appId: string,
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const { ok, data } = await jsonFetch<{ status?: string; error?: { message?: string } }>(
    `/api/orchestrate/apps/${encodeURIComponent(appId)}/unpublish`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
  return { ok, status: data.status, error: data.error?.message };
}

/**
 * Permanently delete an app (owner-only) — tears down storage + per-mode SQLite
 * DBs and drops the registry rows. Hits the orchestrate endpoint
 * (cookie-authenticated). `partial` is true when storage teardown was partial
 * but the app was still removed from listings.
 */
export async function deleteApp(
  appId: string,
): Promise<{ ok: boolean; partial?: boolean; error?: string }> {
  const { ok, data } = await jsonFetch<{
    deleted?: boolean;
    partial?: boolean;
    error?: { message?: string };
  }>(`/api/orchestrate/apps/${encodeURIComponent(appId)}`, { method: 'DELETE' });
  return { ok: ok && Boolean(data.deleted), partial: data.partial, error: data.error?.message };
}

export interface AppVersion {
  id: number;
  createdAt: string;
  label: string | null;
  current: boolean;
}

export async function listVersions(appId: string): Promise<AppVersion[]> {
  const { ok, data } = await jsonFetch<{ versions?: AppVersion[] }>(
    `/api/orchestrate/apps/${encodeURIComponent(appId)}/versions`,
  );
  return ok && data.versions ? data.versions : [];
}

export async function restoreVersion(
  appId: string,
  versionId: number,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await jsonFetch<{ success?: boolean; error?: string }>(
    `/api/orchestrate/apps/${encodeURIComponent(appId)}/versions/${versionId}/restore`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } },
  );
  return { ok: ok && Boolean(data.success), error: data.error };
}

export async function cancelRun(sessionId: string): Promise<void> {
  await fetch('/api/orchestrate/cancel', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

// ─── Share live URL (Cloudflare Quick Tunnel) ────────────────────────────────

export type TunnelStatus = 'idle' | 'starting' | 'live' | 'stopping' | 'error';

export interface TunnelStatusEvent {
  status?: TunnelStatus;
  url?: string | null;
  error?: string | null;
  appId?: string | null;
}

/** Begin sharing the given app over an ephemeral *.trycloudflare.com link. The
 *  POST returns once the tunnel is live (or fails); progress is mirrored on the
 *  /status SSE stream so a re-opened Studio can re-attach. */
export async function startTunnel(
  appId: string,
): Promise<{ ok: boolean; url?: string; status?: TunnelStatus; error?: string }> {
  const { ok, data } = await jsonFetch<{
    success?: boolean;
    url?: string;
    status?: TunnelStatus;
    error?: string;
  }>('/api/publish/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId }),
  });
  return { ok: ok && Boolean(data.success), url: data.url, status: data.status, error: data.error };
}

export async function stopTunnel(): Promise<void> {
  await fetch('/api/publish/stop', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Subscribe to the tunnel status stream (local operator↔container only — it
 * never crosses the tunnel). Resolves when the stream ends or is aborted. Used
 * on Studio mount to re-attach to an already-live share.
 */
export async function streamTunnelStatus(
  onEvent: (event: TunnelStatusEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/publish/status', {
      credentials: 'include',
      headers: { Accept: 'text/event-stream' },
      signal,
    });
  } catch {
    return;
  }
  if (!res.ok || !res.body) return;
  await pumpSse(res.body, (e) => onEvent(e as TunnelStatusEvent));
}

// ─── Quick Access (Cloudflare quick tunnel to the WHOLE studio) ──────────────---
//
// Distinct from startTunnel above (which shares ONE app): this tunnels the entire
// login-gated studio so the operator can reach their own rig from behind a router.
// Reuses TunnelStatus; the events carry no appId. Endpoints: /api/quick-access/*.

/** Start (or re-attach to) the Quick Access studio tunnel. Resolves once the
 *  tunnel is live or fails; progress is also mirrored on the /status SSE stream. */
export async function startQuickAccess(): Promise<{
  ok: boolean;
  url?: string;
  status?: TunnelStatus;
  error?: string;
}> {
  const { ok, data } = await jsonFetch<{
    success?: boolean;
    url?: string;
    status?: TunnelStatus;
    error?: string;
  }>('/api/quick-access/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return { ok: ok && Boolean(data.success), url: data.url, status: data.status, error: data.error };
}

export async function stopQuickAccess(): Promise<void> {
  await fetch('/api/quick-access/stop', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Subscribe to the Quick Access status stream (local operator↔container only).
 *  Resolves when the stream ends or is aborted. Used on mount to re-attach. */
export async function streamQuickAccessStatus(
  onEvent: (event: TunnelStatusEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/quick-access/status', {
      credentials: 'include',
      headers: { Accept: 'text/event-stream' },
      signal,
    });
  } catch {
    return;
  }
  if (!res.ok || !res.body) return;
  await pumpSse(res.body, (e) => onEvent(e as TunnelStatusEvent));
}

// ─── Settings ──────────────────────────────────────────────────────────────---

/** A secret value as reported by the server — never the raw value. */
export interface SecretView {
  set: boolean;
  source: 'store' | 'env' | 'none';
  hint: string;
}

/** Exactly one stock-image source is active at a time. Openverse is keyless
 *  (the default, and the agent's silent last-resort fallback); the rest need a
 *  free API key. */
export type ImageProvider = 'openverse' | 'pexels' | 'unsplash' | 'pixabay';

export interface StudioSettings {
  llm: {
    provider: string;
    model: string;
    baseUrl: string;
    apiKey: SecretView;
  };
  images: {
    provider: ImageProvider;
    /** Whether generated apps may keep the image URLs the LLM suggests
     *  (default true). When false, every image is re-sourced from the active
     *  stock provider instead. */
    keepLlmUrls: boolean;
    pexels: { apiKey: SecretView };
    unsplash: { apiKey: SecretView };
    pixabay: { apiKey: SecretView };
  };
}

export interface SettingsInput {
  llm?: { provider?: string; model?: string; baseUrl?: string; apiKey?: string };
  images?: {
    provider?: ImageProvider;
    keepLlmUrls?: boolean;
    pexels?: { apiKey?: string };
    unsplash?: { apiKey?: string };
    pixabay?: { apiKey?: string };
  };
}

export interface ProviderModel {
  id: string;
  name: string;
  contextLength: number | null;
}

export async function getSettings(): Promise<StudioSettings | null> {
  const { ok, data } = await jsonFetch<{ success?: boolean; settings?: StudioSettings }>(
    '/api/settings',
  );
  return ok && data.settings ? data.settings : null;
}

/** Result of the read-only "newer version published?" probe (server-cached 6h). */
export interface UpdateCheck {
  enabled: boolean;
  current: string;
  latest: string | null;
  /** true = newer version exists; false = up to date; null = unknown (dev build / offline). */
  updateAvailable: boolean | null;
  /** The operator command that applies the update (backs up /data first). */
  applyWith?: string | null;
}

export async function getUpdateCheck(): Promise<UpdateCheck | null> {
  const { ok, data } = await jsonFetch<{ success?: boolean } & UpdateCheck>(
    '/api/settings/update-check',
  );
  return ok && data.success !== false ? data : null;
}

export async function saveSettings(
  input: SettingsInput,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await jsonFetch<{ success?: boolean; error?: string }>('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return { ok: ok && Boolean(data.success), error: data.error };
}

export async function getProviderModels(provider: string): Promise<ProviderModel[]> {
  const { ok, data } = await jsonFetch<{ success?: boolean; models?: ProviderModel[] }>(
    `/api/settings/models?provider=${encodeURIComponent(provider)}`,
  );
  return ok && data.models ? data.models : [];
}

// ─── Custom domains (self-serve custom domain + SSL) ──────────────────────────

export interface DomainDnsRecord {
  type: 'A' | 'CNAME' | 'TXT';
  name: string;
  value: string;
  note?: string;
}

export interface CustomDomain {
  domain: string;
  appId: string | null;
  mapsTo: string;
  mode: string;
  /** 'proxied' = the operator's own proxy owns the address record (TXT-only checks). */
  routing?: string | null;
  status: 'pending' | 'verifying' | 'active' | 'error' | string;
  hsts: boolean;
  dnsTarget: string | null;
  verificationToken: string;
  challenge: { name: string; value: string };
  dnsRecords: DomainDnsRecord[];
  liveUrl: string;
  lastError: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DomainsInstance {
  dnsTarget: string | null;
  dnsTargetType: 'A' | 'CNAME' | null;
  /** Where dnsTarget came from: explicit env, a local NIC IP, or the egress IP. */
  dnsTargetSource: 'host-env' | 'ip-env' | 'interface' | 'detected' | 'none';
  /** Best-effort: is the box on a public (routable) address? */
  publiclyRoutable: boolean;
  tls: {
    /** Did the studio request arrive over HTTPS? (True by default — TLS is on out of the box.) */
    secure: boolean;
    /**
     * Trust class of the address this request used:
     *  - 'trusted'     = browser-trusted cert (Caddy ACME on a registered/sslip host);
     *  - 'self-signed' = the zero-config in-process floor (one-time browser warning);
     *  - 'https'       = secure via a terminator we don't classify (your own proxy);
     *  - 'plain'       = HTTPS disabled.
     */
    mode: 'trusted' | 'self-signed' | 'https' | 'plain';
    /** True when this request's own address has a browser-trusted certificate. */
    trusted: boolean;
    /** A browser-trusted URL to share (the sslip host on a public box), or null. */
    trustedUrl: string | null;
    /** Is the instance actually SERVING HTTPS (in-process listener up), regardless
     *  of how this request arrived? Distinguishes "you're on the HTTP origin" from
     *  "HTTPS is off". */
    httpsActive: boolean;
    /** Was HTTPS explicitly turned off via EXEPAD_HTTPS_DISABLE? */
    httpsDisabled: boolean;
    /** Same-host HTTPS URL to open when you're viewing over plain HTTP, else null. */
    httpsUrl: string | null;
    /** Whether EXEPAD_ACME_EMAIL is set (advisory — issuance works without it). */
    acmeEmail: boolean;
  };
}

export interface CreateDomainInput {
  target: 'domain' | 'ip';
  domain?: string;
  ip?: string;
  appId?: string | null;
  mode?: string;
  /** 'proxied' = own proxy terminates TLS; only the ownership TXT record applies. */
  routing?: 'proxied';
}

export async function listDomains(
  refresh = false,
): Promise<{ domains: CustomDomain[]; instance: DomainsInstance } | null> {
  const { ok, data } = await jsonFetch<{
    success?: boolean;
    domains?: CustomDomain[];
    instance?: DomainsInstance;
  }>(`/api/domains${refresh ? '?refresh=1' : ''}`);
  if (!ok || !data.success) return null;
  const instance: DomainsInstance = data.instance ?? {
    dnsTarget: null,
    dnsTargetType: null,
    dnsTargetSource: 'none',
    publiclyRoutable: false,
    tls: { secure: false, mode: 'plain', trusted: false, trustedUrl: null, httpsActive: false, httpsDisabled: false, httpsUrl: null, acmeEmail: false },
  };
  return { domains: data.domains ?? [], instance };
}

export async function createDomain(
  input: CreateDomainInput,
): Promise<{ ok: boolean; domain?: CustomDomain; error?: string }> {
  const { ok, data } = await jsonFetch<{ success?: boolean; domain?: CustomDomain; error?: string }>(
    '/api/domains',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
  );
  return { ok: ok && Boolean(data.success), domain: data.domain, error: data.error };
}

export async function verifyDomain(
  domain: string,
): Promise<{ ok: boolean; verified: boolean; domain?: CustomDomain; error?: string }> {
  const { ok, data } = await jsonFetch<{
    success?: boolean;
    verified?: boolean;
    domain?: CustomDomain;
    error?: string;
  }>(`/api/domains/${encodeURIComponent(domain)}/verify`, { method: 'POST' });
  return { ok: ok && Boolean(data.success), verified: Boolean(data.verified), domain: data.domain, error: data.error };
}

export async function patchDomain(
  domain: string,
  body: { appId?: string | null; mode?: string; hsts?: boolean },
): Promise<{ ok: boolean; domain?: CustomDomain; error?: string }> {
  const { ok, data } = await jsonFetch<{ success?: boolean; domain?: CustomDomain; error?: string }>(
    `/api/domains/${encodeURIComponent(domain)}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  return { ok: ok && Boolean(data.success), domain: data.domain, error: data.error };
}

export async function removeDomain(domain: string): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await jsonFetch<{ success?: boolean; error?: string }>(
    `/api/domains/${encodeURIComponent(domain)}`,
    { method: 'DELETE' },
  );
  return { ok: ok && Boolean(data.success), error: data.error };
}

/** Live state of one expected DNS record (drives the wizard's status pills). */
export type DnsCheckState = 'ok' | 'mismatch' | 'missing' | 'error' | 'skipped';

export interface DnsRecordCheck {
  type: 'A' | 'CNAME' | 'TXT';
  name: string;
  expected: string;
  observed: string[];
  state: DnsCheckState;
  detail?: string;
}

/** Read-only probe: resolve the domain's expected records and report what's live
 *  right now. Never changes state — safe to poll while the operator sets up DNS. */
export async function checkDomainDns(
  domain: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; records: DnsRecordCheck[]; checkedAt?: string }> {
  const { ok, data } = await jsonFetch<{
    success?: boolean;
    records?: DnsRecordCheck[];
    checkedAt?: string;
  }>(`/api/domains/${encodeURIComponent(domain)}/check`, { signal });
  return { ok: ok && Boolean(data.success), records: data.records ?? [], checkedAt: data.checkedAt };
}

// ─── Server & networking (public address override + CORS/CSRF allowlist) ──────

/** Where an effective networking value came from: the operator's saved override,
 *  the process-env seed, or neither. */
export type NetSource = 'store' | 'env' | 'none';

/** One editable front port: what a restart would bind vs. what's bound right now. */
export interface FrontPort {
  /** Configured (store override ?? env seed ?? default) — what a restart would bind. */
  configuredPort: number;
  /** Bound right now. Differs from configuredPort until the server is restarted. */
  runningPort: number;
  /** configuredPort !== runningPort — a restart is needed to serve on the new port. */
  pendingRestart: boolean;
}

export interface NetworkConfig {
  /** The studio's FRONT-facing port — the one the operator opens in the browser.
   *  The one editable socket knob: it binds at startup (store override ?? env seed),
   *  so a saved change applies on the next restart. */
  server: {
    /** Which knob backs the front port: 'https' (in-process TLS, e.g. :443) writes
     *  net.https_port; 'http' (built-in HTTPS off) writes net.http_port. */
    portKind: 'https' | 'http';
    /** The port the studio is actually reached on RIGHT NOW (matches the URL). */
    frontPort: number;
    /** The configured port (store override ?? env seed ?? default) — what a restart
     *  would bind. Differs from frontPort until the server is restarted. */
    configuredPort: number;
    /** Where the configured port comes from: operator override, env seed, or neither. */
    portSource: NetSource;
    /** configuredPort !== frontPort — a restart is needed to serve on the new port. */
    pendingRestart: boolean;
    /** False ONLY when an EXTERNAL proxy terminates TLS (it owns the public port).
     *  True for the in-image Caddy (we bind and can move the port) and for local mode. */
    editable: boolean;
    /** A TLS proxy terminates in front of us, so the browser address is the proxy's. */
    tlsFronted: boolean;
    /** Our OWN in-image Caddy fronts TLS (host networking) — we bind the HTTPS port
     *  and can move it; distinct from an operator's external proxy. */
    managedTls: boolean;
    /** The studio can restart ITSELF to apply a port change (managed container with
     *  restart: unless-stopped). False for local mode, where the operator restarts. */
    canSelfRestart: boolean;
    /** Two-port split — the APPS front (every published app subdomain, default 443 →
     *  clean URLs) and the STUDIO front (the admin studio; defaults to the apps port).
     *  Only rendered when managedTls is true; otherwise use the single front above. */
    apps: FrontPort;
    studio: FrontPort;
    /** Direct-IP access: serve bare-IP visitors on the raw IP (allowed) vs. redirect
     *  them to the trusted sslip host (default). Managed container only; applies on
     *  the next restart. `trustedCert` = acme.sh has a live Let's Encrypt cert for the
     *  bare IP, so it's served browser-trusted (no warning) rather than internal-CA. */
    ipAccess: { allowed: boolean; pendingRestart: boolean; trustedCert: boolean };
  };
  publicAddress: {
    host: { value: string; source: NetSource };
    ip: { value: string; source: NetSource };
    /** What the instance actually advertises right now (override, then detection). */
    detected: {
      value: string | null;
      type: 'A' | 'CNAME' | null;
      source: 'host-env' | 'ip-env' | 'interface' | 'detected' | 'none';
      publiclyRoutable: boolean;
    };
  };
  cors: {
    allowedOrigins: string[];
    allowedOriginsSource: NetSource;
    strictLocalCors: boolean;
    strictLocalCorsSource: NetSource;
    /** Verified custom domains that are auto-trusted as credentialed origins. */
    autoTrustedHosts: string[];
  };
}

export interface NetworkUpdate {
  publicHost?: string;
  publicIp?: string;
  allowedOrigins?: string[];
  strictLocalCors?: boolean;
  /** New studio HTTP port. '' clears the override (reverts to the PORT env seed). */
  httpPort?: number | string;
  /** New studio HTTPS port. '' clears (reverts to the EXEPAD_HTTPS_PORT env seed). */
  httpsPort?: number | string;
  /** New APPS front port (managed container). '' clears (reverts to legacy/env/443). */
  appsPort?: number | string;
  /** New STUDIO front port (managed container). '' clears (reverts to the apps port). */
  studioPort?: number | string;
  /** Serve bare-IP visitors directly (true) vs. redirect to the trusted sslip host. */
  allowIpAccess?: boolean;
}

export async function getNetworkConfig(): Promise<NetworkConfig | null> {
  const { ok, data } = await jsonFetch<{ success?: boolean; network?: NetworkConfig }>(
    '/api/network',
  );
  return ok && data.success && data.network ? data.network : null;
}

export async function putNetworkConfig(
  update: NetworkUpdate,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await jsonFetch<{ success?: boolean; error?: string }>('/api/network', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  return { ok: ok && Boolean(data.success), error: data.error };
}

/** Restart the studio (managed container only) to apply a saved port change. The
 *  server acks, then exits; Docker's restart policy brings it back on the new port. */
export async function restartInstance(): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await jsonFetch<{ success?: boolean; error?: string }>(
    '/api/network/restart',
    { method: 'POST' },
  );
  return { ok: ok && Boolean(data.success), error: data.error };
}

// ─── Build run (streaming SSE over fetch) ────────────────────────────────────

/**
 * Parse a `text/event-stream` body chunk by chunk, dispatching each `data:`
 * payload to `onEvent`. Shared by the build stream (`runBuild`) and the
 * reconnect/history stream (`streamChat`). Resolves when the stream ends or the
 * underlying fetch is aborted.
 */
async function pumpSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StudioEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of rawEvent.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            onEvent(JSON.parse(line.slice(5).trim()) as StudioEvent);
          } catch {
            /* keepalive / non-JSON line */
          }
        }
      }
    }
  } catch {
    /* aborted or transport error — surfaced by the abort/caller */
  }
}

/**
 * Start a build. Returns immediately with the appId/sessionId (from response
 * headers) and a `done` promise that resolves when the stream ends. `onEvent`
 * fires for every SSE payload as it arrives.
 */
export async function runBuild(
  params: { prompt: string; appId?: string; appName?: string; operationMode?: 'create' | 'edit' },
  onEvent: (event: StudioEvent) => void,
  signal?: AbortSignal,
): Promise<RunHandle> {
  const res = await fetch('/api/orchestrate/run', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: params.prompt,
      app_id: params.appId,
      app_name: params.appName,
      operation_mode: params.operationMode,
    }),
    signal,
  });

  const appId = res.headers.get('X-App-Id');
  const sessionId = res.headers.get('X-Session-Id');

  if (!res.ok || !res.body) {
    let error = `Build failed (HTTP ${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) error = data.error;
    } catch {
      /* non-JSON */
    }
    onEvent({ type: 'deploy_status', status: 'failed', error });
    return { appId, sessionId, done: Promise.resolve() };
  }

  const done = pumpSse(res.body, onEvent);
  return { appId, sessionId, done };
}

/**
 * Load an app's persisted build conversation and re-attach to any build still
 * running for it. Opened on Studio mount. Emits the same `StudioEvent` shapes as
 * `runBuild` (so the timeline reducer is reused) plus two control frames:
 *   - `{ type: 'chat_state', running, sessionId }` — first, before history.
 *   - `{ type: 'chat_history_end' }` — marks the end of the replayed history;
 *     events after it are live.
 * Resolves when the stream ends (history-only apps close immediately; a live
 * build keeps it open until the build finishes).
 */
export async function streamChat(
  appId: string,
  onEvent: (event: StudioEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/orchestrate/apps/${encodeURIComponent(appId)}/stream`, {
      credentials: 'include',
      headers: { Accept: 'text/event-stream' },
      signal,
    });
  } catch {
    return; // aborted before the response arrived, or network error
  }
  if (!res.ok || !res.body) return;
  await pumpSse(res.body, onEvent);
}
