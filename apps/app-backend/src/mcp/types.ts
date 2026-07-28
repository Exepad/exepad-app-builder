/**
 * MCP (Model Context Protocol) JSON-RPC types.
 *
 * Defines the JSON-RPC 2.0 message envelope and MCP-specific content types
 * used by the Streamable HTTP transport.
 */

import type { InjectedProps, ToolDefinition } from '@exepad/types';
import type { UserContext } from '../rpc/types';
import type { Env } from '../types/env';

// ── JSON-RPC 2.0 ────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id?: string | number;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ── MCP Content Types ───────────────────────────────────────────

export interface McpTextContent {
  type: 'text';
  text: string;
}

export interface McpToolCallResult {
  content: McpTextContent[];
  isError?: boolean;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ── Handler Context ─────────────────────────────────────────────

export interface McpContext {
  appId: string;
  appAlias: string;
  config: InjectedProps;
  user: UserContext;
  env: Env;
  /** Per-request cache for discovered MCP tools (avoids re-iterating models on every call). */
  _cachedMcpTools?: ToolDefinition[];
}

// ── Standard JSON-RPC Error Codes ───────────────────────────────

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;
