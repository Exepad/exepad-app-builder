/**
 * Zero-config self-signed TLS certificate provisioning.
 *
 * The runtime serves HTTPS by default in every setup (container, bare `docker
 * run`, and `./run.sh local`). For the trusted public path the docker stack
 * fronts the app with Caddy (Let's Encrypt via the on-demand sidecar); but the
 * universal FLOOR — localhost, a LAN IP, an air-gapped box, or `run.sh local`
 * from source — is this in-process self-signed cert, minted once per instance
 * and persisted under the data volume.
 *
 * It is deliberately self-signed: a publicly-trusted cert for `localhost` / a
 * bare LAN IP cannot be obtained from any CA, so the only zero-config HTTPS
 * possible there is self-signed (one-time browser trust warning). The private
 * key is generated per-instance into /data (never shipped in the image/repo),
 * so there is no shared/leakable key.
 *
 * Generation shells out to `openssl` (present in the image — added to the
 * Dockerfile — and ~universal on dev machines). If openssl is absent or fails
 * the caller degrades to HTTP-only rather than crashing the rig.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { hostname, networkInterfaces } from 'node:os';
import { X509Certificate } from 'node:crypto';

export interface EnsureCertOptions {
  certFile: string;
  keyFile: string;
  /** The instance's public IP/host, if known — added to the cert's SANs so a
   *  publicly-reached self-signed cert at least name-matches. */
  publicIp?: string | null;
  publicHost?: string | null;
}

export interface EnsuredCert {
  certFile: string;
  keyFile: string;
  /** True when this call generated a fresh cert (vs. reused an existing one). */
  generated: boolean;
}

/** Derive the `<dashed-ip>.sslip.io` hostname for a bare IPv4/IPv6, or null. */
function sslipHostnameForIp(ip: string): string | null {
  const h = ip.trim().toLowerCase();
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(h)) return `${h.replace(/\./g, '-')}.sslip.io`;
  if (h.includes(':') && /^[0-9a-f:]+$/.test(h)) return `${h.replace(/:/g, '-')}.sslip.io`;
  return null;
}

/** Collect the DNS names + IP addresses this box answers on, for the cert SANs. */
function collectSans(opts: EnsureCertOptions): { dns: string[]; ips: string[] } {
  const dns = new Set<string>(['localhost', '*.localhost']);
  const ips = new Set<string>(['127.0.0.1', '::1']);

  const host = hostname();
  if (host) {
    dns.add(host);
    if (!host.includes('.')) dns.add(`${host}.local`);
  }

  // Every non-internal interface address — covers LAN access by IP and the
  // box's own public IP when it sits directly on a NIC.
  try {
    for (const addrs of Object.values(networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.internal) continue;
        if (a.address) ips.add(a.address);
      }
    }
  } catch {
    /* networkInterfaces can throw in locked-down sandboxes; SANs are best-effort */
  }

  const publicIp = (opts.publicIp || '').trim();
  if (publicIp) {
    ips.add(publicIp);
    const sslip = sslipHostnameForIp(publicIp);
    if (sslip) dns.add(sslip);
  }
  const publicHost = (opts.publicHost || '').trim();
  if (publicHost) dns.add(publicHost);

  return { dns: [...dns], ips: [...ips] };
}

/** True when the cert file parses and is not expired (with a small skew margin). */
function certIsValid(certFile: string): boolean {
  try {
    const cert = new X509Certificate(readFileSync(certFile));
    const notAfter = Date.parse(cert.validTo);
    return Number.isFinite(notAfter) && notAfter - Date.now() > 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/**
 * Ensure a self-signed cert/key pair exists at the given paths, generating one
 * (covering localhost, loopback, every local interface IP, and the public
 * IP/host + its sslip hostname) if absent or expired. Idempotent. Returns the
 * paths, or null if generation isn't possible (no openssl) — the caller then
 * stays HTTP-only.
 */
export function ensureSelfSignedCert(opts: EnsureCertOptions): EnsuredCert | null {
  const { certFile, keyFile } = opts;

  if (existsSync(certFile) && existsSync(keyFile) && certIsValid(certFile)) {
    return { certFile, keyFile, generated: false };
  }

  const { dns, ips } = collectSans(opts);
  const san = [...dns.map((d) => `DNS:${d}`), ...ips.map((ip) => `IP:${ip}`)].join(',');
  const cn = dns[0] ?? 'localhost';

  try {
    mkdirSync(dirname(certFile), { recursive: true });
    mkdirSync(dirname(keyFile), { recursive: true });
    // One-shot self-signed generation. RSA-2048 + SHA-256 is universally
    // accepted by Node's TLS and every browser; 10-year validity since a
    // self-signed dev/LAN cert has no rotation story (it's never trusted by a
    // CA anyway). `-nodes` leaves the key unencrypted so the server can read it
    // without a passphrase.
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes',
        '-keyout', keyFile,
        '-out', certFile,
        '-days', '3650',
        '-subj', `/CN=${cn}`,
        '-addext', `subjectAltName=${san}`,
        '-addext', 'basicConstraints=critical,CA:FALSE',
        '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
        '-addext', 'extendedKeyUsage=serverAuth',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    // Private key is sensitive — owner-read-only.
    try {
      chmodSync(keyFile, 0o600);
      chmodSync(certFile, 0o644);
    } catch {
      /* best-effort on filesystems without POSIX perms */
    }
    return { certFile, keyFile, generated: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[exepad] could not generate a self-signed TLS cert (is openssl installed?) — staying HTTP-only: ${msg}`,
    );
    // Clean up a half-written pair so a later boot retries instead of loading a
    // corrupt cert.
    try {
      if (existsSync(certFile) && !certIsValid(certFile)) writeFileSync(certFile, '');
    } catch {
      /* ignore */
    }
    return null;
  }
}
