/**
 * Secret resolution for self-host. Cloudflare Secret Store bindings exposed
 * `{ get(): Promise<string> }`; here secrets are plain `process.env` values.
 * `envSecret` wraps one in the `{get}` shape for the ~few call sites that call
 * `.get()` directly, so `lib/secrets.ts` (already polymorphic over
 * `string | {get}`) needs no change.
 */
export interface SecretStoreSecret {
  get(): Promise<string>;
}

export function envSecret(name: string, fallback = ''): SecretStoreSecret {
  return {
    async get() {
      return process.env[name] ?? fallback;
    },
  };
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
