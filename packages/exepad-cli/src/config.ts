import { readFileSync } from 'node:fs';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

/** The launcher's own version (npm package version). Source of truth for lockstep. */
export const LAUNCHER_VERSION = pkg.version;

/**
 * GHCR image repository. The studio version is expressed as the image tag.
 * Overridable for forks/testing via EXEPAD_IMAGE.
 */
export const IMAGE_REPO = process.env.EXEPAD_IMAGE ?? 'ghcr.io/exepad/exepad-app-builder';

/**
 * The studio's plain-HTTP listener inside the container — the front door in BOTH
 * modes this CLI generates:
 *  - no --domain: published straight to the host with EXEPAD_HTTPS_DISABLE=1, which
 *    keeps the in-image Caddy off. That flag is load-bearing, not cosmetic: with
 *    Caddy running, docker/entrypoint.sh forces EXEPAD_COOKIE_SECURE=1 and the
 *    browser then drops the session cookie over http://<lan-ip>:PORT (see
 *    renderCompose).
 *  - --domain: kept internal (`expose`), with the Caddy sidecar terminating TLS
 *    in front of it and the runtime marking cookies Secure.
 * The old in-process :8443 listener runs in neither.
 */
export const CONTAINER_PORT = 8080;

/** Default host port the studio's plain HTTP is published on. */
export const DEFAULT_HOST_PORT = 8080;

/** Docker named volume holding ALL persistent state (/data). Survives image swaps. */
export const DATA_VOLUME = 'exepad-data';

/** Container + compose service name. */
export const CONTAINER_NAME = 'exepad';

/** TLS-terminating sidecar image used when `--domain` enables auto-HTTPS. */
export const CADDY_IMAGE = 'caddy:2-alpine';

/** Caddy builder image — compiles a DNS-plugin Caddy for DNS-01 ACME (`--tls dns`). */
export const CADDY_BUILDER_IMAGE = 'caddy:2-builder';

/** Generated Dockerfile that builds Caddy with the chosen DNS plugin (`--tls dns`). */
export const CADDY_DNS_DOCKERFILE = 'Caddy.dns.Dockerfile';

/** Install-dir subdir where the operator's own cert/key live (`--tls byoc`). */
export const CERTS_DIRNAME = 'certs';

/** Env var holding the DNS API token, read by the DNS-01 Caddyfile + passed to Caddy. */
export const DNS_TOKEN_ENV = 'EXEPAD_DNS_TOKEN';

/**
 * Env file holding ONLY the DNS token, mounted into the Caddy sidecar alone (not the
 * studio's shared .env) so a domain-controlling credential never reaches the app
 * container. Written 0600.
 */
export const CADDY_ENV_FILE = 'caddy.env';

/**
 * TLS strategies for the Caddy sidecar when `--domain` is set:
 *  - letsencrypt: ACME HTTP-01 (default) — needs public DNS + inbound :80/:443.
 *  - dns:         ACME DNS-01 — works behind NAT (no inbound ports for issuance);
 *                 Caddy is rebuilt with a `caddy-dns` provider plugin.
 *  - byoc:        bring-your-own-cert (internal CA / IT-issued) — no ACME at all.
 */
export const TLS_MODES = ['letsencrypt', 'dns', 'byoc'] as const;
export type TlsMode = (typeof TLS_MODES)[number];

export function isTlsMode(v: string): v is TlsMode {
  return (TLS_MODES as readonly string[]).includes(v);
}

/**
 * `caddy-dns` provider plugins for DNS-01, curated to SINGLE-API-TOKEN providers
 * where the Caddyfile directive is exactly `dns <provider> {env.EXEPAD_DNS_TOKEN}`
 * and the xcaddy module is `github.com/caddy-dns/<provider>`. Multi-credential
 * providers (route53, azure, google clouddns, namecheap…) need a hand-edited
 * Caddyfile — those operators should use `--tls byoc` or edit the generated file.
 */
export const DNS_PROVIDER_MODULES: Record<string, string> = {
  cloudflare: 'github.com/caddy-dns/cloudflare',
  digitalocean: 'github.com/caddy-dns/digitalocean',
  gandi: 'github.com/caddy-dns/gandi',
  hetzner: 'github.com/caddy-dns/hetzner',
  linode: 'github.com/caddy-dns/linode',
  vultr: 'github.com/caddy-dns/vultr',
  duckdns: 'github.com/caddy-dns/duckdns',
  desec: 'github.com/caddy-dns/desec',
};

/** The xcaddy module path for a DNS provider, or undefined if unsupported. */
export function caddyDnsModule(provider: string): string | undefined {
  return DNS_PROVIDER_MODULES[provider];
}

/** Comma list of supported DNS-01 providers, for help/error text. */
export function dnsProviderList(): string {
  return Object.keys(DNS_PROVIDER_MODULES).join(', ');
}

/** Minimum host RAM (GB); doctor warns below this (build peaks at 2-3 GB). */
export const MIN_RAM_GB = 2;

/**
 * Architectures the published image supports (Node `os.arch()` names).
 * Multi-arch via buildx (Track A.3): amd64 + arm64.
 */
export const SUPPORTED_ARCHS = ['x64', 'arm64'];

/** Pure arch guard (Node `os.arch()` value), so the check is unit-testable. */
export function isArchSupported(arch: string): boolean {
  return SUPPORTED_ARCHS.includes(arch);
}

/** Default install directory (compose + .env + version marker live here). */
export const DEFAULT_HOME_DIRNAME = '.exepad';
