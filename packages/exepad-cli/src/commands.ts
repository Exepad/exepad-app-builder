import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';
import type { Context } from './context';
import {
  DEFAULT_HOME_DIRNAME,
  DEFAULT_HOST_PORT,
  IMAGE_REPO,
  LAUNCHER_VERSION,
  DATA_VOLUME,
  CONTAINER_NAME,
  CADDY_DNS_DOCKERFILE,
  CADDY_ENV_FILE,
  CERTS_DIRNAME,
  DNS_TOKEN_ENV,
  TLS_MODES,
  isTlsMode,
  caddyDnsModule,
  dnsProviderList,
  type TlsMode,
} from './config';
import {
  renderCompose,
  renderCaddyfile,
  renderCaddyDnsDockerfile,
  mergeEnv,
  parseEnv,
  envUpdatesFromFlags,
  hasEnvKey,
  renderVersionMarker,
  parseVersionMarker,
  imageRef,
  type VersionMarker,
} from './compose';
import { classifyChange, isSemver, isDigest } from './version';
import { runChecks, detectEngine, type DoctorReport, type Engine } from './system';

type Flags = Record<string, string | boolean>;

/**
 * Engine for the lifecycle verbs. Prefers the engine RECORDED in the install's
 * version marker at deploy time: fresh detection prefers docker, so installing
 * Docker later on a Podman-deployed host (or vice versa) would silently point
 * stop/backup/restore at the wrong engine's containers and volumes — an engine
 * mismatch makes `backup` archive an EMPTY volume. Falls back to detection
 * (markerless/new installs), then to 'docker' so a missing binary fails with a
 * clear "command not found" rather than a null-deref.
 */
function verbEngine(ctx: Context, dir: string): Engine {
  const recorded = readMarker(ctx, dir)?.engine;
  if (recorded && ctx.exec(recorded, ['--version']).code === 0) return recorded;
  return detectEngine(ctx) ?? 'docker';
}

/** Shared guard: the managed install dir must contain a compose file. */
function requireInstall(ctx: Context, dir: string): boolean {
  if (!ctx.exists(join(dir, 'docker-compose.yml'))) {
    ctx.err(`No install found in ${dir}.`);
    return false;
  }
  return true;
}

function flagStr(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** The install directory: --dir, else $EXEPAD_HOME, else ~/.exepad. */
export function resolveDir(ctx: Context, flags: Flags): string {
  const fromFlag = flagStr(flags, 'dir');
  if (fromFlag) return isAbsolute(fromFlag) ? fromFlag : resolve(fromFlag);
  const fromEnv = ctx.env.EXEPAD_HOME;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), DEFAULT_HOME_DIRNAME);
}

/** Resolve the target image tag from flags, with lockstep default = launcher version. */
export function resolveTag(flags: Flags): { tag: string; reproducible: boolean } {
  const imageTag = flagStr(flags, 'image-tag');
  if (imageTag) return { tag: imageTag, reproducible: isSemver(imageTag) || isDigest(imageTag) };
  const to = flagStr(flags, 'to');
  if (to) return { tag: to, reproducible: isSemver(to) || isDigest(to) };
  const channel = flagStr(flags, 'channel');
  if (channel) return { tag: channel, reproducible: false };
  return { tag: LAUNCHER_VERSION, reproducible: true };
}

function markerPath(dir: string): string {
  return join(dir, '.exepad-version');
}

export function readMarker(ctx: Context, dir: string): VersionMarker | null {
  const text = ctx.readFile(markerPath(dir));
  return text ? parseVersionMarker(text) : null;
}

function printReport(ctx: Context, report: DoctorReport): void {
  const icon = { ok: '✓', warn: '!', fail: '✗' } as const;
  for (const c of report.checks) {
    ctx.out(`  ${icon[c.status]} ${c.name.padEnd(16)} ${c.detail}`);
  }
}

// ---------------------------------------------------------------------------

export async function deploy(ctx: Context, flags: Flags, mode: 'up' | 'update'): Promise<number> {
  const dir = resolveDir(ctx, flags);
  const force = flags.force === true;

  // Preflight
  const report = runChecks(ctx);
  if (!report.engineOk || !report.composeOk) {
    ctx.err('A container engine with Compose is required (Docker with the Compose v2 plugin, or Podman with a compose provider).');
    ctx.err('  Install Docker: curl -fsSL https://get.docker.com | sh');
    return 1;
  }
  if (!report.daemonOk) {
    ctx.err(
      report.engine === 'podman'
        ? 'Podman is not functional. On macOS/Windows: podman machine start.'
        : 'The Docker daemon is not reachable. Start Docker and retry.',
    );
    return 1;
  }
  if (!report.archOk && !force) {
    ctx.err('Unsupported architecture (the published image targets amd64 and arm64).');
    ctx.err('Re-run with --force to try anyway.');
    return 1;
  }
  const { tag, reproducible } = resolveTag(flags);
  const marker = readMarker(ctx, dir);
  const deployed = marker?.tag ?? null;

  let engine: Engine = report.engine ?? 'docker';
  // Stick with the engine this install was DEPLOYED under when it still works:
  // detection prefers docker, so a later `apt install docker` on a
  // podman-deployed host would otherwise re-deploy a SECOND, empty instance
  // under docker while the real one keeps running under podman.
  const recordedEngine = marker?.engine;
  if (recordedEngine && recordedEngine !== engine && ctx.exec(recordedEngine, ['--version']).code === 0) {
    ctx.out(`! Staying on ${recordedEngine} (recorded at deploy) — ${engine} is also installed but this instance's containers/volumes live under ${recordedEngine}.`);
    engine = recordedEngine;
  }
  if (engine === 'podman') {
    // The image runs unmodified under Podman, but two lifecycle behaviors
    // diverge from Docker (verified against podman docs/issues):
    ctx.out('! Running under Podman. Two caveats vs Docker:');
    ctx.out('  · restart-on-boot: `restart: unless-stopped` does not auto-start after a reboot —');
    ctx.out('    enable podman-restart.service (or use a Quadlet unit).');
    ctx.out('  · rootless Podman cannot bind ports <1024 (the in-image Caddy wants 80/443) —');
    ctx.out('    run rootful, or set sysctl net.ipv4.ip_unprivileged_port_start=80.');
  }

  if (mode === 'update' && !deployed) {
    ctx.err(`No existing install found in ${dir}. Run \`exepad up\` first.`);
    return 1;
  }

  const change = classifyChange(deployed, tag);
  if (change === 'downgrade' && !force) {
    ctx.err(`Refusing downgrade ${deployed} → ${tag}.`);
    ctx.err('Migrations run forward only; an older image on newer /data can break.');
    ctx.err('  Back up first:   exepad backup');
    ctx.err('  Then force it:   re-run with --force');
    return 1;
  }
  if (change === 'downgrade' && force) {
    ctx.err(`! Forcing downgrade ${deployed} → ${tag}. Ensure you have a backup (exepad backup).`);
  }
  if (change === 'unknown' && deployed) {
    ctx.out(`! Target "${tag}" is a channel/digest; cannot verify downgrade safety vs ${deployed}.`);
  }
  if (!reproducible) {
    ctx.out(`! "${tag}" is a moving tag — not reproducible. Pin a version (--to X.Y.Z) or a @sha256 digest for production.`);
  }
  if (change === 'same') {
    ctx.out(`Already at ${tag}; re-applying config.`);
  }

  // Safety net: snapshot /data BEFORE touching anything on an update. Migrations
  // run forward-only on boot, so the ONLY rollback path from a bad update is
  // "restore backup + previous tag" (exepad restore) — which needs this backup
  // to exist. Skip with --no-backup (e.g. when the operator just backed up).
  if (mode === 'update' && deployed && change !== 'same' && flags['no-backup'] !== true) {
    ctx.out(`Backing up the data volume before updating (skip with --no-backup)…`);
    // Forward ONLY the flags backup should inherit. Passing the raw flags
    // object would leak `--no-stop` into the SAFETY snapshot, silently turning
    // the one rollback artifact into a hot, torn copy of live WAL SQLite —
    // the exact inconsistency the pre-update backup exists to prevent.
    const backupFlags: Flags = {
      ...(flags.dir !== undefined ? { dir: flags.dir } : {}),
      ...(flags.out !== undefined ? { out: flags.out } : {}),
    };
    const bk = backup(ctx, backupFlags);
    if (bk !== 0 && !ctx.dryRun) {
      ctx.err('Backup failed — update aborted. Fix the backup (or re-run with --no-backup at your own risk).');
      return bk;
    }
  }

  // Host port: --port, else keep the deployed port, else default.
  const portFlag = flagStr(flags, 'port');
  const hostPort = portFlag ? Number(portFlag) : marker?.hostPort ?? DEFAULT_HOST_PORT;
  if (portFlag && !Number.isInteger(hostPort)) {
    ctx.err(`Invalid --port "${portFlag}".`);
    return 1;
  }

  // HTTPS via a Caddy sidecar when a domain is given (or was set on a prior deploy).
  const domain = flagStr(flags, 'domain') ?? marker?.domain;
  const acmeEmail = flagStr(flags, 'acme-email') ?? marker?.acmeEmail;

  // TLS strategy (letsencrypt | dns | byoc). Defaults to letsencrypt when a domain
  // is set; preserved across updates via the marker.
  const tlsModeFlag = flagStr(flags, 'tls');
  if (tlsModeFlag && !isTlsMode(tlsModeFlag)) {
    ctx.err(`Invalid --tls "${tlsModeFlag}". Use one of: ${TLS_MODES.join(', ')}.`);
    return 1;
  }
  if (tlsModeFlag && !domain) {
    ctx.err('--tls requires --domain (the cert is issued/served for that hostname).');
    return 1;
  }
  const tlsMode: TlsMode | undefined = domain
    ? (tlsModeFlag as TlsMode | undefined) ?? marker?.tlsMode ?? 'letsencrypt'
    : undefined;

  const dnsProvider = flagStr(flags, 'dns-provider') ?? marker?.dnsProvider;
  const dnsTokenFlag = flagStr(flags, 'dns-token');
  const caddyEnvPath = join(dir, CADDY_ENV_FILE);
  // The DNS token comes from --dns-token, else a previously-written caddy.env.
  const dnsToken =
    dnsTokenFlag ?? parseEnv(ctx.readFile(caddyEnvPath) ?? '').get(DNS_TOKEN_ENV) ?? undefined;
  if (tlsMode === 'dns') {
    if (!dnsProvider) {
      ctx.err(`--tls dns requires --dns-provider. Supported: ${dnsProviderList()}.`);
      return 1;
    }
    if (!caddyDnsModule(dnsProvider)) {
      ctx.err(`Unknown --dns-provider "${dnsProvider}".`);
      ctx.err(`Supported single-token providers: ${dnsProviderList()}.`);
      ctx.err('For a multi-credential provider, use --tls byoc or hand-edit the Caddyfile.');
      return 1;
    }
    // DNS-01 is useless without the token; fail before a wasted xcaddy build + a
    // guaranteed-failing ACME challenge rather than starting into a blank token.
    if (!dnsToken) {
      ctx.err(`--tls dns requires a DNS API token. Pass --dns-token <token>, or put`);
      ctx.err(`${DNS_TOKEN_ENV}=… in ${caddyEnvPath} and re-run.`);
      return 1;
    }
  } else {
    // Flags that only make sense with --tls dns shouldn't be silently dropped.
    if (flagStr(flags, 'dns-provider') || dnsTokenFlag) {
      ctx.out('! --dns-provider/--dns-token have no effect without --tls dns; ignoring.');
    }
  }

  // Write managed files
  ctx.ensureDir(dir);
  ctx.writeFile(
    join(dir, 'docker-compose.yml'),
    renderCompose({ tag, hostPort, domain, acmeEmail, tlsMode, dnsProvider }),
  );
  const dnsDockerfilePath = join(dir, CADDY_DNS_DOCKERFILE);
  if (domain) {
    ctx.writeFile(join(dir, 'Caddyfile'), renderCaddyfile(domain, acmeEmail, tlsMode, dnsProvider));
    if (tlsMode === 'dns') {
      ctx.writeFile(dnsDockerfilePath, renderCaddyDnsDockerfile(dnsProvider!));
      // The token lives ONLY here (0600) and is fed to the Caddy sidecar via env_file —
      // never the studio's shared .env. dnsToken is guaranteed set by the guard above.
      ctx.writeFile(
        caddyEnvPath,
        `# DNS-01 credential for the Caddy sidecar only (kept out of the studio .env).\n` +
          `${DNS_TOKEN_ENV}=${dnsToken}\n`,
        { mode: 0o600 },
      );
    }
    if (tlsMode === 'byoc') {
      ctx.ensureDir(join(dir, CERTS_DIRNAME));
    }
    // Switching away from DNS-01 leaves the plugin Dockerfile + token file orphaned;
    // remove them so a later operator doesn't trust a stale credential on disk.
    if (tlsMode !== 'dns') {
      if (ctx.exists(dnsDockerfilePath)) ctx.removeFile(dnsDockerfilePath);
      if (ctx.exists(caddyEnvPath)) ctx.removeFile(caddyEnvPath);
    }
  }

  const envPath = join(dir, '.env');
  const existingEnv = ctx.readFile(envPath) ?? '';
  const updates = envUpdatesFromFlags(flags);
  if (domain) {
    // Behind Caddy's TLS, cookies must be Secure and the origin must be allowed.
    updates.EXEPAD_COOKIE_SECURE = '1';
    updates.EXEPAD_ALLOWED_ORIGINS = `https://${domain}`;
  }

  if (mode === 'up' && !hasEnvKey(existingEnv, updates, 'EXEPAD_LLM_API_KEY')) {
    if (!ctx.assumeYes && !ctx.dryRun) {
      const key = await ctx.promptLine('LLM API key (EXEPAD_LLM_API_KEY) — leave blank to set later: ');
      if (key) updates.EXEPAD_LLM_API_KEY = key;
    }
    if (!updates.EXEPAD_LLM_API_KEY) {
      ctx.out('! No LLM key set yet — app builds will fail until you add one (edit .env or the /settings UI).');
    }
  }
  if (mode === 'up' || Object.keys(updates).length > 0 || !ctx.exists(envPath)) {
    // .env holds live secrets (LLM key, admin password) — keep it owner-only.
    ctx.writeFile(envPath, mergeEnv(existingEnv, updates), { mode: 0o600 });
  }

  const newMarker: VersionMarker = {
    image: IMAGE_REPO,
    tag,
    launcher: LAUNCHER_VERSION,
    hostPort,
    ...(domain ? { domain } : {}),
    ...(acmeEmail ? { acmeEmail } : {}),
    // Only persist a non-default strategy; absence reads back as 'letsencrypt'.
    ...(tlsMode && tlsMode !== 'letsencrypt' ? { tlsMode } : {}),
    ...(tlsMode === 'dns' && dnsProvider ? { dnsProvider } : {}),
    // Record the engine so the lifecycle verbs keep driving THIS instance even
    // if the other engine gets installed later (see verbEngine).
    engine,
    updatedAt: ctx.now().toISOString(),
  };

  // BYOC with no cert yet would crash-loop Caddy (restart: unless-stopped) on the
  // missing cert file — and we'd misleadingly print "is up → https://…". Stage the
  // config and stop here so a re-run starts cleanly once the cert is in place.
  if (tlsMode === 'byoc') {
    const haveCert =
      ctx.exists(join(dir, CERTS_DIRNAME, 'cert.pem')) &&
      ctx.exists(join(dir, CERTS_DIRNAME, 'key.pem'));
    if (!haveCert) {
      ctx.writeFile(markerPath(dir), renderVersionMarker(newMarker));
      ctx.out('');
      ctx.out(`Staged ${tag} for ${domain} — NOT started yet (no certificate found).`);
      ctx.out(`  Put your cert at  ${join(dir, CERTS_DIRNAME, 'cert.pem')}`);
      ctx.out(`  and key at        ${join(dir, CERTS_DIRNAME, 'key.pem')}`);
      ctx.out(`  then run \`exepad up\` to start. (install dir: ${dir})`);
      return 0;
    }
  }

  // Pull + start (idempotent; the container bootstraps/preserves its own secrets).
  // DNS-01's caddy service is build-only (no image:), which a bare `docker compose
  // pull` would try — and fail — to fetch as <project>-caddy. Pull ONLY the studio
  // service by name there: it skips caddy and needs no version-gated flag (works on
  // any Compose v2; `--ignore-buildable` only landed in v2.22). `up --build` builds caddy.
  ctx.out(`\nPulling ${imageRef(tag)} …`);
  const pullArgs = ['compose', 'pull'];
  if (tlsMode === 'dns') pullArgs.push(CONTAINER_NAME);
  const pull = ctx.exec(engine, pullArgs, { cwd: dir, mutating: true });
  if (pull.code !== 0 && !ctx.dryRun) {
    ctx.err(`${engine} compose pull failed.`);
    if (pull.stderr) ctx.err(pull.stderr.trim());
    return pull.code;
  }
  // DNS-01 builds a plugin-compiled Caddy from the generated Dockerfile, so the
  // first/changed deploy must (re)build that image.
  const upArgs = ['compose', 'up', '-d'];
  if (tlsMode === 'dns') upArgs.push('--build');
  const up = ctx.exec(engine, upArgs, { cwd: dir, mutating: true });
  if (up.code !== 0 && !ctx.dryRun) {
    ctx.err(`${engine} compose up failed.`);
    if (up.stderr) ctx.err(up.stderr.trim());
    return up.code;
  }

  ctx.writeFile(markerPath(dir), renderVersionMarker(newMarker));

  const url = domain ? `https://${domain}` : `http://localhost:${hostPort}`;
  ctx.out('');
  ctx.out(`Exepad ${tag} is ${mode === 'up' ? 'up' : 'updated'} → ${url}`);
  if (!domain) {
    ctx.out('  For browser-trusted HTTPS on a real domain, rerun with --domain <your-domain>.');
  }
  if (domain && tlsMode === 'dns') {
    ctx.out(`  HTTPS via Caddy (Let's Encrypt DNS-01, ${dnsProvider}) — no inbound :80/:443`);
    ctx.out(`  needed for issuance. First boot runs an xcaddy build (a few minutes).`);
    ctx.out(`  DNS token is stored in ${join(dir, CADDY_ENV_FILE)} (Caddy-only, 0600).`);
  } else if (domain && tlsMode === 'byoc') {
    ctx.out(`  HTTPS via Caddy with your own certificate from ${join(dir, CERTS_DIRNAME)}/`);
    ctx.out(`  (its CA root is already trusted org-wide).`);
  } else if (domain) {
    ctx.out(`  HTTPS via Caddy (Let's Encrypt). Point ${domain} DNS at this host and open :80/:443`);
    ctx.out(`  so the certificate can be issued.`);
  }
  ctx.out(`  install dir: ${dir}`);
  ctx.out(`  data volume: ${DATA_VOLUME}  (back up with: exepad backup)`);
  return 0;
}

/**
 * Teardown: stop AND remove the container(s). The named data volume is
 * preserved — `exepad up` recreates everything from it. For a plain pause that
 * keeps the container, use `exepad stop`.
 */
export function down(ctx: Context, flags: Flags): number {
  const dir = resolveDir(ctx, flags);
  if (!requireInstall(ctx, dir)) return 1;
  const res = ctx.exec(verbEngine(ctx, dir), ['compose', 'down'], {
    cwd: dir,
    mutating: true,
    inherit: true,
  });
  if (res.code === 0) {
    ctx.out('Studio removed (data volume preserved). Start again with `exepad up`, or pause-only next time with `exepad stop`.');
  }
  return res.code;
}

/**
 * Graceful pause: SIGTERM → the entrypoint drains and TRUNCATE-checkpoints the
 * SQLite WALs, then the container stays around (stopped). Resume with
 * `exepad start`. Never kills — a hard kill can leave a torn WAL.
 */
export function stop(ctx: Context, flags: Flags): number {
  const dir = resolveDir(ctx, flags);
  if (!requireInstall(ctx, dir)) return 1;
  const res = ctx.exec(verbEngine(ctx, dir), ['compose', 'stop'], {
    cwd: dir,
    mutating: true,
    inherit: true,
  });
  if (res.code === 0) ctx.out('Studio stopped. Resume with `exepad start`.');
  return res.code;
}

/** Resume a stopped studio. Falls back to a hint when nothing exists to start. */
export function start(ctx: Context, flags: Flags): number {
  const dir = resolveDir(ctx, flags);
  if (!requireInstall(ctx, dir)) return 1;
  const res = ctx.exec(verbEngine(ctx, dir), ['compose', 'start'], {
    cwd: dir,
    mutating: true,
    inherit: true,
  });
  if (res.code !== 0 && !ctx.dryRun) {
    ctx.err('Could not start. If the container was removed (`exepad down`), run `exepad up` to recreate it.');
  }
  return res.code;
}

/** Graceful stop + start in one step (config reload, stuck instance, …). */
export function restart(ctx: Context, flags: Flags): number {
  const dir = resolveDir(ctx, flags);
  if (!requireInstall(ctx, dir)) return 1;
  const res = ctx.exec(verbEngine(ctx, dir), ['compose', 'restart'], {
    cwd: dir,
    mutating: true,
    inherit: true,
  });
  if (res.code === 0) ctx.out('Studio restarted.');
  return res.code;
}

export function logs(ctx: Context, flags: Flags): number {
  const dir = resolveDir(ctx, flags);
  if (!requireInstall(ctx, dir)) return 1;
  const args = ['compose', 'logs'];
  if (flags.follow === true) args.push('-f');
  const res = ctx.exec(verbEngine(ctx, dir), args, { cwd: dir, inherit: true });
  return res.code;
}

export function backup(ctx: Context, flags: Flags): number {
  const dir = resolveDir(ctx, flags);
  const outDir = flagStr(flags, 'out') ?? join(dir, 'backups');
  ctx.ensureDir(outDir);
  const stamp = ctx.now().toISOString().replace(/[:.]/g, '-');
  const file = `exepad-data-${stamp}.tgz`;

  // The data volume holds better-sqlite3 databases in WAL mode (meta.sqlite plus
  // one per app). A live `tar` reads the main DB file and its -wal/-shm sidecars
  // at DIFFERENT instants, so a checkpoint racing the copy yields a torn main file
  // + mismatched WAL — a backup that restores CORRUPT. Quiesce first by stopping
  // the container (its graceful shutdown TRUNCATE-checkpoints every WAL), tar the
  // now-consistent volume, then restart. `exepad backup --no-stop` skips this for
  // an at-your-own-risk hot snapshot.
  const engine = verbEngine(ctx, dir);
  const noStop = flags['no-stop'] === true;
  const composeExists = ctx.exists(join(dir, 'docker-compose.yml'));
  let stopped = false;
  if (noStop) {
    ctx.err('! --no-stop: archiving a LIVE WAL database. The snapshot may be torn/inconsistent — stop the container for a guaranteed-consistent backup.');
  } else if (!composeExists) {
    ctx.err(`! No install found in ${dir} — cannot stop the container, archiving the LIVE volume (may be inconsistent).`);
    ctx.err('  Stop the container first (or pass --dir), then re-run for a consistent snapshot.');
  } else {
    ctx.out('Stopping the container for a consistent snapshot (pass --no-stop for a hot backup)…');
    const stop = ctx.exec(engine, ['compose', 'stop'], { cwd: dir, mutating: true });
    if (stop.code === 0 || ctx.dryRun) {
      stopped = true;
    } else {
      ctx.err('! Could not stop the container — archiving the LIVE volume, which may be inconsistent.');
      if (stop.stderr) ctx.err(stop.stderr.trim());
    }
  }

  // Archive the named volume from inside a throwaway container (no host tar needed).
  const res = ctx.exec(
    engine,
    [
      'run', '--rm',
      '-v', `${DATA_VOLUME}:/data:ro`,
      '-v', `${outDir}:/backup`,
      'alpine',
      'tar', 'czf', `/backup/${file}`, '-C', '/data', '.',
    ],
    { mutating: true },
  );

  // Restart the container BEFORE surfacing any tar error so a failed backup never
  // leaves the studio down.
  if (stopped) {
    const start = ctx.exec(engine, ['compose', 'start'], { cwd: dir, mutating: true });
    if (start.code !== 0 && !ctx.dryRun) {
      ctx.err(`! Backup done but the container did not restart — run \`${engine} compose start\` (or \`exepad up\`) to bring it back.`);
      if (start.stderr) ctx.err(start.stderr.trim());
    }
  }

  if (res.code !== 0 && !ctx.dryRun) {
    ctx.err('Backup failed.');
    if (res.stderr) ctx.err(res.stderr.trim());
    return res.code;
  }
  ctx.out(`Backup written: ${join(outDir, file)}`);
  return 0;
}

/**
 * Restore a `exepad backup` archive into the data volume — THE rollback path.
 * Migrations run forward-only on boot, so downgrading an image against newer
 * /data is unsafe; the supported rollback is exactly this: restore the snapshot
 * taken before the update, then (optionally, --to) pin the matching older tag.
 *
 *   exepad restore ~/.exepad/backups/exepad-data-….tgz --to 1.1.0
 */
export async function restore(ctx: Context, flags: Flags, positionals: string[]): Promise<number> {
  const dir = resolveDir(ctx, flags);
  if (!requireInstall(ctx, dir)) return 1;

  const fileArg = positionals[0];
  if (!fileArg) {
    ctx.err('Usage: exepad restore <backup.tgz> [--to <version>]');
    ctx.err(`  Backups live in ${join(dir, 'backups')} by default.`);
    return 2;
  }
  const backupPath = isAbsolute(fileArg) ? fileArg : resolve(fileArg);
  if (!ctx.exists(backupPath)) {
    ctx.err(`Backup file not found: ${backupPath}`);
    return 1;
  }

  // Every precondition is checked BEFORE the first destructive step: once the
  // volume is wiped there is no way back except another backup.
  const to = flagStr(flags, 'to');
  const marker = readMarker(ctx, dir);
  if (to && !marker) {
    ctx.err(`No .exepad-version marker in ${dir} — cannot re-deploy at --to ${to}.`);
    ctx.err('Run `exepad up` once to establish the install, then re-run the restore.');
    return 1;
  }

  ctx.err(`! This REPLACES everything in the data volume "${DATA_VOLUME}" (all apps, users,`);
  ctx.err(`  uploads, secrets) with the contents of ${backupPath}.`);
  const ok = ctx.dryRun || (await ctx.confirm('Continue?', false)); // confirm() honors --yes
  if (!ok) {
    ctx.out('Aborted — nothing changed.');
    return 1;
  }

  const engine = verbEngine(ctx, dir);

  // Quiesce fully: remove the container so nothing holds the SQLite files while
  // the volume is rewritten (the volume itself survives `down`).
  const downRes = ctx.exec(engine, ['compose', 'down'], { cwd: dir, mutating: true });
  if (downRes.code !== 0 && !ctx.dryRun) {
    ctx.err('Could not stop the studio; restore aborted.');
    if (downRes.stderr) ctx.err(downRes.stderr.trim());
    return downRes.code;
  }

  // Wipe + untar inside a throwaway container.
  //  · The archive FILE is mounted at a FIXED path so no operator-controlled
  //    filename is ever interpolated into `sh -c` — a name with a space or
  //    shell metacharacters must not break (or inject into) the script,
  //    especially not AFTER the wipe.
  //  · `tar tzf` validates the archive is readable BEFORE `find -delete`
  //    destroys anything: an unreadable/corrupt file aborts with /data intact.
  //  · `find -mindepth 1 -delete` also removes dotfiles (a bare `rm -rf
  //    /data/*` would miss them and leave stale secrets/WAL sidecars mixed
  //    into the restored tree).
  const res = ctx.exec(
    engine,
    [
      'run', '--rm',
      '-v', `${DATA_VOLUME}:/data`,
      '-v', `${backupPath}:/backup/restore.tgz:ro`,
      'alpine',
      'sh', '-c',
      'tar tzf /backup/restore.tgz >/dev/null && find /data -mindepth 1 -delete && tar xzf /backup/restore.tgz -C /data',
    ],
    { mutating: true },
  );
  if (res.code !== 0 && !ctx.dryRun) {
    ctx.err('Restore FAILED — if the failure happened before the wipe (unreadable archive), /data is');
    ctx.err('intact; otherwise the volume may be partially written. Do not start the studio;');
    ctx.err('fix the problem and re-run the restore.');
    if (res.stderr) ctx.err(res.stderr.trim());
    return res.code;
  }

  if (to) {
    // Re-deploy at the matching older tag. force: the marker still names the
    // newer version, but /data now matches <to>, so the downgrade guard must
    // yield; no-backup: we would only snapshot the just-restored volume.
    ctx.out(`Data restored. Re-deploying at ${to} …`);
    return deploy(ctx, { ...flags, to, force: true, 'no-backup': true }, 'update');
  }

  // No --to: the CURRENT image will boot on the restored data and run its
  // forward-only migrations over it. If the snapshot came from an OLDER
  // version, that mutates the freshly-restored rollback state — surface the
  // hazard BEFORE starting, not after.
  ctx.err(`! The studio will now start on the CURRENT image (${marker?.tag ?? 'unknown tag'}) and`);
  ctx.err('  run forward-only migrations over the restored data. If this snapshot came from');
  ctx.err('  an OLDER version, abort and re-run with  --to <that version>  instead.');
  const proceed = ctx.dryRun || (await ctx.confirm('Start on the current version?', false));
  if (!proceed) {
    ctx.out('Data restored; studio left STOPPED. Re-run with --to <version>, or start it with `exepad start`.');
    return 1;
  }

  const up = ctx.exec(engine, ['compose', 'up', '-d'], { cwd: dir, mutating: true });
  if (up.code !== 0 && !ctx.dryRun) {
    ctx.err('Data restored but the studio did not start — run `exepad up`.');
    if (up.stderr) ctx.err(up.stderr.trim());
    return up.code;
  }
  ctx.out('Restore complete — studio is up on the restored data.');
  return 0;
}

export function doctor(ctx: Context, flags: Flags): number {
  const dir = resolveDir(ctx, flags);
  const report = runChecks(ctx);
  ctx.out('exepad doctor');
  printReport(ctx, report);
  const marker = readMarker(ctx, dir);
  ctx.out(
    `  · deployed        ${marker ? `${marker.tag} (port ${marker.hostPort}, ${dir})` : `none in ${dir}`}`,
  );
  ctx.out(`  · launcher        ${LAUNCHER_VERSION}`);
  const hasFail = report.checks.some((c) => c.status === 'fail');
  return hasFail ? 1 : 0;
}

export function status(ctx: Context, flags: Flags): number {
  const dir = resolveDir(ctx, flags);
  const marker = readMarker(ctx, dir);
  ctx.out(`launcher: ${LAUNCHER_VERSION}`);
  if (marker) {
    ctx.out(`deployed: ${marker.tag}  (image ${marker.image}, port ${marker.hostPort})`);
    ctx.out(`updated:  ${marker.updatedAt}`);
    ctx.out(`dir:      ${dir}`);
  } else {
    ctx.out(`deployed: none (no install in ${dir})`);
  }
  return 0;
}
