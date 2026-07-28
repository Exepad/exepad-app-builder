// @vitest-environment node
/**
 * admin-auth.ts — the REAL ownership gate for the Admin API (un-mocked).
 *
 * This module decides whether a request may administer an app's data. It is a
 * trust boundary: an operator must be able to touch ONLY apps they created in
 * `meta.sqlite`, even though many operators share one self-hosted container.
 * A regression here is a cross-tenant data-leak / data-mutation hole.
 *
 * We test the genuine functions directly — only the on-disk meta DB location
 * and the worker `Env` are stubbed (via a temp dir). Cookies are minted with
 * the production `mintSessionToken`, so the session crypto path is exercised
 * end-to-end. No vi.mock of admin-auth, meta-db, or the gateway auth.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  authenticateAdmin,
  operatorOwnsApp,
  isAdminAuthError,
  isSafeAppId,
  type AdminContext,
  type AdminAuthError,
} from '../../../../worker/src/lib/admin-auth';
import { createUser, createApp } from '../../../../worker/src/lib/meta-db';
import { hashPassword } from '../../../../worker/src/lib/password';
import {
  mintSessionToken,
  PLATFORM_SESSION_COOKIE,
} from '../../../../worker/src/routes/gateway/auth';
import type { Env } from '../../../../worker/src/types/env';

const BRIDGE_SECRET = 'test-bridge-secret-admin-auth-0123456789';
const DEPLOY_SECRET = 'test-deploy-secret-admin-auth-abcdefghij';

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-admin-auth-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
  process.env.EXEPAD_META_DB = join(dataDir, 'meta.sqlite');
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

// ── Env / request builders ───────────────────────────────────────────────────

/**
 * Build a worker Env. `DEPLOY_SECRET` is a SecretStore-shaped object (`.get()`);
 * `PLATFORM_BRIDGE_SECRET` may be a plain string per SecretBinding. Defaults
 * mirror a normally-provisioned container; pass overrides to model a
 * mis-provisioned one (empty/absent secrets).
 */
function env(overrides?: {
  deploySecret?: string | null;
  bridgeSecret?: string | null;
}): Env {
  const deploy = overrides && 'deploySecret' in overrides ? overrides.deploySecret : DEPLOY_SECRET;
  const bridge = overrides && 'bridgeSecret' in overrides ? overrides.bridgeSecret : BRIDGE_SECRET;
  return {
    DEPLOY_SECRET: { get: async () => deploy ?? '' },
    PLATFORM_BRIDGE_SECRET: bridge ?? '',
  } as unknown as Env;
}

function bareRequest(): Request {
  return new Request('https://host.local/api/admin/db', { method: 'POST' });
}

function requestWithDeploySecret(secret: string): Request {
  return new Request('https://host.local/api/admin/db', {
    method: 'POST',
    headers: { 'X-Deploy-Secret': secret },
  });
}

function requestWithCookie(cookieValue: string): Request {
  return new Request('https://host.local/api/admin/db', {
    method: 'POST',
    headers: { Cookie: `${PLATFORM_SESSION_COOKIE}=${cookieValue}` },
  });
}

/** Mint a valid platform-session cookie for an operator id, signed with `secret`. */
async function sessionCookieFor(uid: string, secret = BRIDGE_SECRET): Promise<string> {
  return mintSessionToken(uid, `${uid}@x.com`, ['admin'], secret);
}

let userSeq = 0;
async function makeOperator() {
  return createUser(`op-${userSeq++}-${Math.random().toString(36).slice(2)}@x.com`, await hashPassword('pw-secret-123'));
}

// ── isAdminAuthError discriminator ───────────────────────────────────────────

describe('isAdminAuthError', () => {
  it('returns true for an AdminAuthError (unauthorized: true)', () => {
    const err: AdminAuthError = { unauthorized: true, status: 401, message: 'Unauthorized' };
    expect(isAdminAuthError(err)).toBe(true);
  });

  it('returns true for a 500 provisioning error', () => {
    const err: AdminAuthError = { unauthorized: true, status: 500, message: 'boom' };
    expect(isAdminAuthError(err)).toBe(true);
  });

  it('returns false for a successful AdminContext', () => {
    const ctx: AdminContext = {
      appId: 'a1',
      config: { accountId: 'local', apiToken: 'local', wfpNamespace: 'local', appId: 'a1', appAlias: 'a1' },
      dbId: '/tmp/x.sqlite',
    };
    expect(isAdminAuthError(ctx)).toBe(false);
  });

  it('narrows the union so the success branch is typed as AdminContext', () => {
    // Type-flow check doubling as a runtime assertion.
    const value: AdminContext | AdminAuthError = {
      appId: 'a2',
      config: { accountId: 'local', apiToken: 'local', wfpNamespace: 'local', appId: 'a2', appAlias: 'a2' },
      dbId: '/tmp/y.sqlite',
    };
    if (isAdminAuthError(value)) {
      throw new Error('should not be classified as error');
    }
    expect(value.appId).toBe('a2');
  });
});

// ── operatorOwnsApp — the ownership gate ─────────────────────────────────────

describe('operatorOwnsApp', () => {
  it('grants the owner: A’s session on A’s app => true', async () => {
    const owner = await makeOperator();
    const app = createApp(owner.id, 'Owner App');
    const cookie = await sessionCookieFor(owner.id);

    expect(await operatorOwnsApp(requestWithCookie(cookie), env(), app.id)).toBe(true);
  });

  it('denies cross-operator: B’s session on A’s app => false', async () => {
    const ownerA = await makeOperator();
    const operatorB = await makeOperator();
    const app = createApp(ownerA.id, 'A’s App');
    const cookieB = await sessionCookieFor(operatorB.id);

    expect(await operatorOwnsApp(requestWithCookie(cookieB), env(), app.id)).toBe(false);
  });

  it('denies when there is no session cookie at all', async () => {
    const owner = await makeOperator();
    const app = createApp(owner.id, 'No-Cookie App');

    expect(await operatorOwnsApp(bareRequest(), env(), app.id)).toBe(false);
  });

  it('denies when PLATFORM_BRIDGE_SECRET is empty (mis-provisioned container)', async () => {
    const owner = await makeOperator();
    const app = createApp(owner.id, 'Empty-Secret App');
    // Cookie is validly signed, but the env has no secret to verify it.
    const cookie = await sessionCookieFor(owner.id);

    expect(await operatorOwnsApp(requestWithCookie(cookie), env({ bridgeSecret: '' }), app.id)).toBe(false);
  });

  it('denies a cookie signed with the WRONG secret (forged session)', async () => {
    const owner = await makeOperator();
    const app = createApp(owner.id, 'Forged App');
    const forged = await sessionCookieFor(owner.id, 'attacker-secret-different-9999999999');

    expect(await operatorOwnsApp(requestWithCookie(forged), env(), app.id)).toBe(false);
  });

  it('denies a garbage / non-token cookie value', async () => {
    const owner = await makeOperator();
    const app = createApp(owner.id, 'Garbage App');

    expect(await operatorOwnsApp(requestWithCookie('not-a-valid-token'), env(), app.id)).toBe(false);
  });

  it('denies when the target app does not exist in meta.sqlite', async () => {
    const owner = await makeOperator();
    const cookie = await sessionCookieFor(owner.id);

    expect(await operatorOwnsApp(requestWithCookie(cookie), env(), 'aNonexistentApp')).toBe(false);
  });

  it('denies a valid owner cookie aimed at a DIFFERENT owner’s app', async () => {
    const ownerA = await makeOperator();
    const ownerB = await makeOperator();
    const appA = createApp(ownerA.id, 'A App');
    const appB = createApp(ownerB.id, 'B App');
    const cookieA = await sessionCookieFor(ownerA.id);

    // A owns appA but not appB.
    expect(await operatorOwnsApp(requestWithCookie(cookieA), env(), appA.id)).toBe(true);
    expect(await operatorOwnsApp(requestWithCookie(cookieA), env(), appB.id)).toBe(false);
  });
});

// ── authenticateAdmin — full path (auth + D1 resolution) ─────────────────────

describe('authenticateAdmin', () => {
  it('authorizes the owner via session cookie and returns an AdminContext', async () => {
    const owner = await makeOperator();
    const app = createApp(owner.id, 'Ctx App');
    const cookie = await sessionCookieFor(owner.id);

    const res = await authenticateAdmin(requestWithCookie(cookie), env(), app.id);
    expect(isAdminAuthError(res)).toBe(false);
    const ctx = res as AdminContext;
    expect(ctx.appId).toBe(app.id);
    expect(ctx.dbId).toContain(app.id);
    // Self-host carries CF-shaped fields for signature parity (ignored locally).
    expect(ctx.config).toMatchObject({
      accountId: 'local',
      apiToken: 'local',
      wfpNamespace: 'local',
      appId: app.id,
      appAlias: app.id,
    });
  });

  it('authorizes a service caller via a valid X-Deploy-Secret (no cookie needed)', async () => {
    const owner = await makeOperator();
    const app = createApp(owner.id, 'Deploy App');

    const res = await authenticateAdmin(requestWithDeploySecret(DEPLOY_SECRET), env(), app.id);
    expect(isAdminAuthError(res)).toBe(false);
    expect((res as AdminContext).appId).toBe(app.id);
  });

  it('DENIES operator B’s session on operator A’s app (cross-tenant)', async () => {
    const ownerA = await makeOperator();
    const operatorB = await makeOperator();
    const app = createApp(ownerA.id, 'Cross-tenant App');
    const cookieB = await sessionCookieFor(operatorB.id);

    const res = await authenticateAdmin(requestWithCookie(cookieB), env(), app.id);
    expect(isAdminAuthError(res)).toBe(true);
    expect(res).toMatchObject({ unauthorized: true, status: 401, message: 'Unauthorized' });
  });

  it('DENIES a bare request (no credential whatsoever) with 401', async () => {
    const owner = await makeOperator();
    const app = createApp(owner.id, 'Bare App');

    const res = await authenticateAdmin(bareRequest(), env(), app.id);
    expect(res).toMatchObject({ unauthorized: true, status: 401 });
  });

  it('DENIES a wrong X-Deploy-Secret', async () => {
    const owner = await makeOperator();
    const app = createApp(owner.id, 'Wrong-Secret App');

    const res = await authenticateAdmin(requestWithDeploySecret('wrong-secret-value'), env(), app.id);
    expect(res).toMatchObject({ unauthorized: true, status: 401 });
  });

  it('DENIES an empty X-Deploy-Secret even when env DEPLOY_SECRET is empty (no empty==empty match)', async () => {
    const owner = await makeOperator();
    const app = createApp(owner.id, 'Empty-Deploy App');

    // env deploy secret absent AND header empty: must NOT authorize.
    const res = await authenticateAdmin(
      requestWithDeploySecret(''),
      env({ deploySecret: '' }),
      app.id,
    );
    expect(res).toMatchObject({ unauthorized: true, status: 401 });
  });

  it('DENIES the owner when PLATFORM_BRIDGE_SECRET is empty (session unverifiable)', async () => {
    const owner = await makeOperator();
    const app = createApp(owner.id, 'NoBridge App');
    const cookie = await sessionCookieFor(owner.id);

    const res = await authenticateAdmin(requestWithCookie(cookie), env({ bridgeSecret: '' }), app.id);
    expect(res).toMatchObject({ unauthorized: true, status: 401 });
  });

  it('maps mode "published" (default) to the published.sqlite file', async () => {
    const owner = await makeOperator();
    const app = createApp(owner.id, 'Mode-Pub App');
    const cookie = await sessionCookieFor(owner.id);

    const res = await authenticateAdmin(requestWithCookie(cookie), env(), app.id); // default mode
    const ctx = res as AdminContext;
    expect(isAdminAuthError(res)).toBe(false);
    // dbId is the on-disk path; published mode => exepad-{appId} => published.sqlite.
    expect(ctx.dbId).toContain(join('apps', app.id, 'published.sqlite'));
  });

  it('maps mode "preview" to the preview.sqlite file (distinct from published)', async () => {
    const owner = await makeOperator();
    const app = createApp(owner.id, 'Mode-Prev App');
    const cookie = await sessionCookieFor(owner.id);

    const pub = (await authenticateAdmin(requestWithCookie(cookie), env(), app.id, 'published')) as AdminContext;
    const prev = (await authenticateAdmin(requestWithCookie(cookie), env(), app.id, 'preview')) as AdminContext;

    expect(prev.dbId).toContain(join('apps', app.id, 'preview.sqlite'));
    expect(pub.dbId).toContain(join('apps', app.id, 'published.sqlite'));
    // Preview and published must resolve to DIFFERENT databases.
    expect(prev.dbId).not.toBe(pub.dbId);
  });

  it('treats any non-"preview" mode as published mapping', async () => {
    const owner = await makeOperator();
    const app = createApp(owner.id, 'Mode-Junk App');
    const cookie = await sessionCookieFor(owner.id);

    const res = (await authenticateAdmin(requestWithCookie(cookie), env(), app.id, 'totally-unknown')) as AdminContext;
    expect(res.dbId).toContain(join('apps', app.id, 'published.sqlite'));
  });

  it('rejects a path-traversal appId BEFORE any auth or DB path is built (even with a valid deploy secret)', async () => {
    // The deploy-secret branch performs no ownership lookup, so appId must be
    // validated up front or `../../` would resolve outside the data dir.
    for (const badId of ['../../etc', '..', 'a/../../b', 'a/b', 'a\0b', 'a..b/../c']) {
      const res = await authenticateAdmin(requestWithDeploySecret(DEPLOY_SECRET), env(), badId);
      expect(isAdminAuthError(res)).toBe(true);
      expect((res as AdminAuthError).status).toBe(400);
      expect((res as Record<string, unknown>).dbId).toBeUndefined();
    }
  });

  it('accepts a normal generated-style appId', async () => {
    expect(isSafeAppId('a1b2c3d4e5f6g7h8')).toBe(true);
    expect(isSafeAppId('../../etc')).toBe(false);
    expect(isSafeAppId('a/b')).toBe(false);
    expect(isSafeAppId('')).toBe(false);
  });

  it('with createIfMissing:false returns a dbMissing sentinel instead of provisioning a DB', async () => {
    // A read-only caller must never create an empty SQLite file as a
    // write-on-read side effect (source.ts documents the same invariant).
    const owner = await makeOperator();
    const app = createApp(owner.id, 'Read-Only App');
    const cookie = await sessionCookieFor(owner.id);

    const res = await authenticateAdmin(
      requestWithCookie(cookie),
      env(),
      app.id,
      'published',
      { createIfMissing: false },
    );
    expect(isAdminAuthError(res)).toBe(false);
    const ctx = res as AdminContext;
    expect(ctx.dbMissing).toBe(true);
    expect(ctx.dbId).toBe('');
    // No SQLite file was created on disk for this fresh app.
    expect(existsSync(join(dataDir, 'apps', app.id, 'published.sqlite'))).toBe(false);
  });

  it('with createIfMissing:false still resolves an EXISTING db (no dbMissing once provisioned)', async () => {
    const owner = await makeOperator();
    const app = createApp(owner.id, 'Provisioned App');
    const cookie = await sessionCookieFor(owner.id);

    // Provision the DB via a normal (default) call first.
    const provisioned = (await authenticateAdmin(requestWithCookie(cookie), env(), app.id)) as AdminContext;
    expect(provisioned.dbMissing).toBeUndefined();

    // A subsequent read-only call finds it and does NOT report dbMissing.
    const readOnly = (await authenticateAdmin(
      requestWithCookie(cookie),
      env(),
      app.id,
      'published',
      { createIfMissing: false },
    )) as AdminContext;
    expect(readOnly.dbMissing).toBeUndefined();
    expect(readOnly.dbId).toContain(app.id);
  });

  it('still denies an unauthorized read-only (createIfMissing:false) call BEFORE the DB check', async () => {
    const operatorB = await makeOperator();
    const ownerA = await makeOperator();
    const app = createApp(ownerA.id, 'RO Cross-tenant App');
    const cookieB = await sessionCookieFor(operatorB.id);

    const res = await authenticateAdmin(
      requestWithCookie(cookieB),
      env(),
      app.id,
      'published',
      { createIfMissing: false },
    );
    expect(isAdminAuthError(res)).toBe(true);
    expect((res as AdminAuthError).status).toBe(401);
  });

  it('does NOT leak a DB context on denial (auth runs before provisioning)', async () => {
    // A denied request must never reach D1 provisioning — the file must not be
    // created as a side effect of an unauthorized call. We assert the shape is
    // an error and carries no dbId.
    const operatorB = await makeOperator();
    const ownerA = await makeOperator();
    const app = createApp(ownerA.id, 'No-Leak App');
    const cookieB = await sessionCookieFor(operatorB.id);

    const res = await authenticateAdmin(requestWithCookie(cookieB), env(), app.id);
    expect(isAdminAuthError(res)).toBe(true);
    expect((res as Record<string, unknown>).dbId).toBeUndefined();
  });
});
