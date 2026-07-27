/**
 * deploy-internal.ts — promotePreviewToPublished failure-path cleanup.
 *
 * Regression guard for the "failed first publish serves the un-deployed bare
 * config" defect: promotePreviewToPublished writes the bare
 * `{appId}/published/app-config.json` key BEFORE running the deploy. On a FIRST
 * publish (no prior released version) a deploy failure leaves no release path for
 * the resolver, so it falls back to that bare key and publicly serves the
 * un-deployed frontend at /a/{id}/. The fix deletes the bare key on failure, but
 * ONLY when there was no prior published release (so a re-publish failure never
 * takes the previously-live app offline).
 *
 * We mock the deploy router + secrets + meta-db so the test asserts exactly which
 * CONFIG_CACHE keys promotePreviewToPublished decided to write/delete, with no
 * real SQLite/FS/deploy side effects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (must be declared before importing the module under test) ──
const mockDeployFetch = vi.fn();
vi.mock('../../../worker/src/routes/deploy', () => ({
  deploy: { fetch: (...args: unknown[]) => mockDeployFetch(...args) },
}));

vi.mock('../../../worker/src/lib/secrets', () => ({
  resolveSecret: async () => 'test-deploy-secret',
}));

const mockRecordDeployment = vi.fn();
const mockTouchApp = vi.fn();
const mockGetDeployment = vi.fn();
const mockSetActivePublishedVersion = vi.fn();
const mockGetActivePublishedVersion = vi.fn();
vi.mock('../../../worker/src/lib/meta-db', () => ({
  recordDeployment: (...a: unknown[]) => mockRecordDeployment(...a),
  touchApp: (...a: unknown[]) => mockTouchApp(...a),
  getDeployment: (...a: unknown[]) => mockGetDeployment(...a),
  setActivePublishedVersion: (...a: unknown[]) => mockSetActivePublishedVersion(...a),
  getActivePublishedVersion: (...a: unknown[]) => mockGetActivePublishedVersion(...a),
}));

import { promotePreviewToPublished } from '../../../worker/src/lib/deploy-internal';
import type { Env } from '../../../worker/src/types/env';

const APP = 'app123abc';
const BARE_PUBLISHED_KEY = `${APP}/published/app-config.json`;

/** Env whose CONFIG_CACHE records every put/delete key and serves a preview config. */
function makeEnv() {
  const puts: string[] = [];
  const deletes: string[] = [];
  const env = {
    DEPLOY_SECRET: {},
    CONFIG_CACHE: {
      get: async (key: string) =>
        key === `${APP}/preview/app-config.json`
          ? { text: async () => '{"name":"Demo"}' }
          : null,
      put: async (key: string) => {
        puts.push(key);
      },
      delete: async (key: string) => {
        deletes.push(key);
      },
    },
  } as unknown as Env;
  return { env, puts, deletes };
}

function failingDeploy() {
  mockDeployFetch.mockResolvedValue(
    new Response(JSON.stringify({ success: false, error: 'migration failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('promotePreviewToPublished — failure-path bare-config cleanup', () => {
  it('deletes the bare published config on a FIRST-publish failure (no prior release)', async () => {
    mockGetActivePublishedVersion.mockReturnValue(null); // never successfully published
    failingDeploy();
    const { env, puts, deletes } = makeEnv();

    const r = await promotePreviewToPublished(env, APP);

    expect(r.ok).toBe(false);
    // It wrote the bare key before deploying...
    expect(puts).toContain(BARE_PUBLISHED_KEY);
    // ...and rolled it back on failure so the resolver can't serve un-deployed config.
    expect(deletes).toContain(BARE_PUBLISHED_KEY);
    // The app is NOT flipped to published on failure.
    expect(mockTouchApp).not.toHaveBeenCalled();
    expect(mockSetActivePublishedVersion).not.toHaveBeenCalled();
    // The failure is recorded.
    expect(mockRecordDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ appId: APP, mode: 'published', status: 'failed' }),
    );
  });

  it('does NOT delete the bare key on a RE-publish failure (a prior release is still what is served)', async () => {
    mockGetActivePublishedVersion.mockReturnValue(7); // a prior successful release exists
    failingDeploy();
    const { env, deletes } = makeEnv();

    const r = await promotePreviewToPublished(env, APP);

    expect(r.ok).toBe(false);
    // Leaving the bare key alone: the resolver serves the prior release's configPath,
    // so deleting it would risk taking the previously-live app offline.
    expect(deletes).not.toContain(BARE_PUBLISHED_KEY);
  });

  it('returns 400 without touching the published key when there is no preview build', async () => {
    const puts: string[] = [];
    const deletes: string[] = [];
    const env = {
      DEPLOY_SECRET: {},
      CONFIG_CACHE: {
        get: async () => null, // no preview config
        put: async (k: string) => void puts.push(k),
        delete: async (k: string) => void deletes.push(k),
      },
    } as unknown as Env;

    const r = await promotePreviewToPublished(env, APP);

    expect(r).toEqual({ ok: false, status: 400, error: expect.stringContaining('No preview build') });
    expect(puts).not.toContain(BARE_PUBLISHED_KEY);
    expect(deletes).not.toContain(BARE_PUBLISHED_KEY);
    expect(mockDeployFetch).not.toHaveBeenCalled();
  });
});
