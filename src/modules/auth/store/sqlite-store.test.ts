import { createTestDb, setDbForTesting } from '../../../lib/db.js';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  cleanupExpired,
  consumeTokenExchange,
  deletePendingAuthorization,
  getClient,
  getClientWithMeta,
  listAccountsForIdentity,
  readMcpInstallationByAccess,
  readMcpInstallationByRefresh,
  readOAuthFlow,
  readPendingAuthorization,
  revokeMcpInstallation,
  rotateMcpInstallationTokens,
  saveClient,
  saveMcpInstallation,
  saveOAuthFlow,
  savePendingAuthorization,
  saveTokenExchange,
  setOAuthFlowStatus,
  updateOAuthFlowTokens,
  upsertAccounts,
  upsertIdentity,
} from './sqlite-store.js';

describe('sqlite-store', () => {
  let db: BetterSqlite3Database;

  beforeEach(() => {
    db = createTestDb();
    setDbForTesting(db);
  });

  afterEach(() => {
    setDbForTesting(undefined);
    db.close();
  });

  const makeClient = (clientId = 'client-1'): OAuthClientInformationFull => ({
    client_id: clientId,
    client_name: 'Test Client',
    redirect_uris: ['https://example.com/cb'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });

  test('oauth_clients: round-trip', () => {
    const client = makeClient();
    saveClient(client);

    const got = getClient('client-1');
    expect(got).toEqual(client);

    const meta = getClientWithMeta('client-1');
    expect(meta?.clientId).toBe('client-1');
    expect(meta?.clientName).toBe('Test Client');
    expect(meta?.metadata).toEqual(client);
    expect(meta?.expiresAt).toBeGreaterThan(meta!.createdAt);
  });

  test('oauth_clients: upsert overwrites metadata', () => {
    saveClient(makeClient());
    saveClient({ ...makeClient(), client_name: 'Renamed' });
    expect(getClient('client-1')?.client_name).toBe('Renamed');
  });

  test('pending_authorizations: round-trip and delete', () => {
    saveClient(makeClient());
    const saved = savePendingAuthorization({
      mcpAuthCode: 'abc',
      clientId: 'client-1',
      redirectUri: 'https://example.com/cb',
      codeChallenge: 'chal',
      codeChallengeMethod: 'S256',
      clientState: 'client-state',
    });
    expect(saved.createdAt).toBeGreaterThan(0);
    expect(saved.expiresAt).toBeGreaterThan(saved.createdAt);

    const got = readPendingAuthorization('abc');
    expect(got?.codeChallenge).toBe('chal');
    expect(got?.clientState).toBe('client-state');

    deletePendingAuthorization('abc');
    expect(readPendingAuthorization('abc')).toBeUndefined();
  });

  test('identities + accounts: upsert', () => {
    upsertIdentity({
      identityId: 42,
      email: 'a@example.com',
      firstName: 'A',
      lastName: 'B',
    });
    upsertAccounts(42, [
      { accountId: 100, name: 'One', href: 'h1', appHref: 'ah1', product: 'bc3' },
      { accountId: 200, name: 'Two', href: 'h2', appHref: 'ah2', product: 'bcx' },
    ]);
    upsertAccounts(42, [
      { accountId: 100, name: 'One Renamed', href: 'h1', appHref: 'ah1', product: 'bc3' },
    ]);
    const list = listAccountsForIdentity(42);
    expect(list).toHaveLength(2);
    const one = list.find((a) => a.accountId === 100);
    expect(one?.name).toBe('One Renamed');
  });

  test('basecamp_oauth_flows: save, refresh, status', () => {
    upsertIdentity({ identityId: 42, email: 'a@b', firstName: null, lastName: null });
    saveOAuthFlow({
      flowId: 'flow-1',
      identityId: 42,
      accessToken: 'a1',
      refreshToken: 'r1',
      expiresAt: 100,
      status: 'active',
    });

    let flow = readOAuthFlow('flow-1');
    expect(flow?.accessToken).toBe('a1');

    updateOAuthFlowTokens('flow-1', {
      accessToken: 'a2',
      refreshToken: 'r2',
      expiresAt: 200,
    });
    flow = readOAuthFlow('flow-1');
    expect(flow?.accessToken).toBe('a2');
    expect(flow?.refreshToken).toBe('r2');

    setOAuthFlowStatus('flow-1', 'needs_reauth');
    flow = readOAuthFlow('flow-1');
    expect(flow?.status).toBe('needs_reauth');
  });

  test('mcp_installations: round-trip by access and refresh', () => {
    saveClient(makeClient());
    upsertIdentity({ identityId: 42, email: 'a@b', firstName: null, lastName: null });
    saveOAuthFlow({
      flowId: 'flow-1',
      identityId: 42,
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 1000,
      status: 'active',
    });
    saveMcpInstallation({
      accessToken: 'mcp-a',
      refreshToken: 'mcp-r',
      clientId: 'client-1',
      identityId: 42,
      accountId: 777,
      flowId: 'flow-1',
      expiresAt: 2000,
    });

    const byA = readMcpInstallationByAccess('mcp-a');
    expect(byA?.accountId).toBe(777);
    const byR = readMcpInstallationByRefresh('mcp-r');
    expect(byR?.accessToken).toBe('mcp-a');

    const rotated = rotateMcpInstallationTokens('mcp-a', {
      accessToken: 'mcp-a2',
      refreshToken: 'mcp-r2',
      expiresAt: 3000,
    });
    expect(rotated?.accessToken).toBe('mcp-a2');
    expect(readMcpInstallationByAccess('mcp-a')).toBeUndefined();
    expect(readMcpInstallationByAccess('mcp-a2')?.refreshToken).toBe('mcp-r2');

    revokeMcpInstallation('mcp-a2');
    expect(readMcpInstallationByAccess('mcp-a2')?.revokedAt).not.toBeNull();
  });

  test('token_exchanges: single-use enforcement', () => {
    saveClient(makeClient());
    upsertIdentity({ identityId: 42, email: 'a@b', firstName: null, lastName: null });
    saveOAuthFlow({
      flowId: 'flow-1',
      identityId: 42,
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 1000,
      status: 'active',
    });
    saveMcpInstallation({
      accessToken: 'mcp-a',
      refreshToken: 'mcp-r',
      clientId: 'client-1',
      identityId: 42,
      accountId: 777,
      flowId: 'flow-1',
      expiresAt: 2000,
    });
    saveTokenExchange('code-1', 'mcp-a');

    const first = consumeTokenExchange('code-1');
    expect(first?.firstUse).toBe(true);

    const second = consumeTokenExchange('code-1');
    expect(second?.firstUse).toBe(false);
    expect(second?.exchange.mcpAccessToken).toBe('mcp-a');
  });

  test('cleanupExpired: removes expired rows', () => {
    saveClient(makeClient());
    // Rig an expired client directly by updating timestamps.
    db.prepare(
      `UPDATE oauth_clients SET expires_at = 1 WHERE client_id = ?`,
    ).run('client-1');

    cleanupExpired();
    expect(getClient('client-1')).toBeUndefined();
  });
});
