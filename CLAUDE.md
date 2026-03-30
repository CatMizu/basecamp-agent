# Basecamp Agent

This is a Basecamp 3 management agent. Users interact with Basecamp through custom skills.

## Available Skills

- `/basecamp-init` — First-time setup: configure OAuth credentials and add Basecamp accounts
- `/basecamp` — Main agent: manage projects, todos, messages, campfires across all accounts
- `/basecamp-auth` — Fix authentication issues or refresh expired tokens

## Important Rules

- **Never expose tokens or secrets** in output — access_token, refresh_token, client_secret must never be shown to the user
- **User config lives in `.credentials/`** (project root) — this directory is gitignored, never commit it
- **Always use refresh-token.sh** before API calls to ensure valid tokens
- **Rate limit**: Basecamp allows 50 requests per 10 seconds. If you get a 429 response, wait for the `Retry-After` header value
- **Pagination**: Follow `Link` header `rel="next"` URLs. Never construct pagination URLs manually
- **User-Agent header is required** on all API requests: `User-Agent: BasecampAgent (support@example.com)`
- **Multi-account**: Users may have multiple Basecamp accounts (different clients). Always clarify which account when ambiguous
- **Confirm before writing**: When creating or modifying items (todos, messages, etc.), confirm details with the user first
