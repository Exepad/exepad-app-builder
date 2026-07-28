// Host preflight checks shared by `doctor` and the `up`/`update` preflight.
import { arch as osArch, totalmem } from 'node:os';
import type { Context } from './context';
import { MIN_RAM_GB, isArchSupported } from './config';

export type CheckStatus = 'ok' | 'warn' | 'fail';

/**
 * The container engine the CLI drives. The studio image is a standard OCI
 * image, so it runs identically under Docker or Podman — the CLI is
 * runtime-neutral and shells `<engine> compose …` / `<engine> run …`.
 * Docker is preferred when both are present (the majority runtime, and the
 * only one our Linux installer auto-installs); Podman is a first-class
 * fallback (its `podman compose` subcommand drives the same compose file via
 * an external provider — docker-compose or podman-compose).
 */
export type Engine = 'docker' | 'podman';

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface DoctorReport {
  checks: Check[];
  /** Detected engine (docker preferred), or null when neither binary exists. */
  engine: Engine | null;
  engineOk: boolean;
  composeOk: boolean;
  daemonOk: boolean;
  archOk: boolean;
}

function firstLine(s: string): string {
  return s.split('\n')[0]?.trim() ?? '';
}

/**
 * Cheap engine probe for the quick verbs (stop/start/restart/logs/down/backup)
 * that don't run the full preflight. Docker first, then Podman; null when
 * neither is installed (callers fall back to 'docker' for error text).
 */
export function detectEngine(ctx: Context): Engine | null {
  if (ctx.exec('docker', ['--version']).code === 0) return 'docker';
  if (ctx.exec('podman', ['--version']).code === 0) return 'podman';
  return null;
}

export function runChecks(ctx: Context): DoctorReport {
  const checks: Check[] = [];

  // Engine: docker preferred, podman fallback (same OCI image either way).
  const docker = ctx.exec('docker', ['--version']);
  let engine: Engine | null = docker.code === 0 ? 'docker' : null;
  let engineVersionLine = firstLine(docker.stdout);
  if (!engine) {
    const podman = ctx.exec('podman', ['--version']);
    if (podman.code === 0) {
      engine = 'podman';
      engineVersionLine = firstLine(podman.stdout);
    }
  }
  const engineOk = engine !== null;
  checks.push({
    name: 'engine',
    status: engineOk ? 'ok' : 'fail',
    detail: engineOk
      ? engineVersionLine
      : 'no container engine found — install Docker (https://get.docker.com) or Podman',
  });

  // Compose v2 CLI. Under Podman, `podman compose` is a thin shim that needs an
  // external provider (docker-compose or podman-compose) installed. With no
  // engine at all we still probe docker's plugin so the report stays per-probe.
  const compose = ctx.exec(engine ?? 'docker', ['compose', 'version']);
  const composeOk = compose.code === 0;
  checks.push({
    name: 'compose',
    status: composeOk ? 'ok' : 'fail',
    detail: composeOk
      ? firstLine(compose.stdout)
      : engine === 'podman'
        ? 'no compose provider — install docker-compose or podman-compose (podman compose shells out to one)'
        : 'Compose v2 plugin not found',
  });

  // Engine reachability. Docker needs its daemon up; Podman is daemonless but
  // `podman info` still validates a working setup (machine/socket on Mac/Win).
  let daemonOk = false;
  if (engineOk && engine) {
    const info =
      engine === 'docker'
        ? ctx.exec('docker', ['info', '--format', '{{.ServerVersion}}'])
        : ctx.exec('podman', ['info']);
    daemonOk = info.code === 0;
    checks.push({
      name: 'daemon',
      status: daemonOk ? 'ok' : 'fail',
      detail: daemonOk
        ? engine === 'docker'
          ? `running (server ${firstLine(info.stdout)})`
          : 'podman reachable'
        : engine === 'docker'
          ? 'not reachable — is Docker running?'
          : 'podman not functional — is the podman machine running? (podman machine start)',
    });
  } else {
    checks.push({ name: 'daemon', status: 'fail', detail: 'skipped (no engine)' });
  }

  const a = osArch();
  const archOk = isArchSupported(a);
  checks.push({
    name: 'architecture',
    status: archOk ? 'ok' : 'fail',
    detail: archOk ? a : `${a} not supported (the image targets amd64/arm64; --force to override)`,
  });

  const ramGb = totalmem() / 1e9;
  const ramOk = ramGb >= MIN_RAM_GB;
  checks.push({
    name: 'memory',
    status: ramOk ? 'ok' : 'warn',
    detail: `${ramGb.toFixed(1)} GB${ramOk ? '' : ` — below ${MIN_RAM_GB} GB; builds peak at 2-3 GB`}`,
  });

  return { checks, engine, engineOk, composeOk, daemonOk, archOk };
}
