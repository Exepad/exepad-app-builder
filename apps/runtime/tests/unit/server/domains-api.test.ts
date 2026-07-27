// @vitest-environment node
/**
 * /api/domains — self-serve custom-domain management.
 *
 * Covers the operator gate, registration (domain + IP/sslip), validation
 * (invalid host, duplicate, wildcard rules, app-mapping ownership), the
 * verify-then-active flow (with DNS mocked), HSTS toggle, and removal.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';

import { hashPassword } from '../../../worker/src/lib/password';
import { createUser, createApp } from '../../../worker/src/lib/meta-db';
import { mintSessionToken, PLATFORM_SESSION_COOKIE } from '../../../worker/src/routes/gateway/auth';
import { domains } from '../../../worker/src/routes/domains';
import { __resetPublicIpCache, __setInterfaceIpForTest } from '../../../worker/src/lib/public-address';
import type { Env } from '../../../worker/src/types/env';

// Control the DNS lookups the verify (TXT) + check (A/CNAME/TXT) endpoints make.
const dnsMock = vi.hoisted(() => ({
  txt: [] as string[][],
  a: [] as string[],
  aaaa: [] as string[],
  cname: [] as string[],
  errTxt: '' as string,
  errA: '' as string,
  errAaaa: '' as string,
  errCname: '' as string,
  /** Names actually resolved (so tests can assert the wildcard probe label). */
  resolved: [] as string[],
}));
vi.mock('node:dns/promises', () => ({
  resolveTxt: async (name: string) => {
    dnsMock.resolved.push(`TXT ${name}`);
    if (dnsMock.errTxt) throw Object.assign(new Error('txt'), { code: dnsMock.errTxt });
    return dnsMock.txt;
  },
  resolve4: async (name: string) => {
    dnsMock.resolved.push(`A ${name}`);
    if (dnsMock.errA) throw Object.assign(new Error('a'), { code: dnsMock.errA });
    return dnsMock.a;
  },
  resolve6: async (name: string) => {
    dnsMock.resolved.push(`AAAA ${name}`);
    if (dnsMock.errAaaa) throw Object.assign(new Error('aaaa'), { code: dnsMock.errAaaa });
    return dnsMock.aaaa;
  },
  resolveCname: async (name: string) => {
    dnsMock.resolved.push(`CNAME ${name}`);
    if (dnsMock.errCname) throw Object.assign(new Error('cname'), { code: dnsMock.errCname });
    return dnsMock.cname;
  },
}));

const SECRET = 'test-session-secret-domains-7777777777';
let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-domains-api-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
  process.env.EXEPAD_META_DB = join(dataDir, 'meta.sqlite');
});
beforeEach(() => {
  // Public-IP auto-detection makes an outbound call — stub it offline so the
  // suite is hermetic (env-provided EXEPAD_PUBLIC_IP short-circuits before this).
  // Per-test, because vitest auto-restores stubbed globals after each test.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no-net'); }));
  // Simulate "behind NAT" so instance detection is deterministic (env or echo,
  // never a stray public NIC IP on the host running the suite).
  __setInterfaceIpForTest(() => null);
  __resetPublicIpCache();
  // Robust reset so a test that throws before its own cleanup can't leak the
  // public-IP env into the next test's auto-activation guard.
  delete process.env.EXEPAD_PUBLIC_IP;
  delete process.env.EXEPAD_PUBLIC_HOST;
  // Reset the DNS mock so a record set by one test can't leak into the next.
  dnsMock.txt = [];
  dnsMock.a = [];
  dnsMock.aaaa = [];
  dnsMock.cname = [];
  dnsMock.errTxt = '';
  dnsMock.errA = '';
  dnsMock.errAaaa = '';
  dnsMock.errCname = '';
  dnsMock.resolved = [];
});
afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  __setInterfaceIpForTest(null); // restore real interface detection
  delete process.env.EXEPAD_META_DB;
  delete process.env.EXEPAD_DATA_DIR;
});

function env(): Env {
  return {
    PLATFORM_BRIDGE_SECRET: SECRET,
    DEPLOY_SECRET: '',
    ENVIRONMENT: 'selfhost',
  } as unknown as Env;
}

function appRouter(): Hono<{ Bindings: Env }> {
  const a = new Hono<{ Bindings: Env }>();
  a.route('/api/domains', domains);
  return a;
}

let seq = 0;
async function makeUser() {
  return createUser(`dom-${seq++}@x.com`, await hashPassword('pw-secret-123'));
}
// Build the operator session-cookie header for a user id (the studio's only
// auth for /api/domains). A freshly-created user is generation 0.
async function pat(ownerId: string): Promise<Record<string, string>> {
  const token = await mintSessionToken(ownerId, undefined, ['admin'], SECRET, 3600, 0);
  return { Cookie: `${PLATFORM_SESSION_COOKIE}=${token}`, 'Content-Type': 'application/json' };
}

function req(app: Hono<{ Bindings: Env }>, method: string, path: string, headers: Record<string, string>, body?: unknown) {
  // Plain-http base URL: a TLS terminator's presence is signalled via
  // X-Forwarded-Proto, which the secure-detection reads (mirrors the real proxy).
  return app.fetch(
    new Request(`http://studio.local${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env(),
  );
}

describe('/api/domains auth gate', () => {
  it('rejects unauthenticated requests', async () => {
    const app = appRouter();
    const res = await app.fetch(new Request('https://studio.local/api/domains'), env());
    expect(res.status).toBe(401);
  });
});

describe('/api/domains registration + validation', () => {
  it('registers a domain (pending) and lists it with instance info', async () => {
    process.env.EXEPAD_PUBLIC_IP = '203.0.113.10';
    const app = appRouter();
    const h = await pat((await makeUser()).id);

    const create = await req(app, 'POST', '/api/domains', h, { target: 'domain', domain: 'app.acme.com' });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { domain: { domain: string; status: string; dnsRecords: unknown[] } };
    expect(created.domain.domain).toBe('app.acme.com');
    expect(created.domain.status).toBe('pending');
    expect(created.domain.dnsRecords.length).toBeGreaterThan(0);

    const list = await req(app, 'GET', '/api/domains', h);
    const body = (await list.json()) as {
      domains: Array<{ domain: string }>;
      instance: { dnsTarget: string; dnsTargetSource: string; tls: { secure: boolean; mode: string } };
    };
    expect(body.domains.some((d) => d.domain === 'app.acme.com')).toBe(true);
    expect(body.instance.dnsTarget).toBe('203.0.113.10');
    expect(body.instance.dnsTargetSource).toBe('ip-env');
    // No X-Forwarded-Proto on this request -> reported as plain HTTP.
    expect(body.instance.tls.secure).toBe(false);
    expect(body.instance.tls.mode).toBe('plain');
    delete process.env.EXEPAD_PUBLIC_IP;
  });

  it('reports HTTPS when the request carries X-Forwarded-Proto: https', async () => {
    const app = appRouter();
    const h = await pat((await makeUser()).id);
    const res = await app.fetch(
      new Request('http://studio.local/api/domains', { headers: { ...h, 'X-Forwarded-Proto': 'https' } }),
      env(),
    );
    const body = (await res.json()) as { instance: { tls: { secure: boolean; mode: string } } };
    expect(body.instance.tls.secure).toBe(true);
    expect(body.instance.tls.mode).toBe('https');
  });

  it('distinguishes "HTTPS active, viewed over HTTP" from "HTTPS disabled"', async () => {
    const app = appRouter();
    const h = await pat((await makeUser()).id);
    type Tls = { secure: boolean; httpsActive: boolean; httpsDisabled: boolean; httpsUrl: string | null };

    // In-process TLS is up, but THIS request came over plain HTTP (e.g. localhost,
    // which isn't auto-redirected) -> nudge to the HTTPS URL, do NOT claim disabled.
    process.env.EXEPAD_TLS_ACTIVE = '1';
    const up = (await (await req(app, 'GET', '/api/domains', h)).json()) as { instance: { tls: Tls } };
    expect(up.instance.tls.secure).toBe(false);
    expect(up.instance.tls.httpsActive).toBe(true);
    expect(up.instance.tls.httpsDisabled).toBe(false);
    expect(up.instance.tls.httpsUrl).toMatch(/^https:\/\/studio\.local/);
    delete process.env.EXEPAD_TLS_ACTIVE;

    // HTTPS genuinely turned off -> report that, with no HTTPS URL to open.
    process.env.EXEPAD_HTTPS_DISABLE = '1';
    const off = (await (await req(app, 'GET', '/api/domains', h)).json()) as { instance: { tls: Tls } };
    expect(off.instance.tls.httpsActive).toBe(false);
    expect(off.instance.tls.httpsDisabled).toBe(true);
    expect(off.instance.tls.httpsUrl).toBeNull();
    delete process.env.EXEPAD_HTTPS_DISABLE;
  });

  it('rejects an invalid domain and a duplicate', async () => {
    const app = appRouter();
    const h = await pat((await makeUser()).id);
    expect((await req(app, 'POST', '/api/domains', h, { target: 'domain', domain: 'not_a_domain' })).status).toBe(400);
    await req(app, 'POST', '/api/domains', h, { target: 'domain', domain: 'dup.acme.com' });
    expect((await req(app, 'POST', '/api/domains', h, { target: 'domain', domain: 'dup.acme.com' })).status).toBe(409);
  });

  it('enforces wildcard rules (auto or dns; not sslip/byoc; cannot pin an app)', async () => {
    const app = appRouter();
    const h = await pat((await makeUser()).id);
    // A wildcard now accepts per-subdomain HTTP-01 (auto) as well as a DNS-01
    // wildcard cert (dns) — both are valid TLS strategies for per-app subdomains.
    expect((await req(app, 'POST', '/api/domains', h, { target: 'domain', domain: '*.w.acme.com', mode: 'auto' })).status).toBe(201);
    expect((await req(app, 'POST', '/api/domains', h, { target: 'domain', domain: '*.w3.acme.com', mode: 'dns' })).status).toBe(201);
    // sslip/byoc are meaningless for a wildcard → rejected.
    expect((await req(app, 'POST', '/api/domains', h, { target: 'domain', domain: '*.w4.acme.com', mode: 'sslip' })).status).toBe(400);
    expect((await req(app, 'POST', '/api/domains', h, { target: 'domain', domain: '*.w5.acme.com', mode: 'byoc' })).status).toBe(400);
    // A wildcard serves an app per subdomain, so it still cannot be pinned to one app.
    expect((await req(app, 'POST', '/api/domains', h, { target: 'domain', domain: '*.w2.acme.com', mode: 'dns', appId: 'x' })).status).toBe(400);
  });

  it("registers a behind-own-proxy domain (routing 'proxied') with a TXT-only record set", async () => {
    // The operator's proxy owns the address record (often a different IP than
    // this box) — advising an A record would show a permanent "Different value".
    process.env.EXEPAD_PUBLIC_IP = '203.0.113.10';
    const app = appRouter();
    const h = await pat((await makeUser()).id);
    const res = await req(app, 'POST', '/api/domains', h, {
      target: 'domain',
      domain: 'proxied.acme.com',
      mode: 'auto',
      routing: 'proxied',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      domain: { routing: string; dnsRecords: Array<{ type: string; name: string }> };
    };
    expect(body.domain.routing).toBe('proxied');
    expect(body.domain.dnsRecords).toHaveLength(1);
    expect(body.domain.dnsRecords[0].type).toBe('TXT');
    expect(body.domain.dnsRecords[0].name).toBe('_exepad-challenge.proxied.acme.com');

    // The live check probes ONLY the TXT record — never the address.
    dnsMock.txt = [['exepad-verify=whatever']];
    const check = await req(app, 'GET', '/api/domains/proxied.acme.com/check', h);
    expect(check.status).toBe(200);
    const checked = (await check.json()) as { records: Array<{ type: string }> };
    expect(checked.records).toHaveLength(1);
    expect(checked.records[0].type).toBe('TXT');
    expect(dnsMock.resolved.every((r) => r.startsWith('TXT '))).toBe(true);
    delete process.env.EXEPAD_PUBLIC_IP;
  });

  it("rejects routing 'proxied' outside a domain+auto registration, and unknown routing values", async () => {
    const app = appRouter();
    const h = await pat((await makeUser()).id);
    // Bare IP: the sslip host is this box by definition — 'proxied' is meaningless.
    expect(
      (await req(app, 'POST', '/api/domains', h, { target: 'ip', ip: '198.51.100.9', routing: 'proxied' })).status,
    ).toBe(400);
    // dns mode does its own issuance — a fronting proxy contradicts it.
    expect(
      (await req(app, 'POST', '/api/domains', h, { target: 'domain', domain: 'p1.acme.com', mode: 'dns', routing: 'proxied' })).status,
    ).toBe(400);
    expect(
      (await req(app, 'POST', '/api/domains', h, { target: 'domain', domain: 'p2.acme.com', routing: 'nonsense' })).status,
    ).toBe(400);
  });

  it('rejects pinning to an app the operator cannot access', async () => {
    const app = appRouter();
    const owner = await makeUser();
    const other = await makeUser();
    const foreignApp = createApp(other.id, 'theirs');
    const h = await pat(owner.id);
    expect((await req(app, 'POST', '/api/domains', h, { target: 'domain', domain: 'pinned.acme.com', appId: foreignApp.id })).status).toBe(403);
  });

  it('registers a bare IP via sslip but does NOT auto-activate without an IP-match proof', async () => {
    // SECURITY: when this box's public IP is unknown (NAT / detection failed),
    // an sslip host must NOT auto-activate — otherwise any attacker-chosen IP's
    // <a-b-c-d>.sslip.io (which deterministically resolves to that IP) would enter
    // the credentialed-CORS + on-demand-TLS sets for a server the operator does
    // not control. It stays pending until the IP is proven to be this box's.
    const app = appRouter();
    const h = await pat((await makeUser()).id);
    const res = await req(app, 'POST', '/api/domains', h, { target: 'ip', ip: '198.51.100.7' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { domain: { domain: string; status: string; mode: string } };
    expect(body.domain.domain).toBe('198-51-100-7.sslip.io');
    expect(body.domain.mode).toBe('sslip');
    expect(body.domain.status).toBe('pending');
  });

  it('auto-activates an sslip host when the IP matches this instance public IP', async () => {
    // Use an IP distinct from the pending-registration test above: registered
    // domains persist across tests in this suite (shared meta.sqlite, no per-test
    // reset), so reusing 198.51.100.7 would 409 as "already registered".
    process.env.EXEPAD_PUBLIC_IP = '198.51.100.9';
    try {
      const app = appRouter();
      const h = await pat((await makeUser()).id);
      const res = await req(app, 'POST', '/api/domains', h, { target: 'ip', ip: '198.51.100.9' });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { domain: { status: string } };
      expect(body.domain.status).toBe('active');
    } finally {
      delete process.env.EXEPAD_PUBLIC_IP;
    }
  });

  it('does NOT auto-activate an sslip IP that differs from this instance public IP', async () => {
    process.env.EXEPAD_PUBLIC_IP = '203.0.113.10';
    const app = appRouter();
    const h = await pat((await makeUser()).id);
    // Mismatch -> stays pending (the box isn't at that IP).
    const miss = await req(app, 'POST', '/api/domains', h, { target: 'ip', ip: '8.8.8.8' });
    expect(((await miss.json()) as { domain: { status: string } }).domain.status).toBe('pending');
    // Match -> active.
    const hit = await req(app, 'POST', '/api/domains', h, { target: 'ip', ip: '203.0.113.10' });
    expect(((await hit.json()) as { domain: { status: string } }).domain.status).toBe('active');
    delete process.env.EXEPAD_PUBLIC_IP;
  });
});

describe('/api/domains verify-then-active', () => {
  it('flips to active only when the TXT challenge matches', async () => {
    const app = appRouter();
    const h = await pat((await makeUser()).id);
    const create = await req(app, 'POST', '/api/domains', h, { target: 'domain', domain: 'verify.acme.com' });
    const token = ((await create.json()) as { domain: { verificationToken: string } }).domain.verificationToken;

    // Wrong TXT → not verified, stays non-active.
    dnsMock.txt = [['exepad-verify=WRONG']];
    const bad = await req(app, 'POST', '/api/domains/verify.acme.com/verify', h);
    const badBody = (await bad.json()) as { verified: boolean; domain: { status: string } };
    expect(badBody.verified).toBe(false);
    expect(badBody.domain.status).not.toBe('active');

    // Correct TXT → verified + active.
    dnsMock.txt = [[`exepad-verify=${token}`]];
    const ok = await req(app, 'POST', '/api/domains/verify.acme.com/verify', h);
    const okBody = (await ok.json()) as { verified: boolean; domain: { status: string } };
    expect(okBody.verified).toBe(true);
    expect(okBody.domain.status).toBe('active');
  });
});

describe('/api/domains patch + delete', () => {
  it('toggles HSTS and removes the domain', async () => {
    const app = appRouter();
    const h = await pat((await makeUser()).id);
    await req(app, 'POST', '/api/domains', h, { target: 'domain', domain: 'edit.acme.com' });

    const patched = await req(app, 'PATCH', '/api/domains/edit.acme.com', h, { hsts: true });
    expect(((await patched.json()) as { domain: { hsts: boolean } }).domain.hsts).toBe(true);

    expect((await req(app, 'DELETE', '/api/domains/edit.acme.com', h)).status).toBe(200);
    expect((await req(app, 'DELETE', '/api/domains/edit.acme.com', h)).status).toBe(404);
  });
});

interface CheckRecord {
  type: 'A' | 'CNAME' | 'TXT';
  name: string;
  expected: string;
  observed: string[];
  state: 'ok' | 'mismatch' | 'missing' | 'error' | 'skipped';
}

describe('/api/domains/:domain/check (live DNS signals)', () => {
  // Register a domain at a known instance IP and return the TXT challenge value.
  async function setup(app: Hono<{ Bindings: Env }>, h: Record<string, string>, domain: string) {
    process.env.EXEPAD_PUBLIC_IP = '203.0.113.10';
    __resetPublicIpCache();
    const create = await req(app, 'POST', '/api/domains', h, { target: 'domain', domain });
    const body = (await create.json()) as { domain: { challenge: { value: string } } };
    return body.domain.challenge.value; // exepad-verify=<token>
  }
  async function check(app: Hono<{ Bindings: Env }>, h: Record<string, string>, domain: string) {
    const res = await req(app, 'GET', `/api/domains/${domain}/check`, h);
    return (await res.json()) as { success: boolean; records: CheckRecord[] };
  }
  const byType = (recs: CheckRecord[], t: string) => recs.find((r) => r.type === t)!;

  it('reports A + TXT as ok when both records are live and correct', async () => {
    const app = appRouter();
    const h = await pat((await makeUser()).id);
    const txtValue = await setup(app, h, 'check-ok.acme.com');
    dnsMock.a = ['203.0.113.10'];
    dnsMock.txt = [[txtValue]];

    const body = await check(app, h, 'check-ok.acme.com');
    expect(body.success).toBe(true);
    expect(byType(body.records, 'A').state).toBe('ok');
    expect(byType(body.records, 'TXT').state).toBe('ok');
  });

  it('reports a missing A record as missing (NXDOMAIN) while TXT is ok', async () => {
    const app = appRouter();
    const h = await pat((await makeUser()).id);
    const txtValue = await setup(app, h, 'check-missing.acme.com');
    dnsMock.errA = 'ENOTFOUND';
    dnsMock.txt = [[txtValue]];

    const body = await check(app, h, 'check-missing.acme.com');
    expect(byType(body.records, 'A').state).toBe('missing');
    expect(byType(body.records, 'TXT').state).toBe('ok');
  });

  it('reports a wrong A record as mismatch and surfaces the observed value', async () => {
    const app = appRouter();
    const h = await pat((await makeUser()).id);
    await setup(app, h, 'check-wrong.acme.com');
    dnsMock.a = ['9.9.9.9'];

    const body = await check(app, h, 'check-wrong.acme.com');
    const a = byType(body.records, 'A');
    expect(a.state).toBe('mismatch');
    expect(a.observed).toContain('9.9.9.9');
  });

  it('404s for a domain the operator does not own', async () => {
    const app = appRouter();
    const h = await pat((await makeUser()).id);
    const res = await req(app, 'GET', '/api/domains/not-mine.acme.com/check', h);
    expect(res.status).toBe(404);
  });

  it('probes a synthetic sub-label for a wildcard A record (not the literal *. name)', async () => {
    process.env.EXEPAD_PUBLIC_IP = '203.0.113.10';
    __resetPublicIpCache();
    const app = appRouter();
    const h = await pat((await makeUser()).id);
    // Wildcards must be registered in dns mode.
    await req(app, 'POST', '/api/domains', h, { target: 'domain', domain: '*.apps.acme.com', mode: 'dns' });
    dnsMock.a = ['203.0.113.10'];

    const res = await req(app, 'GET', '/api/domains/*.apps.acme.com/check', h);
    const body = (await res.json()) as { records: CheckRecord[] };
    const a = body.records.find((r) => r.type === 'A')!;
    // Displayed name stays the wildcard, but the live A record reaches "ok" (not stuck
    // on "missing"), proving we resolved a covered sub-label rather than the literal *.
    expect(a.name).toBe('*.apps.acme.com');
    expect(a.state).toBe('ok');
    expect(dnsMock.resolved).toContain('A exepad-probe.apps.acme.com');
    expect(dnsMock.resolved).not.toContain('A *.apps.acme.com');
  });

  it('matches an IPv6 instance target via AAAA, not A', async () => {
    process.env.EXEPAD_PUBLIC_IP = '2001:db8::1';
    __resetPublicIpCache();
    const app = appRouter();
    const h = await pat((await makeUser()).id);
    await req(app, 'POST', '/api/domains', h, { target: 'domain', domain: 'v6.acme.com' });
    dnsMock.aaaa = ['2001:db8::1'];

    const res = await req(app, 'GET', '/api/domains/v6.acme.com/check', h);
    const body = (await res.json()) as { records: CheckRecord[] };
    const a = body.records.find((r) => r.type === 'A')!;
    expect(a.state).toBe('ok');
    expect(dnsMock.resolved).toContain('AAAA v6.acme.com');
  });
});
