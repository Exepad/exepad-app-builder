import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  imageRef,
  renderCompose,
  renderCaddyfile,
  renderCaddyDnsDockerfile,
  mergeEnv,
  parseEnv,
  envUpdatesFromFlags,
  hasEnvKey,
  renderVersionMarker,
  parseVersionMarker,
} from './compose';
import { DNS_PROVIDER_MODULES } from './config';

describe('imageRef', () => {
  it('pins a tag with :', () => {
    expect(imageRef('1.4.2')).toBe('ghcr.io/exepad/exepad-app-builder:1.4.2');
  });
  it('pins a digest with @', () => {
    expect(imageRef('sha256:abc')).toBe('ghcr.io/exepad/exepad-app-builder@sha256:abc');
    expect(imageRef('@sha256:abc')).toBe('ghcr.io/exepad/exepad-app-builder@sha256:abc');
  });
});

describe('renderCompose', () => {
  it('pins the version and never floats :latest', () => {
    const yaml = renderCompose({ tag: '1.4.2', hostPort: 9000 });
    expect(yaml).toContain('image: ghcr.io/exepad/exepad-app-builder:1.4.2');
    expect(yaml).not.toContain('exepad:latest');
    expect(yaml).toContain('"9000:8080"');
    expect(yaml).toContain('exepad-data:/data');
  });
  it('defaults the host port to 8080', () => {
    expect(renderCompose({ tag: '1.0.0' })).toContain('"8080:8080"');
  });
  it('publishes ONLY the HTTP port — nothing listens on :8443 in the image (Caddy fronts TLS)', () => {
    const yaml = renderCompose({ tag: '1.0.0' });
    expect(yaml).not.toContain('8443');
    expect(yaml).toMatch(/--domain <your-domain>/);
  });
  // The published port IS the front door here and nothing terminates TLS in front of
  // it. With the in-image Caddy left on, docker/entrypoint.sh forces
  // EXEPAD_COOKIE_SECURE=1 (it thinks TLS fronts the runtime) and routes/auth.ts then
  // stamps `Secure` on the platform session cookie — which browsers refuse to store
  // over http://<lan-ip>:PORT, so login silently fails on everything but localhost.
  // Same reason deploy/docker-compose.yml and the app-store manifests set it.
  it('disables the in-image TLS front so plain-HTTP logins work off localhost', () => {
    const yaml = renderCompose({ tag: '1.0.0', hostPort: 9000 });
    expect(yaml).toMatch(/environment:\n(\s*#.*\n)*\s*- EXEPAD_HTTPS_DISABLE=1\n/);
  });
});

describe('renderCompose with --domain (Caddy sidecar)', () => {
  const yaml = renderCompose({ tag: '1.4.2', domain: 'app.example.com' });
  it('adds a caddy service on 80/443 and keeps the image pinned', () => {
    expect(yaml).toContain('caddy:');
    expect(yaml).toContain('image: caddy:2-alpine');
    expect(yaml).toContain('"80:80"');
    expect(yaml).toContain('"443:443"');
    expect(yaml).toContain('image: ghcr.io/exepad/exepad-app-builder:1.4.2');
  });
  it('makes the studio internal-only (expose, not ports)', () => {
    expect(yaml).toContain('expose:');
    expect(yaml).not.toContain('"8080:8080"');
  });
  it('declares the caddy cert/config volumes', () => {
    expect(yaml).toContain('caddy-data:');
    expect(yaml).toContain('caddy-config:');
  });
  // Inverse of the non-domain case: the sidecar terminates TLS and the studio is
  // never published in cleartext, so Secure cookies are correct — the flag that
  // turns the in-image TLS front off must NOT leak into this template.
  it('does NOT disable HTTPS (the sidecar fronts TLS; Secure cookies are correct)', () => {
    expect(yaml).not.toContain('EXEPAD_HTTPS_DISABLE');
  });
});

describe('renderCaddyfile', () => {
  it('proxies the domain to the studio service', () => {
    const cf = renderCaddyfile('app.example.com');
    expect(cf).toContain('app.example.com {');
    expect(cf).toContain('reverse_proxy exepad:8080');
    expect(cf).not.toContain('email');
  });
  it('adds a global ACME email block when provided', () => {
    const cf = renderCaddyfile('app.example.com', 'ops@example.com');
    expect(cf).toContain('email ops@example.com');
  });
  it('letsencrypt (default) does NOT add a tls/dns block', () => {
    const cf = renderCaddyfile('app.example.com', undefined, 'letsencrypt');
    expect(cf).not.toContain('tls {');
    expect(cf).not.toContain('dns ');
    expect(cf).not.toContain('auto_https off');
  });
});

describe('renderCaddyfile — DNS-01 (--tls dns)', () => {
  const cf = renderCaddyfile('app.example.com', 'ops@example.com', 'dns', 'cloudflare');
  it('emits a tls{} block doing DNS-01 via the provider + env token', () => {
    expect(cf).toContain('tls {');
    expect(cf).toContain('dns cloudflare {env.EXEPAD_DNS_TOKEN}');
    expect(cf).toContain('reverse_proxy exepad:8080');
  });
  it('keeps the ACME email and the domain site', () => {
    expect(cf).toContain('email ops@example.com');
    expect(cf).toContain('app.example.com {');
  });
  it('defaults the provider to cloudflare when omitted', () => {
    expect(renderCaddyfile('app.example.com', undefined, 'dns')).toContain('dns cloudflare');
  });
});

describe('renderCaddyfile — bring-your-own-cert (--tls byoc)', () => {
  const cf = renderCaddyfile('app.example.com', undefined, 'byoc');
  it('turns ACME off and serves a static mounted cert', () => {
    expect(cf).toContain('auto_https off');
    expect(cf).toContain('tls /etc/caddy/certs/cert.pem /etc/caddy/certs/key.pem');
    expect(cf).toContain('reverse_proxy exepad:8080');
  });
  it('adds a plain HTTP→HTTPS redirect and never contacts an ACME CA', () => {
    expect(cf).toContain(':80 {');
    expect(cf).toContain('redir https://{host}{uri} permanent');
    expect(cf).not.toContain('email');
    expect(cf).not.toContain('dns ');
  });
});

describe('renderCompose — DNS-01 (--tls dns)', () => {
  const yaml = renderCompose({ tag: '1.4.2', domain: 'app.example.com', tlsMode: 'dns', dnsProvider: 'cloudflare' });
  it('builds Caddy from the generated Dockerfile instead of pulling an image', () => {
    expect(yaml).toContain('build:');
    expect(yaml).toContain('dockerfile: Caddy.dns.Dockerfile');
    expect(yaml).not.toContain('image: caddy:2-alpine');
  });
  it('feeds the DNS token to caddy via a scoped env_file, NOT the shared .env', () => {
    expect(yaml).toContain('env_file:');
    expect(yaml).toContain('- ./caddy.env');
    // The token must not be interpolated through the project .env (which the studio reads).
    expect(yaml).not.toContain('${EXEPAD_DNS_TOKEN}');
  });
  it('keeps the studio internal-only and the image pinned', () => {
    expect(yaml).toContain('image: ghcr.io/exepad/exepad-app-builder:1.4.2');
    expect(yaml).toContain('expose:');
    expect(yaml).not.toContain('"8080:8080"');
  });
});

describe('renderCompose — bring-your-own-cert (--tls byoc)', () => {
  const yaml = renderCompose({ tag: '1.4.2', domain: 'app.example.com', tlsMode: 'byoc' });
  it('uses the stock caddy image and mounts ./certs read-only', () => {
    expect(yaml).toContain('image: caddy:2-alpine');
    expect(yaml).toContain('./certs:/etc/caddy/certs:ro');
    expect(yaml).not.toContain('build:');
    expect(yaml).not.toContain('EXEPAD_DNS_TOKEN');
  });
});

describe('renderCaddyDnsDockerfile', () => {
  it('compiles caddy with the providers xcaddy module (two-stage)', () => {
    const df = renderCaddyDnsDockerfile('cloudflare');
    expect(df).toContain('FROM caddy:2-builder AS build');
    expect(df).toContain('xcaddy build --with github.com/caddy-dns/cloudflare');
    expect(df).toContain('FROM caddy:2-alpine');
    expect(df).toContain('COPY --from=build /usr/bin/caddy /usr/bin/caddy');
  });
  it('falls back to the caddy-dns/<provider> module path for an unmapped name', () => {
    // route53 is intentionally NOT in DNS_PROVIDER_MODULES (multi-credential), so this
    // exercises the `?? github.com/caddy-dns/${provider}` fallback branch.
    expect(renderCaddyDnsDockerfile('route53')).toContain('github.com/caddy-dns/route53');
  });
});

describe('.env merge', () => {
  it('maps flags to EXEPAD_ env keys', () => {
    expect(envUpdatesFromFlags({ 'llm-key': 'k', 'llm-provider': 'gemini', other: 'x' })).toEqual({
      EXEPAD_LLM_API_KEY: 'k',
      EXEPAD_LLM_PROVIDER: 'gemini',
    });
  });
  it('preserves existing keys and overrides only provided ones', () => {
    const existing = '# c\nEXEPAD_LLM_API_KEY=old\nEXEPAD_ALLOWED_ORIGINS=https://x\n';
    const merged = mergeEnv(existing, { EXEPAD_LLM_API_KEY: 'new' });
    const map = parseEnv(merged);
    expect(map.get('EXEPAD_LLM_API_KEY')).toBe('new');
    expect(map.get('EXEPAD_ALLOWED_ORIGINS')).toBe('https://x');
    expect(merged).toContain('# Exepad operator config');
  });
  it('hasEnvKey checks updates and existing', () => {
    expect(hasEnvKey('EXEPAD_LLM_API_KEY=x\n', {}, 'EXEPAD_LLM_API_KEY')).toBe(true);
    expect(hasEnvKey('', { EXEPAD_LLM_API_KEY: 'y' }, 'EXEPAD_LLM_API_KEY')).toBe(true);
    expect(hasEnvKey('', {}, 'EXEPAD_LLM_API_KEY')).toBe(false);
  });
});

describe('version marker', () => {
  it('round-trips', () => {
    const m = { image: 'ghcr.io/exepad/exepad-app-builder', tag: '1.4.2', launcher: '1.4.2', hostPort: 8080, updatedAt: 'now' };
    expect(parseVersionMarker(renderVersionMarker(m))).toEqual(m);
  });
  it('round-trips with a domain (preserved across updates)', () => {
    const m = {
      image: 'ghcr.io/exepad/exepad-app-builder',
      tag: '1.4.2',
      launcher: '1.4.2',
      hostPort: 8080,
      domain: 'app.example.com',
      acmeEmail: 'ops@example.com',
      updatedAt: 'now',
    };
    expect(parseVersionMarker(renderVersionMarker(m))).toEqual(m);
  });
  it('round-trips the DNS-01 TLS mode + provider', () => {
    const m = {
      image: 'ghcr.io/exepad/exepad-app-builder',
      tag: '1.4.2',
      launcher: '1.4.2',
      hostPort: 8080,
      domain: 'app.example.com',
      tlsMode: 'dns' as const,
      dnsProvider: 'cloudflare',
      updatedAt: 'now',
    };
    expect(parseVersionMarker(renderVersionMarker(m))).toEqual(m);
  });
  it('returns null on garbage', () => {
    expect(parseVersionMarker('{not json')).toBeNull();
    expect(parseVersionMarker('{}')).toBeNull();
  });
});

// The committed repo-root turnkey DNS-01 files (Dockerfile.caddy-dns,
// Caddyfile.ondemand-dns, docker-compose.ondemand-dns.yml) are hand-maintained,
// not CLI-generated. Guard them against drifting from the CLI's source of truth.
describe('data volume name (backup/restore contract)', () => {
  // Without an explicit `name:`, compose PREFIXES the project (install-dir)
  // name — and backup/restore/README mount the literal "exepad-data", which
  // would silently hit an empty auto-created volume instead of the data.
  it('non-domain compose pins the literal volume name', () => {
    const yml = renderCompose({ tag: '1.0.0' });
    expect(yml).toMatch(/exepad-data:\n(\s*#.*\n)*\s*name: exepad-data/);
  });
  it('domain (Caddy) compose pins the literal volume name too', () => {
    const yml = renderCompose({ tag: '1.0.0', domain: 'x.example.com' });
    expect(yml).toMatch(/exepad-data:\n(\s*#.*\n)*\s*name: exepad-data/);
  });
});

describe('committed turnkey DNS-01 files (drift guard)', () => {
  const root = (p: string): string =>
    readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

  it('Dockerfile.caddy-dns compiles every curated caddy-dns provider module', () => {
    const df = root('Dockerfile.caddy-dns');
    for (const module of Object.values(DNS_PROVIDER_MODULES)) {
      expect(df).toContain(`--with ${module}`);
    }
    expect(df).toContain('FROM caddy:2-builder AS build');
    expect(df).toContain('COPY --from=build /usr/bin/caddy /usr/bin/caddy');
  });

  it('Caddyfile.ondemand-dns issues via DNS-01 and keeps the on-demand ask gate', () => {
    const cf = root('Caddyfile.ondemand-dns');
    expect(cf).toContain('acme_dns {$EXEPAD_DNS_PROVIDER} {env.EXEPAD_DNS_TOKEN}');
    // Host networking (83593cb): the worker is reached over loopback, not the
    // bridge DNS name, and the ask endpoint is gated by the shared ask key so
    // nothing else on the host can authorize cert issuance.
    expect(cf).toContain(
      'ask http://127.0.0.1:8080/internal/tls/authorize?key={$EXEPAD_ONDEMAND_TLS_ASK_KEY}',
    );
    expect(cf).toContain('on_demand');
  });

  it('docker-compose.ondemand-dns.yml builds the DNS image and keeps the token Caddy-only', () => {
    const yml = root('docker-compose.ondemand-dns.yml');
    expect(yml).toContain('dockerfile: Dockerfile.caddy-dns');
    expect(yml).toContain('./Caddyfile.ondemand-dns:/etc/caddy/Caddyfile:ro');
    expect(yml).toContain('caddy.env');
    // The domain-controlling token must never be set on the app (exepad) service.
    const exepadBlock = yml.slice(yml.indexOf('exepad:'), yml.indexOf('caddy:'));
    expect(exepadBlock).not.toMatch(/EXEPAD_DNS_TOKEN\s*[:=]/);
  });
});
