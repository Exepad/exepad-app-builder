// @vitest-environment node
/**
 * Focused guard for the Content-Length forwarding fix in dispatchFiles.
 *
 * The E2E round-trip test can't cover this: in this Node/undici version a
 * FormData/stream-bodied Request carries NO Content-Length, so the fix line
 * never runs there. A real browser multipart upload DOES send Content-Length,
 * so we simulate that with an explicit header and assert dispatchFiles forwards
 * it onto the in-process app-backend request (where the early-413 size precheck
 * and the byte-rate-limiter read it). fetchAppBackendInProcess is mocked so we
 * inspect exactly the headers dispatchFiles builds.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchSpy, rpcSpy } = vi.hoisted(() => ({
  fetchSpy: vi.fn(),
  rpcSpy: vi.fn(),
}));

vi.mock('../../../worker/src/routes/gateway/dispatch-local', () => ({
  fetchAppBackendInProcess: fetchSpy,
  dispatchRpcInProcess: rpcSpy,
}));

import { dispatchFiles } from '../../../worker/src/routes/gateway/services';
import { type GatewayIdentity } from '../../../worker/src/routes/gateway/auth';
import type { Env } from '../../../worker/src/types/env';

const env = { USER_WORKER_SERVICE_TOKEN: 't', ENVIRONMENT: 'development' } as unknown as Env;

function identity(): GatewayIdentity {
  return {
    headers: new Headers({ 'X-User-Id': 'u1' }),
    isAuthenticated: true,
    kind: 'session',
    stateKey: null,
    userRoles: ['user'],
  };
}

/** headers is the 3rd arg of fetchAppBackendInProcess(request, path, headers, appId, mode, env). */
function forwardedHeaders(): Headers {
  return fetchSpy.mock.calls.at(-1)![2] as Headers;
}

function uploadReq(headers: Record<string, string>, body = 'x'.repeat(64)): Request {
  return new Request('http://gw/api/app1/_files/upload', { method: 'POST', body, headers });
}

describe('dispatchFiles Content-Length forwarding (upload branch)', () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response('{"success":true}', { status: 201 }));
  });

  it('forwards an explicit Content-Length onto the app-backend request (the fix)', async () => {
    const req = uploadReq({ 'Content-Type': 'multipart/form-data; boundary=b', 'Content-Length': '120' });
    await dispatchFiles(req, 'app1', 'upload', env, 'published', null, identity());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const h = forwardedHeaders();
    expect(h.get('Content-Length')).toBe('120');
    expect(h.get('Content-Type')).toContain('multipart/form-data');
  });

  it('does NOT fabricate a Content-Length when the request has none', async () => {
    const req = uploadReq({ 'Content-Type': 'multipart/form-data; boundary=b' });
    await dispatchFiles(req, 'app1', 'upload', env, 'published', null, identity());
    const h = forwardedHeaders();
    expect(h.get('Content-Length')).toBeNull();
    expect(h.get('Content-Type')).toContain('multipart/form-data');
  });

  it('does not touch Content-Length on the GET/serve branch (no body)', async () => {
    fetchSpy.mockResolvedValue(new Response('bytes', { status: 200 }));
    const req = new Request('http://gw/api/app1/_files/fid/name.txt', {
      method: 'GET',
      headers: { 'Content-Length': '999' }, // ignored on GET
    });
    await dispatchFiles(req, 'app1', 'fid/name.txt', env, 'published', null, identity());
    const h = forwardedHeaders();
    // serve builds headers without copying Content-Length from the GET request
    expect(h.get('Content-Length')).toBeNull();
  });
});
