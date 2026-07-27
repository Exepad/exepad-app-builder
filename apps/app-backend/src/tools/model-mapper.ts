/**
 * Model Mapper — generates 5 CRUD tool definitions per ModelProps.
 *
 * Maps D1 column types to JSON Schema and builds typed input/output schemas
 * for create, read, list, update, and delete operations.
 */

import type { ModelProps, ColumnProps, ColumnType, AccessLevel } from '@exepad/types';
import type { ToolDefinition, JSONSchema } from '@exepad/types';
import { SYSTEM_COLUMNS } from '../utils/constants';

// ── Column Type → JSON Schema ───────────────────────────────────

const COLUMN_TYPE_MAP: Record<ColumnType, string> = {
  text: 'string',
  integer: 'integer',
  real: 'number',
  blob: 'string',
  json: 'object',
};

function columnToJsonSchema(col: ColumnProps): JSONSchema & { description?: string } {
  const schema: JSONSchema & { description?: string } = {
    type: COLUMN_TYPE_MAP[col.type] || 'string',
  };

  // Build description from summary and/or reference info
  const parts: string[] = [];
  if (col.summary) parts.push(col.summary);
  if (col.references) {
    parts.push(`References ${col.references.model}.${col.references.column}`);
  }
  if (parts.length > 0) {
    schema.description = parts.join('. ');
  }

  return schema;
}

// ── Schema Builders ─────────────────────────────────────────────

/** System column names to exclude from user-writable inputs */
const SYSTEM_COLUMN_SET = new Set<string>(SYSTEM_COLUMNS);

function isUserColumn(col: ColumnProps): boolean {
  return !SYSTEM_COLUMN_SET.has(col.name) && !col.isPrimary;
}

function isRequired(col: ColumnProps): boolean {
  return !col.isNullable && col.defaultValue === undefined;
}

/**
 * Build create input schema: all non-system columns.
 * Non-nullable columns without defaults are required.
 */
function buildCreateInputSchema(model: ModelProps): JSONSchema {
  const properties: Record<string, JSONSchema & { description?: string }> = {};
  const required: string[] = [];

  for (const col of model.columns) {
    if (!isUserColumn(col)) continue;
    properties[col.name] = columnToJsonSchema(col);
    if (isRequired(col)) {
      required.push(col.name);
    }
  }

  return {
    type: 'object',
    properties,
    additionalProperties: false,
    ...(required.length > 0 ? { required } : {}),
  };
}

/**
 * Build read/delete input schema: just the ID parameter.
 */
function buildIdInputSchema(): JSONSchema {
  return {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Record ID' },
    },
    required: ['id'],
    additionalProperties: false,
  };
}

/**
 * Build list input schema: filters, orderBy, limit, offset, search.
 * Matches the ListParams interface from rpc/types.ts.
 */
function buildListInputSchema(model: ModelProps): JSONSchema {
  return {
    type: 'object',
    properties: {
      filters: {
        type: 'object',
        description: 'Filter conditions keyed by column name',
      },
      orderBy: {
        type: 'object',
        description: 'Sort order keyed by column name, values are "asc" or "desc"',
      },
      limit: {
        type: 'integer',
        description: 'Page size (default: 50, max: 500)',
      },
      offset: {
        type: 'integer',
        description: 'Page offset for pagination',
      },
      search: {
        type: 'string',
        description: 'Full-text search term across text columns',
      },
    },
    additionalProperties: false,
  };
}

/**
 * Build update input schema: id + data object with writable columns.
 */
function buildUpdateInputSchema(model: ModelProps): JSONSchema {
  const dataProperties: Record<string, JSONSchema & { description?: string }> = {};

  for (const col of model.columns) {
    if (!isUserColumn(col)) continue;
    dataProperties[col.name] = columnToJsonSchema(col);
  }

  return {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Record ID' },
      data: {
        type: 'object',
        properties: dataProperties,
        additionalProperties: false,
        description: 'Fields to update',
      },
    },
    required: ['id', 'data'],
    additionalProperties: false,
  };
}

/**
 * Build output schema: all columns including system columns.
 */
function buildRecordOutputSchema(model: ModelProps): JSONSchema {
  const properties: Record<string, JSONSchema & { description?: string }> = {
    id: { type: 'string', description: 'Record ID' },
    owner_id: { type: 'string', description: 'Owner user ID' },
    created_at: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
    updated_at: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
  };

  if (model.softDelete) {
    properties.deleted_at = { type: 'string', description: 'Deletion timestamp (ISO 8601), null if not deleted' };
  }

  for (const col of model.columns) {
    if (col.isPrimary) continue; // Already have 'id' above
    properties[col.name] = columnToJsonSchema(col);
  }

  return { type: 'object', properties };
}

/**
 * Build list output schema: array of records + pagination.
 */
function buildListOutputSchema(model: ModelProps): JSONSchema {
  return {
    type: 'object',
    properties: {
      records: {
        type: 'array',
        items: buildRecordOutputSchema(model),
      },
      pagination: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          offset: { type: 'integer' },
          limit: { type: 'integer' },
          hasMore: { type: 'boolean' },
        },
      },
    },
  };
}

// ── Main Export ──────────────────────────────────────────────────

/**
 * Generate 5 CRUD tool definitions for a single model.
 *
 * Tools: {model}__create, {model}__read, {model}__list, {model}__update, {model}__delete
 */
export function mapModelToTools(model: ModelProps): ToolDefinition[] {
  const policy = model.crudPolicy ?? {};
  const defaultAuth: AccessLevel = 'authenticated';
  const desc = model.summary ? ` ${model.summary}` : '';

  return [
    {
      id: `${model.name}__create`,
      name: `Create ${model.name}`,
      description: `Create a new ${model.name} record.${desc}`,
      category: 'crud_create',
      inputSchema: buildCreateInputSchema(model),
      outputSchema: buildRecordOutputSchema(model),
      authLevel: policy.create ?? defaultAuth,
      modelName: model.name,
    },
    {
      id: `${model.name}__read`,
      name: `Get ${model.name}`,
      description: `Get a single ${model.name} record by ID.${desc}`,
      category: 'crud_read',
      inputSchema: buildIdInputSchema(),
      outputSchema: buildRecordOutputSchema(model),
      authLevel: policy.read ?? defaultAuth,
      modelName: model.name,
    },
    {
      id: `${model.name}__list`,
      name: `List ${model.name}`,
      description: `List ${model.name} records with filtering, sorting, and pagination.${desc}`,
      category: 'crud_list',
      inputSchema: buildListInputSchema(model),
      outputSchema: buildListOutputSchema(model),
      authLevel: policy.list ?? defaultAuth,
      modelName: model.name,
    },
    {
      id: `${model.name}__update`,
      name: `Update ${model.name}`,
      description: `Update an existing ${model.name} record.${desc}`,
      category: 'crud_update',
      inputSchema: buildUpdateInputSchema(model),
      outputSchema: buildRecordOutputSchema(model),
      authLevel: policy.update ?? defaultAuth,
      modelName: model.name,
    },
    {
      id: `${model.name}__delete`,
      name: `Delete ${model.name}`,
      description: `Delete a ${model.name} record.${desc}`,
      category: 'crud_delete',
      inputSchema: buildIdInputSchema(),
      outputSchema: {
        type: 'object',
        properties: {
          deleted: { type: 'boolean' },
          id: { type: 'string' },
          soft: { type: 'boolean' },
        },
      },
      authLevel: policy.delete ?? defaultAuth,
      modelName: model.name,
    },
  ];
}
