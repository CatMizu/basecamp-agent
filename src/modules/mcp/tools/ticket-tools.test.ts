import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import type { BasecampContext } from './auth-context.js';
import {
  handleGetCardTable,
  handleListTickets,
  handleGetTicket,
  handleCreateTicket,
  handleUpdateTicket,
  handleMoveTicket,
} from './ticket-tools.js';
import { ResponseFormat } from '../../../constants.js';

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

function makeResponse({
  status = 200,
  body,
  headers = {},
}: {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}): Response {
  const headersMap = new Headers(headers);
  return {
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: headersMap,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

// Fixtures lifted from the Phase A probe so we test against real shapes.

const FIXTURE_CARD_TABLE = {
  id: 8895714077,
  status: 'active',
  title: 'Build Retainer Development',
  type: 'Kanban::Board',
  created_at: '2025-07-25T08:11:01.721Z',
  updated_at: '2026-05-22T16:47:33.109Z',
  url: 'https://3.basecampapi.com/9999/buckets/42/card_tables/8895714077.json',
  app_url: 'https://3.basecamp.com/9999/buckets/42/card_tables/8895714077',
  bucket: { id: 42, name: 'Darren Evans', type: 'Project' },
  lists: [
    {
      id: 8895714078,
      title: 'Triage',
      type: 'Kanban::Triage',
      status: 'active',
      color: null,
      description: null,
      cards_count: 9,
      comment_count: 0,
      cards_url:
        'https://3.basecampapi.com/9999/buckets/42/card_tables/lists/8895714078/cards.json',
      url: 'u',
      app_url: 'https://3.basecamp.com/9999/buckets/42/card_tables/columns/8895714078',
      created_at: '2025-07-25T08:11:01.730Z',
      updated_at: '2026-05-04T20:55:23.557Z',
    },
    {
      id: 8895714081,
      title: 'To Do',
      type: 'Kanban::Column',
      status: 'active',
      color: 'purple',
      description: '',
      cards_count: 0,
      comment_count: 0,
      cards_url:
        'https://3.basecampapi.com/9999/buckets/42/card_tables/lists/8895714081/cards.json',
      url: 'u',
      app_url: 'https://3.basecamp.com/9999/buckets/42/card_tables/columns/8895714081',
      created_at: '2025-07-25T08:11:01.766Z',
      updated_at: '2026-05-22T16:47:33.050Z',
      position: 1,
    },
  ],
};

const FIXTURE_CARD = {
  id: 9921062935,
  status: 'active',
  title: 'A ticket',
  type: 'Kanban::Card',
  content: '<div>Body</div>',
  description: '<div>Body</div>',
  completed: false,
  due_on: null,
  assignees: [],
  creator: { id: 1, name: 'Tester', email_address: 't@example.com' },
  position: 1,
  comments_count: 0,
  comment_count: 0,
  created_at: '2026-05-22T17:27:11.612Z',
  updated_at: '2026-05-22T17:27:11.620Z',
  url: 'https://3.basecampapi.com/9999/buckets/42/card_tables/cards/9921062935.json',
  app_url: 'https://3.basecamp.com/9999/buckets/42/card_tables/cards/9921062935',
  parent: {
    id: 8895714078,
    title: 'Triage',
    type: 'Kanban::Triage',
    url: 'u',
    app_url: 'u',
  },
  bucket: { id: 42, name: 'Darren Evans', type: 'Project' },
};

function textOf(result: { content: Array<{ text: string }> }): string {
  return result.content[0].text;
}

describe('ticket-tools', () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ─── basecamp_get_card_table ───────────────────────────────────────

  test('handleGetCardTable returns columns and labels their types', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ body: FIXTURE_CARD_TABLE }));
    const result = await handleGetCardTable(
      { project_id: 42, card_table_id: 8895714077, response_format: ResponseFormat.JSON },
      makeCtx(),
    );
    expect(result.isError).toBeFalsy();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/buckets/42/card_tables/8895714077.json');
    const content = JSON.parse(textOf(result as { content: Array<{ text: string }> }));
    expect(content.id).toBe(8895714077);
    expect(content.columns).toHaveLength(2);
    expect(content.columns[0]).toMatchObject({
      id: 8895714078,
      title: 'Triage',
      type: 'Kanban::Triage',
      cards_count: 9,
    });
  });

  test('handleGetCardTable returns isError on 404', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 404 }));
    const result = await handleGetCardTable(
      { project_id: 42, card_table_id: 999, response_format: ResponseFormat.MARKDOWN },
      makeCtx(),
    );
    expect(result.isError).toBe(true);
  });

  // ─── basecamp_list_tickets ─────────────────────────────────────────

  test('handleListTickets returns paginated items from a column', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ body: [FIXTURE_CARD] }));
    const result = await handleListTickets(
      {
        project_id: 42,
        column_id: 8895714078,
        limit: 20,
        offset: 0,
        response_format: ResponseFormat.JSON,
      },
      makeCtx(),
    );
    expect(result.isError).toBeFalsy();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/buckets/42/card_tables/lists/8895714078/cards.json');
    const content = JSON.parse(textOf(result as { content: Array<{ text: string }> }));
    expect(content.count).toBe(1);
    expect(content.items[0]).toMatchObject({ id: 9921062935, title: 'A ticket', completed: false });
  });

  test('handleListTickets reports an empty column', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ body: [] }));
    const result = await handleListTickets(
      {
        project_id: 42,
        column_id: 8895714081,
        limit: 20,
        offset: 0,
        response_format: ResponseFormat.MARKDOWN,
      },
      makeCtx(),
    );
    expect(result.isError).toBeFalsy();
    expect(textOf(result as { content: Array<{ text: string }> })).toContain('No tickets');
  });

  // ─── basecamp_get_ticket ───────────────────────────────────────────

  test('handleGetTicket returns card detail with stripped content', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ body: FIXTURE_CARD }));
    const result = await handleGetTicket(
      { project_id: 42, card_id: 9921062935, response_format: ResponseFormat.JSON },
      makeCtx(),
    );
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(textOf(result as { content: Array<{ text: string }> }));
    expect(content.id).toBe(9921062935);
    expect(content.content).toBe('Body'); // HTML stripped
    expect(content.parent).toMatchObject({ id: 8895714078, type: 'Kanban::Triage' });
  });

  test('handleGetTicket preserves trashed status', async () => {
    const trashed = { ...FIXTURE_CARD, status: 'trashed' };
    fetchMock.mockResolvedValueOnce(makeResponse({ body: trashed }));
    const result = await handleGetTicket(
      { project_id: 42, card_id: 9921062935, response_format: ResponseFormat.JSON },
      makeCtx(),
    );
    const content = JSON.parse(textOf(result as { content: Array<{ text: string }> }));
    expect(content.status).toBe('trashed');
  });

  // ─── basecamp_create_ticket ────────────────────────────────────────

  test('handleCreateTicket POSTs to the column cards endpoint with the right body', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 201, body: { ...FIXTURE_CARD, id: 9999 } }),
    );
    const result = await handleCreateTicket(
      {
        project_id: 42,
        column_id: 8895714078,
        title: 'New ticket',
        content: '<div>Hello</div>',
        notify: false,
        response_format: ResponseFormat.JSON,
      },
      makeCtx(),
    );
    expect(result.isError).toBeFalsy();
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    expect(url).toContain('/buckets/42/card_tables/lists/8895714078/cards.json');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ title: 'New ticket', content: '<div>Hello</div>', notify: false });
    const content = JSON.parse(textOf(result as { content: Array<{ text: string }> }));
    expect(content.id).toBe(9999);
  });

  test('handleCreateTicket omits empty optional fields from body', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 201, body: FIXTURE_CARD }));
    await handleCreateTicket(
      {
        project_id: 42,
        column_id: 8895714078,
        title: 'Bare',
        notify: false,
        response_format: ResponseFormat.MARKDOWN,
      },
      makeCtx(),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body).toEqual({ title: 'Bare', notify: false });
    expect(body).not.toHaveProperty('content');
    expect(body).not.toHaveProperty('assignee_ids');
    expect(body).not.toHaveProperty('due_on');
  });

  // ─── basecamp_update_ticket ────────────────────────────────────────

  test('handleUpdateTicket sends a partial body and PUTs the card endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ body: { ...FIXTURE_CARD, title: 'Updated' } }),
    );
    const result = await handleUpdateTicket(
      {
        project_id: 42,
        card_id: 9921062935,
        title: 'Updated',
        response_format: ResponseFormat.JSON,
      },
      makeCtx(),
    );
    expect(result.isError).toBeFalsy();
    const call = fetchMock.mock.calls[0];
    expect((call[1] as RequestInit).method).toBe('PUT');
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({ title: 'Updated' });
    const content = JSON.parse(textOf(result as { content: Array<{ text: string }> }));
    expect(content.title).toBe('Updated');
  });

  test('handleUpdateTicket sends due_on: null when clearing a date', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ body: FIXTURE_CARD }));
    await handleUpdateTicket(
      {
        project_id: 42,
        card_id: 9921062935,
        due_on: null,
        response_format: ResponseFormat.MARKDOWN,
      },
      makeCtx(),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body).toEqual({ due_on: null });
  });

  test('handleUpdateTicket errors when no fields are provided', async () => {
    const result = await handleUpdateTicket(
      { project_id: 42, card_id: 9921062935, response_format: ResponseFormat.MARKDOWN },
      makeCtx(),
    );
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ─── basecamp_move_ticket ──────────────────────────────────────────

  test('handleMoveTicket POSTs to /moves.json with { column_id } and handles 204', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 204 }));
    const result = await handleMoveTicket(
      {
        project_id: 42,
        card_id: 9921062935,
        target_column_id: 8895714079,
        response_format: ResponseFormat.JSON,
      },
      makeCtx(),
    );
    expect(result.isError).toBeFalsy();
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    expect(url).toContain('/buckets/42/card_tables/cards/9921062935/moves.json');
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      column_id: 8895714079,
    });
    const content = JSON.parse(textOf(result as { content: Array<{ text: string }> }));
    expect(content).toEqual({ card_id: 9921062935, column_id: 8895714079, moved: true });
  });

  test('handleMoveTicket surfaces a 422 from Basecamp as isError', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 422, body: { error: 'invalid column' } }),
    );
    const result = await handleMoveTicket(
      {
        project_id: 42,
        card_id: 9921062935,
        target_column_id: 1,
        response_format: ResponseFormat.MARKDOWN,
      },
      makeCtx(),
    );
    expect(result.isError).toBe(true);
  });
});
