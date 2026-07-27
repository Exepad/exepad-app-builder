/**
 * Orchestration glue (self-hosted single container).
 *
 * Replaces the Django backend that used to drive an agent build and move its
 * output to R2. Flow for `POST /api/orchestrate/run`:
 *
 *   1. Auth the operator + create/load the `apps` row.
 *   2. Open a server-side POST to the local agent `/r` (SSE) and RE-STREAM it to
 *      the browser verbatim, while sniffing event types to detect terminal
 *      success/failure.
 *   3. On success: pull build artifacts (`GET /artifacts/{session}`), compile +
 *      write them to storage (`materializeBuild`), then run the deploy pipeline
 *      in `preview` mode by re-entering `routes/deploy.ts`.
 *   4. Emit a final `deploy_status` SSE event so the UI can show the preview.
 *
 * `POST /api/orchestrate/apps/:appId/publish` promotes the preview config to
 * `published` and re-deploys.
 */
import { Hono } from 'hono';
import type { Env } from '../types/env';
import { runDeployInProcess as runDeploy, promotePreviewToPublished } from '../lib/deploy-internal';
import { requirePlatformUser } from './auth';
import { materializeBuild } from '../server/materialize-build';
import {
  deriveAppName,
  displayNameFromConfig,
  GENERIC_AGENT_APP_NAME,
} from '../lib/app-name';
import {
  getApp,
  createApp,
  touchApp,
  recordDeployment,
  latestDeployment,
  listDeployments,
  getDeployment,
  updateDeploymentConfigPath,
  setActivePreviewVersion,
  getActivePreviewVersion,
  getAllSettings,
  userCanAccessApp,
  listAppsAccessibleBy,
  setAppSlug,
  deleteApp as deleteAppRegistryRows,
  type MetaApp,
  type MetaUser,
} from '../lib/meta-db';
import { invalidateDomainCache } from '../lib/custom-domains';
import { effectiveImageProvider } from './settings';
import { deprovisionApp } from './deprovision';
import { stopShareForApp } from './publish';
import { invalidateConfig } from '../lib/app-config';
import { invalidateGatewayConfig } from './gateway/config';
import {
  snapshotPreviewVersion,
  restorePreviewVersionAssets,
  deleteVersionSnapshot,
  versionMarker,
  isVersionMarker,
  KEEP_VERSIONS,
} from '../lib/versions';
import { loadChatLog, appendChatLog, type ChatEvent } from '../lib/chat-store';
import { enumerateSource, readEntryBytes } from '../lib/export/source-set';
import { fetchAgentStream } from '../lib/agent-stream';

export const orchestrate = new Hono<{ Bindings: Env }>();

function agentBase(): string {
  return process.env.EXEPAD_AGENT_URL ?? 'http://127.0.0.1:8081';
}

/**
 * Headers for a direct worker→agent call (`/r`, `/artifacts`, `/cancel`).
 *
 * The agent enforces the shared internal token (`X-Exepad-Internal-Secret`)
 * on these endpoints whenever `EXEPAD_AGENT_INTERNAL_SECRET` is configured
 * (the secure self-host default). The `/agent/*` reverse proxy in `index.ts`
 * stamps it, but the build path calls the agent DIRECTLY and must stamp it too
 * — otherwise every build 403s ("Missing or invalid internal token"). Mirror
 * the proxy: attach when set, and never forward a caller-supplied value.
 */
export function agentHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const internalSecret = process.env.EXEPAD_AGENT_INTERNAL_SECRET;
  if (internalSecret) headers['X-Exepad-Internal-Secret'] = internalSecret;
  return headers;
}

/**
 * Load the prior build's config + sources so an EDIT turn can hand them to the
 * agent. Self-host has no shared durable store between the worker and the Python
 * agent (the cloud topology used GCS), and the agent's ADK session starts empty
 * each build — so without this the agent would plan against an empty app and
 * rehydrate every component to an empty stub.
 *
 * Returns the parsed preview `app_config` plus a `source_files` map of
 * `relative source path → text`, walking the live config's `repo.*` refs via the
 * shared {@link enumerateSource}. The agent looks styles up at fixed paths, so we
 * also pull `compiled/frontend/styles/compiled.css` explicitly (it lives in the
 * config's `.compiled`, not `.source`, so the ref walk misses it). Returns
 * `null` when there is no preview build yet (first create).
 */
async function loadPriorBuildForEdit(
  env: Env,
  appId: string,
): Promise<{ app_config: unknown; source_files: Record<string, string> } | null> {
  const { configRaw, entries } = await enumerateSource(env, appId);
  if (!configRaw) return null;

  let app_config: unknown;
  try {
    app_config = JSON.parse(configRaw);
  } catch {
    return null;
  }

  const { files } = await readEntryBytes(env, entries);
  const decoder = new TextDecoder();
  const source_files: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(files)) {
    source_files[path] = decoder.decode(bytes);
  }

  // The agent rehydrates the compiled Tailwind CSS at this fixed path; the
  // ref walk only sees `styles[*].source`, so add it directly if present.
  const COMPILED_CSS_REL = 'compiled/frontend/styles/compiled.css';
  if (!(COMPILED_CSS_REL in source_files)) {
    const obj = await env.CONFIG_CACHE.get(`${appId}/${COMPILED_CSS_REL}`);
    if (obj) source_files[COMPILED_CSS_REL] = await obj.text();
  }

  return { app_config, source_files };
}

function sseEvent(obj: unknown): string {
  return `event: message\ndata: ${JSON.stringify(obj)}\n\n`;
}

// deriveAppName / displayNameFromConfig / GENERIC_AGENT_APP_NAME now live in
// lib/app-name.ts so the maintenance name-backfill can share them.

/** Short label for a version in the timeline — the build prompt, truncated. */
function versionLabel(prompt: string, operationMode: 'create' | 'edit'): string {
  const text = prompt.replace(/\s+/g, ' ').trim().slice(0, 80);
  return text || (operationMode === 'edit' ? 'Edit' : 'Initial build');
}

/**
 * Build the `runtime_settings` block sent to the agent `/r` endpoint from the
 * operator's stored settings. Only stored overrides are sent; anything absent
 * falls back to the agent process's own environment (the first-boot seed). The
 * agent applies these to its `os.environ` + rebinds its LLM models per build, so
 * a key/model saved in the UI takes effect on the next build with no restart.
 */
export function buildRuntimeSettings(): Record<string, unknown> | undefined {
  const store = getAllSettings();
  const llm: Record<string, string> = {};
  if (store['llm.provider']) llm.provider = store['llm.provider'];
  if (store['llm.model']) llm.model = store['llm.model'];
  if (store['llm.base_url']) llm.base_url = store['llm.base_url'];
  if (store['llm.api_key']) llm.api_key = store['llm.api_key'];
  // OpenRouter provider-routing pin (see settings.ts KEYS + the agent's
  // config._openrouter_provider_routing). Absent unless the operator set it.
  if (store['llm.provider_order']) llm.provider_order = store['llm.provider_order'];
  if (store['llm.provider_sort']) llm.provider_sort = store['llm.provider_sort'];

  const out: Record<string, unknown> = {};
  if (Object.keys(llm).length > 0) out.llm = llm;

  // Stock images: single active provider. Only emit an image block once the
  // operator has configured images in the UI (an explicit provider pick or a
  // saved key) — a bare install sends nothing, leaving the agent's own env
  // untouched for full back-compat. When emitted, `image_provider` names the
  // one active source and ONLY that provider's key is sent; the agent
  // deactivates the others (see config.apply_runtime_settings).
  const IMAGE_KEY_STORE: Record<string, string> = {
    pexels: 'pexels.api_key',
    unsplash: 'unsplash.api_key',
    pixabay: 'pixabay.api_key',
  };
  const imagesConfigured =
    Boolean(store['images.provider']) ||
    Object.values(IMAGE_KEY_STORE).some((k) => Boolean(store[k]));
  if (imagesConfigured) {
    const provider = effectiveImageProvider(store);
    out.image_provider = provider;
    const keyStoreKey = IMAGE_KEY_STORE[provider];
    if (keyStoreKey && store[keyStoreKey]) {
      out[`${provider}_api_key`] = store[keyStoreKey];
    }
  }

  // Keep-LLM-image-URLs toggle (default ON). Emitted only when the operator
  // has explicitly stored a value, so a bare install sends nothing and the
  // agent keeps its default. Sent as a real boolean; the agent overlays it
  // onto KEEP_LLM_IMAGE_URLS (see config.apply_runtime_settings).
  const keepLlmUrls = store['images.keep_llm_urls'];
  if (keepLlmUrls === 'true' || keepLlmUrls === 'false') {
    out.keep_llm_image_urls = keepLlmUrls === 'true';
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Whether an app has a build actively streaming in THIS process. Derived from
 * the in-memory `buildRuns` registry (defined below) — a run stays `running`
 * until its events are persisted, so this stays true across the whole build
 * including the final write. The maintenance cron (server/maintenance.ts)
 * consults it so it never deletes or screenshots an app mid-build — cheap
 * insurance on top of the age-based cutoffs. A build wedged by a *crashed*
 * process leaves no run on restart, which is exactly why the cron also uses the
 * `building` age threshold.
 */
export function isBuildActive(appId: string): boolean {
  return buildRuns.get(appId)?.status === 'running';
}

/**
 * The live (or recently-finished, pre-eviction) build run's buffered events for
 * an app — the source the Studio build-log stream reads while a build is in
 * memory. Returns null once the run has been evicted.
 */
export function getBuildRunEvents(appId: string): ChatEvent[] | null {
  const run = buildRuns.get(appId);
  return run ? run.events.slice() : null;
}

/** True while a build run for the app is still in memory (live or pre-eviction). */
export function hasLiveBuildRun(appId: string): boolean {
  return buildRuns.has(appId);
}

/**
 * SSE Response of a build's events for the control plane: streams live if a run
 * is in memory, else replays `fallbackEvents` (the durable log tail) and closes.
 * Reuses the same subscriber machinery the Studio stream uses.
 */
export function buildEventsResponse(appId: string, fallbackEvents: ChatEvent[]): Response {
  const run = buildRuns.get(appId);
  const stream = run ? makeSubscriberStream(run, null) : makeSubscriberStream(null, fallbackEvents);
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

export function publicApp(app: MetaApp) {
  return {
    id: app.id,
    name: app.name,
    // The app's alias — its <slug>.yourdomain.com label under a wildcard custom domain.
    slug: app.slug,
    status: app.status,
    createdAt: app.created_at,
    updatedAt: app.updated_at,
    publishedAt: app.published_at,
    previewUrl: `/a/preview-${app.id}/`,
    // Published apps are shared at the friendly, name-derived alias (`/a/<slug>/`);
    // the worker edge resolves the slug back to `app.id` for serving. Preview
    // stays id-based — it's an internal draft URL, never shared.
    publishedUrl: app.published_at ? `/a/${app.slug}/` : null,
    // Only advertise a thumbnail once the cron has captured one; the dashboard
    // falls back to a placeholder when null.
    thumbnailUrl: app.thumbnail_at ? `/api/orchestrate/apps/${app.id}/thumbnail` : null,
  };
}

// runDeploy + the publish promote logic live in lib/deploy-internal.ts so the
// Studio build/publish flow shares one implementation. `runDeploy` is the
// `runDeployInProcess` alias imported above.

async function fetchArtifacts(
  sessionId: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const url =
    `${agentBase()}/artifacts/${encodeURIComponent(sessionId)}` +
    `?user_id=${encodeURIComponent(userId)}&app_name=orchestrator`;
  const resp = await fetch(url, { headers: agentHeaders() });
  if (!resp.ok) {
    throw new Error(`Failed to pull build artifacts (HTTP ${resp.status}).`);
  }
  const data = (await resp.json()) as { artifacts?: Record<string, unknown> };
  return data.artifacts ?? {};
}

// ─── Build-run registry (decouples a build from the client connection) ─────────
//
// A build runs as a background pump that streams the agent + deploy, buffering
// every event in memory and fanning each out to any attached SSE subscribers.
// Because the pump is NOT driven by a client `pull`, the browser can disconnect
// (navigate away, reload) without stopping the build — a build is only aborted
// by an explicit `/cancel`. A reconnecting client re-attaches via
// `GET /apps/:appId/stream`, which replays the buffer then streams live events.
// On completion the buffer is appended to the persisted chat log so the turn
// survives a reload after the run is gone (and a process restart).

export interface BuildRun {
  appId: string;
  sessionId: string;
  /** Global seq the run's first event takes (= persisted log length at start). */
  baseSeq: number;
  /** Every event emitted this run, in order, each tagged with `__seq`. */
  events: ChatEvent[];
  subscribers: Set<(ev: ChatEvent | { __end: true }) => void>;
  status: 'running' | 'done';
  abort: AbortController;
  done: Promise<void>;
  /** Set true when the watchdog force-aborts a build past the time ceiling.
   *  Distinguishes a hung-build TIMEOUT (a failure → settle 'error', reapable)
   *  from a user CANCEL (the same abort path, but settles 'draft' for retry). */
  timedOut?: boolean;
}

/** Live + recently-finished build runs, keyed by app id. */
const buildRuns = new Map<string, BuildRun>();

/** Grace window during which a finished run lingers so a client that asked for
 *  it (`/chat`/`/stream`) while it was running can still replay the final tail. */
const EVICT_MS = 5 * 60_000;
const evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Hard ceiling on how long a single build may run before it is force-aborted.
 * Now that a build outlives the client connection, a hung agent (no response,
 * no client to disconnect) would otherwise stay `running` forever — blocking new
 * builds for the app and keeping the maintenance cron from ever reaping it. Kept
 * under the cron's `building` cutoff so a timed-out build settles itself first.
 */
function buildTimeoutMs(): number {
  const min = Number(process.env.EXEPAD_BUILD_TIMEOUT_MIN);
  return (Number.isFinite(min) && min > 0 ? min : 25) * 60_000;
}

function clearEviction(appId: string): void {
  const t = evictionTimers.get(appId);
  if (t) {
    clearTimeout(t);
    evictionTimers.delete(appId);
  }
}

function scheduleEviction(run: BuildRun): void {
  clearEviction(run.appId);
  const t = setTimeout(() => {
    // Only evict if THIS run still owns the slot (a newer build may have claimed
    // it) and it is finished.
    const cur = buildRuns.get(run.appId);
    if (cur === run && cur.status === 'done') buildRuns.delete(run.appId);
    evictionTimers.delete(run.appId);
  }, EVICT_MS);
  // Never hold the process open just to evict a finished run.
  (t as { unref?: () => void }).unref?.();
  evictionTimers.set(run.appId, t);
}

/** Append an event to a run's buffer (tagging its global seq) and fan it out. */
function pushEvent(run: BuildRun, ev: ChatEvent): void {
  const tagged = { ...ev, __seq: run.baseSeq + run.events.length };
  run.events.push(tagged);
  for (const sub of run.subscribers) {
    try {
      sub(tagged);
    } catch {
      /* a closed subscriber controller — dropped on its own cancel() */
    }
  }
}

/**
 * Settle an app whose build ended without a terminal status write. Three ways
 * to get here, all leaving the app `building`: a watchdog TIMEOUT (hung agent),
 * a transport error mid-stream, or an explicit user CANCEL. Keeps a deployed
 * app at `preview`. For an as-yet-undeployed one:
 *   - `failed` (timeout / transport error) → `error`, so a hung first build
 *     becomes a real failure: the Studio create path reaps it instead of
 *     leaving a `draft` husk that no reaper touches (the husk-reaper keys on
 *     `error`); REST keeps it pollable as a failed build.
 *   - otherwise (clean user cancel) → `draft`, left for the user to retry.
 * No-op once the build already wrote a terminal status (`preview`/`error`).
 */
function settleUnfinishedApp(appId: string, failed: boolean): void {
  const app = getApp(appId);
  if (!app || app.status !== 'building') return;
  const hasPreview = latestDeployment(appId, 'preview')?.status === 'success';
  if (hasPreview) {
    touchApp(appId, { status: 'preview' });
    return;
  }
  touchApp(appId, { status: failed ? 'error' : 'draft' });
}

/**
 * Synchronously claim the single build slot for an app and register a `running`
 * run. MUST be called with NO `await` between the caller's `isBuildActive` check
 * and this call so the check-and-claim is atomic against concurrent `/run`
 * requests (JS is single-threaded; without an await point in between, no other
 * request can interleave). Returns the registered run; the caller fills in
 * `baseSeq` and starts the pump once the persisted log length is known.
 */
function claimBuildRun(
  appId: string,
  sessionId: string,
  abort: AbortController,
): BuildRun {
  const run: BuildRun = {
    appId,
    sessionId,
    baseSeq: 0,
    events: [],
    subscribers: new Set(),
    status: 'running',
    abort,
    done: Promise.resolve(),
  };
  buildRuns.set(appId, run);
  clearEviction(appId);
  return run;
}

/**
 * Start the background pump for a claimed run. Seeds the user prompt as the
 * turn's first event, then streams the agent + deploy. The run stays `running`
 * (so a concurrent `/run` is blocked and the cron protects it) until its events
 * are persisted; only then is it marked `done` and the client streams closed.
 */
function launchBuildPump(run: BuildRun, ctx: RunContext): void {
  // The user's prompt is the first event of the turn — recorded server-side so
  // history + reconnect reconstruct the user bubble (the client no longer adds
  // it optimistically).
  pushEvent(run, { type: 'user_prompt', text: ctx.prompt });

  // Watchdog: force-abort a build that runs past the ceiling so a hung agent
  // can't wedge the app's single build slot forever. Mark `timedOut` first so
  // the settle below treats it as a failure (→ 'error'), not a user cancel.
  const watchdog = setTimeout(() => {
    run.timedOut = true;
    run.abort.abort();
  }, buildTimeoutMs());
  (watchdog as { unref?: () => void }).unref?.();

  let threw = false;
  run.done = (async () => {
    try {
      for await (const ev of runGenerator(ctx)) {
        pushEvent(run, ev as ChatEvent);
      }
    } catch {
      /* aborted (cancel/timeout) or agent transport error — terminal events already emitted */
      threw = true;
    } finally {
      clearTimeout(watchdog);
      // Persist while still `running` so a new `/run` (which is blocked until
      // we flip to `done`) reads a log length that already includes this turn —
      // preventing a seq collision between the two turns.
      try {
        await appendChatLog(ctx.env, ctx.appId, run.events);
      } catch {
        /* persistence is best-effort — never fail a finished build on it */
      }
      // A clean user cancel = aborted but NOT by the watchdog. Anything else
      // that left the build unfinished (watchdog timeout, or a mid-stream throw
      // without an abort) is a genuine failure.
      const userCanceled = run.abort.signal.aborted && !run.timedOut;
      const failed = run.timedOut === true || (threw && !userCanceled);
      settleUnfinishedApp(ctx.appId, failed);
      run.status = 'done';
      for (const sub of run.subscribers) {
        try {
          sub({ __end: true });
        } catch {
          /* closed */
        }
      }
      // Auto-reap a brand-new app whose FIRST build failed: it produced nothing
      // deployable, so an `error`-status husk would otherwise litter the apps
      // list (e.g. a refused/invalid prompt, OR a hung agent the watchdog timed
      // out — both now flip to 'error' above). Gated tightly — only when THIS
      // run created the app AND the failure path flipped it to 'error' (a clean
      // user cancel settles to 'draft' and is left for the user; a success is
      // 'preview'). Tear down storage + DBs + registry rows; best-effort.
      const reapHusk = ctx.reapHuskOnFailure && getApp(ctx.appId)?.status === 'error';
      if (reapHusk) {
        try {
          if (buildRuns.get(ctx.appId) === run) buildRuns.delete(ctx.appId);
          clearEviction(ctx.appId);
          await deprovisionApp(ctx.env, ctx.appId);
          deleteAppRegistryRows(ctx.appId);
        } catch {
          /* best-effort husk cleanup — never throw from a finished build */
        }
      } else if (buildRuns.get(ctx.appId) === run) {
        // Don't clear the slot/eviction if a newer build already claimed it.
        scheduleEviction(run);
      }
    }
  })();
}

/**
 * Build an SSE ReadableStream for one subscriber. When `historyEvents` is
 * provided (the reconnect endpoint), it emits a leading `chat_state` control
 * frame, then the persisted history, then the live run's buffered events
 * (de-duplicated against history by `__seq`), then live events. When it's null
 * (the initiating `/run` client), it emits the run's buffer then live events.
 * Either way, the subscribe + replay happens synchronously so the pump (which
 * only advances on `await`) can't interleave and drop or double an event.
 */
function makeSubscriberStream(
  run: BuildRun | null,
  historyEvents: ChatEvent[] | null,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sub: ((ev: ChatEvent | { __end: true }) => void) | null = null;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(sseEvent(obj)));
        } catch {
          /* controller closed */
        }
      };

      let histMaxSeq = -1;
      if (historyEvents !== null) {
        send({
          type: 'chat_state',
          running: run?.status === 'running',
          sessionId: run?.sessionId ?? null,
        });
        for (const ev of historyEvents) {
          if (typeof ev.__seq === 'number' && ev.__seq > histMaxSeq) histMaxSeq = ev.__seq;
          send(ev);
        }
        send({ type: 'chat_history_end' });
      }

      if (!run) {
        controller.close();
        return;
      }

      // Replay the run's buffer. With history present, skip events already
      // covered by the persisted log (the overlap when a turn finished + was
      // persisted between this client's history load and stream open).
      for (const ev of run.events) {
        if (historyEvents !== null && typeof ev.__seq === 'number' && ev.__seq <= histMaxSeq) {
          continue;
        }
        send(ev);
      }
      if (run.status === 'done') {
        controller.close();
        return;
      }

      sub = (ev) => {
        if ('__end' in ev) {
          if (sub) run.subscribers.delete(sub);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          return;
        }
        send(ev);
      };
      run.subscribers.add(sub);
    },
    cancel() {
      // Client disconnected from THIS stream — just unsubscribe. The build keeps
      // running server-side; only an explicit /cancel stops it.
      if (sub && run) run.subscribers.delete(sub);
    },
  });
}

interface RunContext {
  env: Env;
  appId: string;
  sessionId: string;
  userId: string;
  correlationId: string;
  runPayload: unknown;
  prompt: string;
  operationMode: 'create' | 'edit';
  /** Auto-reap the app if THIS run created it and the first build fails — a
   *  brand-new app that never produced a preview is litter, not a draft. Only
   *  set for the interactive Studio path; REST/agent builds leave the failed
   *  app (and its job) pollable. */
  reapHuskOnFailure: boolean;
  /** App status before this run flipped it to 'building' — restored verbatim
   *  on a conversational (no-config) edit turn so the app isn't left building. */
  priorStatus: string;
  /** Aborts the agent fetch on an explicit cancel (run.abort.signal). */
  signal: AbortSignal;
}

/**
 * Drive one agent build to completion, yielding each agent + orchestrator event
 * as a plain object (the build-run pump tags it with `__seq`, buffers it, fans
 * it out to subscribers, and persists it). Terminal `deploy_status` events mark
 * success/failure.
 */
async function* runGenerator(ctx: RunContext): AsyncGenerator<ChatEvent> {
  const {
    env,
    appId,
    sessionId,
    userId,
    correlationId,
    runPayload,
    prompt,
    operationMode,
    priorStatus,
    signal,
  } = ctx;

  let agentResp: Response;
  try {
    // fetchAgentStream disables undici's default 300s idle (body) timeout: a
    // build is bounded only by the watchdog/cancel (see launchBuildPump), and a
    // slow off-Gemini phase can stream nothing for >5 min without that meaning
    // the build died. See lib/agent-stream.ts.
    agentResp = await fetchAgentStream(`${agentBase()}/r`, {
      method: 'POST',
      headers: agentHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(runPayload),
      signal,
    });
  } catch (e) {
    touchApp(appId, { status: 'error' });
    yield { type: 'deploy_status', status: 'failed', error: `Agent unavailable: ${e}` };
    return;
  }

  if (!agentResp.ok || !agentResp.body) {
    let detail = '';
    try {
      detail = await agentResp.text();
    } catch {
      /* ignore */
    }
    touchApp(appId, { status: 'error' });
    yield {
      type: 'deploy_status',
      status: 'failed',
      error: `Agent error ${agentResp.status}: ${detail.slice(0, 200)}`,
    };
    return;
  }

  const reader = agentResp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawConfig = false;
  let sawFailure = false;
  let sawChat = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of rawEvent.split('\n')) {
          if (!line.startsWith('data:')) continue;
          let obj: ChatEvent;
          try {
            obj = JSON.parse(line.slice(5).trim()) as ChatEvent;
          } catch {
            /* non-JSON event line (keepalive) — ignore */
            continue;
          }
          if (obj.type === 'app_config_updated') sawConfig = true;
          if (obj.type === 'chat_message') sawChat = true;
          const status =
            (obj.callback_data as { status?: string } | undefined)?.status ??
            (obj.status as string | undefined);
          if (obj.type === 'error' || (obj.type === 'backend_response' && status === 'failed')) {
            sawFailure = true;
          }
          yield obj; // forward the parsed agent event to subscribers
        }
      }
    }
  } catch {
    // reader.read() threw. Two very different cases:
    //   • The run was aborted (user cancel / watchdog timeout): the pump's
    //     settle logic owns the terminal status — just stop here.
    //   • A genuine transport error: the agent reset the SSE mid-build (e.g. it
    //     tore down its session while an orphaned component retry was still in
    //     flight — see apps/agent/config.py LITELLM_* notes / "Failed to append
    //     event … not in sessions"). Swallowing it lets the pump observe a clean
    //     generator return (threw=false) and settle the app to `draft` — a
    //     SILENT husk: no deploy_status reaches the client and the husk-reaper
    //     (keyed on `error`) never fires, so a build that did real work just
    //     vanishes. Surface it as a failure so it ends `error` (reaped on the
    //     Studio create path, pollable-as-failed on REST), matching a hung build.
    if (!signal.aborted) {
      touchApp(appId, { status: 'error' });
      yield {
        type: 'deploy_status',
        status: 'failed',
        error: 'The agent connection dropped before the build finished. Please try again.',
      };
    }
    return;
  }

  if (signal.aborted) return;

  // A genuine workflow failure (error event / backend_response failed) is always
  // a failure, even if a partial config slipped through.
  if (sawFailure) {
    touchApp(appId, { status: 'error' });
    yield {
      type: 'deploy_status',
      status: 'failed',
      error: 'The agent build did not produce a deployable app.',
    };
    return;
  }

  if (!sawConfig) {
    // No config change emitted. On an edit turn the agent legitimately answers
    // conversationally (an AppHelpDesk Q&A like "hi", or a no-op edit) — that is
    // a successful turn, NOT a deploy failure. The chat reply already streamed;
    // restore the app's prior status and end quietly without a deploy_status.
    // Only a create turn, or a turn that produced neither config nor chat, is a
    // real "nothing happened" failure.
    if (sawChat && operationMode === 'edit') {
      touchApp(appId, { status: priorStatus === 'building' ? 'draft' : priorStatus });
      return;
    }
    touchApp(appId, { status: 'error' });
    yield {
      type: 'deploy_status',
      status: 'failed',
      error: 'The agent build did not produce a deployable app.',
    };
    return;
  }

  // ── Success: materialize artifacts + deploy preview ───────────────────────
  yield { type: 'deploy_status', status: 'deploying', appId };
  try {
    const artifacts = await fetchArtifacts(sessionId, userId);
    const { appConfig, configPath } = await materializeBuild(env, appId, artifacts as never);
    const deployRes = await runDeploy(env, appId, { mode: 'preview', configPath, correlationId });
    const deployBody = (await deployRes.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
    };
    if (!deployRes.ok || deployBody.success === false) {
      const error = deployBody.error ?? `Deploy failed (HTTP ${deployRes.status})`;
      recordDeployment({ appId, mode: 'preview', status: 'failed', configPath, correlationId, error });
      touchApp(appId, { status: 'error' });
      yield { type: 'deploy_status', status: 'failed', error };
      return;
    }
    const depId = recordDeployment({
      appId,
      mode: 'preview',
      status: 'success',
      configPath,
      correlationId,
      label: versionLabel(prompt, operationMode),
    });
    // Retain a complete, restorable snapshot of the just-deployed build (config +
    // compiled assets + sources) so the operator can switch back to it later. The
    // live working set under `{appId}/compiled|code/...` is overwritten by every
    // build, so a config-only snapshot would be unrestorable. Best-effort — never
    // fail the build on snapshotting.
    try {
      const snapped = await snapshotPreviewVersion(env, appId, depId);
      if (snapped) {
        updateDeploymentConfigPath(depId, versionMarker(depId));
        setActivePreviewVersion(appId, depId);
        await pruneOldVersions(env, appId);
      }
    } catch {
      /* snapshot is best-effort */
    }
    // Sync the dashboard name from the just-deployed config. apps.name started as
    // a prompt-derived placeholder; the agent's config carries the real brand
    // name. Fold it into the same settle write so a build bumps updated_at once.
    // Skip when the config only has a generic placeholder (keep the placeholder).
    const syncedName = displayNameFromConfig(appConfig);
    touchApp(
      appId,
      syncedName ? { status: 'preview', name: syncedName } : { status: 'preview' },
    );
    yield {
      type: 'deploy_status',
      status: 'success',
      appId,
      mode: 'preview',
      previewUrl: `/a/preview-${appId}/`,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    recordDeployment({ appId, mode: 'preview', status: 'failed', correlationId, error });
    touchApp(appId, { status: 'error' });
    yield { type: 'deploy_status', status: 'failed', error };
  }
}

/**
 * Build the agent's `chat_history` from the persisted conversation so edit
 * turns carry prior context. Mapped to `{role, content}` items (the agent
 * normalizes these to strings and keeps the last N), newest turn last.
 */
function buildAgentChatHistory(
  history: ChatEvent[],
  currentPrompt: string,
): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = [];
  for (const ev of history) {
    if (ev.type === 'user_prompt') {
      const text = strOf(ev.text);
      if (text) out.push({ role: 'user', content: text });
    } else if (ev.type === 'chat_message') {
      const text = strOf(ev.text, ev.message, ev.content);
      if (text) out.push({ role: 'assistant', content: text });
    }
  }
  out.push({ role: 'user', content: currentPrompt });
  // The agent truncates to the last N; send a bounded tail to keep the payload small.
  return out.slice(-24);
}

/** First non-empty string among the candidates (mirrors the client's strOf). */
function strOf(...vals: unknown[]): string {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
}

// ─── startBuild — claim the slot + launch the build pump (shared core) ─────────

export interface StartBuildOk {
  ok: true;
  app: MetaApp;
  run: BuildRun;
  sessionId: string;
  operationMode: 'create' | 'edit';
}
export interface StartBuildErr {
  ok: false;
  status: 400 | 404 | 409 | 500;
  error: string;
}
export type StartBuildResult = StartBuildOk | StartBuildErr;

/**
 * Claim an app's single build slot and launch the background build pump for the
 * given owner. The pure, Context-free core of `POST /run`, used by the SSE route
 * (which streams `run.events`). Resolves create vs edit exactly as
 * the route always has (no `appId` → create; existing+owned → edit unless the
 * app is still a draft). Never throws — failures come back as `{ok:false}` and
 * the claimed slot is released so the app can't wedge at `building`.
 */
export async function startBuild(
  env: Env,
  owner: MetaUser,
  opts: {
    appId?: string;
    prompt: string;
    name?: string;
    operationMode?: string;
    /** Interactive Studio only: auto-delete the app if THIS run created it and
     *  the first build fails (an `error` husk would otherwise litter the apps
     *  list). REST/agent surfaces leave it false so the failed app + its build
     *  job stay pollable (the create→poll-for-outcome contract). */
    reapHuskOnCreateFailure?: boolean;
  },
): Promise<StartBuildResult> {
  // Coerce defensively: a non-string prompt/name (e.g. a number from a
  // malformed direct API client) would throw a TypeError on `.trim()` →
  // an opaque 500. Treat any non-string as absent so it fails the explicit
  // 400 below instead of crashing.
  const prompt = (typeof opts.prompt === 'string' ? opts.prompt : '').trim();
  if (!prompt) return { ok: false, status: 400, error: 'prompt is required' };

  let app: MetaApp;
  // Track whether THIS call created the app — only a freshly-created app whose
  // first build fails is eligible for auto-reap (an existing app/draft is never
  // deleted), and only when the caller opted in (interactive Studio).
  let createdFresh = false;
  // A caller-supplied name is the user's explicit choice; an empty one means we
  // fall back to a prompt-derived placeholder AND let the agent invent the real
  // brand name (see seedAppName below).
  const explicitName = (typeof opts.name === 'string' ? opts.name : '').trim();
  if (opts.appId) {
    const existing = getApp(opts.appId);
    // Edit access = owner OR collaborator (the new agent/dev surfaces); legacy
    // Studio callers are the owner, so this only ever broadens to granted users.
    if (!existing || !userCanAccessApp(owner.id, existing.id)) {
      return { ok: false, status: 404, error: 'App not found' };
    }
    app = existing;
  } else {
    app = createApp(owner.id, explicitName || deriveAppName(prompt));
    createdFresh = true;
  }

  const operationMode: 'create' | 'edit' =
    opts.operationMode === 'edit' || (opts.appId && app.status !== 'draft') ? 'edit' : 'create';

  // What to send the agent as `app_name`. The agent treats a non-generic
  // `app_name` as the user's chosen brand and keeps it verbatim — so seeding it
  // with our prompt-derived placeholder made the agent echo the prompt back as
  // the app's name (the dashboard then showed the prompt, not a real name).
  // On a create with no explicit user name, seed a recognized-generic instead so
  // the agent actually invents/extracts a brand name into config.name, which the
  // build pump then syncs back into apps.name. An explicit name is honored; an
  // edit keeps the app's current name (the agent preserves config.name anyway).
  const seedAppName =
    operationMode === 'create' && !explicitName ? GENERIC_AGENT_APP_NAME : app.name;

  const sessionId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();
  // Capture the status before flipping to 'building' so a conversational
  // (no-config) edit turn can restore it instead of reporting a deploy failure.
  const priorStatus = app.status;

  // ── Atomic claim ──────────────────────────────────────────────────────────
  // Refuse a second concurrent build for the same app — it would corrupt the
  // per-app event seq and double-deploy. The check + claim run with NO `await`
  // in between, so concurrent callers (two tabs, direct API) can't both pass:
  // JS is single-threaded, and the slot is reserved before the first await
  // point. A finished run lingers as `done`, so it does NOT block a new build.
  if (isBuildActive(app.id)) {
    return { ok: false, status: 409, error: 'A build is already in progress for this app.' };
  }
  const abortController = new AbortController();
  const run = claimBuildRun(app.id, sessionId, abortController);
  touchApp(app.id, { last_session_id: sessionId, status: 'building' });
  // ── End claim (awaits are safe now: a concurrent caller sees `running`) ─────

  // Any throw between the claim and a launched pump would wedge the slot at
  // `running` forever (blocking new builds, hidden from the cron). Release it.
  try {
    // The seq the run's first event takes continues the persisted conversation,
    // so a reconnecting client can de-dupe history against the live buffer. Also
    // feed the agent the accumulated chat history for edit context.
    const baseLog = await loadChatLog(env, app.id);
    run.baseSeq = baseLog.nextSeq;

    // On an edit, hand the agent the prior build's config + sources. Self-host
    // shares no durable store with the agent and its session starts empty, so
    // without this the agent rehydrates every component to an empty stub.
    const priorBuild =
      operationMode === 'edit' ? await loadPriorBuildForEdit(env, app.id) : null;

    const runPayload = {
      user_id: owner.id,
      session_id: sessionId,
      operation_mode: operationMode,
      runtime_settings: buildRuntimeSettings(),
      payload: {
        app_uuid: app.id,
        app_public_id: app.id,
        app_name: seedAppName,
        app_type: 'WebAppProps',
        // The agent seeds session state from these payload keys verbatim, then the
        // creation workflow reads the user's prompt from `initial_description`
        // (StateKeys.INITIAL_DESCRIPTION) with a `user_prompt` fallback. Send the
        // keys the agent actually reads so the Creator never plans from app_name.
        app_description: prompt,
        initial_description: prompt,
        user_prompt: prompt,
        correlation_id: correlationId,
        chat_history: buildAgentChatHistory(baseLog.events, prompt),
        // Edit-turn rehydration inputs (see loadPriorBuildForEdit). The agent
        // reads `app_config` (StateKeys.APP_CONFIG) and `source_files`
        // (source_rehydration_service) to recover the prior app.
        ...(priorBuild
          ? { app_config: priorBuild.app_config, source_files: priorBuild.source_files }
          : {}),
      },
    };

    launchBuildPump(run, {
      env,
      appId: app.id,
      sessionId,
      userId: owner.id,
      correlationId,
      runPayload,
      prompt,
      operationMode,
      reapHuskOnFailure: createdFresh && opts.reapHuskOnCreateFailure === true,
      priorStatus,
      signal: abortController.signal,
    });
  } catch (e) {
    // Release the claimed slot so the app isn't wedged at 'building'.
    if (buildRuns.get(app.id) === run) buildRuns.delete(app.id);
    // The build never actually started (launchBuildPump threw synchronously), so
    // the pump's failure/reap path won't run. Settle as a non-failure: an edit
    // build is restored to `preview` (a prior deployment exists) and a fresh
    // create drops to a retriable `draft` rather than an un-reaped `error` husk.
    settleUnfinishedApp(app.id, false);
    return {
      ok: false,
      status: 500,
      error: `Failed to start build: ${e instanceof Error ? e.message : e}`,
    };
  }

  return { ok: true, app, run, sessionId, operationMode };
}

// ─── POST /run — build (and deploy preview) an app from a prompt ──────────────

orchestrate.post('/run', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  let body: { prompt?: string; app_id?: string; app_name?: string; operation_mode?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const result = await startBuild(c.env, authed.user, {
    appId: body.app_id,
    prompt: body.prompt ?? '',
    name: body.app_name,
    operationMode: body.operation_mode,
    // Interactive Studio: if a brand-new app's first build fails, reap the
    // empty `error` husk instead of leaving it in the apps list.
    reapHuskOnCreateFailure: true,
  });
  if (!result.ok) {
    return c.json({ success: false, error: result.error }, result.status);
  }

  // Subscribe the initiating client to the live run (no history replay — it was
  // already loaded on mount). Disconnecting just unsubscribes; the build runs on.
  return new Response(makeSubscriberStream(result.run, null), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-App-Id': result.app.id,
      'X-Session-Id': result.sessionId,
    },
  });
});

// ─── GET /apps/:appId/stream — load chat history + re-attach to a live build ──
//
// Opened on every Studio mount for an existing app. Emits a `chat_state` control
// frame (is a build live? + its session id for the Stop button), then the
// persisted conversation, a `chat_history_end` marker, then — if a build is
// running — the live build's buffered + ongoing events until it finishes. This
// is what makes a build that outlived the page reappear in progress.

orchestrate.get('/apps/:appId/stream', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);
  const app = getApp(c.req.param('appId'));
  if (!app || !userCanAccessApp(authed.user.id, app.id)) {
    return c.json({ success: false, error: 'App not found' }, 404);
  }

  // Snapshot the live run synchronously BEFORE the async history read so a run
  // that finishes mid-handler can't slip between the two reads — any overlap is
  // then de-duped by `__seq` inside makeSubscriberStream.
  const run = buildRuns.get(app.id) ?? null;
  const log = await loadChatLog(c.env, app.id);

  return new Response(makeSubscriberStream(run, log.events), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

// ─── Cancel a build by session id (shared core) ──────────────────────────────

/**
 * Best-effort stop of a build for the given owner: abort the in-process run
 * (decoupled from any client connection — it only stops on this explicit
 * signal), then tell the agent to stop too. Owner-scoped: only the run's owner
 * can abort it. Invoked by POST /cancel.
 */
export async function cancelBuild(ownerId: string, sessionId: string): Promise<boolean> {
  let aborted = false;
  for (const run of buildRuns.values()) {
    if (run.sessionId === sessionId) {
      // Owner OR collaborator may cancel a build on an app they can access.
      if (userCanAccessApp(ownerId, run.appId)) {
        run.abort.abort();
        aborted = true;
      }
      break;
    }
  }
  try {
    await fetch(`${agentBase()}/cancel`, {
      method: 'POST',
      headers: agentHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ session_id: sessionId }),
    });
  } catch {
    /* best-effort */
  }
  return aborted;
}

// ─── POST /cancel — best-effort stop signal to the agent + local run ─────────

orchestrate.post('/cancel', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);
  let body: { session_id?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }
  if (!body.session_id) return c.json({ success: false, error: 'session_id is required' }, 400);
  await cancelBuild(authed.user.id, body.session_id);
  return c.json({ success: true });
});

// ─── GET /apps — list the operator's apps ────────────────────────────────────
//
// Keyset-paginated over (updated_at, id) descending. `limit` caps the page size
// (default 24, max 100); `cursor` is the opaque token from the previous page's
// `nextCursor`. `nextCursor` is null on the last page. Callers that omit both
// still get a bounded first page rather than the entire table.

const DEFAULT_APPS_PAGE_SIZE = 24;
const MAX_APPS_PAGE_SIZE = 100;

// Opaque cursor = base64url("<updated_at>\0<id>"). The NUL delimiter can't appear
// in an ISO timestamp or a UUID, so the split is unambiguous.
function encodeAppsCursor(updatedAt: string, id: string): string {
  return Buffer.from(`${updatedAt} ${id}`, 'utf8').toString('base64url');
}
function decodeAppsCursor(cursor: string): { afterUpdatedAt: string; afterId: string } | null {
  try {
    const [afterUpdatedAt, afterId] = Buffer.from(cursor, 'base64url').toString('utf8').split(' ');
    if (!afterUpdatedAt || !afterId) return null;
    return { afterUpdatedAt, afterId };
  } catch {
    return null;
  }
}

orchestrate.get('/apps', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  const limitParam = Number(c.req.query('limit'));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), MAX_APPS_PAGE_SIZE)
      : DEFAULT_APPS_PAGE_SIZE;
  const decoded = c.req.query('cursor') ? decodeAppsCursor(c.req.query('cursor')!) : null;

  // Over-fetch by one row to detect whether another page exists without a count.
  const rows = listAppsAccessibleBy(authed.user.id, {
    limit: limit + 1,
    afterUpdatedAt: decoded?.afterUpdatedAt,
    afterId: decoded?.afterId,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeAppsCursor(last.updated_at, last.id) : null;

  return c.json({ success: true, apps: page.map(publicApp), nextCursor });
});

// ─── GET /apps/:appId/thumbnail — dashboard preview image ────────────────────
//
// Owner-scoped (operator session cookie). The maintenance cron captures the JPEG
// to `{appId}/thumbnail.jpg` in storage; this streams it back so a same-origin
// <img> on the dashboard renders it. 404s (→ placeholder) until one exists.

orchestrate.get('/apps/:appId/thumbnail', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);
  const app = getApp(c.req.param('appId'));
  if (!app || !userCanAccessApp(authed.user.id, app.id)) {
    return c.json({ success: false, error: 'App not found' }, 404);
  }
  const obj = await c.env.CONFIG_CACHE.get(`${app.id}/thumbnail.jpg`);
  if (!obj) return c.json({ success: false, error: 'No thumbnail' }, 404);
  return new Response(await obj.arrayBuffer(), {
    headers: {
      'Content-Type': 'image/jpeg',
      // Regenerated in place when the app changes — keep the dashboard fresh.
      'Cache-Control': 'no-cache',
    },
  });
});

// ─── GET /apps/:appId — app detail + deploy status ───────────────────────────

orchestrate.get('/apps/:appId', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);
  const app = getApp(c.req.param('appId'));
  if (!app || !userCanAccessApp(authed.user.id, app.id)) {
    return c.json({ success: false, error: 'App not found' }, 404);
  }
  return c.json({
    success: true,
    app: publicApp(app),
    preview: latestDeployment(app.id, 'preview'),
    published: latestDeployment(app.id, 'published'),
  });
});

// ─── POST /apps/:appId/alias — rename the app's wildcard subdomain label ──────
//
// The alias is the label the app answers on under a wildcard custom domain
// (<alias>.yourdomain.com). Owner-scoped; validated + uniqueness-checked in
// setAppSlug (against other aliases AND app ids, which share that label namespace).
// invalidateDomainCache() so the new label resolves on the very next request.
orchestrate.post('/apps/:appId/alias', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);
  const app = getApp(c.req.param('appId'));
  if (!app || !userCanAccessApp(authed.user.id, app.id)) {
    return c.json({ success: false, error: 'App not found' }, 404);
  }
  let body: { alias?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }
  const result = setAppSlug(app.id, String(body.alias ?? ''));
  if (!result.ok) return c.json({ success: false, error: result.error }, 400);
  invalidateDomainCache();
  return c.json({ success: true, slug: result.slug });
});

// ─── POST /apps/:appId/publish — promote preview → published ──────────────────

orchestrate.post('/apps/:appId/publish', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);
  const app = getApp(c.req.param('appId'));
  if (!app || !userCanAccessApp(authed.user.id, app.id)) {
    return c.json({ success: false, error: 'App not found' }, 404);
  }

  // Serialize against an in-flight build so publish can't snapshot a
  // half-materialized working set (matching rollback/unpublish).
  if (isBuildActive(app.id)) {
    return c.json(
      { success: false, error: 'A build is in progress; try again once it finishes' },
      409,
    );
  }

  // Promote the materialized preview config → published + deploy. Shared with
  // the Studio publish flow via lib/deploy-internal.ts.
  const result = await promotePreviewToPublished(c.env, app.id);
  if (!result.ok) {
    return c.json({ success: false, error: result.error }, result.status as 400 | 500);
  }
  // Surface the friendly published URL (`/a/<slug>/`) to match publicApp(); the
  // internal deploy result is id-keyed.
  return c.json({ success: true, url: `/a/${app.slug}/`, deploy: result.deploy });
});

// ─── POST /apps/:appId/unpublish — take a published app offline (soft) ─────────
//
// Removes the served published config + status pointer so `/a/{id}/` and the
// data API go offline, but leaves the immutable release folder + deployments +
// active_published_version intact so Republish/rollback restore without a rebuild.
orchestrate.post('/apps/:appId/unpublish', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ error: { message: 'Not authenticated' } }, 401);
  const app = getApp(c.req.param('appId'));
  if (!app || !userCanAccessApp(authed.user.id, app.id)) {
    return c.json({ error: { message: 'App not found' } }, 404);
  }
  if (!app.published_at) {
    return c.json({ error: { message: 'App is not published' } }, 409);
  }
  // Serialize against an in-flight build so the status transition can't race a deploy.
  if (isBuildActive(app.id)) {
    return c.json({ error: { message: 'A build is in progress; try again once it finishes' } }, 409);
  }

  try {
    await c.env.CONFIG_CACHE.delete(`${app.id}/published/app-config.json`);
    await c.env.CONFIG_CACHE.delete(`${app.id}/deployment-status-published.json`);
  } catch {
    /* best-effort — the cache busts below stop it being served regardless */
  }
  await invalidateConfig(app.id, 'published');
  await invalidateGatewayConfig(app.id, 'published');
  // A live public tunnel would otherwise keep serving a now-unpublished app.
  await stopShareForApp(app.id);

  const hasPreview = latestDeployment(app.id, 'preview')?.status === 'success';
  const status = hasPreview ? 'preview' : 'draft';
  touchApp(app.id, { status, published_at: null });
  return c.json({ status });
});

// ─── DELETE /apps/:appId — permanently delete an app (owner-only) ──────────────
//
// Stops any active share, tears down storage + per-mode SQLite DBs (deprovision,
// which never throws), then drops the registry rows. Partial storage failures are
// reported but the app is still removed from listings.
orchestrate.delete('/apps/:appId', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ error: { message: 'Not authenticated' } }, 401);
  const app = getApp(c.req.param('appId'));
  // Delete is owner-only — even a shared operator must not be able to destroy it.
  if (!app || app.owner_id !== authed.user.id) {
    return c.json({ error: { message: 'App not found' } }, 404);
  }
  // Refuse while a build is mid-flight: the pump would keep writing storage/
  // registry rows after we tear them down. Cancel the build first.
  if (isBuildActive(app.id)) {
    return c.json({ error: { message: 'A build is in progress; cancel it before deleting' } }, 409);
  }

  await stopShareForApp(app.id);
  const result = await deprovisionApp(c.env, app.id);
  deleteAppRegistryRows(app.id);
  return c.json({ deleted: true, partial: result.errors.length > 0 });
});

// ─── App versions (preview build history) ────────────────────────────────────

/**
 * Prune version snapshots beyond the retention cap (oldest first), never the
 * active one. Keeps storage bounded — each version is a full asset copy.
 */
async function pruneOldVersions(env: Env, appId: string): Promise<void> {
  const active = getActivePreviewVersion(appId);
  const versionDeps = listDeployments(appId, 'preview', 500).filter(
    (d) => d.status === 'success' && isVersionMarker(d.config_path),
  );
  const prunable = versionDeps.slice(KEEP_VERSIONS).filter((d) => d.id !== active);
  for (const d of prunable) {
    try {
      await deleteVersionSnapshot(env, appId, d.id);
      updateDeploymentConfigPath(d.id, null); // drop it from the timeline
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Backfill a baseline version for apps built before versioning existed (or before
 * a complete snapshot was retained). Recovers the CURRENT live preview working
 * set as one restorable version tied to the latest successful deployment. Earlier
 * intermediate states are unrecoverable — only one config file ever existed — so
 * this captures "where the app is now" as the starting point of its timeline.
 */
async function ensureBaselineVersion(env: Env, app: MetaApp): Promise<void> {
  const deps = listDeployments(app.id, 'preview', 500).filter((d) => d.status === 'success');
  if (deps.some((d) => isVersionMarker(d.config_path))) return; // already have versions

  const live = await env.CONFIG_CACHE.get(`${app.id}/preview/app-config.json`);
  if (!live) return; // nothing deployed yet

  let depId = deps[0]?.id;
  if (depId == null) {
    depId = recordDeployment({
      appId: app.id,
      mode: 'preview',
      status: 'success',
      configPath: null,
      label: 'Recovered version',
    });
  }
  const snapped = await snapshotPreviewVersion(env, app.id, depId);
  if (snapped) {
    updateDeploymentConfigPath(depId, versionMarker(depId));
    if (getActivePreviewVersion(app.id) == null) setActivePreviewVersion(app.id, depId);
  }
}

// ─── GET /apps/:appId/versions — preview build timeline (newest first) ─────────

orchestrate.get('/apps/:appId/versions', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);
  const app = getApp(c.req.param('appId'));
  if (!app || !userCanAccessApp(authed.user.id, app.id)) {
    return c.json({ success: false, error: 'App not found' }, 404);
  }

  // Recover a baseline for apps that predate versioning, then list the timeline.
  try {
    await ensureBaselineVersion(c.env, app);
  } catch {
    /* best-effort backfill */
  }

  const active = getActivePreviewVersion(app.id);
  const versions = listDeployments(app.id, 'preview', 100)
    .filter((d) => d.status === 'success' && isVersionMarker(d.config_path))
    .map((d) => ({
      id: d.id,
      createdAt: d.created_at,
      label: d.label ?? null,
      current: active != null && d.id === active,
    }));
  // No pointer recorded yet (legacy) → the newest is what's live.
  if (active == null && versions.length > 0) versions[0].current = true;

  return c.json({ success: true, versions });
});

// ─── POST /apps/:appId/versions/:versionId/restore — switch the live preview ──
//
// Non-destructive: restores a version's full working set (config + compiled +
// sources) over the live preview keys and re-runs the deploy pipeline so the DB
// schema, seeds, and handler bundle match. Newer versions are preserved, so the
// operator can move backward AND forward through the timeline by restoring any
// entry. Updates the active-version pointer so the timeline shows the live one.

orchestrate.post('/apps/:appId/versions/:versionId/restore', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);
  const app = getApp(c.req.param('appId'));
  if (!app || !userCanAccessApp(authed.user.id, app.id)) {
    return c.json({ success: false, error: 'App not found' }, 404);
  }
  const versionId = Number(c.req.param('versionId'));
  const dep = getDeployment(versionId);
  if (!dep || dep.app_id !== app.id || !isVersionMarker(dep.config_path)) {
    return c.json({ success: false, error: 'Version not found' }, 404);
  }

  // 1. Lay the snapshot's working set back over the live preview keys.
  const restored = await restorePreviewVersionAssets(c.env, app.id, versionId);
  if (!restored) {
    return c.json({ success: false, error: 'Version snapshot is no longer available' }, 410);
  }

  // 2. Re-deploy so DB/seeds/handlers are rebuilt to match the restored config.
  //    A config-only swap would leave the database + handler bundle from a
  //    different version. deploy() busts the gateway config cache on success.
  const correlationId = crypto.randomUUID();
  const res = await runDeploy(c.env, app.id, {
    mode: 'preview',
    configPath: 'preview/app-config.json',
    correlationId,
  });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!res.ok || body.success === false) {
    return c.json({ success: false, error: body.error ?? `Restore failed (HTTP ${res.status})` }, 500);
  }

  // 3. Move the live pointer; this version is now what the preview serves.
  setActivePreviewVersion(app.id, versionId);
  touchApp(app.id, { status: 'preview' });
  return c.json({ success: true });
});
