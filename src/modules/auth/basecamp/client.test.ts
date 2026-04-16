import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb, setDbForTesting } from '../../../lib/db.js';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import {
  getBasecampAccessToken,
} from './client.js';
import {
  readOAuthFlow,
  saveOAuthFlow,
  upsertIdentity,
} from '../store/sqlite-store.js';
import { McpReauthError } from '../types.js';

type FetchMock = jest.MockedFunction<typeof fetch>;
const originalFetch = globalThis.fetch;

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('getBasecampAccessToken', () => {
  let db: BetterSqlite3Database;
  let fetchMock: FetchMock;

  beforeEach(() => {
    db = createTestDb();
    setDbForTesting(db);
    upsertIdentity({ identityId: 1, email: 'a@b', firstName: null, lastName: null });
    fetchMock = jest.fn() as unknown as FetchMock;
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    setDbForTesting(undefined);
    db.close();
    globalThis.fetch = originalFetch;
  });

  test('returns cached token when not near expiry', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    saveOAuthFlow({
      flowId: 'flow-1',
      identityId: 1,
      accessToken: 'cached-access',
      refreshToken: 'r',
      expiresAt: nowSec + 3600,
      status: 'active',
    });
    const token = await getBasecampAccessToken('flow-1');
    expect(token).toBe('cached-access');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('refreshes when expired, updates flow', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    saveOAuthFlow({
      flowId: 'flow-1',
      identityId: 1,
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: nowSec - 10,
      status: 'active',
    });
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 1209600,
      }),
    );
    const token = await getBasecampAccessToken('flow-1');
    expect(token).toBe('new-access');

    const updated = readOAuthFlow('flow-1');
    expect(updated?.accessToken).toBe('new-access');
    expect(updated?.refreshToken).toBe('new-refresh');
  });

  test('concurrent callers share a single refresh', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    saveOAuthFlow({
      flowId: 'flow-1',
      identityId: 1,
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: nowSec - 10,
      status: 'active',
    });
    // Delayed resolution so the second caller arrives before the first resolves.
    let resolveFetch: (v: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((res) => {
        resolveFetch = res;
      }),
    );
    const p1 = getBasecampAccessToken('flow-1');
    const p2 = getBasecampAccessToken('flow-1');
    resolveFetch(
      mockJsonResponse({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 1209600,
      }),
    );
    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1).toBe('new-access');
    expect(t2).toBe('new-access');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('failed refresh marks flow needs_reauth and throws McpReauthError', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    saveOAuthFlow({
      flowId: 'flow-1',
      identityId: 1,
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: nowSec - 10,
      status: 'active',
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => '{"error":"invalid_grant"}',
    } as unknown as Response);

    await expect(getBasecampAccessToken('flow-1')).rejects.toBeInstanceOf(McpReauthError);
    const flow = readOAuthFlow('flow-1');
    expect(flow?.status).toBe('needs_reauth');
  });

  test('throws when flow is not active', async () => {
    saveOAuthFlow({
      flowId: 'flow-1',
      identityId: 1,
      accessToken: 'x',
      refreshToken: 'y',
      expiresAt: 9_999_999_999,
      status: 'revoked',
    });
    await expect(getBasecampAccessToken('flow-1')).rejects.toBeInstanceOf(McpReauthError);
  });

  test('throws when flow is missing', async () => {
    await expect(getBasecampAccessToken('no-such')).rejects.toBeInstanceOf(McpReauthError);
  });
});
