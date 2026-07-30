/**
 * Tests for discovery service — discoverTools and findToolById.
 */

import { describe, it, expect } from 'vitest';
import { discoverTools, findToolById } from '../../src/tools/discovery';
import { TEST_MODEL, TEST_MODEL_SOFT_DELETE } from '../helpers/mock-env';
import type { InjectedProps, HandlerProps } from '@exepad/types';

const TEST_HANDLER: HandlerProps = {
  uuid: 'handler-uuid-1',
  name: 'getStats',
  summary: 'Dashboard statistics',
  authLevel: 'authenticated',
  inputs: [{ name: 'period', type: 'string', required: true }],
  outputs: [{ name: 'count', type: 'number' }],
  method: 'getStats',
};

const DISABLED_HANDLER: HandlerProps = {
  uuid: 'handler-uuid-2',
  name: 'internalSync',
  authLevel: 'none',
  inputs: [],
  outputs: [],
  method: 'internalSync',
};

describe('discoverTools', () => {
  it('returns empty tools for empty config', () => {
    const result = discoverTools({ models: [], handlers: [] });
    expect(result.tools).toHaveLength(0);
    expect(result.mcpTools).toHaveLength(0);
  });

  it('returns empty tools when models and handlers are undefined', () => {
    const result = discoverTools({});
    expect(result.tools).toHaveLength(0);
    expect(result.mcpTools).toHaveLength(0);
  });

  it('generates CRUD tools from models', () => {
    const result = discoverTools({ models: [TEST_MODEL] });
    expect(result.tools).toHaveLength(5);
    expect(result.tools[0].id).toBe('contacts__create');
    expect(result.tools[4].id).toBe('contacts__delete');
  });

  it('generates handler tools', () => {
    const result = discoverTools({ handlers: [TEST_HANDLER] });
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].id).toBe('handler__getStats');
  });

  it('generates tools from both models and handlers', () => {
    const result = discoverTools({
      models: [TEST_MODEL],
      handlers: [TEST_HANDLER],
    });
    expect(result.tools).toHaveLength(6); // 5 CRUD + 1 handler
  });

  it('generates tools for multiple models', () => {
    const result = discoverTools({
      models: [TEST_MODEL, TEST_MODEL_SOFT_DELETE],
    });
    expect(result.tools).toHaveLength(10); // 5 + 5
    const ids = result.tools.map((t) => t.id);
    expect(ids).toContain('contacts__create');
    expect(ids).toContain('tasks__create');
  });

  describe('mcpTools filtering', () => {
    it('excludes tools with authLevel none', () => {
      const model = {
        ...TEST_MODEL,
        uuid: 'restricted-uuid',
        name: 'restricted',
        crudPolicy: { create: 'none' as const, delete: 'none' as const },
      };
      const result = discoverTools({ models: [model] });
      // 5 total tools, 2 with 'none'
      expect(result.tools).toHaveLength(5);
      expect(result.mcpTools).toHaveLength(3);
    });

    it('excludes handler tools with authLevel none', () => {
      const result = discoverTools({
        handlers: [TEST_HANDLER, DISABLED_HANDLER],
      });
      expect(result.tools).toHaveLength(2);
      expect(result.mcpTools).toHaveLength(1);
      expect(result.mcpTools[0].id).toBe('handler__getStats');
    });

    it('includes all tools when none have authLevel none', () => {
      const result = discoverTools({
        models: [TEST_MODEL],
        handlers: [TEST_HANDLER],
      });
      expect(result.mcpTools).toHaveLength(result.tools.length);
    });
  });
});

describe('findToolById', () => {
  const { tools } = discoverTools({
    models: [TEST_MODEL],
    handlers: [TEST_HANDLER],
  });

  it('finds CRUD tool by ID', () => {
    const tool = findToolById(tools, 'contacts__create');
    expect(tool).toBeDefined();
    expect(tool!.category).toBe('crud_create');
  });

  it('finds handler tool by ID', () => {
    const tool = findToolById(tools, 'handler__getStats');
    expect(tool).toBeDefined();
    expect(tool!.category).toBe('handler');
  });

  it('returns undefined for unknown tool ID', () => {
    const tool = findToolById(tools, 'nonexistent__tool');
    expect(tool).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    const tool = findToolById(tools, '');
    expect(tool).toBeUndefined();
  });
});
