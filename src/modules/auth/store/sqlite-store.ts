import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { getDb } from '../../../lib/db.js';
import type {
  BasecampAccountRecord,
  BasecampFlowStatus,
  BasecampIdentityRecord,
  BasecampOAuthFlow,
  McpInstallation,
  PendingAuthorization,
  RegisteredOAuthClient,
  TokenExchange,
} from '../types.js';

const CLIENT_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const PENDING_AUTH_TTL_SEC = 10 * 60;
const TOKEN_EXCHANGE_TTL_SEC = 10 * 60;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

// ─── OAuth clients ──────────────────────────────────────────────────────

export function saveClient(
  client: OAuthClientInformationFull,
  db: BetterSqlite3Database = getDb(),
): void {
  const t = now();
  db.prepare(
    `INSERT INTO oauth_clients (client_id, client_name, client_metadata, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(client_id) DO UPDATE SET
       client_name = excluded.client_name,
       client_metadata = excluded.client_metadata,
       expires_at = excluded.expires_at`,
  ).run(
    client.client_id,
    client.client_name ?? null,
    JSON.stringify(client),
    t,
    t + CLIENT_TTL_SEC,
  );
}

export function getClient(
  clientId: string,
  db: BetterSqlite3Database = getDb(),
): OAuthClientInformationFull | undefined {
  const row = db
    .prepare(
      `SELECT client_metadata, expires_at FROM oauth_clients WHERE client_id = ?`,
    )
    .get(clientId) as { client_metadata: string; expires_at: number } | undefined;

  if (!row) return undefined;
  if (row.expires_at < now()) {
    db.prepare(`DELETE FROM oauth_clients WHERE client_id = ?`).run(clientId);
    return undefined;
  }

  return JSON.parse(row.client_metadata) as OAuthClientInformationFull;
}

export function getClientWithMeta(
  clientId: string,
  db: BetterSqlite3Database = getDb(),
): RegisteredOAuthClient | undefined {
  const row = db
    .prepare(
      `SELECT client_id, client_name, client_metadata, created_at, expires_at
         FROM oauth_clients WHERE client_id = ?`,
    )
    .get(clientId) as
    | {
        client_id: string;
        client_name: string | null;
        client_metadata: string;
        created_at: number;
        expires_at: number;
      }
    | undefined;

  if (!row) return undefined;
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    metadata: JSON.parse(row.client_metadata) as OAuthClientInformationFull,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

// ─── Pending authorizations ─────────────────────────────────────────────

export function savePendingAuthorization(
  pending: Omit<PendingAuthorization, 'createdAt' | 'expiresAt'>,
  db: BetterSqlite3Database = getDb(),
): PendingAuthorization {
  const t = now();
  const full: PendingAuthorization = {
    ...pending,
    createdAt: t,
    expiresAt: t + PENDING_AUTH_TTL_SEC,
  };
  db.prepare(
    `INSERT INTO pending_authorizations
       (mcp_auth_code, client_id, redirect_uri, code_challenge, code_challenge_method, client_state, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    full.mcpAuthCode,
    full.clientId,
    full.redirectUri,
    full.codeChallenge,
    full.codeChallengeMethod,
    full.clientState,
    full.createdAt,
    full.expiresAt,
  );
  return full;
}

export function readPendingAuthorization(
  mcpAuthCode: string,
  db: BetterSqlite3Database = getDb(),
): PendingAuthorization | undefined {
  const row = db
    .prepare(
      `SELECT mcp_auth_code, client_id, redirect_uri, code_challenge, code_challenge_method, client_state, created_at, expires_at
         FROM pending_authorizations WHERE mcp_auth_code = ?`,
    )
    .get(mcpAuthCode) as
    | {
        mcp_auth_code: string;
        client_id: string;
        redirect_uri: string;
        code_challenge: string;
        code_challenge_method: string;
        client_state: string | null;
        created_at: number;
        expires_at: number;
      }
    | undefined;

  if (!row) return undefined;
  if (row.expires_at < now()) {
    db.prepare(`DELETE FROM pending_authorizations WHERE mcp_auth_code = ?`).run(
      mcpAuthCode,
    );
    return undefined;
  }
  return {
    mcpAuthCode: row.mcp_auth_code,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    clientState: row.client_state,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function deletePendingAuthorization(
  mcpAuthCode: string,
  db: BetterSqlite3Database = getDb(),
): void {
  db.prepare(`DELETE FROM pending_authorizations WHERE mcp_auth_code = ?`).run(
    mcpAuthCode,
  );
}

// ─── Identities + accounts ──────────────────────────────────────────────

export function upsertIdentity(
  id: Omit<BasecampIdentityRecord, 'createdAt' | 'updatedAt'>,
  db: BetterSqlite3Database = getDb(),
): BasecampIdentityRecord {
  const t = now();
  db.prepare(
    `INSERT INTO basecamp_identities (identity_id, email, first_name, last_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(identity_id) DO UPDATE SET
       email = excluded.email,
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       updated_at = excluded.updated_at`,
  ).run(id.identityId, id.email, id.firstName, id.lastName, t, t);
  return { ...id, createdAt: t, updatedAt: t };
}

export function upsertAccounts(
  identityId: number,
  accounts: Array<Omit<BasecampAccountRecord, 'identityId' | 'cachedAt'>>,
  db: BetterSqlite3Database = getDb(),
): void {
  const t = now();
  const stmt = db.prepare(
    `INSERT INTO basecamp_accounts (identity_id, account_id, name, href, app_href, product, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(identity_id, account_id) DO UPDATE SET
       name = excluded.name,
       href = excluded.href,
       app_href = excluded.app_href,
       product = excluded.product,
       cached_at = excluded.cached_at`,
  );
  const tx = db.transaction(() => {
    for (const a of accounts) {
      stmt.run(identityId, a.accountId, a.name, a.href, a.appHref, a.product, t);
    }
  });
  tx();
}

export function listAccountsForIdentity(
  identityId: number,
  db: BetterSqlite3Database = getDb(),
): BasecampAccountRecord[] {
  const rows = db
    .prepare(
      `SELECT identity_id, account_id, name, href, app_href, product, cached_at
         FROM basecamp_accounts WHERE identity_id = ? ORDER BY name ASC`,
    )
    .all(identityId) as Array<{
    identity_id: number;
    account_id: number;
    name: string;
    href: string;
    app_href: string | null;
    product: string;
    cached_at: number;
  }>;
  return rows.map((r) => ({
    identityId: r.identity_id,
    accountId: r.account_id,
    name: r.name,
    href: r.href,
    appHref: r.app_href,
    product: r.product,
    cachedAt: r.cached_at,
  }));
}

// ─── Basecamp OAuth flows ───────────────────────────────────────────────

export function saveOAuthFlow(
  flow: Omit<BasecampOAuthFlow, 'createdAt' | 'updatedAt'>,
  db: BetterSqlite3Database = getDb(),
): BasecampOAuthFlow {
  const t = now();
  db.prepare(
    `INSERT INTO basecamp_oauth_flows (flow_id, identity_id, access_token, refresh_token, expires_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    flow.flowId,
    flow.identityId,
    flow.accessToken,
    flow.refreshToken,
    flow.expiresAt,
    flow.status,
    t,
    t,
  );
  return { ...flow, createdAt: t, updatedAt: t };
}

export function readOAuthFlow(
  flowId: string,
  db: BetterSqlite3Database = getDb(),
): BasecampOAuthFlow | undefined {
  const row = db
    .prepare(
      `SELECT flow_id, identity_id, access_token, refresh_token, expires_at, status, created_at, updated_at
         FROM basecamp_oauth_flows WHERE flow_id = ?`,
    )
    .get(flowId) as
    | {
        flow_id: string;
        identity_id: number;
        access_token: string;
        refresh_token: string;
        expires_at: number;
        status: BasecampFlowStatus;
        created_at: number;
        updated_at: number;
      }
    | undefined;
  if (!row) return undefined;
  return {
    flowId: row.flow_id,
    identityId: row.identity_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateOAuthFlowTokens(
  flowId: string,
  data: { accessToken: string; refreshToken: string; expiresAt: number },
  db: BetterSqlite3Database = getDb(),
): void {
  const t = now();
  db.prepare(
    `UPDATE basecamp_oauth_flows
        SET access_token = ?, refresh_token = ?, expires_at = ?, status = 'active', updated_at = ?
      WHERE flow_id = ?`,
  ).run(data.accessToken, data.refreshToken, data.expiresAt, t, flowId);
}

export function setOAuthFlowStatus(
  flowId: string,
  status: BasecampFlowStatus,
  db: BetterSqlite3Database = getDb(),
): void {
  const t = now();
  db.prepare(
    `UPDATE basecamp_oauth_flows SET status = ?, updated_at = ? WHERE flow_id = ?`,
  ).run(status, t, flowId);
}

// ─── MCP installations ──────────────────────────────────────────────────

export function saveMcpInstallation(
  install: Omit<McpInstallation, 'issuedAt' | 'revokedAt'>,
  db: BetterSqlite3Database = getDb(),
): McpInstallation {
  const t = now();
  db.prepare(
    `INSERT INTO mcp_installations
       (access_token, refresh_token, client_id, identity_id, account_id, flow_id, issued_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    install.accessToken,
    install.refreshToken,
    install.clientId,
    install.identityId,
    install.accountId,
    install.flowId,
    t,
    install.expiresAt,
  );
  return { ...install, issuedAt: t, revokedAt: null };
}

function mapInstallationRow(row: {
  access_token: string;
  refresh_token: string;
  client_id: string;
  identity_id: number;
  account_id: number;
  flow_id: string;
  issued_at: number;
  expires_at: number | null;
  revoked_at: number | null;
}): McpInstallation {
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    clientId: row.client_id,
    identityId: row.identity_id,
    accountId: row.account_id,
    flowId: row.flow_id,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export function readMcpInstallationByAccess(
  accessToken: string,
  db: BetterSqlite3Database = getDb(),
): McpInstallation | undefined {
  const row = db
    .prepare(
      `SELECT access_token, refresh_token, client_id, identity_id, account_id, flow_id, issued_at, expires_at, revoked_at
         FROM mcp_installations WHERE access_token = ?`,
    )
    .get(accessToken) as Parameters<typeof mapInstallationRow>[0] | undefined;
  return row ? mapInstallationRow(row) : undefined;
}

export function readMcpInstallationByRefresh(
  refreshToken: string,
  db: BetterSqlite3Database = getDb(),
): McpInstallation | undefined {
  const row = db
    .prepare(
      `SELECT access_token, refresh_token, client_id, identity_id, account_id, flow_id, issued_at, expires_at, revoked_at
         FROM mcp_installations WHERE refresh_token = ?`,
    )
    .get(refreshToken) as Parameters<typeof mapInstallationRow>[0] | undefined;
  return row ? mapInstallationRow(row) : undefined;
}

export function rotateMcpInstallationTokens(
  oldAccessToken: string,
  newTokens: { accessToken: string; refreshToken: string; expiresAt: number | null },
  db: BetterSqlite3Database = getDb(),
): McpInstallation | undefined {
  const t = now();
  const tx = db.transaction(() => {
    const existing = readMcpInstallationByAccess(oldAccessToken, db);
    if (!existing) return undefined;
    db.prepare(
      `UPDATE mcp_installations
          SET access_token = ?, refresh_token = ?, issued_at = ?, expires_at = ?
        WHERE access_token = ?`,
    ).run(
      newTokens.accessToken,
      newTokens.refreshToken,
      t,
      newTokens.expiresAt,
      oldAccessToken,
    );
    return readMcpInstallationByAccess(newTokens.accessToken, db);
  });
  return tx();
}

export function revokeMcpInstallation(
  accessToken: string,
  db: BetterSqlite3Database = getDb(),
): void {
  const t = now();
  db.prepare(
    `UPDATE mcp_installations SET revoked_at = ? WHERE access_token = ?`,
  ).run(t, accessToken);
}

// ─── Token exchanges (replay protection) ────────────────────────────────

export function saveTokenExchange(
  mcpAuthCode: string,
  mcpAccessToken: string,
  db: BetterSqlite3Database = getDb(),
): TokenExchange {
  const t = now();
  db.prepare(
    `INSERT INTO token_exchanges (mcp_auth_code, mcp_access_token, already_used, created_at, expires_at)
     VALUES (?, ?, 0, ?, ?)`,
  ).run(mcpAuthCode, mcpAccessToken, t, t + TOKEN_EXCHANGE_TTL_SEC);
  return {
    mcpAuthCode,
    mcpAccessToken,
    alreadyUsed: false,
    createdAt: t,
    expiresAt: t + TOKEN_EXCHANGE_TTL_SEC,
  };
}

/**
 * Atomically look up a token exchange and mark it used. Returns the exchange
 * on the first call; throws on subsequent calls so the caller can revoke
 * the installation (replay protection).
 */
export function consumeTokenExchange(
  mcpAuthCode: string,
  db: BetterSqlite3Database = getDb(),
): { exchange: TokenExchange; firstUse: boolean } | undefined {
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT mcp_auth_code, mcp_access_token, already_used, created_at, expires_at
           FROM token_exchanges WHERE mcp_auth_code = ?`,
      )
      .get(mcpAuthCode) as
      | {
          mcp_auth_code: string;
          mcp_access_token: string;
          already_used: number;
          created_at: number;
          expires_at: number;
        }
      | undefined;
    if (!row) return undefined;
    if (row.expires_at < now()) {
      db.prepare(`DELETE FROM token_exchanges WHERE mcp_auth_code = ?`).run(
        mcpAuthCode,
      );
      return undefined;
    }
    const wasUsed = row.already_used === 1;
    if (!wasUsed) {
      db.prepare(
        `UPDATE token_exchanges SET already_used = 1 WHERE mcp_auth_code = ?`,
      ).run(mcpAuthCode);
    }
    return {
      exchange: {
        mcpAuthCode: row.mcp_auth_code,
        mcpAccessToken: row.mcp_access_token,
        alreadyUsed: true,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      },
      firstUse: !wasUsed,
    };
  });
  return tx();
}

// ─── Periodic cleanup ───────────────────────────────────────────────────

export function cleanupExpired(db: BetterSqlite3Database = getDb()): void {
  const t = now();
  db.prepare(`DELETE FROM pending_authorizations WHERE expires_at < ?`).run(t);
  db.prepare(`DELETE FROM token_exchanges WHERE expires_at < ?`).run(t);
  db.prepare(`DELETE FROM oauth_clients WHERE expires_at < ?`).run(t);
}
