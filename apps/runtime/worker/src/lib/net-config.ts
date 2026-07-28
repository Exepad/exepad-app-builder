/**
 * Effective networking config (self-hosted single container).
 *
 * The operator can tune a handful of network knobs at runtime from the "Server &
 * networking" panel without editing env files or restarting. Those values live in
 * the meta.sqlite `settings` store and OVERRIDE the process environment, which is
 * only the first-boot seed / fallback — exactly the precedence the LLM/image
 * settings already use (see routes/settings.ts).
 *
 * This module is the single reader both the request hot paths (origin.ts CORS
 * boundary) and the DNS-target resolver (public-address.ts) consult, so a value
 * saved in the UI takes effect on the very next request with no restart.
 *
 * ONLY these knobs are runtime-tunable — they are all read live on each request:
 *   - public host / public IP  → the DNS target + cert SAN advertised to operators
 *   - allowed origins          → the credentialed-CORS / CSRF trust allowlist
 *   - strict local CORS        → drop the wildcard-port loopback reflection
 *
 * Socket-level knobs (PORT, EXEPAD_HTTPS_PORT, EXEPAD_HTTPS_DISABLE, …) bind at
 * boot and CANNOT change without a restart, so they are read-only in the UI and
 * never routed through here.
 *
 * Store reads are wrapped defensively: if meta.sqlite is unavailable (e.g. a pure
 * unit test with no EXEPAD_META_DB and no /data volume), we transparently fall
 * back to the process env, so importing this module never forces a DB to exist.
 */
import { getSetting, getSettingsRevision } from './meta-db';

/** A tunable knob: its flat `settings` key and the env var that seeds it. */
interface NetKey {
  key: string;
  env: string;
}

export const NET_KEYS = {
  publicHost: { key: 'net.public_host', env: 'EXEPAD_PUBLIC_HOST' },
  publicIp: { key: 'net.public_ip', env: 'EXEPAD_PUBLIC_IP' },
  allowedOrigins: { key: 'net.allowed_origins', env: 'EXEPAD_ALLOWED_ORIGINS' },
  strictLocalCors: { key: 'net.strict_local_cors', env: 'EXEPAD_STRICT_LOCAL_CORS' },
  // Socket / cookie boot knobs. These are consumed by server/main.ts at STARTUP
  // (a store value overrides the env seed), so an edit here applies on the next
  // restart — not hot. The UI surfaces that + a "configured vs running" diff.
  httpPort: { key: 'net.http_port', env: 'PORT' },
  httpsPort: { key: 'net.https_port', env: 'EXEPAD_HTTPS_PORT' },
  httpsDisable: { key: 'net.https_disable', env: 'EXEPAD_HTTPS_DISABLE' },
  cookieSecure: { key: 'net.cookie_secure', env: 'EXEPAD_COOKIE_SECURE' },
  // Two-port split (managed in-image Caddy only). The APPS port fronts every
  // published app subdomain (default 443 → clean per-app URLs); the STUDIO port
  // fronts the admin studio and may differ from the apps port. When they're equal
  // the in-image Caddy runs a single unified listener (the historical behavior);
  // when they differ it runs two listeners and the worker canonically redirects a
  // studio host off the apps port (and an app host off the studio port). Both bind
  // at boot from the settings store, so an edit applies on the next restart. The
  // legacy single `httpsPort` knob (which moved the WHOLE front) seeds the apps
  // port so existing installs keep serving on the same port after upgrade.
  appsPort: { key: 'net.apps_port', env: 'EXEPAD_APPS_PORT' },
  studioPort: { key: 'net.studio_port', env: 'EXEPAD_STUDIO_PORT' },
  // Direct-IP access (managed in-image Caddy). OFF (default) → a bare-IP visitor is
  // bounced to this box's browser-trusted <dashed-ip>.sslip.io host. ON → the studio is
  // served on the raw IP directly (no sslip bounce) — needed on a LAN / air-gapped box
  // where <ip>.sslip.io can't resolve, at the cost of a browser cert warning (no public
  // CA signs a bare IP). Bound at boot (the entrypoint flips the Caddy redirect matcher),
  // so a change applies on the next restart.
  allowIpAccess: { key: 'net.allow_ip_access', env: 'EXEPAD_ALLOW_IP_ACCESS' },
} as const satisfies Record<string, NetKey>;

/** Default HTTP/HTTPS listen ports when neither store nor env pins one. */
export const DEFAULT_HTTP_PORT = 8080;
export const DEFAULT_HTTPS_PORT = 8443;

/**
 * Ports browsers refuse to connect to (ERR_UNSAFE_PORT) — well-known service
 * ports (e.g. 6000 = X11, 22 = SSH, 25 = SMTP). Binding one is legal, but the
 * studio would be unreachable in a browser, so the port editor rejects them.
 * Mirrors Chromium's kRestrictedPorts (a superset of Firefox's list).
 */
export const BROWSER_UNSAFE_PORTS: ReadonlySet<number> = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697,
  10080,
]);

/** A port a browser can actually reach: an integer in 1–65535 that browsers don't
 *  block (6000 = X11, 22 = SSH, …). */
export function isUsablePort(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 65535 && !BROWSER_UNSAFE_PORTS.has(n);
}

/**
 * Resolve a listen port: the saved override, else the env seed, else the default —
 * SKIPPING any source whose value isn't a usable browser port (out of range OR
 * browser-blocked). This AUTO-HEALS a bad saved port: it's treated as unset so the
 * next source wins, and the studio can never be locked behind an unreachable port
 * (e.g. a previously-saved 6000). effectiveNet() keeps store-over-env precedence for
 * the raw value; here we walk the two sources so a bad store value falls through to
 * the env seed rather than to the default.
 */
function effectivePort(spec: NetKey, fallback: number): number {
  const store = storeValues()[spec.key];
  const sn = Number((store ?? '').trim());
  if (isUsablePort(sn)) return sn;
  const en = Number((process.env[spec.env] ?? '').trim());
  if (isUsablePort(en)) return en;
  return fallback;
}

export type NetSource = 'store' | 'env' | 'none';

/** Read a setting without ever throwing — a missing / unopenable DB reads as unset. */
function safeGetSetting(key: string): string | null {
  try {
    return getSetting(key);
  } catch {
    return null;
  }
}

// ── Store cache ───────────────────────────────────────────────────────────────
// resolveAllowedOrigin runs on EVERY /api request (the Hono cors origin callback),
// so avoid a DB point-read per field per request. Only the STORE reads are memoized
// — keyed on getSettingsRevision(), a plain in-process counter bumped on every
// settings write, so the cache rebuilds the instant an operator saves (immediate
// effect, zero polling). The env seed is read FRESH each call (a cheap process.env
// access), so it never goes stale relative to the live environment.

const STORE_KEYS = Object.values(NET_KEYS).map((k) => k.key);
let storeCache: { rev: number; values: Record<string, string | null> } | null = null;

function storeValues(): Record<string, string | null> {
  let rev = 0;
  try {
    rev = getSettingsRevision();
  } catch {
    /* counter unavailable — treat as rev 0; the reads below still run once */
  }
  if (storeCache && storeCache.rev === rev) return storeCache.values;
  const values: Record<string, string | null> = {};
  for (const key of STORE_KEYS) values[key] = safeGetSetting(key);
  storeCache = { rev, values };
  return values;
}

/**
 * The store value (operator-edited, wins) else the process-env seed. Matches the
 * `effective()` precedence in routes/settings.ts: a non-empty store value wins;
 * clearing a field in the UI (store '') reverts to the env seed.
 */
export function effectiveNet(spec: NetKey): { value: string; source: NetSource } {
  const s = storeValues()[spec.key];
  if (typeof s === 'string' && s.length > 0) return { value: s, source: 'store' };
  const e = process.env[spec.env];
  if (typeof e === 'string' && e.length > 0) return { value: e, source: 'env' };
  return { value: '', source: 'none' };
}

/** Operator override for `EXEPAD_PUBLIC_HOST` (a CNAME target), trimmed. */
export function effectivePublicHost(): string {
  return effectiveNet(NET_KEYS.publicHost).value.trim();
}

/** Operator override for `EXEPAD_PUBLIC_IP` (an A-record target), trimmed. */
export function effectivePublicIp(): string {
  return effectiveNet(NET_KEYS.publicIp).value.trim();
}

/** Raw `EXEPAD_ALLOWED_ORIGINS`-style string (comma/pipe separated), unparsed. */
export function effectiveAllowedOriginsRaw(): string {
  return effectiveNet(NET_KEYS.allowedOrigins).value;
}

/** Whether wildcard-port loopback CORS reflection is dropped (strict local CORS). */
export function effectiveStrictLocalCors(): boolean {
  return /^(1|true|yes|on)$/i.test(effectiveNet(NET_KEYS.strictLocalCors).value.trim());
}

/** Configured HTTP listen port (store ?? env ?? default) — read by main.ts at boot. */
export function effectiveHttpPort(): number {
  return effectivePort(NET_KEYS.httpPort, DEFAULT_HTTP_PORT);
}

/** Configured in-process HTTPS listen port (store ?? env ?? default) — boot. */
export function effectiveHttpsPort(): number {
  return effectivePort(NET_KEYS.httpsPort, DEFAULT_HTTPS_PORT);
}

/** First raw value that parses to a browser-usable port, else `fallback`. Walks
 *  the sources in precedence order, SKIPPING any that's out of range or blocked —
 *  so a bad saved port auto-heals to the next source (same guard as effectivePort,
 *  but over an arbitrary ordered list rather than one key's store+env pair). */
function firstUsablePort(raws: Array<string | null | undefined>, fallback: number): number {
  for (const raw of raws) {
    const n = Number((raw ?? '').trim());
    if (isUsablePort(n)) return n;
  }
  return fallback;
}

/**
 * Configured APPS front port (managed in-image Caddy) — the single port every
 * published app subdomain serves on. Precedence: net.apps_port override, then the
 * LEGACY net.https_port override (which used to move the whole front), then the
 * EXEPAD_APPS_PORT / EXEPAD_HTTPS_PORT env seeds, then the default. The legacy
 * fallbacks keep an already-configured install serving apps on the same port after
 * upgrading to the two-port model. Read by the entrypoint (mirrored in bash) at boot.
 */
export function effectiveAppsPort(): number {
  const store = storeValues();
  return firstUsablePort(
    [
      store[NET_KEYS.appsPort.key],
      store[NET_KEYS.httpsPort.key], // legacy single-front knob
      process.env[NET_KEYS.appsPort.env],
      process.env[NET_KEYS.httpsPort.env], // EXEPAD_HTTPS_PORT env seed
    ],
    DEFAULT_HTTPS_PORT,
  );
}

/**
 * Configured STUDIO front port (managed in-image Caddy) — the port the admin
 * studio is reached on. Precedence: net.studio_port override, then the
 * EXEPAD_STUDIO_PORT env seed, else it DEFAULTS to the apps port (a single unified
 * listener — the historical behavior). Set it distinct from the apps port to split
 * the studio onto its own port. Read by the entrypoint (mirrored in bash) at boot.
 */
export function effectiveStudioPort(): number {
  return firstUsablePort(
    [storeValues()[NET_KEYS.studioPort.key], process.env[NET_KEYS.studioPort.env]],
    effectiveAppsPort(),
  );
}

/** True when the studio and apps fronts share one port (unified single listener). */
export function isUnifiedFront(): boolean {
  return effectiveStudioPort() === effectiveAppsPort();
}

/** Whether the built-in HTTPS listener is disabled (store ?? env) — boot. */
export function effectiveHttpsDisable(): boolean {
  return /^(1|true|yes|on)$/i.test(effectiveNet(NET_KEYS.httpsDisable).value.trim());
}

/** Whether session cookies carry the Secure attribute (store ?? env) — boot seed. */
export function effectiveCookieSecure(): boolean {
  return /^(1|true|yes|on)$/i.test(effectiveNet(NET_KEYS.cookieSecure).value.trim());
}

/** Whether bare-IP visitors are served directly (ON) rather than redirected to this
 *  box's trusted sslip host (OFF, default). Bound at boot — the entrypoint flips the
 *  Caddy @bare_ip redirect matcher from it. */
export function effectiveAllowIpAccess(): boolean {
  return /^(1|true|yes|on)$/i.test(effectiveNet(NET_KEYS.allowIpAccess).value.trim());
}

/** Full effective snapshot with provenance, for the read-back GET /api/network. */
export function effectiveNetConfig(): {
  publicHost: { value: string; source: NetSource };
  publicIp: { value: string; source: NetSource };
  allowedOrigins: { value: string; source: NetSource };
  strictLocalCors: { value: string; source: NetSource };
} {
  return {
    publicHost: effectiveNet(NET_KEYS.publicHost),
    publicIp: effectiveNet(NET_KEYS.publicIp),
    allowedOrigins: effectiveNet(NET_KEYS.allowedOrigins),
    strictLocalCors: effectiveNet(NET_KEYS.strictLocalCors),
  };
}

/** Test seam: drop the store memo so the next read re-consults the DB. */
export function __resetNetConfigCache(): void {
  storeCache = null;
}
