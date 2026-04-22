import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import type { BasecampContext } from './auth-context.js';
import {
  bcFetch,
  bcFetchOffsetLimit,
  bcFetchPage,
  BasecampAuthError,
  BasecampNotFoundError,
  BasecampRateLimitError,
  getMyAssignments,
  getMyReadings,
} from './basecamp-api.js';
import type {
  BasecampMyAssignmentsResponse,
  BasecampReadingsResponse,
} from '../../../lib/types.js';

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
    statusText: 'OK',
    headers: headersMap,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

describe('basecamp-api', () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('bcFetch sends User-Agent, Accept and returns parsed body', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ body: { ok: true } }));
    const data = await bcFetch<{ ok: boolean }>(makeCtx(), '/projects.json');
    expect(data.ok).toBe(true);
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    expect(url).toBe('https://3.basecampapi.com/9999/projects.json');
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/^BasecampMCP \(/);
    expect(headers.Accept).toBe('application/json');
    expect(headers.Authorization).toBe('Bearer bearer-token');
  });

  test('bcFetch retries once on 401 with a fresh token', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 401 }));
    fetchMock.mockResolvedValueOnce(makeResponse({ body: { ok: true } }));
    const data = await bcFetch<{ ok: boolean }>(makeCtx(), '/projects.json');
    expect(data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('bcFetch throws BasecampAuthError when 401 persists', async () => {
    fetchMock.mockResolvedValue(makeResponse({ status: 401 }));
    await expect(
      bcFetch<unknown>(makeCtx(), '/projects.json'),
    ).rejects.toBeInstanceOf(BasecampAuthError);
  });

  test('bcFetch throws BasecampRateLimitError with Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 429, headers: { 'Retry-After': '7' } }),
    );
    const err = await bcFetch<unknown>(makeCtx(), '/projects.json').catch(
      (e) => e as BasecampRateLimitError,
    );
    expect(err).toBeInstanceOf(BasecampRateLimitError);
    expect((err as BasecampRateLimitError).retryAfterSec).toBe(7);
  });

  test('bcFetch throws BasecampNotFoundError on 404', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 404 }));
    await expect(bcFetch<unknown>(makeCtx(), '/x')).rejects.toBeInstanceOf(
      BasecampNotFoundError,
    );
  });

  test('bcFetchPage exposes Link rel="next"', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        body: [{ id: 1 }],
        headers: {
          Link: '<https://3.basecampapi.com/9999/projects.json?page=2>; rel="next"',
        },
      }),
    );
    const page = await bcFetchPage<Array<{ id: number }>>(makeCtx(), '/projects.json');
    expect(page.nextUrl).toBe(
      'https://3.basecampapi.com/9999/projects.json?page=2',
    );
  });

  test('bcFetchOffsetLimit walks pages to satisfy offset/limit', async () => {
    // Page 1: items 1-3, next page set.
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        body: [{ id: 1 }, { id: 2 }, { id: 3 }],
        headers: {
          Link: '<https://3.basecampapi.com/9999/projects.json?page=2>; rel="next"',
        },
      }),
    );
    // Page 2: items 4-6, no next.
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        body: [{ id: 4 }, { id: 5 }, { id: 6 }],
        headers: {},
      }),
    );
    const res = await bcFetchOffsetLimit<{ id: number }>(
      makeCtx(),
      '/projects.json',
      3,
      2,
    );
    // We offset=2, limit=3: skip first 2, take next 3 (items 3,4,5).
    expect(res.items.map((x) => x.id)).toEqual([3, 4, 5]);
    expect(res.hasMore).toBe(true);
  });
});

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

describe('getMyReadings', () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const emptyBody: BasecampReadingsResponse = {
    unreads: [],
    reads: [],
    memories: [],
  };

  test('hits /my/readings.json with the standard headers', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ body: emptyBody }));
    await getMyReadings(makeCtx());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://3.basecampapi.com/9999/my/readings.json');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/^BasecampMCP \(/);
    expect(headers.Accept).toBe('application/json');
    expect(headers.Authorization).toBe('Bearer bearer-token');
  });

  test('returns { unreads, reads, memories } as-is', async () => {
    const body: BasecampReadingsResponse = {
      unreads: [
        {
          id: 1,
          created_at: '2026-04-22T09:00:00.000Z',
          updated_at: '2026-04-22T09:00:00.000Z',
          section: 'mentions',
          unread_count: 1,
          unread_at: '2026-04-22T09:00:00.000Z',
          read_at: null,
          readable_sgid: 'abc',
          title: 'Heads up',
          type: 'Recording',
          bucket_name: 'Project A',
          creator: { id: 42, name: 'Katia' },
          app_url: 'https://3.basecamp.com/9999/buckets/1/ping/1',
        },
      ],
      reads: [],
      memories: [],
    };
    fetchMock.mockResolvedValueOnce(makeResponse({ body }));

    const out = await getMyReadings(makeCtx());
    expect(out.unreads).toHaveLength(1);
    expect(out.unreads[0].section).toBe('mentions');
    expect(out.unreads[0].creator.name).toBe('Katia');
    expect(out.reads).toEqual([]);
    expect(out.memories).toEqual([]);
  });

  test('propagates BasecampRateLimitError on 429', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 429, headers: { 'Retry-After': '12' } }),
    );
    const err = await getMyReadings(makeCtx()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BasecampRateLimitError);
    expect((err as BasecampRateLimitError).retryAfterSec).toBe(12);
  });

  test('propagates BasecampAuthError when 401 persists', async () => {
    fetchMock.mockResolvedValue(makeResponse({ status: 401 }));
    await expect(getMyReadings(makeCtx())).rejects.toBeInstanceOf(
      BasecampAuthError,
    );
  });
});
