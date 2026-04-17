# basecamp-mcp-server

Remote MCP server for Basecamp 3. TypeScript + Express, SQLite token vault
on a Fly.io volume, Streamable HTTP transport, 14 tools.

## Stack

- Node 22, TypeScript strict, `@modelcontextprotocol/sdk@1.24.2`
- Express + `mcpAuthRouter` for OAuth (/register, /authorize, /token, /revoke,
  /.well-known/*)
- `better-sqlite3` with WAL, forward-only migrations in `migrations/*.sql`
- Jest with ts-jest (ESM) — tests live next to source as `*.test.ts`

## Architecture

Three modules, one process:

- **AUTH** (`src/modules/auth/`): simultaneously an OAuth Authorization
  Server (for MCP clients) and an OAuth Client to Basecamp Launchpad.
  Single-user flow welds both hops together via one `mcp_auth_code` (64-hex)
  threaded through Launchpad's `state` parameter. See
  `docs/oauth-flow.md`.
- **MCP** (`src/modules/mcp/`): bearer-authed Streamable HTTP at `/mcp` + 14
  Basecamp tools. Stateless — each request gets its own transport +
  McpServer. Tool handlers receive the Basecamp context (`identityId`,
  `accountId`, `flowId`) via `AuthInfo.extra`.
- **Shared** (`src/lib/`, `src/modules/shared/`): DB singleton, crypto
  primitives, structured logger, Basecamp domain types.

## API rules (load-bearing)

- **Never log tokens.** `logger.debug` shows 8-char prefixes only.
  `access_token` and `refresh_token` must never appear in log output or tool
  responses.
- **User-Agent is required** on every Basecamp API call:
  `User-Agent: BasecampMCP (${USER_AGENT_CONTACT})`.
- **Rate limit**: 50 req / 10s. On 429 → surface `Retry-After` via
  `BasecampRateLimitError`. Don't hammer.
- **Pagination**: follow `Link: <URL>; rel="next"`. Never synthesize
  pagination URLs. `bcFetchOffsetLimit()` wraps this into offset/limit.
- **Campfire messages require `content_type: "text/html"`** —
  `basecamp_post_campfire_message` auto-injects this. Users/models must not
  have to remember.
- **Project dock pattern**: GET `/projects/{id}.json` first to discover
  todoset_id / message_board_id before hitting feature endpoints.

## SQLite invariants

- Single-writer process (SQLite pins the Fly machine — `min_machines_running
  = 1`, `auto_stop_machines = off`).
- `foreign_keys = ON`, WAL journal.
- `token_exchanges.mcp_access_token → mcp_installations.access_token` uses
  `ON UPDATE CASCADE` because `exchangeRefreshToken` rotates the PK.
- All sqlite-store functions accept an optional `db` parameter for test
  isolation; tests use `createTestDb()` + `setDbForTesting()`.

## Testing

- Run `npm test` before committing. Never `--no-verify` past a hook.
- New tool or auth code should have a test at the same path.
- Mock `globalThis.fetch` for HTTP tests; don't hit the real Basecamp API
  from the test suite.

## Commit discipline

`main` is protected — require a PR to merge. Branch from main and open a
PR from the feature branch. Group related changes into reviewable chunks
(one PR = one coherent change, or a small sequence of commits like
scaffold → feature → tests).
