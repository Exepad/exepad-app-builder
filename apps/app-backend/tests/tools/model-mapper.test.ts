/**
 * Tests for model-mapper — generates 5 CRUD tools per ModelProps.
 */

import { describe, it, expect } from 'vitest';
import { mapModelToTools } from '../../src/tools/model-mapper';
import { TEST_MODEL, TEST_MODEL_SOFT_DELETE, TEST_MODEL_SHARED } from '../helpers/mock-env';
import type { ModelProps } from '@exepad/types';

describe('mapModelToTools', () => {
  const tools = mapModelToTools(TEST_MODEL);

  it('generates exactly 5 tools per model', () => {
    expect(tools).toHaveLength(5);
  });

  it('uses correct tool ID format', () => {
    const ids = tools.map((t) => t.id);
    expect(ids).toEqual([
      'contacts__create',
      'contacts__read',
      'contacts__list',
      'contacts__update',
      'contacts__delete',
    ]);
  });

  it('sets correct categories', () => {
    expect(tools.map((t) => t.category)).toEqual([
      'crud_create',
      'crud_read',
      'crud_list',
      'crud_update',
      'crud_delete',
    ]);
  });

  it('sets modelName on all tools', () => {
    for (const tool of tools) {
      expect(tool.modelName).toBe('contacts');
      expect(tool.handlerName).toBeUndefined();
    }
  });

  it('defaults authLevel to authenticated when no crudPolicy', () => {
    for (const tool of tools) {
      expect(tool.authLevel).toBe('authenticated');
    }
  });

  describe('create tool input schema', () => {
    const createTool = tools[0];
    const schema = createTool.inputSchema;

    it('excludes system columns from input', () => {
      const propNames = Object.keys(schema.properties || {});
      expect(propNames).not.toContain('id');
      expect(propNames).not.toContain('owner_id');
      expect(propNames).not.toContain('created_at');
      expect(propNames).not.toContain('updated_at');
      expect(propNames).not.toContain('deleted_at');
    });

    it('includes user-defined columns', () => {
      const propNames = Object.keys(schema.properties || {});
      expect(propNames).toContain('name');
      expect(propNames).toContain('email');
      expect(propNames).toContain('phone');
      expect(propNames).toContain('age');
      expect(propNames).toContain('metadata');
    });

    it('marks non-nullable columns without defaults as required', () => {
      // name and email are non-nullable, no default
      expect(schema.required).toContain('name');
      expect(schema.required).toContain('email');
    });

    it('does not mark nullable columns as required', () => {
      // phone, age, metadata are nullable
      expect(schema.required).not.toContain('phone');
      expect(schema.required).not.toContain('age');
      expect(schema.required).not.toContain('metadata');
    });

    it('maps column types correctly', () => {
      const props = schema.properties!;
      expect(props.name.type).toBe('string');     // text → string
      expect(props.email.type).toBe('string');     // text → string
      expect(props.phone.type).toBe('string');     // text → string
      expect(props.age.type).toBe('integer');      // integer → integer
      expect(props.metadata.type).toBe('object');  // json → object
    });
  });

  describe('read/delete tool input schema', () => {
    it('read tool requires only id', () => {
      const readTool = tools[1];
      expect(readTool.inputSchema.properties).toHaveProperty('id');
      expect(readTool.inputSchema.required).toEqual(['id']);
    });

    it('delete tool requires only id', () => {
      const deleteTool = tools[4];
      expect(deleteTool.inputSchema.properties).toHaveProperty('id');
      expect(deleteTool.inputSchema.required).toEqual(['id']);
    });
  });

  describe('list tool input schema', () => {
    const listTool = tools[2];

    it('includes filter, orderBy, limit, offset, search parameters', () => {
      const propNames = Object.keys(listTool.inputSchema.properties || {});
      expect(propNames).toContain('filters');
      expect(propNames).toContain('orderBy');
      expect(propNames).toContain('limit');
      expect(propNames).toContain('offset');
      expect(propNames).toContain('search');
    });

    it('does not mark any list params as required', () => {
      expect(listTool.inputSchema.required).toBeUndefined();
    });
  });

  describe('update tool input schema', () => {
    const updateTool = tools[3];

    it('requires id and data', () => {
      expect(updateTool.inputSchema.required).toEqual(['id', 'data']);
    });

    it('data object contains writable columns', () => {
      const dataSchema = updateTool.inputSchema.properties!.data;
      const propNames = Object.keys(dataSchema.properties || {});
      expect(propNames).toContain('name');
      expect(propNames).toContain('email');
      expect(propNames).not.toContain('id');
      expect(propNames).not.toContain('owner_id');
    });
  });

  describe('output schema', () => {
    const createTool = tools[0];

    it('includes all columns including system columns', () => {
      const propNames = Object.keys(createTool.outputSchema.properties || {});
      expect(propNames).toContain('id');
      expect(propNames).toContain('owner_id');
      expect(propNames).toContain('created_at');
      expect(propNames).toContain('updated_at');
      expect(propNames).toContain('name');
      expect(propNames).toContain('email');
    });
  });

  describe('soft delete model', () => {
    const sdTools = mapModelToTools(TEST_MODEL_SOFT_DELETE);

    it('includes deleted_at in output schema', () => {
      const createTool = sdTools[0];
      expect(createTool.outputSchema.properties).toHaveProperty('deleted_at');
    });
  });

  describe('crudPolicy propagation', () => {
    const restrictedModel: ModelProps = {
      uuid: 'restricted-uuid',
      name: 'secrets',
      columns: [{ name: 'value', type: 'text' }],
      crudPolicy: {
        create: 'role:admin',
        read: 'authenticated',
        list: 'authenticated',
        update: 'role:admin',
        delete: 'none',
      },
    };
    const rTools = mapModelToTools(restrictedModel);

    it('propagates per-operation auth levels', () => {
      expect(rTools[0].authLevel).toBe('role:admin');     // create
      expect(rTools[1].authLevel).toBe('authenticated');   // read
      expect(rTools[2].authLevel).toBe('authenticated');   // list
      expect(rTools[3].authLevel).toBe('role:admin');     // update
      expect(rTools[4].authLevel).toBe('none');           // delete
    });
  });

  describe('column with references', () => {
    const refModel: ModelProps = {
      uuid: 'ref-uuid',
      name: 'orders',
      columns: [
        { name: 'customer_id', type: 'text', references: { model: 'customers', column: 'id' } },
        { name: 'amount', type: 'real' },
      ],
    };
    const rTools = mapModelToTools(refModel);

    it('includes reference info in description', () => {
      const createSchema = rTools[0].inputSchema;
      expect(createSchema.properties!.customer_id.description).toContain('References customers.id');
    });

    it('maps real type to number', () => {
      expect(rTools[0].inputSchema.properties!.amount.type).toBe('number');
    });
  });

  describe('column with summary', () => {
    const summaryModel: ModelProps = {
      uuid: 'sum-uuid',
      name: 'products',
      columns: [
        { name: 'sku', type: 'text', summary: 'Stock keeping unit' },
      ],
    };
    const sTools = mapModelToTools(summaryModel);

    it('uses column summary as description', () => {
      expect(sTools[0].inputSchema.properties!.sku.description).toBe('Stock keeping unit');
    });
  });

  describe('blob column type', () => {
    const blobModel: ModelProps = {
      uuid: 'blob-uuid',
      name: 'files',
      columns: [
        { name: 'content', type: 'blob', isNullable: true },
        { name: 'label', type: 'text' },
      ],
    };
    const bTools = mapModelToTools(blobModel);

    it('maps blob type to string', () => {
      expect(bTools[0].inputSchema.properties!.content.type).toBe('string');
    });
  });

  describe('column with both summary and references', () => {
    const comboModel: ModelProps = {
      uuid: 'combo-uuid',
      name: 'orders',
      columns: [
        {
          name: 'customer_id',
          type: 'text',
          summary: 'The customer who placed this order',
          references: { model: 'customers', column: 'id' },
        },
      ],
    };
    const cTools = mapModelToTools(comboModel);

    it('concatenates summary and references in description', () => {
      const desc = cTools[0].inputSchema.properties!.customer_id.description;
      expect(desc).toBe('The customer who placed this order. References customers.id');
    });
  });

  describe('non-soft-delete model', () => {
    const plainTools = mapModelToTools(TEST_MODEL);

    it('does NOT include deleted_at in output schema', () => {
      expect(plainTools[0].outputSchema.properties).not.toHaveProperty('deleted_at');
    });
  });

  describe('delete tool output schema', () => {
    const delTool = tools[4];

    it('has deleted, id, and soft properties', () => {
      const props = delTool.outputSchema.properties!;
      expect(props.deleted.type).toBe('boolean');
      expect(props.id.type).toBe('string');
      expect(props.soft.type).toBe('boolean');
    });
  });

  describe('list tool output schema', () => {
    const listTool = tools[2];

    it('has records array and pagination object', () => {
      const props = listTool.outputSchema.properties!;
      expect(props.records.type).toBe('array');
      expect(props.records.items).toBeDefined();
      expect(props.pagination.type).toBe('object');
      expect(props.pagination.properties).toHaveProperty('total');
      expect(props.pagination.properties).toHaveProperty('hasMore');
    });
  });

  describe('column with default value', () => {
    const defaultModel: ModelProps = {
      uuid: 'def-uuid',
      name: 'settings',
      columns: [
        { name: 'theme', type: 'text', defaultValue: 'light' },
        { name: 'required_field', type: 'text' },
      ],
    };
    const dTools = mapModelToTools(defaultModel);

    it('does not require columns with defaults', () => {
      const schema = dTools[0].inputSchema;
      expect(schema.required).toContain('required_field');
      expect(schema.required).not.toContain('theme');
    });
  });

  describe('empty model', () => {
    const emptyModel: ModelProps = {
      uuid: 'empty-uuid',
      name: 'empty',
      columns: [],
    };
    const eTools = mapModelToTools(emptyModel);

    it('still generates 5 tools', () => {
      expect(eTools).toHaveLength(5);
    });

    it('create input has empty properties', () => {
      expect(Object.keys(eTools[0].inputSchema.properties || {})).toHaveLength(0);
    });
  });

  describe('model summary in tool descriptions', () => {
    const model: ModelProps = {
      uuid: 'desc-uuid',
      name: 'widgets',
      summary: 'Physical widgets in the warehouse',
      columns: [{ name: 'label', type: 'text' }],
    };
    const dTools = mapModelToTools(model);

    it('appends model summary to tool descriptions', () => {
      expect(dTools[0].description).toContain('Physical widgets in the warehouse');
    });
  });
});
