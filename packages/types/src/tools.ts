/**
 * Tool Layer Type Definitions
 *
 * Typed, callable tool definitions generated from ModelProps and HandlerProps.
 * Used by MCP protocol handler, A2A agent, and Gateway for tool discovery/execution.
 */

import type { AccessLevel } from './backend';

// ── JSON Schema (subset used by tool definitions) ───────────────

/** Standard JSON Schema object used for tool input/output definitions */
export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema & { description?: string; enum?: unknown[] }>;
  required?: string[];
  description?: string;
  items?: JSONSchema;
}

// ── Tool Definition ─────────────────────────────────────────────

/** Categorizes what a tool does */
export type ToolCategory =
  | 'crud_create'
  | 'crud_read'
  | 'crud_list'
  | 'crud_update'
  | 'crud_delete'
  | 'handler';

/**
 * A typed, callable tool definition generated from a model or handler.
 * Each ToolDefinition maps 1:1 to an executable operation.
 */
export interface ToolDefinition {
  /** Unique tool identifier: "{model}__create" or "handler__{handlerName}" */
  id: string;
  /** Human-readable display name: "Create Contact" or "Get Statistics" */
  name: string;
  /** What this tool does */
  description: string;
  /** Tool category for filtering/grouping */
  category: ToolCategory;
  /** Input parameters as JSON Schema */
  inputSchema: JSONSchema;
  /** Output shape as JSON Schema */
  outputSchema: JSONSchema;
  /** Access level required to invoke this tool */
  authLevel: AccessLevel;
  /** Source model name (for CRUD tools) */
  modelName?: string;
  /** Source handler name (for handler tools) */
  handlerName?: string;
}

// ── Execution Types ─────────────────────────────────────────────

/** Request to execute a tool by ID */
export interface ToolExecutionRequest {
  /** The tool ID to execute (e.g., "contacts__create") */
  toolId: string;
  /** Parameters to pass to the tool */
  params: Record<string, unknown>;
}

/** Result of a tool execution */
export interface ToolExecutionResult {
  /** Whether the execution succeeded */
  success: boolean;
  /** Result data (on success) */
  data?: unknown;
  /** Error information (on failure) */
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ── Discovery Types ─────────────────────────────────────────────

/** Discovery result containing all available tools for an app */
export interface ToolDiscoveryResult {
  /** All available tools */
  tools: ToolDefinition[];
  /** Tools safe for MCP exposure (excludes authLevel: 'none') */
  mcpTools: ToolDefinition[];
}
