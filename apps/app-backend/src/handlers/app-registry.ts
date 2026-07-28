/**
 * Per-app handler registry (self-hosted single-container runtime).
 *
 * Under Workers-for-Platforms each app was its own worker bundle: `_entry.js`
 * set `globalThis.INJECTED_HANDLERS` and each isolate saw only its own handlers.
 * In the single-container runtime the app-backend is imported ONCE and serves
 * EVERY app in one Node process, so a process-global handler map would leak one
 * app's handlers into another. This module resolves handlers PER `{appId}:{mode}`.
 *
 * Source of truth: the deploy pipeline writes each compiled handler ES module to
 * `{appId}/{mode}/modules/handlers/{method}.js` plus a `worker-manifest.json`
 * (see `@exepad/deploy-utils` `uploadWorkerScript`). On first use we read the
 * manifest, load each handler module, and instantiate it in a constrained
 * `node:vm` sandbox. The registry is cached per app+mode and invalidated when
 * the manifest's content hash (etag) changes (i.e. on redeploy).
 *
 * SANDBOX (single-tenant trust model): each handler module runs in its own
 * `vm` context exposing only the standard JS intrinsics, a `console` that
 * forwards to the host with an app/handler prefix, and an allowlisted `fetch`
 * (gated by `EXEPAD_FETCH_ALLOWLIST`, default-deny). No `require`, `process`,
 * `fs`, or ambient `fetch`. `ctx` (incl. `ctx.db` — this app's SQLite handle) is
 * passed as a call argument, not a global.
 *
 * ⚠️  SECURITY: `node:vm` is NOT a security boundary. Node's own docs state it
 * must not be used to run untrusted code: any host reference handed into the
 * context (the injected `crypto`/`URL` intrinsics, `console`, `fetch`, and the
 * `ctx` passed at call time) is a live handle to the OUTER realm, reachable via
 * `.constructor.constructor('return process')()` etc. An escaped handler can
 * therefore reach the real `process`/`require` and read other apps' SQLite
 * files and `/data/secrets`. This is an ACCEPTED tradeoff under "you trust the
 * apps you generate" (single author per container) — it enforces the
 * generation-time validators' contract, not a hard boundary against an actively
 * malicious author. HOSTING APPS FROM MULTIPLE UNTRUSTED AUTHORS ON ONE
 * CONTAINER IS UNSAFE until this seam moves to real isolation. The upgrade path
 * is worker_threads / subprocess / isolated-vm at the dispatch seam, passing
 * only structured-clone-safe data and mediating DB access through an
 * owner-scoped RPC rather than the raw handle. (defense-in-depth below: the
 * host-owned `console`/`fetch` wrappers are object-frozen so a handler can't
 * swap their methods, and EVERY injected host global's BINDING is locked
 * non-writable in the context so a handler can't reassign `fetch`/`crypto`/`URL`
 * etc.; the realm-crossing intrinsic OBJECTS themselves cannot be frozen without
 * mutating the shared process globals, so this is a binding lock, not isolation.)
 */
import vm from 'node:vm';
import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { Agent } from 'undici';
import { transformSync } from 'esbuild';
import type { HandlerContext } from '@exepad/types';
import type { Env } from '../types/env';

export type HandlerFunction = (ctx: HandlerContext) => Promise<unknown>;
export type HandlerRegistry = Record<string, HandlerFunction>;

interface ManifestShape {
  modules?: string[];
}

interface CacheEntry {
  version: string;
  registry: HandlerRegistry;
}

/** Resolved registries keyed `${appId}:${mode}`, invalidated by manifest etag. */
const cache = new Map<string, CacheEntry>();

/**
 * Pre-registered handler functions keyed `${appId}:${mode}`. Bypasses the
 * storage+vm load path. Used by tests and (optionally) by the runtime to inject
 * already-instantiated handlers. Always wins over the storage path.
 */
const overrides = new Map<string, HandlerRegistry>();

function keyOf(appId: string, mode: string): string {
  return `${appId}:${mode}`;
}

// ─── Sandbox ────────────────────────────────────────────────────────────────

function parseAllowlist(): string[] {
  return (process.env.EXEPAD_FETCH_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

/** True for an IPv4 literal in a private/loopback/link-local/CGNAT range. */
function isBlockedIpv4(ip: string): boolean {
  const p = ip.split('.').map((n) => Number(n));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  return false;
}

/** True for an IPv6 literal that is loopback/link-local/ULA/IPv4-mapped-private. */
function isBlockedIpv6(ip: string): boolean {
  const x = ip.toLowerCase().split('%')[0]; // strip any zone id
  if (x === '::1' || x === '::') return true; // loopback / unspecified
  if (x.startsWith('fe80') || x.startsWith('fc') || x.startsWith('fd')) return true; // link-local + ULA
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

function isBlockedIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isBlockedIpv4(ip);
  if (fam === 6) return isBlockedIpv6(ip);
  return true; // not a parseable IP → fail closed
}

/** A DNS name (or IP literal) resolved to a single validated public IP. */
export interface PinnedAddress {
  address: string;
  /** IP family as `net` reports it: 4 or 6. */
  family: number;
}

/**
 * Reject a host that is (or DNS-resolves to) a private/loopback/link-local/
 * metadata address, and return the validated public IP to PIN the connection
 * to. Closes SSRF to internal services and cloud metadata even for an
 * allowlisted name that has been repointed at an internal IP. ALL resolved
 * addresses are checked, so a multi-record response that MIXES a public and a
 * private address is rejected outright (no "first record wins"); the first
 * (all-checked-public) record is returned as the pin.
 *
 * DNS-rebinding TOCTOU is closed by the caller: the returned IP is fed to an
 * undici dispatcher via `makePinnedLookup`, so the actual TCP connect dials
 * THIS validated IP instead of re-resolving DNS — a hostile authoritative
 * server can no longer answer public on this check and private on the connect.
 */
async function assertPublicHost(host: string): Promise<PinnedAddress> {
  if (isIP(host)) {
    if (isBlockedIp(host)) {
      throw new Error(`Handler fetch to internal address "${host}" is blocked.`);
    }
    return { address: host, family: isIP(host) };
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error(`Handler fetch: DNS resolution failed for "${host}".`);
  }
  if (addrs.length === 0) {
    throw new Error(`Handler fetch: DNS resolution returned no records for "${host}".`);
  }
  for (const { address } of addrs) {
    if (isBlockedIp(address)) {
      throw new Error(`Handler fetch to "${host}" resolves to an internal address and is blocked.`);
    }
  }
  // All records validated public → pinning any is safe. Pin the first.
  return { address: addrs[0].address, family: addrs[0].family };
}

/**
 * Build a `net`/undici `lookup` that resolves a hostname ONLY to the IP we
 * already validated as public (keyed by hostname in `pinned`). Handed to an
 * undici `Agent`'s connector so the TCP connect uses the checked IP rather than
 * performing a second, independent DNS resolution — this is what closes the
 * DNS-rebinding TOCTOU (resolve-public-then-connect-private) window.
 *
 * A hostname that was never validated fails CLOSED (the connect errors) — inside
 * `makeGatedFetch` every hop is pinned before the fetch, so a miss can only mean
 * an unexpected/foreign connection attempt.
 *
 * Note: the pin does not weaken TLS — undici still sets SNI/`servername` and
 * validates the certificate against the ORIGINAL hostname; only the IP dialed is
 * fixed. Exported for unit testing.
 */
export function makePinnedLookup(pinned: Map<string, PinnedAddress>): LookupFunction {
  return ((hostname: string, options: unknown, callback: unknown) => {
    const pin = pinned.get(hostname);
    if (!pin) {
      (callback as (err: Error) => void)(
        new Error(`Handler fetch: unvalidated host "${hostname}" (DNS-rebinding pin miss).`),
      );
      return;
    }
    if (options && typeof options === 'object' && (options as { all?: boolean }).all) {
      (callback as (e: null, a: { address: string; family: number }[]) => void)(null, [
        { address: pin.address, family: pin.family },
      ]);
    } else {
      (callback as (e: null, a: string, f: number) => void)(null, pin.address, pin.family);
    }
  }) as LookupFunction;
}

function hostAllowed(allow: string[], host: string): boolean {
  return allow.some((a) => host === a || host.endsWith(`.${a}`));
}

function urlOf(input: RequestInfo | URL): URL {
  const href =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(href);
}

/**
 * Build an allowlisted fetch (default-deny) for the sandbox global.
 *
 * SSRF hardening: every hop — the initial URL AND each redirect target — is
 * re-checked against the allowlist and the private-IP denylist. Redirects are
 * followed MANUALLY (`redirect: 'manual'`) so an allowlisted host can't 302 the
 * request to 169.254.169.254 or a loopback service. A wall-clock timeout stops
 * a handler hanging the request against a slow/internal target.
 */
/** Node's `fetch` (undici) accepts a non-standard `dispatcher`; the DOM lib type doesn't. */
type NodeFetchInit = RequestInit & { dispatcher?: Agent };

function makeGatedFetch(): typeof fetch {
  const allow = parseAllowlist();
  const gated = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (allow.length === 0) {
      throw new Error(
        'Handler fetch is disabled. Set EXEPAD_FETCH_ALLOWLIST to permit outbound requests.',
      );
    }
    let url: URL;
    try {
      url = urlOf(input);
    } catch {
      throw new Error('Handler fetch: invalid URL');
    }
    let currentInit: RequestInit = { ...init };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    // DNS-rebinding pin: ONE dispatcher for the whole request whose connector
    // only dials the IP we validated for the current hop (see makePinnedLookup).
    // `assertPublicHost` fills `pinned` before each fetch below.
    const pinned = new Map<string, PinnedAddress>();
    const dispatcher = new Agent({
      connect: { lookup: makePinnedLookup(pinned) },
    } as unknown as ConstructorParameters<typeof Agent>[0]);

    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          throw new Error(`Handler fetch: non-HTTP protocol "${url.protocol}" blocked.`);
        }
        if (!hostAllowed(allow, url.hostname)) {
          throw new Error(`Handler fetch to "${url.hostname}" is not in EXEPAD_FETCH_ALLOWLIST.`);
        }
        // Re-validate on EVERY hop (initial + each redirect) and (re)pin the IP
        // the connector is allowed to dial for this host.
        pinned.set(url.hostname, await assertPublicHost(url.hostname));

        const reqInit: NodeFetchInit = {
          ...currentInit,
          redirect: 'manual',
          signal: controller.signal,
          dispatcher,
        };
        const resp = await globalThis.fetch(url, reqInit as RequestInit);

        const location = resp.status >= 300 && resp.status < 400 ? resp.headers.get('location') : null;
        if (!location) return resp;

        // Drain the redirect response so its pooled socket is freed for reuse.
        await resp.body?.cancel().catch(() => {});

        url = new URL(location, url); // resolve relative redirects against current URL
        // Browser semantics: 301/302/303 downgrade to GET and drop the body;
        // only 307/308 replay the original method + body.
        if (resp.status !== 307 && resp.status !== 308) {
          currentInit = { ...currentInit, method: 'GET', body: undefined };
        }
      }
      throw new Error('Handler fetch: too many redirects.');
    } finally {
      clearTimeout(timer);
      // Gracefully close the pinned dispatcher. undici's `close()` waits for the
      // in-flight (returned) response to finish streaming before tearing sockets
      // down, so the handler can still read the body. Fire-and-forget — it never
      // blocks this function and can't reject into the caller.
      void dispatcher.close().catch(() => {});
    }
  }) as typeof fetch;
  // Freeze the host-owned fetch so sandboxed handlers can't monkey-patch it
  // (add/replace its properties). Reassigning the `fetch` *binding* itself is
  // separately prevented by freezing the sandbox object (see instantiateHandler).
  return Object.freeze(gated) as typeof fetch;
}

function prefixedConsole(appId: string, method: string): Console {
  const tag = `[${appId}/${method}]`;
  const mk = (fn: (...a: unknown[]) => void) => (...args: unknown[]) => fn(tag, ...args);
  // Frozen so sandboxed code can't reassign the host-owned logger's methods.
  return Object.freeze({
    log: mk(console.log),
    info: mk(console.info),
    warn: mk(console.warn),
    error: mk(console.error),
    debug: mk(console.debug),
  }) as unknown as Console;
}

/**
 * Host-owned globals injected into every handler context. Their BINDINGS are
 * locked (non-writable/non-configurable) after createContext so sandboxed code
 * can't reassign/monkey-patch them. `module`/`exports` are deliberately absent —
 * esbuild's CJS output writes to them.
 */
const HOST_GLOBALS = [
  'console',
  'fetch',
  'TextEncoder',
  'TextDecoder',
  'URL',
  'URLSearchParams',
  'crypto',
] as const;

/**
 * Compile a self-contained handler ES module to a callable function inside a
 * fresh, constrained `vm` context. The compiled module is bundled ESM (the SDK
 * shim is already inlined), so transforming to CJS yields a single dependency-
 * free script whose `module.exports.default` is the handler.
 */
export function instantiateHandler(esmCode: string, appId: string, method: string): HandlerFunction {
  const cjs = transformSync(esmCode, { format: 'cjs', target: 'es2022', loader: 'js' }).code;

  const sandbox: Record<string, unknown> = {
    module: { exports: {} as Record<string, unknown> },
    console: prefixedConsole(appId, method),
    fetch: makeGatedFetch(),
    // Common timer/encoding globals handlers may legitimately touch. NB: no
    // require/process/fs are provided — they stay undefined in the context.
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    crypto,
  };
  sandbox.exports = (sandbox.module as { exports: unknown }).exports;
  vm.createContext(sandbox);

  // Defense-in-depth (NOT isolation): lock the host-owned global BINDINGS so a
  // sandboxed handler cannot reassign or monkey-patch them — `fetch = evil`,
  // `crypto = fake`, `URL = …` now throw/no-op instead of swapping the reference
  // other handler code closes over. The `fetch`/`console` we own are also frozen
  // at the object level (see makeGatedFetch/prefixedConsole).
  //
  // We lock EACH host global as non-writable/non-configurable rather than
  // `Object.freeze(sandbox)`: freezing the whole context object makes it
  // non-extensible, which SILENTLY breaks a handler's own top-level `var`/
  // `function` declarations and mutations (they live as properties of the vm
  // global) — corrupting legitimate handler state. Per-property locks keep the
  // context extensible for handler-owned state while still pinning the host
  // globals. `module`/`exports` are intentionally left writable (esbuild's CJS
  // output assigns to them). The realm-crossing intrinsics (URL/crypto/…) are
  // the SHARED process constructors, so we lock the BINDING but never
  // `Object.freeze` the object itself (that would mutate the whole process).
  //
  // ⚠️  node:vm is a SOFT boundary, not a sandbox — see the module header. This
  // hardens against accidental/opportunistic global tampering; it does NOT
  // contain an actively malicious handler (which can still reach the outer realm
  // via `.constructor.constructor`). Real isolation would run handlers OFF-THREAD
  // (worker_threads/subprocess/isolated-vm) with only structured-clone-safe data
  // crossing the seam and DB access mediated by an owner-scoped async RPC proxy.
  // We intentionally do NOT use worker_threads today because `ctx.db` is a LIVE
  // better-sqlite3 handle that cannot cross a thread boundary without
  // rearchitecting the handler↔DB contract.
  for (const name of HOST_GLOBALS) {
    if (name in sandbox) {
      Object.defineProperty(sandbox, name, {
        value: sandbox[name],
        writable: false,
        configurable: false,
        enumerable: true,
      });
    }
  }

  vm.runInContext(cjs, sandbox, {
    filename: `${appId}/handlers/${method}.js`,
    timeout: 5000,
  });

  const mod = (sandbox.module as { exports: Record<string, unknown> }).exports;
  const fn = (mod.default ?? mod) as unknown;
  if (typeof fn !== 'function') {
    throw new Error(`Handler module "${method}" has no default export function`);
  }
  return fn as HandlerFunction;
}

// ─── Loading ─────────────────────────────────────────────────────────────────

const MODULES_PREFIX = (appId: string, mode: string) => `${appId}/${mode}/modules`;
const MANIFEST_KEY = (appId: string, mode: string) => `${appId}/${mode}/worker-manifest.json`;

/**
 * Resolve the handler registry for the request's app+mode.
 *
 * Order: (1) explicit override (tests / runtime injection); (2) per-app cache
 * keyed by the manifest content hash; (3) load from storage + vm-instantiate.
 * Returns an empty registry (uncached) when the app has no deployed worker yet.
 */
export async function getAppHandlers(env: Env): Promise<HandlerRegistry> {
  const key = keyOf(env.APP_ID, env.DEPLOY_MODE);

  const override = overrides.get(key);
  if (override) return override;

  const manifestObj = await env.CONFIG_CACHE.get(MANIFEST_KEY(env.APP_ID, env.DEPLOY_MODE));
  if (!manifestObj) {
    // No deployed worker yet — don't cache; the next request retries once the
    // deploy pipeline writes the manifest.
    return {};
  }

  const version = manifestObj.etag;
  const cached = cache.get(key);
  if (cached && cached.version === version) {
    return cached.registry;
  }

  let manifest: ManifestShape;
  try {
    manifest = (await manifestObj.json()) as ManifestShape;
  } catch {
    console.error(`[${env.APP_ID}] Malformed worker-manifest.json`);
    return {};
  }

  const registry: HandlerRegistry = {};
  for (const name of manifest.modules ?? []) {
    if (!name.startsWith('handlers/') || !name.endsWith('.js')) continue;
    const method = name.slice('handlers/'.length, -'.js'.length);
    try {
      const src = await env.CONFIG_CACHE.get(`${MODULES_PREFIX(env.APP_ID, env.DEPLOY_MODE)}/${name}`);
      if (!src) {
        console.error(`[${env.APP_ID}] Handler module missing in storage: ${name}`);
        continue;
      }
      registry[method] = instantiateHandler(await src.text(), env.APP_ID, method);
    } catch (err) {
      console.error(
        `[${env.APP_ID}] Failed to load handler "${method}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  cache.set(key, { version, registry });
  return registry;
}

// ─── Injection seam (tests + runtime pre-registration) ────────────────────────

/** Register already-instantiated handlers for an app+mode (bypasses storage). */
export function registerHandlers(
  appId: string,
  mode: 'preview' | 'published',
  registry: HandlerRegistry,
): void {
  overrides.set(keyOf(appId, mode), registry);
}

/** Test-only: clear all caches + overrides. */
export function __clearHandlerRegistry(): void {
  cache.clear();
  overrides.clear();
}
