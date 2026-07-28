/**
 * Per-app build-conversation persistence (`{appId}/chat-history.json`).
 *
 * The Studio builder's left panel (prompt + agent activity timeline) used to be
 * pure client React state — lost on every reload/navigation. This stores the
 * conversation as an append-only log of the raw events the agent + orchestrator
 * emit (user prompts, progress steps, chat answers, deploy status), so the
 * client can rebuild the exact timeline on mount and a build that outlives the
 * page can be re-attached to.
 *
 * Events carry a monotonic `__seq` (their global index in the conversation) so a
 * reconnecting client can de-duplicate the overlap between the persisted history
 * it loads and a live build's buffered events it replays — see
 * `routes/orchestrate.ts`. The log lives in the same `CONFIG_CACHE` storage as
 * the app's config, under the `{appId}/` prefix, so app deprovision
 * (`deletePrefix('{appId}/')`) removes it with everything else.
 */
import type { Env } from '../types/env';

export interface ChatEvent {
  type: string;
  /** Monotonic global index in the conversation; assigned when buffered. */
  __seq?: number;
  [key: string]: unknown;
}

export interface ChatLog {
  events: ChatEvent[];
  /** Seq the NEXT appended event should take (= last __seq + 1). */
  nextSeq: number;
}

/** Cap the stored log so a long-lived app's history file stays bounded. */
const MAX_EVENTS = 1200;

const logKey = (appId: string): string => `${appId}/chat-history.json`;

export async function loadChatLog(env: Env, appId: string): Promise<ChatLog> {
  try {
    const obj = await env.CONFIG_CACHE.get(logKey(appId));
    if (!obj) return { events: [], nextSeq: 0 };
    const data = JSON.parse(await obj.text()) as Partial<ChatLog>;
    const events = Array.isArray(data.events) ? (data.events as ChatEvent[]) : [];
    const last = events.length ? events[events.length - 1].__seq : undefined;
    const nextSeq =
      typeof data.nextSeq === 'number'
        ? data.nextSeq
        : typeof last === 'number'
          ? last + 1
          : events.length;
    return { events, nextSeq };
  } catch {
    // A corrupt/half-written log must never wedge the builder — start fresh.
    return { events: [], nextSeq: 0 };
  }
}

/**
 * Append a finished turn's events (each already carrying its `__seq`) to the
 * persisted log, trimming oldest whole turns to stay under the cap. Callers
 * serialize per-app (one build per app at a time), so the read-modify-write is
 * safe despite the storage adapter having no locking.
 */
export async function appendChatLog(
  env: Env,
  appId: string,
  newEvents: ChatEvent[],
): Promise<void> {
  if (!newEvents.length) return;
  const log = await loadChatLog(env, appId);
  const events = trimByTurns([...log.events, ...newEvents], MAX_EVENTS);
  const lastSeq = newEvents[newEvents.length - 1].__seq;
  const nextSeq =
    typeof lastSeq === 'number' ? lastSeq + 1 : log.nextSeq + newEvents.length;
  await env.CONFIG_CACHE.put(logKey(appId), JSON.stringify({ events, nextSeq }), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/**
 * Keep the newest events under `max`, cutting on a turn boundary (a
 * `user_prompt` event) so the history never opens mid-turn. Falls back to a
 * raw tail slice if a single turn already exceeds the cap.
 */
function trimByTurns(events: ChatEvent[], max: number): ChatEvent[] {
  if (events.length <= max) return events;
  for (let i = 0; i < events.length; i++) {
    if (events[i].type === 'user_prompt' && events.length - i <= max) {
      return events.slice(i);
    }
  }
  return events.slice(-max);
}
