/**
 * Custom Handler Executor
 *
 * Executes user-defined JavaScript handlers with proper context and validation.
 */

import type { Env, HandlerProps, ModelProps, OutputProps } from '../types/env';
import type { RpcResponse, UserContext } from '../rpc/types';
import { ValidationError, HandlerError } from '../utils/errors';
import { validateHandlerInput, tryAutoWrapParams } from '../utils/validation';
import { buildHandlerContext } from '../context/builder';
import { getAppHandlers } from './app-registry';

export type { HandlerFunction } from './app-registry';

/** Default handler execution timeout in milliseconds (10 seconds) */
const DEFAULT_HANDLER_TIMEOUT_MS = 10_000;

/**
 * Execute a promise with a timeout (H5).
 * Rejects with a HandlerError if the handler exceeds the allowed time.
 * Clears the timer on successful completion to avoid leaked timers.
 *
 * LIMITATION (do not mistake this for a hard CPU bound): this is `Promise.race`
 * against a `setTimeout`. It can only fire once the event loop is free, so it
 * bounds a handler that AWAITS (I/O, fetch, sleep) but CANNOT preempt a purely
 * synchronous busy-loop (`while(true){}`) or heavy CPU section — that work
 * blocks the single shared Node event loop before the timer callback can run,
 * and since the self-hosted runtime serves EVERY app in one process this is a
 * cross-tenant DoS vector under a malicious/buggy handler. Real preemption
 * requires running handlers in a terminable worker_thread / subprocess with a
 * hard kill timer (tracked as a followUp — a larger dispatch-seam change).
 * Keep this timeout as the secondary guard for the async case.
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  handlerName: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new HandlerError(
            handlerName,
            `Handler execution timed out after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);
    }),
  ]);
}

/**
 * Validate handler output against the declared output schema (H6).
 * Returns an array of error messages (empty if valid).
 */
function validateHandlerOutput(
  outputs: OutputProps[],
  result: unknown
): string[] {
  if (!outputs || outputs.length === 0) {
    return [];
  }

  if (result === null || result === undefined) {
    return ['Handler declared outputs but returned null/undefined'];
  }

  if (typeof result !== 'object') {
    return [`Expected object result, got ${typeof result}`];
  }

  const errors: string[] = [];
  const data = result as Record<string, unknown>;

  for (const output of outputs) {
    const value = data[output.name];

    if (value === undefined || value === null) {
      continue;
    }

    switch (output.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push(`Output '${output.name}': expected string, got ${typeof value}`);
        }
        break;
      case 'number':
        if (typeof value !== 'number') {
          errors.push(`Output '${output.name}': expected number, got ${typeof value}`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`Output '${output.name}': expected boolean, got ${typeof value}`);
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          errors.push(`Output '${output.name}': expected array, got ${typeof value}`);
        }
        break;
      case 'json':
        break;
    }
  }

  return errors;
}

/**
 * Execute a custom handler
 */
export async function executeHandler(
  handler: HandlerProps,
  params: Record<string, unknown>,
  user: UserContext,
  env: Env,
  models: ModelProps[] = [],
): Promise<RpcResponse> {
  // Validate input (with auto-wrap fallback for flat form data)
  let effectiveParams = params;
  const validationErrors = validateHandlerInput(handler, params);
  if (validationErrors.length > 0) {
    const wrapped = tryAutoWrapParams(handler, params);
    if (wrapped) {
      effectiveParams = wrapped;
    } else {
      throw new ValidationError('Input validation failed', undefined, {
        errors: validationErrors,
      });
    }
  }

  // Resolve the handler function from this app's (appId:mode) registry.
  const registry = await getAppHandlers(env);
  const handlerFn = registry[handler.method] ?? null;

  if (!handlerFn) {
    throw new HandlerError(
      handler.name,
      `Handler method '${handler.method}' not found. Ensure the handler is compiled and bundled.`
    );
  }

  // Build execution context (includes params for handler access via ctx.params)
  const ctx = buildHandlerContext(handler.name, user, env, effectiveParams, models);

  try {
    ctx.log.info('Executing handler', { inputs: Object.keys(effectiveParams) });

    const startTime = Date.now();
    const result = await withTimeout(
      handlerFn(ctx),
      DEFAULT_HANDLER_TIMEOUT_MS,
      handler.name
    );
    const duration = Date.now() - startTime;

    ctx.log.info('Handler completed', { durationMs: duration });

    // Validate output against declared schema (H6)
    const outputErrors = validateHandlerOutput(handler.outputs, result);
    if (outputErrors.length > 0) {
      ctx.log.error('Handler output schema mismatch', { errors: outputErrors });
      throw new HandlerError(
        handler.name,
        `Output validation failed: ${outputErrors.join('; ')}`
      );
    }

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    ctx.log.error('Handler execution failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof ValidationError || error instanceof HandlerError) {
      throw error;
    }

    throw new HandlerError(
      handler.name,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

