/**
 * Custom-domain resolution + verification (self-serve custom-domain + SSL).
 *
 * `lib/meta-db.ts` owns persistence of the `registered_domains` table; this
 * module is the read/decision layer that the request hot path uses:
 *
 *  - host→app routing       (index.ts, meta-injector.ts)
 *  - dynamic CORS allowlist  (origin.ts)
 *  - on-demand-TLS `ask`      (the /internal/tls/authorize endpoint in index.ts)
 *
 * Only `active` rows take effect anywhere. A row goes `active` only after the
 * operator proves ownership via a DNS TXT challenge (`verifyDomainOwnership`),
 * so Caddy's `ask` endpoint never authorizes a host the operator can't control —
 * the abuse guard that keeps on-demand issuance inside Let's Encrypt rate limits.
 *
 * The active set is cached in-process and rebuilt only when meta-db's revision
 * counter advances (a domain was created/verified/changed/removed) or a short TTL
 * lapses — so the per-request lookups above never hit SQLite on a steady state.
 */
import { resolve4, resolve6, resolveCname, resolveTxt } from 'node:dns/promises';
import {
  getApp,
  getAppBySlug,
  getDomainsRevision,
  listActiveDomains,
  userCanAccessApp,
  type MetaDomain,
} from './meta-db';
import { cachedPublicIdentity, isPrivateIp } from './public-address';
import { constantTimeEqual } from './crypto-utils';

/** TLS modes a registered domain can use. `auto`/`dns`/`sslip` go through ACME
 *  (on-demand or DNS-01); `byoc` uses an operator-supplied static cert. There is
 *  deliberately NO bare-IP ACME mode: no public CA issues certs for a bare IP,
 *  and the bundled Caddy serves IP subjects from its internal CA (untrusted). A
 *  bare IP uses `sslip` (a free, browser-trusted <dashed-ip>.sslip.io hostname)
 *  or `byoc`; direct bare-IP visitors are redirected to the sslip host. */
export type DomainTlsMode = 'auto' | 'dns' | 'sslip' | 'byoc';
export const DOMAIN_TLS_MODES: readonly DomainTlsMode[] = ['auto', 'dns', 'sslip', 'byoc'];

export function isDomainTlsMode(value: string): value is DomainTlsMode {
  return (DOMAIN_TLS_MODES as readonly string[]).includes(value);
}

// ─── Host normalization ───────────────────────────────────────────────────────

/**
 * Lowercase a Host header and strip the port. Handles bracketed IPv6
 * (`[::1]:443` → `::1`). Returns '' for empty/garbage input.
 */
export function normalizeHost(host: string | null | undefined): string {
  if (!host) return '';
  let h = host.trim().toLowerCase();
  if (h.startsWith('[')) {
    // Bracketed IPv6: [addr] or [addr]:port
    const end = h.indexOf(']');
    return end > 0 ? h.slice(1, end) : h.slice(1);
  }
  // host:port — only strip when there's exactly one colon (an unbracketed IPv6
  // address has several and no port, so leave those intact).
  const firstColon = h.indexOf(':');
  if (firstColon !== -1 && h.indexOf(':', firstColon + 1) === -1) {
    h = h.slice(0, firstColon);
  }
  // A fully-qualified Host/SNI may carry the root-label trailing dot
  // (`app.acme.com.`); strip it so it matches the dot-less stored key.
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** True for a bare IPv4 / IPv6 literal (port already stripped). */
export function isIpAddress(host: string): boolean {
  const h = normalizeHost(host);
  if (IPV4_RE.test(h)) {
    return h.split('.').every((o) => Number(o) <= 255);
  }
  // Coarse IPv6 check: hex groups + at least one colon, no letters beyond a-f.
  return h.includes(':') && /^[0-9a-f:]+$/.test(h);
}

// A single DNS label: 1–63 chars, alphanumerics + internal hyphens.
const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * A registrable hostname we accept: a normal FQDN (`app.acme.com`) or a single
 * leading-wildcard (`*.apps.acme.com`). Rejects bare IPs, single labels,
 * trailing dots, and over-long names.
 */
export function isValidDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  if (!d || d.length > 253) return false;
  if (isIpAddress(d)) return false;
  const labels = d.split('.');
  if (labels.length < 2) return false;
  // A wildcard must cover a real sub-zone, not a public suffix: reject `*.com`
  // (would otherwise authorize/issue across an entire TLD). Require >= 2 labels
  // under the star.
  if (labels[0] === '*' && labels.length < 3) return false;
  for (let i = 0; i < labels.length; i++) {
    if (i === 0 && labels[i] === '*') continue; // leading wildcard
    if (!LABEL_RE.test(labels[i])) return false;
  }
  return true;
}

export function isWildcardDomain(domain: string): boolean {
  return domain.trim().toLowerCase().startsWith('*.');
}

/**
 * Derive the sslip.io hostname for a bare IP so it can get a normal, fully
 * browser-trusted Let's Encrypt cert (the cert is issued for the *hostname*,
 * which DNS-resolves back to the exact IP). IPv4 `203.0.113.10` →
 * `203-0-113-10.sslip.io`; IPv6 uses the dash form too. Returns null if the
 * input isn't an IP.
 */
export function sslipHostnameForIp(ip: string): string | null {
  const h = normalizeHost(ip);
  if (IPV4_RE.test(h)) return `${h.replace(/\./g, '-')}.sslip.io`;
  if (isIpAddress(h)) return `${h.replace(/:/g, '-')}.sslip.io`;
  return null;
}

/** A random ownership-challenge token (hex). */
export function generateVerificationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The DNS TXT record the operator publishes to prove ownership of `domain`. */
export function challengeRecord(domain: string, token: string): { name: string; value: string } {
  const base = domain.trim().toLowerCase().replace(/^\*\./, '');
  return { name: `_exepad-challenge.${base}`, value: `exepad-verify=${token}` };
}

// ─── Active-domain snapshot (revision-cached) ─────────────────────────────────

interface Snapshot {
  /** Exact host → row. */
  exact: Map<string, MetaDomain>;
  /** Wildcard rows as `{ suffix: '.apps.acme.com', row }`, longest-suffix-first. */
  wildcards: Array<{ suffix: string; row: MetaDomain }>;
}

const SNAPSHOT_TTL_MS = 30_000;
let snapshot: Snapshot = { exact: new Map(), wildcards: [] };
let snapshotRevision = -1;
let snapshotAt = 0;

/** Build a fresh snapshot, or null if the DB read failed (so the caller keeps
 *  the prior good snapshot instead of caching an empty one on a transient error). */
function buildSnapshot(): Snapshot | null {
  let rows: MetaDomain[];
  try {
    rows = listActiveDomains();
  } catch {
    // No meta.sqlite available yet (a pure unit-test context) OR a transient read
    // error. Either way, don't fabricate an empty active set — return null so the
    // caller leaves the last-good snapshot in place and retries on the next lookup.
    return null;
  }
  const exact = new Map<string, MetaDomain>();
  const wildcards: Array<{ suffix: string; row: MetaDomain }> = [];
  for (const row of rows) {
    if (isWildcardDomain(row.domain)) {
      wildcards.push({ suffix: row.domain.slice(1), row }); // '*.apps.acme.com' → '.apps.acme.com'
    } else {
      exact.set(row.domain, row);
    }
  }
  wildcards.sort((a, b) => b.suffix.length - a.suffix.length);
  return { exact, wildcards };
}

function currentSnapshot(): Snapshot {
  let rev = snapshotRevision;
  try {
    rev = getDomainsRevision();
  } catch {
    rev = snapshotRevision;
  }
  const now = Date.now();
  if (rev !== snapshotRevision || now - snapshotAt > SNAPSHOT_TTL_MS) {
    const built = buildSnapshot();
    // Only commit the cache (and the new revision/timestamp) on a SUCCESSFUL read.
    // On a transient DB error `built` is null: keep the prior snapshot and let the
    // next lookup retry, rather than serving an empty set for a full TTL window.
    if (built) {
      snapshot = built;
      snapshotRevision = rev;
      snapshotAt = now;
    }
  }
  return snapshot;
}

/** Force a rebuild on the next lookup. Called after a write so a just-verified
 *  domain (or a just-removed one) takes effect immediately, not after the TTL.
 *
 *  When a specific host was removed/deactivated, pass it as `removedHost`: the
 *  row is dropped from the in-memory snapshot IMMEDIATELY (fail-closed), so a
 *  transient DB error on the next rebuild — which makes `buildSnapshot()` return
 *  null and `currentSnapshot()` keep the prior snapshot — cannot keep the removed
 *  domain routing / authorizing TLS until a later successful rebuild. */
export function invalidateDomainCache(removedHost?: string): void {
  snapshotRevision = -1;
  snapshotAt = 0;
  if (removedHost) {
    const h = normalizeHost(removedHost);
    // A wildcard is stored under `wildcards` keyed by its full `*.` domain, an
    // exact host under `exact`; drop from both so either kind stops taking effect.
    snapshot.exact.delete(h);
    snapshot.wildcards = snapshot.wildcards.filter((w) => w.row.domain !== h);
    // A removed SNI should be re-countable against the issuance cap.
    authorizedSnis.delete(h);
  }
}

/** The resolved routing decision for a host that matches an active domain. */
export interface HostMapping {
  row: MetaDomain;
  /** appId to serve at the host root, or null for a whole-studio host. */
  appId: string | null;
  /** True when the host serves the whole studio (apps under /a/{id}/). */
  wholeStudio: boolean;
  /** True when the SPA must use domain route-mode (single app served at root). */
  forceDomainMode: boolean;
  /** True when the host matched a wildcard row (`*.apps.acme.com`) rather than an
   *  exact registered host — the served appId is the leftmost label. Wildcard
   *  matches drive per-SNI on-demand issuance the same as exact hosts (bounded by
   *  the per-registered-domain cap in isOnDemandTlsAuthorized); the abuse guard is
   *  that the label must resolve to a real owned, published app
   *  (resolveWildcardApp), so bogus labels never reach a CA. */
  viaWildcard: boolean;
}

/** Resolve a Host header to its active-domain mapping, or null. */
export function resolveHostMapping(host: string | null | undefined): HostMapping | null {
  const h = normalizeHost(host);
  if (!h) return null;
  const snap = currentSnapshot();

  const exactRow = snap.exact.get(h);
  if (exactRow) {
    const appId = exactRow.app_id;
    return {
      row: exactRow,
      appId,
      wholeStudio: !appId,
      forceDomainMode: Boolean(appId),
      viaWildcard: false,
    };
  }

  for (const { suffix, row } of snap.wildcards) {
    if (h.endsWith(suffix) && h.length > suffix.length) {
      // `{label}.apps.acme.com` → the label is the app's friendly ALIAS (slug),
      // falling back to the raw app id; the resolved app is served at the root.
      const label = h.slice(0, h.length - suffix.length);
      if (label && !label.includes('.')) {
        const appId = resolveWildcardApp(row, label);
        if (appId) {
          return { row, appId, wholeStudio: false, forceDomainMode: true, viaWildcard: true };
        }
      }
    }
  }
  return null;
}

/**
 * Resolve a wildcard row's leftmost Host label to the app served there, or null.
 *
 * A wildcard row (`*.apps.acme.com`) carries no `app_id`; the target is derived from
 * the label — its friendly alias (`apps.slug`), then the raw app id for back-compat.
 * Without binding that to the wildcard's OWNER, ANY active wildcard would resolve ANY
 * app in the container — operator B's `victim.apps.b.com` would serve operator C's app
 * under B's domain (cross-tenant impersonation / SEO takeover). So the app must exist,
 * be accessible to the wildcard owner, and be PUBLISHED. Returns the app's REAL id
 * (not the label) so serving + `/a/{id}/` stay id-keyed. Fail-closed on any
 * error / unknown / unowned / unpublished label.
 */
function resolveWildcardApp(row: MetaDomain, label: string): string | null {
  let app: ReturnType<typeof getApp>;
  try {
    app = getAppBySlug(label) ?? getApp(label);
  } catch {
    return null; // meta.sqlite unavailable → fail closed
  }
  if (!app) return null;
  if (!userCanAccessApp(row.owner_id, app.id)) return null;
  // Only CURRENTLY-published apps are served at a public wildcard host. Test
  // live-published state only — status/published_at, both cleared by unpublish.
  // NOT active_published_version: unpublish deliberately keeps it set for rollback,
  // so treating it as "published" would keep an unpublished app routing + keep
  // authorizing on-demand ACME for its wildcard subdomain after it went offline.
  const published = app.status === 'published' || app.published_at != null;
  return published ? app.id : null;
}

/** True when the host is a known, active, operator-verified custom host (for CORS). */
export function isActiveCustomHost(host: string | null | undefined): boolean {
  return resolveHostMapping(host) !== null;
}

/** appId a host serves at its root, or null (whole studio, wildcard miss, or unknown). */
export function appIdForActiveHost(host: string | null | undefined): string | null {
  return resolveHostMapping(host)?.appId ?? null;
}

/** True when the host serves the whole studio — used to keep route-mode 'path'. */
export function isWholeStudioCustomHost(host: string | null | undefined): boolean {
  return resolveHostMapping(host)?.wholeStudio === true;
}

/** True when the SPA must be forced into domain route-mode for this host. */
export function shouldForceDomainMode(host: string | null | undefined): boolean {
  return resolveHostMapping(host)?.forceDomainMode === true;
}

// ─── On-demand-TLS issuance abuse guard ───────────────────────────────────────
//
// On-demand TLS lets the fronting Caddy obtain a per-hostname Let's Encrypt cert
// (HTTP-01 / TLS-ALPN-01) at the first TLS handshake for an SNI it has no cert for.
// This is what serves `*.apps.acme.com` per-app subdomains WITHOUT a DNS-01 wildcard
// cert — so it works with ANY DNS provider (plain A records, no provider API token).
//
// The risk to contain: an attacker sending arbitrary SNIs could drive a FRESH public
// ACME order per distinct name, exhausting Let's Encrypt's per-registered-domain /
// new-order / failed-validation limits and locking the operator out of ALL issuance
// and renewal. Two layers bound it:
//
//  1. The `ask` endpoint only authorizes a name `resolveHostMapping` resolves to an
//     active row — an EXACT operator-verified host, or a WILDCARD-matched label that
//     is a real, owner-accessible, PUBLISHED appId. `resolveWildcardApp`
//     fail-closes bogus / foreign / unpublished labels to null, so an attacker's
//     random `<label>.apps.acme.com` NEVER reaches a CA — the issuance surface is
//     bounded to the operator's own published apps, not to arbitrary labels. This
//     publish-scoped gate is the abuse guard Caddy's on-demand docs require.
//  2. A rolling per-registered-domain cap on distinct authorized SNIs: even a burst
//     of legitimately-published apps (or a future misconfiguration) can't green-light
//     an unbounded number of fresh CA orders, and one busy wildcard row can't starve
//     issuance for a different registered domain's hosts (the cap is keyed on the
//     matched row, not global).
const AUTHORIZED_SNI_WINDOW_MS = 60 * 60 * 1000; // 1h
const AUTHORIZED_SNI_CAP = 50; // per registered-domain row; ~Let's Encrypt certs-per-registered-domain floor
// host → { first-authorized ts, registered-domain group (the matched row's domain) }
const authorizedSnis = new Map<string, { ts: number; group: string }>();

/**
 * Admit `host` for on-demand issuance if it's within the rolling cap for its
 * registered-domain `group` (the matched row's `*.apps.acme.com` wildcard domain,
 * or an exact host itself). Per-group keying gives each operator-verified row its
 * own budget so one busy wildcard can't starve another domain's issuance.
 */
function withinSniIssuanceCap(host: string, group: string): boolean {
  const now = Date.now();
  for (const [k, v] of authorizedSnis) {
    if (now - v.ts > AUTHORIZED_SNI_WINDOW_MS) authorizedSnis.delete(k);
  }
  if (authorizedSnis.has(host)) return true; // already counted this window
  let groupCount = 0;
  for (const v of authorizedSnis.values()) if (v.group === group) groupCount++;
  if (groupCount >= AUTHORIZED_SNI_CAP) return false;
  authorizedSnis.set(host, { ts: now, group });
  return true;
}

/**
 * The on-demand-TLS authorization decision: may the fronting Caddy obtain/serve a
 * cert for this SNI host? This is what the `/internal/tls/authorize` endpoint
 * answers, and it IS the abuse guard — an attacker sending bogus SNIs must be
 * refused so Caddy never drives arbitrary public-CA issuance for them.
 *
 * Authorized hosts (everything else → refused):
 *  - this box's own identity for the zero-config HTTPS floor — loopback/localhost,
 *    any private/LAN IP literal, and this instance's own public IP + its sslip
 *    hostname — so Caddy mints a cert for the studio served on its own addresses
 *    (Caddy's internal CA for IP/localhost subjects, public ACME for the sslip
 *    name). None of these can be spoofed into foreign issuance: they only ever
 *    resolve to this machine. This fixed set is exempt from the SNI cap.
 *  - any host `resolveHostMapping` resolves to an active row — an EXACT operator-
 *    verified registered domain (incl. the auto-registered sslip host), OR a
 *    WILDCARD-matched label that is a real, owner-accessible, PUBLISHED appId. Both
 *    get a browser-trusted per-hostname ACME cert on demand, subject to the rolling
 *    per-registered-domain issuance cap. A bogus / foreign / unpublished wildcard
 *    label resolves to null below and is refused, so `*.apps.acme.com` issues
 *    per-app HTTP-01 certs on demand for the operator's published apps only — no
 *    DNS-01 wildcard cert (and no DNS-provider token) needed.
 */
export function isOnDemandTlsAuthorized(host: string | null | undefined): boolean {
  const h = normalizeHost(host);
  if (!h) return false;
  // The studio's own loopback / LAN / private addresses → Caddy's internal CA.
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (isIpAddress(h) && (h === '127.0.0.1' || h === '::1' || isPrivateIp(h))) return true;
  // This instance's own public IP literal + its derived sslip hostname.
  const { ip } = cachedPublicIdentity();
  if (ip) {
    if (h === normalizeHost(ip)) return true;
    const sslip = sslipHostnameForIp(ip);
    if (sslip && h === sslip) return true;
  }
  // Any active registered host — an exact operator-verified domain OR a wildcard-
  // matched PUBLISHED app. The wildcard abuse guard is resolveWildcardApp
  // (applied in resolveHostMapping): a bogus / foreign / unpublished label returns
  // null here and is refused, so it never drives CA issuance. Bounded per matched
  // registered-domain row by the rolling issuance cap.
  const mapping = resolveHostMapping(h);
  if (mapping) {
    return withinSniIssuanceCap(h, mapping.row.domain);
  }
  return false;
}

/** Opt-in HSTS: true only when the matched active host has hsts enabled. */
export function hstsEnabledForHost(host: string | null | undefined): boolean {
  return resolveHostMapping(host)?.row.hsts === 1;
}

// ─── DNS ownership verification ────────────────────────────────────────────────

export interface VerifyResult {
  ok: boolean;
  /** Human-readable reason when ok=false. */
  error?: string;
}

/**
 * Verify the operator controls `domain` by looking up the TXT challenge record
 * and matching the expected `exepad-verify=<token>` value. This is the gate
 * before flipping a row to `active`: TXT ownership (not A-record reachability)
 * is the proof, so the flow works for NAT/DNS-01 deployments where the A record
 * legitimately points elsewhere; Caddy's ACME is the real reachability check at
 * issuance time.
 */
/** Bound a DNS lookup so a slow/malicious authoritative server can't hang the
 *  request worker. node:dns has no per-call timeout, so race it against a timer. */
const DNS_TIMEOUT_MS = 5000;
function withDnsTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(Object.assign(new Error('DNS lookup timed out'), { code: 'ETIMEDOUT' })),
        DNS_TIMEOUT_MS,
      );
      timer.unref?.();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Reserved / internal-use suffixes the verification + live-check paths must never
// DNS-probe: resolving `_exepad-challenge.<name>` (or the advised records) for
// these would let an authenticated operator use this box as a blind internal-DNS
// existence oracle (e.g. `_exepad-challenge.jenkins.corp.internal`). isValidDomain
// still accepts them as syntactically valid FQDNs, so this is the network-side gate.
const RESERVED_NAME_SUFFIXES = [
  '.internal', '.local', '.localhost', '.intranet', '.corp', '.home',
  '.lan', '.private', '.test', '.example', '.invalid',
];

export function isReservedInternalName(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/\.$/, '');
  if (!n) return false;
  return RESERVED_NAME_SUFFIXES.some((s) => n === s.slice(1) || n.endsWith(s));
}

const resolveTxtBounded = (name: string): Promise<string[][]> => withDnsTimeout(resolveTxt(name));
const resolve4Bounded = (name: string): Promise<string[]> => withDnsTimeout(resolve4(name));
const resolve6Bounded = (name: string): Promise<string[]> => withDnsTimeout(resolve6(name));
const resolveCnameBounded = (name: string): Promise<string[]> => withDnsTimeout(resolveCname(name));

export async function verifyDomainOwnership(domain: string, token: string): Promise<VerifyResult> {
  if (isReservedInternalName(domain)) {
    return { ok: false, error: `${domain} is a reserved/internal name and cannot be verified.` };
  }
  const { name, value } = challengeRecord(domain, token);
  let records: string[][];
  try {
    records = await resolveTxtBounded(name);
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      return { ok: false, error: `No TXT record found at ${name}. Add it and try again (DNS can take a few minutes to propagate).` };
    }
    return { ok: false, error: `DNS lookup failed for ${name}: ${(e as Error)?.message ?? String(e)}` };
  }
  // Each TXT record can be split into multiple strings; join then compare.
  // Constant-time compare for defence-in-depth (the token is a public DNS value,
  // but keep the match non-leaky like every other secret compare in the worker).
  const flat = records.map((parts) => parts.join('').trim());
  if (flat.some((v) => constantTimeEqual(v, value))) {
    return { ok: true };
  }
  return {
    ok: false,
    error: `TXT record at ${name} did not match. Expected value "${value}".`,
  };
}

// ─── Live DNS-record checks (UI "is this record correct?" signals) ─────────────
//
// Distinct from `verifyDomainOwnership` (the gate that flips a row to `active`):
// these are read-only, best-effort lookups that tell the operator, per record,
// whether what they created at their DNS provider is visible to us yet. They
// drive the live status pills in the add-domain wizard. They never change state.

export type DnsCheckState = 'ok' | 'mismatch' | 'missing' | 'error' | 'skipped';

/** A single expected record to verify the live presence of. */
export interface DnsRecordInput {
  type: 'A' | 'CNAME' | 'TXT';
  name: string;
  value: string;
}

/** The live result for one expected record. */
export interface DnsRecordCheck {
  type: 'A' | 'CNAME' | 'TXT';
  name: string;
  expected: string;
  /** What we actually resolved (IPs, CNAME targets, or TXT values). */
  observed: string[];
  state: DnsCheckState;
  /** Human-readable explanation when not `ok`. */
  detail?: string;
}

/** Normalize a DNS target for comparison: lowercase, strip a trailing dot. */
function normTarget(s: string): string {
  return s.trim().toLowerCase().replace(/\.$/, '');
}

/** True for an IPv6 literal (the advised "A" record may carry one via EXEPAD_PUBLIC_IP). */
function isIpv6Literal(s: string): boolean {
  const h = s.trim().toLowerCase();
  return h.includes(':') && /^[0-9a-f:]+$/.test(h);
}

const isNxdomain = (e: unknown): boolean => {
  const code = (e as { code?: string })?.code;
  return code === 'ENOTFOUND' || code === 'ENODATA';
};

async function checkOneRecord(rec: DnsRecordInput): Promise<DnsRecordCheck> {
  const base = { type: rec.type, name: rec.name, expected: rec.value, observed: [] as string[] };
  // A placeholder value (e.g. "<your server public IP>") means there's nothing
  // concrete to look up yet — the operator must set a public IP/host first.
  if (!rec.value || rec.value.startsWith('<')) {
    return { ...base, state: 'skipped', detail: 'Set a public IP/host for this instance first.' };
  }
  // A wildcard record (`*.apps.acme.com`) can't be resolved by its literal name, and
  // the bare apex is NOT matched by the wildcard — so probe a synthetic sub-label the
  // wildcard actually covers. (The TXT ownership name is already `*.`-stripped upstream
  // by challengeRecord, so it keeps using rec.name.)
  const lookupName = rec.name.startsWith('*.') ? `exepad-probe.${rec.name.slice(2)}` : rec.name;
  // Never DNS-probe reserved/internal names (see isReservedInternalName): the
  // live-check would otherwise leak internal-name existence to the operator.
  if (isReservedInternalName(lookupName)) {
    return { ...base, state: 'skipped', detail: 'Reserved/internal name — not looked up.' };
  }
  try {
    if (rec.type === 'A') {
      // The advised "A" record may carry an IPv6 literal (explicit EXEPAD_PUBLIC_IP);
      // resolve the matching family so a correct AAAA isn't reported as a mismatch.
      const wantV6 = isIpv6Literal(rec.value);
      const addrs = wantV6 ? await resolve6Bounded(lookupName) : await resolve4Bounded(lookupName);
      const want = normTarget(rec.value);
      const ok = addrs.map(normTarget).includes(want);
      return {
        ...base,
        observed: addrs,
        state: ok ? 'ok' : 'mismatch',
        detail: ok
          ? undefined
          : `Resolves to ${addrs.join(', ') || 'nothing'} — expected ${rec.value}. A proxy/CDN in front (e.g. Cloudflare) is fine.`,
      };
    }
    if (rec.type === 'CNAME') {
      const want = normTarget(rec.value);
      let targets: string[];
      try {
        targets = (await resolveCnameBounded(lookupName)).map(normTarget);
      } catch (inner) {
        // An apex can't carry a CNAME RR; providers flatten ALIAS/ANAME to A records,
        // so resolveCname returns NXDOMAIN even when correctly configured. Fall back to
        // comparing the A sets of the name and the intended target host.
        if (!isNxdomain(inner)) throw inner;
        const [nameIps, targetIps] = await Promise.all([
          resolve4Bounded(lookupName).catch(() => [] as string[]),
          resolve4Bounded(want).catch(() => [] as string[]),
        ]);
        if (!nameIps.length) throw inner; // genuinely not published yet → outer "missing"
        const ok = targetIps.some((ip) => nameIps.includes(ip));
        return {
          ...base,
          observed: nameIps,
          state: ok ? 'ok' : 'mismatch',
          detail: ok ? undefined : `Resolves to ${nameIps.join(', ')} — expected an alias to ${want}.`,
        };
      }
      const ok = targets.includes(want);
      return {
        ...base,
        observed: targets,
        state: ok ? 'ok' : 'mismatch',
        detail: ok ? undefined : `Points to ${targets.join(', ') || 'nothing'} — expected ${want}.`,
      };
    }
    // TXT — each record may be split into multiple strings; join then compare.
    const txt = (await resolveTxtBounded(rec.name)).map((parts) => parts.join('').trim());
    const ok = txt.includes(rec.value);
    return {
      ...base,
      observed: txt,
      state: ok ? 'ok' : 'mismatch',
      detail: ok ? undefined : `Found a TXT record, but not the expected value yet.`,
    };
  } catch (e: unknown) {
    if (isNxdomain(e)) {
      return { ...base, state: 'missing', detail: 'Not visible yet — DNS can take a few minutes to propagate.' };
    }
    return { ...base, state: 'error', detail: (e as Error)?.message ?? 'DNS lookup failed.' };
  }
}

/**
 * Resolve every expected record concurrently and report its live state. A
 * single record's failure never rejects the whole call — it's captured as that
 * record's `state`. Bounded by the same per-lookup timeout as ownership checks.
 */
export async function checkDnsRecords(records: DnsRecordInput[]): Promise<DnsRecordCheck[]> {
  return Promise.all(records.map(checkOneRecord));
}
