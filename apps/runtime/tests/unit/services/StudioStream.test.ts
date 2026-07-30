/**
 * StudioStream Tests — SSE framing + build contract.
 *
 * Focus:
 *   - pumpSse framing (exercised through streamTunnelStatus / streamChat /
 *     runBuild): multi-event chunk, event split across chunks, keepalive lines
 *     skipped, malformed data ignored.
 *   - runBuild: snake_case request payload, header surfacing, and the
 *     synthesized `deploy_status: failed` frame on a non-OK / bodyless response.
 *   - startTunnel: success-collapse (`ok` = HTTP ok AND `success` truthy).
 *
 * The service uses `fetch` streaming (not EventSource), so we feed a fake
 * `ReadableStream<Uint8Array>` as `res.body` exactly like the browser would.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  runBuild,
  startTunnel,
  streamTunnelStatus,
  streamChat,
  type StudioEvent,
  type TunnelStatusEvent,
} from '@/services/StudioStream';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a ReadableStream<Uint8Array> that emits each string in `chunks` as a
 *  separate `read()` — letting us model exactly how the network framed the
 *  bytes (event boundaries that straddle chunks, keepalives in their own chunk,
 *  etc.). */
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

/** A minimal Response-shaped object good enough for the service's reads
 *  (`ok`, `status`, `body`, `headers.get`, `json`). */
function fakeResponse(opts: {
  ok?: boolean;
  status?: number;
  body?: ReadableStream<Uint8Array> | null;
  headers?: Record<string, string>;
  json?: () => Promise<unknown>;
}): Response {
  const headerMap = new Map(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    body: opts.body === undefined ? null : opts.body,
    headers: { get: (k: string) => headerMap.get(k.toLowerCase()) ?? null },
    json: opts.json ?? (async () => ({})),
  } as unknown as Response;
}

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

describe('StudioStream', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ─── pumpSse framing (via streamTunnelStatus) ──────────────────────────────

  describe('pumpSse SSE framing', () => {
    it('dispatches multiple events packed into a single chunk', async () => {
      const body = streamFromChunks([
        sse({ status: 'starting' }) + sse({ status: 'live', url: 'https://a.trycloudflare.com' }),
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse({ body })) as any;

      const events: TunnelStatusEvent[] = [];
      await streamTunnelStatus((e) => events.push(e));

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ status: 'starting' });
      expect(events[1]).toEqual({ status: 'live', url: 'https://a.trycloudflare.com' });
    });

    it('reassembles an event whose framing is split across chunks', async () => {
      // The `data:` line and its terminating blank line arrive in three reads;
      // the parser must buffer until it sees the `\n\n` boundary.
      const full = sse({ status: 'live', url: 'https://x.trycloudflare.com' });
      const a = full.slice(0, 10);
      const b = full.slice(10, 25);
      const c = full.slice(25);
      const body = streamFromChunks([a, b, c]);
      globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse({ body })) as any;

      const events: TunnelStatusEvent[] = [];
      await streamTunnelStatus((e) => events.push(e));

      expect(events).toEqual([{ status: 'live', url: 'https://x.trycloudflare.com' }]);
    });

    it('reassembles an event boundary (\\n\\n) split across two chunks', async () => {
      // The blank-line separator itself straddles the chunk boundary: first
      // chunk ends with one `\n`, next begins with the second `\n`.
      const body = streamFromChunks([
        'data: {"status":"starting"}\n',
        '\ndata: {"status":"live"}\n\n',
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse({ body })) as any;

      const events: TunnelStatusEvent[] = [];
      await streamTunnelStatus((e) => events.push(e));

      expect(events).toEqual([{ status: 'starting' }, { status: 'live' }]);
    });

    it('skips SSE keepalive / comment lines without crashing', async () => {
      // `: keepalive` comment frames and bare `event:`/`id:` lines have no
      // `data:` prefix and must be silently dropped.
      const body = streamFromChunks([
        ': keepalive\n\n',
        'event: ping\nid: 7\n\n',
        sse({ status: 'live' }),
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse({ body })) as any;

      const events: TunnelStatusEvent[] = [];
      await streamTunnelStatus((e) => events.push(e));

      expect(events).toEqual([{ status: 'live' }]);
    });

    it('swallows malformed (non-JSON) data lines but still parses valid ones', async () => {
      const body = streamFromChunks([
        'data: {not valid json}\n\n',
        sse({ status: 'live' }),
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse({ body })) as any;

      const events: TunnelStatusEvent[] = [];
      await streamTunnelStatus((e) => events.push(e));

      expect(events).toEqual([{ status: 'live' }]);
    });

    it('parses a multi-line event, reading every data: line in the frame', async () => {
      // A single SSE frame may carry more than one `data:` line; each is its
      // own JSON payload here.
      const body = streamFromChunks([
        'data: {"status":"starting"}\ndata: {"status":"live"}\n\n',
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse({ body })) as any;

      const events: TunnelStatusEvent[] = [];
      await streamTunnelStatus((e) => events.push(e));

      expect(events).toEqual([{ status: 'starting' }, { status: 'live' }]);
    });

    it('emits nothing for an immediately-closed (empty) stream', async () => {
      const body = streamFromChunks([]);
      globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse({ body })) as any;

      const events: TunnelStatusEvent[] = [];
      await streamTunnelStatus((e) => events.push(e));

      expect(events).toEqual([]);
    });

    it('ignores a trailing unterminated frame (no \\n\\n)', async () => {
      // Last frame never gets its blank-line terminator before the stream
      // closes — it must not be flushed (avoids emitting a half-received event).
      const body = streamFromChunks([
        sse({ status: 'starting' }) + 'data: {"status":"live"}',
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse({ body })) as any;

      const events: TunnelStatusEvent[] = [];
      await streamTunnelStatus((e) => events.push(e));

      expect(events).toEqual([{ status: 'starting' }]);
    });
  });

  // ─── streamTunnelStatus / streamChat guards ────────────────────────────────

  describe('stream guards', () => {
    it('streamTunnelStatus resolves silently when fetch rejects', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;
      const onEvent = vi.fn();

      await expect(streamTunnelStatus(onEvent)).resolves.toBeUndefined();
      expect(onEvent).not.toHaveBeenCalled();
    });

    it('streamTunnelStatus emits nothing on a non-OK response', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(fakeResponse({ ok: false, status: 500, body: null })) as any;
      const onEvent = vi.fn();

      await streamTunnelStatus(onEvent);
      expect(onEvent).not.toHaveBeenCalled();
    });

    it('streamTunnelStatus emits nothing when the response has no body', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(fakeResponse({ ok: true, body: null })) as any;
      const onEvent = vi.fn();

      await streamTunnelStatus(onEvent);
      expect(onEvent).not.toHaveBeenCalled();
    });

    it('streamTunnelStatus requests the status stream with the SSE Accept header', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(fakeResponse({ body: streamFromChunks([]) }));
      globalThis.fetch = fetchMock as any;

      await streamTunnelStatus(() => {});

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/publish/status',
        expect.objectContaining({
          credentials: 'include',
          headers: { Accept: 'text/event-stream' },
        }),
      );
    });

    it('streamChat URL-encodes the appId and resolves silently on fetch reject', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('aborted')) as any;
      const onEvent = vi.fn();

      await expect(streamChat('a/b 1', onEvent)).resolves.toBeUndefined();
      expect(onEvent).not.toHaveBeenCalled();
    });

    it('streamChat pumps the body when the response is OK', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        fakeResponse({ body: streamFromChunks([sse({ type: 'chat_history_end' })]) }),
      );
      globalThis.fetch = fetchMock as any;

      const events: StudioEvent[] = [];
      await streamChat('app-1', (e) => events.push(e));

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/orchestrate/apps/app-1/stream',
        expect.objectContaining({ headers: { Accept: 'text/event-stream' } }),
      );
      expect(events).toEqual([{ type: 'chat_history_end' }]);
    });
  });

  // ─── runBuild contract ─────────────────────────────────────────────────────

  describe('runBuild', () => {
    it('sends a snake_case payload and surfaces the X-App-Id / X-Session-Id headers', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        fakeResponse({
          body: streamFromChunks([sse({ type: 'progress', step: 'planning' })]),
          headers: { 'X-App-Id': 'app-42', 'X-Session-Id': 'sess-7' },
        }),
      );
      globalThis.fetch = fetchMock as any;

      const events: StudioEvent[] = [];
      const handle = await runBuild(
        { prompt: 'build me a CRM', appId: 'app-42', appName: 'CRM', operationMode: 'edit' },
        (e) => events.push(e),
      );

      // Immediate handle reflects the response headers.
      expect(handle.appId).toBe('app-42');
      expect(handle.sessionId).toBe('sess-7');

      // Request shape: snake_case keys, credentialed POST, JSON content type.
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/orchestrate/run');
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      expect(JSON.parse(init.body)).toEqual({
        prompt: 'build me a CRM',
        app_id: 'app-42',
        app_name: 'CRM',
        operation_mode: 'edit',
      });

      // The done promise streams the SSE payloads.
      await handle.done;
      expect(events).toEqual([{ type: 'progress', step: 'planning' }]);
    });

    it('returns null headers when the worker omits them', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(fakeResponse({ body: streamFromChunks([]) })) as any;

      const handle = await runBuild({ prompt: 'x' }, () => {});
      expect(handle.appId).toBeNull();
      expect(handle.sessionId).toBeNull();
      await handle.done;
    });

    it('omits optional snake_case keys (undefined) when only a prompt is given', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(fakeResponse({ body: streamFromChunks([]) }));
      globalThis.fetch = fetchMock as any;

      await runBuild({ prompt: 'hello' }, () => {});

      const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
      // JSON.stringify drops undefined values, so optional keys are absent.
      expect(sent).toEqual({ prompt: 'hello' });
      expect('app_id' in sent).toBe(false);
      expect('operation_mode' in sent).toBe(false);
    });

    it('synthesizes a deploy_status:failed event using the error from a non-OK JSON body', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        fakeResponse({
          ok: false,
          status: 402,
          body: null,
          json: async () => ({ error: 'quota exceeded' }),
        }),
      ) as any;

      const events: StudioEvent[] = [];
      const handle = await runBuild({ prompt: 'x' }, (e) => events.push(e));

      expect(events).toEqual([
        { type: 'deploy_status', status: 'failed', error: 'quota exceeded' },
      ]);
      // Already-resolved done; no streaming.
      await expect(handle.done).resolves.toBeUndefined();
    });

    it('falls back to an HTTP-status error message when the failure body is not JSON', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        fakeResponse({
          ok: false,
          status: 503,
          body: null,
          json: async () => {
            throw new Error('not json');
          },
        }),
      ) as any;

      const events: StudioEvent[] = [];
      await runBuild({ prompt: 'x' }, (e) => events.push(e));

      expect(events).toEqual([
        { type: 'deploy_status', status: 'failed', error: 'Build failed (HTTP 503)' },
      ]);
    });

    it('synthesizes deploy_status:failed when the response is OK but carries no body', async () => {
      // ok=true yet body=null must still take the failure path (the guard is
      // `!res.ok || !res.body`), not silently succeed.
      globalThis.fetch = vi.fn().mockResolvedValue(
        fakeResponse({ ok: true, status: 200, body: null, json: async () => ({}) }),
      ) as any;

      const events: StudioEvent[] = [];
      await runBuild({ prompt: 'x' }, (e) => events.push(e));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'deploy_status', status: 'failed' });
    });

    it('still surfaces headers on the failure path', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        fakeResponse({
          ok: false,
          status: 500,
          body: null,
          headers: { 'X-App-Id': 'app-9', 'X-Session-Id': 'sess-9' },
          json: async () => ({ error: 'boom' }),
        }),
      ) as any;

      const handle = await runBuild({ prompt: 'x' }, () => {});
      expect(handle.appId).toBe('app-9');
      expect(handle.sessionId).toBe('sess-9');
    });
  });

  // ─── startTunnel success-collapse ──────────────────────────────────────────

  describe('startTunnel', () => {
    it('collapses to ok=true only when HTTP-ok AND success is truthy', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        fakeResponse({
          ok: true,
          json: async () => ({
            success: true,
            url: 'https://live.trycloudflare.com',
            status: 'live',
          }),
        }),
      ) as any;

      const result = await startTunnel('app-1');
      expect(result).toEqual({
        ok: true,
        url: 'https://live.trycloudflare.com',
        status: 'live',
        error: undefined,
      });
    });

    it('sends the appId in the JSON body', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(fakeResponse({ ok: true, json: async () => ({ success: true }) }));
      globalThis.fetch = fetchMock as any;

      await startTunnel('my-app');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/publish/start');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ appId: 'my-app' });
    });

    it('reports ok=false when HTTP is ok but success is falsy, preserving the error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        fakeResponse({
          ok: true,
          json: async () => ({ success: false, status: 'error', error: 'cloudflared missing' }),
        }),
      ) as any;

      const result = await startTunnel('app-1');
      expect(result.ok).toBe(false);
      expect(result.status).toBe('error');
      expect(result.error).toBe('cloudflared missing');
    });

    it('reports ok=false when the HTTP status is not ok even if success is true', async () => {
      // success-collapse must AND both conditions: a non-OK HTTP response can
      // never report ok=true regardless of the body.
      globalThis.fetch = vi.fn().mockResolvedValue(
        fakeResponse({ ok: false, status: 403, json: async () => ({ success: true }) }),
      ) as any;

      const result = await startTunnel('app-1');
      expect(result.ok).toBe(false);
    });

    it('treats a non-JSON body as an empty object (ok=false, undefined fields)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        fakeResponse({
          ok: true,
          json: async () => {
            throw new Error('not json');
          },
        }),
      ) as any;

      const result = await startTunnel('app-1');
      expect(result).toEqual({ ok: false, url: undefined, status: undefined, error: undefined });
    });
  });
});
