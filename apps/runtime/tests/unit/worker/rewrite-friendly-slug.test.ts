// @vitest-environment node
/**
 * rewriteFriendlySlug — the edge rewrite that lets a shared `/a/<slug>/…` URL
 * serve through the id-keyed routing, against a REAL temp meta.sqlite.
 *
 * The browser keeps the slug in the address bar; the server rewrites the
 * incoming request URL to `/a/<id>/…` so every downstream route/storage lookup
 * (all keyed on `app.id`) runs unchanged.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir: string;
// index.ts reads EXEPAD_* at import time via its deps, so point the meta db at a
// temp file BEFORE importing the module under test.
beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-rewrite-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
  process.env.EXEPAD_META_DB = join(dataDir, 'meta.sqlite');
});
afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

async function seed() {
  const { createUser, createApp } = await import('../../../worker/src/lib/meta-db');
  const { hashPassword } = await import('../../../worker/src/lib/password');
  const user = createUser(`rw-${Math.random().toString(36).slice(2)}@x.com`, await hashPassword('pw-secret-123'));
  return createApp(user.id, 'Tide List'); // slug: tide-list, id: a<random>
}

describe('rewriteFriendlySlug', () => {
  it('rewrites /a/<slug>/ to /a/<id>/, keeping the rest of the path', async () => {
    const app = await seed();
    const { rewriteFriendlySlug } = await import('../../../worker/src/index');

    const root = rewriteFriendlySlug(new Request(`http://localhost/a/${app.slug}/`));
    expect(new URL(root.url).pathname).toBe(`/a/${app.id}/`);

    const deep = rewriteFriendlySlug(new Request(`http://localhost/a/${app.slug}/repo/img_1.js`));
    expect(new URL(deep.url).pathname).toBe(`/a/${app.id}/repo/img_1.js`);
  });

  it('leaves a raw-id path untouched (same Request instance)', async () => {
    const app = await seed();
    const { rewriteFriendlySlug } = await import('../../../worker/src/index');
    const req = new Request(`http://localhost/a/${app.id}/`);
    expect(rewriteFriendlySlug(req)).toBe(req);
  });

  it('leaves an unknown segment untouched (→ downstream 404)', async () => {
    const { rewriteFriendlySlug } = await import('../../../worker/src/index');
    const req = new Request('http://localhost/a/nope-not-real/');
    expect(rewriteFriendlySlug(req)).toBe(req);
  });

  it('does not touch non-/a/ paths', async () => {
    const { rewriteFriendlySlug } = await import('../../../worker/src/index');
    const req = new Request('http://localhost/api/settings/whatever');
    expect(rewriteFriendlySlug(req)).toBe(req);
  });

  it('preserves method, body, and headers when rewriting a POST', async () => {
    const app = await seed();
    const { rewriteFriendlySlug } = await import('../../../worker/src/index');
    const req = new Request(`http://localhost/a/${app.slug}/repo/x`, {
      method: 'POST',
      body: 'payload-123',
      headers: { 'x-test': 'keep' },
    });
    const out = rewriteFriendlySlug(req);
    expect(new URL(out.url).pathname).toBe(`/a/${app.id}/repo/x`);
    expect(out.method).toBe('POST');
    expect(out.headers.get('x-test')).toBe('keep');
    expect(await out.text()).toBe('payload-123');
  });
});
