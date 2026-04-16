import { Router } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { BasecampOAuthProvider } from './provider.js';
import { handleUpstreamCallback } from './handlers/upstream-callback.js';
import {
  handleSelectAccountGet,
  handleSelectAccountPost,
} from './handlers/select-account.js';
import { logger } from '../shared/logger.js';
import { cleanupExpired } from './store/sqlite-store.js';

export interface AuthConfig {
  baseUri: string;
}

export class AuthModule {
  private provider: BasecampOAuthProvider;
  private router: Router;

  constructor(private config: AuthConfig) {
    this.provider = new BasecampOAuthProvider();
    this.router = this.setupRouter();
    this.startCleanup();
  }

  getRouter(): Router {
    return this.router;
  }

  getProvider(): BasecampOAuthProvider {
    return this.provider;
  }

  private setupRouter(): Router {
    const router = Router();

    const authLimiter = rateLimit({
      windowMs: 60_000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
    });

    // /register, /authorize, /token, /revoke, and /.well-known/* served by the SDK.
    router.use(
      mcpAuthRouter({
        provider: this.provider,
        issuerUrl: new URL(this.config.baseUri),
        resourceServerUrl: new URL('/mcp', this.config.baseUri),
        resourceName: 'Basecamp MCP',
        serviceDocumentationUrl: new URL(
          'https://github.com/CatMizu/basecamp-mcp',
        ),
        tokenOptions: {
          rateLimit: { windowMs: 5000, limit: 300 },
        },
        clientRegistrationOptions: {
          rateLimit: { windowMs: 60000, limit: 60 },
        },
      }),
    );

    // Basecamp Launchpad → us
    router.get('/oauth/basecamp/callback', authLimiter, (req, res) => {
      void handleUpstreamCallback(req, res).catch((err: Error) => {
        logger.error('Unhandled callback error', err);
        if (!res.headersSent) {
          res.status(500).send('Internal error');
        }
      });
    });

    // Picker page (multiple bc3 accounts)
    router.get('/oauth/select-account', authLimiter, handleSelectAccountGet);
    router.post(
      '/oauth/select-account',
      express.urlencoded({ extended: false }),
      authLimiter,
      handleSelectAccountPost,
    );

    return router;
  }

  private startCleanup(): void {
    // Initial sweep on boot, then every 10 minutes.
    cleanupExpired();
    setInterval(() => {
      try {
        cleanupExpired();
      } catch (err) {
        logger.warning('cleanupExpired failed', { error: (err as Error).message });
      }
    }, 10 * 60 * 1000).unref();
  }
}
