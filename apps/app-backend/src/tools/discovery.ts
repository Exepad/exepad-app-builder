/**
 * Tool Discovery Service — central entry point for tool discovery.
 *
 * Takes InjectedProps and returns all available tools, plus an MCP-filtered subset.
 * Used by Per-App MCP handler (T2), Gateway (T4), and Per-App A2A (T5a).
 */

import type { InjectedProps } from '@exepad/types';
import type { ToolDefinition, ToolDiscoveryResult } from '@exepad/types';
import { mapModelToTools } from './model-mapper';
import { mapHandlerToTool } from './handler-mapper';

/**
 * Discover all tools available in the given app configuration.
 *
 * @param config - The injected app configuration
 * @returns ToolDiscoveryResult with all tools and MCP-filtered subset
 */
export function discoverTools(config: InjectedProps): ToolDiscoveryResult {
  const tools: ToolDefinition[] = [];

  // Generate CRUD tools from models
  if (config.models) {
    for (const model of config.models) {
      tools.push(...mapModelToTools(model));
    }
  }

  // Generate handler tools
  if (config.handlers) {
    for (const handler of config.handlers) {
      tools.push(mapHandlerToTool(handler));
    }
  }

  return {
    tools,
    mcpTools: tools.filter((t) => t.authLevel !== 'none'),
  };
}

/**
 * Find a specific tool by ID from a list of tools.
 */
export function findToolById(tools: ToolDefinition[], toolId: string): ToolDefinition | undefined {
  return tools.find((t) => t.id === toolId);
}
