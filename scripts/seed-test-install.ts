#!/usr/bin/env tsx
/** Dev only: insert a synthetic MCP installation for smoke-testing tools/list. */
import { getDb } from '../src/lib/db.js';

const db = getDb();
const t = Math.floor(Date.now() / 1000);

db.prepare(
  `INSERT OR REPLACE INTO oauth_clients (client_id, client_name, client_metadata, created_at, expires_at)
   VALUES ('test-client', 'Test Client', ?, ?, ?)`,
).run(
  JSON.stringify({
    client_id: 'test-client',
    client_name: 'Test Client',
    redirect_uris: ['http://localhost/cb'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }),
  t,
  t + 86400,
);

db.prepare(
  `INSERT OR REPLACE INTO basecamp_identities (identity_id, email, first_name, last_name, created_at, updated_at)
   VALUES (1, 'test@example.com', 'Test', 'User', ?, ?)`,
).run(t, t);

db.prepare(
  `INSERT OR REPLACE INTO basecamp_oauth_flows (flow_id, identity_id, access_token, refresh_token, expires_at, status, created_at, updated_at)
   VALUES ('test-flow', 1, 'bc-access', 'bc-refresh', ?, 'active', ?, ?)`,
).run(t + 100000, t, t);

db.prepare(
  `INSERT OR REPLACE INTO mcp_installations
     (access_token, refresh_token, client_id, identity_id, account_id, flow_id, issued_at, expires_at, revoked_at)
   VALUES ('test-token', 'test-refresh', 'test-client', 1, 9999, 'test-flow', ?, ?, NULL)`,
).run(t, t + 2592000);

console.log('Seeded: Bearer test-token');
