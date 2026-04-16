import { Router, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import {
  BearerAuthMiddlewareOptions,
  requireBearerAuth,
} from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { handleStreamableHTTP } from './handlers/shttp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MCPConfig {
  baseUri: string;
}

export class MCPModule {
  private router: Router;

  constructor(
    private config: MCPConfig,
    private tokenVerifier: OAuthTokenVerifier,
  ) {
    this.router = this.setupRouter();
  }

  getRouter(): Router {
    return this.router;
  }

  private setupRouter(): Router {
    const router = Router();

    const staticAssetLimiter = rateLimit({
      windowMs: 60_000,
      max: 500,
      standardHeaders: true,
      legacyHeaders: false,
    });

    const corsOptions = {
      origin: true,
      methods: ['GET', 'POST', 'DELETE'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Mcp-Protocol-Version',
        'Mcp-Protocol-Id',
      ],
      exposedHeaders: ['Mcp-Protocol-Version', 'Mcp-Protocol-Id'],
      credentials: true,
    };

    const securityHeaders = (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      next();
    };

    const bearerOpts: BearerAuthMiddlewareOptions = {
      verifier: this.tokenVerifier,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
        new URL('/mcp', this.config.baseUri),
      ),
    };
    const bearerAuth = requireBearerAuth(bearerOpts);

    router.get('/mcp', cors(corsOptions), bearerAuth, securityHeaders, handleStreamableHTTP);
    router.post('/mcp', cors(corsOptions), bearerAuth, securityHeaders, handleStreamableHTTP);
    router.delete(
      '/mcp',
      cors(corsOptions),
      bearerAuth,
      securityHeaders,
      handleStreamableHTTP,
    );

    router.get('/styles.css', staticAssetLimiter, (_req, res) => {
      const cssPath = path.join(__dirname, '..', '..', 'static', 'styles.css');
      res.setHeader('Content-Type', 'text/css');
      res.sendFile(cssPath);
    });

    return router;
  }
}
