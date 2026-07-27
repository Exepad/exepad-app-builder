/**
 * In-memory shim for the Cloudflare KV (`KVNamespace`) surface the app-backend
 * uses for rate limiting (get/put with `expirationTtl`, delete). Single-process,
 * so a plain Map with per-key expiry is sufficient.
 */
interface Entry {
  value: string;
  expiresAt: number | null;
}

export class KvShim {
  private store = new Map<string, Entry>();
  // Timestamp of the last full sweep; bootstrapped at construction time.
  private lastSweep = Date.now();
  // Minimum gap between opportunistic sweeps triggered from put().
  private static readonly SWEEP_INTERVAL_MS = 2 * 60 * 1000;

  /**
   * Drop every expired entry. Called opportunistically from put() so rate-limit
   * stores keyed by churning identities (e.g. per-IP) don't grow unbounded when
   * their entries are never get() again.
   */
  private sweep(now: number): void {
    for (const [k, entry] of this.store) {
      if (entry.expiresAt !== null && now > entry.expiresAt) this.store.delete(k);
    }
    this.lastSweep = now;
  }

  async get(key: string, _type?: 'text' | 'json'): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; expiration?: number },
  ): Promise<void> {
    const now = Date.now();
    let expiresAt: number | null = null;
    if (options?.expirationTtl) expiresAt = now + options.expirationTtl * 1000;
    else if (options?.expiration) expiresAt = options.expiration * 1000;
    this.store.set(key, { value, expiresAt });
    if (now - this.lastSweep >= KvShim.SWEEP_INTERVAL_MS) this.sweep(now);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}
