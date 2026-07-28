/**
 * Auth utility functions — password hashing, session tokens, UUIDs.
 * Uses native Web Crypto API for Cloudflare Workers compatibility.
 */

import type { SecurityProps, ModelProps, HandlerProps } from '@exepad/types';

// ── Password Hashing (PBKDF2) ──────────────────────────────────

// OWASP 2023 guidance for PBKDF2-HMAC-SHA256. The stored hash records the
// iteration count it was made with (`pbkdf2:<iters>:...`) and verifyPassword
// reads it back, so raising this stays backward-compatible with existing hashes
// — combine with needsRehash() + rehash-on-login to transparently upgrade them.
const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Hash a password using PBKDF2-SHA256 with a random salt.
 * Returns a compact string: `pbkdf2:iterations:salt_hex:hash_hex`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const saltHex = toHex(salt);
  const hashHex = toHex(new Uint8Array(key));
  return `pbkdf2:${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

/**
 * Verify a password against a stored hash.
 * Timing-safe comparison to prevent timing attacks.
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts[0] !== 'pbkdf2' || parts.length !== 4) return false;

  const iterations = parseInt(parts[1], 10);
  const salt = fromHex(parts[2]);
  const expectedHash = fromHex(parts[3]);

  const derivedKey = await deriveKey(password, salt, iterations);
  const derivedBytes = new Uint8Array(derivedKey);

  // Timing-safe comparison
  if (derivedBytes.length !== expectedHash.length) return false;
  return timingSafeEqual(derivedBytes, expectedHash);
}

/**
 * True when a stored hash was produced with fewer than the current iteration
 * count (or in an unrecognized format) and should be transparently re-hashed
 * on the next successful login so long-lived accounts drift up to the current
 * work factor without a forced password reset.
 */
export function needsRehash(storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts[0] !== 'pbkdf2' || parts.length !== 4) return true;
  const iterations = parseInt(parts[1], 10);
  return !Number.isFinite(iterations) || iterations < PBKDF2_ITERATIONS;
}

// A fixed dummy hash (current format + iteration count) used to equalize the
// response time of the unknown-user login path with the known-user path, so an
// attacker cannot enumerate registered emails from the timing difference
// between a fast "no such user" reject and a slow real PBKDF2 verification.
// Computed lazily once per process so it always matches the current work factor.
let dummyHashPromise: Promise<string> | null = null;
export function getDummyPasswordHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('exepad-timing-equalizer-not-a-real-secret');
  }
  return dummyHashPromise;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH * 8
  );
}

// ── Session Tokens ──────────────────────────────────────────────

/**
 * Generate a cryptographically random session token (32 bytes, hex-encoded).
 */
export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toHex(bytes);
}

/**
 * SHA-256 hash a session token for storage.
 * Raw token goes to the browser; only the hash is stored in D1.
 */
export async function hashSessionToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return toHex(new Uint8Array(hashBuffer));
}

// ── UUID ────────────────────────────────────────────────────────

/** Generate a UUID v4 */
export function generateId(): string {
  return crypto.randomUUID();
}

// ── Hex Encoding ────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string: odd length');
  }
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('Invalid hex string: non-hex characters');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ── Timing-Safe Comparison ──────────────────────────────────────

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

/**
 * Timing-safe string comparison. Encodes both strings as UTF-8
 * and delegates to constant-time byte comparison.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

// ── Role Parsing ────────────────────────────────────────────────

/**
 * Parse a roles string from D1 into a string array.
 * Handles both formats during migration:
 * - New: JSON array '["admin","editor"]'
 * - Legacy: comma-separated 'admin,editor' or plain string 'user'
 */
export function parseRoles(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Try JSON parse first (new format)
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter((r): r is string => typeof r === 'string');
    } catch {
      // Fall through to legacy parsing
    }
  }

  // Legacy: comma-separated or plain string
  return trimmed.split(',').map((r) => r.trim()).filter(Boolean);
}

// ── Validation Helpers ──────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Basic email format validation */
export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email) && email.length <= 254;
}

/** Validate password against policy */
export function validatePassword(
  password: string,
  policy?: { minLength?: number; requireUppercase?: boolean; requireNumber?: boolean }
): string | null {
  const minLength = policy?.minLength ?? 8;
  if (password.length < minLength) {
    return `Password must be at least ${minLength} characters`;
  }
  if (policy?.requireUppercase && !/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (policy?.requireNumber && !/\d/.test(password)) {
    return 'Password must contain at least one number';
  }
  return null;
}

// ── ISO Timestamp ───────────────────────────────────────────────

/** Current ISO timestamp for D1 text columns */
export function now(): string {
  return new Date().toISOString();
}

/** ISO timestamp N seconds from now */
export function expiresAt(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

// ── Self-signup role resolution (privilege-escalation guard) ─────
//
// A PUBLIC self-registration (email OR social) must never mint a privileged
// role. Without this, an app misconfigured with `defaultRole:'admin'` +
// `allowSignup:true` (e.g. `role:admin`-gated pages) would let any visitor
// self-register straight into the admin surface. Both auth_signup and the social
// account-creation path route through resolveSelfSignupRole so neither is a
// bypass. The config validator flags the same misconfig at config-load; this is
// the request-time backstop that also protects already-deployed apps.
//
// TWO notions of "privileged" (deliberately different):
//   • DOWNGRADE TRIGGER (should we override the configured defaultRole?) is
//     NARROW — reserved names + page gates only. An app whose defaultRole gates
//     model CRUD/handlers but no page ("every signup is a member who can create
//     their own rows") is a legitimate, common pattern and is NOT downgraded.
//   • FALLBACK SAFETY (when we DO downgrade, which role is safe?) is BROAD — the
//     replacement must gate NOTHING (page, model CRUD op, OR handler), else we'd
//     swap one privileged role for another. This needs the deployed models +
//     handlers, so callers thread them in.

/**
 * Roles that are inherently privileged and must never be granted through public
 * self-registration, regardless of the app's declared defaultRole.
 */
export const RESERVED_PRIVILEGED_ROLES = new Set(['admin', 'owner', 'superadmin', 'root']);

function addRoleRef(gate: Set<string>, level: unknown): void {
  if (typeof level === 'string' && level.startsWith('role:')) gate.add(level.slice(5).trim());
}

/** Roles referenced as `role:<x>` in the app's PAGE gates (the narrow set). */
function collectGateRoles(security: SecurityProps): Set<string> {
  const gate = new Set<string>();
  // `pageAccess` is emitted by the agent + read by the runtime, but is not on
  // the typed SecurityProps — read it defensively.
  const pageAccess = (security as { pageAccess?: Record<string, string> }).pageAccess;
  if (pageAccess) for (const level of Object.values(pageAccess)) addRoleRef(gate, level);
  addRoleRef(gate, security.defaultAccess);
  return gate;
}

/**
 * Roles that gate ANY capability — pages PLUS model CRUD ops and handlers (the
 * broad set). A role in here can actually DO something restricted on the backend,
 * so it is never a safe self-signup fallback.
 */
function collectCapabilityGateRoles(
  security: SecurityProps,
  models?: ModelProps[],
  handlers?: HandlerProps[],
): Set<string> {
  const gate = collectGateRoles(security);
  for (const model of models ?? []) {
    const cp = model.crudPolicy;
    if (cp) for (const op of ['create', 'read', 'update', 'delete', 'list'] as const) {
      addRoleRef(gate, cp[op]);
    }
  }
  for (const handler of handlers ?? []) addRoleRef(gate, handler.authLevel);
  return gate;
}

/**
 * A role is privileged (for the DOWNGRADE TRIGGER) if it is reserved or gates a
 * restricted page. Intentionally narrow — see the module note above.
 */
export function isPrivilegedRole(role: string, security: SecurityProps): boolean {
  if (RESERVED_PRIVILEGED_ROLES.has(role.toLowerCase())) return true;
  return collectGateRoles(security).has(role);
}

/**
 * The role to assign to a PUBLIC self-registration. If the configured
 * `defaultRole` is privileged (reserved or page-gated), fall back to the
 * least-privileged declared role that gates NOTHING (page, CRUD, or handler),
 * else `'user'`. Matches the documented `defaultRole` default ("first non-admin
 * role, or 'user'"). Returns `downgradedFrom` when a downgrade happened so the
 * caller can log it. Pass the deployed `models`/`handlers` so the fallback can
 * see CRUD/handler gates, not just page gates.
 */
export function resolveSelfSignupRole(
  security: SecurityProps,
  opts?: { models?: ModelProps[]; handlers?: HandlerProps[] },
): { role: string; downgradedFrom?: string } {
  const configured = security.defaultRole ?? 'user';
  // Downgrade trigger: narrow (reserved + page gates).
  if (!isPrivilegedRole(configured, security)) return { role: configured };
  // Fallback safety: broad — the replacement must gate nothing at all.
  const capabilityGates = collectCapabilityGateRoles(security, opts?.models, opts?.handlers);
  const safe =
    (security.roles ?? []).find(
      (r) => !RESERVED_PRIVILEGED_ROLES.has(r.toLowerCase()) && !capabilityGates.has(r),
    ) ?? 'user';
  return { role: safe, downgradedFrom: configured };
}
