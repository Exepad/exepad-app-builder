/**
 * MCP Method Handler — routes JSON-RPC methods to the Tool Layer.
 *
 * Reuses discoverTools() and executeTool() from T1a.
 * No duplication of CRUD or handler logic.
 */

import type {
  JsonRpcRequest,
  McpContext,
  McpToolCallResult,
  McpToolDefinition,
} from './types';
import type { ToolDefinition } from '@exepad/types';
import { JSON_RPC_ERRORS } from './types';
import { discoverTools } from '../tools/discovery';
import { executeTool } from '../tools/executor';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_VERSION = '1.0.0';

/**
 * Resolve MCP tools for this context, using a cached result when available.
 * Config only changes on deploy, so caching per-request avoids redundant
 * iteration of all models/columns on every tools/call.
 */
function getMcpTools(ctx: McpContext): ToolDefinition[] {
  if (!ctx._cachedMcpTools) {
    ctx._cachedMcpTools = discoverTools(ctx.config).mcpTools;
  }
  return ctx._cachedMcpTools;
}

/**
 * Dispatch a parsed JSON-RPC request to the correct MCP method.
 */
export async function handleMcpMethod(
  request: JsonRpcRequest,
  ctx: McpContext,
): Promise<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }> {
  switch (request.method) {
    case 'initialize':
      return handleInitialize(ctx);

    case 'notifications/initialized':
      return { result: {} };

    case 'tools/list':
      return handleToolsList(ctx);

    case 'tools/call':
      return handleToolsCall(request.params, ctx);

    case 'resources/list':
      return { result: { resources: [] } };

    case 'prompts/list':
      return { result: { prompts: [] } };

    case 'ping':
      return { result: {} };

    default:
      return {
        error: {
          code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
          message: `Method '${request.method}' not found`,
        },
      };
  }
}

// ── Method Implementations ──────────────────────────────────────

function handleInitialize(ctx: McpContext) {
  return {
    result: {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: {
        name: `${ctx.appAlias} (Exepad)`,
        version: SERVER_VERSION,
      },
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
      },
    },
  };
}

function handleToolsList(ctx: McpContext) {
  const mcpTools = getMcpTools(ctx);

  const tools: McpToolDefinition[] = mcpTools.map((tool) => ({
    name: tool.id,
    description: tool.description,
    inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
  }));

  return { result: { tools } };
}

async function handleToolsCall(
  params: Record<string, unknown> | undefined,
  ctx: McpContext,
): Promise<{ result?: McpToolCallResult; error?: { code: number; message: string } }> {
  if (!params?.name || typeof params.name !== 'string') {
    return {
      error: {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'Missing required parameter: name',
      },
    };
  }

  const toolName = params.name;
  const toolArguments = (params.arguments ?? {}) as Record<string, unknown>;

  const mcpTools = getMcpTools(ctx);

  const result = await executeTool(
    { toolId: toolName, params: toolArguments },
    mcpTools,
    ctx.user,
    ctx.config,
    ctx.env,
  );

  if (result.success) {
    return {
      result: {
        content: [{ type: 'text', text: JSON.stringify(result.data) }],
      },
    };
  }

  // Tool execution errors return as result with isError (MCP spec),
  // NOT as JSON-RPC error (reserved for protocol-level errors).
  return {
    result: {
      content: [
        { type: 'text', text: `Error: ${result.error?.message ?? 'Unknown error'}` },
      ],
      isError: true,
    },
  };
}
