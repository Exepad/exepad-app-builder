/**
 * Password hashing for local operator accounts (PBKDF2-SHA256 via WebCrypto).
 *
 * WebCrypto's SubtleCrypto is available on bare Node 20+ and matches the HMAC
 * style already used in `gateway/auth.ts`, so this works without `node:crypto`.
 * Stored format: `pbkdf2$<iterations>$<saltB64>$<hashB64>`.
 */
import { constantTimeEqual } from './crypto-utils';

// OWASP 2023 work factor for PBKDF2-HMAC-SHA256. The stored hash records the
// iteration count (`pbkdf2$<iters>$...`) and verifyPassword reads it back, so
// raising this stays backward-compatible with existing operator hashes.
const ITERATIONS = 600_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

function toB64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveBits(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    // Cast: the DOM lib types `salt` as BufferSource over a plain ArrayBuffer,
    // but a Uint8Array's backing buffer is ArrayBufferLike (could be Shared).
    // Our salts are always plain Uint8Arrays, so the cast is sound.
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveBits(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = fromB64(parts[2]);
  const hash = await deriveBits(password, salt, iterations);
  return constantTimeEqual(toB64(hash), parts[3]);
}
