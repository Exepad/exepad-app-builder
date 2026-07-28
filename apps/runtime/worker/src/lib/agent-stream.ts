/**
 * agent-stream.ts — the worker→agent SSE transport (the `POST /r` build stream).
 *
 * A build run is intentionally DECOUPLED from the client connection and is only
 * aborted by the 25-minute watchdog or an explicit `/cancel` (see
 * `routes/orchestrate.ts` `launchBuildPump`). Node's global `fetch` (undici),
 * however, defaults BOTH `headersTimeout` and `bodyTimeout` to 300 000 ms, and
 * `bodyTimeout` aborts a response whose body goes quiet for longer than that.
 *
 * A slow, off-Gemini build phase (e.g. DesignSystemBuilder spending minutes
 * inside a single litellm call) streams NO SSE bytes for >5 minutes, so the
 * worker's body read threw `UND_ERR_BODY_TIMEOUT` mid-build. `runGenerator`
 * settles that transport error to `error`, and the Studio create-path
 * husk-reaper then deprovisions + DELETES the freshly created app — the build
 * vanishes from the dashboard. That idle ceiling is an accident, not a design
 * choice: it directly contradicts the "build outlives the client, watchdog is
 * the only ceiling" contract. We disable both idle timeouts on a dedicated
 * dispatcher so the 25-minute watchdog stays the single time bound. The connect
 * timeout is left at undici's default so a DOWN agent still fails fast.
 */
import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';

/**
 * The no-idle-timeout policy for the agent SSE stream. `0` disables undici's
 * timer entirely. Exported so a unit test can pin that the ceilings stay
 * disabled (a regression to a finite value re-introduces the build-kill).
 */
export const AGENT_STREAM_TIMEOUTS = { headersTimeout: 0, bodyTimeout: 0 } as const;

/**
 * Build a dispatcher for the agent SSE stream. Defaults disable BOTH idle
 * ceilings (the fix). The optional overrides exist so a test can construct a
 * finite-timeout control and prove a quiet stream WOULD be aborted by a
 * non-zero idle timeout (the regression this module prevents).
 */
export function makeAgentStreamDispatcher(timeouts: {
  headersTimeout?: number;
  bodyTimeout?: number;
} = AGENT_STREAM_TIMEOUTS): Dispatcher {
  return new Agent({
    headersTimeout: timeouts.headersTimeout ?? 0,
    bodyTimeout: timeouts.bodyTimeout ?? 0,
  });
}

/**
 * The body-idle timeout (ms) for the agent SSE stream. `0` (the default)
 * disables it so the 25-minute build watchdog is the only time ceiling — the
 * correct behaviour. An operator may set a finite `EXEPAD_AGENT_STREAM_BODY_TIMEOUT_MS`
 * if they ever want an explicit idle bound (mirrors `EXEPAD_BUILD_TIMEOUT_MIN`),
 * and tests set it to exercise the build-stream wiring. Read at call time so the
 * value isn't frozen at import.
 */
export function agentStreamBodyTimeoutMs(): number {
  const ms = Number(process.env.EXEPAD_AGENT_STREAM_BODY_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

// An undici Agent is a connection pool, so memoize one per distinct timeout
// rather than building a fresh pool on every build.
const _dispatchers = new Map<number, Dispatcher>();
function defaultDispatcher(): Dispatcher {
  const bodyTimeout = agentStreamBodyTimeoutMs();
  let d = _dispatchers.get(bodyTimeout);
  if (!d) {
    d = makeAgentStreamDispatcher({ headersTimeout: 0, bodyTimeout });
    _dispatchers.set(bodyTimeout, d);
  }
  return d;
}

/** Production dispatcher: no idle timeout — the watchdog is the only ceiling. */
export const agentStreamDispatcher = makeAgentStreamDispatcher();

export interface AgentStreamInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** Override the dispatcher (tests only). Defaults to the no-idle-timeout one. */
  dispatcher?: Dispatcher;
}

/**
 * POST to the agent and stream its SSE response with NO idle timeout (unless an
 * operator opts into `EXEPAD_AGENT_STREAM_BODY_TIMEOUT_MS`). Returns the undici
 * Response (structurally a WHATWG `Response`: `.ok`, `.status`, `.body`
 * ReadableStream, `.text()`), typed as the global `Response` so callers read it
 * exactly like a `fetch` result.
 */
export function fetchAgentStream(url: string, init: AgentStreamInit = {}): Promise<Response> {
  return undiciFetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
    dispatcher: init.dispatcher ?? defaultDispatcher(),
  }) as unknown as Promise<Response>;
}
