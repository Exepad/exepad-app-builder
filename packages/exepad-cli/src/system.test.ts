// Branch coverage for the host-preflight engine (system.ts `runChecks` +
// `detectEngine`), shared by `doctor` and the `up`/`update` preflight. Every
// side effect (engine probes, arch, RAM) is injected: `exec` via the in-memory
// fake Context used across the CLI suite, and `node:os` (arch/totalmem) via
// vi.mock so the arch/memory branches are deterministic rather than
// host-dependent.
//
// The CLI is RUNTIME-NEUTRAL: docker preferred, podman a first-class fallback
// (same OCI image). These tests pin that resolution order and the per-engine
// hint text.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context, ExecResult } from './context';
import { MIN_RAM_GB } from './config';

// os.arch() / os.totalmem() are read directly inside runChecks; mock them so the
// "architecture" and "memory" checks don't depend on the machine running CI.
const osState = { arch: 'x64', totalmem: 16e9 };
vi.mock('node:os', () => ({
  arch: () => osState.arch,
  totalmem: () => osState.totalmem,
}));

// Import AFTER the mock is registered (vi.mock is hoisted, but keep it explicit).
import { runChecks, detectEngine } from './system';

// A fake Context whose `exec` is a dispatcher keyed on `${file} ${args[0..]}`.
// Anything not matched returns a FAILURE (code 127) so a test only "installs"
// the binaries it declares — critical now that runChecks probes podman as a
// fallback: a default-success fake would make podman look installed everywhere.
type ExecFn = (file: string, args: string[]) => ExecResult | undefined;

function makeCtx(execFn: ExecFn): Context {
  return {
    dryRun: false,
    assumeYes: true,
    env: {},
    now: () => new Date('2026-06-20T00:00:00.000Z'),
    exec: (file, args) =>
      execFn(file, args) ?? { code: 127, stdout: '', stderr: `${file}: command not found` },
    out: () => {},
    err: () => {},
    confirm: async () => true,
    promptLine: async () => '',
    readFile: () => null,
    writeFile: () => {},
    removeFile: () => {},
    ensureDir: () => {},
    exists: () => false,
  };
}

// Convenience: a "healthy Docker host" exec answering every docker probe ok
// (and nothing else — podman is NOT installed on this fake host).
function healthyDocker(file: string, args: string[]): ExecResult | undefined {
  if (file !== 'docker') return undefined;
  if (args[0] === '--version') return { code: 0, stdout: 'Docker version 27.0.1, build abc', stderr: '' };
  if (args[0] === 'compose') return { code: 0, stdout: 'Docker Compose version v2.29.0', stderr: '' };
  if (args[0] === 'info') return { code: 0, stdout: '27.0.1\n', stderr: '' };
  return undefined;
}

// A "podman-only host": docker absent, podman healthy.
function healthyPodman(file: string, args: string[]): ExecResult | undefined {
  if (file !== 'podman') return undefined;
  if (args[0] === '--version') return { code: 0, stdout: 'podman version 5.5.0', stderr: '' };
  if (args[0] === 'compose') return { code: 0, stdout: 'podman-compose version 1.4.0', stderr: '' };
  if (args[0] === 'info') return { code: 0, stdout: 'host:\n  arch: amd64\n', stderr: '' };
  return undefined;
}

function check(report: ReturnType<typeof runChecks>, name: string) {
  const c = report.checks.find((x) => x.name === name);
  if (!c) throw new Error(`no check named ${name}`);
  return c;
}

beforeEach(() => {
  osState.arch = 'x64';
  osState.totalmem = 16e9;
});

describe('detectEngine (quick probe for the lifecycle verbs)', () => {
  it('prefers docker when both engines are installed', () => {
    expect(
      detectEngine(
        makeCtx((file, args) => healthyDocker(file, args) ?? healthyPodman(file, args)),
      ),
    ).toBe('docker');
  });

  it('falls back to podman when docker is absent', () => {
    expect(detectEngine(makeCtx(healthyPodman))).toBe('podman');
  });

  it('returns null when neither engine exists', () => {
    expect(detectEngine(makeCtx(() => undefined))).toBe(null);
  });
});

describe('runChecks: all-healthy Docker host', () => {
  it('reports every probe ok, engine=docker, all booleans true', () => {
    const report = runChecks(makeCtx(healthyDocker));

    expect(report.engine).toBe('docker');
    expect(report.engineOk).toBe(true);
    expect(report.composeOk).toBe(true);
    expect(report.daemonOk).toBe(true);
    expect(report.archOk).toBe(true);

    expect(check(report, 'engine').status).toBe('ok');
    expect(check(report, 'compose').status).toBe('ok');
    expect(check(report, 'daemon').status).toBe('ok');
    expect(check(report, 'architecture').status).toBe('ok');
    expect(check(report, 'memory').status).toBe('ok');
  });

  it('emits exactly the five checks, in stable order', () => {
    const report = runChecks(makeCtx(healthyDocker));
    expect(report.checks.map((c) => c.name)).toEqual([
      'engine',
      'compose',
      'daemon',
      'architecture',
      'memory',
    ]);
  });

  it('engine detail is the FIRST line of `docker --version` output only', () => {
    const report = runChecks(
      makeCtx((file, args) =>
        file === 'docker' && args[0] === '--version'
          ? { code: 0, stdout: 'Docker version 27.0.1\nextra noise line', stderr: '' }
          : healthyDocker(file, args),
      ),
    );
    expect(check(report, 'engine').detail).toBe('Docker version 27.0.1');
  });

  it('daemon detail embeds the trimmed server version', () => {
    const report = runChecks(
      makeCtx((file, args) =>
        file === 'docker' && args[0] === 'info'
          ? { code: 0, stdout: '  28.1.0  \n', stderr: '' }
          : healthyDocker(file, args),
      ),
    );
    expect(check(report, 'daemon').detail).toBe('running (server 28.1.0)');
  });

  it('never probes podman when docker answers (docker preferred)', () => {
    const calls: string[] = [];
    runChecks(
      makeCtx((file, args) => {
        calls.push(`${file} ${args.join(' ')}`);
        return healthyDocker(file, args) ?? healthyPodman(file, args);
      }),
    );
    expect(calls.some((c) => c.startsWith('podman'))).toBe(false);
  });
});

describe('runChecks: podman-only host (docker absent)', () => {
  it('falls back to podman for every probe: engine, compose, reachability', () => {
    const calls: string[] = [];
    const report = runChecks(
      makeCtx((file, args) => {
        calls.push(`${file} ${args.join(' ')}`);
        return healthyPodman(file, args);
      }),
    );

    expect(report.engine).toBe('podman');
    expect(report.engineOk).toBe(true);
    expect(report.composeOk).toBe(true);
    expect(report.daemonOk).toBe(true);
    expect(check(report, 'engine').detail).toBe('podman version 5.5.0');
    expect(check(report, 'daemon').detail).toBe('podman reachable');
    // Once podman is chosen, compose + reachability go through podman, not docker.
    expect(calls).toContain('podman compose version');
    expect(calls.some((c) => c.startsWith('docker compose'))).toBe(false);
    expect(calls.some((c) => c.startsWith('docker info'))).toBe(false);
  });

  it('missing compose provider under podman names docker-compose/podman-compose', () => {
    const report = runChecks(
      makeCtx((file, args) => {
        if (file === 'podman' && args[0] === 'compose') return { code: 125, stdout: '', stderr: 'no provider' };
        return healthyPodman(file, args);
      }),
    );
    expect(report.composeOk).toBe(false);
    expect(check(report, 'compose').detail).toContain('podman-compose');
  });

  it('a broken podman setup points at `podman machine start`', () => {
    const report = runChecks(
      makeCtx((file, args) => {
        if (file === 'podman' && args[0] === 'info') return { code: 125, stdout: '', stderr: 'cannot connect' };
        return healthyPodman(file, args);
      }),
    );
    expect(report.daemonOk).toBe(false);
    expect(check(report, 'daemon').detail).toContain('podman machine start');
  });
});

describe('runChecks: no engine at all', () => {
  it('marks engine fail naming BOTH options, and skips the reachability probe', () => {
    const calls: string[] = [];
    const report = runChecks(
      makeCtx((file, args) => {
        calls.push(`${file} ${args.join(' ')}`);
        return undefined; // nothing installed
      }),
    );

    expect(report.engine).toBe(null);
    expect(report.engineOk).toBe(false);
    expect(report.daemonOk).toBe(false);
    expect(check(report, 'engine').status).toBe('fail');
    expect(check(report, 'engine').detail).toContain('install Docker');
    expect(check(report, 'engine').detail).toContain('Podman');
    expect(check(report, 'daemon').status).toBe('fail');
    expect(check(report, 'daemon').detail).toBe('skipped (no engine)');
    // The reachability probe must not be attempted when no engine is present.
    expect(calls.some((c) => c.startsWith('docker info'))).toBe(false);
    expect(calls.some((c) => c.startsWith('podman info'))).toBe(false);
  });

  it('compose is still probed independently of the engine binary', () => {
    // compose probe does not gate on engineOk; a missing engine binary but a
    // present compose plugin (unusual but possible) is reported per-probe.
    const report = runChecks(
      makeCtx((file, args) => {
        if (file === 'docker' && args[0] === 'compose') return { code: 0, stdout: 'Compose v2.29.0', stderr: '' };
        return undefined;
      }),
    );
    expect(report.engineOk).toBe(false);
    expect(report.composeOk).toBe(true);
    expect(check(report, 'compose').status).toBe('ok');
  });
});

describe('runChecks: compose plugin missing (docker host)', () => {
  it('marks compose fail with the v2-plugin hint', () => {
    const report = runChecks(
      makeCtx((file, args) => {
        if (file === 'docker' && args[0] === 'compose') return { code: 1, stdout: '', stderr: 'unknown command' };
        return healthyDocker(file, args);
      }),
    );
    expect(report.composeOk).toBe(false);
    expect(check(report, 'compose').status).toBe('fail');
    expect(check(report, 'compose').detail).toContain('Compose v2 plugin not found');
  });
});

describe('runChecks: docker present but daemon down', () => {
  it('engine ok, daemon fail with the "is Docker running?" hint', () => {
    const report = runChecks(
      makeCtx((file, args) => {
        if (file === 'docker' && args[0] === 'info') return { code: 1, stdout: '', stderr: 'Cannot connect' };
        return healthyDocker(file, args);
      }),
    );
    expect(report.engineOk).toBe(true);
    expect(report.daemonOk).toBe(false);
    expect(check(report, 'daemon').status).toBe('fail');
    expect(check(report, 'daemon').detail).toContain('not reachable');
  });
});

describe('runChecks: architecture branch', () => {
  it('arm64 is supported (ok)', () => {
    osState.arch = 'arm64';
    const report = runChecks(makeCtx(healthyDocker));
    expect(report.archOk).toBe(true);
    expect(check(report, 'architecture').status).toBe('ok');
    expect(check(report, 'architecture').detail).toBe('arm64');
  });

  it('an unsupported arch fails with the amd64/arm64 guidance', () => {
    osState.arch = 'ppc64';
    const report = runChecks(makeCtx(healthyDocker));
    expect(report.archOk).toBe(false);
    expect(check(report, 'architecture').status).toBe('fail');
    expect(check(report, 'architecture').detail).toContain('not supported');
    expect(check(report, 'architecture').detail).toContain('--force');
  });
});

describe('runChecks: memory branch (warn, not fail)', () => {
  it('ample RAM is ok', () => {
    osState.totalmem = 8e9;
    const report = runChecks(makeCtx(healthyDocker));
    expect(check(report, 'memory').status).toBe('ok');
    expect(check(report, 'memory').detail).toBe('8.0 GB');
  });

  it('below MIN_RAM_GB is a WARN (never a hard fail) with the threshold called out', () => {
    osState.totalmem = 1e9; // 1.0 GB, below the 2 GB minimum
    const report = runChecks(makeCtx(healthyDocker));
    const mem = check(report, 'memory');
    expect(mem.status).toBe('warn');
    expect(mem.detail).toContain(`below ${MIN_RAM_GB} GB`);
    // A low-RAM warning must NOT flip the report into a failing state on its own.
    expect(report.checks.some((c) => c.status === 'fail')).toBe(false);
  });

  it('exactly MIN_RAM_GB is treated as ok (>= boundary)', () => {
    osState.totalmem = MIN_RAM_GB * 1e9; // exactly 2.0 GB
    const report = runChecks(makeCtx(healthyDocker));
    expect(check(report, 'memory').status).toBe('ok');
  });
});

describe('runChecks: combined failure surface', () => {
  it('a fully broken host fails engine + compose + daemon together', () => {
    osState.arch = 's390x';
    osState.totalmem = 0.5e9;
    const report = runChecks(makeCtx(() => ({ code: 1, stdout: '', stderr: 'boom' })));

    expect(report.engineOk).toBe(false);
    expect(report.composeOk).toBe(false);
    expect(report.daemonOk).toBe(false);
    expect(report.archOk).toBe(false);
    // doctor() returns exit 1 iff any check is 'fail'; here several are.
    expect(report.checks.some((c) => c.status === 'fail')).toBe(true);
  });
});
