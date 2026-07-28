/**
 * Custom-domain management (self-hosted single container).
 *
 * The operator points their own domains / IPs at this instance and Exepad serves
 * them with automatic HTTPS (via the Caddy on-demand-TLS sidecar). Persistence is
 * meta.sqlite's `registered_domains`; resolution + verification live in
 * `lib/custom-domains.ts`; the Caddy `ask` endpoint and host→app routing read the
 * same active set. All routes require an authenticated operator.
 *
 *   GET    /api/domains              → the operator's domains + instance DNS target
 *   POST   /api/domains              → register a domain/IP (status: pending|active)
 *   POST   /api/domains/:d/verify    → run the DNS-TXT ownership check → active
 *   PATCH  /api/domains/:d           → change mapping / mode / HSTS
 *   DELETE /api/domains/:d           → remove
 *
 * Verify-then-issue: a real domain only becomes `active` (and thus authorized for
 * on-demand cert issuance + CORS + host→app routing) after the TXT challenge
 * passes — so Caddy never attempts ACME for a host the operator can't prove they
 * control. sslip/ip/byoc hosts are self-evidently the operator's own box, so they
 * activate on registration.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types/env';
import { requirePlatformUser } from './auth';
import {
  createDomain,
  deleteDomain,
  getApp,
  getDomain,
  listDomainsByOwner,
  updateDomain,
  userCanAccessApp,
  type MetaDomain,
} from '../lib/meta-db';
import {
  challengeRecord,
  checkDnsRecords,
  generateVerificationToken,
  invalidateDomainCache,
  isActiveCustomHost,
  isDomainTlsMode,
  isIpAddress,
  isValidDomain,
  isWildcardDomain,
  normalizeHost,
  sslipHostnameForIp,
  verifyDomainOwnership,
  type DomainTlsMode,
} from '../lib/custom-domains';
import { resolveInstanceTarget, __resetPublicIpCache, type InstanceTarget } from '../lib/public-address';

export const domains = new Hono<{ Bindings: Env }>();

interface DnsRecord {
  type: 'A' | 'CNAME' | 'TXT';
  name: string;
  value: string;
  note?: string;
}

/** Build the records the operator must create for a domain (shown in the UI). */
function dnsRecordsFor(row: MetaDomain, target: InstanceTarget): DnsRecord[] {
  // sslip/ip/byoc need no operator DNS setup.
  if (row.mode === 'sslip' || row.mode === 'byoc') return [];
  const records: DnsRecord[] = [];
  const apex = row.domain.replace(/^\*\./, '');
  // Behind the operator's own proxy, the address record belongs to THEIR proxy
  // (often a different IP than this box) — advising an A record here would show
  // a permanent scary "Different value". Only the ownership TXT applies.
  if (row.routing === 'proxied') {
    const ch = challengeRecord(row.domain, row.verification_token);
    return [{ type: 'TXT', name: ch.name, value: ch.value, note: 'Ownership verification.' }];
  }
  if (target.value) {
    records.push({
      type: target.type === 'CNAME' ? 'CNAME' : 'A',
      name: row.domain,
      value: target.value,
      note: isWildcardDomain(row.domain)
        ? 'Wildcard record — covers every per-app subdomain.'
        : apex === row.domain && target.type !== 'CNAME'
          ? 'Apex domains use A / ALIAS (a CNAME is not allowed at the apex).'
          : undefined,
    });
  } else {
    records.push({
      type: 'A',
      name: row.domain,
      value: '<your server public IP>',
      note: 'Could not auto-detect a public IP (this box may be on a private network). Set EXEPAD_PUBLIC_HOST/IP, or use DNS-01.',
    });
  }
  // Ownership-verification TXT — required for both auto (HTTP-01/TLS-ALPN-01)
  // and dns modes (it proves ownership to Exepad and is separate from Caddy's
  // own ACME `_acme-challenge` record, which the DNS-01 provider plugin manages).
  const ch = challengeRecord(row.domain, row.verification_token);
  records.push({ type: 'TXT', name: ch.name, value: ch.value, note: 'Ownership verification.' });
  return records;
}

/** Serialize a row for the client, enriching with derived display data. */
function present(row: MetaDomain, target: InstanceTarget) {
  const app = row.app_id ? getApp(row.app_id) : null;
  const liveBase = isWildcardDomain(row.domain)
    ? `https://<app>.${row.domain.slice(2)}`
    : `https://${row.domain}`;
  return {
    domain: row.domain,
    appId: row.app_id,
    mapsTo: row.app_id ? (app?.name ?? row.app_id) : 'Whole studio',
    mode: row.mode,
    routing: row.routing,
    status: row.status,
    hsts: row.hsts === 1,
    dnsTarget: row.dns_target,
    verificationToken: row.verification_token,
    challenge: challengeRecord(row.domain, row.verification_token),
    dnsRecords: dnsRecordsFor(row, target),
    liveUrl: liveBase,
    lastError: row.last_error,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Did the operator's request reach us over HTTPS (a TLS terminator — our Caddy
 *  sidecar or their own proxy — is in front)? Drives the adaptive UI banner. */
function isRequestSecure(c: Context<{ Bindings: Env }>): boolean {
  try {
    if (new URL(c.req.url).protocol === 'https:') return true;
  } catch {
    /* ignore */
  }
  return c.req.header('x-forwarded-proto') === 'https' || c.req.header('x-forwarded-scheme') === 'https';
}

// ─── GET /api/domains ─────────────────────────────────────────────────────────

/**
 * The browser-trusted public URL this box advertises automatically: its
 * `<dashed-ip>.sslip.io` hostname on a public IP. The fronting Caddy obtains a
 * real Let's Encrypt cert for it on the first HTTPS request — the worker's
 * on-demand-TLS authorize endpoint green-lights this box's own sslip host with
 * NO registration needed (see isOnDemandTlsAuthorized). Returns null on a
 * purely-local / NAT-only box, where no public CA can issue.
 */
function instanceSslipUrl(target: InstanceTarget): string | null {
  if (target.type === 'A' && target.value && target.publiclyRoutable) {
    const sslip = sslipHostnameForIp(target.value);
    if (sslip) return `https://${sslip}`;
  }
  return null;
}

domains.get('/', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);
  // ?refresh=1 (the panel's "Re-check" button) forces a fresh public-IP probe
  // instead of serving a cached miss — so a transient outbound blip is recoverable.
  if (c.req.query('refresh') === '1') __resetPublicIpCache();
  const target = await resolveInstanceTarget(Date.now());
  const sslipUrl = instanceSslipUrl(target);
  const sslipHost = sslipUrl ? normalizeHost(sslipUrl.replace(/^https:\/\//, '')) : null;
  const rows = listDomainsByOwner(authed.user.id);
  const secure = isRequestSecure(c);
  const acmeEmail = Boolean((process.env.EXEPAD_ACME_EMAIL || '').trim());
  // Trust classification of the address this very request used:
  //  - 'trusted'      = a verified registered domain OR this box's own sslip host
  //                     → browser-trusted (Caddy ACME) cert, green padlock.
  //  - 'self-signed'  = the in-process zero-config floor (EXEPAD_TLS_ACTIVE) on a
  //                     local/LAN address → encrypted but a one-time trust warning.
  //  - 'https'        = secure via a terminator we don't classify (own proxy).
  //  - 'plain'        = no TLS (HTTPS explicitly disabled).
  const host = normalizeHost(c.req.header('host'));
  const trusted = secure && (isActiveCustomHost(host) || (sslipHost != null && host === sslipHost));
  const selfSigned = process.env.EXEPAD_TLS_ACTIVE === '1';
  const mode = !secure ? 'plain' : trusted ? 'trusted' : selfSigned ? 'self-signed' : 'https';
  // Whether the instance is actually SERVING HTTPS, independent of how THIS
  // request arrived — so a panel loaded over the plain-HTTP origin (e.g.
  // http://localhost, which is redirect-exempt) can say "HTTPS is up, open the
  // HTTPS URL" instead of wrongly claiming HTTPS is off.
  const httpsActive = process.env.EXEPAD_TLS_ACTIVE === '1';
  const httpsDisabled = /^(1|true|yes|on)$/i.test(process.env.EXEPAD_HTTPS_DISABLE ?? '');
  // The same-host HTTPS URL to open when the in-process listener is up but this
  // request came over plain HTTP. Uses the actually-bound port (the redirect port
  // main.ts sets), falling back to the configured one.
  let httpsUrl: string | null = null;
  if (httpsActive && !secure) {
    // Prefer the browser's Host header; fall back to the request URL's host (always
    // present) so we still build a usable link if a proxy stripped Host.
    let urlHost = host;
    if (!urlHost) {
      try {
        urlHost = normalizeHost(new URL(c.req.url).host);
      } catch {
        /* leave empty */
      }
    }
    if (urlHost) {
      const port = process.env.EXEPAD_HTTPS_REDIRECT_PORT || process.env.EXEPAD_HTTPS_PORT || '8443';
      httpsUrl = `https://${urlHost}${port === '443' ? '' : `:${port}`}`;
    }
  }
  return c.json({
    success: true,
    instance: {
      dnsTarget: target.value,
      dnsTargetType: target.type,
      dnsTargetSource: target.source,
      publiclyRoutable: target.publiclyRoutable,
      tls: {
        // Did this request arrive over HTTPS? (Now true by default — the studio
        // serves TLS out of the box.)
        secure,
        mode,
        // True when the request's own address has a browser-trusted certificate.
        trusted,
        // A browser-trusted URL the operator can share (the sslip host on a public
        // box, or null on a purely-local/LAN instance).
        trustedUrl: sslipUrl,
        // Is the instance SERVING HTTPS at all (in-process listener up)?
        httpsActive,
        // Was HTTPS explicitly turned off via EXEPAD_HTTPS_DISABLE?
        httpsDisabled,
        // Same-host HTTPS URL to open when you're viewing over plain HTTP, else null.
        httpsUrl,
        acmeEmail,
      },
    },
    domains: rows.map((r) => present(r, target)),
  });
});

// ─── POST /api/domains ────────────────────────────────────────────────────────

interface CreateBody {
  target?: 'domain' | 'ip';
  domain?: string;
  ip?: string;
  appId?: string | null;
  mode?: string;
  /** 'proxied' = the operator's own proxy terminates TLS / owns the address record. */
  routing?: string;
}

domains.post('/', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  let body: CreateBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const instTarget = await resolveInstanceTarget(Date.now());
  const target = body.target === 'ip' ? 'ip' : 'domain';
  let mode: DomainTlsMode = target === 'ip' ? 'sslip' : 'auto';
  if (typeof body.mode === 'string' && body.mode) {
    if (!isDomainTlsMode(body.mode)) {
      return c.json({ success: false, error: `Unknown TLS mode: ${body.mode}` }, 400);
    }
    mode = body.mode;
  }

  let routing: 'proxied' | null = null;
  if (body.routing != null && body.routing !== '') {
    if (body.routing !== 'proxied') {
      return c.json({ success: false, error: `Unknown routing: ${body.routing}` }, 400);
    }
    // 'proxied' marks a host whose address record the operator's own TLS
    // terminator owns — meaningful only for a real domain on the auto mode.
    if (target !== 'domain' || mode !== 'auto') {
      return c.json({ success: false, error: "routing 'proxied' applies only to a domain with the auto TLS mode" }, 400);
    }
    routing = 'proxied';
  }

  // Resolve the hostname we actually store + serve.
  let host: string;
  let dnsTarget: string | null = instTarget.value;
  if (target === 'ip') {
    const ip = (body.ip || '').trim();
    if (!isIpAddress(ip)) {
      return c.json({ success: false, error: 'A valid public IP address is required' }, 400);
    }
    dnsTarget = ip;
    if (mode === 'sslip') {
      const sslip = sslipHostnameForIp(ip);
      if (!sslip) return c.json({ success: false, error: 'Could not derive an sslip.io hostname for that IP' }, 400);
      host = sslip;
    } else if (mode === 'byoc') {
      // Operator-supplied cert for the bare IP literal (e.g. an internal-CA cert).
      host = ip;
    } else {
      // No bare-IP ACME mode: a public CA can't issue for a bare IP (and the
      // bundled Caddy would serve an untrusted internal cert). Use the free
      // browser-trusted sslip hostname, or bring your own cert.
      return c.json({ success: false, error: 'A bare IP supports only the sslip or byoc TLS modes' }, 400);
    }
  } else {
    const d = (body.domain || '').trim().toLowerCase();
    if (!isValidDomain(d)) {
      return c.json({ success: false, error: 'Enter a valid domain (e.g. app.example.com) or wildcard (*.apps.example.com)' }, 400);
    }
    // A wildcard row supports two TLS strategies, both valid:
    //  - 'auto': a per-subdomain HTTP-01/TLS-ALPN-01 cert issued on demand for each
    //    published app (any DNS provider, no token; needs :80/:443 reachable).
    //  - 'dns':  ONE wildcard cert via DNS-01 (needs a DNS-provider token; zero
    //    cold-start; works behind NAT).
    // Only sslip/byoc are meaningless for a wildcard.
    if (isWildcardDomain(d) && mode !== 'dns' && mode !== 'auto') {
      return c.json({ success: false, error: 'A wildcard domain supports the auto (per-subdomain HTTP-01) or dns (DNS-01 wildcard) TLS mode' }, 400);
    }
    host = d;
  }

  // App mapping: null = whole studio. A wildcard maps per-subdomain, so it can't
  // pin a single app. A pinned app must be one the operator can access.
  let appId: string | null = null;
  if (typeof body.appId === 'string' && body.appId.trim()) {
    if (isWildcardDomain(host)) {
      return c.json({ success: false, error: 'A wildcard domain serves an app per subdomain — it cannot be pinned to one app' }, 400);
    }
    appId = body.appId.trim();
    if (!userCanAccessApp(authed.user.id, appId)) {
      return c.json({ success: false, error: 'Unknown app, or you do not have access to it' }, 403);
    }
  }

  if (getDomain(host)) {
    return c.json({ success: false, error: `${host} is already registered` }, 409);
  }

  const row = createDomain({
    domain: host,
    ownerId: authed.user.id,
    appId,
    mode,
    routing,
    verificationToken: generateVerificationToken(),
    dnsTarget,
  });

  // byoc carries an operator-supplied cert, so it activates on registration.
  // sslip / bare-IP hosts are "the operator's own box" only if the registered IP
  // is PROVEN to be this instance's public IP. Since `<a-b-c-d>.sslip.io`
  // deterministically resolves to the chosen a.b.c.d, auto-activating an
  // unproven IP would let an operator bless an origin backed by a server they
  // control into the credentialed-CORS + TLS-authorize sets. So we require a
  // positive match against this box's known public IP (env value OR auto-detected
  // egress IP); an unknown-public-IP box (NAT / detection failed) stays PENDING
  // rather than trusting an attacker-chosen IP.
  const knownPublicIp = instTarget.type === 'A' ? instTarget.value : null;
  if (mode === 'byoc') {
    updateDomain(host, authed.user.id, { status: 'active', verified_at: new Date().toISOString() });
  } else if (mode === 'sslip') {
    if (knownPublicIp && knownPublicIp === dnsTarget) {
      updateDomain(host, authed.user.id, { status: 'active', verified_at: new Date().toISOString() });
    } else {
      updateDomain(host, authed.user.id, {
        status: 'pending',
        last_error: knownPublicIp
          ? `This instance's public IP (${knownPublicIp}) does not match ${dnsTarget}; not auto-activated.`
          : `This instance's public IP could not be determined, so ${dnsTarget} was not auto-activated. Verify the box is reachable at that IP.`,
      });
    }
  }
  invalidateDomainCache();

  const fresh = getDomain(host)!;
  return c.json({ success: true, domain: present(fresh, instTarget) }, 201);
});

// ─── GET /api/domains/:domain/check ───────────────────────────────────────────
//
// Live, read-only "is each DNS record visible to us yet?" probe that powers the
// status pills in the add-domain wizard. Unlike /verify it never changes state —
// it just resolves the expected records and reports what's currently published.

domains.get('/:domain/check', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  const name = c.req.param('domain').toLowerCase();
  const row = getDomain(name);
  if (!row || row.owner_id !== authed.user.id) {
    return c.json({ success: false, error: 'Domain not found' }, 404);
  }
  const target = await resolveInstanceTarget(Date.now());
  const records = await checkDnsRecords(dnsRecordsFor(row, target));
  return c.json({ success: true, checkedAt: new Date().toISOString(), records });
});

// ─── POST /api/domains/:domain/verify ─────────────────────────────────────────

domains.post('/:domain/verify', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  const name = c.req.param('domain').toLowerCase();
  const row = getDomain(name);
  if (!row || row.owner_id !== authed.user.id) {
    return c.json({ success: false, error: 'Domain not found' }, 404);
  }
  const instTarget = await resolveInstanceTarget(Date.now());
  if (row.status === 'active') {
    return c.json({ success: true, verified: true, domain: present(row, instTarget) });
  }

  const result = await verifyDomainOwnership(row.domain, row.verification_token);
  if (result.ok) {
    updateDomain(row.domain, authed.user.id, {
      status: 'active',
      verified_at: new Date().toISOString(),
      last_error: null,
    });
  } else {
    updateDomain(row.domain, authed.user.id, { status: 'verifying', last_error: result.error ?? 'Verification failed' });
  }
  invalidateDomainCache();

  const fresh = getDomain(row.domain)!;
  return c.json({ success: true, verified: result.ok, error: result.error, domain: present(fresh, instTarget) });
});

// ─── PATCH /api/domains/:domain ───────────────────────────────────────────────

interface PatchBody {
  appId?: string | null;
  mode?: string;
  hsts?: boolean;
}

domains.patch('/:domain', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  const name = c.req.param('domain').toLowerCase();
  const row = getDomain(name);
  if (!row || row.owner_id !== authed.user.id) {
    return c.json({ success: false, error: 'Domain not found' }, 404);
  }

  let body: PatchBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const fields: Parameters<typeof updateDomain>[2] = {};
  if ('appId' in body) {
    const appId = typeof body.appId === 'string' && body.appId.trim() ? body.appId.trim() : null;
    if (appId) {
      if (isWildcardDomain(row.domain)) {
        return c.json({ success: false, error: 'A wildcard domain cannot be pinned to one app' }, 400);
      }
      if (!userCanAccessApp(authed.user.id, appId)) {
        return c.json({ success: false, error: 'Unknown app, or you do not have access to it' }, 403);
      }
    }
    fields.app_id = appId;
  }
  if (typeof body.mode === 'string' && body.mode) {
    if (!isDomainTlsMode(body.mode)) {
      return c.json({ success: false, error: `Unknown TLS mode: ${body.mode}` }, 400);
    }
    // Re-apply POST's wildcard mode rule: a wildcard serves per-subdomain, so only
    // 'auto' (per-subdomain HTTP-01 issued on demand) or 'dns' (one DNS-01 wildcard
    // cert) make sense; sslip/byoc do not.
    if (isWildcardDomain(row.domain) && body.mode !== 'dns' && body.mode !== 'auto') {
      return c.json({ success: false, error: 'A wildcard domain supports the auto (per-subdomain HTTP-01) or dns (DNS-01 wildcard) TLS mode' }, 400);
    }
    fields.mode = body.mode;
  }
  if (typeof body.hsts === 'boolean') {
    fields.hsts = body.hsts ? 1 : 0;
  }

  updateDomain(row.domain, authed.user.id, fields);
  invalidateDomainCache();
  const instTarget = await resolveInstanceTarget(Date.now());
  return c.json({ success: true, domain: present(getDomain(row.domain)!, instTarget) });
});

// ─── DELETE /api/domains/:domain ──────────────────────────────────────────────

domains.delete('/:domain', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  const name = c.req.param('domain').toLowerCase();
  const removed = deleteDomain(name, authed.user.id);
  // Drop the row from the in-memory snapshot immediately (fail-closed): if the
  // very next lookup's rebuild hits a transient DB error, the deleted domain must
  // NOT keep routing / authorizing TLS off the stale snapshot.
  invalidateDomainCache(name);
  if (!removed) return c.json({ success: false, error: 'Domain not found' }, 404);
  return c.json({ success: true });
});
