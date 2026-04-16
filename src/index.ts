import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { logger } from './modules/shared/logger.js';
import { getDb } from './lib/db.js';
import { AuthModule } from './modules/auth/index.js';
import { MCPModule } from './modules/mcp/index.js';

async function main(): Promise<void> {
  // Initialize DB early so migrations run before any request arrives.
  getDb();

  const app = express();

  // Trust one proxy hop (Fly.io edge). Using 1 instead of `true` stops IP
  // spoofing via X-Forwarded-For.
  app.set('trust proxy', 1);

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(logger.middleware());

  // Auth (Authorization Server + Basecamp OAuth wrapper).
  const authModule = new AuthModule({ baseUri: config.baseUri });
  app.use('/', authModule.getRouter());

  // MCP (Streamable HTTP + tool handlers).
  const mcpModule = new MCPModule(
    { baseUri: config.baseUri },
    authModule.getProvider(),
  );
  app.use('/', mcpModule.getRouter());

  const splashLimiter = rateLimit({
    windowMs: 60_000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.get('/', splashLimiter, (_req, res) => {
    res.send(`<!DOCTYPE html>
<html>
  <head>
    <title>Basecamp MCP</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <main class="splash">
      <h1>Basecamp MCP</h1>
      <p>Remote MCP server for Basecamp 3.</p>
      <p>Connect from Claude / Codex / ChatGPT using this server's URL as the MCP endpoint.</p>
      <code>POST ${config.baseUri}/mcp</code>
    </main>
  </body>
</html>`);
  });

  app.listen(config.port, () => {
    logger.info('Server listening', {
      port: String(config.port),
      baseUri: config.baseUri,
      nodeEnv: config.nodeEnv,
    });
  });
}

main().catch((err) => {
  // Use logger.error before exiting so the error lands in structured logs.
  logger.error('Failed to start server', err as Error);
  process.exit(1);
});
