# basecamp-mcp-server

Remote MCP server for [Basecamp 3](https://basecamp.com/). Connect from
Claude Desktop / Codex / ChatGPT / any MCP client via OAuth — no plugin
install, no per-user OAuth app setup.

The maintainer runs a private deployment for the team. The URL is shared
out-of-band (Slack/email) — if you need access and don't have it, ask.
If you'd rather run your own instance, the **Self-host / contribute**
section below walks through the deploy.

---

## Connect from Claude Desktop

1. Open **Claude Desktop → Settings → Connectors** (or **Integrations**, depending on your version).
2. Click **Add custom connector**.
3. Fill in:
   - **Name:** `Basecamp` (or anything you like)
   - **URL:** `<your-server-url>/mcp` (ask the maintainer for the URL if you're on the team, or run your own — see below)
4. Click **Save**. Claude will open your browser to **log in to Basecamp** and authorize the connector.
5. If your Basecamp account shows you more than one team, you'll see an account-picker page — pick the one you want this connector to use, then click **Continue**.
6. Done. Ask Claude things like:
   - "List my Basecamp projects."
   - "What todos are open on Project X?"
   - "Summarize the most recent messages on the Launch project message board."
   - "Post 'standup at 10' to the engineering campfire."
   - "Create a todo 'Review PR #42' in the QA todolist, due Friday."

**One connector = one Basecamp account.** If you belong to multiple Basecamp accounts and want Claude to reach all of them, add the connector multiple times (each one will prompt you to pick a different account during setup).

**To reconnect** (e.g., if you signed out of Basecamp or tokens were revoked):
Claude will prompt automatically when a tool call fails with "reconnect" in the message. Otherwise, remove the connector and add it again.

---

## What Claude can do

**Read** — list projects, inspect a project's people/todos/messages/campfires, read individual todos / messages, read campfire history.

**Write** — create a todo, mark a todo complete, post a message to a project's message board, post a campfire chat message.

**Interactive** — `basecamp_my_plate` renders a read-only Basecamp dashboard as an [MCP App](https://modelcontextprotocol.io/extensions/apps/overview) (sandboxed iframe UI): KPI cards, today's todos, unread breakdown, projects, 7-day upcoming load, waiting-on-you list. See [MCP App: `basecamp_my_plate`](#mcp-app-basecamp_my_plate).

15 tools in total, prefixed `basecamp_`. Responses are capped at 25,000 characters; list tools paginate (`limit` / `offset`).

---

## MCP App: `basecamp_my_plate`

`basecamp_my_plate` is an MCP App tool (spec
[MCP Apps 2026-01-26](https://modelcontextprotocol.io/extensions/apps/overview)).
When invoked on a compatible host (Claude Desktop paid plan, Claude.ai, or the
[`ext-apps` basic-host](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host)),
the host mounts a sandboxed iframe showing the authenticated user's Basecamp dashboard —
at-a-glance status, no interaction.

**Widgets:**

- **KPI row** — overdue, due today, unread signals, @you · waiting.
- **Today** — a list of today's due todos with project and priority flag.
- **Unread by type** — stacked-bar breakdown of `/my/readings.json` sections (@you / pings / chats / messages) + oldest unread.
- **Open todos by project** — bars sorted desc; 🔥 tag per project with overdue or due-today items.
- **Upcoming load · next 7 days** — histogram of due dates from today forward.
- **Waiting on you** — top 5 mentions + pings sorted by waiting time, severity-coded.

The dashboard fans out 7 Basecamp API calls in parallel (`/my/assignments` at six scopes
plus `/my/readings.json`) on each invocation — well within the 50-req / 10-sec rate limit.
It takes no arguments (any are ignored for forward-compat with older prompts).

**UI bundle:** built by `npm run build:ui` (Vite + `vite-plugin-singlefile`) to
`dist/ui/my-plate.html` and served as the resource `ui://basecamp/my-plate`. `npm run build`
builds both the server and the UI.

**Local smoke test:** run the server, then point the basic-host at `http://localhost:3232/mcp`:

```bash
git clone https://github.com/modelcontextprotocol/ext-apps.git /tmp/ext-apps
cd /tmp/ext-apps/examples/basic-host
npm install
SERVERS='["http://localhost:3232/mcp"]' npm start  # basic-host UI on :8080
```

For a remote MCP client (Claude Desktop, Claude.ai), expose the local server over the public
internet (ngrok / cloudflared), set `BASE_URI` to the tunnel URL, register the same URL +
`/oauth/basecamp/callback` as the Basecamp OAuth app's redirect URI, and add your server as
a [custom connector](https://support.anthropic.com/en/articles/11175166).

---

## Self-host / contribute

If you'd rather run your own instance (e.g., on your own Fly.io account, or on any host that can terminate HTTPS):

### Local development

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

For Claude Desktop to reach your local server you need a public tunnel
(e.g. `ngrok http 3232`); set `BASE_URI` in `.env` to that tunnel URL and
register the same URL + `/oauth/basecamp/callback` as the OAuth app's
Redirect URI.

### Production deploy (Fly.io)

Single machine, SQLite on a mounted volume. `min_machines_running = 1` and
`auto_stop_machines = off` — if the machine stops the DB is unreachable.

`fly.toml` is gitignored so the production hostname isn't published to a
public repo. Copy the template and fill in your own app/volume names:

```bash
cp fly.example.toml fly.toml
# edit fly.toml: set app = "<your-fly-app-name>" and [mounts].source = "<your-fly-volume-name>"

fly apps create <your-fly-app-name>
fly volumes create <your-fly-volume-name> --size 1 --region iad -a <your-fly-app-name>
fly secrets set \
  BASECAMP_CLIENT_ID=... \
  BASECAMP_CLIENT_SECRET=... \
  USER_AGENT_CONTACT=ops@your-domain.example \
  BASE_URI=https://<your-fly-app-name>.fly.dev \
  VAULT_DB_PATH=/data/vault.db \
  NODE_ENV=production \
  -a <your-fly-app-name>
fly deploy -a <your-fly-app-name>
```

Pick an unguessable app name (e.g., `basecamp-mcp-server-a1b2c3`) if you
want to use capability-URL access control (share the URL only with
trusted users). Register a Basecamp OAuth app whose Redirect URI is
`https://<your-fly-app-name>.fly.dev/oauth/basecamp/callback`.

### Contributing

PRs welcome. The `main` branch is protected — open a PR from a fork or a
topic branch and I'll review. Run `npm test`, `npm run typecheck`, and
`npm run lint` before opening the PR.

### Architecture

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

### Security

- SQLite vault stores tokens in plaintext in v1. Fly volumes are LUKS-
  encrypted at the block level. AES-256-GCM field-level encryption is
  scoped for v2, along with hash-on-lookup for MCP access tokens.
- Never log full tokens — `logger.debug` truncates to 8-char prefixes.
- `User-Agent: BasecampMCP (${USER_AGENT_CONTACT})` on every API call.
- 50 req / 10s Basecamp rate limit is honored via `Retry-After` on 429.

### Smoke test

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
schemas.

### Evaluations

A 10-question `evaluations/basecamp-mcp-server.xml` (per the `mcp-builder` skill) is
deferred until the server has been pointed at a real Basecamp sandbox. To
unblock: deploy, run the MCP Inspector against it, hand-craft ten
`<qa_pair>` entries whose answers are closed/historical facts, then drive
them through `.claude/skills/mcp-builder/scripts/evaluation.py`.

---

## License

MIT.
