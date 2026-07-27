// Pure semver handling for the lockstep version model + the downgrade guard.
// Migrations run forward-only on boot (meta-db.ts), so an older image on newer
// /data can break — classifyChange() is what lets the CLI refuse that.

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(v: string): Semver | null {
  const m = SEMVER_RE.exec(v.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : [],
  };
}

export function isSemver(v: string): boolean {
  return parseSemver(v) !== null;
}

/** A digest pin (`sha256:…` or `@sha256:…`) — immutable, the most reproducible ref. */
export function isDigest(tag: string): boolean {
  return tag.startsWith('sha256:') || tag.startsWith('@sha256:');
}

function comparePrerelease(a: string[], b: string[]): number {
  // Per semver: a version WITHOUT prerelease outranks one WITH prerelease.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ai = a[i];
    const bi = b[i];
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const d = Number(ai) - Number(bi);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (aNum) {
      return -1; // numeric identifiers have lower precedence than alphanumeric
    } else if (bNum) {
      return 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/** -1 if a<b, 0 if equal, 1 if a>b. Throws if either side is not valid semver. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error('compareSemver requires valid semver on both sides');
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

export type ChangeKind = 'install' | 'same' | 'upgrade' | 'downgrade' | 'unknown';

/**
 * Classify a deploy. `unknown` = at least one side isn't comparable semver
 * (a channel tag like `edge`, or a digest) — the caller must skip the
 * reproducibility/downgrade guarantees and warn instead.
 */
export function classifyChange(deployed: string | null, target: string): ChangeKind {
  if (!deployed) return 'install';
  if (!isSemver(deployed) || !isSemver(target)) return 'unknown';
  const c = compareSemver(target, deployed);
  return c === 0 ? 'same' : c > 0 ? 'upgrade' : 'downgrade';
}
