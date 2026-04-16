-- Basecamp MCP server schema.
--
-- Tables are grouped by role:
--   oauth_clients, pending_authorizations, token_exchanges  → AS-side state
--   basecamp_identities, basecamp_accounts, basecamp_oauth_flows → user state
--   mcp_installations                                        → issued tokens
-- See docs/oauth-flow.md for the full flow.

-- MCP clients registered via Dynamic Client Registration (/register).
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT,
  client_metadata TEXT NOT NULL,          -- JSON-encoded OAuthClientInformationFull
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_expires_at
  ON oauth_clients(expires_at);

-- In-flight /authorize requests. Deleted once finalized or expired (TTL 10min).
CREATE TABLE IF NOT EXISTS pending_authorizations (
  mcp_auth_code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  client_state TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pending_authorizations_expires_at
  ON pending_authorizations(expires_at);

-- One row per Basecamp user (identified by Launchpad identity.id).
CREATE TABLE IF NOT EXISTS basecamp_identities (
  identity_id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Cached accounts list per identity (one row per account per identity).
-- Product is "bc3", "bcx", "campfire", etc. — we only ever select bc3.
CREATE TABLE IF NOT EXISTS basecamp_accounts (
  identity_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  href TEXT NOT NULL,
  app_href TEXT,
  product TEXT NOT NULL,
  cached_at INTEGER NOT NULL,
  PRIMARY KEY (identity_id, account_id),
  FOREIGN KEY (identity_id) REFERENCES basecamp_identities(identity_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_basecamp_accounts_account_id
  ON basecamp_accounts(account_id);

-- One row per completed Launchpad OAuth grant. Tokens live here; refresh
-- updates this row in place. Status tracks whether the grant is still usable.
CREATE TABLE IF NOT EXISTS basecamp_oauth_flows (
  flow_id TEXT PRIMARY KEY,               -- random 64-hex
  identity_id INTEGER NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'needs_reauth' | 'revoked'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (identity_id) REFERENCES basecamp_identities(identity_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_basecamp_oauth_flows_identity_id
  ON basecamp_oauth_flows(identity_id);

-- MCP tokens issued to registered clients. One installation = one connector.
CREATE TABLE IF NOT EXISTS mcp_installations (
  access_token TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  identity_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  flow_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER,                     -- NULL = non-expiring
  revoked_at INTEGER,
  FOREIGN KEY (client_id)   REFERENCES oauth_clients(client_id)         ON DELETE CASCADE,
  FOREIGN KEY (identity_id) REFERENCES basecamp_identities(identity_id) ON DELETE CASCADE,
  FOREIGN KEY (flow_id)     REFERENCES basecamp_oauth_flows(flow_id)    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mcp_installations_refresh_token
  ON mcp_installations(refresh_token);
CREATE INDEX IF NOT EXISTS idx_mcp_installations_client_identity
  ON mcp_installations(client_id, identity_id);

-- Replay protection for /token exchange. Deleted on expiry (TTL 10min).
-- ON UPDATE CASCADE so that rotating the primary access_token on refresh
-- doesn't break this FK.
CREATE TABLE IF NOT EXISTS token_exchanges (
  mcp_auth_code TEXT PRIMARY KEY,
  mcp_access_token TEXT NOT NULL,
  already_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (mcp_access_token) REFERENCES mcp_installations(access_token)
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_token_exchanges_expires_at
  ON token_exchanges(expires_at);
