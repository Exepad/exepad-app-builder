/**
 * Gateway DEPLOY_FAILED disambiguation (Item 3 of the 1ybz1p4n fix plan).
 *
 * When the preview config can't be loaded, the gateway used to ALWAYS
 * return 503 DEPLOY_IN_PROGRESS (retryable:true), so the SPA's
 * previewRetry loop polled forever. The new ``_maybeDeployFailedResponse``
 * helper peeks at ``deployment-status-preview.json`` in R2 and surfaces
 * a 503 DEPLOY_FAILED (retryable:false) when the status file says the
 * deploy explicitly failed. These tests pin the disambiguation.
 */

import { describe, it, expect } from 'vitest';
import { _maybeDeployFailedResponse } from '../../../../worker/src/routes/gateway/index';
import type { Env } from '../../../../worker/src/types/env';

// Minimal R2 stub — only the fields ``_maybeDeployFailedResponse`` reads.
interface R2GetReturn {
  json(): Promise<unknown>;
}

function makeEnv(statusBody: unknown | null): Env {
  return {
    CONFIG_CACHE: {
      get: async (_key: string): Promise<R2GetReturn | null> => {
        if (statusBody === null) return null;
        return {
          json: async () => statusBody,
        };
      },
    },
  } as unknown as Env;
}

async function asJson(resp: Response | null) {
  expect(resp).not.toBeNull();
  if (!resp) throw new Error('expected response');
  return { status: resp.status, body: await resp.json() } as {
    status: number;
    body: { success: boolean; error: { code: string; message: string; retryable: boolean; underlyingError?: string; step?: string } };
  };
}

describe('_maybeDeployFailedResponse', () => {
  it('returns null when CONFIG_CACHE is not bound', async () => {
    const env = {} as unknown as Env;
    const resp = await _maybeDeployFailedResponse(env, 'any-app');
    expect(resp).toBeNull();
  });

  it('returns null when no deployment-status-preview.json exists in R2', async () => {
    const env = makeEnv(null);
    const resp = await _maybeDeployFailedResponse(env, 'never-deployed-app');
    expect(resp).toBeNull();
  });

  it('returns null when status is "in_progress" (legit DEPLOY_IN_PROGRESS case)', async () => {
    const env = makeEnv({
      appId: 'app',
      mode: 'preview',
      status: 'in_progress',
      updatedAt: '2026-05-19T12:54:00Z',
    });
    const resp = await _maybeDeployFailedResponse(env, 'app');
    expect(resp).toBeNull();
  });

  it('returns null when status is "success" (config not yet propagated)', async () => {
    const env = makeEnv({
      appId: 'app',
      mode: 'preview',
      status: 'success',
      configPath: 'preview-config-v1.json',
      updatedAt: '2026-05-19T12:54:00Z',
    });
    const resp = await _maybeDeployFailedResponse(env, 'app');
    expect(resp).toBeNull();
  });

  it('returns 503 DEPLOY_FAILED when status is "failed" (canonical 1ybz1p4n case)', async () => {
    const env = makeEnv({
      appId: '1ybz1p4n',
      mode: 'preview',
      status: 'failed',
      error:
        'Handler not found in R2 (tried .js and .tsx): ' +
        '1ybz1p4n/compiled/backend/handlers/updateLibrarySettings.js.',
      step: 'provision',
      updatedAt: '2026-05-19T13:02:43.082Z',
    });
    const resp = await _maybeDeployFailedResponse(env, '1ybz1p4n');
    const { status, body } = await asJson(resp);
    expect(status).toBe(503);
    expect(body).toEqual({
      success: false,
      error: {
        code: 'DEPLOY_FAILED',
        message: "Preview build for '1ybz1p4n' failed at step 'provision'.",
        retryable: false,
        underlyingError:
          'Handler not found in R2 (tried .js and .tsx): ' +
          '1ybz1p4n/compiled/backend/handlers/updateLibrarySettings.js.',
        step: 'provision',
      },
    });
  });

  it('handles "failed" status without a step field', async () => {
    const env = makeEnv({
      appId: 'app',
      mode: 'preview',
      status: 'failed',
      error: 'unknown failure',
      updatedAt: '2026-05-19T12:54:00Z',
    });
    const resp = await _maybeDeployFailedResponse(env, 'app');
    const { status, body } = await asJson(resp);
    expect(status).toBe(503);
    expect(body.error.code).toBe('DEPLOY_FAILED');
    expect(body.error.retryable).toBe(false);
    expect(body.error.message).toBe("Preview build for 'app' failed.");
    expect(body.error.underlyingError).toBe('unknown failure');
  });

  it('returns null when the R2 body is not valid JSON', async () => {
    // R2 body present but malformed — fall through to existing
    // DEPLOY_IN_PROGRESS path, don't crash.
    const env = {
      CONFIG_CACHE: {
        get: async () => ({
          json: async () => {
            throw new SyntaxError('not json');
          },
        }),
      },
    } as unknown as Env;
    const resp = await _maybeDeployFailedResponse(env, 'app');
    expect(resp).toBeNull();
  });
});
