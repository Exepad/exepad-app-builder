/**
 * Handler Mapper — generates 1 invoke tool definition per HandlerProps.
 *
 * Maps handler InputProps/OutputProps types to JSON Schema and builds
 * a typed ToolDefinition for each custom handler.
 */

import type { HandlerProps, InputProps, OutputProps } from '@exepad/types';
import type { ToolDefinition, JSONSchema } from '@exepad/types';

// ── Type Mapping ────────────────────────────────────────────────

const INPUT_TYPE_MAP: Record<InputProps['type'], string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  json: 'object',
};

const OUTPUT_TYPE_MAP: Record<OutputProps['type'], string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  json: 'object',
  array: 'array',
};

// ── Schema Builders ─────────────────────────────────────────────

function buildInputSchema(inputs: InputProps[]): JSONSchema {
  if (inputs.length === 0) {
    return { type: 'object', properties: {} };
  }

  const properties: Record<string, JSONSchema & { description?: string }> = {};
  const required: string[] = [];

  for (const inp of inputs) {
    const prop: JSONSchema & { description?: string } = {
      type: INPUT_TYPE_MAP[inp.type] || 'string',
    };
    if (inp.summary) prop.description = inp.summary;
    properties[inp.name] = prop;

    if (inp.required) {
      required.push(inp.name);
    }
  }

  return {
    type: 'object',
    properties,
    additionalProperties: false,
    ...(required.length > 0 ? { required } : {}),
  };
}

function buildOutputSchema(outputs: OutputProps[]): JSONSchema {
  if (outputs.length === 0) {
    return { type: 'object' };
  }

  const properties: Record<string, JSONSchema & { description?: string }> = {};

  for (const out of outputs) {
    const prop: JSONSchema & { description?: string } = {
      type: OUTPUT_TYPE_MAP[out.type] || 'object',
    };
    if (out.summary) prop.description = out.summary;
    if (out.type === 'array' && out.items) {
      prop.items = { type: INPUT_TYPE_MAP[out.items as InputProps['type']] || 'object' };
    }
    properties[out.name] = prop;
  }

  return { type: 'object', properties };
}

// ── Main Export ──────────────────────────────────────────────────

/**
 * Generate a single tool definition from a HandlerProps.
 *
 * Tool ID: handler__{handlerName}
 */
export function mapHandlerToTool(handler: HandlerProps): ToolDefinition {
  return {
    id: `handler__${handler.name}`,
    name: handler.name,
    description: handler.summary ?? `Execute handler: ${handler.name}`,
    category: 'handler',
    inputSchema: buildInputSchema(handler.inputs),
    outputSchema: buildOutputSchema(handler.outputs),
    authLevel: handler.authLevel,
    handlerName: handler.name,
  };
}
