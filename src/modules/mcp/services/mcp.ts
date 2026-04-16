import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Scaffold factory. Tools are registered in later commits via
 * registerQueryTools / registerActionTools.
 */
export interface McpServerWrapper {
  server: McpServer;
  cleanup: () => void;
}

export function createMcpServer(): McpServerWrapper {
  const server = new McpServer({
    name: 'basecamp-mcp',
    version: '0.1.0',
  });

  // Tools registered in src/modules/mcp/tools/{query,action}-tools.ts — wired
  // up in Commit 4.
  return { server, cleanup: () => {} };
}
