/**
 * JSON Schema validation utilities
 */

import Ajv, { ErrorObject } from 'ajv';

/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

/**
 * Validation error interface
 */
export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
  params?: Record<string, unknown>;
}

/**
 * Convert Ajv errors to ValidationError format
 */
function formatErrors(errors: ErrorObject[] | null | undefined): ValidationError[] {
  if (!errors) return [];

  return errors.map((error) => ({
    path: error.instancePath || '/',
    message: error.message || 'Validation error',
    keyword: error.keyword,
    params: error.params,
  }));
}

/**
 * Create a validator function for a given JSON schema
 */
export function createValidator(schema: object) {
  const ajv = new Ajv({
    allErrors: true,
    verbose: true,
    strict: false,
  });

  const validate = ajv.compile(schema);

  return function validateData(data: unknown): ValidationResult {
    const valid = validate(data);

    if (valid) {
      return { valid: true };
    }

    return {
      valid: false,
      errors: formatErrors(validate.errors),
    };
  };
}

// ── Identifier pattern (matches VALID_IDENTIFIER_PATTERN from @exepad/types) ──

const identifierPattern = '^[a-zA-Z_][a-zA-Z0-9_]*$';

// ── Backend Sub-Schemas ────────────────────────────────────────────────────────

const foreignKeyRefSchema = {
  type: 'object',
  required: ['model', 'column'],
  additionalProperties: false,
  properties: {
    model: { type: 'string', pattern: identifierPattern },
    column: { type: 'string', pattern: identifierPattern },
    onDelete: { type: 'string', enum: ['cascade', 'set_null', 'restrict', 'no_action'] },
  },
};

const columnConfigSchema = {
  type: 'object',
  required: ['name', 'type'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', pattern: identifierPattern },
    type: { type: 'string', enum: ['text', 'integer', 'real', 'blob', 'json'] },
    summary: { type: 'string' },
    isPrimary: { type: 'boolean' },
    isUnique: { type: 'boolean' },
    isNullable: { type: 'boolean' },
    defaultValue: {},
    references: foreignKeyRefSchema,
    enumValues: { type: 'array', items: { type: 'string' } },
  },
};

const indexConfigSchema = {
  type: 'object',
  required: ['name', 'columns'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', pattern: identifierPattern },
    columns: { type: 'array', items: { type: 'string', pattern: identifierPattern }, minItems: 1 },
    unique: { type: 'boolean' },
  },
};

// Mirrors the AccessLevel type in @exepad/types (backend.ts): the fixed set of
// literals plus the `role:${string}` template, and the legacy 'admin' shorthand
// that the app-backend still honors (rpc/router.ts).
const authLevelSchema = {
  anyOf: [
    { type: 'string', enum: ['public', 'authenticated', 'owner', 'none', 'admin'] },
    { type: 'string', pattern: '^role:[A-Za-z0-9_-]+$' },
  ],
};

const crudPolicySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    create: authLevelSchema,
    read: authLevelSchema,
    update: authLevelSchema,
    delete: authLevelSchema,
    list: authLevelSchema,
  },
};

const modelConfigSchema = {
  type: 'object',
  required: ['uuid', 'name', 'columns'],
  additionalProperties: false,
  properties: {
    uuid: { type: 'string', minLength: 1 },
    name: { type: 'string', pattern: identifierPattern },
    summary: { type: 'string' },
    columns: { type: 'array', items: columnConfigSchema, minItems: 1 },
    indexes: { type: 'array', items: indexConfigSchema },
    crudPolicy: crudPolicySchema,
    migrationPolicy: { type: 'string', enum: ['safe', 'destructive', 'reset'] },
    softDelete: { type: 'boolean' },
    ownerScope: { type: 'string', enum: ['user', 'shared'] },
    autoExpandFKs: { type: 'boolean' },
    expandSelect: { type: 'array', items: { type: 'string' } },
  },
};

const inputConfigSchema = {
  type: 'object',
  required: ['name', 'type'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    type: { type: 'string', enum: ['string', 'number', 'boolean', 'json'] },
    required: { type: 'boolean' },
    summary: { type: 'string' },
  },
};

const outputConfigSchema = {
  type: 'object',
  required: ['name', 'type'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    type: { type: 'string', enum: ['string', 'number', 'boolean', 'json', 'array'] },
    items: { type: 'string' },
    summary: { type: 'string' },
  },
};

const handlerConfigSchema = {
  type: 'object',
  required: ['uuid', 'name', 'authLevel', 'inputs', 'outputs', 'method'],
  additionalProperties: false,
  properties: {
    uuid: { type: 'string', minLength: 1 },
    name: { type: 'string', pattern: identifierPattern },
    summary: { type: 'string' },
    authLevel: authLevelSchema,
    inputs: { type: 'array', items: inputConfigSchema },
    outputs: { type: 'array', items: outputConfigSchema },
    allowedSources: { type: 'array', items: { type: 'string' } },
    method: { type: 'string', minLength: 1 },
    handlerType: { type: 'string', enum: ['read', 'write'] },
  },
};

/**
 * JSON Schema for StaticBackend (mode: "static").
 */
const staticBackendSchema = {
  type: 'object',
  required: ['mode'],
  additionalProperties: false,
  properties: {
    mode: { type: 'string', const: 'static' },
    data: {
      type: 'object',
      required: ['datasets'],
      additionalProperties: false,
      properties: {
        datasets: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            required: ['type'],
            properties: {
              type: { type: 'string', const: 'static' },
              records: { type: 'array' },
              schema: { type: 'object' },
              generated: { type: 'boolean' },
              generationHint: { type: 'string' },
              _meta: { type: 'object' },
            },
          },
        },
      },
    },
  },
};

/**
 * JSON Schema for DynamicBackend (mode: "dynamic", models + handlers).
 */
const dynamicBackendSchema = {
  type: 'object',
  required: ['mode'],
  additionalProperties: false,
  properties: {
    mode: { type: 'string', const: 'dynamic' },
    models: { type: 'array', items: modelConfigSchema },
    handlers: { type: 'array', items: handlerConfigSchema },
  },
};

const noneBackendSchema = {
  type: 'object',
  required: ['mode'],
  properties: {
    mode: { type: 'string', const: 'none' },
  },
  additionalProperties: false,
};

/**
 * JSON Schema for BackendProps — discriminated union on `mode`.
 * Exported so consumers can validate backend config independently.
 */
export const backendPropsSchema = {
  oneOf: [staticBackendSchema, dynamicBackendSchema, noneBackendSchema],
};

// ── WebApp Root Schema ─────────────────────────────────────────────────────────

const webAppSchema = {
  type: 'object',
  required: ['uuid', 'alias', 'version', 'name', 'summary', 'shortSummary', 'lastUpdatedEpoch'],
  properties: {
    uuid: { type: 'string' },
    alias: { type: 'string' },
    version: { type: 'string' },
    name: { type: 'string' },
    summary: { type: 'string' },
    shortSummary: { type: 'string' },
    lastUpdatedEpoch: { type: 'number' },
    repo: { type: 'object' },
    frontend: {
      type: 'object',
      properties: {
        layout: { type: 'string', enum: ['boxed', 'wide', 'narrow', 'full-width'] },
        menuPosition: { type: 'string', enum: ['HeaderMenuTop', 'SidebarMenuLeft'] },
        theme: { type: 'object' },
        languages: { type: 'array' },
        pages: { type: 'array' },
        header: { type: 'array' },
        sidebar: { type: 'array' },
        footer: { type: 'array' },
        logic: { type: 'object' },
      },
    },
    backend: backendPropsSchema,
    security: { type: 'object' },
    secrets: { type: 'array' },
  },
};

/**
 * Validate a WebApp configuration object
 */
export const validateWebApp = createValidator(webAppSchema);

/**
 * Validate a standalone backend configuration object
 */
export const validateBackendProps = createValidator(backendPropsSchema);
