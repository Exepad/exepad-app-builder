// Covers the effects boundary (context.ts), which is security-load-bearing:
// secret files (.env) must land 0600 even on rewrite, and --dry-run must perform
// NO spawn and NO filesystem mutation.
//
// context.ts is exercised against the REAL fs in an isolated temp dir (the only
// way to assert chmod bits and no-write).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRealContext } from './context';

// ---------------------------------------------------------------------------
// context.ts — real fs, real spawn, isolated temp dir
// ---------------------------------------------------------------------------

describe('createRealContext: secret-file mode (0600) enforcement', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'exepad-ctx-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a new secret file with 0600 (owner-only) perms', () => {
    const ctx = createRealContext();
    const p = join(dir, '.env');
    ctx.writeFile(p, 'EXEPAD_TOKEN=secret\n', { mode: 0o600 });

    expect(readFileSync(p, 'utf8')).toBe('EXEPAD_TOKEN=secret\n');
    // Mask off the file-type bits; assert exactly the permission bits.
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });

  it('re-applies 0600 even when the file already exists with looser perms', () => {
    // writeFileSync's `mode` is ignored on an existing file — the explicit chmod
    // in context.ts is what protects `exepad update` rewrites. Seed a world-
    // readable file first, then prove the rewrite clamps it back to 0600.
    const p = join(dir, 'cli-profile.json');
    writeFileSync(p, 'OLD', { mode: 0o644 });
    expect(statSync(p).mode & 0o777).toBe(0o644);

    const ctx = createRealContext();
    ctx.writeFile(p, '{"profiles":{}}', { mode: 0o600 });

    expect(readFileSync(p, 'utf8')).toBe('{"profiles":{}}');
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });

  it('does NOT chmod when no mode is given (ordinary, non-secret file)', () => {
    const p = join(dir, 'docker-compose.yml');
    // Pre-seed at 0644 so we can prove writeFile leaves perms untouched.
    writeFileSync(p, 'OLD', { mode: 0o644 });

    const ctx = createRealContext();
    ctx.writeFile(p, 'services: {}');

    expect(readFileSync(p, 'utf8')).toBe('services: {}');
    expect(statSync(p).mode & 0o777).toBe(0o644);
  });
});

describe('createRealContext: --dry-run suppresses all mutation', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'exepad-dry-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writeFile performs no write (and announces the intent)', () => {
    const ctx = createRealContext({ dryRun: true });
    const p = join(dir, '.env');
    ctx.writeFile(p, 'EXEPAD_TOKEN=secret\n', { mode: 0o600 });
    expect(existsSync(p)).toBe(false);
  });

  it('removeFile performs no deletion under dry-run', () => {
    const p = join(dir, 'keepme');
    writeFileSync(p, 'data');
    const ctx = createRealContext({ dryRun: true });
    ctx.removeFile(p);
    // The file must still be there — dry-run must not destroy operator state.
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf8')).toBe('data');
  });

  it('ensureDir creates nothing under dry-run', () => {
    const ctx = createRealContext({ dryRun: true });
    const sub = join(dir, 'nested', 'deep');
    ctx.ensureDir(sub);
    expect(existsSync(sub)).toBe(false);
  });

  it('exec on a MUTATING command spawns nothing and returns a synthetic success', () => {
    const ctx = createRealContext({ dryRun: true });
    // `false` would exit non-zero if it actually ran; dry-run must short-circuit
    // to code 0 with no spawn at all.
    const res = ctx.exec('false', ['--would-break'], { mutating: true });
    expect(res).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('exec on a NON-mutating command still runs even under dry-run (read-only probes)', () => {
    const ctx = createRealContext({ dryRun: true });
    // Preflight checks (`docker --version`) are read-only and must NOT be
    // suppressed by dry-run, or every dry-run would falsely pass preflight.
    const res = ctx.exec('true', [], { mutating: false });
    expect(res.code).toBe(0);
  });
});

describe('createRealContext: exec semantics (non-dry-run)', () => {
  it('runs a real process and captures stdout + exit code', () => {
    const ctx = createRealContext();
    const res = ctx.exec('node', ['-e', 'process.stdout.write("hi")']);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe('hi');
  });

  it('propagates a non-zero exit code', () => {
    const ctx = createRealContext();
    const res = ctx.exec('node', ['-e', 'process.exit(7)']);
    expect(res.code).toBe(7);
  });

  it('maps a missing binary (ENOENT) to code 127 instead of throwing', () => {
    const ctx = createRealContext();
    const res = ctx.exec('definitely-not-a-real-binary-xyz', ['--version']);
    expect(res.code).toBe(127);
    expect(res.stderr).toContain('command not found');
  });
});

describe('createRealContext: readFile / exists / flags', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'exepad-read-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('readFile returns null for a missing path (never throws)', () => {
    const ctx = createRealContext();
    expect(ctx.readFile(join(dir, 'nope'))).toBeNull();
  });

  it('exists reflects the filesystem', () => {
    const ctx = createRealContext();
    const p = join(dir, 'f');
    expect(ctx.exists(p)).toBe(false);
    writeFileSync(p, '');
    expect(ctx.exists(p)).toBe(true);
  });

  it('defaults dryRun/assumeYes to false and binds env to process.env', () => {
    const ctx = createRealContext();
    expect(ctx.dryRun).toBe(false);
    expect(ctx.assumeYes).toBe(false);
    expect(ctx.env).toBe(process.env);
  });

  it('confirm auto-approves without prompting when assumeYes is set', async () => {
    const ctx = createRealContext({ assumeYes: true });
    await expect(ctx.confirm('proceed?')).resolves.toBe(true);
  });
});
