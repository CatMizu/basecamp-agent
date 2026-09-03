/**
 * End-to-end test of the Authorization Server against a client shaped like
 * claude.ai's custom-connector client (the one Claude Desktop / claude.ai /
 * Claude Code's "claude.ai" proxy use):
 *
 *   POST /register  { redirect_uris:[https://claude.ai/api/mcp/auth_callback],
 *                     token_endpoint_auth_method: client_secret_post, ... }
 *   GET  /authorize ?response_type=code&code_challenge=...&state=...&resource=...
 *   GET  /oauth/basecamp/callback?code=...&state=<mcp_auth_code>   (Launchpad mocked)
 *   POST /token     grant_type=authorization_code&client_id&client_secret&code
 *                   &code_verifier&redirect_uri&resource   (form-encoded)
 *   POST /mcp       initialize + tools/list with the issued bearer
 *   POST /token     grant_type=refresh_token
 *
 * Runs the real Express wiring (same middleware order as src/index.ts) on an
 * ephemeral port. Only Launchpad is mocked.
 */
import { jest, describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';

// The MCP App resource reads the Vite-built UI bundle from disk at register
// time; it is not part of this flow, so stub it out.
jest.unstable_mockModule('../mcp/tools/resources.js', () => ({
  registerUiResources: () => {},
}));

const { createTestDb, setDbForTesting } = await import('../../lib/db.js');
const { logger } = await import('../shared/logger.js');
const { AuthModule } = await import('./index.js');
const { MCPModule } = await import('../mcp/index.js');
const { cleanupExpired } = await import('./store/sqlite-store.js');

const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const BASE = 'http://localhost:3232'; // issuer used in metadata; routes are path-only

function launchpadResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

describe('claude.ai-shaped connector client against the real AS + /mcp', () => {
  let db: BetterSqlite3Database;
  let server: Server;
  let origin: string;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    db = createTestDb();
    setDbForTesting(db);

    // Launchpad is mocked; everything aimed at our own ephemeral server passes
    // through to the real fetch.
    globalThis.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://launchpad.37signals.com/authorization/token')) {
        return launchpadResponse({
          access_token: 'bc-access',
          refresh_token: 'bc-refresh',
          expires_in: 1209600,
        });
      }
      if (url.startsWith('https://launchpad.37signals.com/authorization.json')) {
        return launchpadResponse({
          expires_at: '2099-01-01T00:00:00Z',
          identity: { id: 28211944, first_name: 'T', last_name: 'U', email_address: 't@example.com' },
          accounts: [
            {
              product: 'bc3',
              id: 6165767,
              name: 'Only',
              href: 'https://3.basecampapi.com/6165767',
              app_href: 'https://3.basecamp.com/6165767',
            },
          ],
        });
      }
      return originalFetch(input, init);
    }) as unknown as typeof fetch;

    const app = express();
    app.set('trust proxy', 1);
    app.use(cors({ origin: true, credentials: true }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(logger.middleware());
    const authModule = new AuthModule({ baseUri: BASE });
    app.use('/', authModule.getRouter());
    app.use('/', new MCPModule({ baseUri: BASE }, authModule.getProvider()).getRouter());

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    // Keep-alive sockets from fetch would otherwise hold close() open.
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    globalThis.fetch = originalFetch;
    setDbForTesting(undefined);
    db.close();
  });

  async function registerClaudeClient(): Promise<{
    client_id: string;
    client_secret: string;
    client_secret_expires_at?: number;
  }> {
    const res = await originalFetch(`${origin}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: [CLAUDE_REDIRECT],
        token_endpoint_auth_method: 'client_secret_post',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        client_name: 'Claude',
      }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      client_id: string;
      client_secret: string;
      client_secret_expires_at?: number;
    };
    expect(json.client_id).toBeTruthy();
    expect(json.client_secret).toBeTruthy();
    return json;
  }

  /** Walks authorize → Launchpad callback and returns the code claude.ai would receive. */
  async function authorizeAndCallback(
    clientId: string,
    challenge: string,
    clientState: string,
  ): Promise<string> {
    const authUrl = new URL(`${origin}/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', CLAUDE_REDIRECT);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', clientState);
    authUrl.searchParams.set('resource', `${BASE}/mcp`);
    const authRes = await originalFetch(authUrl, { redirect: 'manual' });
    expect(authRes.status).toBe(302);
    const launchpad = new URL(authRes.headers.get('location')!);
    expect(launchpad.origin).toBe('https://launchpad.37signals.com');
    const mcpAuthCode = launchpad.searchParams.get('state')!;
    expect(mcpAuthCode).toMatch(/^[0-9a-f]{64}$/);

    const cbRes = await originalFetch(
      `${origin}/oauth/basecamp/callback?code=bc-code&state=${mcpAuthCode}`,
      { redirect: 'manual' },
    );
    expect(cbRes.status).toBe(302);
    const back = new URL(cbRes.headers.get('location')!);
    expect(back.origin + back.pathname).toBe(CLAUDE_REDIRECT);
    expect(back.searchParams.get('state')).toBe(clientState);
    expect(back.searchParams.get('code')).toBe(mcpAuthCode);
    return mcpAuthCode;
  }

  async function postToken(form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await originalFetch(`${origin}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  async function mcpCall(token: string, method: string, id: number, params: unknown = {}) {
    const res = await originalFetch(`${origin}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    return { status: res.status, body: (await res.json()) as { result?: Record<string, unknown>; error?: unknown } };
  }

  test('register → authorize → callback → token → /mcp → refresh all succeed', async () => {
    const client = await registerClaudeClient();
    const { verifier, challenge } = pkcePair();
    const clientState = crypto.randomBytes(16).toString('hex');
    const code = await authorizeAndCallback(client.client_id, challenge, clientState);

    // Exactly the fields a client_secret_post client sends, including the
    // optional redirect_uri and RFC 8707 resource indicator.
    const tok = await postToken({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      client_secret: client.client_secret,
      code,
      code_verifier: verifier,
      redirect_uri: CLAUDE_REDIRECT,
      resource: `${BASE}/mcp`,
    });
    expect(tok.status).toBe(200);
    expect(tok.body.token_type).toBe('Bearer');
    expect(typeof tok.body.access_token).toBe('string');
    expect(typeof tok.body.refresh_token).toBe('string');
    expect(typeof tok.body.expires_in).toBe('number');

    const access = tok.body.access_token as string;
    const init = await mcpCall(access, 'initialize', 1, {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'claude', version: '0' },
    });
    expect(init.status).toBe(200);
    expect(init.body.result?.serverInfo).toMatchObject({ name: 'basecamp-mcp-server' });

    const list = await mcpCall(access, 'tools/list', 2);
    expect(list.status).toBe(200);
    expect((list.body.result?.tools as unknown[]).length).toBeGreaterThan(10);

    // Replaying the code must fail and must not 500.
    const replay = await postToken({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      client_secret: client.client_secret,
      code,
      code_verifier: verifier,
      redirect_uri: CLAUDE_REDIRECT,
    });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('invalid_grant');

    // Refresh rotates both tokens.
    const refreshed = await postToken({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: tok.body.refresh_token as string,
      resource: `${BASE}/mcp`,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.access_token).not.toBe(access);
    const init2 = await mcpCall(refreshed.body.access_token as string, 'initialize', 3, {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'claude', version: '0' },
    });
    expect(init2.status).toBe(200);
  });

  test('a wrong code_verifier is rejected with invalid_grant (not 500)', async () => {
    const client = await registerClaudeClient();
    const { challenge } = pkcePair();
    const code = await authorizeAndCallback(client.client_id, challenge, 'st');
    const tok = await postToken({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      client_secret: client.client_secret,
      code,
      code_verifier: 'wrong-verifier',
    });
    expect(tok.status).toBe(400);
    expect(tok.body.error).toBe('invalid_grant');
  });

  test('day 30: an old client registration no longer kills a live connector', async () => {
    const client = await registerClaudeClient();
    // RFC 7591: 0 means the client secret never expires.
    expect(client.client_secret_expires_at).toBe(0);

    const { verifier, challenge } = pkcePair();
    const code = await authorizeAndCallback(client.client_id, challenge, 'st');
    const tok = await postToken({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      client_secret: client.client_secret,
      code,
      code_verifier: verifier,
    });
    expect(tok.status).toBe(200);
    const access = tok.body.access_token as string;

    // Simulate the 30-day mark for the registered client, then run the sweep.
    db.prepare('UPDATE oauth_clients SET expires_at = ? WHERE client_id = ?').run(
      Math.floor(Date.now() / 1000) - 1,
      client.client_id,
    );
    cleanupExpired();

    const init = await mcpCall(access, 'initialize', 9, {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'claude', version: '0' },
    });
    expect(init.status).toBe(200);

    const refreshed = await postToken({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: tok.body.refresh_token as string,
    });
    expect(refreshed.status).toBe(200);
    expect(typeof refreshed.body.access_token).toBe('string');
  });

  test('every request gets one structured status log line', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await postToken({
        grant_type: 'authorization_code',
        client_id: 'no-such-client',
        code: 'x',
        code_verifier: 'y',
      });
      const line = spy.mock.calls
        .map((c) => String(c[0]))
        .find((l) => l.includes('"message":"Request completed"') && l.includes('"context.path":"/token"'));
      expect(line).toBeDefined();
      const entry = JSON.parse(line!) as Record<string, unknown>;
      expect(entry.status).toBe(400);
      expect(entry['context.method']).toBe('POST');
      expect(typeof entry.durationMs).toBe('number');
    } finally {
      spy.mockRestore();
    }
  });
});
