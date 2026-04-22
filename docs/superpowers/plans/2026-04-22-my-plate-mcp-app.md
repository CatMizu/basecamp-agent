# basecamp_my_plate MCP App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first generative-UI feature of this MCP server — a `basecamp_my_plate` tool that renders the authenticated user's cross-project todos as an interactive MCP App with scope tabs, inline complete, and priority/project grouping.

**Architecture:** MCP Apps extension (spec 2026-01-26). A new tool advertises a `ui://basecamp/my-plate` resource via `_meta.ui.resourceUri`. The resource serves a Vite-bundled single-file HTML that initializes `@modelcontextprotocol/ext-apps`'s `App` class. Data flow: model invokes the tool → server fetches Basecamp `/my/assignments.json` → host pushes `structuredContent` into the iframe → iframe renders. Scope-tab clicks re-invoke the tool; checkbox clicks call back into the existing `basecamp_complete_todo`.

**Tech Stack:** TypeScript strict, `@modelcontextprotocol/sdk@1.24.2` (existing), `@modelcontextprotocol/ext-apps` (new), Vite + `vite-plugin-singlefile` (new dev), Jest + ts-jest + `jest-environment-jsdom` (new dev), vanilla TS for the UI.

**Spec:** `docs/superpowers/specs/2026-04-22-my-plate-mcp-app-design.md`

---

## File Structure

**Create:**
- `vite.config.ts` — bundles UI into one file
- `tsconfig.ui.json` — DOM-aware TS config for UI sources
- `src/modules/mcp/ui/my-plate/my-plate.html` — UI entry (basename drives Vite output)
- `src/modules/mcp/ui/my-plate/src/main.ts` — App bridge lifecycle
- `src/modules/mcp/ui/my-plate/src/render.ts` — pure render function
- `src/modules/mcp/ui/my-plate/src/render.test.ts` — jsdom unit tests
- `src/modules/mcp/ui/my-plate/src/styles.css` — UI styles
- `src/modules/mcp/ui/my-plate/src/types.ts` — UI-only types
- `src/modules/mcp/tools/resources.ts` — `registerAppResource("ui://basecamp/my-plate")`
- `src/modules/mcp/tools/my-plate.test.ts` — tool handler tests

**Modify:**
- `package.json` — add deps, add `build:ui`, update `build`
- `tsconfig.json` — exclude `src/modules/mcp/ui/**`
- `src/lib/types.ts` — add `BasecampAssignment` + normalized payload types
- `src/modules/mcp/tools/basecamp-api.ts` — add `getMyAssignments(ctx, scope)`
- `src/modules/mcp/tools/basecamp-api.test.ts` — tests for `getMyAssignments`
- `src/modules/mcp/tools/query-tools.ts` — register `basecamp_my_plate` with `registerAppTool`
- `src/modules/mcp/services/mcp.ts` — call `registerUiResources(server)`

---

## Task 1: Dependencies and build scaffolding

Set up Vite, the ext-apps package, and the TS/test infra so everything downstream has somewhere to land. End state: `npm run build:ui` produces `dist/ui/my-plate.html` (empty placeholder), `npm test` still passes, `npm run typecheck` still passes.

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `tsconfig.ui.json`
- Create: `vite.config.ts`
- Create: `src/modules/mcp/ui/my-plate/index.html` (placeholder)
- Create: `src/modules/mcp/ui/my-plate/src/main.ts` (placeholder)

- [ ] **Step 1.1: Install runtime dependency**

Run:
```bash
npm install @modelcontextprotocol/ext-apps
```
Expected: adds `@modelcontextprotocol/ext-apps` to `dependencies` in package.json; `package-lock.json` updated.

- [ ] **Step 1.2: Install dev dependencies**

Run:
```bash
npm install -D vite vite-plugin-singlefile jest-environment-jsdom
```
Expected: three new dev deps; package-lock.json updated.

- [ ] **Step 1.3: Add `exclude` entry in `tsconfig.json`**

Edit `tsconfig.json` to add the UI dir to `exclude`. The server compiler must not try to type-check DOM code:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts", "src/modules/mcp/ui/**"]
}
```

- [ ] **Step 1.4: Create `tsconfig.ui.json`**

The UI needs DOM types, bundler module resolution (Vite), and no server-level rootDir restriction.

Create `tsconfig.ui.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/modules/mcp/ui/**/*.ts", "src/lib/types.ts"]
}
```

`src/lib/types.ts` is included so UI code can import the shared payload types.

- [ ] **Step 1.5: Create `vite.config.ts`**

Create `vite.config.ts` at the repo root:
```ts
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist/ui',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/modules/mcp/ui/my-plate/my-plate.html'),
    },
  },
});
```

`emptyOutDir: false` prevents Vite from wiping `dist/ui/` when there are ever multiple UI bundles. `input` is hardcoded (not `process.env.INPUT`) because we only have one bundle for now.

- [ ] **Step 1.6: Create minimal placeholder UI entry files**

The source HTML is named `my-plate.html` (not `index.html`) so Vite's
`vite-plugin-singlefile` emits `dist/ui/my-plate.html` directly —
`singlefile` names outputs after the entry's basename.

Create `src/modules/mcp/ui/my-plate/my-plate.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Basecamp — My Plate</title>
  </head>
  <body>
    <div id="root">Loading…</div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Create `src/modules/mcp/ui/my-plate/src/main.ts`:
```ts
// Placeholder. Replaced in Task 7.
document.getElementById('root')!.textContent = 'My Plate — initializing…';
```

- [ ] **Step 1.7: Update `package.json` scripts**

Replace the `scripts` block with:
```json
"scripts": {
  "dev": "tsx watch --inspect src/index.ts",
  "build": "tsc && npm run build:ui && npm run copy-static",
  "build:ui": "vite build --config vite.config.ts",
  "copy-static": "mkdir -p dist/static && cp -r src/static/* dist/static/ 2>/dev/null || true",
  "start": "node dist/index.js",
  "test": "NODE_OPTIONS=--experimental-vm-modules jest",
  "lint": "eslint src/",
  "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.ui.json",
  "clean": "rm -rf dist",
  "dev-reset-db": "tsx scripts/dev-reset-db.ts"
}
```

Key changes: `build` now calls `build:ui`; `typecheck` now runs both configs; new `build:ui` script.

- [ ] **Step 1.8: Verify scaffolding**

Run:
```bash
npm run typecheck && npm run build && ls -la dist/ui/
```
Expected:
- Both typecheck invocations exit 0.
- `npm run build` exits 0.
- `dist/ui/my-plate.html` exists (singlefile emits the file under the entry's basename — hence the `my-plate.html` source name).
- Existing tests still pass: `npm test` → all green.

If `dist/ui/my-plate.html` is missing, inspect Vite's stdout: Rollup may have written to a different filename. Verify by listing `dist/ui/` and, if needed, check `vite-plugin-singlefile`'s version-specific output naming docs.

- [ ] **Step 1.9: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.ui.json vite.config.ts \
  src/modules/mcp/ui/my-plate/
git commit -m "build: scaffold MCP App build pipeline for my-plate

Vite + vite-plugin-singlefile bundles src/modules/mcp/ui/my-plate/
into a single dist/ui/my-plate.html. New tsconfig.ui.json for DOM-aware
compilation. Adds @modelcontextprotocol/ext-apps runtime dep and jsdom
test env as prep for the my-plate tool and UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Shared types for the API response and the UI payload

Define the types the server and UI both need: the raw Basecamp assignment shape, the scope enum, the normalized `Todo`/`Group`/`Payload` types rendered by the UI. Types only — no tests needed.

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 2.1: Append types to `src/lib/types.ts`**

Add at the end of `src/lib/types.ts`:
```ts
// ─── /my/assignments.json (MCP App: basecamp_my_plate) ──────────────────

/** Shape of one entry in /my/assignments.json priorities/non_priorities. */
export interface BasecampAssignment {
  id: number;
  content: string;
  type: string; // "todo" | "Todo" | "CardTable::Card::Step" | …
  app_url: string;
  due_on: string | null;
  starts_on: string | null;
  completed: boolean;
  bucket: { id: number; name: string; app_url: string };
  parent: { id: number; title: string; app_url: string };
  assignees: Array<{ id: number; name: string }>;
  comments_count: number;
  has_description: boolean;
}

export interface BasecampMyAssignmentsResponse {
  priorities: BasecampAssignment[];
  non_priorities: BasecampAssignment[];
}

/** Scopes accepted by basecamp_my_plate — mirrors the Basecamp endpoints. */
export type MyPlateScope =
  | 'open'
  | 'completed'
  | 'overdue'
  | 'due_today'
  | 'due_tomorrow'
  | 'due_later_this_week'
  | 'due_next_week'
  | 'due_later';

/** Normalized todo used by the rendered payload. */
export interface NormalizedTodo {
  id: number;
  type: string;
  content: string;
  dueOn: string | null;
  completed: boolean;
  priority: boolean;
  commentsCount: number;
  appUrl: string;
  assignees: Array<{ id: number; name: string }>;
  /** project_id — derived from bucket.id, used to invoke basecamp_complete_todo. */
  projectId: number;
}

export interface NormalizedList {
  listId: number;
  title: string;
  appUrl: string;
  todos: NormalizedTodo[];
}

export interface NormalizedGroup {
  bucketId: number;
  bucketName: string;
  appUrl: string;
  lists: NormalizedList[];
}

/** Payload produced by basecamp_my_plate; consumed by the UI renderer. */
export interface MyPlatePayload {
  scope: MyPlateScope;
  priorities: NormalizedTodo[];
  groups: NormalizedGroup[];
  /** Count of items surfaced by /my/assignments that were filtered out
   *  (non-"todo" types; e.g. card steps). For the LLM's text summary. */
  filteredNonTodoCount: number;
  fetchedAt: string; // ISO
}

/** Tool error surface — populated instead of groups/priorities on API failure. */
export interface MyPlateErrorPayload {
  scope: MyPlateScope;
  error: { message: string; retryAfterSec?: number };
  fetchedAt: string;
}
```

- [ ] **Step 2.2: Verify types compile**

Run:
```bash
npm run typecheck
```
Expected: both tsc invocations exit 0.

- [ ] **Step 2.3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add shared types for basecamp_my_plate payload

BasecampAssignment mirrors /my/assignments.json entries; MyPlateScope is
the cross-endpoint scope enum; MyPlatePayload is the normalized shape
consumed by the iframe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `getMyAssignments` API wrapper (TDD)

Adds the sole new server-side API call. Maps `scope` to one of three endpoints and normalizes the response. No tool yet; this is testable in isolation.

**Files:**
- Modify: `src/modules/mcp/tools/basecamp-api.ts`
- Modify: `src/modules/mcp/tools/basecamp-api.test.ts`

- [ ] **Step 3.1: Write failing tests**

Append to `src/modules/mcp/tools/basecamp-api.test.ts`:
```ts
import { getMyAssignments } from './basecamp-api.js';
import type { BasecampMyAssignmentsResponse } from '../../../lib/types.js';

describe('getMyAssignments', () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const sampleTodo = {
    id: 1,
    content: 'Ship auth flow',
    type: 'Todo',
    app_url: 'https://3.basecamp.com/9999/buckets/1/todos/1',
    due_on: '2026-04-22',
    starts_on: null,
    completed: false,
    bucket: { id: 10, name: 'Basecamp MCP Server', app_url: 'b' },
    parent: { id: 100, title: 'Bugs', app_url: 'l' },
    assignees: [{ id: 42, name: 'Me' }],
    comments_count: 3,
    has_description: false,
  };

  test('scope "open" hits /my/assignments.json and flattens priorities+non_priorities', async () => {
    const body: BasecampMyAssignmentsResponse = {
      priorities: [{ ...sampleTodo, id: 1 }],
      non_priorities: [{ ...sampleTodo, id: 2 }],
    };
    fetchMock.mockResolvedValueOnce(makeResponse({ body }));
    const out = await getMyAssignments(makeCtx(), 'open');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://3.basecampapi.com/9999/my/assignments.json',
    );
    expect(out.map((a) => a.id)).toEqual([1, 2]);
    expect(out[0].priority).toBe(true);
    expect(out[1].priority).toBe(false);
  });

  test('scope "completed" hits /my/assignments/completed.json; all priority=false', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ body: [{ ...sampleTodo, completed: true }] }),
    );
    const out = await getMyAssignments(makeCtx(), 'completed');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://3.basecampapi.com/9999/my/assignments/completed.json',
    );
    expect(out).toHaveLength(1);
    expect(out[0].priority).toBe(false);
    expect(out[0].completed).toBe(true);
  });

  test('scope "overdue" hits /my/assignments/due.json?scope=overdue', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ body: [sampleTodo] }));
    await getMyAssignments(makeCtx(), 'overdue');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://3.basecampapi.com/9999/my/assignments/due.json?scope=overdue',
    );
  });

  test('scope "due_today" hits /my/assignments/due.json?scope=due_today', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ body: [] }));
    await getMyAssignments(makeCtx(), 'due_today');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://3.basecampapi.com/9999/my/assignments/due.json?scope=due_today',
    );
  });

  test('preserves raw Basecamp fields on each normalized assignment', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        body: {
          priorities: [],
          non_priorities: [sampleTodo],
        } as BasecampMyAssignmentsResponse,
      }),
    );
    const [a] = await getMyAssignments(makeCtx(), 'open');
    expect(a.id).toBe(1);
    expect(a.content).toBe('Ship auth flow');
    expect(a.bucket.id).toBe(10);
    expect(a.parent.id).toBe(100);
    expect(a.assignees).toEqual([{ id: 42, name: 'Me' }]);
    expect(a.priority).toBe(false);
  });
});
```

- [ ] **Step 3.2: Run tests; confirm they fail**

Run:
```bash
npm test -- tools/basecamp-api.test.ts
```
Expected: FAIL — `getMyAssignments is not a function` (or similar import error).

- [ ] **Step 3.3: Implement `getMyAssignments`**

Append to `src/modules/mcp/tools/basecamp-api.ts`:
```ts
import type {
  BasecampAssignment,
  BasecampMyAssignmentsResponse,
  MyPlateScope,
} from '../../../lib/types.js';

/** `BasecampAssignment` + a `priority` flag derived from the priorities array. */
export type MyPlateAssignment = BasecampAssignment & { priority: boolean };

const DUE_SCOPES = new Set<MyPlateScope>([
  'overdue',
  'due_today',
  'due_tomorrow',
  'due_later_this_week',
  'due_next_week',
  'due_later',
]);

/**
 * Fetch the authenticated user's assignments, scoped by `scope`:
 *   - "open"      → GET /my/assignments.json             (priorities + non_priorities)
 *   - "completed" → GET /my/assignments/completed.json   (flat array)
 *   - any "due_*" → GET /my/assignments/due.json?scope=X (flat array)
 *
 * Returns a flat array of BasecampAssignment + {priority} tag. Callers handle
 * the UI-shape normalization (grouping by bucket/parent).
 */
export async function getMyAssignments(
  ctx: BasecampContext,
  scope: MyPlateScope,
): Promise<MyPlateAssignment[]> {
  if (scope === 'open') {
    const body = await bcFetch<BasecampMyAssignmentsResponse>(
      ctx,
      '/my/assignments.json',
    );
    const priorities = (body.priorities ?? []).map((a) => ({ ...a, priority: true }));
    const rest = (body.non_priorities ?? []).map((a) => ({ ...a, priority: false }));
    return [...priorities, ...rest];
  }
  if (scope === 'completed') {
    const body = await bcFetch<BasecampAssignment[]>(
      ctx,
      '/my/assignments/completed.json',
    );
    return (body ?? []).map((a) => ({ ...a, priority: false }));
  }
  if (DUE_SCOPES.has(scope)) {
    const body = await bcFetch<BasecampAssignment[]>(
      ctx,
      `/my/assignments/due.json?scope=${scope}`,
    );
    return (body ?? []).map((a) => ({ ...a, priority: false }));
  }
  // Type narrowing — all MyPlateScope cases handled above.
  const _exhaustive: never = scope;
  throw new Error(`Unknown scope: ${String(_exhaustive)}`);
}
```

- [ ] **Step 3.4: Run tests; confirm they pass**

Run:
```bash
npm test -- tools/basecamp-api.test.ts
```
Expected: all new tests pass; existing tests still pass.

- [ ] **Step 3.5: Commit**

```bash
git add src/modules/mcp/tools/basecamp-api.ts src/modules/mcp/tools/basecamp-api.test.ts
git commit -m "feat: add getMyAssignments API wrapper

Maps MyPlateScope to /my/assignments(.json|/completed.json|/due.json?scope=…)
and returns a flat list of assignments tagged with a priority boolean.
Basis for the basecamp_my_plate tool.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `basecamp_my_plate` tool handler (TDD)

Registers the MCP App tool using `registerAppTool` from ext-apps. Normalizes the flat assignments into the grouped `MyPlatePayload` shape. Returns both a text summary (for non-App hosts and the model's transcript) and `structuredContent` (for the iframe).

**Files:**
- Modify: `src/modules/mcp/tools/query-tools.ts`
- Create: `src/modules/mcp/tools/my-plate.test.ts`

- [ ] **Step 4.1: Write failing tests**

Tests call the pure `handleMyPlate(args, ctx)` function directly — no
McpServer instantiation, no reaching into SDK private state, no module
mocking. Fetch is mocked globally, matching the existing `basecamp-api.test.ts`
pattern (which is ESM-safe — the project runs Jest with
`NODE_OPTIONS=--experimental-vm-modules`, where CommonJS `require()` and
module-level `jest.mock` don't work cleanly).

Create `src/modules/mcp/tools/my-plate.test.ts`:
```ts
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import type { BasecampContext } from './auth-context.js';
import { handleMyPlate } from './query-tools.js';
import type { MyPlatePayload, MyPlateErrorPayload } from '../../../lib/types.js';

const originalFetch = globalThis.fetch;

function makeCtx(): BasecampContext {
  return {
    identityId: 1,
    accountId: 9999,
    flowId: 'flow-1',
    apiBaseUrl: 'https://3.basecampapi.com/9999',
    getAccessToken: async () => 'bearer-token',
  };
}

function makeResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return {
    status,
    statusText: 'OK',
    headers: new Headers(headers),
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('handleMyPlate', () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('default scope "open" returns grouped MyPlatePayload', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        priorities: [
          {
            id: 1, content: 'Ship auth flow', type: 'Todo', app_url: 'u',
            due_on: '2026-04-22', starts_on: null, completed: false,
            bucket: { id: 10, name: 'Project A', app_url: 'a' },
            parent: { id: 100, title: 'Bugs', app_url: 'l' },
            assignees: [], comments_count: 0, has_description: false,
          },
        ],
        non_priorities: [
          {
            id: 2, content: 'Doc OAuth', type: 'Todo', app_url: 'u2',
            due_on: null, starts_on: null, completed: false,
            bucket: { id: 10, name: 'Project A', app_url: 'a' },
            parent: { id: 101, title: 'Docs', app_url: 'l2' },
            assignees: [], comments_count: 1, has_description: false,
          },
        ],
      }),
    );

    const result = await handleMyPlate({}, makeCtx());

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as unknown as MyPlatePayload;
    expect(sc.scope).toBe('open');
    expect(sc.priorities).toHaveLength(1);
    expect(sc.priorities[0].id).toBe(1);
    expect(sc.groups).toHaveLength(1);
    expect(sc.groups[0].bucketName).toBe('Project A');
    expect(sc.groups[0].lists).toHaveLength(2);
    const firstContent = result.content?.[0] as { text: string } | undefined;
    expect(firstContent?.text).toMatch(/open.*2 items.*1 priorit/i);
  });

  test('non-todo types are filtered and counted in filteredNonTodoCount', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        priorities: [],
        non_priorities: [
          {
            id: 1, content: 'step', type: 'CardTable::Card::Step',
            app_url: 'u', due_on: null, starts_on: null, completed: false,
            bucket: { id: 10, name: 'A', app_url: '' },
            parent: { id: 1, title: 'L', app_url: '' },
            assignees: [], comments_count: 0, has_description: false,
          },
          {
            id: 2, content: 'todo', type: 'Todo',
            app_url: 'u', due_on: null, starts_on: null, completed: false,
            bucket: { id: 10, name: 'A', app_url: '' },
            parent: { id: 1, title: 'L', app_url: '' },
            assignees: [], comments_count: 0, has_description: false,
          },
        ],
      }),
    );
    const result = await handleMyPlate({}, makeCtx());
    const sc = result.structuredContent as unknown as MyPlatePayload;
    expect(sc.filteredNonTodoCount).toBe(1);
    expect(sc.groups[0].lists[0].todos).toHaveLength(1);
    expect(sc.groups[0].lists[0].todos[0].id).toBe(2);
  });

  test('scope "overdue" hits the due.json endpoint', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse([]));
    await handleMyPlate({ scope: 'overdue' }, makeCtx());
    expect(fetchMock.mock.calls[0][0]).toMatch(/due\.json\?scope=overdue$/);
  });

  test('BasecampApiError renders MyPlateErrorPayload as structuredContent', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ error: 'boom' }, 500));
    const result = await handleMyPlate({}, makeCtx());
    const sc = result.structuredContent as unknown as MyPlateErrorPayload;
    expect(result.isError).toBe(true);
    expect(sc.error).toBeDefined();
    expect(sc.error.message).toMatch(/.+/);
  });

  test('429 surfaces retryAfterSec on the error payload', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ error: 'rate' }, 429, { 'Retry-After': '30' }),
    );
    const result = await handleMyPlate({}, makeCtx());
    const sc = result.structuredContent as unknown as MyPlateErrorPayload;
    expect(sc.error.retryAfterSec).toBe(30);
  });
});
```

- [ ] **Step 4.2: Run tests; confirm they fail**

Run:
```bash
npm test -- tools/my-plate.test.ts
```
Expected: FAIL — `handleMyPlate is not exported` (or similar import error).

- [ ] **Step 4.3: Implement the tool**

First add the helper normalization + error mapping, then register the tool.

Add to `src/modules/mcp/tools/utils.ts`. The new imports go in the existing
top-of-file import block (merge with the existing type imports); the new
functions are appended to the bottom of the file.

Imports to add at top of `utils.ts`:
```ts
import type {
  MyPlatePayload,
  MyPlateErrorPayload,
  MyPlateScope,
  NormalizedTodo,
  NormalizedGroup,
  NormalizedList,
} from '../../../lib/types.js';
import type { MyPlateAssignment } from './basecamp-api.js';
```

Functions to append at end of `utils.ts`:
```ts

/**
 * Group MyPlateAssignments into {priorities, groups[{lists[{todos}]}]}.
 * Filters out non-"Todo" types; returns the filtered count.
 */
export function normalizeMyPlate(
  assignments: MyPlateAssignment[],
  scope: MyPlateScope,
): MyPlatePayload {
  const todos: MyPlateAssignment[] = [];
  let filteredNonTodoCount = 0;
  for (const a of assignments) {
    if (a.type === 'Todo' || a.type === 'todo') {
      todos.push(a);
    } else {
      filteredNonTodoCount += 1;
    }
  }

  const toNormalized = (a: MyPlateAssignment): NormalizedTodo => ({
    id: a.id,
    type: a.type,
    content: a.content,
    dueOn: a.due_on,
    completed: a.completed,
    priority: a.priority,
    commentsCount: a.comments_count,
    appUrl: a.app_url,
    assignees: a.assignees,
    projectId: a.bucket.id,
  });

  const priorities = todos.filter((a) => a.priority).map(toNormalized);

  // Group by bucket, then by parent (todolist).
  const buckets = new Map<number, NormalizedGroup>();
  for (const a of todos) {
    const bucket = buckets.get(a.bucket.id) ?? {
      bucketId: a.bucket.id,
      bucketName: a.bucket.name,
      appUrl: a.bucket.app_url,
      lists: [] as NormalizedList[],
    };
    let list = bucket.lists.find((l) => l.listId === a.parent.id);
    if (!list) {
      list = {
        listId: a.parent.id,
        title: a.parent.title,
        appUrl: a.parent.app_url,
        todos: [],
      };
      bucket.lists.push(list);
    }
    list.todos.push(toNormalized(a));
    buckets.set(a.bucket.id, bucket);
  }

  return {
    scope,
    priorities,
    groups: Array.from(buckets.values()),
    filteredNonTodoCount,
    fetchedAt: new Date().toISOString(),
  };
}

/** Produce a short human-readable summary for the model's transcript. */
export function myPlateSummary(p: MyPlatePayload): string {
  const total = p.groups.reduce(
    (n, g) => n + g.lists.reduce((m, l) => m + l.todos.length, 0),
    0,
  );
  const projectCount = p.groups.length;
  const pri = p.priorities.length;
  const filteredNote =
    p.filteredNonTodoCount > 0
      ? ` (${p.filteredNonTodoCount} non-todo items filtered)`
      : '';
  return `My plate — scope=${p.scope}, ${total} items across ${projectCount} project${
    projectCount === 1 ? '' : 's'
  }, ${pri} priorit${pri === 1 ? 'y' : 'ies'}${filteredNote}.`;
}

/** Map a thrown error into MyPlateErrorPayload. */
export function toMyPlateError(
  err: unknown,
  scope: MyPlateScope,
): { result: import('@modelcontextprotocol/sdk/types.js').CallToolResult } {
  let message = 'Unknown error';
  let retryAfterSec: number | undefined;
  if (err instanceof BasecampRateLimitError) {
    message = `Basecamp rate limit hit.`;
    retryAfterSec = err.retryAfterSec;
  } else if (err instanceof BasecampAuthError) {
    message = `Basecamp connector needs to be reconnected: ${err.message}`;
  } else if (err instanceof BasecampNotFoundError) {
    message = 'Basecamp resource not found';
  } else if (err instanceof BasecampApiError) {
    message = `Basecamp API error (${err.status}): ${err.message}`;
  } else if (err instanceof Error) {
    message = err.message;
  }
  const payload: MyPlateErrorPayload = {
    scope,
    error: retryAfterSec === undefined ? { message } : { message, retryAfterSec },
    fetchedAt: new Date().toISOString(),
  };
  return {
    result: {
      isError: true,
      content: [{ type: 'text' as const, text: message }],
      structuredContent: payload as unknown as Record<string, unknown>,
    },
  };
}
```

Now modify `src/modules/mcp/tools/query-tools.ts`.

Add to the top (after existing imports):
```ts
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getMyAssignments } from './basecamp-api.js';
import {
  normalizeMyPlate,
  myPlateSummary,
  toMyPlateError,
} from './utils.js';
import type { BasecampContext } from './auth-context.js';
import type { MyPlateScope } from '../../../lib/types.js';

const MY_PLATE_RESOURCE_URI = 'ui://basecamp/my-plate';
```

Export the pure handler (above `registerQueryTools`, at module scope so tests
can import it directly):
```ts
/**
 * Pure handler for basecamp_my_plate. Takes args + a constructed
 * BasecampContext, returns a CallToolResult. Exported so tests can call it
 * without instantiating an McpServer or reaching into SDK internals. The
 * registered MCP tool handler is a thin wrapper that derives `ctx` from
 * `extra.authInfo.extra`.
 */
export async function handleMyPlate(
  args: { scope?: MyPlateScope },
  ctx: BasecampContext,
): Promise<CallToolResult> {
  const scope: MyPlateScope = args.scope ?? 'open';
  try {
    const raw = await getMyAssignments(ctx, scope);
    const payload = normalizeMyPlate(raw, scope);
    return {
      content: [{ type: 'text' as const, text: myPlateSummary(payload) }],
      structuredContent: payload as unknown as Record<string, unknown>,
    };
  } catch (err) {
    return toMyPlateError(err, scope).result;
  }
}
```

At the very end of `registerQueryTools` (before its closing brace), add the
tool registration:
```ts
  // ─── basecamp_my_plate (MCP App) ─────────────────────────────────────
  //
  // No outputSchema: MyPlatePayload has a deeply-nested, partially-recursive
  // shape (groups → lists → todos) that's cumbersome to express in zod.
  // Type-level enforcement + the consuming UI treating it as a contract is
  // sufficient for v1. Other tools in this file declare outputSchemas for
  // flat return shapes; we deviate intentionally here.
  registerAppTool(
    server,
    'basecamp_my_plate',
    {
      title: "What's on my plate",
      description: `Show todos assigned to the authenticated user across all projects as an interactive MCP App.

Args:
  - scope ('open'|'completed'|'overdue'|'due_today'|'due_tomorrow'|'due_later_this_week'|'due_next_week'|'due_later'), default 'open'.

Returns:
  MCP App UI (grouped by project, priorities pinned, clickable scope tabs, inline complete)
  plus a text summary for transcript use.

Examples:
  - "What's on my plate?" → scope=open
  - "What's overdue?" → scope=overdue
  - "What did I finish this week?" → scope=completed`,
      inputSchema: z
        .object({
          scope: z
            .enum([
              'open',
              'completed',
              'overdue',
              'due_today',
              'due_tomorrow',
              'due_later_this_week',
              'due_next_week',
              'due_later',
            ])
            .default('open')
            .describe("Assignment bucket to query; 'open' is all active, others map to Basecamp due/completed endpoints."),
        })
        .strict().shape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      _meta: { ui: { resourceUri: MY_PLATE_RESOURCE_URI } },
    },
    async (args, extra) => {
      const ctx = getBasecampCtx(extra.authInfo?.extra);
      return handleMyPlate(args as { scope?: MyPlateScope }, ctx);
    },
  );
```

- [ ] **Step 4.4: Run tests**

Run:
```bash
npm test -- tools/my-plate.test.ts
```
Expected: all 5 tests pass.

- [ ] **Step 4.5: Run the full test suite**

Run:
```bash
npm test && npm run typecheck
```
Expected: all green.

- [ ] **Step 4.6: Commit**

```bash
git add src/modules/mcp/tools/query-tools.ts \
        src/modules/mcp/tools/utils.ts \
        src/modules/mcp/tools/my-plate.test.ts
git commit -m "feat: add basecamp_my_plate MCP App tool

Wraps /my/assignments endpoints, normalizes into {priorities, groups},
and registers via registerAppTool with _meta.ui.resourceUri pointing at
ui://basecamp/my-plate. Non-todo assignment types are filtered.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: UI resource registration

Register `ui://basecamp/my-plate` so the host can fetch the bundled HTML when the tool fires. Reads `dist/ui/my-plate.html` once at startup into memory; fail-fast if the build artifact is missing.

**Files:**
- Create: `src/modules/mcp/tools/resources.ts`
- Modify: `src/modules/mcp/services/mcp.ts`

- [ ] **Step 5.1: Create `resources.ts`**

Create `src/modules/mcp/tools/resources.ts`:
```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { logger } from '../../shared/logger.js';

const MY_PLATE_URI = 'ui://basecamp/my-plate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load and cache the bundled my-plate HTML at module-init time. Throws if
 * the Vite build hasn't run — keeps production surprises loud.
 */
function loadMyPlateHtml(): string {
  // At runtime, this file lives in dist/modules/mcp/tools/resources.js; walk
  // up to dist/, then into dist/ui/.
  const candidate = path.resolve(__dirname, '..', '..', '..', 'ui', 'my-plate.html');
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `my-plate UI bundle missing at ${candidate}; run \`npm run build:ui\` first.`,
    );
  }
  const html = fs.readFileSync(candidate, 'utf8');
  logger.debug('Loaded my-plate UI bundle', { bytes: String(html.length) });
  return html;
}

let myPlateHtmlCache: string | null = null;

export function registerUiResources(server: McpServer): void {
  if (myPlateHtmlCache === null) {
    myPlateHtmlCache = loadMyPlateHtml();
  }
  const html = myPlateHtmlCache;

  registerAppResource(
    server,
    MY_PLATE_URI,
    MY_PLATE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [{ uri: MY_PLATE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
    }),
  );
}
```

Note on the `..`-walk: the server file is emitted at `dist/modules/mcp/tools/resources.js`. Four levels up lands at `dist/`, then `ui/my-plate.html`. Verify the relative path in Step 5.3.

- [ ] **Step 5.2: Wire into `createMcpServer`**

Modify `src/modules/mcp/services/mcp.ts`:
```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerQueryTools } from '../tools/query-tools.js';
import { registerActionTools } from '../tools/action-tools.js';
import { registerUiResources } from '../tools/resources.js';

export interface McpServerWrapper {
  server: McpServer;
  cleanup: () => void;
}

export function createMcpServer(): McpServerWrapper {
  const server = new McpServer({
    name: 'basecamp-mcp-server',
    version: '0.1.0',
  });

  registerQueryTools(server);
  registerActionTools(server);
  registerUiResources(server);

  return { server, cleanup: () => {} };
}
```

- [ ] **Step 5.3: Verify the bundle path resolution**

Run:
```bash
npm run build && node --input-type=module -e "
  import path from 'node:path';
  import { fileURLToPath } from 'node:url';
  const here = fileURLToPath(new URL('./dist/modules/mcp/tools/resources.js', import.meta.url));
  const bundle = path.resolve(path.dirname(here), '..', '..', '..', 'ui', 'my-plate.html');
  console.log('resolved:', bundle);
  console.log('exists:', (await import('node:fs')).existsSync(bundle));
"
```
Expected: `exists: true`. If `false`, either the Vite output filename differs (check `dist/ui/`) or the `..`-walk count is wrong — adjust the `candidate` path in `resources.ts` accordingly.

- [ ] **Step 5.4: Start server and smoke-test**

Run:
```bash
npm run build && node dist/index.js &
sleep 2
# Expect the server to boot without error; no HTTP request needed at this step.
kill %1
```
Expected: server boots; no `my-plate UI bundle missing` error. If it errors, the bundle path is wrong — fix Step 5.1's `candidate` path and retry.

- [ ] **Step 5.5: Run typecheck and tests**

Run:
```bash
npm run typecheck && npm test
```
Expected: all green.

- [ ] **Step 5.6: Commit**

```bash
git add src/modules/mcp/tools/resources.ts src/modules/mcp/services/mcp.ts
git commit -m "feat: register ui://basecamp/my-plate resource

Loads the Vite bundle from dist/ui/my-plate.html at server init (fail-fast
if absent) and exposes it via registerAppResource. Paired with the
basecamp_my_plate tool's _meta.ui.resourceUri, this completes the
MCP App server surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: UI render function (TDD, jsdom)

A pure `render(container, payload, callbacks)` that paints the grouped list into the DOM. Testable in isolation without the `App` bridge — `main.ts` is the glue in Task 7.

**Files:**
- Create: `src/modules/mcp/ui/my-plate/src/types.ts`
- Create: `src/modules/mcp/ui/my-plate/src/render.ts`
- Create: `src/modules/mcp/ui/my-plate/src/render.test.ts`

- [ ] **Step 6.1: Create the UI-only types**

Create `src/modules/mcp/ui/my-plate/src/types.ts`:
```ts
import type { MyPlateScope } from '../../../../../lib/types.js';

export interface RenderCallbacks {
  onScopeChange: (next: MyPlateScope) => void;
  onCompleteTodo: (projectId: number, todoId: number) => void;
}

export type ScopeTabId = MyPlateScope;

export const SCOPE_TABS: Array<{ id: ScopeTabId; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'due_today', label: 'Today' },
  { id: 'due_tomorrow', label: 'Tomorrow' },
  { id: 'due_later_this_week', label: 'This week' },
  { id: 'due_next_week', label: 'Next week' },
  { id: 'due_later', label: 'Later' },
  { id: 'completed', label: 'Completed' },
];
```

- [ ] **Step 6.2: Write the failing tests**

Create `src/modules/mcp/ui/my-plate/src/render.test.ts`:
```ts
/** @jest-environment jsdom */
import { describe, test, expect, jest } from '@jest/globals';
import { render } from './render.js';
import type { RenderCallbacks } from './types.js';
import type { MyPlatePayload, MyPlateErrorPayload } from '../../../../../lib/types.js';

function makeCallbacks(): RenderCallbacks {
  return {
    onScopeChange: jest.fn(),
    onCompleteTodo: jest.fn(),
  };
}

function makePayload(overrides: Partial<MyPlatePayload> = {}): MyPlatePayload {
  return {
    scope: 'open',
    priorities: [],
    groups: [],
    filteredNonTodoCount: 0,
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('render', () => {
  test('renders empty state when no todos', () => {
    const root = document.createElement('div');
    render(root, makePayload(), makeCallbacks());
    expect(root.textContent).toMatch(/caught up|nothing on your plate|empty/i);
  });

  test('renders priorities section at the top with a priority star', () => {
    const root = document.createElement('div');
    render(
      root,
      makePayload({
        priorities: [
          {
            id: 1,
            type: 'Todo',
            content: 'Ship it',
            dueOn: '2026-04-22',
            completed: false,
            priority: true,
            commentsCount: 0,
            appUrl: 'u',
            assignees: [],
            projectId: 10,
          },
        ],
      }),
      makeCallbacks(),
    );
    const prio = root.querySelector('[data-section="priorities"]');
    expect(prio).not.toBeNull();
    expect(prio!.textContent).toContain('Ship it');
  });

  test('renders one group section per project with nested lists and todos', () => {
    const root = document.createElement('div');
    render(
      root,
      makePayload({
        groups: [
          {
            bucketId: 10,
            bucketName: 'Project A',
            appUrl: '',
            lists: [
              {
                listId: 1,
                title: 'Bugs',
                appUrl: '',
                todos: [
                  {
                    id: 1,
                    type: 'Todo',
                    content: 'Fix login',
                    dueOn: null,
                    completed: false,
                    priority: false,
                    commentsCount: 0,
                    appUrl: 'u',
                    assignees: [],
                    projectId: 10,
                  },
                ],
              },
            ],
          },
        ],
      }),
      makeCallbacks(),
    );
    const groups = root.querySelectorAll('[data-section="group"]');
    expect(groups).toHaveLength(1);
    expect(groups[0].textContent).toContain('Project A');
    expect(groups[0].textContent).toContain('Bugs');
    expect(groups[0].textContent).toContain('Fix login');
  });

  test('clicking a checkbox invokes onCompleteTodo with (projectId, todoId)', () => {
    const root = document.createElement('div');
    const cbs = makeCallbacks();
    render(
      root,
      makePayload({
        groups: [
          {
            bucketId: 10,
            bucketName: 'A',
            appUrl: '',
            lists: [
              {
                listId: 1,
                title: 'L',
                appUrl: '',
                todos: [
                  {
                    id: 42,
                    type: 'Todo',
                    content: 'do',
                    dueOn: null,
                    completed: false,
                    priority: false,
                    commentsCount: 0,
                    appUrl: '',
                    assignees: [],
                    projectId: 10,
                  },
                ],
              },
            ],
          },
        ],
      }),
      cbs,
    );
    const box = root.querySelector<HTMLInputElement>('input[type="checkbox"][data-todo-id="42"]');
    expect(box).not.toBeNull();
    box!.click();
    expect(cbs.onCompleteTodo).toHaveBeenCalledWith(10, 42);
  });

  test('clicking a scope tab invokes onScopeChange', () => {
    const root = document.createElement('div');
    const cbs = makeCallbacks();
    render(root, makePayload(), cbs);
    const tab = root.querySelector<HTMLElement>('[data-scope-tab="overdue"]');
    expect(tab).not.toBeNull();
    tab!.click();
    expect(cbs.onScopeChange).toHaveBeenCalledWith('overdue');
  });

  test('error payload renders error card, no todo list', () => {
    const root = document.createElement('div');
    const err: MyPlateErrorPayload = {
      scope: 'open',
      error: { message: 'Basecamp rate limit hit.', retryAfterSec: 30 },
      fetchedAt: new Date().toISOString(),
    };
    render(root, err, makeCallbacks());
    expect(root.querySelector('[data-section="error"]')).not.toBeNull();
    expect(root.textContent).toContain('Basecamp rate limit hit.');
    expect(root.textContent).toContain('30');
    expect(root.querySelectorAll('[data-section="group"]')).toHaveLength(0);
  });

  test('active scope tab has aria-current="page"', () => {
    const root = document.createElement('div');
    render(root, makePayload({ scope: 'completed' }), makeCallbacks());
    const active = root.querySelector('[data-scope-tab="completed"]');
    expect(active?.getAttribute('aria-current')).toBe('page');
  });
});
```

- [ ] **Step 6.3: Add a jest project for the UI tests**

The existing Jest config runs tests under Node. The render test uses jsdom via `/** @jest-environment jsdom */`. Verify this works by checking `jest.config.cjs` or `jest.config.js` (whichever exists):

Run:
```bash
cat jest.config.* 2>/dev/null || grep -A 20 '"jest"' package.json
```

If the config uses `testEnvironment: 'node'` globally, the per-file pragma overrides it, but the jsdom environment must be available. `jest-environment-jsdom` was installed in Task 1.2; no further config needed unless a custom config rejects unknown env names.

If the test errors out with "Cannot find module 'jest-environment-jsdom'" or similar, edit the Jest config to add `testEnvironmentOptions` and confirm `jest-environment-jsdom` is in node_modules. Otherwise proceed.

- [ ] **Step 6.4: Run tests; confirm they fail**

Run:
```bash
npm test -- ui/my-plate/src/render.test.ts
```
Expected: FAIL — `render is not a function` (render.ts doesn't exist yet).

- [ ] **Step 6.5: Implement `render`**

Create `src/modules/mcp/ui/my-plate/src/render.ts`:
```ts
import type {
  MyPlatePayload,
  MyPlateErrorPayload,
  NormalizedTodo,
  NormalizedGroup,
  NormalizedList,
} from '../../../../../lib/types.js';
import type { RenderCallbacks } from './types.js';
import { SCOPE_TABS } from './types.js';

type Payload = MyPlatePayload | MyPlateErrorPayload;

function isError(p: Payload): p is MyPlateErrorPayload {
  return 'error' in p;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

function dueChip(dueOn: string | null): string {
  if (!dueOn) return '';
  const today = new Date();
  const due = new Date(dueOn + 'T00:00:00Z');
  const msDay = 24 * 60 * 60 * 1000;
  const diff = Math.floor((due.getTime() - today.getTime()) / msDay);
  let cls = 'chip chip-due';
  let label = dueOn;
  if (diff < 0) {
    cls += ' chip-overdue';
    label = `Overdue · ${dueOn}`;
  } else if (diff === 0) {
    cls += ' chip-today';
    label = 'Today';
  } else if (diff <= 7) {
    cls += ' chip-soon';
    label = dueOn;
  }
  return `<span class="${cls}">${escape(label)}</span>`;
}

function renderTodo(t: NormalizedTodo): string {
  const priorityStar = t.priority ? '<span class="star" title="Priority">★</span>' : '';
  const due = dueChip(t.dueOn);
  const comments =
    t.commentsCount > 0
      ? `<span class="chip chip-comments" title="${t.commentsCount} comments">💬 ${t.commentsCount}</span>`
      : '';
  return `
    <div class="todo" data-todo-id="${t.id}" data-project-id="${t.projectId}">
      <input type="checkbox" data-todo-id="${t.id}" data-project-id="${t.projectId}"
        ${t.completed ? 'checked disabled' : ''} aria-label="Complete ${escape(t.content)}" />
      ${priorityStar}
      <a class="todo-content" href="${escape(t.appUrl)}" target="_blank" rel="noreferrer">
        ${escape(t.content)}
      </a>
      <span class="todo-meta">${due}${comments}</span>
    </div>`;
}

function renderList(l: NormalizedList): string {
  const header = `<div class="list-header">${escape(l.title)}</div>`;
  const body = l.todos.map(renderTodo).join('');
  return `<div class="list">${header}${body}</div>`;
}

function renderGroup(g: NormalizedGroup): string {
  const header = `<div class="group-header">${escape(g.bucketName)}</div>`;
  const lists = g.lists.map(renderList).join('');
  return `<div class="group" data-section="group">${header}${lists}</div>`;
}

function renderTabs(scope: MyPlatePayload['scope']): string {
  return `<nav class="tabs">
    ${SCOPE_TABS.map(
      (t) =>
        `<button type="button" class="tab" data-scope-tab="${t.id}"
          ${t.id === scope ? 'aria-current="page"' : ''}>${escape(t.label)}</button>`,
    ).join('')}
  </nav>`;
}

function renderEmpty(scope: MyPlatePayload['scope']): string {
  return `<div class="empty" data-section="empty">
    All caught up — nothing on your plate for scope <strong>${escape(scope)}</strong>.
  </div>`;
}

function renderError(p: MyPlateErrorPayload): string {
  const retry =
    p.error.retryAfterSec !== undefined
      ? ` (retry in ${p.error.retryAfterSec}s)`
      : '';
  return `<div class="error-card" data-section="error" role="alert">
    <strong>Something broke.</strong> ${escape(p.error.message)}${escape(retry)}
  </div>`;
}

/**
 * Paint the my-plate UI into `root`. Clears existing content.
 * Callbacks dispatch user intents — no tool calls happen here.
 */
export function render(
  root: HTMLElement,
  payload: Payload,
  callbacks: RenderCallbacks,
): void {
  if (isError(payload)) {
    root.innerHTML = renderTabs(payload.scope) + renderError(payload);
    wireTabs(root, callbacks);
    return;
  }

  const prioritiesSection =
    payload.priorities.length > 0
      ? `<div class="priorities" data-section="priorities">
          <div class="group-header">★ Priorities</div>
          ${payload.priorities.map(renderTodo).join('')}
        </div>`
      : '';

  const groupsHtml =
    payload.groups.length > 0 ? payload.groups.map(renderGroup).join('') : '';

  const noContent = payload.priorities.length === 0 && payload.groups.length === 0;

  root.innerHTML =
    renderTabs(payload.scope) +
    (noContent
      ? renderEmpty(payload.scope)
      : prioritiesSection + groupsHtml);

  wireTabs(root, callbacks);
  wireCheckboxes(root, callbacks);
}

function wireTabs(root: HTMLElement, callbacks: RenderCallbacks): void {
  root.querySelectorAll<HTMLButtonElement>('[data-scope-tab]').forEach((el) => {
    el.addEventListener('click', () => {
      const scope = el.dataset.scopeTab;
      if (scope) callbacks.onScopeChange(scope as MyPlatePayload['scope']);
    });
  });
}

function wireCheckboxes(root: HTMLElement, callbacks: RenderCallbacks): void {
  root
    .querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-todo-id]')
    .forEach((el) => {
      el.addEventListener('click', () => {
        const todoId = Number(el.dataset.todoId);
        const projectId = Number(el.dataset.projectId);
        if (Number.isFinite(todoId) && Number.isFinite(projectId)) {
          callbacks.onCompleteTodo(projectId, todoId);
        }
      });
    });
}
```

- [ ] **Step 6.6: Run tests; confirm they pass**

Run:
```bash
npm test -- ui/my-plate/src/render.test.ts
```
Expected: all pass.

- [ ] **Step 6.7: Commit**

```bash
git add src/modules/mcp/ui/my-plate/src/render.ts \
        src/modules/mcp/ui/my-plate/src/render.test.ts \
        src/modules/mcp/ui/my-plate/src/types.ts
git commit -m "feat: add my-plate render function + jsdom tests

Pure render(root, payload, callbacks) paints the grouped list, priorities
section, scope tabs, and error card. Callback-driven: no tool calls here.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: UI main — App bridge wiring

Owns the iframe's lifecycle: connects the `App` bridge, receives initial tool results, dispatches scope-switch and complete calls. Combines `render.ts` with `@modelcontextprotocol/ext-apps`'s `App` class.

**Files:**
- Modify: `src/modules/mcp/ui/my-plate/src/main.ts`
- Modify: `src/modules/mcp/ui/my-plate/index.html`

- [ ] **Step 7.1: Replace `main.ts` with the real bridge wiring**

Replace `src/modules/mcp/ui/my-plate/src/main.ts` with:
```ts
import { App } from '@modelcontextprotocol/ext-apps';
import { render } from './render.js';
import type { RenderCallbacks } from './types.js';
import type {
  MyPlatePayload,
  MyPlateErrorPayload,
  MyPlateScope,
} from '../../../../../lib/types.js';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

const app = new App({ name: 'Basecamp My Plate', version: '0.1.0' });

let lastScope: MyPlateScope = 'open';

const callbacks: RenderCallbacks = {
  onScopeChange: (next) => {
    lastScope = next;
    void app.callServerTool({ name: 'basecamp_my_plate', arguments: { scope: next } });
  },
  onCompleteTodo: (projectId, todoId) => {
    // Optimistic: remove the row immediately.
    const row = root.querySelector(`.todo[data-todo-id="${todoId}"]`);
    const placeholder = row?.cloneNode(true) as HTMLElement | undefined;
    row?.remove();

    void app
      .callServerTool({
        name: 'basecamp_complete_todo',
        arguments: { project_id: projectId, todo_id: todoId },
      })
      .then((result) => {
        if ((result as { isError?: boolean }).isError && placeholder) {
          // Restore and flash error.
          root.prepend(placeholder);
          toast(`Couldn't complete todo #${todoId}.`);
        }
      })
      .catch(() => {
        if (placeholder) root.prepend(placeholder);
        toast(`Couldn't complete todo #${todoId}.`);
      });
  },
};

app.ontoolresult = (result: unknown) => {
  const sc = (result as { structuredContent?: MyPlatePayload | MyPlateErrorPayload })
    .structuredContent;
  if (!sc) {
    render(
      root,
      {
        scope: lastScope,
        error: { message: 'Server returned no structured content.' },
        fetchedAt: new Date().toISOString(),
      },
      callbacks,
    );
    return;
  }
  lastScope = sc.scope;
  render(root, sc, callbacks);
};

window.addEventListener('error', (e) => {
  render(
    root,
    {
      scope: lastScope,
      error: { message: `UI error: ${e.message}` },
      fetchedAt: new Date().toISOString(),
    },
    callbacks,
  );
});

window.addEventListener('unhandledrejection', (e) => {
  const reason = (e.reason as { message?: string } | undefined)?.message ?? String(e.reason);
  render(
    root,
    {
      scope: lastScope,
      error: { message: `UI error: ${reason}` },
      fetchedAt: new Date().toISOString(),
    },
    callbacks,
  );
});

function toast(msg: string): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

app.connect();
```

- [ ] **Step 7.2: Update `my-plate.html` to include the stylesheet**

Replace `src/modules/mcp/ui/my-plate/my-plate.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Basecamp — My Plate</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <div id="root">Loading…</div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 7.3: Create `styles.css`**

Create `src/modules/mcp/ui/my-plate/src/styles.css`:
```css
:root {
  --bg: #ffffff;
  --fg: #111;
  --muted: #666;
  --border: #e5e5e5;
  --row-bg: #fafafa;
  --row-hover: #f0f0f0;
  --accent: #1f6feb;
  --danger: #c00;
  --warn: #e80;
  --chip-bg: #eef;
  --chip-fg: #339;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121212;
    --fg: #eaeaea;
    --muted: #9a9a9a;
    --border: #333;
    --row-bg: #1b1b1b;
    --row-hover: #222;
    --chip-bg: #1e2a55;
    --chip-fg: #aac;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 12px;
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--fg);
}
.tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
  margin-bottom: 10px;
}
.tab {
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: 6px 10px;
  border-radius: 14px;
  cursor: pointer;
  font-size: 12px;
}
.tab:hover { background: var(--row-hover); }
.tab[aria-current="page"] {
  background: var(--accent);
  color: #fff;
}
.group, .priorities {
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.group-header {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  padding: 6px 10px;
  background: var(--row-bg);
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}
.list-header {
  font-size: 11px;
  font-weight: 600;
  padding: 6px 10px;
  color: var(--muted);
}
.list { border-top: 1px solid var(--border); }
.list:first-child { border-top: 0; }
.todo {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid var(--border);
}
.todo:first-child { border-top: 0; }
.todo:hover { background: var(--row-hover); }
.todo-content {
  flex: 1;
  color: var(--fg);
  text-decoration: none;
}
.todo-content:hover { text-decoration: underline; }
.star { color: #e0c200; }
.todo-meta { display: flex; gap: 4px; }
.chip {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--chip-bg);
  color: var(--chip-fg);
}
.chip-overdue { background: #fee; color: var(--danger); }
.chip-today { background: #fef5e5; color: var(--warn); }
.chip-soon { background: #eef; color: var(--accent); }
.empty, .error-card {
  padding: 20px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--muted);
  text-align: center;
}
.error-card {
  border-color: var(--danger);
  color: var(--danger);
}
.toast {
  position: fixed;
  bottom: 12px;
  right: 12px;
  background: var(--danger);
  color: #fff;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  z-index: 100;
  opacity: 0.95;
}
```

- [ ] **Step 7.4: Build the UI and confirm the bundle is produced**

Run:
```bash
npm run build:ui && ls -la dist/ui/
```
Expected: `dist/ui/my-plate.html` exists, roughly 10–30 KB (all CSS + JS inlined by singlefile). Open the file in a browser to confirm no console errors on static load (iframe won't do much without a host, but the HTML should parse).

- [ ] **Step 7.5: Full typecheck and test**

Run:
```bash
npm run typecheck && npm test && npm run build
```
Expected: all green; the complete build pipeline succeeds end-to-end.

- [ ] **Step 7.6: Commit**

```bash
git add src/modules/mcp/ui/my-plate/
git commit -m "feat: wire my-plate UI to the App bridge

main.ts owns the App lifecycle: connect → ontoolresult → render with
scope-switch + complete callbacks. Complete uses optimistic row removal
with restore-on-error. CSS supports light/dark modes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Manual end-to-end smoke test + docs

Point the local server at the `ext-apps` basic-host (no Claude Desktop paid plan needed for local dev) and exercise the full flow: mount iframe, load plate, switch scopes, complete a todo. Then update the README.

**Files:**
- Modify: `README.md`

- [ ] **Step 8.1: Prepare local server**

Run:
```bash
# In one terminal
npm run dev-reset-db
npm run build && node dist/index.js
```
Expected: server listens on `:3232`.

Also ensure `.env` has a valid token vault row for your Basecamp account — either walk the OAuth flow in a browser, or use `scripts/seed-test-install.ts` (see README "Smoke test" section). If seeding, use `Authorization: Bearer test-token` when connecting from the host.

- [ ] **Step 8.2: Run the MCP Apps basic-host against the local server**

In a second terminal:
```bash
# Expose local server via cloudflared OR point basic-host directly at localhost
git clone https://github.com/modelcontextprotocol/ext-apps.git /tmp/ext-apps
cd /tmp/ext-apps/examples/basic-host
npm install
SERVERS='["http://localhost:3232/mcp"]' npm start
```
Expected: basic-host UI at `http://localhost:8080`.

Navigate to it. If the basic-host doesn't send an Authorization header, pass one via its connector config (check its README for how — it accepts bearer tokens in its SERVERS config, or via a form field). For local dev with the seeded install, use `test-token`.

- [ ] **Step 8.3: Exercise the tool**

In the basic-host:
- [ ] Select `basecamp_my_plate`, invoke with no args → verify the iframe mounts with the grouped list.
- [ ] Click the `Overdue` scope tab → verify a fresh tool call fires and the view updates.
- [ ] Click a todo's checkbox → verify the row disappears; verify the todo is marked complete in Basecamp (check via the web UI).
- [ ] Tear down the iframe and re-invoke → verify nothing is stale.
- [ ] Force an error: temporarily break the API base URL in `auth-context.ts` or mock a 500 response, verify the error card renders.

If any step fails, capture the failure mode, fix, commit, and re-test. Do not proceed until all five boxes above pass.

- [ ] **Step 8.4: Update the README**

Modify `README.md` — add a new section near the tool-list ("Smoke test" or equivalent):

```markdown
## MCP App: `basecamp_my_plate`

`basecamp_my_plate` is an interactive MCP App tool (spec
[MCP Apps 2026-01-26](https://modelcontextprotocol.io/extensions/apps/overview)).
When invoked, the host mounts a sandboxed iframe that shows the authenticated
user's open todos grouped by project, with scope tabs (Open / Completed /
Overdue / Due today / …) and inline complete. Clicking a scope tab or a
checkbox dispatches a tool call back through the host.

**Scopes:** `open` (default), `completed`, `overdue`, `due_today`,
`due_tomorrow`, `due_later_this_week`, `due_next_week`, `due_later`.

**UI bundle:** built by `npm run build:ui` (Vite + vite-plugin-singlefile) to
`dist/ui/my-plate.html`. Served as the resource `ui://basecamp/my-plate`.
`npm run build` builds both server and UI.

**Local smoke test:** run the server, then point the
[basic-host](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host)
at `http://localhost:3232/mcp`:

```bash
SERVERS='["http://localhost:3232/mcp"]' npm start  # from ext-apps/examples/basic-host
```

**Claude Desktop:** add the server as a
[custom connector](https://support.anthropic.com/en/articles/11175166)
(paid plan required). Expose the local server over the public internet via
ngrok or cloudflared if testing from a remote client.
```

- [ ] **Step 8.5: Final verification**

Run:
```bash
npm run typecheck && npm run lint && npm test && npm run build
```
Expected: all green.

- [ ] **Step 8.6: Commit**

```bash
git add README.md
git commit -m "docs: document basecamp_my_plate MCP App

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Post-implementation

- Push the branch and open a PR from `feat/my-plate-mcp-app` → `main`.
- Title: `feat: basecamp_my_plate — first MCP App`.
- Summary: link to the spec + this plan, list the 8 commits, include a screenshot from Step 8.3.
- Test plan checklist: paste the Step 8.3 checklist into the PR body.

## Out of scope (deferred to future plans)

- Non-todo assignment types (cards, card-table steps).
- In-UI search/filter beyond scope tabs.
- Create / reassign / comment / edit todos from the UI.
- Real-time updates (no polling; user re-invokes to refresh).
- Per-user UI preferences (collapsed groups, sort order).
