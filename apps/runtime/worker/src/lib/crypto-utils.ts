import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Per-process key used ONLY to normalize inputs to fixed-width digests before
 * comparison. It does not need to be secret — its purpose is to make the
 * compared buffers always 32 bytes so neither the comparison time nor the
 * buffer length depends on the attacker-supplied input length.
 */
const NORMALIZE_KEY = randomBytes(32);

/**
 * Constant-time string comparison to prevent timing attacks. Used for
 * secret/signature validation throughout the worker (runs Node-side only).
 *
 * Both inputs are HMAC-SHA256'd to fixed 32-byte digests and compared with
 * Node's `crypto.timingSafeEqual`. Hashing first means the number of compared
 * bytes is constant (32) and independent of input length, so — unlike a raw
 * variable-length char-by-char scan — it leaks neither a length oracle nor
 * per-character timing on the compared secret.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const da = createHmac('sha256', NORMALIZE_KEY).update(String(a), 'utf8').digest();
  const db = createHmac('sha256', NORMALIZE_KEY).update(String(b), 'utf8').digest();
  return timingSafeEqual(da, db);
}
