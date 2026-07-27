/**
 * Single-app serve mode.
 *
 * When `EXEPAD_SINGLE_APP_ID` is set, the container serves exactly ONE published
 * app at the origin root — no studio/builder UI, no agent, no deploy/admin/
 * orchestrate surface. This is the shape the **deployable bundle (D1)** ships: a
 * run-ready, self-contained copy of one app the user hosts on their own VPS.
 *
 * Mechanically it is identical to the proven `{appId}.exepad.app` subdomain
 * serving — `#root[data-app-id]` set, route-mode `domain` (basePath `''`) — with
 * one swap: the asset handlers that read the appId from the subdomain host on
 * cloud read it from {@link singleAppId} instead. Everything else (config load,
 * gateway dispatch, per-app auth) is unchanged.
 */

/** The pinned app id, or '' in normal multi-app/studio mode. Read live (not
 *  cached at module load) so tests can toggle it via process.env. */
export function singleAppId(): string {
  return (process.env.EXEPAD_SINGLE_APP_ID ?? '').trim();
}

export function isSingleAppMode(): boolean {
  return singleAppId().length > 0;
}

/**
 * Server-side path prefixes that DO NOT exist in a shipped single app: the
 * builder/operator/agent surface. Requests to these are refused (404) up front
 * so a deployable bundle exposes only the app itself. `/auth/status` is exempt
 * (cheap liveness probe for container healthchecks); per-app flows that ride the
 * gateway (`/api/{appId}/rpc`, `/verify-email`) are NOT listed here.
 */
const BLOCKED_PREFIXES = [
  '/agent/',
  '/api/orchestrate',
  '/api/deploy',
  '/api/deprovision',
  '/api/admin',
  '/api/settings',
  '/auth/',
] as const;

/** True when `pathname` targets a builder/operator surface that a shipped
 *  single app must not expose. `/auth/status` is allowed through. */
export function isBlockedInSingleApp(pathname: string): boolean {
  if (pathname === '/auth/status') return false;
  if (pathname.includes('/_diag/')) return true;
  return BLOCKED_PREFIXES.some(
    (pre) => pathname === pre.replace(/\/$/, '') || pathname.startsWith(pre),
  );
}
