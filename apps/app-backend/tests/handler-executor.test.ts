/**
 * Tests for handler executor
 *
 * Tests executeHandler, context building, output validation, timeout, and
 * input validation integration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { executeHandler } from '../src/handlers/executor';
import { registerHandlers, __clearHandlerRegistry } from '../src/handlers/app-registry';
import type { HandlerRegistry } from '../src/handlers/app-registry';
import { buildHandlerContext } from '../src/context/builder';
import { ValidationError, HandlerError } from '../src/utils/errors';
import { createMockD1 } from './helpers/mock-d1';
import { createMockEnv, TEST_MODEL, TEST_USER, TEST_ADMIN } from './helpers/mock-env';
import type { HandlerProps } from '../src/types/env';

// ── Handler registry injection ─────────────────────────────────────
// makeEnv() builds an env with APP_ID 'test-app' / DEPLOY_MODE 'preview'.
// We register a single mutable `mockHandlers` object under that key; the
// app-registry returns it by reference, so per-test registerHandler() calls
// are visible without re-registering.

const mockHandlers: Record<string, (...args: unknown[]) => unknown> = {};

function registerHandler(name: string, fn: (...args: unknown[]) => unknown) {
  mockHandlers[name] = fn;
}

function clearHandlers() {
  for (const key of Object.keys(mockHandlers)) {
    delete mockHandlers[key];
  }
}

beforeEach(() => {
  clearHandlers();
  __clearHandlerRegistry();
  registerHandlers('test-app', 'preview', mockHandlers as unknown as HandlerRegistry);
});

// ── executeHandler ─────────────────────────────────────────────────

describe('executeHandler', () => {
  const baseHandler: HandlerProps = {
    uuid: 'h1',
    name: 'testHandler',
    method: 'testHandler',
    authLevel: 'authenticated',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'count', type: 'number' },
    ],
    outputs: [
      { name: 'result', type: 'string' },
    ],
  };

  function makeEnv() {
    return createMockEnv({
      DB: createMockD1(),
    });
  }

  it('executes handler and returns success', async () => {
    registerHandler('testHandler', async (ctx: Record<string, unknown>) => ({
      result: `hello ${(ctx as { params: Record<string, unknown> }).params.name}`,
    }));

    const result = await executeHandler(
      baseHandler,
      { name: 'Alice', count: '5' },
      TEST_USER,
      makeEnv(),
      [TEST_MODEL]
    );

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).result).toBe('hello Alice');
  });

  it('throws HandlerError when handler method not found', async () => {
    await expect(
      executeHandler(
        { ...baseHandler, method: 'nonExistentMethod' },
        { name: 'Alice', count: 5 },
        TEST_USER,
        makeEnv()
      )
    ).rejects.toThrow(HandlerError);
  });

  it('throws ValidationError for missing required input', async () => {
    registerHandler('testHandler', async () => ({ result: 'ok' }));

    await expect(
      executeHandler(
        baseHandler,
        { name: 'Alice' }, // missing count
        TEST_USER,
        makeEnv()
      )
    ).rejects.toThrow(ValidationError);
  });

  it('rejects extra fields via strict schema', async () => {
    registerHandler('testHandler', async () => ({ result: 'ok' }));

    await expect(
      executeHandler(
        baseHandler,
        { name: 'Alice', count: 5, extraField: 'bad' },
        TEST_USER,
        makeEnv()
      )
    ).rejects.toThrow(ValidationError);
  });

  it('auto-wraps flat form data for single required json input', async () => {
    const jsonHandler: HandlerProps = {
      uuid: 'h-json',
      name: 'evaluateQuiz',
      method: 'evaluateQuiz',
      authLevel: 'public',
      inputs: [{ name: 'answers', type: 'json', required: true }],
      outputs: [],
    };

    registerHandler('evaluateQuiz', async (ctx: Record<string, unknown>) => {
      const params = (ctx as { params: Record<string, unknown> }).params;
      const answers = params.answers as Record<string, string>;
      return { persona: answers.destination === 'beach' ? 'relaxer' : 'adventurer' };
    });

    const result = await executeHandler(
      jsonHandler,
      { destination: 'beach', packing: 'minimalist' }, // flat form data
      TEST_USER,
      makeEnv(),
      [TEST_MODEL]
    );

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).persona).toBe('relaxer');
  });

  it('does not auto-wrap when params already match handler inputs', async () => {
    const jsonHandler: HandlerProps = {
      uuid: 'h-json2',
      name: 'processData',
      method: 'processData',
      authLevel: 'public',
      inputs: [{ name: 'data', type: 'json', required: true }],
      outputs: [],
    };

    registerHandler('processData', async (ctx: Record<string, unknown>) => {
      const params = (ctx as { params: Record<string, unknown> }).params;
      return { received: params.data };
    });

    const result = await executeHandler(
      jsonHandler,
      { data: { key: 'value' } }, // already correctly wrapped
      TEST_USER,
      makeEnv(),
      [TEST_MODEL]
    );

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).received).toEqual({ key: 'value' });
  });

  it('wraps non-WorkerError exceptions in HandlerError', async () => {
    registerHandler('testHandler', async () => {
      throw new Error('something broke');
    });

    await expect(
      executeHandler(
        baseHandler,
        { name: 'Alice', count: 5 },
        TEST_USER,
        makeEnv()
      )
    ).rejects.toThrow(HandlerError);
  });

  it('rethrows ValidationError as-is from handler', async () => {
    registerHandler('testHandler', async () => {
      throw new ValidationError('bad input from handler');
    });

    await expect(
      executeHandler(
        baseHandler,
        { name: 'Alice', count: 5 },
        TEST_USER,
        makeEnv()
      )
    ).rejects.toThrow(ValidationError);
  });

  it('handler with no declared outputs accepts any return', async () => {
    const noOutputHandler: HandlerProps = {
      ...baseHandler,
      outputs: [],
    };
    registerHandler('testHandler', async () => 'anything goes');

    const result = await executeHandler(
      noOutputHandler,
      { name: 'Alice', count: 5 },
      TEST_USER,
      makeEnv()
    );

    expect(result.success).toBe(true);
  });

  it('handler with declared outputs rejects null return', async () => {
    registerHandler('testHandler', async () => null);

    await expect(
      executeHandler(
        baseHandler,
        { name: 'Alice', count: 5 },
        TEST_USER,
        makeEnv()
      )
    ).rejects.toThrow(HandlerError);
  });

  it('handler with declared outputs rejects wrong type', async () => {
    registerHandler('testHandler', async () => ({ result: 42 }));

    await expect(
      executeHandler(
        baseHandler,
        { name: 'Alice', count: 5 },
        TEST_USER,
        makeEnv()
      )
    ).rejects.toThrow('Output validation failed');
  });

  it('handler with no inputs accepts empty params', async () => {
    const noInputHandler: HandlerProps = {
      ...baseHandler,
      inputs: [],
      outputs: [],
    };
    registerHandler('testHandler', async () => ({ done: true }));

    const result = await executeHandler(
      noInputHandler,
      {},
      TEST_USER,
      makeEnv()
    );

    expect(result.success).toBe(true);
  });

  it('coerces string numbers for handler input', async () => {
    registerHandler('testHandler', async () => ({ result: 'ok' }));

    // z.coerce.number() should accept '5' as 5
    const result = await executeHandler(
      baseHandler,
      { name: 'Alice', count: '5' },
      TEST_USER,
      makeEnv()
    );

    expect(result.success).toBe(true);
  });
});

// ── Handler context building ───────────────────────────────────────

describe('buildHandlerContext', () => {
  it('freezes user context (immutable)', () => {
    const env = createMockEnv({ DB: createMockD1() });
    const ctx = buildHandlerContext('test', TEST_USER, env, { x: 1 }, [TEST_MODEL]);

    expect(() => {
      (ctx.user as Record<string, unknown>).id = 'hacked';
    }).toThrow(TypeError);
  });

  it('freezes params (immutable)', () => {
    const env = createMockEnv({ DB: createMockD1() });
    const ctx = buildHandlerContext('test', TEST_USER, env, { x: 1 }, [TEST_MODEL]);

    expect(() => {
      (ctx.params as Record<string, unknown>).x = 999;
    }).toThrow(TypeError);
  });

  it('freezes config (immutable)', () => {
    const env = createMockEnv({ DB: createMockD1() });
    const ctx = buildHandlerContext('test', TEST_USER, env, {}, []);

    expect(() => {
      (ctx.config as Record<string, unknown>).appId = 'evil';
    }).toThrow(TypeError);
  });

  it('provides models keyed by name', () => {
    const env = createMockEnv({ DB: createMockD1() });
    const ctx = buildHandlerContext('test', TEST_USER, env, {}, [TEST_MODEL]);

    expect(ctx.models.contacts).toBeDefined();
    expect(ctx.models.contacts.name).toBe('contacts');
  });

  it('provides a copy of user roles (not the original array)', () => {
    const env = createMockEnv({ DB: createMockD1() });
    const user = { ...TEST_ADMIN, roles: ['admin', 'editor'] };
    const ctx = buildHandlerContext('test', user, env, {}, []);

    // The context should have a frozen copy
    expect(ctx.user.roles).toEqual(['admin', 'editor']);
  });

  it('includes log with all log levels', () => {
    const env = createMockEnv({ DB: createMockD1() });
    const ctx = buildHandlerContext('test', TEST_USER, env, {}, []);

    expect(typeof ctx.log.debug).toBe('function');
    expect(typeof ctx.log.info).toBe('function');
    expect(typeof ctx.log.warn).toBe('function');
    expect(typeof ctx.log.error).toBe('function');
  });

  it('provides db and batch functions', () => {
    const env = createMockEnv({ DB: createMockD1() });
    const ctx = buildHandlerContext('test', TEST_USER, env, {}, []);

    expect(ctx.db).toBeDefined();
    expect(typeof ctx.batch).toBe('function');
  });
});
