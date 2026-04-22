# Design: `basecamp_my_plate` — the first MCP App for this server

Date: 2026-04-22
Status: Approved — ready for implementation plan.
Spec source: [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview),
[build guide](https://modelcontextprotocol.io/extensions/apps/build),
[spec 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx).

## 1. Feature

A cross-project "what's on my plate" view, rendered as an MCP App (interactive
iframe) inside Claude / Claude Desktop, driven by a new tool
`basecamp_my_plate`.

**User intent:** "Show me my open todos across all projects" → grouped list,
priorities pinned on top, one section per project (bucket), checkbox per todo
to complete in place, top-bar tabs to switch scope (Open / Completed /
Overdue / Due today / Due tomorrow / Due later this week / Due next week /
Due later).

**Data source:** Basecamp 3 `GET /my/assignments.json` (and
`.../completed.json`, `.../due.json?scope=<s>`). One request per invocation,
no per-project fan-out.

**Transport:** MCP Apps extension (spec 2026-01-26). Tool advertises a UI
resource URI; host fetches the resource, mounts a sandboxed iframe, pushes the
tool result into the iframe. The iframe calls tools back via `postMessage`
JSON-RPC proxied through the host.

## 2. Architecture

Three new pieces inside `src/modules/mcp/`, one dep and one dev dep.

### Dependencies

- Runtime: `@modelcontextprotocol/ext-apps` — official helper. Provides
  `registerAppTool`, `registerAppResource`, `RESOURCE_MIME_TYPE` on the server
  side; `App` class (connect, `ontoolresult`, `callServerTool`) on the UI side.
  Handles the `ui/initialize` handshake the spec requires.
- Dev: `vite` + `vite-plugin-singlefile` — bundles the UI (HTML + TS + CSS)
  into one file served as the resource body. Official-guide pattern.

### Pieces

**a. Tool `basecamp_my_plate`** — in `src/modules/mcp/tools/query-tools.ts`,
registered via `registerAppTool(...)` with
`_meta: { ui: { resourceUri: "ui://basecamp/my-plate" } }`. Input schema is a
single enum `scope` (default `"open"`). Handler calls `getMyAssignments` and
returns both a text `content` summary (for the LLM's transcript) and
`structuredContent` (the normalized payload consumed by the iframe).

**b. UI resource `ui://basecamp/my-plate`** — registered via
`registerAppResource(...)` in a new `src/modules/mcp/tools/resources.ts`.
`resources/read` returns the bundled HTML from `dist/ui/my-plate.html`
(`mimeType: RESOURCE_MIME_TYPE`).

**c. API wrapper `getMyAssignments(scope, ctx)`** — in
`src/modules/mcp/basecamp-api.ts`. Maps `scope` to the right endpoint
(`/my/assignments.json` vs `.../completed.json` vs `.../due.json?scope=…`).
Returns a normalized `Assignment[]` — flattens `priorities` + `non_priorities`,
tags each with `priority: boolean`, preserves bucket/parent/due/assignee
fields from the API response.

**d. UI bundle `src/modules/mcp/ui/my-plate/`** —
`index.html` + `src/main.ts` + `src/render.ts` + `src/styles.css`.
`main.ts` owns the `App` lifecycle (connect, `ontoolresult`, click handlers
that dispatch `app.callServerTool(...)`). `render.ts` is a pure
`(data, callbacks) → DOM update` function for unit-testable rendering.

### Reuse

- `basecamp_complete_todo` (existing) is called from the iframe for the
  checkbox action. No duplication of write logic.
- Auth, rate limiter, logger, token vault — all untouched.

### Build

New top-level `vite.config.ts` with the `vite-plugin-singlefile` plugin,
input `src/modules/mcp/ui/my-plate/index.html`, output `dist/ui/my-plate.html`.
New `tsconfig.ui.json` with DOM libs, scoped to `src/modules/mcp/ui/**`.
Root `tsconfig.json` adds `exclude: ["src/modules/mcp/ui/**"]` so server
compiles stay unaware of DOM globals. New `build:ui` script in `package.json`;
`npm run build` runs `tsc && vite build && copy static`.

## 3. Data flow

**Initial load (model-initiated):**
1. Model invokes `basecamp_my_plate({scope:"open"})`.
2. Host fetches `ui://basecamp/my-plate`, receives the bundled HTML, mounts a
   sandboxed iframe.
3. Inside the iframe, `App.connect()` performs `ui/initialize` → host replies
   → iframe sends `ui/notifications/initialized`.
4. Server's tool handler runs: `getMyAssignments("open", ctx)` →
   `/my/assignments.json` → normalize → returns
   `{ content: [{type:"text", text:summary}], structuredContent:{scope, groups, priorities, fetchedAt} }`.
5. Host delivers result to iframe via `ui/notifications/tool-result` →
   `app.ontoolresult(result)` → `render(structuredContent)` paints the list.

**Scope switch (UI-initiated):** tab click →
`app.callServerTool({name:"basecamp_my_plate", arguments:{scope:"overdue"}})` →
host proxies → handler runs → result pushed back → `ontoolresult` → re-render.

**Complete (UI-initiated):** checkbox click → optimistic DOM strike + row
removal →
`app.callServerTool({name:"basecamp_complete_todo", arguments:{project_id, todo_id}})` →
on failure, restore row + show red toast ~3s.

The existing `basecamp_complete_todo` tool takes snake_case
`{project_id, todo_id}` (see `action-tools.ts`). The iframe derives
`project_id` from `bucket.id` (present on every assignment in the
`/my/assignments.json` response) and `todo_id` from the assignment's `id`.

### Normalized payload (`structuredContent`)

```ts
{
  scope: "open" | "completed" | "overdue" | "due_today" |
         "due_tomorrow" | "due_later_this_week" | "due_next_week" | "due_later";
  priorities: Todo[];
  groups: Array<{
    bucketId: number;
    bucketName: string;
    lists: Array<{
      listId: number;         // from `parent.id` on each assignment
      title: string;
      todos: Todo[];
    }>;
  }>;
  fetchedAt: string;          // ISO timestamp
}

type Todo = {
  id: number;
  type: string;               // "todo" | other Basecamp types
  content: string;
  dueOn: string | null;       // YYYY-MM-DD
  completed: boolean;
  priority: boolean;
  commentsCount: number;
  appUrl: string;
  assignees: Array<{ id: number; name: string }>;
};
```

### Non-todo assignment types

`/my/assignments.json` surfaces card-table steps alongside todos. v1 filters
to `type === "todo"` only — card steps have no compatible completion endpoint.
A silent filter is acceptable; the tool's text summary mentions the count of
filtered non-todo items so the model can explain if the user asks why
something's missing.

## 4. Error handling

- **Basecamp 4xx/5xx** → existing `BasecampApiError`. Tool returns
  `structuredContent: { error: { message, retryAfter? } }` instead of
  `{ groups, priorities, … }`. UI renders an error card with the message.
- **429 Too Many Requests** → `BasecampRateLimitError`, surface `Retry-After`
  in the error card. No auto-retry.
- **iframe runtime JS error** → `window.onerror` + `window.onunhandledrejection`
  handlers render an inline "Something broke" card. Never propagates.
- **Complete action failure** → restore the row in the DOM, show red toast
  with the error message for ~3s.
- **Auth failure / token rotation mid-session** → handled by existing refresh
  path in the Basecamp client; UI sees a normal error card.

Rate-limit math: `/my/assignments.json` is one request per tool invocation.
Scope-switch is user-paced (clicks per second, ceiling 50/10s). Completions
are user-paced. No fan-out anywhere.

## 5. Testing

Test types, same pattern as existing `*.test.ts` co-located files:

- **`basecamp-api.test.ts`** — add cases for `getMyAssignments`. Each scope
  value resolves to the correct URL + query. Normalization preserves every
  field the UI needs. Mock `globalThis.fetch`, never hit live Basecamp.
- **`query-tools.test.ts`** (or new `my-plate.test.ts`) — tool handler
  returns the expected `structuredContent` shape for success and for
  `BasecampApiError`. Mocks the api layer.
- **`ui/my-plate/src/render.test.ts`** — pure `render(data, callbacks)` into a
  jsdom container. Verifies: priorities pinned top; one section per bucket;
  each list; row renders content + project name + due date chip; clicking a
  checkbox invokes the complete callback with `{project_id, todo_id}`;
  clicking a scope tab invokes the scope-switch callback. Callbacks are injected, not
  imported — the `App` bridge itself is not tested here.
- **Not tested in v1:** the `App` class internals (package responsibility),
  end-to-end Claude Desktop render (manual smoke-test via cloudflared or the
  `basic-host` from the `ext-apps` repo).

## 6. Out of scope for v1

Explicitly deferred:

- Non-todo assignment types (cards, card-table steps).
- In-UI search/filter beyond the scope tabs.
- Create / reassign / comment / edit todos from the UI.
- Persistent UI state across sessions.
- Per-user preferences (collapsed groups, sort order).
- Real-time updates (no websocket or polling — user re-invokes to refresh).

## 7. Open questions for the implementation plan

- Exact build-script wiring: does the existing `build` script stay
  synchronous (`tsc && vite build && copy static`) or do we parallelize?
- Where does `registerAppResource` get the HTML body from at runtime — read
  `dist/ui/my-plate.html` on startup (cached) vs on each `resources/read`
  call? Default: read on startup to the module-level variable; fail fast at
  boot if missing.
- Should the tool also return a structured-content `summary` string
  (count of open items, next due date) for the LLM to reason about after the
  UI is rendered? Leaning yes — it's cheap and helps the LLM continue the
  conversation without re-reading the iframe content.
