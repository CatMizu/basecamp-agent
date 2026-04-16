import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Request, Response } from 'express';
import { createMcpServer } from '../services/mcp.js';
import { logger } from '../../shared/logger.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: import('@modelcontextprotocol/sdk/server/auth/types.js').AuthInfo;
  }
}

/**
 * Stateless MCP handler. Each HTTP request gets its own transport + McpServer
 * pair — no session tracking, no shared transport state between requests.
 */
export async function handleStreamableHTTP(req: Request, res: Response): Promise<void> {
  const userId = (req.auth?.extra?.userId as string | undefined) ?? null;

  if (!userId) {
    logger.warning('MCP request without user ID', { hasAuth: !!req.auth });
    res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32002, message: 'User ID required' },
    });
    return;
  }

  const { server } = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no Mcp-Session-Id
    enableJsonResponse: true,
  });

  res.on('close', () => {
    void transport.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error('Error handling MCP request', error as Error, {
      method: req.method,
      userId,
    });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: 'Internal error' },
      });
    }
  }
}
