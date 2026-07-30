/**
 * Tests for handler-mapper — generates 1 invoke tool per HandlerProps.
 */

import { describe, it, expect } from 'vitest';
import { mapHandlerToTool } from '../../src/tools/handler-mapper';
import type { HandlerProps } from '@exepad/types';

const BASIC_HANDLER: HandlerProps = {
  uuid: 'handler-uuid-1',
  name: 'getStats',
  summary: 'Get dashboard statistics',
  authLevel: 'authenticated',
  inputs: [
    { name: 'period', type: 'string', required: true, summary: 'Time period (day, week, month)' },
    { name: 'includeInactive', type: 'boolean', summary: 'Include inactive records' },
  ],
  outputs: [
    { name: 'totalRevenue', type: 'number', summary: 'Total revenue in cents' },
    { name: 'orderCount', type: 'number', summary: 'Number of orders' },
    { name: 'topProducts', type: 'array', items: 'json', summary: 'Top selling products' },
  ],
  method: 'getStats',
};

const EMPTY_HANDLER: HandlerProps = {
  uuid: 'handler-uuid-2',
  name: 'healthCheck',
  authLevel: 'public',
  inputs: [],
  outputs: [],
  method: 'healthCheck',
};

describe('mapHandlerToTool', () => {
  describe('basic handler', () => {
    const tool = mapHandlerToTool(BASIC_HANDLER);

    it('generates correct tool ID', () => {
      expect(tool.id).toBe('handler__getStats');
    });

    it('uses handler name as tool name', () => {
      expect(tool.name).toBe('getStats');
    });

    it('uses handler summary as description', () => {
      expect(tool.description).toBe('Get dashboard statistics');
    });

    it('sets category to handler', () => {
      expect(tool.category).toBe('handler');
    });

    it('sets handlerName', () => {
      expect(tool.handlerName).toBe('getStats');
      expect(tool.modelName).toBeUndefined();
    });

    it('propagates authLevel', () => {
      expect(tool.authLevel).toBe('authenticated');
    });
  });

  describe('input schema', () => {
    const tool = mapHandlerToTool(BASIC_HANDLER);
    const schema = tool.inputSchema;

    it('maps input types correctly', () => {
      expect(schema.properties!.period.type).toBe('string');
      expect(schema.properties!.includeInactive.type).toBe('boolean');
    });

    it('marks required inputs', () => {
      expect(schema.required).toContain('period');
      expect(schema.required).not.toContain('includeInactive');
    });

    it('includes input summaries as descriptions', () => {
      expect(schema.properties!.period.description).toBe('Time period (day, week, month)');
    });
  });

  describe('output schema', () => {
    const tool = mapHandlerToTool(BASIC_HANDLER);
    const schema = tool.outputSchema;

    it('maps output types correctly', () => {
      expect(schema.properties!.totalRevenue.type).toBe('number');
      expect(schema.properties!.orderCount.type).toBe('number');
      expect(schema.properties!.topProducts.type).toBe('array');
    });

    it('includes items type for arrays', () => {
      expect(schema.properties!.topProducts.items).toEqual({ type: 'object' });
    });

    it('includes output summaries as descriptions', () => {
      expect(schema.properties!.totalRevenue.description).toBe('Total revenue in cents');
    });
  });

  describe('handler without inputs or outputs', () => {
    const tool = mapHandlerToTool(EMPTY_HANDLER);

    it('has empty input schema', () => {
      expect(tool.inputSchema.type).toBe('object');
      expect(Object.keys(tool.inputSchema.properties || {})).toHaveLength(0);
    });

    it('has generic output schema', () => {
      expect(tool.outputSchema.type).toBe('object');
    });

    it('uses fallback description when no summary', () => {
      expect(tool.description).toBe('Execute handler: healthCheck');
    });

    it('propagates public authLevel', () => {
      expect(tool.authLevel).toBe('public');
    });
  });

  describe('handler with json input', () => {
    const handler: HandlerProps = {
      uuid: 'handler-uuid-3',
      name: 'processData',
      authLevel: 'role:admin',
      inputs: [
        { name: 'payload', type: 'json', required: true },
      ],
      outputs: [
        { name: 'result', type: 'json' },
      ],
      method: 'processData',
    };
    const tool = mapHandlerToTool(handler);

    it('maps json type to object', () => {
      expect(tool.inputSchema.properties!.payload.type).toBe('object');
      expect(tool.outputSchema.properties!.result.type).toBe('object');
    });

    it('propagates role-based authLevel', () => {
      expect(tool.authLevel).toBe('role:admin');
    });
  });

  describe('handler with number input', () => {
    const handler: HandlerProps = {
      uuid: 'handler-uuid-4',
      name: 'calculateTax',
      authLevel: 'authenticated',
      inputs: [
        { name: 'amount', type: 'number', required: true },
      ],
      outputs: [
        { name: 'tax', type: 'number' },
      ],
      method: 'calculateTax',
    };
    const tool = mapHandlerToTool(handler);

    it('maps number type correctly', () => {
      expect(tool.inputSchema.properties!.amount.type).toBe('number');
    });
  });

  describe('handler with array output using string items', () => {
    const handler: HandlerProps = {
      uuid: 'handler-uuid-5',
      name: 'getTags',
      authLevel: 'public',
      inputs: [],
      outputs: [
        { name: 'tags', type: 'array', items: 'string' },
      ],
      method: 'getTags',
    };
    const tool = mapHandlerToTool(handler);

    it('maps string array items correctly', () => {
      expect(tool.outputSchema.properties!.tags.type).toBe('array');
      expect(tool.outputSchema.properties!.tags.items).toEqual({ type: 'string' });
    });
  });

  describe('handler with only optional inputs', () => {
    const handler: HandlerProps = {
      uuid: 'handler-uuid-6',
      name: 'searchItems',
      authLevel: 'public',
      inputs: [
        { name: 'query', type: 'string' },
        { name: 'limit', type: 'number' },
      ],
      outputs: [{ name: 'results', type: 'array', items: 'json' }],
      method: 'searchItems',
    };
    const tool = mapHandlerToTool(handler);

    it('does not include required array when all inputs are optional', () => {
      expect(tool.inputSchema.required).toBeUndefined();
    });

    it('still includes all input properties', () => {
      expect(tool.inputSchema.properties).toHaveProperty('query');
      expect(tool.inputSchema.properties).toHaveProperty('limit');
    });
  });

  describe('handler with number array output', () => {
    const handler: HandlerProps = {
      uuid: 'handler-uuid-7',
      name: 'getScores',
      authLevel: 'authenticated',
      inputs: [],
      outputs: [
        { name: 'scores', type: 'array', items: 'number' },
      ],
      method: 'getScores',
    };
    const tool = mapHandlerToTool(handler);

    it('maps number array items correctly', () => {
      expect(tool.outputSchema.properties!.scores.type).toBe('array');
      expect(tool.outputSchema.properties!.scores.items).toEqual({ type: 'number' });
    });
  });
});
