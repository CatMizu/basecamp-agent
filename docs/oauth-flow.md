# OAuth flow

This server is simultaneously an OAuth 2.1 **Authorization Server** (to MCP
clients like Claude Desktop / Codex / ChatGPT) and an OAuth **Client** to
Basecamp Launchpad. Those two hops are welded into one user-facing flow so
the end user logs in exactly once.

## Endpoints

| Method | Path | Who serves it | Purpose |
|---|---|---|---|
| GET | `/.well-known/oauth-authorization-server` | MCP SDK | AS metadata (RFC 8414) |
| GET | `/.well-known/oauth-protected-resource/mcp` | MCP SDK | RS metadata (RFC 9728) |
| POST | `/register` | MCP SDK | Dynamic Client Registration |
| GET/POST | `/authorize` | MCP SDK → our provider | Starts the flow |
| POST | `/token` | MCP SDK → our provider | Authorization code / refresh token exchange |
| POST | `/revoke` | MCP SDK → our provider | Revoke an issued MCP token |
| GET | `/oauth/basecamp/callback` | us | Basecamp's redirect URI |
| GET / POST | `/oauth/select-account` | us | Picker for multi-bc3 identities |
| GET / POST / DELETE | `/mcp` | us | Streamable HTTP MCP endpoint (bearer-authed) |

## End-to-end sequence (happy path, single bc3 account)

```
[Claude desktop] discovers → POST /register → GET /authorize (PKCE S256, state=CLIENT_STATE)
    ↓
BasecampOAuthProvider.authorize() mints mcp_auth_code (64-hex),
INSERTs pending_authorizations row { codeChallenge, clientId, redirectUri, clientState },
    ↓
302 → launchpad.37signals.com/authorization/new
        ?type=web_server&client_id=$BC_CLIENT_ID
        &redirect_uri=$BASE_URI/oauth/basecamp/callback
        &state=$mcp_auth_code       ← load-bearing; ties the two halves together
    ↓
[User] logs in to Basecamp, grants access
    ↓
GET /oauth/basecamp/callback?code=BC_CODE&state=$mcp_auth_code
    a) readPendingAuthorization(state)         → 400 if missing/expired
    b) POST launchpad/authorization/token      → { access_token, refresh_token, expires_in }
    c) GET  launchpad/authorization.json       → { identity: {id, email, ...}, accounts: [...] }
    d) UPSERT basecamp_identities, basecamp_accounts (all accounts, flagged by product)
    e) INSERT basecamp_oauth_flows row (tokens live here, keyed by random flow_id)
    f) Filter accounts where product === "bc3":
         - 0 bc3 → render error page
         - 1 bc3 → auto-select → finalizeAuthorization()
         - >1 bc3 → 302 /oauth/select-account?state=$mcp_auth_code&flow=$flowId
    ↓
[If picker was shown]
POST /oauth/select-account  (form with state, flow, chosen account_id)
    g) readPendingAuthorization(state)
    h) Validate account_id ∈ identity's bc3 accounts
    i) finalizeAuthorization()
    ↓
finalizeAuthorization():
    - generateMcpTokens()
    - INSERT mcp_installations (access_token, refresh_token, client_id, identity_id, account_id, flow_id)
    - INSERT token_exchanges row (mcp_auth_code → mcp_access_token, already_used=0)
    - pending_authorizations row NOT deleted yet — the SDK's challengeForAuthorizationCode reads it
    - 302 → $pending.redirectUri?code=$mcp_auth_code&state=$clientState
    ↓
[Claude desktop] POST /token (grant_type=authorization_code, code=$mcp_auth_code, code_verifier=...)
    - SDK's tokenHandler calls provider.challengeForAuthorizationCode(client, code)
        → reads pending_authorizations.codeChallenge
    - SDK verifies PKCE S256 challenge against code_verifier
    - SDK calls provider.exchangeAuthorizationCode(client, code)
        → consumeTokenExchange atomically marks already_used=1
        → reads mcp_installations row
        → deletes pending_authorizations
        → returns { access_token, refresh_token, expires_in, token_type }
    - Replay attempt (second /token with same code) → revoke install, 400 invalid_grant.
    ↓
[Claude desktop] POST /mcp with Authorization: Bearer <access_token>
    - bearerAuth middleware → provider.verifyAccessToken(token)
        → reads mcp_installations
        → returns AuthInfo { token, clientId, scopes:['mcp'], expiresAt,
                             extra: { identityId, accountId, flowId } }
    - Tool handler reads extra via getBasecampCtx(authInfo.extra)
        → getBasecampAccessToken(flowId) returns a fresh Basecamp access token
        → tool calls bcFetch / bcFetchPage / bcFetchOffsetLimit with auto-refresh + 429 retry
```

## State threading

Exactly one identifier travels the whole flow: **`mcp_auth_code`** (64-hex).
It is persisted in `pending_authorizations` (TTL 10 min, PK =
`mcp_auth_code`), passed to Basecamp as `state`, returned on callback,
hidden in the picker form, and looked up at `/token` exchange. There are no
cookies, no session tokens, no Basecamp PKCE (Launchpad doesn't support it),
and no per-user server-side session state.

## PKCE

- **MCP client ↔ our server:** full PKCE S256 enforced by the SDK's
  tokenHandler. `challengeForAuthorizationCode()` returns the
  `codeChallenge` we stored at `/authorize` time.
- **Our server ↔ Launchpad:** none. Launchpad does not support PKCE. The CSRF
  property is provided by `state` being a 64-hex token we minted and stored
  before redirecting.

## Replay protection

`token_exchanges.already_used` is flipped from 0→1 inside a SQLite
transaction. Concurrent `/token` calls for the same code see the update and
only one gets `firstUse=true`; the other is treated as a replay attempt and
the whole `mcp_installation` is revoked.

## Refresh — Basecamp side

`getBasecampAccessToken(flowId)`:
1. Reads `basecamp_oauth_flows`. Throws `McpReauthError` if row missing or
   `status !== 'active'`.
2. If `expires_at - 60s > now`, returns the cached `access_token`.
3. Otherwise takes a per-flow in-memory mutex so concurrent callers share a
   single refresh. POSTs `launchpad/authorization/token` with `type=refresh`.
4. Persists the new `access_token` (and the new `refresh_token`, if
   Launchpad rotated it). On 4xx, flips `status='needs_reauth'` and throws
   `McpReauthError`.

`McpReauthError` surfaces to the LLM as a tool-level text error telling the
user to reconnect the connector in Claude.

## Refresh — MCP side

Our provider's `exchangeRefreshToken()` rotates both tokens on every
refresh. Old refresh tokens are invalidated (UNIQUE constraint on
`mcp_installations.refresh_token` + UPDATE replaces the row).
