/**
 * SSRF DNS-rebinding pin (2026-07-04).
 *
 * The handler `fetch` validates the target host resolves to a PUBLIC IP, then
 * hands the validated IP to an undici dispatcher via `makePinnedLookup` so the
 * actual TCP connect dials THAT IP instead of re-resolving DNS. These pin the
 * lookup's contract: it only ever yields the pre-validated IP (so a resolver
 * that would rebind to a private address on the connect can't), handles both
 * `net`/undici callback shapes, and fails CLOSED for any unpinned host.
 */

import { describe, it, expect } from 'vitest';
import { makePinnedLookup, type PinnedAddress } from '../src/handlers/app-registry';

/** Invoke the lookup and capture its callback args as a promise. */
function callLookup(
  lookup: ReturnType<typeof makePinnedLookup>,
  host: string,
  all: boolean,
): Promise<{ err: Error | null; args: unknown[] }> {
  return new Promise((resolve) => {
    (lookup as unknown as (h: string, o: unknown, cb: (...a: unknown[]) => void) => void)(
      host,
      { all },
      (...args: unknown[]) => {
        const err = (args[0] as Error | null) ?? null;
        resolve({ err, args: args.slice(1) });
      },
    );
  });
}

describe('makePinnedLookup (SSRF DNS-rebinding pin)', () => {
  it('returns the validated IP for the single-address (all:false) callback shape', async () => {
    const pinned = new Map<string, PinnedAddress>([
      ['api.example.com', { address: '93.184.216.34', family: 4 }],
    ]);
    const { err, args } = await callLookup(makePinnedLookup(pinned), 'api.example.com', false);
    expect(err).toBeNull();
    expect(args).toEqual(['93.184.216.34', 4]); // (address, family)
  });

  it('returns the validated IP for the all:true callback shape', async () => {
    const pinned = new Map<string, PinnedAddress>([
      ['api.example.com', { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }],
    ]);
    const { err, args } = await callLookup(makePinnedLookup(pinned), 'api.example.com', true);
    expect(err).toBeNull();
    expect(args[0]).toEqual([
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
  });

  it('resists rebinding: even when a resolver would flip to a private IP, the pin holds', async () => {
    // The map was populated from the PUBLIC address validated at check time.
    // A hostile authoritative server flipping the record to 169.254.169.254 on
    // the connect is irrelevant — the connector never consults DNS again, it
    // only asks this lookup, which returns the pinned public IP.
    const pinned = new Map<string, PinnedAddress>([
      ['rebind.evil.test', { address: '203.0.113.10', family: 4 }],
    ]);
    const lookup = makePinnedLookup(pinned);
    for (const all of [false, true]) {
      const { err, args } = await callLookup(lookup, 'rebind.evil.test', all);
      expect(err).toBeNull();
      const dialed = all
        ? (args[0] as { address: string }[])[0].address
        : (args[0] as string);
      expect(dialed).toBe('203.0.113.10'); // never the private rebind target
      expect(dialed).not.toBe('169.254.169.254');
    }
  });

  it('fails CLOSED for a host that was never validated/pinned', async () => {
    const lookup = makePinnedLookup(new Map());
    const { err } = await callLookup(lookup, 'never-checked.test', false);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/unvalidated host/i);
  });
});
