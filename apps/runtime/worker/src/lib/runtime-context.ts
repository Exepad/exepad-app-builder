import type { Context } from 'hono';
import type { Env } from '../types/env';

export function getExecutionContext(
  c: Context<{ Bindings: Env }>,
): ExecutionContext | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

export function getDefaultCache(): Cache | null {
  try {
    if (typeof caches !== 'undefined' && 'default' in caches) {
      return (caches as CacheStorage & { default: Cache }).default;
    }
  } catch {
    // Ignore environments without the Cache API.
  }
  return null;
}

export async function runDeferred(
  promise: Promise<unknown>,
  executionCtx?: ExecutionContext,
): Promise<void> {
  if (executionCtx) {
    executionCtx.waitUntil(promise);
    return;
  }
  await promise;
}
