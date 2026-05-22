import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ResponseFormat,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from '../../../constants.js';
import type {
  BasecampCard,
  BasecampCardTable,
} from '../../../lib/types.js';
import { bcFetch, bcFetchOffsetLimit } from './basecamp-api.js';
import type { BasecampContext } from './auth-context.js';
import { getBasecampCtx } from './auth-context.js';
import {
  buildResult,
  formatCard,
  formatCardDetail,
  formatCardTable,
  paginate,
  plainText,
  toolError,
} from './utils.js';
import type { ToolResult } from './utils.js';

// Basecamp's UI/URL surface calls these "card tables" with "cards"; the project
// dock exposes them as `kanban_board`. We surface them as `*_ticket` because
// "ticket" is the term users reach for. All tool descriptions mention both.

const formatParam = {
  response_format: z
    .nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe('"markdown" for human-readable, "json" for programmatic.'),
};

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
  ...formatParam,
};

// ─── Pure handlers (testable without an McpServer) ──────────────────────

export async function handleGetCardTable(
  params: { project_id: number; card_table_id: number; response_format: ResponseFormat },
  ctx: BasecampContext,
): Promise<ToolResult> {
  try {
    const ct = await bcFetch<BasecampCardTable>(
      ctx,
      `/buckets/${params.project_id}/card_tables/${params.card_table_id}.json`,
    );
    const struct = {
      id: ct.id,
      title: ct.title,
      type: ct.type,
      status: ct.status,
      app_url: ct.app_url,
      columns: (ct.lists ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        type: c.type,
        cards_count: c.cards_count,
        app_url: c.app_url,
      })),
    };
    return buildResult(formatCardTable(ct), struct, params.response_format);
  } catch (err) {
    return toolError(err);
  }
}

export async function handleListTickets(
  params: {
    project_id: number;
    column_id: number;
    limit: number;
    offset: number;
    response_format: ResponseFormat;
  },
  ctx: BasecampContext,
): Promise<ToolResult> {
  try {
    const path = `/buckets/${params.project_id}/card_tables/lists/${params.column_id}/cards.json`;
    const page = await bcFetchOffsetLimit<BasecampCard>(
      ctx,
      path,
      params.limit,
      params.offset,
    );
    const items = page.items.map((c) => ({
      id: c.id,
      title: c.title,
      completed: !!c.completed,
      due_on: c.due_on,
      assignees: (c.assignees ?? []).map((a) => ({ id: a.id, name: a.name })),
      app_url: c.app_url,
    }));
    const envelope = paginate(items, params.offset, params.limit, page.total, page.hasMore);
    const markdown = items.length
      ? page.items.map((c) => formatCard(c)).join('\n\n')
      : 'No tickets (cards) in this column.';
    return buildResult(markdown, envelope, params.response_format);
  } catch (err) {
    return toolError(err);
  }
}

export async function handleGetTicket(
  params: { project_id: number; card_id: number; response_format: ResponseFormat },
  ctx: BasecampContext,
): Promise<ToolResult> {
  try {
    const c = await bcFetch<BasecampCard>(
      ctx,
      `/buckets/${params.project_id}/card_tables/cards/${params.card_id}.json`,
    );
    const struct = {
      id: c.id,
      title: c.title,
      status: c.status,
      content: plainText(c.content ?? c.description ?? ''),
      completed: !!c.completed,
      due_on: c.due_on,
      assignees: (c.assignees ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email_address,
      })),
      creator: c.creator ? { id: c.creator.id, name: c.creator.name } : null,
      parent: c.parent
        ? { id: c.parent.id, title: c.parent.title, type: c.parent.type }
        : null,
      created_at: c.created_at,
      app_url: c.app_url,
    };
    return buildResult(formatCardDetail(c), struct, params.response_format);
  } catch (err) {
    return toolError(err);
  }
}

export async function handleCreateTicket(
  params: {
    project_id: number;
    column_id: number;
    title: string;
    content?: string;
    due_on?: string;
    assignee_ids?: number[];
    notify: boolean;
    response_format: ResponseFormat;
  },
  ctx: BasecampContext,
): Promise<ToolResult> {
  try {
    const body: Record<string, unknown> = {
      title: params.title,
      notify: params.notify,
    };
    if (params.content !== undefined) body.content = params.content;
    if (params.due_on) body.due_on = params.due_on;
    if (params.assignee_ids?.length) body.assignee_ids = params.assignee_ids;

    const c = await bcFetch<BasecampCard>(
      ctx,
      `/buckets/${params.project_id}/card_tables/lists/${params.column_id}/cards.json`,
      { method: 'POST', body },
    );
    const struct = {
      id: c.id,
      title: c.title,
      completed: !!c.completed,
      due_on: c.due_on,
      column_id: c.parent?.id ?? params.column_id,
      app_url: c.app_url,
    };
    const markdown = `Created ticket (card) #${c.id}: **${c.title}**\n${c.app_url}`;
    return buildResult(markdown, struct, params.response_format);
  } catch (err) {
    return toolError(err);
  }
}

export async function handleUpdateTicket(
  params: {
    project_id: number;
    card_id: number;
    title?: string;
    content?: string;
    due_on?: string | null;
    assignee_ids?: number[];
    response_format: ResponseFormat;
  },
  ctx: BasecampContext,
): Promise<ToolResult> {
  try {
    const body: Record<string, unknown> = {};
    if (params.title !== undefined) body.title = params.title;
    if (params.content !== undefined) body.content = params.content;
    // due_on: null intentionally clears the date; undefined leaves it alone.
    if (params.due_on !== undefined) body.due_on = params.due_on;
    if (params.assignee_ids !== undefined) body.assignee_ids = params.assignee_ids;

    if (Object.keys(body).length === 0) {
      return toolError(
        new Error(
          'No fields to update. Pass at least one of: title, content, due_on, assignee_ids.',
        ),
      );
    }

    const c = await bcFetch<BasecampCard>(
      ctx,
      `/buckets/${params.project_id}/card_tables/cards/${params.card_id}.json`,
      { method: 'PUT', body },
    );
    const struct = {
      id: c.id,
      title: c.title,
      completed: !!c.completed,
      due_on: c.due_on,
      app_url: c.app_url,
    };
    const markdown = `Updated ticket (card) #${c.id}: **${c.title}**\n${c.app_url}`;
    return buildResult(markdown, struct, params.response_format);
  } catch (err) {
    return toolError(err);
  }
}

export async function handleMoveTicket(
  params: {
    project_id: number;
    card_id: number;
    target_column_id: number;
    response_format: ResponseFormat;
  },
  ctx: BasecampContext,
): Promise<ToolResult> {
  try {
    // Returns 204 No Content. bcFetch resolves with undefined for empty bodies.
    await bcFetch<void>(
      ctx,
      `/buckets/${params.project_id}/card_tables/cards/${params.card_id}/moves.json`,
      { method: 'POST', body: { column_id: params.target_column_id } },
    );
    const struct = {
      card_id: params.card_id,
      column_id: params.target_column_id,
      moved: true,
    };
    return buildResult(
      `Moved ticket (card) #${params.card_id} to column ${params.target_column_id}.`,
      struct,
      params.response_format,
    );
  } catch (err) {
    return toolError(err);
  }
}

// ─── Registration ────────────────────────────────────────────────────────

export function registerTicketTools(server: McpServer): void {
  // ─── basecamp_get_card_table ────────────────────────────────────────
  server.registerTool(
    'basecamp_get_card_table',
    {
      title: 'Get a Basecamp card table (kanban board)',
      description: `Fetch one card table (Basecamp's kanban_board feature) including its columns.

A project's card tables appear in the dock with \`name: "kanban_board"\`. A project can have more than one. Use \`basecamp_get_project\` to find a project's kanban_board entries — each entry's \`id\` is a \`card_table_id\`.

Args:
  - project_id (number, required).
  - card_table_id (number, required) — from project dock; entries with name "kanban_board".
  - response_format ('markdown'|'json').

Returns:
  { id, title, type, status, app_url, columns: [{ id, title, type, cards_count, app_url }] }.

Column \`type\` is one of: Kanban::Triage, Kanban::Column, Kanban::NotNowColumn, Kanban::DoneColumn.

Examples:
  - Use when: you need column IDs to call basecamp_list_tickets or basecamp_create_ticket.
  - Use when: "Show me the columns on the Build board."`,
      inputSchema: z
        .object({
          project_id: z.number().int().positive(),
          card_table_id: z.number().int().positive(),
          ...formatParam,
        })
        .strict().shape,
      outputSchema: {
        id: z.number(),
        title: z.string(),
        type: z.string(),
        status: z.string(),
        app_url: z.string(),
        columns: z.array(z.record(z.string(), z.unknown())),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params, extra) => {
      const ctx = getBasecampCtx(extra.authInfo?.extra);
      return handleGetCardTable(params, ctx);
    },
  );

  // ─── basecamp_list_tickets ──────────────────────────────────────────
  server.registerTool(
    'basecamp_list_tickets',
    {
      title: 'List tickets (cards) in a card-table column',
      description: `List the active tickets (Basecamp calls them "cards") in one column of a card table.

Trashed cards are filtered out by Basecamp; this mirrors the board UI.

Args:
  - project_id (number, required).
  - column_id (number, required) — from basecamp_get_card_table.
  - limit, offset, response_format — standard pagination + format.

Returns:
  Paginated envelope: items: [{ id, title, completed, due_on, assignees: [{id, name}], app_url }].

Examples:
  - Use when: "What's in the Triage column on the Build board?"
  - Use when: you need card IDs to call basecamp_get_ticket / basecamp_move_ticket.`,
      inputSchema: z
        .object({
          project_id: z.number().int().positive(),
          column_id: z.number().int().positive(),
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
      const ctx = getBasecampCtx(extra.authInfo?.extra);
      return handleListTickets(params, ctx);
    },
  );

  // ─── basecamp_get_ticket ────────────────────────────────────────────
  server.registerTool(
    'basecamp_get_ticket',
    {
      title: 'Get a Basecamp ticket (card)',
      description: `Fetch one ticket (card) including its HTML content, assignees, and parent column.

Returns the card even if it has been trashed; check the \`status\` field — "trashed" cards are hidden from column listings but still readable.

Args:
  - project_id (number, required).
  - card_id (number, required).
  - response_format ('markdown'|'json').

Returns:
  { id, title, status, content, completed, due_on, assignees, creator, parent (column ref), created_at, app_url }.`,
      inputSchema: z
        .object({
          project_id: z.number().int().positive(),
          card_id: z.number().int().positive(),
          ...formatParam,
        })
        .strict().shape,
      outputSchema: {
        id: z.number(),
        title: z.string(),
        status: z.string(),
        content: z.string(),
        completed: z.boolean(),
        due_on: z.string().nullable(),
        assignees: z.array(z.record(z.string(), z.unknown())),
        creator: z.record(z.string(), z.unknown()).nullable(),
        parent: z.record(z.string(), z.unknown()).nullable(),
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
      const ctx = getBasecampCtx(extra.authInfo?.extra);
      return handleGetTicket(params, ctx);
    },
  );

  // ─── basecamp_create_ticket ─────────────────────────────────────────
  server.registerTool(
    'basecamp_create_ticket',
    {
      title: 'Create a ticket (card) on a card-table column',
      description: `Create a new ticket (Basecamp calls it a "card") in a card-table column.

The \`content\` body is HTML and renders directly — unlike campfire messages, no \`content_type\` header is needed.

Args:
  - project_id (number, required).
  - column_id (number, required) — destination column from basecamp_get_card_table.
  - title (string, required, 1-500 chars).
  - content (string, optional) — HTML body.
  - assignee_ids (array<number>, optional) — use basecamp_list_project_people to find IDs.
  - due_on (string 'YYYY-MM-DD', optional).
  - notify (boolean, optional, default false) — whether Basecamp pings assignees.
  - response_format ('markdown'|'json').

Returns:
  { id, title, completed, due_on, column_id, app_url }.`,
      inputSchema: z
        .object({
          project_id: z.number().int().positive(),
          column_id: z.number().int().positive(),
          title: z.string().min(1).max(500),
          content: z.string().optional(),
          assignee_ids: z.array(z.number().int().positive()).optional(),
          due_on: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
            .optional(),
          notify: z.boolean().default(false),
          ...formatParam,
        })
        .strict().shape,
      outputSchema: {
        id: z.number(),
        title: z.string(),
        completed: z.boolean(),
        due_on: z.string().nullable(),
        column_id: z.number(),
        app_url: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params, extra) => {
      const ctx = getBasecampCtx(extra.authInfo?.extra);
      return handleCreateTicket(params, ctx);
    },
  );

  // ─── basecamp_update_ticket ─────────────────────────────────────────
  server.registerTool(
    'basecamp_update_ticket',
    {
      title: 'Update a ticket (card)',
      description: `Update a ticket (card). All fields are optional except card_id — pass only the ones you want to change.

\`due_on\` semantics:
  - omit the field → unchanged
  - pass \`null\`   → clears the due date
  - pass 'YYYY-MM-DD' → sets the due date

\`assignee_ids\`: passing a full array replaces the assignment list (passing \`[]\` clears all assignees). Omit to leave assignments alone.

To move a card to a different column, use basecamp_move_ticket instead.

Args:
  - project_id (number, required).
  - card_id (number, required).
  - title (string, optional, 1-500 chars).
  - content (string, optional) — HTML body.
  - due_on (string 'YYYY-MM-DD' | null, optional).
  - assignee_ids (array<number>, optional).
  - response_format ('markdown'|'json').

Returns:
  { id, title, completed, due_on, app_url }.`,
      inputSchema: z
        .object({
          project_id: z.number().int().positive(),
          card_id: z.number().int().positive(),
          title: z.string().min(1).max(500).optional(),
          content: z.string().optional(),
          due_on: z
            .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'), z.null()])
            .optional(),
          assignee_ids: z.array(z.number().int().positive()).optional(),
          ...formatParam,
        })
        .strict().shape,
      outputSchema: {
        id: z.number(),
        title: z.string(),
        completed: z.boolean(),
        due_on: z.string().nullable(),
        app_url: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params, extra) => {
      const ctx = getBasecampCtx(extra.authInfo?.extra);
      return handleUpdateTicket(params, ctx);
    },
  );

  // ─── basecamp_move_ticket ───────────────────────────────────────────
  server.registerTool(
    'basecamp_move_ticket',
    {
      title: 'Move a ticket (card) to another column',
      description: `Move a ticket (card) to a different column on the same card table.

Both \`card_id\` and \`target_column_id\` must belong to the same card table — moving across tables is not supported by Basecamp.

Args:
  - project_id (number, required).
  - card_id (number, required).
  - target_column_id (number, required) — from basecamp_get_card_table.
  - response_format ('markdown'|'json').

Returns:
  { card_id, column_id, moved: true }.`,
      inputSchema: z
        .object({
          project_id: z.number().int().positive(),
          card_id: z.number().int().positive(),
          target_column_id: z.number().int().positive(),
          ...formatParam,
        })
        .strict().shape,
      outputSchema: {
        card_id: z.number(),
        column_id: z.number(),
        moved: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params, extra) => {
      const ctx = getBasecampCtx(extra.authInfo?.extra);
      return handleMoveTicket(params, ctx);
    },
  );
}
