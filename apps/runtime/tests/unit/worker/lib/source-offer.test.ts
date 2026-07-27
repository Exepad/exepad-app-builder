// @vitest-environment node
/**
 * AGPL-3.0 section 13 source offer (`lib/source-offer.ts`).
 *
 * Section 13 addresses ALL users who interact with the program over a network,
 * so the offer has to survive two things:
 *  - it must be reachable with NO operator session (the studio About page is
 *    behind /login, but an app's own visitors are anonymous), and
 *  - a fork must be able to rebrand it, or a downstream deployment ships
 *    upstream's repository as the source of *its* modified binary.
 *
 * The URL is also emitted into an `href`, so a bogus/hostile override must fall
 * back to the default rather than reach the page.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { sourceOfferUrl, SOURCE_OFFER_PATH } from '../../../../worker/src/lib/source-offer';
import { injectMeta } from '../../../../worker/src/lib/meta-injector';
import type { Env } from '../../../../worker/src/types/env';

const UPSTREAM = 'https://github.com/Exepad/exepad-app-builder';
const ORIG_SOURCE_URL = process.env.EXEPAD_SOURCE_URL;

let dataDir: string;
// index.ts opens meta.sqlite through its deps at import time — point it at a
// temp file BEFORE the dynamic import below.
beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-source-offer-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
  process.env.EXEPAD_META_DB = join(dataDir, 'meta.sqlite');
});
afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (ORIG_SOURCE_URL === undefined) delete process.env.EXEPAD_SOURCE_URL;
  else process.env.EXEPAD_SOURCE_URL = ORIG_SOURCE_URL;
});

beforeEach(() => {
  delete process.env.EXEPAD_SOURCE_URL;
});

describe('sourceOfferUrl', () => {
  it('defaults to this upstream repository when unset', () => {
    expect(sourceOfferUrl()).toBe(UPSTREAM);
  });

  it('lets a fork point the offer at its own repository', () => {
    process.env.EXEPAD_SOURCE_URL = 'https://git.example.org/me/my-fork';
    expect(sourceOfferUrl()).toBe('https://git.example.org/me/my-fork');
  });

  it('falls back to the default for a non-http(s) or unparseable override', () => {
    process.env.EXEPAD_SOURCE_URL = 'javascript:alert(1)';
    expect(sourceOfferUrl()).toBe(UPSTREAM);
    process.env.EXEPAD_SOURCE_URL = 'not a url';
    expect(sourceOfferUrl()).toBe(UPSTREAM);
    process.env.EXEPAD_SOURCE_URL = '   ';
    expect(sourceOfferUrl()).toBe(UPSTREAM);
  });
});

describe('GET /source — unauthenticated offer', () => {
  it('redirects to the configured source URL with no session at all', async () => {
    process.env.EXEPAD_SOURCE_URL = 'https://git.example.org/me/my-fork';
    const app = (await import('../../../../worker/src/index')).default;
    const res = await app.request(
      `http://localhost${SOURCE_OFFER_PATH}`,
      {},
      { ENVIRONMENT: 'selfhost' } as unknown as Env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://git.example.org/me/my-fork');
  });
});

describe('injectMeta — <link rel="license"> source offer', () => {
  it('emits the offer into a served page for anonymous visitors', async () => {
    const env = {
      ASSETS: {
        fetch: vi.fn(
          async () =>
            new Response('<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>', {
              status: 200,
              headers: { 'content-type': 'text/html' },
            }),
        ),
      },
      CONFIG_CACHE: { get: vi.fn(async () => null) },
      ENVIRONMENT: 'selfhost',
    } as unknown as Env;

    const app = new Hono<{ Bindings: Env }>();
    app.get('*', (c) => injectMeta(c));
    const html = await (await app.request('http://localhost/', {}, env)).text();

    expect(html).toContain(`<link rel="license" href="${UPSTREAM}"`);
  });
});
