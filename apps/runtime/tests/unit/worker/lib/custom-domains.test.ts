// @vitest-environment node
/**
 * custom-domains.ts — self-serve custom-domain resolution + the active-domain
 * decision layer (host→app routing, dynamic CORS, on-demand-TLS authorization).
 *
 * Two halves:
 *  - Pure helpers (host normalization, IP/domain validation, sslip derivation,
 *    challenge records) — DB-free.
 *  - The active-domain snapshot, exercised against a real temp meta.sqlite so the
 *    revision-invalidation + verify-then-active gating is covered end-to-end,
 *    including that origin.ts's CORS only echoes an ACTIVE custom host.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  normalizeHost,
  isIpAddress,
  isValidDomain,
  isWildcardDomain,
  sslipHostnameForIp,
  generateVerificationToken,
  challengeRecord,
  isDomainTlsMode,
  resolveHostMapping,
  isActiveCustomHost,
  isWholeStudioCustomHost,
  appIdForActiveHost,
  shouldForceDomainMode,
  isOnDemandTlsAuthorized,
  hstsEnabledForHost,
  invalidateDomainCache,
} from '../../../../worker/src/lib/custom-domains';
import {
  createApp,
  createDomain,
  touchApp,
  updateDomain,
  deleteDomain,
  deleteApp,
  getDomain,
  setActivePublishedVersion,
  setAppSlug,
  slugifyName,
  isValidSlug,
} from '../../../../worker/src/lib/meta-db';
import { resolveAllowedOrigin } from '../../../../worker/src/lib/origin';

let dataDir: string;
beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-domains-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
  process.env.EXEPAD_META_DB = join(dataDir, 'meta.sqlite');
});
afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.EXEPAD_META_DB;
  delete process.env.EXEPAD_DATA_DIR;
});

const OWNER = 'user-1';

describe('normalizeHost', () => {
  it('lowercases and strips the port', () => {
    expect(normalizeHost('App.Example.COM:443')).toBe('app.example.com');
    expect(normalizeHost('host:8080')).toBe('host:8080'.split(':')[0]);
  });
  it('handles bracketed IPv6 with a port', () => {
    expect(normalizeHost('[::1]:443')).toBe('::1');
    expect(normalizeHost('[2001:db8::1]')).toBe('2001:db8::1');
  });
  it('leaves an unbracketed IPv6 (multiple colons, no port) intact', () => {
    expect(normalizeHost('2001:db8::1')).toBe('2001:db8::1');
  });
  it('strips a fully-qualified trailing dot', () => {
    expect(normalizeHost('app.example.com.')).toBe('app.example.com');
    expect(normalizeHost('App.Example.COM.:443')).toBe('app.example.com');
  });
  it('returns empty string for empty input', () => {
    expect(normalizeHost(undefined)).toBe('');
    expect(normalizeHost('')).toBe('');
  });
});

describe('isIpAddress', () => {
  it('accepts IPv4 and rejects out-of-range octets', () => {
    expect(isIpAddress('203.0.113.10')).toBe(true);
    expect(isIpAddress('203.0.113.10:443')).toBe(true);
    expect(isIpAddress('999.0.0.1')).toBe(false);
  });
  it('accepts IPv6', () => {
    expect(isIpAddress('::1')).toBe(true);
    expect(isIpAddress('2001:db8::1')).toBe(true);
  });
  it('rejects domains', () => {
    expect(isIpAddress('app.example.com')).toBe(false);
  });
});

describe('isValidDomain', () => {
  it('accepts an apex and a subdomain', () => {
    expect(isValidDomain('example.com')).toBe(true);
    expect(isValidDomain('app.example.com')).toBe(true);
  });
  it('accepts a single leading wildcard', () => {
    expect(isValidDomain('*.apps.example.com')).toBe(true);
  });
  it('rejects bare IPs, single labels, and bad characters', () => {
    expect(isValidDomain('203.0.113.10')).toBe(false);
    expect(isValidDomain('localhost')).toBe(false);
    expect(isValidDomain('-bad.example.com')).toBe(false);
    expect(isValidDomain('a..b.com')).toBe(false);
    expect(isValidDomain('*.*.example.com')).toBe(false);
  });
  it('rejects a wildcard on a public suffix (too broad)', () => {
    expect(isValidDomain('*.com')).toBe(false);
    expect(isValidDomain('*.co.uk')).toBe(true); // 2 labels under the star — allowed (no PSL check)
    expect(isValidDomain('*.apps.example.com')).toBe(true);
  });
  it('rejects over-long names', () => {
    expect(isValidDomain(`${'a'.repeat(300)}.com`)).toBe(false);
  });
});

describe('isWildcardDomain', () => {
  it('detects the leading wildcard', () => {
    expect(isWildcardDomain('*.apps.example.com')).toBe(true);
    expect(isWildcardDomain('app.example.com')).toBe(false);
  });
});

describe('sslipHostnameForIp', () => {
  it('derives a dashed IPv4 sslip hostname', () => {
    expect(sslipHostnameForIp('203.0.113.10')).toBe('203-0-113-10.sslip.io');
  });
  it('returns null for a non-IP', () => {
    expect(sslipHostnameForIp('example.com')).toBeNull();
  });
});

describe('generateVerificationToken', () => {
  it('returns a 48-char hex token', () => {
    const t = generateVerificationToken();
    expect(t).toMatch(/^[0-9a-f]{48}$/);
    expect(generateVerificationToken()).not.toBe(t);
  });
});

describe('challengeRecord', () => {
  it('builds the TXT name + value, stripping a wildcard prefix', () => {
    expect(challengeRecord('app.example.com', 'tok')).toEqual({
      name: '_exepad-challenge.app.example.com',
      value: 'exepad-verify=tok',
    });
    expect(challengeRecord('*.apps.example.com', 'tok').name).toBe(
      '_exepad-challenge.apps.example.com',
    );
  });
});

describe('isDomainTlsMode', () => {
  it('accepts known modes and rejects others', () => {
    for (const m of ['auto', 'dns', 'sslip', 'byoc']) expect(isDomainTlsMode(m)).toBe(true);
    expect(isDomainTlsMode('nope')).toBe(false);
    // The experimental bare-IP ACME mode was removed (no CA issues IP certs).
    expect(isDomainTlsMode('ip')).toBe(false);
  });
});

describe('app-alias slugs', () => {
  it('slugifies a display name into a DNS label', () => {
    expect(slugifyName('My CRM App!')).toBe('my-crm-app');
    expect(slugifyName('Café  Notes')).toBe('cafe-notes');
    expect(slugifyName('  --Trim-- ')).toBe('trim');
    expect(slugifyName('   ')).toBe(''); // no usable chars → caller falls back to the id
    expect(slugifyName('x'.repeat(80)).length).toBeLessThanOrEqual(40);
  });
  it('isValidSlug enforces the DNS-label rules', () => {
    for (const ok of ['crm', 'my-app-2', 'a', 'a1b2c3']) expect(isValidSlug(ok)).toBe(true);
    for (const bad of ['-bad', 'bad-', 'has.dot', 'UP', 'has space', '']) expect(isValidSlug(bad)).toBe(false);
  });
});

describe('active-domain resolution (meta.sqlite backed)', () => {
  it('a pending domain does not resolve, authorize, or pass CORS', () => {
    createDomain({ domain: 'app.acme.com', ownerId: OWNER, appId: 'app123', mode: 'auto', verificationToken: 'x' });
    invalidateDomainCache();
    expect(resolveHostMapping('app.acme.com')).toBeNull();
    expect(isOnDemandTlsAuthorized('app.acme.com')).toBe(false);
    expect(resolveAllowedOrigin('https://app.acme.com')).toBeNull();
  });

  it('a single-app domain, once active, maps host→app and forces domain mode', () => {
    updateDomain('app.acme.com', OWNER, { status: 'active' });
    invalidateDomainCache();
    const m = resolveHostMapping('app.acme.com');
    expect(m?.appId).toBe('app123');
    expect(m?.wholeStudio).toBe(false);
    expect(m?.forceDomainMode).toBe(true);
    expect(appIdForActiveHost('app.acme.com')).toBe('app123');
    expect(shouldForceDomainMode('app.acme.com')).toBe(true);
    // Host normalization: the :443 form maps to the same dot-less row.
    expect(resolveHostMapping('app.acme.com:443')).not.toBeNull();
    expect(isActiveCustomHost('app.acme.com')).toBe(true);
    // Dynamic CORS echoes the verified host over HTTPS on the default port only.
    expect(resolveAllowedOrigin('https://app.acme.com')).toBe('https://app.acme.com');
    // SECURITY: a non-default port on the same host is a DIFFERENT origin and must
    // NOT be blessed as a credentialed same-origin (port-confusion guard).
    expect(resolveAllowedOrigin('https://app.acme.com:8443')).toBeNull();
    // SECURITY: the plaintext http origin of an https-only custom domain must NOT
    // be echoed (scheme-confusion / MITM-on-:80 guard).
    expect(resolveAllowedOrigin('http://app.acme.com')).toBeNull();
    // The fully-qualified (trailing-dot) host still resolves to the dot-less row.
    expect(isActiveCustomHost('app.acme.com.')).toBe(true);
    expect(resolveHostMapping('app.acme.com.')).not.toBeNull();
  });

  it('a whole-studio domain (no appId) stays path-mode and resolves no single app', () => {
    createDomain({ domain: 'studio.acme.com', ownerId: OWNER, appId: null, mode: 'auto', verificationToken: 'y' });
    updateDomain('studio.acme.com', OWNER, { status: 'active' });
    invalidateDomainCache();
    expect(isWholeStudioCustomHost('studio.acme.com')).toBe(true);
    expect(appIdForActiveHost('studio.acme.com')).toBeNull();
    expect(shouldForceDomainMode('studio.acme.com')).toBe(false);
    expect(isActiveCustomHost('studio.acme.com')).toBe(true);
  });

  it('a wildcard maps a label ONLY to the owner\'s own published app (cross-tenant guard)', () => {
    const ownedApp = createApp(OWNER, 'Wild App');
    touchApp(ownedApp.id, { status: 'published' });
    createDomain({ domain: '*.apps.acme.com', ownerId: OWNER, appId: null, mode: 'dns', verificationToken: 'z' });
    updateDomain('*.apps.acme.com', OWNER, { status: 'active' });
    invalidateDomainCache();

    // The owner's own published app resolves at its raw-id label (back-compat).
    const m = resolveHostMapping(`${ownedApp.id}.apps.acme.com`);
    expect(m?.appId).toBe(ownedApp.id);
    expect(m?.forceDomainMode).toBe(true);
    expect(m?.viaWildcard).toBe(true);

    // It ALSO answers at its friendly ALIAS (slug derived from the name), and the
    // mapping returns the app's REAL id — not the label — so serving stays id-keyed.
    expect(ownedApp.slug).toBe('wild-app');
    const bySlug = resolveHostMapping('wild-app.apps.acme.com');
    expect(bySlug?.appId).toBe(ownedApp.id);
    expect(bySlug?.viaWildcard).toBe(true);
    expect(isOnDemandTlsAuthorized('wild-app.apps.acme.com')).toBe(true);

    // SECURITY: an arbitrary label that is not an owned published app does NOT
    // resolve — the wildcard no longer serves any appId in the container.
    expect(resolveHostMapping('invoices.apps.acme.com')).toBeNull();

    // SECURITY: another operator's published app is NOT served under this
    // operator's wildcard (cross-tenant impersonation guard).
    const foreignApp = createApp('other-owner', 'Foreign App');
    touchApp(foreignApp.id, { status: 'published' });
    invalidateDomainCache();
    expect(resolveHostMapping(`${foreignApp.id}.apps.acme.com`)).toBeNull();

    // A wildcard-matched PUBLISHED app IS authorized for per-SNI on-demand issuance
    // — per-subdomain HTTP-01 certs, so `*.apps.acme.com` needs no DNS-01 wildcard
    // cert and works with any DNS provider. The abuse guard is the ownership/publish
    // check in resolveHostMapping, asserted just above.
    expect(isOnDemandTlsAuthorized(`${ownedApp.id}.apps.acme.com`)).toBe(true);
    // SECURITY: a bogus label (not an owned published app) resolves to null, so
    // on-demand issuance is REFUSED — an attacker's random SNI never reaches a CA.
    expect(isOnDemandTlsAuthorized('invoices.apps.acme.com')).toBe(false);
    // SECURITY: another operator's published app under this wildcard is refused too
    // (the cross-tenant impersonation guard extends to TLS issuance).
    expect(isOnDemandTlsAuthorized(`${foreignApp.id}.apps.acme.com`)).toBe(false);

    // The bare wildcard base is not itself a subdomain → no match.
    expect(resolveHostMapping('apps.acme.com')).toBeNull();
    // A nested label is not a single wildcard subdomain.
    expect(resolveHostMapping('a.b.apps.acme.com')).toBeNull();
  });

  it('renaming an app alias moves its wildcard subdomain (old alias frees, id still works)', () => {
    createDomain({ domain: '*.r.example.com', ownerId: OWNER, appId: null, mode: 'auto', verificationToken: 'r' });
    updateDomain('*.r.example.com', OWNER, { status: 'active' });
    const app = createApp(OWNER, 'Sales Board');
    touchApp(app.id, { status: 'published' });
    const other = createApp(OWNER, 'Taken');
    invalidateDomainCache();

    // Default alias derived from the display name.
    expect(app.slug).toBe('sales-board');
    expect(resolveHostMapping('sales-board.r.example.com')?.appId).toBe(app.id);

    // Rename to a custom alias → the new label resolves, the old one frees up, the id
    // fallback still works.
    expect(setAppSlug(app.id, 'sales').ok).toBe(true);
    invalidateDomainCache();
    expect(resolveHostMapping('sales.r.example.com')?.appId).toBe(app.id);
    expect(resolveHostMapping('sales-board.r.example.com')).toBeNull();
    expect(resolveHostMapping(`${app.id}.r.example.com`)?.appId).toBe(app.id);

    // A taken alias (another app's slug) and invalid labels are rejected.
    expect(setAppSlug(app.id, other.slug).ok).toBe(false);
    expect(setAppSlug(app.id, '-bad-').ok).toBe(false);
    expect(setAppSlug(app.id, 'Has Space').ok).toBe(false);
  });

  it('per-registered-domain issuance cap bounds a busy wildcard without starving other domains', () => {
    // Two independent wildcard registered domains, each its own issuance-cap group.
    createDomain({ domain: '*.t.example.com', ownerId: OWNER, appId: null, mode: 'auto', verificationToken: 't' });
    updateDomain('*.t.example.com', OWNER, { status: 'active' });
    createDomain({ domain: '*.u.example.com', ownerId: OWNER, appId: null, mode: 'auto', verificationToken: 'u' });
    updateDomain('*.u.example.com', OWNER, { status: 'active' });
    invalidateDomainCache();

    // Publish AUTHORIZED_SNI_CAP (50) apps and authorize each under *.t.example.com.
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const a = createApp(OWNER, `Cap App ${i}`);
      touchApp(a.id, { status: 'published' });
      ids.push(a.id);
    }
    for (const id of ids) {
      expect(isOnDemandTlsAuthorized(`${id}.t.example.com`)).toBe(true);
    }

    // The 51st DISTINCT published app under the SAME group is refused (cap hit).
    const overflow = createApp(OWNER, 'Cap Overflow');
    touchApp(overflow.id, { status: 'published' });
    expect(isOnDemandTlsAuthorized(`${overflow.id}.t.example.com`)).toBe(false);

    // An already-authorized host in the capped group is still allowed (idempotent).
    expect(isOnDemandTlsAuthorized(`${ids[0]}.t.example.com`)).toBe(true);

    // A DIFFERENT registered domain is unaffected — one busy wildcard does NOT
    // starve issuance for another domain's hosts (per-group keying, hardening #1).
    const other = createApp(OWNER, 'Other Group App');
    touchApp(other.id, { status: 'published' });
    expect(isOnDemandTlsAuthorized(`${other.id}.u.example.com`)).toBe(true);
  });

  it('opt-in HSTS reflects the row flag', () => {
    expect(hstsEnabledForHost('app.acme.com')).toBe(false);
    updateDomain('app.acme.com', OWNER, { hsts: 1 });
    invalidateDomainCache();
    expect(hstsEnabledForHost('app.acme.com')).toBe(true);
  });

  it('removing a domain revokes routing, authorization, and CORS', () => {
    deleteDomain('app.acme.com', OWNER);
    invalidateDomainCache();
    expect(resolveHostMapping('app.acme.com')).toBeNull();
    expect(isOnDemandTlsAuthorized('app.acme.com')).toBe(false);
    expect(resolveAllowedOrigin('https://app.acme.com')).toBeNull();
  });

  it('deleting an app unbinds its custom domain — host stops routing/authorizing + re-registration is freed', () => {
    // Bind an exact custom host to a real app and activate it.
    const app = createApp(OWNER, 'Doomed App');
    createDomain({ domain: 'shop.doomed.example.com', ownerId: OWNER, appId: app.id, mode: 'auto', verificationToken: 'd' });
    updateDomain('shop.doomed.example.com', OWNER, { status: 'active' });
    invalidateDomainCache();
    expect(resolveHostMapping('shop.doomed.example.com')?.appId).toBe(app.id);
    expect(isOnDemandTlsAuthorized('shop.doomed.example.com')).toBe(true);

    // Delete the app. deleteApp must clear the bound registered_domains row AND bump
    // the resolution revision itself — WITHOUT a manual invalidateDomainCache() — so
    // the host drops on the very next lookup (covers the husk-reaper / cron paths too).
    deleteApp(app.id);
    expect(getDomain('shop.doomed.example.com')).toBeNull(); // row gone → re-registration no longer 409s on the PK
    expect(resolveHostMapping('shop.doomed.example.com')).toBeNull(); // exact-host branch stops routing to the dead app
    expect(isOnDemandTlsAuthorized('shop.doomed.example.com')).toBe(false); // Caddy's ask endpoint stops authorizing ACME
  });

  it('an UNPUBLISHED app stops resolving + authorizing TLS on a wildcard host, even though active_published_version lingers', () => {
    createDomain({ domain: '*.pub.example.com', ownerId: OWNER, appId: null, mode: 'auto', verificationToken: 'pub' });
    updateDomain('*.pub.example.com', OWNER, { status: 'active' });
    const app = createApp(OWNER, 'Pub Toggle');

    // Publish: status + published_at set, and a version pointer recorded (as publish does).
    touchApp(app.id, { status: 'published', published_at: new Date().toISOString() });
    setActivePublishedVersion(app.id, 42);
    invalidateDomainCache();
    expect(resolveHostMapping('pub-toggle.pub.example.com')?.appId).toBe(app.id);
    expect(isOnDemandTlsAuthorized('pub-toggle.pub.example.com')).toBe(true);

    // Unpublish EXACTLY as orchestrate.ts does: clear status + published_at, but keep
    // active_published_version set (deliberately, for rollback).
    touchApp(app.id, { status: 'preview', published_at: null });
    setActivePublishedVersion(app.id, 42); // reassert the lingering rollback pointer
    invalidateDomainCache();

    // The now-offline app must NOT resolve and must NOT authorize on-demand ACME —
    // active_published_version must not be mistaken for "currently published".
    expect(resolveHostMapping('pub-toggle.pub.example.com')).toBeNull();
    expect(isOnDemandTlsAuthorized('pub-toggle.pub.example.com')).toBe(false);
  });
});
