// The effects boundary. Every side effect (process spawn, fs, stdio, clock) goes
// through Context so commands stay testable with an in-memory fake, and so
// --dry-run can suppress mutations in exactly one place.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  /** A state-changing command (compose up/pull, docker run). Skipped under --dry-run. */
  mutating?: boolean;
  /** Inherit stdio for streaming/interactive commands (logs -f, down). */
  inherit?: boolean;
  cwd?: string;
}

export interface Context {
  exec(file: string, args: string[], opts?: ExecOptions): ExecResult;
  out(msg?: string): void;
  err(msg: string): void;
  confirm(question: string, def?: boolean): Promise<boolean>;
  promptLine(question: string): Promise<string>;
  readFile(path: string): string | null;
  /** Write a file. `opts.mode` (e.g. 0o600) is enforced even if the file already exists. */
  writeFile(path: string, content: string, opts?: { mode?: number }): void;
  /** Remove a file if present (no-op if missing). Used to clean up stale managed files. */
  removeFile(path: string): void;
  ensureDir(path: string): void;
  exists(path: string): boolean;
  now(): Date;
  env: NodeJS.ProcessEnv;
  dryRun: boolean;
  assumeYes: boolean;
}

export interface RealContextOptions {
  dryRun?: boolean;
  assumeYes?: boolean;
}

export function createRealContext(opts: RealContextOptions = {}): Context {
  const dryRun = Boolean(opts.dryRun);
  const assumeYes = Boolean(opts.assumeYes);

  return {
    dryRun,
    assumeYes,
    env: process.env,
    now: () => new Date(),

    exec(file, args, execOpts = {}) {
      if (dryRun && execOpts.mutating) {
        process.stdout.write(`  → would run: ${file} ${args.join(' ')}\n`);
        return { code: 0, stdout: '', stderr: '' };
      }
      const res = spawnSync(file, args, {
        cwd: execOpts.cwd,
        encoding: 'utf8',
        stdio: execOpts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      });
      if (res.error && (res.error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { code: 127, stdout: '', stderr: `${file}: command not found` };
      }
      return {
        code: res.status ?? 1,
        stdout: res.stdout ?? '',
        stderr: res.stderr ?? '',
      };
    },

    out(msg = '') {
      process.stdout.write(msg + '\n');
    },
    err(msg) {
      process.stderr.write(msg + '\n');
    },

    async confirm(question, def = false) {
      if (assumeYes) return true;
      const rl = createInterface({ input, output });
      try {
        const suffix = def ? '[Y/n]' : '[y/N]';
        const answer = (await rl.question(`${question} ${suffix} `)).trim().toLowerCase();
        if (!answer) return def;
        return answer === 'y' || answer === 'yes';
      } finally {
        rl.close();
      }
    },

    async promptLine(question) {
      if (assumeYes) return '';
      const rl = createInterface({ input, output });
      try {
        return (await rl.question(question)).trim();
      } finally {
        rl.close();
      }
    },

    readFile(path) {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    writeFile(path, content, fileOpts) {
      if (dryRun) {
        process.stdout.write(`  → would write: ${path}\n`);
        return;
      }
      writeFileSync(path, content, fileOpts?.mode ? { mode: fileOpts.mode } : undefined);
      // writeFileSync's mode is ignored when the file already exists, so enforce it
      // explicitly — `exepad update` rewrites an existing .env / caddy.env.
      if (fileOpts?.mode) chmodSync(path, fileOpts.mode);
    },
    removeFile(path) {
      if (dryRun) {
        process.stdout.write(`  → would remove: ${path}\n`);
        return;
      }
      rmSync(path, { force: true });
    },
    ensureDir(path) {
      if (dryRun) return;
      mkdirSync(path, { recursive: true });
    },
    exists(path) {
      return existsSync(path);
    },
  };
}
