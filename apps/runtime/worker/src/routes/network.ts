/**
 * Server & networking settings (self-hosted single container).
 *
 * Surfaces the instance's effective network configuration and lets the operator
 * tune the RUNTIME-tunable knobs without editing env files or restarting:
 *
 *   - public host / public IP  → the DNS target + cert SAN advertised to operators
 *   - allowed origins          → the credentialed-CORS / CSRF trust allowlist
 *   - strict local CORS        → drop the wildcard-port loopback reflection
 *
 * These are persisted in meta.sqlite's `settings` store (net.* keys) and OVERRIDE
 * the process environment, which is only the first-boot seed. Reads flow through
 * lib/net-config.ts, so a saved value takes effect on the next request with no
 * restart (public-address.ts + origin.ts consult the same layer).
 *
 * Socket-level knobs (PORT, EXEPAD_HTTPS_PORT, EXEPAD_HTTPS_DISABLE, cookie
 * Secure) bind at boot and CANNOT change without a restart, so they are returned
 * READ-ONLY for display, each tagged with the env var that controls it.
 *
 *   GET  /api/network   → effective config (server boot knobs + editable overrides)
 *   PUT  /api/network   → upsert the editable overrides (validated)
 *
 * All routes require an authenticated operator.
 */
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { Hono } from 'hono';
import type { Env } from '../types/env';
import { requirePlatformUser } from './auth';
import { listDomains, setSettings } from '../lib/meta-db';
import {
  NET_KEYS,
  effectiveNetConfig,
  effectiveNet,
  effectiveHttpPort,
  effectiveHttpsPort,
  effectiveAppsPort,
  effectiveStudioPort,
  effectiveAllowIpAccess,
  DEFAULT_HTTP_PORT,
  DEFAULT_HTTPS_PORT,
  BROWSER_UNSAFE_PORTS,
} from '../lib/net-config';
import { isIpv4, resolveInstanceTarget } from '../lib/public-address';

export const network = new Hono<{ Bindings: Env }>();

// ── Validation ────────────────────────────────────────────────────────────────

// A DNS hostname: 1–253 chars, dot-separated labels of alnum/hyphen (no leading/
// trailing hyphen), single labels allowed. No scheme, port, path, or spaces.
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

function isHostname(value: string): boolean {
  return HOSTNAME_RE.test(value);
}

/** A host[:port] token — hostname (or IPv4) with an optional numeric port. */
function isHostPort(value: string): boolean {
  const m = value.match(/^([^:]+)(?::(\d{1,5}))?$/);
  if (!m) return false;
  const [, host, port] = m;
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return false;
  return isHostname(host) || isIpv4(host);
}

/**
 * Validate + canonicalize one allowed-origin entry. Mirrors the parser in
 * origin.ts (full origin | bare host[:port] | `*.suffix` wildcard) but REJECTS
 * malformed input instead of silently dropping it, so the operator gets feedback.
 * Returns the normalized string to store, or null if invalid.
 */
function normalizeOriginEntry(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;

  // `*.suffix` wildcard.
  if (value.startsWith('*.')) {
    const suffix = value.slice(2);
    return isHostname(suffix) ? value : null;
  }

  // Full origin like `https://app.company.com` — must be http(s), a host, no path.
  if (value.includes('://')) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      if (u.pathname !== '/' && u.pathname !== '') return null;
      if (u.search || u.hash || u.username || u.password) return null;
      return `${u.protocol}//${u.host}`;
    } catch {
      return null;
    }
  }

  // Bare host like `192.168.1.10:8080` or `app.company.com`.
  return isHostPort(value) ? value : null;
}

// ── GET /api/network ──────────────────────────────────────────────────────────

/** Parse the raw comma/pipe list into display entries (order preserved, deduped). */
function splitOriginList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,|]/)) {
    const v = part.trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

function boolEnv(name: string): boolean {
  return /^(1|true|yes|on)$/i.test((process.env[name] ?? '').trim());
}

/**
 * Is a browser-trusted (Let's Encrypt) certificate for the bare IP present and still
 * valid? The entrypoint's acme.sh daemon installs it to EXEPAD_IP_CERT_DIR/fullchain.pem
 * and regenerates the Caddy `<ip>` block to serve it; if it exists and hasn't expired, the
 * raw IP is served trusted (no warning). Falls back to false — the internal-CA warning —
 * on any read/parse error or when acme.sh hasn't obtained one (yet).
 */
function ipCertTrusted(): boolean {
  const dir = process.env.EXEPAD_IP_CERT_DIR;
  if (!dir) return false;
  try {
    const pem = readFileSync(`${dir}/fullchain.pem`, 'utf8');
    if (!pem.trim()) return false;
    const notAfter = new Date(new X509Certificate(pem).validTo).getTime();
    return Number.isFinite(notAfter) && notAfter > Date.now();
  } catch {
    return false;
  }
}

network.get('/', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  const cfg = effectiveNetConfig();
  const detected = await resolveInstanceTarget(Date.now());

  // Verified custom domains are auto-trusted as credentialed origins with no env
  // edit (origin.ts:isActiveCustomHost) — surface them so the allowlist the
  // operator sees is the WHOLE effective trust set, not just their manual entries.
  const autoTrustedHosts = listDomains()
    .filter((d) => d.status === 'active')
    .map((d) => d.domain);

  // The studio's FRONT-facing port — the one the operator opens in the browser.
  // When the runtime terminates TLS in-process (the self-host default) that's the
  // HTTPS port (e.g. :443); with built-in HTTPS off it's the plain HTTP port. Behind
  // a front proxy (container Caddy) the public port is owned by the proxy, so it's
  // reported read-only. server/main.ts binds the configured value at STARTUP, so an
  // edit applies on the next restart — surfaced with the port running RIGHT NOW so
  // the UI can flag a pending restart.
  const httpsActive = process.env.EXEPAD_TLS_ACTIVE === '1'; // Node in-process HTTPS (run.sh local)
  const tlsFronted = boolEnv('EXEPAD_TLS_FRONTED');
  // Our OWN in-image Caddy fronts TLS and binds EXEPAD_HTTPS_PORT on the host (host
  // networking), so — unlike an operator's external proxy — WE can move the served
  // port. Set by docker/entrypoint.sh alongside EXEPAD_TLS_FRONTED.
  const managedTls = boolEnv('EXEPAD_MANAGED_TLS');

  // HTTPS is the front door when the Node terminates it in-process (local) OR our
  // in-image Caddy does (container). Only an EXTERNAL proxy makes the port
  // un-ownable from here — that's the sole read-only case.
  const frontIsHttps = httpsActive || managedTls;
  const editable = !tlsFronted || managedTls;
  // Applying a port change needs a process restart. Only the managed container can
  // do that itself (restart: unless-stopped brings it back + the entrypoint re-reads
  // net.https_port); a run.sh-local process would just exit and stay down.
  const canSelfRestart = managedTls;

  const httpRunning = Number(
    process.env.EXEPAD_HTTP_ACTIVE_PORT || process.env.PORT || DEFAULT_HTTP_PORT,
  );
  // The HTTPS port bound RIGHT NOW: the Node in-process listener (local) or the
  // in-image Caddy's EXEPAD_HTTPS_PORT (the entrypoint set it from net.https_port).
  const httpsRunning = Number(
    process.env.EXEPAD_HTTPS_REDIRECT_PORT ||
      process.env.EXEPAD_HTTPS_PORT ||
      DEFAULT_HTTPS_PORT,
  );

  // Pick the front door: HTTPS (in-process or our Caddy) when present, else plain
  // HTTP. That fixes which knob the editor writes (net.https_port vs net.http_port)
  // and which port the readout shows, matching the URL the operator actually opened.
  const portKind: 'https' | 'http' = frontIsHttps ? 'https' : 'http';
  const runningFrontPort = frontIsHttps ? httpsRunning : httpRunning;
  const configuredFrontPort = frontIsHttps ? effectiveHttpsPort() : effectiveHttpPort();
  const frontKey = frontIsHttps ? NET_KEYS.httpsPort : NET_KEYS.httpPort;

  // Two-port split (managed in-image Caddy only): the APPS front (every published app
  // subdomain) and the STUDIO front (the admin studio) can bind different ports. The
  // entrypoint exports the ACTUALLY-bound ports as EXEPAD_APPS_PORT / EXEPAD_STUDIO_PORT
  // (studio defaults to the apps port → one unified listener); effectiveAppsPort/
  // effectiveStudioPort are what a restart WOULD bind. The client shows both editors
  // only when managedTls; otherwise it's the single front port above.
  const runningAppsPort = Number(
    process.env.EXEPAD_APPS_PORT || process.env.EXEPAD_HTTPS_PORT || httpsRunning,
  );
  const runningStudioPort = Number(process.env.EXEPAD_STUDIO_PORT || runningAppsPort);
  const configuredAppsPort = effectiveAppsPort();
  const configuredStudioPort = effectiveStudioPort();
  // Direct-IP access (managed Caddy): the entrypoint flips the sslip redirect at boot,
  // so like the ports it's configured-now vs running-since-boot.
  const allowIpConfigured = effectiveAllowIpAccess();
  const allowIpRunning = boolEnv('EXEPAD_ALLOW_IP_ACCESS');

  return c.json({
    success: true,
    network: {
      // The editable socket knobs: the studio's front-facing port(s). Everything else
      // about how TLS/cookies are served binds at boot from the container env and isn't
      // surfaced here. In the managed container the front splits into apps + studio.
      server: {
        portKind, // 'https' → editor writes net.https_port; 'http' → net.http_port
        frontPort: runningFrontPort, // running right now (matches the browser URL)
        configuredPort: configuredFrontPort, // what a restart would bind
        portSource: effectiveNet(frontKey).source,
        pendingRestart: configuredFrontPort !== runningFrontPort,
        editable, // false only when an EXTERNAL proxy owns the public port
        tlsFronted,
        managedTls, // our in-image Caddy fronts TLS and we can move its port(s)
        canSelfRestart, // the studio can restart itself to apply a port change
        // Two-port split — only meaningful (and rendered) when managedTls is true. No
        // `source` provenance here: the effective value can come from the legacy
        // net.https_port fallback or the unified default, neither of which a per-key
        // effectiveNet(appsPort/studioPort).source can report, so it would mislead — and
        // the UI shows a value-derived "default"/"same as apps" note instead of a badge.
        apps: {
          configuredPort: configuredAppsPort,
          runningPort: runningAppsPort,
          pendingRestart: configuredAppsPort !== runningAppsPort,
        },
        studio: {
          configuredPort: configuredStudioPort,
          runningPort: runningStudioPort,
          pendingRestart: configuredStudioPort !== runningStudioPort,
        },
        // Direct-IP access toggle — only meaningful (and rendered) when managedTls.
        // trustedCert: acme.sh has a live Let's Encrypt cert for the bare IP, so it's
        // served browser-trusted (no warning). False → the internal-CA fallback.
        ipAccess: {
          allowed: allowIpConfigured,
          pendingRestart: allowIpConfigured !== allowIpRunning,
          trustedCert: allowIpRunning && ipCertTrusted(),
        },
      },
      // Runtime-editable overrides (store ?? env seed), each with its provenance.
      publicAddress: {
        host: cfg.publicHost,
        ip: cfg.publicIp,
        // What the instance actually advertises right now (override, then detection).
        detected: {
          value: detected.value,
          type: detected.type,
          source: detected.source,
          publiclyRoutable: detected.publiclyRoutable,
        },
      },
      cors: {
        allowedOrigins: splitOriginList(cfg.allowedOrigins.value),
        allowedOriginsSource: cfg.allowedOrigins.source,
        strictLocalCors:
          /^(1|true|yes|on)$/i.test(cfg.strictLocalCors.value.trim()),
        strictLocalCorsSource: cfg.strictLocalCors.source,
        autoTrustedHosts,
      },
    },
  });
});

// ── PUT /api/network ──────────────────────────────────────────────────────────

interface PutBody {
  /** '' clears the override (reverts to the EXEPAD_PUBLIC_HOST env seed). */
  publicHost?: string;
  /** '' clears the override (reverts to the EXEPAD_PUBLIC_IP env seed). */
  publicIp?: string;
  /** Full replacement of the manual allowlist. [] clears (reverts to env seed). */
  allowedOrigins?: string[] | string;
  /** Explicit on/off — authoritative over the env seed. */
  strictLocalCors?: boolean;
  /** New studio HTTP port (1–65535). '' clears the override (reverts to PORT). */
  httpPort?: number | string;
  /** New studio HTTPS port (1–65535). '' clears (reverts to EXEPAD_HTTPS_PORT). */
  httpsPort?: number | string;
  /** New APPS front port — every published app subdomain (managed container). '' clears
   *  (reverts to the legacy https port / env seed / 443). */
  appsPort?: number | string;
  /** New STUDIO front port — the admin studio (managed container). '' clears (reverts
   *  to the apps port → one unified listener). */
  studioPort?: number | string;
  /** Serve bare-IP visitors directly (true) vs. redirect them to the trusted sslip
   *  host (false, default). Applies on the next restart (managed container). */
  allowIpAccess?: boolean;
}

/** Parse a port field into a store value: '' clears; else validate 1–65535 and
 *  reject browser-blocked ports (the studio would be unreachable in a browser). */
function parsePortUpdate(raw: number | string | undefined): { value: string } | { error: string } {
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (s === '') return { value: '' }; // clears → reverts to the env seed
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return { error: `Not a valid port: "${s}". Use a whole number between 1 and 65535.` };
  }
  if (BROWSER_UNSAFE_PORTS.has(n)) {
    return {
      error: `Port ${n} is blocked by web browsers (a well-known service port), so the studio would be unreachable there. Pick another, e.g. 9000, 8443, or 3000.`,
    };
  }
  return { value: String(n) };
}

/** Ports a managed-container FRONT port must never take — they collide with a fixed
 *  in-container listener: 80 (Caddy's ACME + HTTP→HTTPS block; a duplicate :80 site
 *  block makes Caddy refuse the whole config and crash-loop), the Node runtime (PORT,
 *  default 8080), and the agent (AGENT_PORT, default 8081). */
function reservedFrontPorts(): Set<number> {
  return new Set([80, Number(process.env.PORT) || 8080, Number(process.env.AGENT_PORT) || 8081]);
}

/** parsePortUpdate + reject the fixed in-container listener ports. Used for the front
 *  HTTPS knobs (apps/studio/https) whose value the in-image Caddy actually binds. */
function parseFrontPortUpdate(raw: number | string | undefined): { value: string } | { error: string } {
  const r = parsePortUpdate(raw);
  if ('error' in r || r.value === '') return r;
  const n = Number(r.value);
  if (reservedFrontPorts().has(n)) {
    return {
      error:
        n === 80
          ? `Port 80 is reserved for HTTP→HTTPS redirects, so the studio can't be served on it. Pick another, e.g. 443, 9000, or 8443.`
          : `Port ${n} is used internally by the container, so the studio would fail to start on it. Pick another, e.g. 443, 9000, or 8443.`,
    };
  }
  return r;
}

network.put('/', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  let body: PutBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const updates: Record<string, string | undefined> = {};

  if ('publicHost' in body) {
    const v = typeof body.publicHost === 'string' ? body.publicHost.trim() : '';
    if (v && !isHostname(v)) {
      return c.json({ success: false, error: `Not a valid hostname: ${v}` }, 400);
    }
    updates[NET_KEYS.publicHost.key] = v; // '' clears → reverts to env seed
  }

  if ('publicIp' in body) {
    const v = typeof body.publicIp === 'string' ? body.publicIp.trim() : '';
    if (v && !isIpv4(v)) {
      return c.json({ success: false, error: `Not a valid IPv4 address: ${v}` }, 400);
    }
    updates[NET_KEYS.publicIp.key] = v;
  }

  if ('allowedOrigins' in body) {
    const rawList = Array.isArray(body.allowedOrigins)
      ? body.allowedOrigins
      : typeof body.allowedOrigins === 'string'
        ? body.allowedOrigins.split(/[,|]/)
        : [];
    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const entry of rawList) {
      if (typeof entry !== 'string' || entry.trim() === '') continue;
      const norm = normalizeOriginEntry(entry);
      if (!norm) {
        return c.json(
          {
            success: false,
            error: `Not a valid origin: "${entry.trim()}". Use https://app.example.com, a host like 192.168.1.10:8080, or a wildcard like *.example.com.`,
          },
          400,
        );
      }
      if (!seen.has(norm)) {
        seen.add(norm);
        normalized.push(norm);
      }
    }
    updates[NET_KEYS.allowedOrigins.key] = normalized.join(',');
  }

  if ('strictLocalCors' in body) {
    if (typeof body.strictLocalCors !== 'boolean') {
      return c.json({ success: false, error: 'strictLocalCors must be a boolean' }, 400);
    }
    updates[NET_KEYS.strictLocalCors.key] = body.strictLocalCors ? '1' : '0';
  }

  if ('httpPort' in body) {
    const r = parsePortUpdate(body.httpPort);
    if ('error' in r) return c.json({ success: false, error: r.error }, 400);
    updates[NET_KEYS.httpPort.key] = r.value;
  }

  if ('httpsPort' in body) {
    const r = parseFrontPortUpdate(body.httpsPort);
    if ('error' in r) return c.json({ success: false, error: r.error }, 400);
    updates[NET_KEYS.httpsPort.key] = r.value;
  }

  if ('appsPort' in body) {
    const r = parseFrontPortUpdate(body.appsPort);
    if ('error' in r) return c.json({ success: false, error: r.error }, 400);
    updates[NET_KEYS.appsPort.key] = r.value;
  }

  if ('studioPort' in body) {
    const r = parseFrontPortUpdate(body.studioPort);
    if ('error' in r) return c.json({ success: false, error: r.error }, 400);
    updates[NET_KEYS.studioPort.key] = r.value;
  }

  if ('allowIpAccess' in body) {
    if (typeof body.allowIpAccess !== 'boolean') {
      return c.json({ success: false, error: 'allowIpAccess must be a boolean' }, 400);
    }
    updates[NET_KEYS.allowIpAccess.key] = body.allowIpAccess ? '1' : '0';
  }

  setSettings(updates);

  // Return the fresh effective view so the client reflects provenance immediately.
  const cfg = effectiveNetConfig();
  return c.json({
    success: true,
    publicAddress: { host: cfg.publicHost, ip: cfg.publicIp },
    cors: {
      allowedOrigins: splitOriginList(cfg.allowedOrigins.value),
      allowedOriginsSource: cfg.allowedOrigins.source,
      strictLocalCors: /^(1|true|yes|on)$/i.test(cfg.strictLocalCors.value.trim()),
      strictLocalCorsSource: cfg.strictLocalCors.source,
    },
  });
});

// ── POST /api/network/restart ─────────────────────────────────────────────────
//
// Apply a pending port change with no CLI: exit the process so the container's
// `restart: unless-stopped` policy restarts it, and docker/entrypoint.sh re-reads
// net.https_port → the in-image Caddy binds the new port. Only meaningful in the
// managed container (EXEPAD_MANAGED_TLS); a run.sh-local process would just stop, so
// we refuse there and the UI tells the operator to restart manually.
network.post('/restart', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);
  if (!boolEnv('EXEPAD_MANAGED_TLS')) {
    return c.json(
      {
        success: false,
        error:
          'Automatic restart is only available in the managed container. Restart the studio manually to apply the new port.',
      },
      409,
    );
  }
  // Ack first, then exit shortly after so the client receives the response before the
  // socket drops. The entrypoint tears the container down when Node exits; Docker
  // restarts it, and the studio comes back on the saved port.
  setTimeout(() => process.exit(0), 300);
  return c.json({ success: true, restarting: true });
});
