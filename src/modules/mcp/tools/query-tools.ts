import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ResponseFormat, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../../constants.js';
import type {
  BasecampChat,
  BasecampChatLine,
  BasecampMessage,
  BasecampPerson,
  BasecampProject,
  BasecampTodo,
  BasecampTodolist,
} from '../../../lib/types.js';
import {
  bcFetch,
  bcFetchOffsetLimit,
} from './basecamp-api.js';
import { getBasecampCtx } from './auth-context.js';
import {
  buildResult,
  findDock,
  formatCampfireLine,
  formatCampfireSummary,
  formatMessage,
  formatMessageDetail,
  formatPersonLine,
  formatProjectDetail,
  formatProjectSummary,
  formatTodo,
  formatTodolist,
  paginate,
  plainText,
  toolError,
} from './utils.js';

const paginationSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_LIMIT)
    .default(DEFAULT_PAGE_LIMIT)
    .describe('Max items to return (1-100).'),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Number of items to skip.'),
  response_format: z
    .nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe('"markdown" for human-readable, "json" for programmatic.'),
};

const detailResponseFormat = {
  response_format: z
    .nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe('"markdown" for human-readable, "json" for programmatic.'),
};

export function registerQueryTools(server: McpServer): void {
  // ─── basecamp_list_projects ─────────────────────────────────────────
  server.registerTool(
    'basecamp_list_projects',
    {
      title: 'List Basecamp projects',
      description: `List projects on this Basecamp account.

Args:
  - status ('active'|'archived'|'trashed'): filter by status (default: 'active').
  - limit (number, 1-100, default 20): max projects to return.
  - offset (number, default 0): number to skip.
  - response_format ('markdown'|'json', default 'markdown').

Returns:
  For JSON format: { total, count, offset, has_more, next_offset, items: [{ id, name, status, description, url }] }.
  For markdown: a numbered list with project name, id, status, and web URL.

Examples:
  - Use when: "What projects do I have?" — no args.
  - Use when: "Show archived projects" — status="archived".
  - Don't use when: you know the project id — use basecamp_get_project instead.

Error handling:
  - "Basecamp connector needs to be reconnected" → user should reauth in Claude.
  - "rate limit hit" → retry after the indicated seconds.`,
      inputSchema: z
        .object({
          status: z
            .enum(['active', 'archived', 'trashed'])
            .default('active')
            .describe('Filter by project status.'),
          ...paginationSchema,
        })
        .strict().shape,
      outputSchema: {
        total: z.number(),
        count: z.number(),
        offset: z.number(),
        has_more: z.boolean(),
        next_offset: z.number().optional(),
        items: z.array(z.record(z.string(), z.unknown())),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params, extra) => {
      try {
        const ctx = getBasecampCtx(extra.authInfo?.extra);
        const page = await bcFetchOffsetLimit<BasecampProject>(
          ctx,
          `/projects.json?status=${params.status}`,
          params.limit,
          params.offset,
        );
        const items = page.items.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          description: p.description,
          app_url: p.app_url,
        }));
        const envelope = paginate(items, params.offset, params.limit, page.total, page.hasMore);
        const markdown = items.length
          ? `Found ${items.length} project${items.length === 1 ? '' : 's'}${page.hasMore ? ' (more available)' : ''}:\n\n` +
            page.items.map((p) => formatProjectSummary(p)).join('\n\n')
          : 'No projects found.';
        return buildResult(markdown, envelope, params.response_format);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ─── basecamp_get_project ───────────────────────────────────────────
  server.registerTool(
    'basecamp_get_project',
    {
      title: 'Get a Basecamp project',
      description: `Fetch one project including its dock (todoset, message_board, chat, etc).

Args:
  - project_id (number, required).
  - response_format ('markdown'|'json', default 'markdown').

Returns:
  For JSON: { id, name, description, status, app_url, dock: [{ name, title, enabled, url }] }.
  For markdown: a formatted card with description and the enabled dock list.

Examples:
  - Use when: "Show me the Foo project." — project_id=<foo>.
  - Use when: you need to discover a project's todoset_id or message_board_id from the dock.

Error handling:
  - Not found → verify the project_id is correct and you have access.`,
      inputSchema: z
        .object({
          project_id: z.number().int().positive().describe('Project ID.'),
          ...detailResponseFormat,
        })
        .strict().shape,
      outputSchema: {
        id: z.number(),
        name: z.string(),
        description: z.string().nullable(),
        status: z.string(),
        app_url: z.string(),
        dock: z.array(z.record(z.string(), z.unknown())),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params, extra) => {
      try {
        const ctx = getBasecampCtx(extra.authInfo?.extra);
        const p = await bcFetch<BasecampProject>(ctx, `/projects/${params.project_id}.json`);
        const struct = {
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status,
          app_url: p.app_url,
          dock: p.dock.map((d) => ({
            id: d.id,
            name: d.name,
            title: d.title,
            enabled: d.enabled,
            url: d.url,
          })),
        };
        return buildResult(formatProjectDetail(p), struct, params.response_format);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ─── basecamp_list_project_people ───────────────────────────────────
  server.registerTool(
    'basecamp_list_project_people',
    {
      title: 'List people in a Basecamp project',
      description: `Return the people who have access to the given project.

Args:
  - project_id (number, required).
  - response_format ('markdown'|'json', default 'markdown').

Returns:
  For JSON: { count, items: [{ id, name, email_address, title, admin, client }] }.
  For markdown: bullet list with admin/client tags where relevant.

Examples:
  - Use when: "Who's on this project?" — project_id=<id>.
  - Use when: you need a user id to assign to a new todo.`,
      inputSchema: z
        .object({
          project_id: z.number().int().positive(),
          ...detailResponseFormat,
        })
        .strict().shape,
      outputSchema: {
        count: z.number(),
        items: z.array(z.record(z.string(), z.unknown())),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params, extra) => {
      try {
        const ctx = getBasecampCtx(extra.authInfo?.extra);
        const people = await bcFetch<BasecampPerson[]>(
          ctx,
          `/projects/${params.project_id}/people.json`,
        );
        const items = people.map((p) => ({
          id: p.id,
          name: p.name,
          email_address: p.email_address,
          title: p.title ?? null,
          admin: !!p.admin,
          client: !!p.client,
        }));
        const markdown = people.length
          ? people.map((p) => formatPersonLine(p)).join('\n')
          : 'No people on this project.';
        return buildResult(
          markdown,
          { count: items.length, items },
          params.response_format,
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ─── basecamp_list_todolists ────────────────────────────────────────
  server.registerTool(
    'basecamp_list_todolists',
    {
      title: 'List todolists in a project',
      description: `Discover the project's todoset via the dock, then list its todolists.

Args:
  - project_id (number, required).
  - limit, offset, response_format — standard pagination + format.

Returns:
  Paginated envelope: { total, count, offset, has_more, next_offset, items: [{ id, title, completed_ratio, app_url }] }.

Examples:
  - Use when: "What task lists are in Foo?" — project_id=<foo>.
  - Use when: you need a todolist_id to list or create todos.`,
      inputSchema: z
        .object({
          project_id: z.number().int().positive(),
          ...paginationSchema,
        })
        .strict().shape,
      outputSchema: {
        total: z.number(),
        count: z.number(),
        offset: z.number(),
        has_more: z.boolean(),
        next_offset: z.number().optional(),
        items: z.array(z.record(z.string(), z.unknown())),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params, extra) => {
      try {
        const ctx = getBasecampCtx(extra.authInfo?.extra);
        const project = await bcFetch<BasecampProject>(
          ctx,
          `/projects/${params.project_id}.json`,
        );
        const todoset = findDock(project, 'todoset');
        if (!todoset?.enabled || !todoset.url) {
          return toolError(new Error(`Project ${params.project_id} has no enabled todoset.`));
        }
        // todoset.url points at the todoset resource; todolists are under it.
        const todolistsUrl = todoset.url.replace(/\.json$/, '/todolists.json');
        const page = await bcFetchOffsetLimit<BasecampTodolist>(
          ctx,
          todolistsUrl,
          params.limit,
          params.offset,
        );
        const items = page.items.map((l) => ({
          id: l.id,
          title: l.title,
          completed: !!l.completed,
          completed_ratio: l.completed_ratio ?? null,
          app_url: l.app_url,
        }));
        const envelope = paginate(items, params.offset, params.limit, page.total, page.hasMore);
        const markdown = items.length
          ? page.items.map((l) => formatTodolist(l)).join('\n\n')
          : 'No todolists found in this project.';
        return buildResult(markdown, envelope, params.response_format);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ─── basecamp_list_todos ────────────────────────────────────────────
  server.registerTool(
    'basecamp_list_todos',
    {
      title: 'List todos in a todolist',
      description: `List todos in a given todolist, optionally filtered by completion status.

Args:
  - project_id (number, required).
  - todolist_id (number, required).
  - status ('active'|'completed', default 'active').
  - limit, offset, response_format — standard pagination + format.

Returns:
  Paginated envelope with items: [{ id, title, completed, due_on, assignees: [{id, name}], app_url }].

Examples:
  - Use when: "What's open on the Launch Checklist?" — find the todolist via basecamp_list_todolists first.`,
      inputSchema: z
        .object({
          project_id: z.number().int().positive(),
          todolist_id: z.number().int().positive(),
          status: z.enum(['active', 'completed']).default('active'),
          ...paginationSchema,
        })
        .strict().shape,
      outputSchema: {
        total: z.number(),
        count: z.number(),
        offset: z.number(),
        has_more: z.boolean(),
        next_offset: z.number().optional(),
        items: z.array(z.record(z.string(), z.unknown())),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params, extra) => {
      try {
        const ctx = getBasecampCtx(extra.authInfo?.extra);
        const path = `/buckets/${params.project_id}/todolists/${params.todolist_id}/todos.json?status=${params.status}`;
        const page = await bcFetchOffsetLimit<BasecampTodo>(
          ctx,
          path,
          params.limit,
          params.offset,
        );
        const items = page.items.map((t) => ({
          id: t.id,
          title: t.title,
          completed: !!t.completed,
          due_on: t.due_on,
          assignees: (t.assignees ?? []).map((a) => ({ id: a.id, name: a.name })),
          app_url: t.app_url,
        }));
        const envelope = paginate(items, params.offset, params.limit, page.total, page.hasMore);
        const markdown = items.length
          ? page.items.map((t) => formatTodo(t)).join('\n\n')
          : 'No todos match.';
        return buildResult(markdown, envelope, params.response_format);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ─── basecamp_get_todo ──────────────────────────────────────────────
  server.registerTool(
    'basecamp_get_todo',
    {
      title: 'Get a todo',
      description: `Fetch one todo's full details.

Args:
  - project_id (number, required).
  - todo_id (number, required).
  - response_format ('markdown'|'json', default 'markdown').

Returns:
  { id, title, description, completed, due_on, assignees, creator, created_at, app_url }.`,
      inputSchema: z
        .object({
          project_id: z.number().int().positive(),
          todo_id: z.number().int().positive(),
          ...detailResponseFormat,
        })
        .strict().shape,
      outputSchema: {
        id: z.number(),
        title: z.string(),
        description: z.string().nullable(),
        completed: z.boolean(),
        due_on: z.string().nullable(),
        assignees: z.array(z.record(z.string(), z.unknown())),
        creator: z.record(z.string(), z.unknown()).nullable(),
        created_at: z.string(),
        app_url: z.string(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params, extra) => {
      try {
        const ctx = getBasecampCtx(extra.authInfo?.extra);
        const t = await bcFetch<BasecampTodo>(
          ctx,
          `/buckets/${params.project_id}/todos/${params.todo_id}.json`,
        );
        const struct = {
          id: t.id,
          title: t.title,
          description: plainText(t.description ?? ''),
          completed: !!t.completed,
          due_on: t.due_on,
          assignees: (t.assignees ?? []).map((a) => ({
            id: a.id,
            name: a.name,
            email: a.email_address,
          })),
          creator: t.creator ? { id: t.creator.id, name: t.creator.name } : null,
          created_at: t.created_at,
          app_url: t.app_url,
        };
        const markdown = [
          `# ${t.title}`,
          `${t.completed ? 'Completed' : 'Open'}${t.due_on ? `   ·   due ${t.due_on}` : ''}`,
          t.creator ? `Created by ${t.creator.name} on ${t.created_at.substring(0, 10)}` : '',
          t.assignees?.length ? `Assignees: ${t.assignees.map((a) => a.name).join(', ')}` : '',
          '',
          plainText(t.description ?? ''),
          '',
          `Web: ${t.app_url}`,
        ]
          .filter(Boolean)
          .join('\n');
        return buildResult(markdown, struct, params.response_format);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ─── basecamp_list_messages ─────────────────────────────────────────
  server.registerTool(
    'basecamp_list_messages',
    {
      title: 'List messages on a project message board',
      description: `Resolve the project's message_board via dock, then list messages.

Args:
  - project_id (number, required).
  - limit, offset, response_format.

Returns:
  Paginated envelope: items: [{ id, subject, creator: {id,name}, created_at, app_url }].`,
      inputSchema: z
        .object({
          project_id: z.number().int().positive(),
          ...paginationSchema,
        })
        .strict().shape,
      outputSchema: {
        total: z.number(),
        count: z.number(),
        offset: z.number(),
        has_more: z.boolean(),
        next_offset: z.number().optional(),
        items: z.array(z.record(z.string(), z.unknown())),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params, extra) => {
      try {
        const ctx = getBasecampCtx(extra.authInfo?.extra);
        const project = await bcFetch<BasecampProject>(
          ctx,
          `/projects/${params.project_id}.json`,
        );
        const board = findDock(project, 'message_board');
        if (!board?.enabled || !board.url) {
          return toolError(new Error(`Project ${params.project_id} has no enabled message board.`));
        }
        const messagesUrl = board.url.replace(/\.json$/, '/messages.json');
        const page = await bcFetchOffsetLimit<BasecampMessage>(
          ctx,
          messagesUrl,
          params.limit,
          params.offset,
        );
        const items = page.items.map((m) => ({
          id: m.id,
          subject: m.subject,
          creator: { id: m.creator.id, name: m.creator.name },
          created_at: m.created_at,
          app_url: m.app_url,
        }));
        const envelope = paginate(items, params.offset, params.limit, page.total, page.hasMore);
        const markdown = items.length
          ? page.items.map((m) => formatMessage(m)).join('\n\n')
          : 'No messages on this project.';
        return buildResult(markdown, envelope, params.response_format);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ─── basecamp_get_message ───────────────────────────────────────────
  server.registerTool(
    'basecamp_get_message',
    {
      title: 'Get a message',
      description: `Fetch one message with its full body.

Args:
  - project_id (number).
  - message_id (number).
  - response_format ('markdown'|'json').`,
      inputSchema: z
        .object({
          project_id: z.number().int().positive(),
          message_id: z.number().int().positive(),
          ...detailResponseFormat,
        })
        .strict().shape,
      outputSchema: {
        id: z.number(),
        subject: z.string(),
        content: z.string(),
        creator: z.record(z.string(), z.unknown()),
        created_at: z.string(),
        app_url: z.string(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params, extra) => {
      try {
        const ctx = getBasecampCtx(extra.authInfo?.extra);
        const m = await bcFetch<BasecampMessage>(
          ctx,
          `/buckets/${params.project_id}/messages/${params.message_id}.json`,
        );
        const struct = {
          id: m.id,
          subject: m.subject,
          content: plainText(m.content),
          creator: { id: m.creator.id, name: m.creator.name, email: m.creator.email_address },
          created_at: m.created_at,
          app_url: m.app_url,
        };
        return buildResult(formatMessageDetail(m), struct, params.response_format);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ─── basecamp_list_campfires ────────────────────────────────────────
  server.registerTool(
    'basecamp_list_campfires',
    {
      title: 'List campfires across the account',
      description: `List all Basecamp campfires (chat rooms) visible on this account.

Args:
  - limit, offset, response_format.

Returns:
  Paginated envelope: items: [{ id, title, project_name, lines_count, app_url }].

Examples:
  - Use when: "Which chats do I have access to?"`,
      inputSchema: z
        .object({
          ...paginationSchema,
        })
        .strict().shape,
      outputSchema: {
        total: z.number(),
        count: z.number(),
        offset: z.number(),
        has_more: z.boolean(),
        next_offset: z.number().optional(),
        items: z.array(z.record(z.string(), z.unknown())),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params, extra) => {
      try {
        const ctx = getBasecampCtx(extra.authInfo?.extra);
        const page = await bcFetchOffsetLimit<BasecampChat>(
          ctx,
          `/chats.json`,
          params.limit,
          params.offset,
        );
        const items = page.items.map((c) => ({
          id: c.id,
          title: c.title,
          project_name: c.bucket?.name ?? null,
          project_id: c.bucket?.id ?? null,
          lines_count: c.lines_count,
          app_url: c.app_url,
        }));
        const envelope = paginate(items, params.offset, params.limit, page.total, page.hasMore);
        const markdown = items.length
          ? page.items.map((c) => formatCampfireSummary(c)).join('\n\n')
          : 'No campfires found.';
        return buildResult(markdown, envelope, params.response_format);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ─── basecamp_read_campfire_history ─────────────────────────────────
  server.registerTool(
    'basecamp_read_campfire_history',
    {
      title: 'Read campfire chat history',
      description: `Read recent chat lines from a campfire.

Args:
  - project_id (number, required).
  - campfire_id (number, required) — from basecamp_list_campfires.
  - limit, offset, response_format.

Returns:
  Paginated envelope: items: [{ id, content, creator: {id,name}, created_at, app_url }].
  Markdown format renders one line per message as "[HH:MM] Name: text".

Examples:
  - Use when: "What's been said in the engineering campfire today?"`,
      inputSchema: z
        .object({
          project_id: z.number().int().positive(),
          campfire_id: z.number().int().positive(),
          ...paginationSchema,
        })
        .strict().shape,
      outputSchema: {
        total: z.number(),
        count: z.number(),
        offset: z.number(),
        has_more: z.boolean(),
        next_offset: z.number().optional(),
        items: z.array(z.record(z.string(), z.unknown())),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params, extra) => {
      try {
        const ctx = getBasecampCtx(extra.authInfo?.extra);
        const path = `/buckets/${params.project_id}/chats/${params.campfire_id}/lines.json`;
        const page = await bcFetchOffsetLimit<BasecampChatLine>(
          ctx,
          path,
          params.limit,
          params.offset,
        );
        const items = page.items.map((l) => ({
          id: l.id,
          content: plainText(l.content),
          creator: { id: l.creator.id, name: l.creator.name },
          created_at: l.created_at,
          app_url: l.app_url,
        }));
        const envelope = paginate(items, params.offset, params.limit, page.total, page.hasMore);
        const markdown = items.length
          ? page.items.map((l) => formatCampfireLine(l)).join('\n')
          : 'No chat history in this campfire.';
        return buildResult(markdown, envelope, params.response_format);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
