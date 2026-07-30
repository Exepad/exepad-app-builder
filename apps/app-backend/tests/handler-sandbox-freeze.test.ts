/**
 * Handler sandbox global-freeze (defense-in-depth, 2026-07-04).
 *
 * `node:vm` is a SOFT boundary — these do NOT claim isolation. They pin the
 * defense-in-depth contract: a sandboxed handler cannot REASSIGN or monkey-patch
 * the host-owned globals (`fetch`, `crypto`, …) the runtime injects, while its
 * OWN top-level `var`/`function` state keeps working (the reason we lock each
 * binding instead of `Object.freeze`-ing the whole context).
 */

import { describe, it, expect } from 'vitest';
import { instantiateHandler } from '../src/handlers/app-registry';

const ctx = {} as never;

describe('instantiateHandler global freeze', () => {
  it('blocks reassigning the injected fetch binding', async () => {
    const src = `
      export default async () => {
        let outcome = 'reassigned';
        try { fetch = 'hijacked'; } catch { outcome = 'blocked'; }
        return { type: typeof fetch, outcome };
      };
    `;
    const fn = instantiateHandler(src, 'app', 'h');
    const r = (await fn(ctx)) as { type: string; outcome: string };
    // The host fetch reference is intact — never swapped for a string.
    expect(r.type).toBe('function');
  });

  it('blocks reassigning / monkey-patching the injected crypto binding', async () => {
    const src = `
      export default async () => {
        try { crypto = { getRandomValues: () => 'evil' }; } catch {}
        return { type: typeof crypto, hasGRV: typeof crypto.getRandomValues };
      };
    `;
    const fn = instantiateHandler(src, 'app', 'h');
    const r = (await fn(ctx)) as { type: string; hasGRV: string };
    expect(r.type).toBe('object');
    expect(r.hasGRV).toBe('function'); // still the real host crypto
  });

  it('cannot add properties to the frozen host fetch object', async () => {
    const src = `
      export default async () => {
        try { fetch.__pwned = 1; } catch {}
        return { pwned: fetch.__pwned };
      };
    `;
    const fn = instantiateHandler(src, 'app', 'h');
    const r = (await fn(ctx)) as { pwned: unknown };
    expect(r.pwned).toBeUndefined();
  });

  it('still allows a handler to keep its OWN top-level state across calls', async () => {
    // Regression guard: locking host globals per-binding must NOT freeze the
    // whole context — a handler's top-level `var` counter must still mutate.
    const src = `
      var counter = 0;
      export default async () => { counter++; return counter; };
    `;
    const fn = instantiateHandler(src, 'app', 'h');
    expect(await fn(ctx)).toBe(1);
    expect(await fn(ctx)).toBe(2);
    expect(await fn(ctx)).toBe(3);
  });
});
