/**
 * Tests for handler compilation utilities (bundle/handlers.ts).
 *
 * compileHandler / compileHandlers exercise the real esbuild.build() pipeline
 * against temp files (same harness style as components.test.ts).
 * compileHandlerSource uses esbuild.transform() (no filesystem) and is driven
 * purely from strings.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  compileHandler,
  compileHandlers,
  compileHandlerSource,
} from '../src/bundle/handlers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Temp-dir harness (mirrors components.test.ts).
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

function freshDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exepad-handlers-'));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// compileHandlerSource — string-in / string-out, SDK shim rewrite.
// ---------------------------------------------------------------------------

describe('compileHandlerSource', () => {
  it('compiles a plain async handler to ESM JS', async () => {
    const source = `export default async function run(ctx: { value: number }) {
  return { ok: true, doubled: ctx.value * 2 };
}`;
    const result = await compileHandlerSource(source, 'ts');

    expect(result.success).toBe(true);
    expect(result.errors).toBeUndefined();
    expect(result.code).toBeTruthy();
    // Type annotation stripped; a default export is preserved. esbuild emits
    // a named function + `export { run as default }`, so match either form.
    expect(result.code).toMatch(/export\s+default|as default/);
    expect(result.code).not.toContain(': { value: number }');
  });

  it('rewrites the @exepad/sdk import to the inline backend shim', async () => {
    const source = `import { _ } from '@exepad/sdk';

export default function (rows: any[]) {
  return _.sum(rows.map((r) => r.amount));
}`;
    const result = await compileHandlerSource(source);

    expect(result.success).toBe(true);
    const code = result.code!;
    // The bare module specifier must be GONE — backend has no @exepad/sdk.
    expect(code).not.toContain("from '@exepad/sdk'");
    expect(code).not.toContain('from "@exepad/sdk"');
    // The shim's `_` implementation is inlined (so `_.sum` resolves at runtime).
    expect(code).toContain('round');
    expect(code).toContain('sumBy');
  });

  it('inlined shim _ is actually callable (sum reduces a numeric array)', async () => {
    // Prove the rewrite produces *executable* code, not just text that parses.
    const source = `import { _ } from '@exepad/sdk';
export default function () {
  return _.sum([1, 2, 3, 4]);
}`;
    const result = await compileHandlerSource(source);
    expect(result.success).toBe(true);

    // Import the compiled ESM via a data: URL and invoke the default export.
    const mod = await import(
      'data:text/javascript;base64,' + Buffer.from(result.code!).toString('base64')
    );
    expect(typeof mod.default).toBe('function');
    expect(mod.default()).toBe(10);
  });

  it('handles double-quoted and trailing-whitespace SDK imports', async () => {
    const source = `import {  _  } from "@exepad/sdk"  ;
export default () => _.round(3.14159, 2);`;
    const result = await compileHandlerSource(source, 'ts');

    expect(result.success).toBe(true);
    expect(result.code).not.toContain('@exepad/sdk');
  });

  it('leaves source untouched when there is no @exepad/sdk import', async () => {
    const source = `export default () => 42;`;
    const result = await compileHandlerSource(source);

    expect(result.success).toBe(true);
    // No shim functions injected when the import is absent.
    expect(result.code).not.toContain('function sumBy');
    expect(result.code).not.toContain('function groupBy');
  });

  it('surfaces a clear error for a syntax-error handler (does not throw)', async () => {
    const source = `export default function ( {
  return broken(((;
`;
    const result = await compileHandlerSource(source);

    expect(result.success).toBe(false);
    expect(result.code).toBeUndefined();
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    // esbuild error text is a non-empty string, not "[object Object]".
    expect(typeof result.errors![0]).toBe('string');
    expect(result.errors![0]).not.toBe('');
    expect(result.errors![0]).not.toContain('[object Object]');
  });

  it('reports an error even when a broken handler imports the SDK (shim path)', async () => {
    // Exercises the rewrite branch + failure branch together: a malformed
    // body must still fail loudly rather than emit garbage JS.
    const source = `import { _ } from '@exepad/sdk';
export default function ( = {{ ;`;
    const result = await compileHandlerSource(source);

    expect(result.success).toBe(false);
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('handles empty source without crashing', async () => {
    const result = await compileHandlerSource('');
    expect(result.success).toBe(true);
    // Empty input compiles to empty (or whitespace-only) output.
    expect((result.code ?? '').trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// compileHandler — single file through esbuild.build().
// ---------------------------------------------------------------------------

describe('compileHandler', () => {
  it('compiles a valid handler file and writes the output', async () => {
    const dir = freshDir();
    const src = path.join(dir, 'good.ts');
    const out = path.join(dir, 'good.js');
    fs.writeFileSync(src, `export default async (x: number) => x + 1;`);

    const result = await compileHandler(src, out);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(out);
    expect(fs.existsSync(out)).toBe(true);
    // esbuild emits `export { good_default as default }` for an arrow default.
    expect(fs.readFileSync(out, 'utf8')).toMatch(/export\s+default|as default/);
  });

  it('bundles the @exepad/sdk shim via the resolve/load plugin', async () => {
    const dir = freshDir();
    const src = path.join(dir, 'agg.ts');
    const out = path.join(dir, 'agg.js');
    fs.writeFileSync(
      src,
      `import { _ } from '@exepad/sdk';
export default (rows: { n: number }[]) => _.sumBy(rows, 'n');`,
    );

    const result = await compileHandler(src, out);

    expect(result.success).toBe(true);
    const compiled = fs.readFileSync(out, 'utf8');
    // No unresolved bare import statement survives — the specifier only
    // appears as esbuild's `// sdk-shim:@exepad/sdk` path comment, never as
    // a live `import ... from '@exepad/sdk'`.
    expect(compiled).not.toMatch(/from\s+['"]@exepad\/sdk['"]/);
    // The shim body is bundled inline, so `_.sumBy` resolves at runtime.
    expect(compiled).toContain('sumBy');
  });

  it('returns success:false with errors for a syntax error (no throw)', async () => {
    const dir = freshDir();
    const src = path.join(dir, 'bad.ts');
    const out = path.join(dir, 'bad.js');
    fs.writeFileSync(src, `export default function ( {{ broken`);

    const result = await compileHandler(src, out);

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('returns an error (does not throw) when the source file is missing', async () => {
    const dir = freshDir();
    const src = path.join(dir, 'does-not-exist.ts');
    const out = path.join(dir, 'nope.js');

    const result = await compileHandler(src, out);

    expect(result.success).toBe(false);
    expect(result.errors!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// compileHandlers — directory scan + partial-failure isolation.
// ---------------------------------------------------------------------------

describe('compileHandlers', () => {
  it('creates the output dir and compiles all .ts/.tsx handlers', async () => {
    const srcDir = freshDir();
    const outDir = path.join(srcDir, 'nested', 'out'); // not yet created
    fs.writeFileSync(path.join(srcDir, 'a.ts'), `export default () => 1;`);
    fs.writeFileSync(
      path.join(srcDir, 'b.tsx'),
      `export default (x: number) => x;`,
    );
    // Non-handler files are ignored.
    fs.writeFileSync(path.join(srcDir, 'README.md'), `# ignore me`);
    fs.writeFileSync(path.join(srcDir, 'data.json'), `{"x":1}`);

    const result = await compileHandlers(srcDir, outDir);

    expect(result.success).toBe(true);
    expect(result.compiled.sort()).toEqual(['a', 'b']);
    expect(result.errors).toEqual({});
    expect(fs.existsSync(path.join(outDir, 'a.js'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'b.js'))).toBe(true);
  });

  it('isolates a bad handler: good ones compile, the broken one is reported', async () => {
    const srcDir = freshDir();
    const outDir = path.join(srcDir, 'out');
    fs.writeFileSync(path.join(srcDir, 'ok.ts'), `export default () => 'fine';`);
    fs.writeFileSync(path.join(srcDir, 'broken.ts'), `export default ( {{ nope`);
    fs.writeFileSync(path.join(srcDir, 'also-ok.ts'), `export default () => 2;`);

    const result = await compileHandlers(srcDir, outDir);

    // Overall failure flag set, but the good handlers still produced output.
    expect(result.success).toBe(false);
    expect(result.compiled.sort()).toEqual(['also-ok', 'ok']);
    expect(Object.keys(result.errors)).toEqual(['broken.ts']);
    expect(result.errors['broken.ts'].length).toBeGreaterThan(0);

    // Good handlers wrote files; the broken one did not.
    expect(fs.existsSync(path.join(outDir, 'ok.js'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'also-ok.js'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'broken.js'))).toBe(false);
  });

  it('succeeds with empty compiled list when the dir has no handlers', async () => {
    const srcDir = freshDir();
    const outDir = path.join(srcDir, 'out');
    fs.writeFileSync(path.join(srcDir, 'notes.txt'), `nothing to compile`);

    const result = await compileHandlers(srcDir, outDir);

    expect(result.success).toBe(true);
    expect(result.compiled).toEqual([]);
    expect(result.errors).toEqual({});
  });
});
