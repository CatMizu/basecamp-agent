import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerQueryTools } from '../tools/query-tools.js';
import { registerActionTools } from '../tools/action-tools.js';

export interface McpServerWrapper {
  server: McpServer;
  cleanup: () => void;
}

export function createMcpServer(): McpServerWrapper {
  const server = new McpServer({
    name: 'basecamp-mcp',
    version: '0.1.0',
  });

  registerQueryTools(server);
  registerActionTools(server);

  return { server, cleanup: () => {} };
}
