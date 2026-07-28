/**
 * Public-address detection for the custom-domains feature.
 *
 * So the operator never has to hand-set EXEPAD_PUBLIC_IP just to learn what DNS
 * record to create, the worker auto-detects the box's public IP and resolves the
 * "DNS target" the Custom Domains panel shows. Explicit env always wins; then we
 * detect, cheapest-and-certain first:
 *
 *   EXEPAD_PUBLIC_HOST   → operators CNAME to this hostname          (highest priority)
 *   EXEPAD_PUBLIC_IP     → operators create an A record to this IP
 *   (NIC public IPv4)    → a globally-routable address bound to a local network
 *                          interface — instant, offline, no external call. Covers
 *                          bare-metal + most VPS where the public IP is on the NIC.
 *   (outbound echo IP)   → the public *egress* IP via an IP-echo endpoint — the
 *                          only way to learn the public IP from BEHIND NAT (home /
 *                          office, or a cloud 1:1 NAT where the NIC only sees a
 *                          private address). Best-effort; needs outbound internet.
 *   (none)               → genuinely undetectable (air-gapped + private NICs only);
 *                          the UI then shows the manual EXEPAD_PUBLIC_* hint.
 *
 * A private (RFC1918 / CGNAT / loopback / link-local) result means the box almost
 * certainly isn't publicly reachable, which the UI surfaces so the operator picks
 * DNS-01 or accepts that public CAs can't issue there. Echo failures are cached
 * only briefly (not for the full success TTL) so a transient blip self-heals.
 */
import { networkInterfaces } from 'node:os';
import { effectivePublicHost, effectivePublicIp } from './net-config';

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Strict IPv4 validation (each octet 0-255). */
export function isIpv4(value: string): boolean {
  const m = value.trim().match(IPV4_RE);
  return m ? m.slice(1).every((o) => Number(o) <= 255) : false;
}

/**
 * True for an address that is NOT publicly routable: loopback, RFC1918 private,
 * link-local, and CGNAT (100.64.0.0/10). Such a box can't be validated by a
 * public CA over the internet.
 */
export function isPrivateIp(value: string): boolean {
  const ip = value.trim().toLowerCase();
  // IPv6 shorthands.
  if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  const m = ip.match(IPV4_RE);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;        // link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 0) return true;
  return false;
}

// ─── Local network-interface detection (instant, offline, primary) ─────────────

/**
 * The first globally-routable IPv4 bound to a local network interface, or null.
 * On bare-metal and most VPS the public IP is on the NIC, so this resolves the
 * DNS target with zero external calls. Behind NAT the NIC only carries a private
 * address, so this returns null and the caller falls back to the outbound echo.
 */
function readInterfaceIpv4(): string | null {
  let nets: ReturnType<typeof networkInterfaces>;
  try {
    nets = networkInterfaces();
  } catch {
    return null;
  }
  const candidates: string[] = [];
  for (const addrs of Object.values(nets)) {
    for (const a of addrs ?? []) {
      // node reports family as 'IPv4' (modern) or the number 4 (older runtimes).
      const isV4 = a.family === 'IPv4' || (a.family as unknown) === 4;
      if (!isV4 || a.internal) continue;
      if (!isIpv4(a.address) || isPrivateIp(a.address)) continue;
      candidates.push(a.address);
    }
  }
  candidates.sort(); // deterministic pick across calls / multi-homed boxes
  return candidates[0] ?? null;
}

// Indirection so tests can simulate "behind NAT" (null) or a fixed NIC IP.
let interfaceIpProbe: () => string | null = readInterfaceIpv4;

/** The public IPv4 bound to a local interface, or null (behind NAT / none). */
export function detectInterfaceIpv4(): string | null {
  return interfaceIpProbe();
}

// IP-echo endpoints (plain-text body = the caller's public IP). Tried in order.
const ECHO_ENDPOINTS = [
  'https://api.ipify.org',
  'https://checkip.amazonaws.com',
  'https://icanhazip.com',
];
const DETECT_TIMEOUT_MS = 3000;
const DETECT_TTL_MS = 60 * 60 * 1000; // 1h — a found public IP rarely changes
const DETECT_NEG_TTL_MS = 30 * 1000; // but re-probe FAILURES after 30s, not 1h,
//                                      so a transient outbound blip self-heals.

interface DetectCache {
  ip: string | null;
  at: number;
}
let detectCache: DetectCache | null = null;
let detectInflight: Promise<string | null> | null = null;

async function fetchEcho(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const body = (await res.text()).trim();
    return isIpv4(body) ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The box's public egress IPv4, or null. Cached for 1h; concurrent callers share
 * one in-flight probe. Override the lookup entirely by setting EXEPAD_PUBLIC_IP.
 */
export async function detectPublicIp(now: number): Promise<string | null> {
  if (detectCache) {
    // A successful result is cached for 1h; a failure only briefly, so a transient
    // outbound blip doesn't poison detection for an hour.
    const ttl = detectCache.ip ? DETECT_TTL_MS : DETECT_NEG_TTL_MS;
    if (now - detectCache.at < ttl) return detectCache.ip;
  }
  if (detectInflight) return detectInflight;
  detectInflight = (async () => {
    let found: string | null = null;
    for (const url of ECHO_ENDPOINTS) {
      found = await fetchEcho(url);
      if (found) break;
    }
    detectCache = { ip: found, at: now };
    return found;
  })().finally(() => {
    detectInflight = null;
  });
  return detectInflight;
}

export interface InstanceTarget {
  /** The A/CNAME value the operator points their domain at, or null if unknown. */
  value: string | null;
  type: 'A' | 'CNAME' | null;
  /** Where the value came from, for UI transparency. `interface` = read off a
   *  local NIC (offline); `detected` = learned via an outbound echo (behind NAT). */
  source: 'host-env' | 'ip-env' | 'interface' | 'detected' | 'none';
  /** True when we believe the box is publicly reachable (a public IP). */
  publiclyRoutable: boolean;
}

/**
 * Resolve the DNS target to advertise: explicit env first, then auto-detection
 * (a local NIC's public IP, then the outbound egress IP). `now` is passed in
 * (the worker forbids argless Date in some contexts); callers pass Date.now().
 */
export async function resolveInstanceTarget(now: number): Promise<InstanceTarget> {
  // Operator override (meta.sqlite settings) wins, then the env seed — both are
  // read through net-config so a value saved in the UI takes effect immediately.
  const host = effectivePublicHost();
  if (host) {
    return { value: host, type: 'CNAME', source: 'host-env', publiclyRoutable: true };
  }
  const envIp = effectivePublicIp();
  if (envIp) {
    return { value: envIp, type: 'A', source: 'ip-env', publiclyRoutable: !isPrivateIp(envIp) };
  }
  // A public IP on a local interface is instant + offline + needs no external call.
  const nicIp = detectInterfaceIpv4();
  if (nicIp) {
    return { value: nicIp, type: 'A', source: 'interface', publiclyRoutable: true };
  }
  // Behind NAT the NIC is private: ask the internet what our egress IP is.
  const detected = await detectPublicIp(now);
  if (detected) {
    return { value: detected, type: 'A', source: 'detected', publiclyRoutable: !isPrivateIp(detected) };
  }
  return { value: null, type: null, source: 'none', publiclyRoutable: false };
}

/**
 * This instance's own public identity, resolved SYNCHRONOUSLY for hot-path
 * callers (the on-demand-TLS authorize endpoint) that can't await: explicit env
 * first, then a public IP on a local interface, then the last cached egress IP
 * (populated by a prior resolveInstanceTarget call). Never triggers an outbound
 * probe. Returns the public host and/or IPv4, each null if unknown.
 */
export function cachedPublicIdentity(): { host: string | null; ip: string | null } {
  const host = effectivePublicHost() || null;
  const envIp = effectivePublicIp();
  if (envIp) return { host, ip: isPrivateIp(envIp) ? null : envIp };
  const nicIp = detectInterfaceIpv4();
  if (nicIp) return { host, ip: nicIp };
  const cached = detectCache?.ip;
  return { host, ip: cached && !isPrivateIp(cached) ? cached : null };
}

/** Test seam: reset the detection cache. */
export function __resetPublicIpCache(): void {
  detectCache = null;
  detectInflight = null;
}

/**
 * Test seam: override the local-interface probe. Pass a function to simulate a
 * NIC IP (or null for "behind NAT"); pass null to restore real detection.
 */
export function __setInterfaceIpForTest(fn: (() => string | null) | null): void {
  interfaceIpProbe = fn ?? readInterfaceIpv4;
}
