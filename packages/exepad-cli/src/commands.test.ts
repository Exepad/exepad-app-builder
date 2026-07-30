import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import type { Context, ExecResult, ExecOptions } from './context';
import { deploy, backup, stop, start, restart, down, restore } from './commands';
import { renderVersionMarker } from './compose';

interface ExecCall {
  file: string;
  args: string[];
  opts?: ExecOptions;
}

interface Fake {
  ctx: Context;
  calls: ExecCall[];
  files: Map<string, string>;
  dirs: string[];
  removed: string[];
  out: string[];
  err: string[];
}

function makeFake(opts: {
  dryRun?: boolean;
  files?: Record<string, string>;
  exec?: (file: string, args: string[]) => ExecResult | undefined;
} = {}): Fake {
  const files = new Map(Object.entries(opts.files ?? {}));
  const calls: ExecCall[] = [];
  const dirs: string[] = [];
  const removed: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const dryRun = opts.dryRun ?? false;

  const ctx: Context = {
    dryRun,
    assumeYes: true, // tests are non-interactive
    env: {},
    now: () => new Date('2026-06-18T00:00:00.000Z'),
    exec(file, args, execOpts) {
      calls.push({ file, args, opts: execOpts });
      return opts.exec?.(file, args) ?? { code: 0, stdout: 'ok', stderr: '' };
    },
    out: (m = '') => out.push(m),
    err: (m) => err.push(m),
    confirm: async () => true,
    promptLine: async () => '',
    readFile: (p) => (files.has(p) ? files.get(p)! : null),
    writeFile: (p, c) => {
      if (dryRun) return; // mirror real context: dry-run skips writes
      files.set(p, c);
    },
    removeFile: (p) => {
      removed.push(p);
      files.delete(p);
    },
    ensureDir: (p) => {
      dirs.push(p);
    },
    exists: (p) => files.has(p),
  };
  return { ctx, calls, files, dirs, removed, out, err };
}

const DIR = '/tmp/exepad-test';
const composePath = join(DIR, 'docker-compose.yml');
const caddyfilePath = join(DIR, 'Caddyfile');
const dnsDockerfilePath = join(DIR, 'Caddy.dns.Dockerfile');
const caddyEnvPath = join(DIR, 'caddy.env');
const certPath = join(DIR, 'certs', 'cert.pem');
const keyPath = join(DIR, 'certs', 'key.pem');
const envPath = join(DIR, '.env');
const markerPath = join(DIR, '.exepad-version');

function markerFor(tag: string): string {
  return renderVersionMarker({
    image: 'ghcr.io/exepad/exepad-app-builder',
    tag,
    launcher: tag,
    hostPort: 8080,
    updatedAt: 'old',
  });
}

function ranComposeUp(calls: ExecCall[]): boolean {
  return calls.some((c) => c.file === 'docker' && c.args.join(' ') === 'compose up -d');
}

function ranComposeUpBuild(calls: ExecCall[]): boolean {
  return calls.some((c) => c.file === 'docker' && c.args.join(' ') === 'compose up -d --build');
}

describe('deploy: fresh install', () => {
  it('writes a pinned compose + marker and runs pull/up', async () => {
    const f = makeFake();
    const code = await deploy(f.ctx, { dir: DIR, to: '1.2.3', 'llm-key': 'k' }, 'up');
    expect(code).toBe(0);
    expect(f.files.get(composePath)).toContain('image: ghcr.io/exepad/exepad-app-builder:1.2.3');
    expect(f.files.get(composePath)).not.toContain('exepad:latest');
    // Nothing terminates TLS in front of the published port here, so the in-image
    // Caddy must stay off — otherwise the entrypoint forces Secure session cookies
    // and login silently fails over http://<lan-ip>:PORT (see compose.test.ts).
    expect(f.files.get(composePath)).toContain('EXEPAD_HTTPS_DISABLE=1');
    expect(ranComposeUp(f.calls)).toBe(true);
    expect(f.files.get(markerPath)).toContain('"tag": "1.2.3"');
    // pull runs with the install dir as cwd
    const pull = f.calls.find((c) => c.args.join(' ') === 'compose pull');
    expect(pull?.opts?.cwd).toBe(DIR);
  });
});

describe('deploy: downgrade guard', () => {
  it('refuses a downgrade without --force and does NOT start anything', async () => {
    const f = makeFake({ files: { [markerPath]: markerFor('2.0.0') } });
    const code = await deploy(f.ctx, { dir: DIR, to: '1.0.0' }, 'update');
    expect(code).toBe(1);
    expect(f.err.join('\n')).toContain('Refusing downgrade');
    expect(ranComposeUp(f.calls)).toBe(false);
  });

  it('allows a downgrade with --force (after warning)', async () => {
    const f = makeFake({ files: { [markerPath]: markerFor('2.0.0') } });
    const code = await deploy(f.ctx, { dir: DIR, to: '1.0.0', force: true }, 'update');
    expect(code).toBe(0);
    expect(f.err.join('\n')).toContain('Forcing downgrade');
    expect(ranComposeUp(f.calls)).toBe(true);
  });
});

describe('deploy: update without an install', () => {
  it('errors instead of installing', async () => {
    const f = makeFake();
    const code = await deploy(f.ctx, { dir: DIR }, 'update');
    expect(code).toBe(1);
    expect(f.err.join('\n')).toContain('No existing install');
    expect(ranComposeUp(f.calls)).toBe(false);
  });
});

describe('deploy: --domain (HTTPS via Caddy)', () => {
  it('writes a Caddyfile, a caddy compose, and secure-cookie env', async () => {
    const f = makeFake();
    const code = await deploy(
      f.ctx,
      { dir: DIR, to: '1.4.2', 'llm-key': 'k', domain: 'app.example.com', 'acme-email': 'ops@example.com' },
      'up',
    );
    expect(code).toBe(0);
    expect(f.files.get(composePath)).toContain('image: caddy:2-alpine');
    expect(f.files.get(caddyfilePath)).toContain('reverse_proxy exepad:8080');
    const env = f.files.get(envPath)!;
    expect(env).toContain('EXEPAD_COOKIE_SECURE=1');
    expect(env).toContain('EXEPAD_ALLOWED_ORIGINS=https://app.example.com');
    expect(f.files.get(markerPath)).toContain('"domain": "app.example.com"');
    expect(f.out.join('\n')).toContain('https://app.example.com');
  });

  it('update preserves the domain from the marker (no --domain needed)', async () => {
    const prior = renderVersionMarker({
      image: 'ghcr.io/exepad/exepad-app-builder',
      tag: '1.4.2',
      launcher: '1.4.2',
      hostPort: 8080,
      domain: 'app.example.com',
      updatedAt: 'old',
    });
    const f = makeFake({ files: { [markerPath]: prior } });
    const code = await deploy(f.ctx, { dir: DIR, to: '1.5.0' }, 'update');
    expect(code).toBe(0);
    expect(f.files.get(composePath)).toContain('image: caddy:2-alpine');
    expect(f.files.get(caddyfilePath)).toContain('app.example.com');
    expect(f.files.get(markerPath)).toContain('"domain": "app.example.com"');
  });
});

describe('deploy: --tls dns (DNS-01, behind NAT)', () => {
  it('writes a DNS Caddyfile + plugin Dockerfile, scopes the token to caddy.env, builds on up', async () => {
    const f = makeFake();
    const code = await deploy(
      f.ctx,
      {
        dir: DIR, to: '1.4.2', 'llm-key': 'k',
        domain: 'app.example.com', 'acme-email': 'ops@example.com',
        tls: 'dns', 'dns-provider': 'cloudflare', 'dns-token': 'cf-token-123',
      },
      'up',
    );
    expect(code).toBe(0);
    expect(f.files.get(composePath)).toContain('dockerfile: Caddy.dns.Dockerfile');
    expect(f.files.get(composePath)).toContain('- ./caddy.env');
    expect(f.files.get(dnsDockerfilePath)).toContain('xcaddy build --with github.com/caddy-dns/cloudflare');
    expect(f.files.get(caddyfilePath)).toContain('dns cloudflare {env.EXEPAD_DNS_TOKEN}');
    // Token goes ONLY into the caddy-scoped env file, never the studio's shared .env.
    expect(f.files.get(caddyEnvPath)).toContain('EXEPAD_DNS_TOKEN=cf-token-123');
    expect(f.files.get(envPath)).not.toContain('EXEPAD_DNS_TOKEN');
    const marker = f.files.get(markerPath)!;
    expect(marker).toContain('"tlsMode": "dns"');
    expect(marker).toContain('"dnsProvider": "cloudflare"');
    expect(ranComposeUpBuild(f.calls)).toBe(true);
  });

  it('pulls only the studio service (not the build-only caddy) so the pull cannot abort', async () => {
    const f = makeFake();
    await deploy(
      f.ctx,
      { dir: DIR, to: '1.4.2', 'llm-key': 'k', domain: 'app.example.com', tls: 'dns', 'dns-provider': 'cloudflare', 'dns-token': 't' },
      'up',
    );
    const pull = f.calls.find((c) => c.args[0] === 'compose' && c.args[1] === 'pull');
    // `compose pull exepad` targets the named studio image only; works on any Compose v2.
    expect(pull?.args).toEqual(['compose', 'pull', 'exepad']);
  });

  it('hard-fails (no wasted build) when no DNS token is available', async () => {
    const f = makeFake();
    const code = await deploy(
      f.ctx,
      { dir: DIR, to: '1.4.2', 'llm-key': 'k', domain: 'app.example.com', tls: 'dns', 'dns-provider': 'cloudflare' },
      'up',
    );
    expect(code).toBe(1);
    expect(f.err.join('\n')).toContain('requires a DNS API token');
    expect(ranComposeUp(f.calls)).toBe(false);
    expect(ranComposeUpBuild(f.calls)).toBe(false);
  });

  it('requires --dns-provider', async () => {
    const f = makeFake();
    const code = await deploy(f.ctx, { dir: DIR, to: '1.4.2', domain: 'app.example.com', tls: 'dns' }, 'up');
    expect(code).toBe(1);
    expect(f.err.join('\n')).toContain('requires --dns-provider');
    expect(ranComposeUp(f.calls)).toBe(false);
    expect(ranComposeUpBuild(f.calls)).toBe(false);
  });

  it('rejects an unsupported provider', async () => {
    const f = makeFake();
    const code = await deploy(
      f.ctx,
      { dir: DIR, to: '1.4.2', domain: 'app.example.com', tls: 'dns', 'dns-provider': 'route53', 'dns-token': 't' },
      'up',
    );
    expect(code).toBe(1);
    expect(f.err.join('\n')).toContain('Unknown --dns-provider');
  });

  it('update preserves the DNS mode + provider and reuses the stored token', async () => {
    const prior = renderVersionMarker({
      image: 'ghcr.io/exepad/exepad-app-builder',
      tag: '1.4.2', launcher: '1.4.2', hostPort: 8080,
      domain: 'app.example.com', tlsMode: 'dns', dnsProvider: 'cloudflare',
      updatedAt: 'old',
    });
    // The token was written to caddy.env on the original `up`; update must reuse it.
    const f = makeFake({ files: { [markerPath]: prior, [caddyEnvPath]: 'EXEPAD_DNS_TOKEN=stored\n' } });
    const code = await deploy(f.ctx, { dir: DIR, to: '1.5.0' }, 'update');
    expect(code).toBe(0);
    expect(f.files.get(composePath)).toContain('dockerfile: Caddy.dns.Dockerfile');
    expect(f.files.get(dnsDockerfilePath)).toContain('caddy-dns/cloudflare');
    expect(f.files.get(caddyEnvPath)).toContain('EXEPAD_DNS_TOKEN=stored');
    expect(f.files.get(markerPath)).toContain('"tlsMode": "dns"');
  });
});

describe('deploy: --tls byoc (bring-your-own-cert)', () => {
  it('stages (does NOT start a crash-looping caddy) when no cert is present yet', async () => {
    const f = makeFake();
    const code = await deploy(
      f.ctx,
      { dir: DIR, to: '1.4.2', 'llm-key': 'k', domain: 'app.example.com', tls: 'byoc' },
      'up',
    );
    expect(code).toBe(0);
    expect(f.files.get(composePath)).toContain('./certs:/etc/caddy/certs:ro');
    expect(f.files.get(composePath)).toContain('image: caddy:2-alpine');
    expect(f.files.get(caddyfilePath)).toContain('auto_https off');
    expect(f.files.has(dnsDockerfilePath)).toBe(false);
    expect(f.dirs).toContain(join(DIR, 'certs')); // certs dir was created for the operator
    expect(f.files.get(markerPath)).toContain('"tlsMode": "byoc"'); // marker persisted while staged
    expect(f.out.join('\n')).toContain('NOT started yet');
    expect(ranComposeUp(f.calls)).toBe(false); // crucially, nothing was started
  });

  it('starts normally once the cert is in place', async () => {
    const f = makeFake({ files: { [certPath]: 'CERT', [keyPath]: 'KEY' } });
    const code = await deploy(
      f.ctx,
      { dir: DIR, to: '1.4.2', 'llm-key': 'k', domain: 'app.example.com', tls: 'byoc' },
      'up',
    );
    expect(code).toBe(0);
    expect(ranComposeUp(f.calls)).toBe(true);
    expect(f.out.join('\n')).toContain('is up → https://app.example.com');
  });
});

describe('deploy: switching TLS mode on update', () => {
  it('dns → byoc removes the stale plugin Dockerfile and token file', async () => {
    const prior = renderVersionMarker({
      image: 'ghcr.io/exepad/exepad-app-builder',
      tag: '1.4.2', launcher: '1.4.2', hostPort: 8080,
      domain: 'app.example.com', tlsMode: 'dns', dnsProvider: 'cloudflare',
      updatedAt: 'old',
    });
    const f = makeFake({
      files: {
        [markerPath]: prior,
        [dnsDockerfilePath]: 'FROM caddy:2-builder',
        [caddyEnvPath]: 'EXEPAD_DNS_TOKEN=secret\n',
        [certPath]: 'CERT', [keyPath]: 'KEY', // certs present so byoc actually starts
      },
    });
    const code = await deploy(f.ctx, { dir: DIR, to: '1.4.2', tls: 'byoc' }, 'update');
    expect(code).toBe(0);
    expect(f.removed).toContain(dnsDockerfilePath);
    expect(f.removed).toContain(caddyEnvPath); // domain-controlling token must not linger
    expect(f.files.get(composePath)).toContain('./certs:/etc/caddy/certs:ro');
    expect(f.files.get(composePath)).not.toContain('Caddy.dns.Dockerfile');
    expect(f.files.get(markerPath)).toContain('"tlsMode": "byoc"');
  });
});

describe('deploy: --tls validation', () => {
  it('rejects an invalid --tls mode', async () => {
    const f = makeFake();
    const code = await deploy(f.ctx, { dir: DIR, to: '1.4.2', domain: 'app.example.com', tls: 'bogus' }, 'up');
    expect(code).toBe(1);
    expect(f.err.join('\n')).toContain('Invalid --tls');
    expect(ranComposeUp(f.calls)).toBe(false);
  });

  it('rejects --tls without --domain', async () => {
    const f = makeFake();
    const code = await deploy(f.ctx, { dir: DIR, to: '1.4.2', tls: 'byoc' }, 'up');
    expect(code).toBe(1);
    expect(f.err.join('\n')).toContain('--tls requires --domain');
  });
});

describe('deploy: moving channel tag', () => {
  it('warns that it is not reproducible', async () => {
    const f = makeFake();
    const code = await deploy(f.ctx, { dir: DIR, channel: 'edge', 'llm-key': 'k' }, 'up');
    expect(code).toBe(0);
    expect(f.files.get(composePath)).toContain('image: ghcr.io/exepad/exepad-app-builder:edge');
    expect(f.out.join('\n')).toContain('not reproducible');
  });
});

describe('deploy: --dry-run', () => {
  it('makes no writes but still reports success', async () => {
    const f = makeFake({ dryRun: true });
    const code = await deploy(f.ctx, { dir: DIR, to: '1.2.3', 'llm-key': 'k' }, 'up');
    expect(code).toBe(0);
    expect(f.files.has(composePath)).toBe(false);
    expect(f.files.has(markerPath)).toBe(false);
  });
});

describe('deploy: preflight blocks when NO engine is present', () => {
  it('returns 1 and never pulls when both docker and podman are missing', async () => {
    const f = makeFake({
      exec: (file, args) => {
        // Neither engine exists on this host.
        if ((file === 'docker' || file === 'podman') && args[0] === '--version')
          return { code: 127, stdout: '', stderr: 'not found' };
        return undefined;
      },
    });
    const code = await deploy(f.ctx, { dir: DIR, to: '1.2.3' }, 'up');
    expect(code).toBe(1);
    expect(f.err.join('\n')).toContain('Docker');
    expect(ranComposeUp(f.calls)).toBe(false);
  });
});

describe('deploy: podman fallback (runtime-neutral)', () => {
  // docker absent, podman healthy → the whole deploy drives `podman compose …`.
  const podmanOnly = (file: string, args: string[]): ExecResult | undefined => {
    if (file === 'docker') return { code: 127, stdout: '', stderr: 'not found' };
    if (file === 'podman' && args[0] === '--version') return { code: 0, stdout: 'podman version 5.5.0', stderr: '' };
    return undefined; // podman compose/info/etc → default success
  };

  it('pulls and ups via podman, and prints the podman caveats', async () => {
    const f = makeFake({ exec: podmanOnly });
    const code = await deploy(f.ctx, { dir: DIR, to: '1.2.3', 'llm-key': 'k' }, 'up');
    expect(code).toBe(0);
    const podmanCalls = f.calls.filter((c) => c.file === 'podman').map((c) => c.args.join(' '));
    expect(podmanCalls).toContain('compose pull');
    expect(podmanCalls).toContain('compose up -d');
    // No docker mutation may run when podman is the engine.
    expect(f.calls.some((c) => c.file === 'docker' && c.args[0] === 'compose')).toBe(false);
    // The two verified Podman/Docker divergences are surfaced to the operator.
    const outText = f.out.join('\n');
    expect(outText).toContain('podman-restart.service');
    expect(outText).toContain('ip_unprivileged_port_start');
  });
});

describe('lifecycle verbs: stop / start / restart / down', () => {
  const withInstall = () => makeFake({ files: { [composePath]: 'services: {}' } });

  it('stop runs `compose stop` (graceful pause) — NOT `compose down`', () => {
    const f = withInstall();
    const code = stop(f.ctx, { dir: DIR });
    expect(code).toBe(0);
    const a = argsOf(f.calls);
    expect(a).toContain('compose stop');
    expect(a).not.toContain('compose down');
  });

  it('start runs `compose start`', () => {
    const f = withInstall();
    expect(start(f.ctx, { dir: DIR })).toBe(0);
    expect(argsOf(f.calls)).toContain('compose start');
  });

  it('restart runs `compose restart`', () => {
    const f = withInstall();
    expect(restart(f.ctx, { dir: DIR })).toBe(0);
    expect(argsOf(f.calls)).toContain('compose restart');
  });

  it('down still tears down (container removed, volume kept)', () => {
    const f = withInstall();
    expect(down(f.ctx, { dir: DIR })).toBe(0);
    expect(argsOf(f.calls)).toContain('compose down');
    expect(f.out.join('\n')).toContain('data volume preserved');
  });

  it('every verb refuses to run without an install dir', () => {
    for (const fn of [stop, start, restart, down]) {
      const f = makeFake(); // no compose file
      expect(fn(f.ctx, { dir: DIR })).toBe(1);
      expect(f.err.join('\n')).toContain('No install found');
      expect(f.calls.filter((c) => c.args[0] === 'compose')).toHaveLength(0);
    }
  });

  it('start hints `exepad up` when there is nothing to resume', () => {
    const f = makeFake({
      files: { [composePath]: 'services: {}' },
      exec: (file, args) =>
        args.join(' ') === 'compose start' ? { code: 1, stdout: '', stderr: 'no container' } : undefined,
    });
    expect(start(f.ctx, { dir: DIR })).toBe(1);
    expect(f.err.join('\n')).toContain('exepad up');
  });
});

describe('update: backup-first safety net', () => {
  const installedFiles = () => ({
    [composePath]: 'services: {}',
    [markerPath]: markerFor('1.0.0'),
  });

  it('snapshots /data (stop → tar → start) BEFORE pulling the new image', async () => {
    const f = makeFake({ files: installedFiles() });
    const code = await deploy(f.ctx, { dir: DIR, to: '1.1.0' }, 'update');
    expect(code).toBe(0);
    const a = argsOf(f.calls);
    const tarIdx = a.findIndex((x) => x.startsWith('run --rm'));
    const pullIdx = a.indexOf('compose pull');
    expect(tarIdx).toBeGreaterThanOrEqual(0); // backup ran
    expect(pullIdx).toBeGreaterThan(tarIdx); // and strictly before the pull
  });

  it('--no-backup skips the snapshot', async () => {
    const f = makeFake({ files: installedFiles() });
    const code = await deploy(f.ctx, { dir: DIR, to: '1.1.0', 'no-backup': true }, 'update');
    expect(code).toBe(0);
    expect(argsOf(f.calls).some((x) => x.startsWith('run --rm'))).toBe(false);
  });

  it('a failed backup ABORTS the update (no pull, no up)', async () => {
    const f = makeFake({
      files: installedFiles(),
      exec: (file, args) =>
        args[0] === 'run' ? { code: 2, stdout: '', stderr: 'tar boom' } : undefined,
    });
    const code = await deploy(f.ctx, { dir: DIR, to: '1.1.0' }, 'update');
    expect(code).toBe(2);
    expect(argsOf(f.calls)).not.toContain('compose pull');
    expect(f.err.join('\n')).toContain('update aborted');
  });

  it('same-version update (config re-apply) does not trigger a backup', async () => {
    const f = makeFake({ files: installedFiles() });
    const code = await deploy(f.ctx, { dir: DIR, to: '1.0.0' }, 'update');
    expect(code).toBe(0);
    expect(argsOf(f.calls).some((x) => x.startsWith('run --rm'))).toBe(false);
  });

  it('--no-stop does NOT leak into the safety backup (it must stay quiesced)', async () => {
    // `--no-stop` is a `backup`-command flag; forwarded into the pre-update
    // snapshot it would produce a hot, torn copy of live WAL SQLite — the one
    // rollback artifact would be corrupt exactly when it is needed.
    const f = makeFake({ files: installedFiles() });
    const code = await deploy(f.ctx, { dir: DIR, to: '1.1.0', 'no-stop': true }, 'update');
    expect(code).toBe(0);
    const a = argsOf(f.calls);
    const stopIdx = a.indexOf('compose stop');
    const tarIdx = a.findIndex((x) => x.startsWith('run --rm'));
    expect(stopIdx).toBeGreaterThanOrEqual(0); // quiesced despite --no-stop
    expect(tarIdx).toBeGreaterThan(stopIdx);
  });
});

describe('engine persistence (marker-recorded engine)', () => {
  const podmanOnly = (file: string, args: string[]): ExecResult | undefined => {
    if (file === 'docker') return { code: 127, stdout: '', stderr: 'not found' };
    if (file === 'podman' && args[0] === '--version') return { code: 0, stdout: 'podman version 5.5.0', stderr: '' };
    return undefined;
  };

  it('deploy records the engine in the version marker', async () => {
    const f = makeFake({ exec: podmanOnly });
    const code = await deploy(f.ctx, { dir: DIR, to: '1.2.3', 'llm-key': 'k' }, 'up');
    expect(code).toBe(0);
    expect(f.files.get(markerPath)).toContain('"engine": "podman"');
  });

  it('lifecycle verbs prefer the recorded engine over fresh detection', () => {
    // Podman-deployed install; docker gets installed LATER. Fresh detection
    // would prefer docker and drive the wrong (empty) instance — silently
    // producing empty backups. The marker must win while podman still works.
    const podmanMarker = renderVersionMarker({
      image: 'ghcr.io/exepad/exepad-app-builder',
      tag: '1.0.0',
      launcher: '1.0.0',
      hostPort: 8080,
      engine: 'podman',
      updatedAt: 'old',
    });
    const f = makeFake({
      files: { [composePath]: 'services: {}', [markerPath]: podmanMarker },
      // BOTH engines answer --version (docker was installed after deploy).
      exec: (file, args) =>
        args[0] === '--version' ? { code: 0, stdout: `${file} version x`, stderr: '' } : undefined,
    });
    expect(stop(f.ctx, { dir: DIR })).toBe(0);
    const composeCalls = f.calls.filter((c) => c.args[0] === 'compose');
    expect(composeCalls).toHaveLength(1);
    expect(composeCalls[0]!.file).toBe('podman'); // marker wins over docker-preferred detection
  });
});

describe('restore: the rollback path', () => {
  const BACKUP = '/tmp/backups/exepad-data-x.tgz';
  const installed = () => ({
    [composePath]: 'services: {}',
    [markerPath]: markerFor('1.1.0'),
    [BACKUP]: 'tarball-bytes',
  });

  it('downs, wipes+untars the volume, then brings the studio back up', async () => {
    const f = makeFake({ files: installed() });
    const code = await restore(f.ctx, { dir: DIR }, [BACKUP]);
    expect(code).toBe(0);
    const a = argsOf(f.calls);
    const downIdx = a.indexOf('compose down');
    const wipeIdx = a.findIndex((x) => x.startsWith('run --rm') && x.includes('find /data -mindepth 1 -delete'));
    const upIdx = a.indexOf('compose up -d');
    expect(downIdx).toBeGreaterThanOrEqual(0);
    expect(wipeIdx).toBeGreaterThan(downIdx);
    expect(upIdx).toBeGreaterThan(wipeIdx);
  });

  it('with --to it re-deploys at the pinned older tag (forced, no re-backup)', async () => {
    const f = makeFake({ files: installed() });
    const code = await restore(f.ctx, { dir: DIR, to: '1.0.0' }, [BACKUP]);
    expect(code).toBe(0);
    // The downgrade guard must not block (restore sets force), and the compose
    // must now pin the older tag.
    expect(f.files.get(composePath)).toContain(':1.0.0');
    // No second safety backup of the just-restored volume.
    const tarCreates = argsOf(f.calls).filter((x) => x.startsWith('run --rm') && x.includes('tar czf'));
    expect(tarCreates).toHaveLength(0);
  });

  it('refuses a missing backup file', async () => {
    const f = makeFake({ files: { [composePath]: 'services: {}' } });
    const code = await restore(f.ctx, { dir: DIR }, ['/nope/missing.tgz']);
    expect(code).toBe(1);
    expect(f.err.join('\n')).toContain('not found');
    expect(argsOf(f.calls)).not.toContain('compose down');
  });

  it('requires the backup path argument', async () => {
    const f = makeFake({ files: { [composePath]: 'services: {}' } });
    const code = await restore(f.ctx, { dir: DIR }, []);
    expect(code).toBe(2);
    expect(f.err.join('\n')).toContain('Usage');
  });

  it('never interpolates the archive filename into the shell (space/metachar-proof)', async () => {
    const evil = '/tmp/backups/exepad backup; rm -rf $(x).tgz';
    const f = makeFake({ files: { ...installed(), [evil]: 'tarball-bytes' } });
    const code = await restore(f.ctx, { dir: DIR }, [evil]);
    expect(code).toBe(0);
    const run = f.calls.find((c) => c.args[0] === 'run');
    expect(run).toBeDefined();
    // The file rides in as ONE -v mount arg at a FIXED in-container path…
    expect(run!.args).toContain(`${evil}:/backup/restore.tgz:ro`);
    // …and the sh -c script is a CONSTANT: no user-controlled text inside it.
    const script = run!.args[run!.args.length - 1]!;
    expect(script).not.toContain('exepad backup');
    expect(script).toContain('tar tzf /backup/restore.tgz');
  });

  it('validates the archive BEFORE wiping the volume (tar tzf gates find -delete)', async () => {
    const f = makeFake({ files: installed() });
    await restore(f.ctx, { dir: DIR }, [BACKUP]);
    const script = f.calls.find((c) => c.args[0] === 'run')!.args.at(-1)!;
    const probe = script.indexOf('tar tzf');
    const wipe = script.indexOf('find /data -mindepth 1 -delete');
    expect(probe).toBeGreaterThanOrEqual(0);
    expect(wipe).toBeGreaterThan(probe); // unreadable archive aborts with /data intact
  });

  it('--to with no version marker aborts BEFORE any destructive step', async () => {
    // compose file exists but the marker is gone: the deploy delegation would
    // fail AFTER the wipe — so the guard must fire first.
    const f = makeFake({ files: { [composePath]: 'services: {}', [BACKUP]: 'tarball-bytes' } });
    const code = await restore(f.ctx, { dir: DIR, to: '1.0.0' }, [BACKUP]);
    expect(code).toBe(1);
    expect(f.err.join('\n')).toContain('.exepad-version');
    expect(argsOf(f.calls)).not.toContain('compose down');
    expect(argsOf(f.calls).some((x) => x.startsWith('run --rm'))).toBe(false);
  });
});

function argsOf(calls: ExecCall[]): string[] {
  return calls.filter((c) => c.file === 'docker').map((c) => c.args.join(' '));
}

describe('backup: quiesce the WAL SQLite before tarring', () => {
  it('stops the container, tars, then restarts (consistent snapshot)', () => {
    const f = makeFake({ files: { [composePath]: 'services: {}' } });
    const code = backup(f.ctx, { dir: DIR });
    expect(code).toBe(0);
    const a = argsOf(f.calls);
    const stopIdx = a.indexOf('compose stop');
    const tarIdx = a.findIndex((x) => x.startsWith('run --rm'));
    const startIdx = a.indexOf('compose start');
    // stop BEFORE tar BEFORE start — the WAL is checkpointed on graceful stop.
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(tarIdx).toBeGreaterThan(stopIdx);
    expect(startIdx).toBeGreaterThan(tarIdx);
  });

  it('--no-stop skips the stop/start and warns about a live snapshot', () => {
    const f = makeFake({ files: { [composePath]: 'services: {}' } });
    const code = backup(f.ctx, { dir: DIR, 'no-stop': true });
    expect(code).toBe(0);
    const a = argsOf(f.calls);
    expect(a).not.toContain('compose stop');
    expect(a).not.toContain('compose start');
    expect(f.err.join('\n')).toContain('--no-stop');
  });

  it('restarts the container even when tar fails', () => {
    const f = makeFake({
      files: { [composePath]: 'services: {}' },
      exec: (file, args) =>
        file === 'docker' && args[0] === 'run'
          ? { code: 2, stdout: '', stderr: 'tar boom' }
          : undefined,
    });
    const code = backup(f.ctx, { dir: DIR });
    expect(code).toBe(2);
    // A failed backup must never leave the studio down.
    expect(argsOf(f.calls)).toContain('compose start');
  });

  it('warns and skips stop when no install is present in dir', () => {
    const f = makeFake();
    const code = backup(f.ctx, { dir: DIR });
    expect(code).toBe(0);
    const a = argsOf(f.calls);
    expect(a).not.toContain('compose stop');
    expect(f.err.join('\n')).toContain('No install found');
  });
});
