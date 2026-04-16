# basecamp-mcp

Remote MCP server for [Basecamp 3](https://basecamp.com/). Connect from
Claude Desktop / Codex / ChatGPT / any MCP client via OAuth — no plugin
install, no OAuth app credentials for each user.

One MCP connector maps to **one Basecamp account**. Users with multiple
accounts register multiple connectors.

## Endpoint

```
POST https://<your-deployment>/mcp
```

The server advertises itself as an OAuth 2.1 Authorization Server at
`/.well-known/oauth-authorization-server` and as a Protected Resource at
`/.well-known/oauth-protected-resource/mcp`. MCP clients that follow those
discovery specs (Claude Desktop does) can auto-configure without out-of-band
setup.

## Tools (v1)

Ten read tools and four write tools, all prefixed `basecamp_`:

**Read** — `basecamp_list_projects`, `basecamp_get_project`,
`basecamp_list_project_people`, `basecamp_list_todolists`,
`basecamp_list_todos`, `basecamp_get_todo`, `basecamp_list_messages`,
`basecamp_get_message`, `basecamp_list_campfires`,
`basecamp_read_campfire_history`.

**Write** — `basecamp_create_todo`, `basecamp_complete_todo`,
`basecamp_post_message`, `basecamp_post_campfire_message`.

Every tool has:

- A Zod `.strict()` input schema and an `outputSchema` so the model can
  reason about the shape.
- A `response_format: 'markdown' | 'json'` parameter (default markdown).
- `limit` / `offset` on list tools; responses include `total`, `count`,
  `has_more`, `next_offset`.
- Annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint`) set per MCP convention.
- Responses capped at `CHARACTER_LIMIT = 25_000` characters — over-limit
  returns surface `truncated: true` and a hint to paginate.

`basecamp_post_campfire_message` auto-injects `content_type: "text/html"`
so rich-text formatting actually renders.

## Local development

```bash
# Node 22
nvm use          # reads .nvmrc

# Install + initialize vault
npm install
npm run dev-reset-db

# Register a Basecamp OAuth app at https://launchpad.37signals.com/integrations.
# Redirect URI: http://localhost:3232/oauth/basecamp/callback
# Put the client_id / client_secret in .env (see .env.example).
cp .env.example .env

npm run dev      # watches src/, listens on :3232
```

Test the flow end-to-end with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
# Point it at http://localhost:3232 and walk through /authorize, /token, tools/list.
```

## Production deploy (Fly.io)

Single machine, SQLite on a mounted volume. `min_machines_running = 1` and
`auto_stop_machines = off` — if the machine stops the DB is unreachable.

```bash
fly volumes create basecamp_mcp_data --size 1 --region iad
fly secrets set \
  BASECAMP_CLIENT_ID=... \
  BASECAMP_CLIENT_SECRET=... \
  USER_AGENT_CONTACT=ops@your-domain.example \
  BASE_URI=https://basecamp-mcp.fly.dev \
  VAULT_DB_PATH=/data/vault.db
fly deploy
```

## Architecture

See [docs/oauth-flow.md](docs/oauth-flow.md) for the two-layer OAuth dance
(AS for MCP clients, OAuth Client to Basecamp) that collapses into a single
user-facing login.

```
src/
├── index.ts                      — Express entrypoint
├── config.ts                     — env loader
├── constants.ts                  — API_BASE_URL_PREFIX, CHARACTER_LIMIT, ResponseFormat
├── lib/
│   ├── db.ts                     — better-sqlite3 singleton + migrations
│   ├── crypto.ts                 — generateToken / sha256
│   └── types.ts                  — Basecamp domain types
├── modules/
│   ├── shared/logger.ts          — structured logger
│   ├── auth/                     — AS + Basecamp OAuth wrapper (§docs/oauth-flow.md)
│   └── mcp/
│       ├── index.ts              — bearer auth + shttp mount
│       ├── services/mcp.ts       — McpServer factory
│       ├── handlers/shttp.ts     — stateless StreamableHTTP handler
│       └── tools/                — 14 tools + shared fetch wrapper
└── static/styles.css             — splash + picker styles
```

## Evaluations

A 10-question `evaluations/basecamp-mcp.xml` (per the `mcp-builder` skill) is
deferred until the server has been pointed at a real Basecamp sandbox —
evaluations whose answers can't be verified against live data are of no
value. To unblock: deploy, run the MCP Inspector against it, hand-craft ten
`<qa_pair>` entries whose answers are closed/historical facts, then drive
them through `.claude/skills/mcp-builder/scripts/evaluation.py`.

## Smoke test

`scripts/seed-test-install.ts` inserts a synthetic installation with bearer
`test-token` so you can hit `/mcp` without walking the full OAuth dance:

```bash
npm run build
npx tsx scripts/seed-test-install.ts
node dist/index.js &
curl -s -X POST http://localhost:3232/mcp \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'
```

`tools/list` on the same endpoint should return all 14 tools with their
schemas. Tool invocation will fail (the synthetic `bc-access` is not a real
Basecamp token), but that proves the MCP transport, auth middleware, and
Zod schema compilation all work end-to-end.

## Naming deviation

The Anthropic `mcp-builder` skill recommends `{service}-mcp-server`. This
project is named `basecamp-mcp` to match the Fly app and the repo name;
semantically it's the same thing.

## Security notes

- SQLite vault stores tokens in plaintext in v1. Fly volumes are LUKS-
  encrypted at the block level. AES-256-GCM field-level encryption is
  scoped for v2, along with hash-on-lookup for MCP access tokens.
- Never log full tokens — `logger.debug` truncates to 8-char prefixes.
- `User-Agent: BasecampMCP (${USER_AGENT_CONTACT})` on every API call.
- 50 req / 10s Basecamp rate limit is honored via `Retry-After` on 429.

## License

MIT.
