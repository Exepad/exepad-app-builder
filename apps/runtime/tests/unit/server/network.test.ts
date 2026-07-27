// @vitest-environment node
/**
 * Server & networking settings — the runtime-tunable network knobs.
 *
 *   - net-config precedence: store override wins, env is the seed, clearing reverts
 *   - origin.ts honors a saved allowlist / strict-local-CORS flag with NO restart
 *     (the credentialed-CORS trust boundary must track the live override)
 *   - GET/PUT /api/network: auth guard, validation (reject bad origin/IP/host),
 *     persistence + provenance, and that a saved value is reflected effective-side
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setSettings, createUser, getSetting } from '../../../worker/src/lib/meta-db';
import { hashPassword } from '../../../worker/src/lib/password';
import { mintSessionToken, PLATFORM_SESSION_COOKIE } from '../../../worker/src/routes/gateway/auth';
import { network as networkRoute } from '../../../worker/src/routes/network';
import {
  NET_KEYS,
  effectiveNet,
  effectivePublicHost,
  effectivePublicIp,
  effectiveAllowedOriginsRaw,
  effectiveStrictLocalCors,
  effectiveHttpPort,
  effectiveHttpsPort,
  effectiveAppsPort,
  effectiveStudioPort,
  effectiveAllowIpAccess,
  effectiveHttpsDisable,
  effectiveCookieSecure,
  __resetNetConfigCache,
} from '../../../worker/src/lib/net-config';
import { resolveAllowedOrigin } from '../../../worker/src/lib/origin';
import {
  __setInterfaceIpForTest,
  __resetPublicIpCache,
} from '../../../worker/src/lib/public-address';
import type { Env } from '../../../worker/src/types/env';

const SECRET = 'test-session-secret-network-12345678';
let dataDir: string;

// Every net.* key's env seed, so each test starts from a clean baseline.
const NET_ENV = Object.values(NET_KEYS).map((k) => k.env);
const NET_STORE_KEYS = Object.values(NET_KEYS).map((k) => k.key);

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-network-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
  process.env.EXEPAD_META_DB = join(dataDir, 'meta.sqlite');
  // Deterministic public IP on the "NIC" so the route's resolveInstanceTarget
  // never makes a real outbound echo call during tests.
  __setInterfaceIpForTest(() => '203.0.113.5');
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  __setInterfaceIpForTest(null);
  __resetPublicIpCache();
  for (const k of NET_ENV) delete process.env[k];
});

beforeEach(() => {
  // Clear both store + env between tests so each starts from a known baseline.
  const clear: Record<string, null> = {};
  for (const k of NET_STORE_KEYS) clear[k] = null;
  setSettings(clear);
  for (const k of NET_ENV) delete process.env[k];
  __resetNetConfigCache();
});

function env(): Env {
  return { PLATFORM_BRIDGE_SECRET: SECRET } as unknown as Env;
}

async function authedCookie(): Promise<string> {
  const user = createUser(`net-${Math.random().toString(36).slice(2)}@x.com`, await hashPassword('pw'));
  const token = await mintSessionToken(user.id, user.email, ['admin'], SECRET);
  return `${PLATFORM_SESSION_COOKIE}=${token}`;
}

// ─── net-config precedence ──────────────────────────────────────────────────--

describe('net-config — store overrides env seed', () => {
  it('uses the env seed when the store is empty', () => {
    process.env.EXEPAD_PUBLIC_HOST = 'env.example.com';
    __resetNetConfigCache();
    expect(effectivePublicHost()).toBe('env.example.com');
    expect(effectiveNet(NET_KEYS.publicHost).source).toBe('env');
  });

  it('lets a saved override win over the env seed', () => {
    process.env.EXEPAD_PUBLIC_HOST = 'env.example.com';
    setSettings({ [NET_KEYS.publicHost.key]: 'store.example.com' });
    expect(effectivePublicHost()).toBe('store.example.com');
    expect(effectiveNet(NET_KEYS.publicHost).source).toBe('store');
  });

  it('reverts to the env seed when the override is cleared to empty', () => {
    process.env.EXEPAD_PUBLIC_IP = '198.51.100.7';
    setSettings({ [NET_KEYS.publicIp.key]: '' }); // '' = cleared → seed applies
    expect(effectivePublicIp()).toBe('198.51.100.7');
    expect(effectiveNet(NET_KEYS.publicIp).source).toBe('env');
  });

  it('reports source none when neither store nor env is set', () => {
    expect(effectivePublicHost()).toBe('');
    expect(effectiveNet(NET_KEYS.publicHost).source).toBe('none');
  });

  it('parses the strict-local-CORS flag from the store', () => {
    expect(effectiveStrictLocalCors()).toBe(false);
    setSettings({ [NET_KEYS.strictLocalCors.key]: '1' });
    expect(effectiveStrictLocalCors()).toBe(true);
    setSettings({ [NET_KEYS.strictLocalCors.key]: '0' });
    expect(effectiveStrictLocalCors()).toBe(false);
  });
});

// ─── net-config boot knobs (read by server/main.ts at STARTUP) ───────────────--
// These socket knobs are no longer editable from the UI, but the runtime still
// resolves them at boot from the store-over-env chain, so keep that path covered.

describe('net-config — boot knobs resolve store-over-env, else default', () => {
  it('reads the HTTP/HTTPS ports from env and lets a stored override win', () => {
    process.env.PORT = '8080';
    process.env.EXEPAD_HTTPS_PORT = '8443';
    __resetNetConfigCache();
    expect(effectiveHttpPort()).toBe(8080);
    expect(effectiveHttpsPort()).toBe(8443);
    setSettings({ [NET_KEYS.httpPort.key]: '9090', [NET_KEYS.httpsPort.key]: '9443' });
    expect(effectiveHttpPort()).toBe(9090);
    expect(effectiveHttpsPort()).toBe(9443);
  });

  it('falls back to the defaults when neither store nor env pins a port', () => {
    expect(effectiveHttpPort()).toBe(8080); // DEFAULT_HTTP_PORT
    expect(effectiveHttpsPort()).toBe(8443); // DEFAULT_HTTPS_PORT
  });

  it('parses the HTTPS-disable + cookie-secure booleans (store over env)', () => {
    expect(effectiveHttpsDisable()).toBe(false);
    expect(effectiveCookieSecure()).toBe(false);
    setSettings({ [NET_KEYS.httpsDisable.key]: '1', [NET_KEYS.cookieSecure.key]: '1' });
    expect(effectiveHttpsDisable()).toBe(true);
    expect(effectiveCookieSecure()).toBe(true);
  });

  it('auto-heals a browser-blocked saved port: skips it, falls through to env then default', () => {
    process.env.EXEPAD_HTTPS_PORT = '9000'; // safe env seed
    setSettings({ [NET_KEYS.httpsPort.key]: '6000' }); // browser-blocked (X11)
    __resetNetConfigCache();
    // Store 6000 is unreachable → skipped → the safe env seed wins.
    expect(effectiveHttpsPort()).toBe(9000);
    // …and with no safe env either, it falls all the way to the default.
    delete process.env.EXEPAD_HTTPS_PORT;
    __resetNetConfigCache();
    expect(effectiveHttpsPort()).toBe(8443); // DEFAULT_HTTPS_PORT
  });

  it('auto-heals an out-of-range or non-numeric saved port too', () => {
    setSettings({ [NET_KEYS.httpPort.key]: '70000' }); // out of range
    __resetNetConfigCache();
    expect(effectiveHttpPort()).toBe(8080); // DEFAULT_HTTP_PORT
    setSettings({ [NET_KEYS.httpPort.key]: 'nope' });
    __resetNetConfigCache();
    expect(effectiveHttpPort()).toBe(8080);
  });
});

// ─── net-config two-port front (managed in-image Caddy) ──────────────────────--
// The front splits into an APPS port (every published app subdomain) and a STUDIO
// port (the admin studio). Studio defaults to the apps port (one unified listener);
// the legacy single net.https_port knob seeds the apps port after upgrade.

describe('net-config — two-port front (apps + studio)', () => {
  it('defaults both ports to DEFAULT_HTTPS_PORT; studio tracks the apps port', () => {
    expect(effectiveAppsPort()).toBe(8443);
    expect(effectiveStudioPort()).toBe(8443);
  });

  it('takes the net.apps_port override; studio stays unified with it', () => {
    setSettings({ [NET_KEYS.appsPort.key]: '443' });
    __resetNetConfigCache();
    expect(effectiveAppsPort()).toBe(443);
    expect(effectiveStudioPort()).toBe(443);
  });

  it('lets the studio port differ from the apps port (split)', () => {
    setSettings({ [NET_KEYS.appsPort.key]: '443', [NET_KEYS.studioPort.key]: '9000' });
    __resetNetConfigCache();
    expect(effectiveAppsPort()).toBe(443);
    expect(effectiveStudioPort()).toBe(9000);
  });

  it('seeds the apps port from the legacy net.https_port; a new override wins', () => {
    setSettings({ [NET_KEYS.httpsPort.key]: '9000' }); // old single-front knob
    __resetNetConfigCache();
    expect(effectiveAppsPort()).toBe(9000);
    expect(effectiveStudioPort()).toBe(9000); // still unified
    setSettings({ [NET_KEYS.appsPort.key]: '8443' }); // new key wins over legacy
    __resetNetConfigCache();
    expect(effectiveAppsPort()).toBe(8443);
  });

  it('reads the env seeds and the EXEPAD_HTTPS_PORT legacy apps fallback', () => {
    process.env.EXEPAD_APPS_PORT = '443';
    process.env.EXEPAD_STUDIO_PORT = '9000';
    __resetNetConfigCache();
    expect(effectiveAppsPort()).toBe(443);
    expect(effectiveStudioPort()).toBe(9000);
    delete process.env.EXEPAD_APPS_PORT;
    delete process.env.EXEPAD_STUDIO_PORT;
    process.env.EXEPAD_HTTPS_PORT = '443';
    __resetNetConfigCache();
    expect(effectiveAppsPort()).toBe(443); // legacy env seed
  });

  it('auto-heals a browser-blocked apps/studio port', () => {
    process.env.EXEPAD_APPS_PORT = '443';
    setSettings({ [NET_KEYS.appsPort.key]: '6000' }); // X11 → skipped → env seed wins
    __resetNetConfigCache();
    expect(effectiveAppsPort()).toBe(443);
    setSettings({ [NET_KEYS.studioPort.key]: '22' }); // SSH → skipped → tracks apps port
    __resetNetConfigCache();
    expect(effectiveStudioPort()).toBe(443);
  });

  it('parses the direct-IP-access flag (default off, store/env over)', () => {
    expect(effectiveAllowIpAccess()).toBe(false);
    setSettings({ [NET_KEYS.allowIpAccess.key]: '1' });
    __resetNetConfigCache();
    expect(effectiveAllowIpAccess()).toBe(true);
    setSettings({ [NET_KEYS.allowIpAccess.key]: '0' });
    __resetNetConfigCache();
    expect(effectiveAllowIpAccess()).toBe(false);
  });
});

// ─── origin.ts honors the live override ─────────────────────────────────────--

describe('origin.ts — dynamic allowlist + strict-local-CORS (no restart)', () => {
  it('rejects an unlisted origin, then accepts it once saved to the store', () => {
    expect(resolveAllowedOrigin('https://app.company.com')).toBeNull();
    setSettings({ [NET_KEYS.allowedOrigins.key]: 'https://app.company.com' });
    expect(resolveAllowedOrigin('https://app.company.com')).toBe('https://app.company.com');
    expect(effectiveAllowedOriginsRaw()).toBe('https://app.company.com');
  });

  it('honors a wildcard entry saved to the store', () => {
    setSettings({ [NET_KEYS.allowedOrigins.key]: '*.company.com' });
    expect(resolveAllowedOrigin('https://intranet.company.com')).toBe('https://intranet.company.com');
    // Suffix confusion is still rejected.
    expect(resolveAllowedOrigin('https://company.com.evil.io')).toBeNull();
  });

  it('drops loopback reflection when strict-local-CORS is turned on', () => {
    // Default: loopback dev origin is reflected.
    expect(resolveAllowedOrigin('http://localhost:3001')).toBe('http://localhost:3001');
    setSettings({
      [NET_KEYS.strictLocalCors.key]: '1',
      [NET_KEYS.allowedOrigins.key]: 'https://app.company.com',
    });
    expect(resolveAllowedOrigin('http://localhost:3001')).toBeNull();
    // The toggle drops ONLY the loopback reflection — an explicitly allowlisted
    // origin is unaffected. (This used to assert against a built-in exepad.com
    // origin; those are cloud-only now, so the operator allowlist is the right
    // subject for a self-host test. See origin.ts's isSelfHost gate.)
    expect(resolveAllowedOrigin('https://app.company.com')).toBe('https://app.company.com');
  });
});

// ─── GET /api/network ───────────────────────────────────────────────────────--

describe('GET /api/network', () => {
  it('requires auth', async () => {
    const res = await networkRoute.fetch(new Request('https://host/'), env());
    expect(res.status).toBe(401);
  });

  interface ServerBlock {
    portKind: 'https' | 'http';
    frontPort: number;
    configuredPort: number;
    portSource: string;
    pendingRestart: boolean;
    editable: boolean;
    tlsFronted: boolean;
    cookieSecure?: unknown;
  }
  async function getServer(): Promise<ServerBlock> {
    const cookie = await authedCookie();
    const res = await networkRoute.fetch(
      new Request('https://host/', { headers: { Cookie: cookie } }),
      env(),
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as { network: { server: ServerBlock } }).network.server;
  }

  it('reports the plain-HTTP front port when in-process TLS is not active', async () => {
    process.env.EXEPAD_ALLOWED_ORIGINS = 'https://seed.example.com';
    process.env.PORT = '9000';
    delete process.env.EXEPAD_TLS_ACTIVE;
    __resetNetConfigCache();
    const cookie = await authedCookie();
    const res = await networkRoute.fetch(
      new Request('https://host/', { headers: { Cookie: cookie } }),
      env(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      network: {
        server: ServerBlock;
        publicAddress: { detected: { value: string | null; source: string } };
        cors: { allowedOrigins: string[]; allowedOriginsSource: string };
        ipConfig?: unknown;
        interfaces?: unknown;
      };
    };
    const s = body.network.server;
    // With HTTPS off, the front door is plain HTTP on PORT (the env seed → 9000).
    expect(s.portKind).toBe('http');
    expect(s.configuredPort).toBe(9000);
    expect(s.frontPort).toBe(9000);
    expect(s.portSource).toBe('env');
    expect(s.pendingRestart).toBe(false);
    expect(s.editable).toBe(true);
    expect(s.tlsFronted).toBe(false);
    // The retired cookie-secure readout is gone entirely.
    expect('cookieSecure' in s).toBe(false);
    // The IP / DHCP / interfaces surface is gone entirely.
    expect('ipConfig' in body.network).toBe(false);
    expect('interfaces' in body.network).toBe(false);
    // The forced NIC IP means detection resolves without any outbound call.
    expect(body.network.publicAddress.detected.value).toBe('203.0.113.5');
    expect(body.network.publicAddress.detected.source).toBe('interface');
    // Env seed surfaces through the effective list.
    expect(body.network.cors.allowedOrigins).toContain('https://seed.example.com');
    expect(body.network.cors.allowedOriginsSource).toBe('env');
  });

  it('reports the HTTPS front port (e.g. :443) when TLS terminates in-process', async () => {
    process.env.EXEPAD_TLS_ACTIVE = '1';
    process.env.EXEPAD_HTTPS_REDIRECT_PORT = '443';
    process.env.EXEPAD_HTTPS_PORT = '443';
    __resetNetConfigCache();
    const s = await getServer();
    expect(s.portKind).toBe('https');
    expect(s.frontPort).toBe(443);
    expect(s.configuredPort).toBe(443);
    expect(s.portSource).toBe('env');
    expect(s.pendingRestart).toBe(false);
    expect(s.editable).toBe(true);
    delete process.env.EXEPAD_TLS_ACTIVE;
    delete process.env.EXEPAD_HTTPS_REDIRECT_PORT;
  });

  it('flags a pending restart when a saved HTTPS port differs from the running one', async () => {
    process.env.EXEPAD_TLS_ACTIVE = '1';
    process.env.EXEPAD_HTTPS_REDIRECT_PORT = '443'; // running now
    setSettings({ [NET_KEYS.httpsPort.key]: '9000' }); // configured (applies on restart)
    __resetNetConfigCache();
    const s = await getServer();
    expect(s.portKind).toBe('https');
    expect(s.frontPort).toBe(443);
    expect(s.configuredPort).toBe(9000);
    expect(s.portSource).toBe('store');
    expect(s.pendingRestart).toBe(true);
    delete process.env.EXEPAD_TLS_ACTIVE;
    delete process.env.EXEPAD_HTTPS_REDIRECT_PORT;
  });

  it('marks the front port read-only when a proxy terminates TLS in front', async () => {
    process.env.EXEPAD_TLS_FRONTED = '1';
    __resetNetConfigCache();
    const s = await getServer();
    expect(s.editable).toBe(false);
    expect(s.tlsFronted).toBe(true);
    delete process.env.EXEPAD_TLS_FRONTED;
  });
});

// ─── GET /api/network — two-port split (managed container) ───────────────────--

describe('GET /api/network — apps + studio front split', () => {
  interface FrontPort {
    configuredPort: number;
    runningPort: number;
    pendingRestart: boolean;
  }
  interface SplitServer {
    managedTls: boolean;
    apps: FrontPort;
    studio: FrontPort;
  }
  async function getSplit(): Promise<SplitServer> {
    const cookie = await authedCookie();
    const res = await networkRoute.fetch(
      new Request('https://host/', { headers: { Cookie: cookie } }),
      env(),
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as { network: { server: SplitServer } }).network.server;
  }

  it('reports the running apps + studio ports from the entrypoint env', async () => {
    process.env.EXEPAD_MANAGED_TLS = '1';
    process.env.EXEPAD_TLS_FRONTED = '1';
    process.env.EXEPAD_APPS_PORT = '443';
    process.env.EXEPAD_STUDIO_PORT = '9000';
    __resetNetConfigCache();
    const s = await getSplit();
    expect(s.managedTls).toBe(true);
    expect(s.apps.runningPort).toBe(443);
    expect(s.studio.runningPort).toBe(9000);
    expect(s.apps.configuredPort).toBe(443);
    expect(s.studio.configuredPort).toBe(9000);
    expect(s.apps.pendingRestart).toBe(false);
    expect(s.studio.pendingRestart).toBe(false);
    delete process.env.EXEPAD_MANAGED_TLS;
    delete process.env.EXEPAD_TLS_FRONTED;
  });

  it('flags a pending studio restart when a saved split differs from the running unified port', async () => {
    process.env.EXEPAD_MANAGED_TLS = '1';
    process.env.EXEPAD_APPS_PORT = '443'; // running (unified)
    process.env.EXEPAD_STUDIO_PORT = '443'; // running (unified)
    setSettings({ [NET_KEYS.studioPort.key]: '9000' }); // configured split → applies on restart
    __resetNetConfigCache();
    const s = await getSplit();
    expect(s.studio.configuredPort).toBe(9000);
    expect(s.studio.runningPort).toBe(443);
    expect(s.studio.pendingRestart).toBe(true);
    expect(s.apps.pendingRestart).toBe(false);
    delete process.env.EXEPAD_MANAGED_TLS;
  });

  it('reports direct-IP-access allowed + a pending restart when it differs from the running flag', async () => {
    process.env.EXEPAD_MANAGED_TLS = '1';
    // Running flag is OFF (env unset); operator has saved it ON → pending.
    setSettings({ [NET_KEYS.allowIpAccess.key]: '1' });
    __resetNetConfigCache();
    const cookie = await authedCookie();
    const res = await networkRoute.fetch(
      new Request('https://host/', { headers: { Cookie: cookie } }),
      env(),
    );
    const ip = ((await res.json()) as {
      network: { server: { ipAccess: { allowed: boolean; pendingRestart: boolean } } };
    }).network.server.ipAccess;
    expect(ip.allowed).toBe(true);
    expect(ip.pendingRestart).toBe(true);
    delete process.env.EXEPAD_MANAGED_TLS;
  });
});

// ─── PUT /api/network ───────────────────────────────────────────────────────--

async function put(cookie: string, payload: unknown): Promise<Response> {
  return networkRoute.fetch(
    new Request('https://host/', {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    env(),
  );
}

describe('PUT /api/network', () => {
  it('requires auth', async () => {
    const res = await networkRoute.fetch(
      new Request('https://host/', { method: 'PUT', body: '{}' }),
      env(),
    );
    expect(res.status).toBe(401);
  });

  it('persists a valid public host + IP override', async () => {
    const cookie = await authedCookie();
    const res = await put(cookie, { publicHost: 'box.dyndns.example', publicIp: '198.51.100.9' });
    expect(res.status).toBe(200);
    expect(getSetting(NET_KEYS.publicHost.key)).toBe('box.dyndns.example');
    expect(getSetting(NET_KEYS.publicIp.key)).toBe('198.51.100.9');
  });

  it('rejects a malformed hostname', async () => {
    const cookie = await authedCookie();
    const res = await put(cookie, { publicHost: 'http://not a host/' });
    expect(res.status).toBe(400);
    expect(getSetting(NET_KEYS.publicHost.key)).toBeNull();
  });

  it('rejects a non-IPv4 public IP', async () => {
    const cookie = await authedCookie();
    const res = await put(cookie, { publicIp: '999.1.2.3' });
    expect(res.status).toBe(400);
  });

  it('normalizes and stores a valid allowed-origins list', async () => {
    const cookie = await authedCookie();
    const res = await put(cookie, {
      allowedOrigins: ['https://App.Company.com/', '192.168.1.10:8080', '*.lan.local'],
    });
    expect(res.status).toBe(200);
    // Full origins are lowercased + path-stripped; entries stored comma-joined.
    const stored = getSetting(NET_KEYS.allowedOrigins.key) ?? '';
    expect(stored).toContain('https://app.company.com');
    expect(stored).toContain('192.168.1.10:8080');
    expect(stored).toContain('*.lan.local');
    // …and the CORS boundary honors them immediately.
    expect(resolveAllowedOrigin('https://app.company.com')).toBe('https://app.company.com');
  });

  it('rejects an allowed-origins entry with a path or bad scheme', async () => {
    const cookie = await authedCookie();
    expect((await put(cookie, { allowedOrigins: ['https://app.company.com/admin'] })).status).toBe(400);
    expect((await put(cookie, { allowedOrigins: ['ftp://app.company.com'] })).status).toBe(400);
    expect((await put(cookie, { allowedOrigins: ['not a host'] })).status).toBe(400);
  });

  it('persists the strict-local-CORS toggle', async () => {
    const cookie = await authedCookie();
    const res = await put(cookie, { strictLocalCors: true });
    expect(res.status).toBe(200);
    expect(getSetting(NET_KEYS.strictLocalCors.key)).toBe('1');
    expect(effectiveStrictLocalCors()).toBe(true);
  });

  it('clears an override to empty, reverting to the env seed', async () => {
    process.env.EXEPAD_PUBLIC_HOST = 'seed.example.com';
    setSettings({ [NET_KEYS.publicHost.key]: 'override.example.com' });
    expect(effectivePublicHost()).toBe('override.example.com');
    const cookie = await authedCookie();
    const res = await put(cookie, { publicHost: '' });
    expect(res.status).toBe(200);
    expect(effectivePublicHost()).toBe('seed.example.com');
    expect(effectiveNet(NET_KEYS.publicHost).source).toBe('env');
  });

  it('persists a valid studio HTTP port (applies on restart)', async () => {
    const cookie = await authedCookie();
    const res = await put(cookie, { httpPort: 9000 });
    expect(res.status).toBe(200);
    expect(getSetting(NET_KEYS.httpPort.key)).toBe('9000');
    expect(effectiveHttpPort()).toBe(9000);
  });

  it('persists a valid studio HTTPS port (the in-process TLS front port)', async () => {
    const cookie = await authedCookie();
    const res = await put(cookie, { httpsPort: 9000 });
    expect(res.status).toBe(200);
    expect(getSetting(NET_KEYS.httpsPort.key)).toBe('9000');
    expect(effectiveHttpsPort()).toBe(9000);
  });

  it('rejects a browser-blocked port (e.g. 6000 = X11) on either knob', async () => {
    const cookie = await authedCookie();
    const httpsRes = await put(cookie, { httpsPort: 6000 });
    expect(httpsRes.status).toBe(400);
    expect((await httpsRes.json() as { error: string }).error).toMatch(/blocked by web browsers/i);
    expect((await put(cookie, { httpPort: 22 })).status).toBe(400); // SSH
    // Nothing persisted from the rejected writes.
    expect(getSetting(NET_KEYS.httpsPort.key)).toBeNull();
    expect(getSetting(NET_KEYS.httpPort.key)).toBeNull();
    // A safe port still goes through.
    expect((await put(cookie, { httpsPort: 9000 })).status).toBe(200);
    expect(getSetting(NET_KEYS.httpsPort.key)).toBe('9000');
  });

  it('rejects an out-of-range HTTPS port and clears it to empty (reverts to seed)', async () => {
    process.env.EXEPAD_HTTPS_PORT = '443';
    const cookie = await authedCookie();
    expect((await put(cookie, { httpsPort: 70000 })).status).toBe(400);
    expect((await put(cookie, { httpsPort: 8443 })).status).toBe(200);
    expect(effectiveHttpsPort()).toBe(8443);
    // '' clears the override → back to the EXEPAD_HTTPS_PORT env seed.
    expect((await put(cookie, { httpsPort: '' })).status).toBe(200);
    expect(effectiveHttpsPort()).toBe(443);
    expect(effectiveNet(NET_KEYS.httpsPort).source).toBe('env');
  });

  it('accepts a numeric-string port and rejects an out-of-range one', async () => {
    const cookie = await authedCookie();
    expect((await put(cookie, { httpPort: '3001' })).status).toBe(200);
    expect(getSetting(NET_KEYS.httpPort.key)).toBe('3001');
    expect((await put(cookie, { httpPort: 70000 })).status).toBe(400);
    expect((await put(cookie, { httpPort: 0 })).status).toBe(400);
    expect((await put(cookie, { httpPort: 'abc' })).status).toBe(400);
    // The bad writes didn't clobber the last good value.
    expect(getSetting(NET_KEYS.httpPort.key)).toBe('3001');
  });

  it('clears the port override to empty, reverting to the PORT env seed', async () => {
    process.env.PORT = '8080';
    setSettings({ [NET_KEYS.httpPort.key]: '9000' });
    expect(effectiveHttpPort()).toBe(9000);
    const cookie = await authedCookie();
    const res = await put(cookie, { httpPort: '' });
    expect(res.status).toBe(200);
    expect(effectiveHttpPort()).toBe(8080);
    expect(effectiveNet(NET_KEYS.httpPort).source).toBe('env');
  });

  it('persists apps + studio front ports (managed split)', async () => {
    const cookie = await authedCookie();
    const res = await put(cookie, { appsPort: 443, studioPort: 9000 });
    expect(res.status).toBe(200);
    expect(getSetting(NET_KEYS.appsPort.key)).toBe('443');
    expect(getSetting(NET_KEYS.studioPort.key)).toBe('9000');
    expect(effectiveAppsPort()).toBe(443);
    expect(effectiveStudioPort()).toBe(9000);
  });

  it('rejects a browser-blocked apps or studio port (nothing persisted)', async () => {
    const cookie = await authedCookie();
    expect((await put(cookie, { appsPort: 6000 })).status).toBe(400); // X11
    expect((await put(cookie, { studioPort: 22 })).status).toBe(400); // SSH
    expect(getSetting(NET_KEYS.appsPort.key)).toBeNull();
    expect(getSetting(NET_KEYS.studioPort.key)).toBeNull();
  });

  it('rejects reserved in-container ports (80, PORT, AGENT_PORT) on a front-port knob', async () => {
    // PORT is cleared by beforeEach and AGENT_PORT is unset, so reservedFrontPorts()
    // uses its 8080/8081 defaults.
    const cookie = await authedCookie();
    // 80 collides with Caddy's baked :80 block → duplicate site → crash-loop.
    const r80 = await put(cookie, { appsPort: 80 });
    expect(r80.status).toBe(400);
    expect((await r80.json() as { error: string }).error).toMatch(/reserved|HTTP/i);
    // The Node runtime + agent ports would bind-conflict.
    expect((await put(cookie, { studioPort: 8080 })).status).toBe(400);
    expect((await put(cookie, { httpsPort: 8081 })).status).toBe(400);
    // Nothing persisted from the rejected writes.
    expect(getSetting(NET_KEYS.appsPort.key)).toBeNull();
    expect(getSetting(NET_KEYS.studioPort.key)).toBeNull();
    expect(getSetting(NET_KEYS.httpsPort.key)).toBeNull();
    // A safe front port still goes through.
    expect((await put(cookie, { appsPort: 443 })).status).toBe(200);
    expect(getSetting(NET_KEYS.appsPort.key)).toBe('443');
  });

  it('clears the studio port override to re-unify with the apps port', async () => {
    setSettings({ [NET_KEYS.appsPort.key]: '443', [NET_KEYS.studioPort.key]: '9000' });
    expect(effectiveStudioPort()).toBe(9000);
    const cookie = await authedCookie();
    const res = await put(cookie, { studioPort: '' });
    expect(res.status).toBe(200);
    expect(effectiveStudioPort()).toBe(443); // reverts to the apps port (unified)
  });

  it('persists the direct-IP-access toggle and rejects a non-boolean', async () => {
    const cookie = await authedCookie();
    expect((await put(cookie, { allowIpAccess: true })).status).toBe(200);
    expect(getSetting(NET_KEYS.allowIpAccess.key)).toBe('1');
    expect(effectiveAllowIpAccess()).toBe(true);
    expect((await put(cookie, { allowIpAccess: false })).status).toBe(200);
    expect(getSetting(NET_KEYS.allowIpAccess.key)).toBe('0');
    expect((await put(cookie, { allowIpAccess: 'yes' as unknown as boolean })).status).toBe(400);
  });

  it('ignores retired socket / IP knobs sent in the body (no longer editable)', async () => {
    const cookie = await authedCookie();
    // These fields used to persist; the panel now only edits the front HTTP/HTTPS
    // port, so the route drops them as unknown keys (200, nothing stored).
    const res = await put(cookie, {
      httpsDisabled: true,
      cookieSecure: false,
      ipMode: 'static',
      staticIp: '192.168.1.50',
    });
    expect(res.status).toBe(200);
    expect(getSetting('net.https_disable')).toBeNull();
    expect(getSetting('net.cookie_secure')).toBeNull();
    expect(getSetting('net.ip_mode')).toBeNull();
    expect(getSetting('net.static_ip')).toBeNull();
  });
});

