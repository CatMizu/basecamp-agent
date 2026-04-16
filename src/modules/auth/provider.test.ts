import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { Response as ExpressResponse } from 'express';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { createTestDb, setDbForTesting } from '../../lib/db.js';
import { BasecampOAuthProvider } from './provider.js';
import { handleUpstreamCallback } from './handlers/upstream-callback.js';
import {
  readMcpInstallationByAccess,
  readPendingAuthorization,
  saveClient,
} from './store/sqlite-store.js';

function mockResponse(): { res: ExpressResponse; redirects: string[]; statuses: number[]; bodies: string[] } {
  const redirects: string[] = [];
  const statuses: number[] = [];
  const bodies: string[] = [];
  let status = 200;
  let headersSent = false;
  const res = {
    headersSent: false,
    redirect(url: string) {
      redirects.push(url);
      headersSent = true;
      this.headersSent = true;
      return this;
    },
    status(code: number) {
      status = code;
      statuses.push(code);
      return this;
    },
    send(body: string) {
      bodies.push(`${status}: ${body}`);
      headersSent = true;
      this.headersSent = true;
      return this;
    },
    setHeader() {
      return this;
    },
    json() {
      headersSent = true;
      this.headersSent = true;
      return this;
    },
  } as unknown as ExpressResponse;
  // force reference usage so the unused setters warn isn't emitted
  void headersSent;
  return { res, redirects, statuses, bodies };
}

function makeClient(clientId = 'client-1'): OAuthClientInformationFull {
  return {
    client_id: clientId,
    client_name: 'Test',
    redirect_uris: ['https://claude.ai/cb'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

describe('BasecampOAuthProvider end-to-end', () => {
  let db: BetterSqlite3Database;
  let fetchMock: jest.MockedFunction<typeof fetch>;
  const originalFetch = globalThis.fetch;
  let provider: BasecampOAuthProvider;

  beforeEach(() => {
    db = createTestDb();
    setDbForTesting(db);
    fetchMock = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
    globalThis.fetch = fetchMock;
    provider = new BasecampOAuthProvider();
  });

  afterEach(() => {
    setDbForTesting(undefined);
    db.close();
    globalThis.fetch = originalFetch;
  });

  test('single-bc3-account happy path: authorize → callback → exchange', async () => {
    const client = makeClient();
    saveClient(client);

    // 1. /authorize — provider mints mcp_auth_code and redirects to Launchpad.
    const authResp = mockResponse();
    await provider.authorize(
      client,
      {
        state: 'client-state',
        codeChallenge: 'challenge',
        redirectUri: 'https://claude.ai/cb',
        scopes: [],
      },
      authResp.res,
    );
    expect(authResp.redirects).toHaveLength(1);
    const redirect = authResp.redirects[0];
    const redirectUrl = new URL(redirect);
    expect(redirectUrl.origin).toBe('https://launchpad.37signals.com');
    const mcpAuthCode = redirectUrl.searchParams.get('state');
    expect(mcpAuthCode).toBeTruthy();

    // 2. Upstream callback — mock Launchpad token exchange + authorization.
    fetchMock.mockImplementationOnce(async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            access_token: 'bc-access',
            refresh_token: 'bc-refresh',
            expires_in: 1209600,
          }),
      }) as unknown as Response,
    );
    fetchMock.mockImplementationOnce(async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            expires_at: '2026-04-30T00:00:00Z',
            identity: {
              id: 99,
              first_name: 'Test',
              last_name: 'User',
              email_address: 'test@example.com',
            },
            accounts: [
              {
                product: 'bc3',
                id: 5555,
                name: 'Only Account',
                href: 'https://3.basecampapi.com/5555',
                app_href: 'https://3.basecamp.com/5555',
              },
            ],
          }),
      }) as unknown as Response,
    );
    const cbResp = mockResponse();
    await handleUpstreamCallback(
      {
        query: { code: 'bc-code', state: mcpAuthCode },
      } as unknown as Parameters<typeof handleUpstreamCallback>[0],
      cbResp.res,
    );
    expect(cbResp.redirects).toHaveLength(1);
    const finalRedirect = new URL(cbResp.redirects[0]);
    expect(finalRedirect.origin + finalRedirect.pathname).toBe('https://claude.ai/cb');
    expect(finalRedirect.searchParams.get('code')).toBe(mcpAuthCode);
    expect(finalRedirect.searchParams.get('state')).toBe('client-state');

    // 3. challengeForAuthorizationCode returns the original PKCE challenge.
    const challenge = await provider.challengeForAuthorizationCode(
      client,
      mcpAuthCode!,
    );
    expect(challenge).toBe('challenge');

    // 4. exchangeAuthorizationCode returns the installation's tokens and
    //    marks the code as consumed. A replay throws + revokes the install.
    const tokens1 = await provider.exchangeAuthorizationCode(client, mcpAuthCode!);
    expect(tokens1.access_token).toBeTruthy();
    expect(tokens1.refresh_token).toBeTruthy();

    // Replay — must throw (and the SDK's InvalidGrantError bubbles).
    await expect(
      provider.exchangeAuthorizationCode(client, mcpAuthCode!),
    ).rejects.toThrow();

    // Installation should be revoked after replay.
    const install = readMcpInstallationByAccess(tokens1.access_token);
    expect(install?.revokedAt).not.toBeNull();

    // Pending authorization is cleaned up after the first successful exchange.
    expect(readPendingAuthorization(mcpAuthCode!)).toBeUndefined();
  });

  test('multi-bc3-account: callback redirects to picker', async () => {
    const client = makeClient();
    saveClient(client);

    const authResp = mockResponse();
    await provider.authorize(
      client,
      {
        state: 'client-state',
        codeChallenge: 'challenge',
        redirectUri: 'https://claude.ai/cb',
        scopes: [],
      },
      authResp.res,
    );
    const mcpAuthCode = new URL(authResp.redirects[0]).searchParams.get('state')!;

    fetchMock.mockImplementationOnce(async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            access_token: 'bc-access',
            refresh_token: 'bc-refresh',
            expires_in: 1209600,
          }),
      }) as unknown as Response,
    );
    fetchMock.mockImplementationOnce(async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            expires_at: '2026-04-30T00:00:00Z',
            identity: {
              id: 99,
              first_name: 'T',
              last_name: 'U',
              email_address: 't@e',
            },
            accounts: [
              { product: 'bc3', id: 1, name: 'A', href: 'h1', app_href: 'ah1' },
              { product: 'bc3', id: 2, name: 'B', href: 'h2', app_href: 'ah2' },
              { product: 'bcx', id: 3, name: 'C', href: 'h3', app_href: 'ah3' },
            ],
          }),
      }) as unknown as Response,
    );
    const cbResp = mockResponse();
    await handleUpstreamCallback(
      { query: { code: 'bc-code', state: mcpAuthCode } } as unknown as Parameters<
        typeof handleUpstreamCallback
      >[0],
      cbResp.res,
    );
    expect(cbResp.redirects).toHaveLength(1);
    const u = new URL(cbResp.redirects[0]);
    expect(u.pathname).toBe('/oauth/select-account');
    expect(u.searchParams.get('state')).toBe(mcpAuthCode);
    expect(u.searchParams.get('flow')).toBeTruthy();
  });

  test('no-bc3-accounts: callback returns 400', async () => {
    const client = makeClient();
    saveClient(client);

    const authResp = mockResponse();
    await provider.authorize(
      client,
      {
        state: 'client-state',
        codeChallenge: 'challenge',
        redirectUri: 'https://claude.ai/cb',
        scopes: [],
      },
      authResp.res,
    );
    const mcpAuthCode = new URL(authResp.redirects[0]).searchParams.get('state')!;

    fetchMock.mockImplementationOnce(async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 1 }),
      }) as unknown as Response,
    );
    fetchMock.mockImplementationOnce(async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            expires_at: 'x',
            identity: { id: 1, first_name: '', last_name: '', email_address: 'e' },
            accounts: [
              { product: 'bcx', id: 1, name: 'A', href: 'h', app_href: 'ah' },
            ],
          }),
      }) as unknown as Response,
    );

    const cbResp = mockResponse();
    await handleUpstreamCallback(
      { query: { code: 'x', state: mcpAuthCode } } as unknown as Parameters<
        typeof handleUpstreamCallback
      >[0],
      cbResp.res,
    );
    expect(cbResp.statuses).toContain(400);
  });

  test('exchangeRefreshToken rotates access + refresh', async () => {
    const client = makeClient();
    saveClient(client);

    // Bypass the callback by directly creating an installation.
    const authResp = mockResponse();
    await provider.authorize(
      client,
      {
        state: 'client-state',
        codeChallenge: 'challenge',
        redirectUri: 'https://claude.ai/cb',
        scopes: [],
      },
      authResp.res,
    );
    const mcpAuthCode = new URL(authResp.redirects[0]).searchParams.get('state')!;

    fetchMock.mockImplementationOnce(async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({ access_token: 'bc-a', refresh_token: 'bc-r', expires_in: 3600 }),
      }) as unknown as Response,
    );
    fetchMock.mockImplementationOnce(async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            expires_at: '',
            identity: { id: 1, first_name: '', last_name: '', email_address: 'e' },
            accounts: [
              { product: 'bc3', id: 999, name: 'X', href: 'h', app_href: 'ah' },
            ],
          }),
      }) as unknown as Response,
    );
    const cbResp = mockResponse();
    await handleUpstreamCallback(
      { query: { code: 'x', state: mcpAuthCode } } as unknown as Parameters<
        typeof handleUpstreamCallback
      >[0],
      cbResp.res,
    );
    const tokens1 = await provider.exchangeAuthorizationCode(client, mcpAuthCode);
    expect(tokens1.access_token).toBeTruthy();

    const tokens2 = await provider.exchangeRefreshToken(client, tokens1.refresh_token!);
    expect(tokens2.access_token).not.toBe(tokens1.access_token);
    expect(tokens2.refresh_token).not.toBe(tokens1.refresh_token);

    // The old refresh token should no longer be valid.
    await expect(
      provider.exchangeRefreshToken(client, tokens1.refresh_token!),
    ).rejects.toThrow();
  });
});
