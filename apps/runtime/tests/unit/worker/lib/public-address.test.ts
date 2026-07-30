// @vitest-environment node
/**
 * public-address.ts — auto-detection of the instance's public DNS target so the
 * Custom Domains panel needs no manual EXEPAD_PUBLIC_IP. Explicit env wins;
 * detection is the zero-config fallback; private/CGNAT/loopback is flagged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isIpv4,
  isPrivateIp,
  detectPublicIp,
  detectInterfaceIpv4,
  resolveInstanceTarget,
  __resetPublicIpCache,
  __setInterfaceIpForTest,
} from '../../../../worker/src/lib/public-address';

const NOW = 1_000_000;

beforeEach(() => {
  // Default to "behind NAT" (no public NIC IP) so the echo-path tests are
  // deterministic regardless of the host running the suite. Interface-path tests
  // opt back in via __setInterfaceIpForTest.
  __setInterfaceIpForTest(() => null);
});
afterEach(() => {
  __resetPublicIpCache();
  __setInterfaceIpForTest(null); // restore real interface detection
  vi.unstubAllGlobals();
  delete process.env.EXEPAD_PUBLIC_HOST;
  delete process.env.EXEPAD_PUBLIC_IP;
});

function stubFetch(body: string | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (body === null) throw new Error('offline');
      return { ok: true, text: async () => body } as unknown as Response;
    }),
  );
}

describe('isIpv4', () => {
  it('validates octets', () => {
    expect(isIpv4('203.0.113.10')).toBe(true);
    expect(isIpv4('255.255.255.255')).toBe(true);
    expect(isIpv4('256.0.0.1')).toBe(false);
    expect(isIpv4('not.an.ip.x')).toBe(false);
  });
});

describe('isPrivateIp', () => {
  it('flags RFC1918 / loopback / link-local / CGNAT', () => {
    for (const ip of ['10.0.0.5', '172.16.0.1', '172.31.255.1', '192.168.1.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '::1', 'fe80::1', 'fd00::1']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });
  it('treats public IPs as routable', () => {
    for (const ip of ['203.0.113.10', '8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1']) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
});

describe('detectPublicIp', () => {
  it('returns the echoed IP and caches it (one fetch)', async () => {
    stubFetch('203.0.113.5\n');
    const f = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(await detectPublicIp(NOW)).toBe('203.0.113.5');
    expect(await detectPublicIp(NOW + 1000)).toBe('203.0.113.5'); // cached
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('returns null when every endpoint fails', async () => {
    stubFetch(null);
    expect(await detectPublicIp(NOW)).toBeNull();
  });
  it('ignores a non-IP body', async () => {
    stubFetch('<html>blocked</html>');
    expect(await detectPublicIp(NOW)).toBeNull();
  });
});

describe('resolveInstanceTarget', () => {
  it('prefers EXEPAD_PUBLIC_HOST (CNAME)', async () => {
    process.env.EXEPAD_PUBLIC_HOST = 'edge.acme.net';
    stubFetch('203.0.113.5');
    const t = await resolveInstanceTarget(NOW);
    expect(t).toMatchObject({ value: 'edge.acme.net', type: 'CNAME', source: 'host-env', publiclyRoutable: true });
    expect(globalThis.fetch).not.toHaveBeenCalled(); // no detection when env wins
  });
  it('uses EXEPAD_PUBLIC_IP (A) and flags a private one', async () => {
    process.env.EXEPAD_PUBLIC_IP = '192.168.1.50';
    const t = await resolveInstanceTarget(NOW);
    expect(t).toMatchObject({ value: '192.168.1.50', type: 'A', source: 'ip-env', publiclyRoutable: false });
  });
  it('auto-detects when no env is set', async () => {
    stubFetch('203.0.113.5');
    const t = await resolveInstanceTarget(NOW);
    expect(t).toMatchObject({ value: '203.0.113.5', type: 'A', source: 'detected', publiclyRoutable: true });
  });
  it('returns none when detection fails (offline / air-gapped)', async () => {
    stubFetch(null);
    const t = await resolveInstanceTarget(NOW);
    expect(t).toMatchObject({ value: null, type: null, source: 'none', publiclyRoutable: false });
  });

  it('prefers a public NIC IP (offline, no outbound call) over echo', async () => {
    __setInterfaceIpForTest(() => '203.0.113.20');
    stubFetch('198.51.100.9'); // echo would say something else — must not be used
    const t = await resolveInstanceTarget(NOW);
    expect(t).toMatchObject({ value: '203.0.113.20', type: 'A', source: 'interface', publiclyRoutable: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('falls back to echo when the NIC only has a private IP (behind NAT)', async () => {
    __setInterfaceIpForTest(() => null); // NAT: no public NIC IP
    stubFetch('203.0.113.5');
    const t = await resolveInstanceTarget(NOW);
    expect(t).toMatchObject({ value: '203.0.113.5', source: 'detected' });
  });
});

describe('detectInterfaceIpv4', () => {
  it('returns the seam value (covers NAT vs direct-attached)', () => {
    __setInterfaceIpForTest(() => null);
    expect(detectInterfaceIpv4()).toBeNull();
    __setInterfaceIpForTest(() => '203.0.113.20');
    expect(detectInterfaceIpv4()).toBe('203.0.113.20');
  });
});

describe('detectPublicIp negative caching', () => {
  it('re-probes after a failure instead of caching null for the full hour', async () => {
    stubFetch(null);
    expect(await detectPublicIp(NOW)).toBeNull();
    // Just after the failure (within the short negative TTL) → still cached null.
    expect(await detectPublicIp(NOW + 1000)).toBeNull();
    // After the negative TTL (30s), a later call re-probes and can now succeed.
    stubFetch('203.0.113.7');
    expect(await detectPublicIp(NOW + 31_000)).toBe('203.0.113.7');
  });
});
