// @vitest-environment node
/**
 * isOnDemandTlsAuthorized — the on-demand-TLS `ask` decision behind the default
 * Caddy ingress. It must green-light THIS box's own addresses (so HTTPS works
 * for localhost/LAN/IP/sslip out of the box) while still refusing a stranger's
 * SNI (the Let's Encrypt rate-limit abuse guard).
 *
 * Registered-domain authorization is covered by domains-api.test.ts; here we
 * isolate the computed self-identity branches, which need no meta.sqlite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isOnDemandTlsAuthorized } from '../../../worker/src/lib/custom-domains';
import { __resetPublicIpCache, __setInterfaceIpForTest } from '../../../worker/src/lib/public-address';

const SAVED = { ip: process.env.EXEPAD_PUBLIC_IP, host: process.env.EXEPAD_PUBLIC_HOST };

beforeEach(() => {
  // Pin "behind NAT" so a real NIC IP on the test host can't leak into the
  // computed public identity; tests set EXEPAD_PUBLIC_IP explicitly.
  __setInterfaceIpForTest(() => null);
  __resetPublicIpCache();
  delete process.env.EXEPAD_PUBLIC_IP;
  delete process.env.EXEPAD_PUBLIC_HOST;
});
afterEach(() => {
  __setInterfaceIpForTest(null);
  if (SAVED.ip == null) delete process.env.EXEPAD_PUBLIC_IP;
  else process.env.EXEPAD_PUBLIC_IP = SAVED.ip;
  if (SAVED.host == null) delete process.env.EXEPAD_PUBLIC_HOST;
  else process.env.EXEPAD_PUBLIC_HOST = SAVED.host;
});

describe('isOnDemandTlsAuthorized — this box\'s own addresses', () => {
  it('authorizes loopback + localhost (incl. *.localhost and :port)', () => {
    expect(isOnDemandTlsAuthorized('localhost')).toBe(true);
    expect(isOnDemandTlsAuthorized('localhost:8443')).toBe(true);
    expect(isOnDemandTlsAuthorized('foo.localhost')).toBe(true);
    expect(isOnDemandTlsAuthorized('127.0.0.1')).toBe(true);
    expect(isOnDemandTlsAuthorized('::1')).toBe(true);
    expect(isOnDemandTlsAuthorized('[::1]:443')).toBe(true);
  });

  it('authorizes private / LAN IP literals (internal CA cert)', () => {
    expect(isOnDemandTlsAuthorized('192.168.1.50')).toBe(true);
    expect(isOnDemandTlsAuthorized('10.0.0.4')).toBe(true);
    expect(isOnDemandTlsAuthorized('172.16.5.9')).toBe(true);
  });

  it('authorizes this instance\'s own public IP + its sslip hostname', () => {
    process.env.EXEPAD_PUBLIC_IP = '203.0.113.10';
    expect(isOnDemandTlsAuthorized('203.0.113.10')).toBe(true);
    expect(isOnDemandTlsAuthorized('203-0-113-10.sslip.io')).toBe(true);
  });

  it('refuses a foreign domain and a public IP that is not ours (abuse guard)', () => {
    process.env.EXEPAD_PUBLIC_IP = '203.0.113.10';
    expect(isOnDemandTlsAuthorized('evil.example.com')).toBe(false);
    expect(isOnDemandTlsAuthorized('198.51.100.7')).toBe(false);
    expect(isOnDemandTlsAuthorized('198-51-100-7.sslip.io')).toBe(false);
  });

  it('refuses an unknown public host when this box has no known public IP', () => {
    expect(isOnDemandTlsAuthorized('203-0-113-10.sslip.io')).toBe(false);
    expect(isOnDemandTlsAuthorized('')).toBe(false);
    expect(isOnDemandTlsAuthorized(null)).toBe(false);
  });
});
