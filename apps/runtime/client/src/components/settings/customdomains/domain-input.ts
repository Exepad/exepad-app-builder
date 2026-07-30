/**
 * Client-side normalization + validation for the add-domain wizard's inputs.
 *
 * Mirrors the worker's rules (worker/src/lib/custom-domains.ts: isValidDomain,
 * isIpAddress) so a value that passes here is never rejected by POST /api/domains
 * for syntax. Philosophy: fix silently what we can (pasted URLs, stray schemes,
 * trailing dots), and only surface errors a person can act on.
 */

/** One DNS label: 1–63 chars, alphanumerics + internal hyphens (server parity). */
const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * Clean a pasted/typed host: strip scheme, path/query/hash, port, trailing dot
 * and whitespace; lowercase. Keeps a leading `*.` (wildcard intent is detected
 * by the caller, not destroyed here).
 */
export function cleanHostInput(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  s = s.replace(/[/?#].*$/, ''); // path / query / fragment
  // Port — but never mangle a bare IPv6 literal (colons are its syntax).
  if (!/^[0-9a-f:]+$/.test(s) || !s.includes(':') || s.includes('.')) {
    s = s.replace(/:\d+$/, '');
  }
  s = s.replace(/\.$/, ''); // trailing dot
  return s.replace(/\s+/g, '');
}

export function isIpAddressInput(host: string): boolean {
  if (IPV4_RE.test(host)) return host.split('.').every((o) => Number(o) <= 255);
  return host.includes(':') && /^[0-9a-f:]+$/.test(host);
}

/** Private / loopback / link-local / CGNAT ranges — sslip issuance can never succeed there. */
export function isPrivateIp(ip: string): boolean {
  if (IPV4_RE.test(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      // Carrier-grade NAT (100.64.0.0/10) — Starlink, T-Mobile Home, many ISPs
      // hand these out; a public link can never be issued for one.
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const h = ip.toLowerCase();
  return h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd');
}

export type DomainCheck =
  | { kind: 'ok'; value: string }
  /** Empty after cleaning — keep the button disabled, show no error. */
  | { kind: 'empty' }
  /** Syntactically not a hostname. */
  | { kind: 'invalid' }
  /** The user typed an IP where a domain belongs. */
  | { kind: 'ip'; value: string }
  /** A leading `*.` on a screen that isn't the per-app-subdomain setup. */
  | { kind: 'wildcard'; value: string };

/**
 * Validate a (pre-cleaned) domain. `allowWildcard` accepts a leading `*.`
 * (per-app-subdomain screen); elsewhere a wildcard comes back as
 * `{kind:'wildcard'}` so the wizard can offer the jump, not an error.
 */
export function checkDomain(raw: string, opts: { allowWildcard?: boolean } = {}): DomainCheck {
  const d = cleanHostInput(raw);
  if (!d) return { kind: 'empty' };
  if (isIpAddressInput(d)) return { kind: 'ip', value: d };
  if (d.startsWith('*.') && !opts.allowWildcard) return { kind: 'wildcard', value: d };
  if (d.length > 253) return { kind: 'invalid' };
  const labels = d.split('.');
  if (labels.length < 2) return { kind: 'invalid' };
  // Server parity: a wildcard must cover a real sub-zone (>= 2 labels under the star).
  if (labels[0] === '*' && labels.length < 3) return { kind: 'invalid' };
  for (let i = 0; i < labels.length; i++) {
    if (i === 0 && labels[i] === '*') continue;
    if (!LABEL_RE.test(labels[i])) return { kind: 'invalid' };
  }
  return { kind: 'ok', value: d };
}

export type IpCheck =
  | { kind: 'ok'; value: string }
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'private'; value: string };

export function checkIp(raw: string): IpCheck {
  const ip = cleanHostInput(raw);
  if (!ip) return { kind: 'empty' };
  if (!isIpAddressInput(ip)) return { kind: 'invalid' };
  if (isPrivateIp(ip)) return { kind: 'private', value: ip };
  return { kind: 'ok', value: ip };
}

/** `203.0.113.10` → `203-0-113-10.sslip.io` (server parity: sslipHostnameForIp). */
export function sslipPreview(ip: string): string | null {
  const h = cleanHostInput(ip);
  if (!isIpAddressInput(h)) return null;
  return IPV4_RE.test(h) ? `${h.replace(/\./g, '-')}.sslip.io` : `${h.replace(/:/g, '-')}.sslip.io`;
}
