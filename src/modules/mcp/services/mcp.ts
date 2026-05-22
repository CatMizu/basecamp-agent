import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerQueryTools } from '../tools/query-tools.js';
import { registerActionTools } from '../tools/action-tools.js';
import { registerUiResources } from '../tools/resources.js';
import { registerVaultTools } from '../tools/vault-tools.js';
import { registerTicketTools } from '../tools/ticket-tools.js';
import { SERVER_INSTRUCTIONS } from './server-instructions.js';

export interface McpServerWrapper {
  server: McpServer;
  cleanup: () => void;
}

export function createMcpServer(): McpServerWrapper {
  const server = new McpServer(
    { name: 'basecamp-mcp-server', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerQueryTools(server);
  registerActionTools(server);
  registerVaultTools(server);
  registerTicketTools(server);
  registerUiResources(server);

  return { server, cleanup: () => {} };
}
