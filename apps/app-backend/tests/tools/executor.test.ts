/**
 * Tests for tool executor — routes ToolExecutionRequest to CRUD/handler code.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { executeTool } from '../../src/tools/executor';
import { discoverTools } from '../../src/tools/discovery';
import { registerHandlers, __clearHandlerRegistry } from '../../src/handlers/app-registry';
import { TEST_MODEL, TEST_USER, TEST_ADMIN, TEST_ANON, createMockEnv } from '../helpers/mock-env';
import { createMockD1 } from '../helpers/mock-d1';
import type { InjectedProps, HandlerProps, ToolDefinition } from '@exepad/types';
import type { UserContext } from '../../src/rpc/types';

// Minimal authenticated user with authMethod
const authUser: UserContext = {
  ...TEST_USER,
  authMethod: 'platform_header',
};

const anonUser: UserContext = {
  ...TEST_ANON,
  authMethod: 'platform_header',
};

const config: InjectedProps = {
  models: [TEST_MODEL],
  handlers: [],
};

function setup(dbResults?: Map<string, Record<string, unknown>[]>) {
  const db = createMockD1({
    results: dbResults,
  });
  const env = createMockEnv({ DB: db });
  const { tools } = discoverTools(config);
  return { db, env, tools };
}

describe('executeTool', () => {
  describe('unknown tool', () => {
    it('returns NOT_FOUND for unknown tool ID', async () => {
      const { env, tools } = setup();
      const result = await executeTool(
        { toolId: 'nonexistent__tool', params: {} },
        tools,
        authUser,
        config,
        env,
      );
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('CRUD tools', () => {
    it('routes create tool to sysCreate', async () => {
      const row = { id: 1, name: 'Alice', email: 'a@b.com', owner_id: 'user-123' };
      const { db, env, tools } = setup(
        new Map([['INSERT INTO', [row]]]),
      );

      const result = await executeTool(
        { toolId: 'contacts__create', params: { name: 'Alice', email: 'a@b.com' } },
        tools,
        authUser,
        config,
        env,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(row);
      // Verify SQL was executed
      const queries = db._queries;
      expect(queries.some((q) => q.sql.includes('INSERT INTO'))).toBe(true);
    });

    it('routes read tool to sysRead', async () => {
      const row = { id: 1, name: 'Alice', email: 'a@b.com', owner_id: 'user-123' };
      const { db, env, tools } = setup(
        new Map([['SELECT', [row]]]),
      );

      const result = await executeTool(
        { toolId: 'contacts__read', params: { id: 1 } },
        tools,
        authUser,
        config,
        env,
      );

      expect(result.success).toBe(true);
    });

    it('routes list tool to sysList and includes pagination', async () => {
      const { db, env, tools } = setup(
        new Map([['SELECT', []]]),
      );

      const result = await executeTool(
        { toolId: 'contacts__list', params: {} },
        tools,
        authUser,
        config,
        env,
      );

      expect(result.success).toBe(true);
      // List responses wrap data with records + pagination
      const data = result.data as { records: unknown[]; pagination: unknown };
      expect(data).toHaveProperty('records');
      expect(data).toHaveProperty('pagination');
    });

    it('routes delete tool to sysDelete', async () => {
      // sysDelete does a SELECT first (to check existence), then UPDATE (soft delete)
      const row = { id: 1, name: 'Alice', email: 'a@b.com', owner_id: 'user-123' };
      const { db, env, tools } = setup(
        new Map([['SELECT', [row]], ['UPDATE', []]]),
      );

      const result = await executeTool(
        { toolId: 'contacts__delete', params: { id: 1 } },
        tools,
        authUser,
        config,
        env,
      );

      expect(result.success).toBe(true);
    });
  });

  describe('auth enforcement', () => {
    it('rejects unauthenticated users for authenticated-level tools', async () => {
      const { env, tools } = setup();

      const result = await executeTool(
        { toolId: 'contacts__create', params: { name: 'Alice', email: 'a@b.com' } },
        tools,
        anonUser,
        config,
        env,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNAUTHORIZED');
    });

    it('respects crudPolicy auth levels', async () => {
      const restrictedConfig: InjectedProps = {
        models: [{
          ...TEST_MODEL,
          uuid: 'restricted-uuid',
          crudPolicy: { create: 'role:admin' },
        }],
      };
      const { tools: rTools } = discoverTools(restrictedConfig);
      const { env } = setup();

      // Regular user trying to use admin-only create
      const result = await executeTool(
        { toolId: 'contacts__create', params: { name: 'Alice', email: 'a@b.com' } },
        rTools,
        authUser, // not admin
        restrictedConfig,
        env,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('FORBIDDEN');
    });

    it('gates a shared-scope LIST tool against the read policy', async () => {
      // shared model, read stricter than list → a non-admin who clears the list
      // policy must still NOT list it (FK-less leak via the MCP list tool).
      const sharedCfg: InjectedProps = {
        models: [{
          ...TEST_MODEL,
          uuid: 'shared-restricted-uuid',
          ownerScope: 'shared',
          crudPolicy: { read: 'role:admin', list: 'authenticated' },
        }],
        handlers: [],
      };
      const { tools: sTools } = discoverTools(sharedCfg);
      const env = createMockEnv({ DB: createMockD1({ results: new Map([['SELECT', []]]) }) });

      const denied = await executeTool(
        { toolId: 'contacts__list', params: {} },
        sTools,
        authUser, // authenticated non-admin
        sharedCfg,
        env,
      );
      expect(denied.success).toBe(false);
      expect(denied.error?.code).toBe('FORBIDDEN');

      // admin is allowed
      const adminUser: UserContext = { ...TEST_ADMIN, authMethod: 'platform_header' };
      const ok = await executeTool(
        { toolId: 'contacts__list', params: {} },
        sTools,
        adminUser,
        sharedCfg,
        env,
      );
      expect(ok.success).toBe(true);
    });
  });

  describe('invalid tool ID format', () => {
    it('returns error for malformed tool ID', async () => {
      const { env } = setup();
      // Create a fake tool with bad ID to test parseToolId
      const fakeTools: ToolDefinition[] = [{
        id: 'bad-id-no-separator',
        name: 'bad',
        description: 'bad',
        category: 'handler',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        authLevel: 'public',
      }];

      const result = await executeTool(
        { toolId: 'bad-id-no-separator', params: {} },
        fakeTools,
        authUser,
        config,
        env,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_REQUEST');
    });
  });

  describe('update tool', () => {
    it('routes update tool to sysUpdate', async () => {
      const row = { id: 1, name: 'Bob', email: 'b@b.com', owner_id: 'user-123' };
      const { db, env, tools } = setup(
        new Map([['SELECT', [row]], ['UPDATE', [row]]]),
      );

      const result = await executeTool(
        { toolId: 'contacts__update', params: { id: 1, data: { name: 'Bob' } } },
        tools,
        authUser,
        config,
        env,
      );

      expect(result.success).toBe(true);
    });
  });

  describe('handler tools', () => {
    const testHandler: HandlerProps = {
      uuid: 'handler-uuid-1',
      name: 'getStats',
      summary: 'Get statistics',
      authLevel: 'authenticated',
      inputs: [],
      outputs: [{ name: 'count', type: 'number' }],
      method: 'getStats',
      handlerType: 'read',
    };

    const handlerConfig: InjectedProps = {
      models: [],
      handlers: [testHandler],
    };

    it('returns NOT_FOUND when handler is missing from config', async () => {
      const { env } = setup();
      const { tools } = discoverTools(handlerConfig);
      const emptyConfig: InjectedProps = { models: [], handlers: [] };

      const result = await executeTool(
        { toolId: 'handler__getStats', params: {} },
        tools,
        authUser,
        emptyConfig, // handler not in this config
        env,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });

    it('rejects unauthenticated user for authenticated handler', async () => {
      const { env } = setup();
      const { tools } = discoverTools(handlerConfig);

      const result = await executeTool(
        { toolId: 'handler__getStats', params: {} },
        tools,
        anonUser,
        handlerConfig,
        env,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNAUTHORIZED');
    });

    it('routes handler tool to executeHandler on success', async () => {
      const { env } = setup();
      const { tools } = discoverTools(handlerConfig);

      // env from setup() is APP_ID 'test-app', DEPLOY_MODE 'preview'.
      registerHandlers('test-app', 'preview', {
        getStats: async () => ({ count: 42 }),
      });

      try {
        const result = await executeTool(
          { toolId: 'handler__getStats', params: {} },
          tools,
          authUser,
          handlerConfig,
          env,
        );

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ count: 42 });
      } finally {
        __clearHandlerRegistry();
      }
    });
  });

  describe('model not found in config', () => {
    it('returns NOT_FOUND when model is missing from config', async () => {
      const { env } = setup();
      const emptyConfig: InjectedProps = { models: [] };
      const { tools } = discoverTools({ models: [TEST_MODEL] });

      const result = await executeTool(
        { toolId: 'contacts__create', params: {} },
        tools,
        authUser,
        emptyConfig,  // model not in this config
        env,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('tool ID edge cases', () => {
    it('returns INVALID_REQUEST for handler__ with empty name', async () => {
      const { env } = setup();
      const fakeTools: ToolDefinition[] = [{
        id: 'handler__',
        name: 'empty',
        description: 'empty handler name',
        category: 'handler',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        authLevel: 'public',
      }];

      const result = await executeTool(
        { toolId: 'handler__', params: {} },
        fakeTools,
        authUser,
        config,
        env,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_REQUEST');
    });

    it('correctly parses CRUD toolId with multiple underscores in model name', async () => {
      // If model is "user_settings", toolId would be "user_settings__read"
      // parseToolId uses lastIndexOf('__') so this should parse correctly
      const { env } = setup();
      const fakeTools: ToolDefinition[] = [{
        id: 'user_settings__read',
        name: 'Read user_settings',
        description: 'Read',
        category: 'crud_read',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        authLevel: 'authenticated',
      }];

      // This should parse as model=user_settings, operation=read
      // but model won't be in config, so NOT_FOUND
      const result = await executeTool(
        { toolId: 'user_settings__read', params: { id: 1 } },
        fakeTools,
        authUser,
        config,
        env,
      );

      // Tool is found, parsed correctly (NOT INVALID_REQUEST), but model not in config
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
      expect(result.error?.message).toContain('user_settings');
    });
  });
});
