// @vitest-environment node
/**
 * agent-stream.ts — the worker→agent SSE transport must NOT impose an idle
 * (body) timeout. A build is decoupled from the client and bounded only by the
 * 25-minute watchdog; undici's default 300s `bodyTimeout` would otherwise abort
 * a stream that goes quiet during a slow off-Gemini phase (e.g.
 * DesignSystemBuilder), which settles the build to `error` and makes the
 * create-path husk-reaper DELETE the freshly created app.
 *
 * These tests:
 *   1. pin the no-idle-timeout policy — THIS is the real regression guard (a
 *      change back to a finite default fails the assertion); the 300s default
 *      itself can't be exercised in a unit test.
 *   2. prove a FINITE idle timeout DOES abort a quiet SSE stream (the bug
 *      mechanism), and
 *   3. a positive-path smoke test that `fetchAgentStream` (production dispatcher)
 *      SURVIVES the same gap. (NB: a 2s gap clears with OR without the fix since
 *      undici's default is 300s — so #3 is a smoke test, not proof of the fix;
 *      #1 is the guard. The full build-stream wiring is guarded end-to-end in
 *      tests/unit/server/platform-orchestration.test.ts.)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  fetchAgentStream,
  makeAgentStreamDispatcher,
  AGENT_STREAM_TIMEOUTS,
} from '../../../../worker/src/lib/agent-stream';

// SSE server that emits one event, goes QUIET for `gapMs`, then emits a second
// event and ends — mimicking a build phase that streams nothing for minutes
// while the agent thinks inside one long litellm call.
function quietSseServer(gapMs: number): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"type":"progress"}\n\n');
      setTimeout(() => {
        try {
          res.write('data: {"type":"app_config_updated"}\n\n');
          res.end();
        } catch {
          /* socket already torn down */
        }
      }, gapMs);
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

async function readAll(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const dec = new TextDecoder();
  let out = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out;
}

// Quiet long enough to clear undici's ~1s timer granularity (a 500ms bodyTimeout
// fires at ~1s), with margin so the control case throws deterministically before
// the second event arrives.
const GAP_MS = 2000;

let server: Server | undefined;
afterEach(
  () =>
    new Promise<void>((r) => {
      if (server) server.close(() => r());
      else r();
      server = undefined;
    }),
);

describe('agent-stream idle-timeout policy', () => {
  it('pins both idle ceilings to 0 (disabled)', () => {
    expect(AGENT_STREAM_TIMEOUTS.bodyTimeout).toBe(0);
    expect(AGENT_STREAM_TIMEOUTS.headersTimeout).toBe(0);
  });

  it('a FINITE bodyTimeout aborts a quiet SSE stream (the regression we fixed)', async () => {
    const s = await quietSseServer(GAP_MS);
    server = s.server;
    let err: unknown;
    try {
      const resp = await fetchAgentStream(s.url, {
        method: 'GET',
        dispatcher: makeAgentStreamDispatcher({ bodyTimeout: 500 }),
      });
      await readAll(resp.body as unknown as ReadableStream<Uint8Array>);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    const code =
      (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
      (err as { code?: string })?.code;
    expect(code).toBe('UND_ERR_BODY_TIMEOUT');
  }, 15_000);

  it('fetchAgentStream (no idle timeout) survives the same quiet gap', async () => {
    const s = await quietSseServer(GAP_MS);
    server = s.server;
    const resp = await fetchAgentStream(s.url, { method: 'GET' });
    expect(resp.ok).toBe(true);
    const body = await readAll(resp.body as unknown as ReadableStream<Uint8Array>);
    expect(body).toContain('"type":"progress"');
    expect(body).toContain('"type":"app_config_updated"');
  }, 15_000);
});
