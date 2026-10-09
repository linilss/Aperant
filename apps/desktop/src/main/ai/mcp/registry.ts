/**
 * MCP Server Registry
 * ====================
 *
 * Defines MCP server configurations for all supported integrations.
 * See apps/desktop/src/main/ai/mcp/registry.ts for the TypeScript implementation.
 *
 * Each server config defines how to connect (stdio or StreamableHTTP),
 * and whether it's enabled by default.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { McpServerConfig, McpServerId } from './types';

// =============================================================================
// Server Configuration Definitions
// =============================================================================

/**
 * Context7 MCP server - documentation lookup.
 * Always enabled by default. Uses npx to launch.
 */
const CONTEXT7_SERVER: McpServerConfig = {
  id: 'context7',
  name: 'Context7',
  description: 'Documentation lookup for libraries and frameworks',
  enabledByDefault: true,
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp@latest'],
  },
};

/**
 * Linear MCP server - project management.
 * Conditionally enabled when project has Linear integration active.
 * Requires LINEAR_API_KEY environment variable.
 */
const LINEAR_SERVER: McpServerConfig = {
  id: 'linear',
  name: 'Linear',
  description: 'Project management integration for issues and tasks',
  enabledByDefault: false,
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@linear/mcp-server'],
  },
};

/**
 * Electron MCP server - desktop app automation.
 * Only available to QA agents. Requires ELECTRON_MCP_ENABLED=true.
 * Uses Chrome DevTools Protocol to connect to Electron apps.
 */
const ELECTRON_SERVER: McpServerConfig = {
  id: 'electron',
  name: 'Electron',
  description: 'Desktop app automation via Chrome DevTools Protocol',
  enabledByDefault: false,
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'electron-mcp-server'],
  },
};

/**
 * Puppeteer MCP server - web browser automation.
 * Only available to QA agents for non-Electron web frontends.
 */
const PUPPETEER_SERVER: McpServerConfig = {
  id: 'puppeteer',
  name: 'Puppeteer',
  description: 'Web browser automation for frontend validation',
  enabledByDefault: false,
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic-ai/puppeteer-mcp-server'],
  },
};

/**
 * Auto-Claude MCP server - custom build management tools.
 * Used by planner, coder, and QA agents for build progress tracking.
 *
 * Returns null when the server script doesn't exist (dev mode, or not yet built).
 * In that case the equivalent TypeScript tools registered directly in buildToolRegistry()
 * are used instead — the agent still has full access to all auto-claude tools.
 */
function createAutoClaudeServer(specDir: string): McpServerConfig | null {
  // In dev mode this file isn't built yet; tools are provided via build-registry.ts instead.
  const serverScript = join(__dirname, 'malvy-mcp-server.js');
  if (!existsSync(serverScript)) {
    return null;
  }
  return {
    id: 'malvy',
    name: 'malvy',
    description: 'Build management tools (progress tracking, session context)',
    enabledByDefault: true,
    transport: {
      type: 'stdio',
      command: 'node',
      args: [serverScript],
      env: { SPEC_DIR: specDir },
    },
  };
}

// =============================================================================
// Registry
// =============================================================================

/** Options for resolving MCP server configurations */
export interface McpRegistryOptions {
  /** Spec directory for auto-claude MCP server */
  specDir?: string;
  /** Linear API key (if available) */
  linearApiKey?: string;
  /** Environment variables for server processes */
  env?: Record<string, string>;
}

/**
 * Get the MCP server configuration for a given server ID.
 *
 * @param serverId - The server identifier to resolve
 * @param options - Registry options for dynamic server configuration
 * @returns Server configuration or null if not recognized
 */
export function getMcpServerConfig(
  serverId: McpServerId | string,
  options: McpRegistryOptions = {},
): McpServerConfig | null {
  switch (serverId) {
    case 'context7':
      return CONTEXT7_SERVER;

    case 'linear': {
      if (!options.linearApiKey && !options.env?.LINEAR_API_KEY) return null;
      const server = { ...LINEAR_SERVER };
      // Pass LINEAR_API_KEY to the server process
      const apiKey = options.linearApiKey ?? options.env?.LINEAR_API_KEY;
      if (apiKey && server.transport.type === 'stdio') {
        server.transport = {
          ...server.transport,
          env: { ...server.transport.env, LINEAR_API_KEY: apiKey },
        };
      }
      return server;
    }

    case 'electron':
      return ELECTRON_SERVER;

    case 'puppeteer':
      return PUPPETEER_SERVER;

    case 'malvy': {
      const specDir = options.specDir ?? '';
      return createAutoClaudeServer(specDir);
    }

    default:
      return null;
  }
}

/**
 * Resolve MCP server configurations for a list of server IDs.
 *
 * Filters out servers that cannot be configured (e.g., missing API keys).
 *
 * @param serverIds - List of server IDs to resolve
 * @param options - Registry options for dynamic server configuration
 * @returns List of resolved server configurations
 */
export function resolveMcpServers(
  serverIds: string[],
  options: McpRegistryOptions = {},
): McpServerConfig[] {
  const configs: McpServerConfig[] = [];

  for (const id of serverIds) {
    const config = getMcpServerConfig(id, options);
    if (config) {
      configs.push(config);
    }
  }

  return configs;
}
