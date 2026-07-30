import { isActiveCustomHost } from './custom-domains';
import { effectiveAllowedOriginsRaw, effectiveStrictLocalCors } from './net-config';

const EXACT_ALLOWED_HTTPS_ORIGINS = new Set([
  'https://exepad.com',
  'https://app.exepad.com',
]);

/**
 * Self-host CORS allowlist from `EXEPAD_ALLOWED_ORIGINS` — or, taking precedence,
 * the operator's `net.allowed_origins` override edited live in the Server &
 * networking panel (both resolved through net-config). Lets a custom domain or
 * LAN IP make credentialed /api calls without baking the host into the source.
 * Entries are comma- AND pipe-separated; each entry may be:
 *   - a full origin:  `https://app.company.com`
 *   - a bare host:    `192.168.1.10:8080`  (matched against the request host)
 *   - a wildcard:     `*.company.com`      (suffix-matched against the host)
 *
 * Re-parsed only when the effective raw string changes (an operator save), so the
 * hot path stays allocation-free between edits. For allowlisted hosts BOTH http
 * and https are allowed (LAN / .local deployments commonly terminate TLS at a
 * proxy or run plain HTTP). Cloud (*.exepad.*) behavior is unchanged.
 */
interface EnvOriginRule {
  /** Exact host[:port] to match, lowercased. */
  host?: string;
  /** Suffix (with leading dot) for a `*.` wildcard, lowercased. */
  suffix?: string;
}

export function parseEnvAllowedOrigins(raw: string | undefined): EnvOriginRule[] {
  if (!raw) return [];
  const rules: EnvOriginRule[] = [];
  for (const entry of raw.split(/[,|]/)) {
    const value = entry.trim().toLowerCase();
    if (!value) continue;

    // `*.suffix` wildcard.
    if (value.startsWith('*.')) {
      rules.push({ suffix: value.slice(1) }); // keep the leading dot
      continue;
    }

    // Full origin like `https://app.company.com` — extract the host (with port).
    if (value.includes('://')) {
      try {
        rules.push({ host: new URL(value).host });
      } catch {
        // ignore malformed entries
      }
      continue;
    }

    // Bare host like `192.168.1.10:8080` or `app.company.com`.
    rules.push({ host: value });
  }
  return rules;
}

// The effective allowlist is read live (store override ?? env seed) so an
// operator edit applies with no restart. Parsing is memoized on the raw string.
let allowedOriginsCache: { raw: string; rules: EnvOriginRule[] } | null = null;

function envAllowedOrigins(): EnvOriginRule[] {
  const raw = effectiveAllowedOriginsRaw();
  if (!allowedOriginsCache || allowedOriginsCache.raw !== raw) {
    allowedOriginsCache = { raw, rules: parseEnvAllowedOrigins(raw) };
  }
  return allowedOriginsCache.rules;
}

function isEnvAllowedHost(host: string): boolean {
  const rules = envAllowedOrigins();
  if (rules.length === 0) return false;
  const lower = host.toLowerCase();
  for (const rule of rules) {
    if (rule.host && rule.host === lower) return true;
    if (rule.suffix && lower.endsWith(rule.suffix)) return true;
  }
  return false;
}

/** Read live (not module-init) so tests and a runtime env change both take effect. */
function isSelfHost(): boolean {
  return (process.env.ENVIRONMENT ?? 'selfhost') === 'selfhost';
}

// Exepad's own hosted product is a SEPARATE codebase; these are its origins, not
// this runtime's. A self-hosted instance therefore has no reason to extend
// credentialed CORS to them — on a box the vendor neither runs nor reaches, that
// trust buys the operator nothing and contradicts "your data stays on your
// infrastructure". Gated OFF for self-host, which is what every container is:
// docker/entrypoint.sh pins ENVIRONMENT=selfhost, and build-runtime-env.ts
// defaults to it, so the allowance survives only in a non-selfhost deployment.
// Self-hosters add their own origins via EXEPAD_ALLOWED_ORIGINS / the Server &
// networking panel, and verified custom domains are already auto-allowed below.
function isAllowedHttpsHostname(hostname: string): boolean {
  if (isSelfHost()) return false;
  return hostname === 'exepad.com' ||
    hostname.endsWith('.exepad.com') ||
    hostname.endsWith('.exepad.app');
}

// Reflecting EVERY loopback port with credentials lets any other local origin
// (a second app on another port, a dev server, or a page an attacker bound to
// 127.0.0.1:PORT) make credentialed cross-origin calls to the runtime API. The
// broad allowance exists so local dev (Vite on :3001 → worker on :8080) works
// out of the box, so it stays the default. Security-conscious operators flip
// "Strict local CORS" in the Server & networking panel (or set
// EXEPAD_STRICT_LOCAL_CORS=1) to drop the wildcard-port loopback reflection and
// rely solely on same-origin + the explicit allowed-origins allowlist. Read live
// so the toggle applies with no restart.
function isAllowedLocalOrigin(url: URL): boolean {
  if (effectiveStrictLocalCors()) return false;
  return url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

export function resolveAllowedOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;

  try {
    const parsed = new URL(origin);
    if (isAllowedLocalOrigin(parsed)) {
      return parsed.origin;
    }

    // Self-host env allowlist: match the request host (with port) against
    // EXEPAD_ALLOWED_ORIGINS. Allowed over BOTH http and https so LAN/.local
    // deployments behind a TLS-terminating proxy or on plain HTTP both work.
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && isEnvAllowedHost(parsed.host)) {
      return parsed.origin;
    }

    // Dynamic self-serve custom domains: a host the operator has registered AND
    // verified (an `active` registered_domains row) is allowed for credentialed
    // /api calls, with no env edit or restart. Verification gates entry into this
    // set. Match on the HOSTNAME and require https with NO explicit port: custom
    // domains are always served over HTTPS on :443 via the Caddy on-demand
    // sidecar, so the only legitimate browser origin is `https://<host>`. This is
    // deliberately strict — reflecting `https://host:<other-port>` would bless a
    // co-tenant service on a different port of the same host as a credentialed
    // same-origin, and reflecting `http://host` would trust a plaintext MITM on
    // :80. (Plain-HTTP / non-standard-port LAN setups use EXEPAD_ALLOWED_ORIGINS.)
    if (parsed.protocol === 'https:' && parsed.port === '' && isActiveCustomHost(parsed.hostname)) {
      return parsed.origin;
    }

    if (parsed.protocol !== 'https:') {
      return null;
    }

    // Both vendor-origin checks are gated on the same not-self-host condition —
    // see isAllowedHttpsHostname.
    if (!isSelfHost() && EXACT_ALLOWED_HTTPS_ORIGINS.has(parsed.origin)) {
      return parsed.origin;
    }

    return isAllowedHttpsHostname(parsed.hostname) ? parsed.origin : null;
  } catch {
    return null;
  }
}

function mergeVary(existing: string | null, value: string): string {
  const parts = new Set(
    (existing || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  );
  parts.add(value);
  return Array.from(parts).join(', ');
}

export function applyCorsHeaders(
  headers: Headers,
  origin: string | null | undefined,
  options?: { allowCredentials?: boolean; allowWildcard?: boolean },
): void {
  const allowedOrigin = resolveAllowedOrigin(origin);
  headers.set('Vary', mergeVary(headers.get('Vary'), 'Origin'));

  if (allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin);
    if (options?.allowCredentials !== false) {
      headers.set('Access-Control-Allow-Credentials', 'true');
    } else {
      headers.delete('Access-Control-Allow-Credentials');
    }
    return;
  }

  headers.delete('Access-Control-Allow-Credentials');
  if (options?.allowWildcard) {
    headers.set('Access-Control-Allow-Origin', '*');
    return;
  }

  headers.delete('Access-Control-Allow-Origin');
}

export function buildCorsHeaders(
  origin: string | null | undefined,
  options?: { allowCredentials?: boolean; allowWildcard?: boolean },
): Record<string, string> {
  const headers = new Headers();
  applyCorsHeaders(headers, origin, options);
  const result: Record<string, string> = {};
  headers.forEach((value, key) => { result[key] = value; });
  return result;
}
