// @vitest-environment node
/**
 * REAL-SOCKET isolation proof. Unlike the security regression suite (which calls
 * buildPublishApp().fetch directly), this stands up the ACTUAL @hono/node-server
 * loopback listener cloudflared would point at, and makes REAL HTTP requests over
 * the wire — exercising how node-server parses the incoming request, the cors/
 * body middleware, and the header round-trip. This is the headless equivalent of
 * the Playwright HTTP isolation probe (e2e/publish-isolation.spec.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { _startListenerForTests } from '../../../worker/src/routes/publish';

const APP = 'appx123';
const OTHER = 'otherapp9';

let listener: { port: number; close: () => void };
let base: string;
let seen: { path: string; appId: string | null; cookie: string | null; user: string | null } | null;

beforeAll(async () => {
  // A stub "inner" runtime that records what the wall forwarded. Anything that
  // reaches here passed the allow-list.
  const inner = (req: Request): Response => {
    const u = new URL(req.url);
    seen = {
      path: u.pathname,
      appId: req.headers.get('x-exepad-app-id'),
      cookie: req.headers.get('cookie'),
      user: req.headers.get('x-user-id'),
    };
    return new Response('inner-ok', { status: 200 });
  };
  listener = await _startListenerForTests(APP, inner);
  base = `http://127.0.0.1:${listener.port}`;
});

afterAll(() => {
  listener?.close();
});

async function hit(path: string, init?: RequestInit): Promise<Response> {
  seen = null;
  return fetch(base + path, init);
}

describe('real loopback listener — only app X is reachable through the link', () => {
  it('serves the app-X shell at /', async () => {
    const res = await hit('/');
    expect(res.status).toBe(200);
    expect(seen?.path).toBe(`/a/${APP}/`);
    expect(seen?.appId).toBe(APP);
  });

  it('dispatches app-X RPC', async () => {
    const res = await hit(`/api/${APP}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect(seen?.path).toBe(`/api/${APP}/rpc`);
  });

  it('403s the admin panel over the wire', async () => {
    const res = await hit(`/api/admin/${APP}/users`);
    expect(res.status).toBe(403);
    expect(seen).toBeNull();
  });

  it('403s the settings route (the LLM-key surface)', async () => {
    const res = await hit('/api/settings');
    expect(res.status).toBe(403);
    expect(seen).toBeNull();
  });

  it('403s another app over the wire', async () => {
    const res = await hit(`/api/${OTHER}/rpc`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(403);
    expect(seen).toBeNull();
  });

  it('403s the orchestrate + agent surfaces', async () => {
    expect((await hit('/api/orchestrate/run', { method: 'POST' })).status).toBe(403);
    expect((await hit('/agent/r', { method: 'POST' })).status).toBe(403);
  });

  it('strips a spoofed operator cookie + identity header on a real request', async () => {
    const res = await hit(`/api/${APP}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'attacker',
        cookie: 'exepad_platform_session=operator; exepad_app_session=enduser',
      },
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect(seen?.appId).toBe(APP);
    expect(seen?.user).toBeNull();
    expect(seen?.cookie).toBe('exepad_app_session=enduser');
  });
});
