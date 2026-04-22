import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  CHARACTER_LIMIT,
  ResponseFormat,
} from '../../../constants.js';
import type {
  BasecampChat,
  BasecampChatLine,
  BasecampDockEntry,
  BasecampMessage,
  BasecampPerson,
  BasecampProject,
  BasecampTodo,
  BasecampTodolist,
} from '../../../lib/types.js';
import {
  BasecampApiError,
  BasecampAuthError,
  BasecampNotFoundError,
  BasecampRateLimitError,
} from './basecamp-api.js';

// ─── Tool-result shaping ────────────────────────────────────────────────

/**
 * Tool result shapes mirror the SDK's CallToolResult (which has an index
 * signature for forward compatibility). We return that type directly so the
 * handlers we pass to server.registerTool satisfy the SDK typing.
 */
export type ToolResult = CallToolResult;

/** Build a text+structured tool response. Enforces CHARACTER_LIMIT by trimming. */
export function buildResult(
  markdown: string,
  structured: Record<string, unknown>,
  format: ResponseFormat,
): ToolResult {
  const text = format === ResponseFormat.JSON ? JSON.stringify(structured, null, 2) : markdown;
  if (text.length <= CHARACTER_LIMIT) {
    return { content: [{ type: 'text' as const, text }], structuredContent: structured };
  }
  // Truncate. If this is a paginated response, encourage offset usage.
  const truncatedText =
    text.substring(0, CHARACTER_LIMIT - 500) +
    '\n\n…truncated — pass a smaller `limit` or a larger `offset` to paginate.';
  const truncatedStructured: Record<string, unknown> = {
    ...structured,
    truncated: true,
    truncation_message:
      'Response exceeded CHARACTER_LIMIT; trim `limit` or advance `offset`.',
  };
  return {
    content: [{ type: 'text' as const, text: truncatedText }],
    structuredContent: truncatedStructured,
  };
}

/**
 * Map any thrown error from tool body into the standard error tool result.
 */
export function toolError(err: unknown): ToolResult {
  if (err instanceof BasecampAuthError) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Basecamp connector needs to be reconnected in Claude (auth failed). ${err.message}`,
        },
      ],
    };
  }
  if (err instanceof BasecampRateLimitError) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Basecamp rate limit hit. Retry after ${err.retryAfterSec} seconds.`,
        },
      ],
    };
  }
  if (err instanceof BasecampNotFoundError) {
    return {
      isError: true,
      content: [
        { type: 'text' as const, text: 'Not found. Check that the ID is correct and you have access.' },
      ],
    };
  }
  if (err instanceof BasecampApiError) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Basecamp API returned ${err.status}: ${err.message}`,
        },
      ],
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: 'text' as const, text: `Error: ${msg}` }],
  };
}

// ─── Shared pagination envelope ─────────────────────────────────────────

export interface PaginationEnvelope<T> {
  [key: string]: unknown;
  total: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
  items: T[];
}

export function paginate<T>(
  items: T[],
  offset: number,
  _limit: number,
  totalHint: number,
  hasMore: boolean,
): PaginationEnvelope<T> {
  const nextOffset = hasMore ? offset + items.length : undefined;
  return {
    total: totalHint || offset + items.length + (hasMore ? 1 : 0),
    count: items.length,
    offset,
    has_more: hasMore,
    next_offset: nextOffset,
    items,
  };
}

// ─── Formatters ─────────────────────────────────────────────────────────

export function formatProjectSummary(p: BasecampProject): string {
  const lines = [
    `**${p.name}** (id: ${p.id}, status: ${p.status})`,
    p.description ? `  ${truncate(plainText(p.description), 140)}` : '',
    `  ${p.app_url}`,
  ];
  return lines.filter(Boolean).join('\n');
}

export function formatProjectDetail(p: BasecampProject): string {
  const docks = p.dock
    .filter((d) => d.enabled)
    .map((d) => `  - ${d.name} → ${d.title} (${d.url})`)
    .join('\n');
  return [
    `# ${p.name}`,
    `Status: ${p.status}   ·   Created: ${p.created_at}`,
    p.description ? `\n${plainText(p.description)}` : '',
    `\n**Web:** ${p.app_url}`,
    docks ? `\n**Enabled docks:**\n${docks}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatDock(d: BasecampDockEntry): string {
  return `${d.name} (${d.title}) — enabled: ${d.enabled}`;
}

export function formatPersonLine(p: BasecampPerson): string {
  const role = p.admin ? ' [admin]' : p.client ? ' [client]' : '';
  return `- ${p.name}${role} — ${p.email_address}`;
}

export function formatTodo(t: BasecampTodo): string {
  const status = t.completed ? '[x]' : '[ ]';
  const due = t.due_on ? ` (due ${t.due_on})` : '';
  const assignees = t.assignees?.length
    ? ` — assigned to ${t.assignees.map((a) => a.name).join(', ')}`
    : '';
  return `- ${status} **${t.title}**${due}${assignees}\n  id: ${t.id}   ${t.app_url}`;
}

export function formatTodolist(l: BasecampTodolist): string {
  return `- **${l.title}** (id: ${l.id}, completed_ratio: ${l.completed_ratio ?? 'n/a'})\n  ${l.app_url}`;
}

export function formatMessage(m: BasecampMessage): string {
  return `- **${m.subject}** by ${m.creator.name} on ${m.created_at.substring(0, 10)}\n  id: ${m.id}   ${m.app_url}`;
}

export function formatMessageDetail(m: BasecampMessage): string {
  return [
    `# ${m.subject}`,
    `By ${m.creator.name} <${m.creator.email_address}>   ·   ${m.created_at}`,
    '',
    plainText(m.content),
    '',
    `Web: ${m.app_url}`,
  ].join('\n');
}

export function formatCampfireSummary(c: BasecampChat): string {
  const project = c.bucket?.name ? ` (${c.bucket.name})` : '';
  return `- **${c.title}**${project} — ${c.lines_count} lines\n  id: ${c.id}   ${c.app_url}`;
}

export function formatCampfireLine(l: BasecampChatLine): string {
  return `[${l.created_at.substring(11, 16)}] ${l.creator.name}: ${plainText(l.content)}`;
}

// ─── Helpers ────────────────────────────────────────────────────────────

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.substring(0, n - 1) + '…';
}

/**
 * Strip HTML tags — Basecamp returns rich text with `<div>`, `<strong>`, etc.
 * Not a full sanitizer; this is purely for LLM-facing display.
 */
export function plainText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Find a dock entry by name. Basecamp project dock entries name like
 * "todoset", "message_board", "chat", "schedule", "vault".
 */
export function findDock(
  project: BasecampProject,
  name: string,
): BasecampDockEntry | undefined {
  return project.dock.find((d) => d.name === name);
}

